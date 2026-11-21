// Vérifications des secours du relais vidéo, sans réseau ni navigateur :
//  - la détection d'un relais trop lent (public/assets/js/slowrelay.js) :
//    seuil, deux segments de suite, VOD seulement, relais principal
//    seulement, segments trop courts, mesure et ligne du journal (sans
//    adresse) ;
//  - le guet du lecteur et la bascule sans nouvelle instance de hls.js
//    (Player.noteRelaySpeed et moveRelay, failedProxy de player.js) ;
//  - le routage (api.js) depuis le 19/11 : une lenteur ne fait plus rien
//    changer (le forfait du relais de Sofia ne peut pas porter les VODs) ;
//    relais principal en panne → Sofia pour les directs et les VODs, puis
//    le Worker si Sofia l'est aussi ; retour au relais principal, sauf pour
//    la source « bg » ;
//  - le site, l'app TV LG et le multi-live branchés de la même façon
//    (main.js, webos/src/watch.js, multi.js), l'avis « relais lent » retiré,
//    SITE_VERSION, les nouveautés et la version de l'app TV.
// api.js et player.js sont importés avec un faux navigateur (window,
// localStorage) et un faux fetch : aucune requête ne part.
// Lancer : node tools/slow-relay-check.mjs (Node 22 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MIN_SEGMENT_S, SLOW_RATIO, SLOW_STREAK, SlowRelayWatch, fragTiming, isSlowSegment, slowMeasure, slowRelayLine,
} from '../public/assets/js/slowrelay.js'

const ROOT = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8')

const RELAY = 'https://relais.mxfia19.duckdns.org'
const SOFIA = 'https://2-58-32-226.sslip.io'
const WORKER = 'https://test2.kurzmathis4.workers.dev'
const FALLBACK = 'https://test2-fallback.vxcraftmanpetit.workers.dev'
const VOD_PLAYLIST = 'https://d1m7jfoe9zdc1j.cloudfront.net/abc_chaine_123_456/1080p60/index-dvr.m3u8'
const proxied = (base, target = VOD_PLAYLIST, vod = true) => `${base}/api/proxy?url=${encodeURIComponent(target)}&isVod=${vod}`
const vodLinks = (base) => ({
  '1080p60': proxied(base),
  '720p60': proxied(base, VOD_PLAYLIST.replace('1080p60', '720p60')),
  Auto: proxied(base, VOD_PLAYLIST.replace('1080p60/index-dvr', 'master')),
})
const originsOf = (links) => [...new Set(Object.values(links).map((u) => new URL(u).origin))]

// ── Faux navigateur, avant d'importer api.js et player.js ─────────────────
const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => { storage.set(k, String(v)) },
  removeItem: (k) => { storage.delete(k) },
  key: (i) => [...storage.keys()][i] ?? null,
  get length() { return storage.size },
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.pathname === '/health') return json({ relay: 'ok' })
  // Source « bg » interrogée directement : pas de direct depuis Sofia ici.
  if (url.origin === SOFIA && url.pathname === '/api/get-live') return json({ error: 'Twitch unavailable from this server' }, 404)
  // Un Worker : ses liens passent par lui (workerOrigin), comme worker.js.
  if (url.pathname === '/api/get-m3u8' || url.pathname === '/api/recover-resolve') return json({ links: vodLinks(url.origin), variants: {} })
  if (url.pathname === '/api/get-live') {
    return json({ links: { Auto: proxied(url.origin, 'https://usher.ttvnw.net/api/channel/hls/chaine.m3u8', false) }, variants: {}, source: 'twitch' })
  }
  return json({ error: 'inattendu' }, 500)
}
// Délai « relais lent » laissé sur l'appareil par la version d'avant le
// 19/11 : api.js l'efface en se chargeant.
storage.set('tu_relay_slow', String(Date.now() + 30 * 60_000))
const api = await import('../public/assets/js/api.js')
const { Player, failedProxy } = await import('../public/assets/js/player.js')

// ── slowrelay.js : la détection ───────────────────────────────────────────
const seg = (loadMs, durationS = 10, extra = {}) => ({ vod: true, relay: true, loadMs, durationS, bytes: 9.4e6, ...extra })

test('seuil : plus lent que sa durée (1,0×), strictement', () => {
  assert.equal(SLOW_RATIO, 1)
  assert.equal(SLOW_STREAK, 2)
  assert.equal(MIN_SEGMENT_S, 1)
  assert.equal(isSlowSegment(10_000, 10), false, 'chargé en exactement sa durée : pas lent')
  assert.equal(isSlowSegment(10_001, 10), true)
  assert.equal(isSlowSegment(9_000, 10), false)
  assert.equal(isSlowSegment(2_500, 2), true, 'segment de 2 s chargé en 2,5 s')
})

test('mesures du 18/11 : 9,4 Mo de 1080p60 pour 10 s de vidéo', () => {
  // Durée de chargement à un débit donné (Mb/s).
  const at = (mbps) => (9.4e6 * 8) / (mbps * 1e6) * 1000
  assert.equal(isSlowSegment(at(0.7), 10), true, 'relais saturé (0,7 Mb/s) : 107 s pour 10 s')
  assert.equal(isSlowSegment(at(4.6), 10), true, 'relais déjà chargé (4,6 Mb/s) : 16 s pour 10 s')
  assert.equal(isSlowSegment(at(8.3), 10), false, 'relais de Sofia (8,3 Mb/s) : 9 s pour 10 s')
  assert.equal(isSlowSegment(at(11.8), 10), false, 'relais sain (11,8 Mb/s)')
})

test('deux segments lents de suite, pas un seul ni deux séparés par un rapide', () => {
  const w = new SlowRelayWatch()
  assert.equal(w.note(seg(107_000)), null, 'un seul : un accroc possible')
  assert.equal(w.note(seg(4_000)), null, 'un rapide remet à zéro')
  assert.equal(w.note(seg(107_000)), null)
  const m = w.note(seg(107_400))
  assert.ok(m, 'le deuxième de suite : relais lent')
  assert.equal(m.segments, 2)
  assert.equal(m.loadMs, 214_400)
  assert.equal(m.durationS, 20)
  assert.equal(m.bytes, 18.8e6)
  assert.ok(Math.abs(m.mbps - 0.701) < 0.01, `débit ${m.mbps}`)
  assert.ok(Math.abs(m.ratio - 10.72) < 0.01)
  assert.deepEqual(m.each.map((r) => r.toFixed(2)), ['10.70', '10.74'])
  // Le compte repart de zéro après un verdict.
  assert.equal(w.note(seg(50_000)), null)
  assert.ok(w.note(seg(50_000)))
})

test('VOD seulement, relais principal seulement : sinon rien, et le compte repart', () => {
  const w = new SlowRelayWatch()
  assert.equal(w.note(seg(107_000, 10, { vod: false })), null, 'direct')
  assert.equal(w.note(seg(107_000, 10, { vod: false })), null, 'direct, deux de suite : toujours rien')
  assert.equal(w.note(seg(107_000, 10, { relay: false })), null, 'Sofia ou un Worker')
  assert.equal(w.note(seg(107_000, 10, { relay: false })), null)
  // Un segment venu d'ailleurs coupe la suite.
  assert.equal(w.note(seg(107_000)), null)
  assert.equal(w.note(seg(107_000, 10, { relay: false })), null)
  assert.equal(w.note(seg(107_000)), null, 'la suite a été coupée')
  assert.ok(w.note(seg(107_000)))
  assert.equal(new SlowRelayWatch().note(), null, 'sans rien')
})

test('segments trop courts (fin de VOD, initialisation du fMP4) : ni comptés ni remis à zéro', () => {
  const w = new SlowRelayWatch()
  assert.equal(w.note(seg(30_000)), null)
  assert.equal(w.note(seg(5_000, 0.5)), null, 'demi-seconde lente : ignorée')
  assert.equal(w.note(seg(100, 0.5)), null, 'demi-seconde rapide : ignorée aussi')
  assert.equal(w.note(seg(800, 0)), null, 'segment d’initialisation (durée nulle)')
  assert.ok(w.note(seg(30_000)), 'la suite tient : deux lents de suite')
})

test('seuil et nombre réglables', () => {
  const w = new SlowRelayWatch({ ratio: 1.5, streak: 3 })
  assert.equal(w.note(seg(14_000)), null, '1,4× sous un seuil de 1,5×')
  assert.equal(w.note(seg(16_000)), null)
  assert.equal(w.note(seg(16_000)), null)
  assert.ok(w.note(seg(16_000)))
})

test('fragTiming : statistiques de hls.js (FRAG_LOADED)', () => {
  const frag = { duration: 10.01, stats: { loading: { start: 2000, first: 2600, end: 109_400 }, loaded: 9_400_000, total: 9_400_000 } }
  assert.deepEqual(fragTiming(frag), { loadMs: 107_400, durationS: 10.01, bytes: 9_400_000 })
  assert.equal(fragTiming({ duration: 10, stats: { loading: { start: 5, end: 0 } } }), null, 'pas fini')
  assert.equal(fragTiming({ duration: 0, stats: { loading: { start: 0, end: 900 } } }), null, 'init')
  assert.equal(fragTiming({ duration: 10 }), null)
  assert.equal(fragTiming(null), null)
  assert.equal(fragTiming({ duration: 10, stats: { loading: { start: 0, end: 900 } } }).bytes, 0, 'taille inconnue')
})

test('ligne du journal : la mesure, ce qui en est fait, aucune adresse, moins de 300 caractères', () => {
  const m = slowMeasure([{ loadMs: 107_000, durationS: 10, bytes: 9.4e6 }, { loadMs: 107_400, durationS: 10, bytes: 9.4e6 }])
  const line = slowRelayLine(m, 'la VOD reste sur le relais (Sofia seulement en cas de panne)')
  assert.match(line, /^relais lent \(VOD\) : 2 segments de suite plus lents que leur durée, 18\.8 Mo en 214\.4 s pour 20\.0 s de vidéo \(0\.7 Mb\/s, ×10\.7 ×10\.7\) ; la VOD reste sur le relais/)
  assert.doesNotMatch(line, /https?:|\/api\/|sslip|duckdns|token|sig=/i)
  assert.ok(`TV ${line}`.length <= 300, `${line.length} caractères (le journal coupe à 300)`)
  const unknown = slowRelayLine(slowMeasure([{ loadMs: 3000, durationS: 2 }, { loadMs: 2500, durationS: 2 }]))
  assert.equal(unknown, 'relais lent (VOD) : 2 segments de suite plus lents que leur durée, 5.5 s pour 4.0 s de vidéo (×1.5 ×1.3)')
})

// ── player.js : guet et bascule ───────────────────────────────────────────
const frag = (base, loadMs, durationS = 10) => ({
  url: proxied(base, VOD_PLAYLIST.replace('index-dvr.m3u8', '123.ts')),
  duration: durationS,
  stats: { loading: { start: 1000, end: 1000 + loadMs }, loaded: 9.4e6, total: 9.4e6 },
})

test('noteRelaySpeed : deux segments lents du relais principal pendant une VOD → onSlowRelay', () => {
  const seen = []
  const p = { o: { onSlowRelay: (m) => seen.push(m) }, kind: 'vod', relayMove: null }
  const watch = new SlowRelayWatch()
  Player.prototype.noteRelaySpeed.call(p, watch, frag(RELAY, 107_000), 1)
  assert.equal(seen.length, 0)
  Player.prototype.noteRelaySpeed.call(p, watch, frag(RELAY, 107_400), 1)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].segments, 2)
})

test('noteRelaySpeed : rien pour un direct, ni par Sofia ou un Worker, ni après une bascule', () => {
  const seen = []
  const hit = (p, f, token = 1) => {
    const watch = new SlowRelayWatch()
    for (let i = 0; i < 4; i++) Player.prototype.noteRelaySpeed.call(p, watch, f, token)
  }
  const base = () => ({ o: { onSlowRelay: (m) => seen.push(m) }, kind: 'vod', relayMove: null })
  hit({ ...base(), kind: 'live' }, frag(RELAY, 107_000))
  hit(base(), frag(SOFIA, 107_000))
  hit(base(), frag(WORKER, 107_000))
  hit(base(), frag(FALLBACK, 107_000))
  // Bascule faite (moveRelay) : les adresses notées avec le relais partent
  // vers Sofia, une lenteur n'est plus la sienne.
  hit({ ...base(), relayMove: { token: 1, from: RELAY, to: SOFIA } }, frag(RELAY, 107_000), 1)
  // Clip ou lecteur sans gestionnaire : rien non plus.
  hit({ ...base(), o: {} }, frag(RELAY, 107_000))
  assert.equal(seen.length, 0)
  // Bascule d'une instance précédente (autre jeton) : le guet reprend.
  hit({ ...base(), relayMove: { token: 1, from: RELAY, to: SOFIA } }, frag(RELAY, 107_000), 2)
  assert.equal(seen.length, 2)
})

test('moveRelay : nouveaux liens, requêtes de l’instance vers Sofia, sans nouvelle instance', async () => {
  const swapped = []
  const make = (extra = {}) => ({
    hls: {}, quality: '1080p60', attachToken: 7, unplayable: new Set(['720p60']), health: { c: {}, add(n) { this.c[n] = (this.c[n] || 0) + 1 } },
    links: vodLinks(RELAY), swapLinks(links) { swapped.push(links) }, ...extra,
  })
  const p = make()
  const sofia = vodLinks(SOFIA)
  Player.prototype.moveRelay.call(p, sofia, RELAY, SOFIA)
  assert.equal(swapped.length, 0, 'pas de nouvelle instance')
  assert.deepEqual(p.relayMove, { token: 7, from: RELAY, to: SOFIA })
  assert.deepEqual(Object.keys(p.links), ['1080p60', 'Auto'], 'sans les qualités déjà écartées pour leur codec')
  assert.deepEqual(originsOf(p.links), [SOFIA])
  assert.equal(p.health.c.swap, 1)
  // Sans hls.js (HLS natif) ou sans la qualité jouée : swapLinks, hors de
  // l'événement de hls.js (au tour suivant), pour la même lecture seulement.
  Player.prototype.moveRelay.call(make({ hls: null }), sofia, RELAY, SOFIA)
  Player.prototype.moveRelay.call(make({ quality: '480p30' }), sofia, RELAY, SOFIA)
  Player.prototype.moveRelay.call(make(), sofia, RELAY, null)
  const gone = make()
  Player.prototype.moveRelay.call(gone, sofia, RELAY, null)
  gone.attachToken++
  assert.equal(swapped.length, 0, 'pas dans l’événement')
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(swapped.length, 3, 'une autre vidéo lancée entre-temps : rien')
})

test('failedProxy : le relais de Sofia suit les règles du relais du VPS', () => {
  const err = (base, code) => ({ frag: { url: proxied(base, VOD_PLAYLIST.replace('index-dvr.m3u8', '9.ts')) }, response: { code } })
  assert.equal(failedProxy(err(SOFIA, 0)), SOFIA, 'injoignable')
  assert.equal(failedProxy(err(SOFIA, 403)), SOFIA, 'refus')
  assert.equal(failedProxy(err(SOFIA, 429)), SOFIA)
  assert.equal(failedProxy(err(SOFIA, 502)), SOFIA, 'panne')
  assert.equal(failedProxy(err(SOFIA, 404)), null, 'segment introuvable : pas une panne')
  assert.equal(failedProxy(err(SOFIA, 410)), null)
  // Inchangé pour les autres.
  assert.equal(failedProxy(err(RELAY, 0)), RELAY)
  assert.equal(failedProxy(err(RELAY, 503)), RELAY)
  assert.equal(failedProxy(err(RELAY, 404)), null)
  assert.equal(failedProxy(err(FALLBACK, 0)), FALLBACK)
  assert.equal(failedProxy(err(FALLBACK, 503)), null, 'Worker : seulement sans réponse')
  assert.equal(failedProxy({ frag: { url: 'https://d1m7jfoe9zdc1j.cloudfront.net/a/1.ts' }, response: { code: 0 } }), null)
  assert.equal(failedProxy({ context: { url: proxied(SOFIA) }, response: { code: 0 } }), SOFIA, 'playlist')
})

// ── api.js : routage ──────────────────────────────────────────────────────
test('relais de Sofia : seulement derrière le relais officiel', () => {
  assert.equal(api.RELAY_BASE, RELAY)
  assert.equal(api.SOFIA_BASE, SOFIA)
  assert.equal(api.vpsRelayOf(proxied(RELAY)), RELAY)
  assert.equal(api.vpsRelayOf(proxied(SOFIA)), SOFIA)
  assert.equal(api.vpsRelayOf(proxied(WORKER)), null)
  assert.equal(api.vpsRelayOf('pas une adresse'), null)
  // proxyBaseOf ne connaît pas Sofia : les règles du direct « bg » restent.
  assert.equal(api.proxyBaseOf(proxied(SOFIA)), null)
  assert.equal(api.directUrl(proxied(SOFIA)), VOD_PLAYLIST, 'adresse d’origine, pour la sonde du son')
})

test('linkMoved : la route /api/proxy du relais, rien d’autre', () => {
  const seg9 = proxied(RELAY, VOD_PLAYLIST.replace('index-dvr.m3u8', '9.ts'))
  assert.equal(api.linkMoved(seg9, RELAY, SOFIA), seg9.replace(RELAY, SOFIA), 'même chemin, même requête')
  assert.equal(api.linkMoved(proxied(WORKER), RELAY, SOFIA), proxied(WORKER), 'un Worker reste un Worker')
  assert.equal(api.linkMoved(`${RELAY}/health`, RELAY, SOFIA), `${RELAY}/health`)
  assert.equal(api.linkMoved('https://d1m7jfoe9zdc1j.cloudfront.net/a/9.ts', RELAY, SOFIA), 'https://d1m7jfoe9zdc1j.cloudfront.net/a/9.ts')
})

test('relais lent : plus de bascule, tout reste sur le relais principal (19/11)', async () => {
  assert.equal(localStorage.getItem('tu_relay_slow'), null, 'ancien délai effacé au chargement')
  for (const gone of ['relaySlow', 'markRelaySlow', 'toSofia']) assert.equal(api[gone], undefined, gone)
  assert.deepEqual(originsOf((await api.getVodLinks('123')).links), [RELAY])
  assert.deepEqual(originsOf((await api.resolveRecovery('chaine', '789', 1_700_000_000)).links), [RELAY], 'VOD reconstruite aussi')
  assert.deepEqual(originsOf((await api.getLive('chaine')).links), [RELAY])
  assert.equal(api.playbackBase(), RELAY)
})

test('retour au relais principal : depuis un Worker ou Sofia, sauf la source « bg »', () => {
  assert.deepEqual(originsOf(api.backToRelay(vodLinks(FALLBACK))), [RELAY])
  assert.deepEqual(originsOf(api.backToRelay(vodLinks(SOFIA))), [RELAY], 'secours de Sofia : retour')
  assert.deepEqual(api.backToRelay(vodLinks(SOFIA), { keepSofia: true }), vodLinks(SOFIA), 'direct « bg » : Sofia est sa source')
  assert.deepEqual(originsOf(api.backToRelay(vodLinks(FALLBACK), { keepSofia: true })), [RELAY], 'un Worker revient quand même')
  assert.deepEqual(api.backToRelay(vodLinks(RELAY)), vodLinks(RELAY))
})

test('relais principal en panne : directs et VODs par Sofia, pas par un Worker', async (t) => {
  // Le guet de /health (watchRelayBack) part à 30 s : minuterie simulée, pour
  // qu'il ne tourne pas après les tests.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    assert.equal(api.markWorkerDown(RELAY), true)
  } finally {
    t.mock.timers.reset()
  }
  assert.equal(api.relayFallback(), SOFIA)
  assert.equal(api.playbackBase(), SOFIA, 'direct par le compte (app TV)')
  assert.deepEqual(originsOf((await api.getLive('chaine')).links), [SOFIA], 'direct lancé pendant la panne')
  assert.deepEqual(originsOf((await api.getVodLinks('456')).links), [SOFIA], 'VOD lancée pendant la panne')
  assert.deepEqual(originsOf(api.withoutRelay(vodLinks(RELAY))), [SOFIA], 'en pleine lecture')
  assert.deepEqual(api.withoutRelay(vodLinks(FALLBACK)), vodLinks(FALLBACK), 'rien à déplacer')
})

test('Sofia en panne aussi : le Worker, le secours d’abord', async () => {
  assert.equal(api.markWorkerDown(SOFIA), true, 'un relais du VPS a toujours le Worker pour recours')
  const down = JSON.parse(localStorage.getItem('tu_worker_down'))
  assert.ok(down[SOFIA] > Date.now() && down[SOFIA] <= Date.now() + 2 * 60_000, 'écarté 2 min, comme le relais')
  assert.equal(api.relayFallback(), FALLBACK)
  assert.equal(api.playbackBase(), FALLBACK)
  assert.deepEqual(originsOf(api.withoutSofia(vodLinks(SOFIA))), [FALLBACK])
  assert.deepEqual(api.withoutSofia(vodLinks(RELAY)), vodLinks(RELAY), 'rien à déplacer')
  assert.deepEqual(originsOf(api.withoutRelay(vodLinks(RELAY))), [FALLBACK])
  assert.deepEqual(originsOf((await api.getLive('chaine')).links), [FALLBACK], 'direct : laissé au Worker')
  assert.deepEqual(originsOf((await api.getVodLinks('321')).links), [FALLBACK], 'VOD : laissée au Worker')
})

test('fin des pannes (2 min) : tout revient au relais principal', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 3 * 60_000 })
  try {
    assert.equal(api.relayFallback(), SOFIA)
    assert.equal(api.playbackBase(), RELAY)
    assert.deepEqual(originsOf((await api.getLive('chaine')).links), [RELAY])
    assert.deepEqual(originsOf((await api.getVodLinks('654')).links), [RELAY])
  } finally {
    t.mock.timers.reset()
  }
})

// ── Site et app TV branchés pareil ────────────────────────────────────────
test('main.js et l’app TV : lenteur notée sans bascule, Sofia pour les pannes, retour au relais', () => {
  for (const file of ['public/assets/js/main.js', 'webos/src/watch.js']) {
    const src = read(file)
    assert.match(src, /onSlowRelay: \(m\) => slowRelay\(m\)/, `${file} : gestionnaire du lecteur`)
    assert.match(src, /slowRelayLine\(m, 'la VOD reste sur le relais \(Sofia seulement en cas de panne\)'\)/, `${file} : lenteur notée au journal`)
    assert.match(src, /w\.slowNoted = true/, `${file} : une fois par VOD`)
    assert.doesNotMatch(src, /markRelaySlow|toSofia|moveRelay\(|relay_slow/, `${file} : plus de bascule ni d’avis`)
    assert.match(src, /base === api\.RELAY_BASE && w\.links && api\.markWorkerDown\(base\)[\s\S]{0,500}api\.withoutRelay\(w\.links\)/, `${file} : relais en panne → son secours`)
    assert.match(src, /api\.relayFallback\(\) === api\.SOFIA_BASE \? 'le relais de Sofia' : 'le Worker'/, `${file} : le journal dit par où`)
    assert.match(src, /base === api\.SOFIA_BASE && \(w\.kind === 'vod' \|\| w\.source !== 'bg'\) && w\.links && api\.markWorkerDown\(base\)[\s\S]{0,400}api\.withoutSofia\(w\.links\)/, `${file} : Sofia en panne → Worker, sauf la source bg`)
    assert.match(src, /api\.backToRelay\(w\.links, \{ keepSofia: w\.kind === 'live' && w\.source === 'bg' \}\)/, `${file} : retour au relais, sauf la source bg`)
    assert.match(src, /if \(w\.relayReturns > 2 && !vodOnSofia\) return/, `${file} : une VOD sur Sofia revient toujours`)
  }
  const multi = read('public/assets/js/multi.js')
  assert.match(multi, /tile\.viaWorker = Boolean\(api\.RELAY_BASE\) && via !== null && via !== api\.RELAY_BASE && !\(via === api\.SOFIA_BASE && res\.source === 'bg'\)/, 'multi-live : un direct sur Sofia repart au retour du relais')
  assert.match(multi, /api\.backToRelay\(tile\.vodLinks\)/, 'multi-live : VODs ramenées au relais')
  assert.match(multi, /down === api\.SOFIA_BASE && tile\.source !== 'bg'/, 'multi-live : Sofia en panne → Worker, sauf bg')
})

test('avis « relais lent » retiré des cinq langues, nouveautés 2026.11.19a, app TV 0.4.2', async () => {
  assert.doesNotMatch(read('public/assets/js/i18n.js'), /relay_slow/)
  const { RU } = await import('../public/assets/js/i18n-ru.js')
  const { ZH_HANT } = await import('../public/assets/js/i18n-zh-Hant.js')
  assert.ok(!('relay_slow' in RU) && !('relay_slow' in ZH_HANT))
  const version = /export const SITE_VERSION = '([^']+)'/.exec(read('public/assets/js/usage.js'))?.[1]
  assert.ok(version >= '2026.11.19a', `SITE_VERSION ${version}`)
  const { CHANGELOG } = await import('../public/assets/js/changelog.js')
  assert.equal(CHANGELOG[0].version, version, 'entrée en tête')
  const entry = CHANGELOG.filter((e) => e.version === '2026.11.19a')
  assert.equal(entry.length, 1)
  for (const l of ['fr', 'en', 'es', 'ru']) {
    assert.equal(entry[0].items[l]?.length, 2, l)
    for (const item of entry[0].items[l]) assert.ok(item.length > 50, l)
  }
  // 0.4.2 au moins : les versions suivantes de l'app TV gardent ce routage.
  const [maj, min, pat] = JSON.parse(read('webos/appinfo.json')).version.split('.').map(Number)
  assert.ok(maj > 0 || min > 4 || (min === 4 && pat >= 2), 'app TV 0.4.2 ou plus')
})
