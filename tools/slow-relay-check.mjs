// Vérifications du secours « relais trop lent » des VODs, sans réseau ni
// navigateur :
//  - la détection (public/assets/js/slowrelay.js) : seuil, deux segments de
//    suite, VOD seulement, relais principal seulement, segments trop courts,
//    mesure et ligne du journal (sans adresse) ;
//  - le guet du lecteur et la bascule sans nouvelle instance de hls.js
//    (Player.noteRelaySpeed et moveRelay, failedProxy de player.js) ;
//  - le routage (api.js) : VODs par le relais de Sofia pendant 30 min, aucun
//    retour au relais lent avant la fin du délai (backToRelay), Sofia en
//    panne → le Worker, directs inchangés ;
//  - le site et l'app TV LG branchés de la même façon (main.js,
//    webos/src/watch.js), l'avis dans les cinq langues, SITE_VERSION, les
//    nouveautés et la version de l'app TV.
// api.js et player.js sont importés avec un faux navigateur (window,
// localStorage) et un faux fetch : aucune requête ne part.
// Lancer : node tools/slow-relay-check.mjs (Node 22 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MIN_SEGMENT_S, RELAY_SLOW_MS, SLOW_RATIO, SLOW_STREAK, SlowRelayWatch, fragTiming, isSlowSegment, slowMeasure, slowRelayLine,
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
const api = await import('../public/assets/js/api.js')
const { Player, failedProxy } = await import('../public/assets/js/player.js')

// ── slowrelay.js : la détection ───────────────────────────────────────────
const seg = (loadMs, durationS = 10, extra = {}) => ({ vod: true, relay: true, loadMs, durationS, bytes: 9.4e6, ...extra })

test('seuil : plus lent que sa durée (1,0×), strictement', () => {
  assert.equal(SLOW_RATIO, 1)
  assert.equal(SLOW_STREAK, 2)
  assert.equal(MIN_SEGMENT_S, 1)
  assert.equal(RELAY_SLOW_MS, 30 * 60_000)
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
  const line = slowRelayLine(m, 'la suite passe par le relais de Sofia (relais écarté des VODs 30 min)')
  assert.match(line, /^relais lent \(VOD\) : 2 segments de suite plus lents que leur durée, 18\.8 Mo en 214\.4 s pour 20\.0 s de vidéo \(0\.7 Mb\/s, ×10\.7 ×10\.7\) ; la suite passe/)
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

test('linkMoved et toSofia : la route /api/proxy du relais, rien d’autre', () => {
  const seg9 = proxied(RELAY, VOD_PLAYLIST.replace('index-dvr.m3u8', '9.ts'))
  assert.equal(api.linkMoved(seg9, RELAY, SOFIA), seg9.replace(RELAY, SOFIA), 'même chemin, même requête')
  assert.equal(api.linkMoved(proxied(WORKER), RELAY, SOFIA), proxied(WORKER), 'un Worker reste un Worker')
  assert.equal(api.linkMoved(`${RELAY}/health`, RELAY, SOFIA), `${RELAY}/health`)
  assert.equal(api.linkMoved('https://d1m7jfoe9zdc1j.cloudfront.net/a/9.ts', RELAY, SOFIA), 'https://d1m7jfoe9zdc1j.cloudfront.net/a/9.ts')
  assert.deepEqual(api.toSofia(vodLinks(RELAY)), vodLinks(SOFIA))
  assert.deepEqual(api.toSofia(vodLinks(FALLBACK)), vodLinks(FALLBACK))
})

test('avant toute lenteur : les VODs par le relais principal', async () => {
  assert.equal(api.relaySlow(), false)
  assert.deepEqual(originsOf((await api.getVodLinks('123')).links), [RELAY])
  assert.deepEqual(originsOf(api.backToRelay(vodLinks(FALLBACK), { vod: true })), [RELAY], 'relais revenu, pas lent : la VOD y retourne')
})

test('relais lent : écarté des VODs 30 min, les suivantes partent par Sofia', async () => {
  const before = Date.now()
  assert.equal(api.markRelaySlow(), true)
  assert.equal(api.relaySlow(), true)
  const until = Number(localStorage.getItem('tu_relay_slow'))
  assert.ok(until >= before + RELAY_SLOW_MS && until <= Date.now() + RELAY_SLOW_MS, 'gardé sur l’appareil, pour 30 min')
  assert.deepEqual(originsOf((await api.getVodLinks('456')).links), [SOFIA])
  assert.deepEqual(originsOf((await api.resolveRecovery('chaine', '789', 1_700_000_000)).links), [SOFIA], 'VOD reconstruite aussi')
  // Les directs ne bougent pas : leurs segments ne passent pas par le relais.
  assert.deepEqual(originsOf((await api.getLive('chaine')).links), [RELAY])
})

test('pas d’aller-retour : backToRelay ne ramène pas une VOD sur le relais lent', () => {
  assert.deepEqual(api.backToRelay(vodLinks(SOFIA), { vod: true }), vodLinks(SOFIA), 'restée sur Sofia')
  assert.deepEqual(originsOf(api.backToRelay(vodLinks(FALLBACK), { vod: true })), [SOFIA], 'du Worker : vers Sofia, pas le relais')
  assert.deepEqual(originsOf(api.backToRelay(vodLinks(FALLBACK))), [RELAY], 'un direct, lui, revient au relais')
})

test('Sofia en panne : le Worker reste le filet, jamais le relais lent', async () => {
  assert.equal(api.markWorkerDown(SOFIA), true, 'un relais du VPS a toujours le Worker pour recours')
  const down = JSON.parse(localStorage.getItem('tu_worker_down'))
  assert.ok(down[SOFIA] > Date.now() && down[SOFIA] <= Date.now() + 2 * 60_000, 'écarté 2 min, comme le relais')
  assert.deepEqual(originsOf(api.withoutSofia(vodLinks(SOFIA))), [FALLBACK], 'le Worker de secours d’abord')
  assert.deepEqual(api.withoutSofia(vodLinks(RELAY)), vodLinks(RELAY), 'rien à déplacer')
  assert.deepEqual(originsOf((await api.getVodLinks('321')).links), [FALLBACK], 'VOD lancée pendant la panne : au Worker')
  assert.deepEqual(api.backToRelay(vodLinks(FALLBACK), { vod: true }), vodLinks(FALLBACK), 'ni Sofia en panne ni le relais lent')
  assert.equal(api.markRelaySlow(), false, 'pas de bascule vers un Sofia en panne')
})

test('fin du délai : les VODs reviennent au relais principal', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + RELAY_SLOW_MS + 60_000 })
  try {
    assert.equal(api.relaySlow(), false)
    assert.deepEqual(originsOf((await api.getVodLinks('654')).links), [RELAY])
    assert.deepEqual(originsOf(api.backToRelay(vodLinks(FALLBACK), { vod: true })), [RELAY])
  } finally {
    t.mock.timers.reset()
  }
})

// ── Site et app TV branchés pareil ────────────────────────────────────────
test('main.js et l’app TV : même bascule, même filet, même retour', () => {
  for (const file of ['public/assets/js/main.js', 'webos/src/watch.js']) {
    const src = read(file)
    assert.match(src, /onSlowRelay: \(m\) => slowRelay\(m\)/, `${file} : gestionnaire du lecteur`)
    assert.match(src, /api\.markRelaySlow\(\)/, `${file} : relais écarté 30 min`)
    assert.match(src, /w\.links = api\.toSofia\(w\.links\)\s+player\.moveRelay\(w\.links, api\.RELAY_BASE, api\.SOFIA_BASE\)/, `${file} : bascule sans nouvelle instance`)
    assert.match(src, /toast\(t\('relay_slow'\)/, `${file} : avis`)
    assert.match(src, /slowRelayLine\(m, /, `${file} : journal`)
    assert.match(src, /base === api\.SOFIA_BASE && w\.kind === 'vod' && w\.links && api\.markWorkerDown\(base\)[\s\S]{0,300}api\.withoutSofia\(w\.links\)/, `${file} : Sofia en panne → Worker`)
    assert.match(src, /api\.backToRelay\(w\.links, \{ vod: w\.kind === 'vod' \}\)/, `${file} : pas de retour au relais lent`)
  }
})

test('avis dans les cinq langues, nouveautés 2026.11.18b, app TV 0.4.1', async () => {
  assert.equal((read('public/assets/js/i18n.js').match(/^\s+relay_slow: '/gm) || []).length, 3, 'fr, en, es')
  assert.match(read('public/assets/js/i18n.js'), /relay_slow: 'Relais lent : vidéo par un autre serveur'/)
  const { RU } = await import('../public/assets/js/i18n-ru.js')
  const { ZH_HANT } = await import('../public/assets/js/i18n-zh-Hant.js')
  assert.ok(RU.relay_slow && ZH_HANT.relay_slow)
  const version = /export const SITE_VERSION = '([^']+)'/.exec(read('public/assets/js/usage.js'))?.[1]
  assert.equal(version, '2026.11.18b')
  const { CHANGELOG } = await import('../public/assets/js/changelog.js')
  assert.equal(CHANGELOG[0].version, version, 'entrée en tête')
  assert.equal(CHANGELOG.filter((e) => e.version === version).length, 1)
  for (const l of ['fr', 'en', 'es', 'ru']) assert.ok(CHANGELOG[0].items[l]?.[0]?.length > 50, l)
  assert.equal(JSON.parse(read('webos/appinfo.json')).version, '0.4.1')
})
