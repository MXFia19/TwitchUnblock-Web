// Vérifications des qualités supérieures côté site (public/assets/js/hq.js, et
// les opérations hq.* de connect.js), sans navigateur ni réseau : une fausse
// extension, un faux lecteur et une horloge simulée. N'importe ni api.js ni
// player.js (ils parleraient au Worker et au relais). Lancer :
// node tools/hq-check.mjs (Node 22 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HQ_CODECS, OPS, cleanArgs, normalize, timeoutFor } from '../public/assets/js/connect.js'
import {
  EDGE_WINDOW, HQ_MIN_VERSION, HqLive, buildHq, codecLabel, detectCodecs, edgeAdWait, hqAvailable, hqCanAsk, isHqUrl,
  versionAtLeast, videoFamily,
} from '../public/assets/js/hq.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Horloge simulée : les minuteurs ne partent qu'avec advance(). */
function fakeClock(start = Date.parse('2026-10-25T17:00:00.000Z')) {
  let now = start
  let seq = 0
  const timers = new Map()
  return {
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn, seq: id }); return id },
    clearTimeout: (id) => { timers.delete(id) },
    now: () => now,
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms
      for (;;) {
        let next = null
        for (const [id, tm] of timers) {
          if (tm.at <= end && (!next || tm.at < next.tm.at || (tm.at === next.tm.at && tm.seq < next.tm.seq))) next = { id, tm }
        }
        if (!next) break
        timers.delete(next.id)
        now = next.tm.at
        next.tm.fn()
        for (let i = 0; i < 5; i++) await flush()
      }
      now = end
      for (let i = 0; i < 5; i++) await flush()
    },
  }
}

const ID = (n) => `Hq${String(n).padStart(20, '0')}`
const VARIANTS = [
  { id: ID(1), name: '1440p60', source: true, width: 2560, height: 1440, fps: 60, bandwidth: 9_500_000, codecs: 'hvc1.1.2.L150.90.0.0.0.0.0,mp4a.40.2' },
  { id: ID(2), name: '1080p60', source: false, width: 1920, height: 1080, fps: 60, bandwidth: 6_000_000, codecs: 'hvc1.1.2.L123.90.0.0.0.0.0,mp4a.40.2' },
  { id: ID(3), name: '1080p60', source: false, width: 1920, height: 1080, fps: 60, bandwidth: 6_000_000, codecs: 'avc1.64002A,mp4a.40.2' },
  { id: ID(4), name: '720p60', source: false, width: 1280, height: 720, fps: 60, bandwidth: 3_400_000, codecs: 'avc1.4D401F,mp4a.40.2' },
  { id: ID(5), name: 'audio_only', source: false, width: 0, height: 0, fps: 0, bandwidth: 160_000, codecs: 'mp4a.40.2' },
]
const ALL = ['av1', 'h265', 'h264']
const yes = () => true

// ── connect.js : opérations hq.* ───────────────────────────────────────────
test('connect.js : hq.master et hq.playlist dans la liste fermée, 45 s pour la liste du compte', () => {
  assert.ok(OPS.includes('hq.master') && OPS.includes('hq.playlist'))
  assert.deepEqual([...HQ_CODECS], ['av1', 'h265', 'h264'])
  assert.equal(timeoutFor('hq.master'), 45_000, 'peut demander un jeton d’intégrité')
  assert.equal(timeoutFor('hq.playlist'), 15_000)
})

test('connect.js : arguments de hq.* vérifiés et remis dans l’ordre', () => {
  assert.deepEqual(cleanArgs('hq.master', { channel: ' Gotaga ', codecs: ['h264', 'av1'] }), { channel: 'gotaga', codecs: ['av1', 'h264'] })
  assert.deepEqual(cleanArgs('hq.master', { channel: 'a', codecs: ['h264'] }), { channel: 'a', codecs: ['h264'] })
  for (const codecs of [['h265'], ['h264', 'h264'], ['vp9', 'h264'], [], 'av1,h264', undefined, [['h264']]]) {
    assert.equal(cleanArgs('hq.master', { channel: 'a', codecs }), null, JSON.stringify(codecs))
  }
  assert.equal(cleanArgs('hq.master', { channel: 'bad name', codecs: ['h264'] }), null)
  assert.deepEqual(cleanArgs('hq.playlist', { id: ID(1), channel: 'ignored' }), { id: ID(1) }, 'seul l’identifiant part')
  for (const id of ['short', ID(1) + 'x', 'Hq0000000000000000000-', 12, null]) assert.equal(cleanArgs('hq.playlist', { id }), null, String(id))
})

test('connect.js : réponses de hq.* relues, jamais d’adresse gardée', () => {
  const m = normalize('hq.master', { variants: [{ ...VARIANTS[0], url: 'https://euw31.playlist.ttvnw.net/v1/playlist/x.m3u8', extra: 1 }] })
  assert.deepEqual(m, { variants: [{ ...VARIANTS[0] }] })
  assert.deepEqual(Object.keys(m.variants[0]).sort(), ['bandwidth', 'codecs', 'fps', 'height', 'id', 'name', 'source', 'width'])
  assert.equal(normalize('hq.master', { variants: [] }), null)
  assert.equal(normalize('hq.master', { variants: [{ ...VARIANTS[0], id: 'x' }] }), null)
  assert.equal(normalize('hq.master', { variants: [{ ...VARIANTS[0], codecs: 'avc1"><script>' }] }), null)
  assert.equal(normalize('hq.master', { variants: [{ ...VARIANTS[0], name: '<b>' }] }).variants[0].name, '', 'nom douteux : vide')
  assert.equal(normalize('hq.master', { variants: [{ ...VARIANTS[0], fps: 'x' }] }).variants[0].fps, 0)
  assert.deepEqual(normalize('hq.playlist', { playlist: '#EXTM3U\n' }), { playlist: '#EXTM3U\n' })
  assert.equal(normalize('hq.playlist', { playlist: '<html>' }), null)
  assert.equal(normalize('hq.playlist', {}), null)
})

// ── Extension et navigateur ─────────────────────────────────────────────────
test('version de l’extension : 0.2.0 ou plus, et seulement branchée', () => {
  assert.equal(HQ_MIN_VERSION, '0.2.0')
  for (const [v, ok] of [['0.2.0', true], ['0.2.1', true], ['0.10.0', true], ['1.0', true], ['0.1.0', false], ['0.1.9', false], ['', false], [null, false], ['0.2.0-beta', false]]) {
    assert.equal(versionAtLeast(v), ok, String(v))
  }
  const on = { availability: 'on', version: '0.2.0', session: { login: 'a' } }
  assert.equal(hqAvailable(on), true)
  assert.equal(hqAvailable({ ...on, version: '0.1.0' }), false, 'extension 0.1.0 : pas de réglage')
  assert.equal(hqAvailable({ ...on, session: null }), false)
  assert.equal(hqAvailable({ ...on, session: undefined }), false, 'session pas encore relue : réglage caché')
  assert.equal(hqAvailable({ ...on, availability: 'off' }), false)
  assert.equal(hqCanAsk({ ...on, session: undefined }), true, 'au lancement : on demande, l’extension dira no_session')
  assert.equal(hqCanAsk({ ...on, session: null }), false)
  assert.equal(hqCanAsk({ ...on, availability: 'absent' }), false)
})

test('codecs : H.264 toujours, HEVC et AV1 seulement décodés en matériel', async () => {
  const env = (hw, supported = ['av01', 'hvc1']) => ({
    MediaSource: { isTypeSupported: (type) => type.includes('avc1') || supported.some((c) => type.includes(c)) },
    navigator: { mediaCapabilities: { decodingInfo: async ({ video }) => {
      const fam = video.contentType.includes('av01') ? 'av1' : 'h265'
      return { supported: true, smooth: true, powerEfficient: hw.includes(fam) }
    } } },
  })
  assert.deepEqual(await detectCodecs(env(['av1', 'h265'])), ['av1', 'h265', 'h264'])
  assert.deepEqual(await detectCodecs(env(['h265'])), ['h265', 'h264'], 'AV1 en logiciel : non')
  assert.deepEqual(await detectCodecs(env(['av1', 'h265'], ['av01'])), ['av1', 'h264'], 'refusé par MediaSource : non')
  assert.deepEqual(await detectCodecs({}), ['h264'], 'rien pour vérifier : H.264')
  const throwing = { MediaSource: { isTypeSupported: () => true }, navigator: { mediaCapabilities: { decodingInfo: async () => { throw new Error('x') } } } }
  assert.deepEqual(await detectCodecs(throwing), ['h264'])
  assert.equal(codecLabel(['av1', 'h265', 'h264']), 'H.264 · HEVC · AV1')
  assert.equal(codecLabel(['h264']), 'H.264')
  assert.equal(videoFamily('avc1.64002A,mp4a.40.2'), 'h264')
  assert.equal(videoFamily('hev1.1.6.L150.90,mp4a.40.2'), 'h265')
  assert.equal(videoFamily('av01.0.12M.08,mp4a.40.2'), 'av1')
  assert.equal(videoFamily('mp4a.40.2'), 'audio')
  assert.equal(videoFamily('vp09.00.10.08'), null)
})

// ── Liste du compte → lecteur ───────────────────────────────────────────────
test('liste du compte : gardée seulement au-dessus de 1080p, noms du menu, Auto', () => {
  const hq = buildHq(VARIANTS, ALL, { canPlay: yes })
  assert.equal(hq.top, 1440)
  assert.equal(hq.topId, ID(1))
  assert.deepEqual(Object.keys(hq.links), ['Auto', '1440p60 (Source)', '1080p60 HEVC', '1080p60', '720p60', 'audio_only'])
  assert.ok(isHqUrl(hq.links.Auto) && hq.links.Auto.startsWith('tuhq://m/'))
  assert.equal(hq.links['1440p60 (Source)'], `tuhq://v/${ID(1)}`)
  assert.deepEqual(hq.variants['1440p60 (Source)'], { h: 1440, fps: 60, bw: 9_500_000 })
  assert.deepEqual(hq.variants.audio_only, { h: 0, fps: 0, bw: 160_000 })
  // Liste maîtresse d'« Auto » : la vidéo, de la plus haute à la plus basse.
  const lines = hq.master.trim().split('\n')
  assert.equal(lines[0], '#EXTM3U')
  assert.equal(lines[1], '#EXT-X-STREAM-INF:BANDWIDTH=9500000,RESOLUTION=2560x1440,CODECS="hvc1.1.2.L150.90.0.0.0.0.0,mp4a.40.2",FRAME-RATE=60.000')
  assert.equal(lines[2], `tuhq://v/${ID(1)}`)
  assert.equal(lines.filter((l) => l.startsWith('tuhq://v/')).length, 4, 'sans l’audio seul')
  assert.ok(!hq.master.includes('http'), 'aucune adresse réseau')

  // Navigateur sans HEVC : la 1440p HEVC ne compte pas, rien au-dessus de 1080p.
  assert.equal(buildHq(VARIANTS, ['h264'], { canPlay: yes }), null)
  // HEVC annoncé, mais MediaSource refuse ce profil précis.
  assert.equal(buildHq(VARIANTS, ALL, { canPlay: (type) => !type.includes('L150') }), null)
  // Rien au-dessus de 1080p : la source habituelle suffit.
  assert.equal(buildHq(VARIANTS.slice(2), ALL, { canPlay: yes }), null)
  // Un original en 1080p avec une 1440p : « 1080p60 (Source) » n'est pas gardée au-dessus.
  const h264Only = buildHq([{ ...VARIANTS[0], codecs: 'avc1.640033,mp4a.40.2' }, VARIANTS[3]], ['h264'], { canPlay: yes })
  assert.deepEqual(Object.keys(h264Only.links), ['Auto', '1440p60 (Source)', '720p60'])
})

test('pause pub au bord de la playlist : secondes à attendre', () => {
  const seg = (iso, n) => [`#EXT-X-PROGRAM-DATE-TIME:${iso}`, ...Array.from({ length: n }, (_, i) => `#EXTINF:2.000,live\nhttps://v.hls.ttvnw.net/v1/segment/${i}.ts`)]
  const play = (lines) => ['#EXTM3U', '#EXT-X-TARGETDURATION:6', ...lines].join('\n')
  // 10 segments de 2 s à partir de 17:00:00 : bord à 17:00:20.
  const base = seg('2026-10-25T17:00:00.000Z', 10)
  assert.equal(edgeAdWait(play(base)), 0, 'sans pub')
  const ad = (start, extra) => `#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="${start}"${extra}`
  // Pub de 30 s commencée à 17:00:10 : finit à 17:00:40, plus la marge (12 s) : 32 s après le bord.
  assert.equal(edgeAdWait(play([ad('2026-10-25T17:00:10.000Z', ',DURATION=30.000'), ...base])), 40 + EDGE_WINDOW - 20)
  // Finie depuis longtemps : 0.
  assert.equal(edgeAdWait(play([ad('2026-10-25T16:58:00.000Z', ',DURATION=30.000'), ...base])), 0)
  // Sans durée : 30 s ; durée folle : 200 s au plus.
  assert.equal(edgeAdWait(play([ad('2026-10-25T17:00:10.000Z', ''), ...base])), 32)
  assert.equal(edgeAdWait(play([ad('2026-10-25T17:00:10.000Z', ',DURATION=9000'), ...base])), 210 + EDGE_WINDOW - 20)
  // END-DATE plutôt que DURATION ; et « X-…-DURATION » ne compte pas.
  assert.equal(edgeAdWait(play([ad('2026-10-25T17:00:10.000Z', ',END-DATE="2026-10-25T17:00:25.000Z"'), ...base])), 25 + EDGE_WINDOW - 20)
  assert.equal(edgeAdWait(play([ad('2026-10-25T17:00:10.000Z', ',X-TV-TWITCH-AD-POD-FILLED-DURATION=90,DURATION=5'), ...base])), 15 + EDGE_WINDOW - 20)
  // Une autre classe : rien.
  assert.equal(edgeAdWait(play(['#EXT-X-DATERANGE:ID="m",CLASS="twitch-maf-ad",START-DATE="2026-10-25T17:00:10.000Z",DURATION=30', ...base])), 0)
  assert.equal(edgeAdWait(null), null)
  assert.equal(edgeAdWait('<html>'), null)
})

// ── Lecture par le compte (HqLive) ──────────────────────────────────────────
/** Faux lecteur : ce que hq.js en utilise. */
function fakePlayer() {
  const p = {
    quality: null, liveSource: null, swaps: [], forgets: 0, ad: 0,
    video: { paused: false },
    swapLinks(links) {
      p.swaps.push(Object.keys(links)[1] ?? Object.keys(links)[0])
      p.links = links
      if (!Object.hasOwn(links, p.quality)) p.quality = Object.keys(links).find((k) => /source/i.test(k)) ?? Object.keys(links)[0]
    },
    forgetAdBreaks() { p.forgets++ },
    setLiveSource(id) { p.liveSource = id },
    adBreakLeft: () => p.ad,
  }
  return p
}

const AD_FREE = { links: { Auto: 'https://w/a', Source: 'https://w/s', '720p60': 'https://w/7' }, variants: { Source: { h: 1080, fps: 60, bw: 6e6 } }, source: 'as' }
const CLEAN = '#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:2026-10-25T17:00:00.000Z\n#EXTINF:2.000,live\nhttps://v.hls.ttvnw.net/v1/segment/1.ts\n'
const adAtEdge = (seconds) => {
  const d = new Date(Date.parse('2026-10-25T17:00:00.000Z'))
  return `#EXTM3U\n#EXT-X-DATERANGE:ID="a",CLASS="twitch-stitched-ad",START-DATE="${d.toISOString()}",DURATION=${seconds}\n` +
    `#EXT-X-PROGRAM-DATE-TIME:${d.toISOString()}\n#EXTINF:2.000,live\nhttps://v.hls.ttvnw.net/v1/segment/1.ts\n`
}

function setup({ adFree = AD_FREE, edge = CLEAN, refresh } = {}) {
  const clock = fakeClock()
  const player = fakePlayer()
  const notes = []
  const asked = []
  const state = { edge, settled: 0 }
  const hq = buildHq(VARIANTS, ALL, { canPlay: yes })
  const live = new HqLive({
    hq,
    adFree,
    player,
    playlist: async (id) => {
      asked.push(id)
      if (state.edge instanceof Error) throw state.edge
      return state.edge
    },
    notify: (text) => notes.push(text),
    t: (key, params) => `${key}:${params?.q ?? ''}`,
    qualityText: (k) => String(k),
    refreshAdFree: refresh,
    onSettle: () => { state.settled++ },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
  })
  // Lancement, comme main.js : player.load avec ce que dit current().
  const start = async () => {
    const ok = await live.prepare()
    if (ok) player.swapLinks(live.current().links, live.current().variants)
    player.swaps.length = 0
    return ok
  }
  return { clock, player, notes, asked, state, hq, live, start }
}

test('lancement : flux du compte si son bord est sans pub ; sinon la source sans pub d’abord, puis le compte', async () => {
  const a = setup()
  assert.equal(await a.start(), true)
  assert.equal(a.live.onHq, true)
  assert.equal(a.live.sourceId(), 'account')
  assert.deepEqual(a.asked, [ID(1)], 'la meilleure variante, une fois')

  const b = setup({ edge: adAtEdge(30) })
  assert.equal(await b.start(), true)
  assert.equal(b.live.onHq, false, 'pré-roll : la source sans pub d’abord')
  assert.equal(b.live.current(), b.live.adFree)
  b.state.edge = CLEAN
  await b.clock.advance(60_000)
  assert.equal(b.live.onHq, true, 'retour au compte après la pub')
  assert.deepEqual(b.notes, ['hq_ad_back:1440p'])

  const c = setup({ edge: new Error('offline') })
  assert.equal(await c.start(), false, 'flux du compte injoignable : la source habituelle')

  // Twitch officiel comme source habituelle : des pubs aussi, pas de bascule.
  const d = setup({ adFree: { ...AD_FREE, source: 'twitch' }, edge: adAtEdge(30) })
  assert.equal(await d.start(), true)
  assert.equal(d.live.onHq, true)
  assert.equal(d.asked.length, 0)
  d.live.onAdState(25)
  assert.equal(d.live.onHq, true, 'pause pub : on reste sur le compte (bandeau et son coupé)')
})

test('pause pub sur le flux du compte : source sans pub, avis, puis retour à la fin', async () => {
  const s = setup()
  await s.start()
  s.player.quality = '1440p60 (Source)'
  s.live.onAdState(30)
  assert.equal(s.live.onHq, false)
  assert.equal(s.player.forgets, 1, 'pauses du compte oubliées')
  assert.equal(s.player.liveSource, 'as')
  assert.equal(s.player.quality, 'Source', 'la qualité la plus proche de la source habituelle')
  assert.deepEqual(s.notes, ['hq_ad_fallback:1080p'])
  // Pendant la pause : pub encore au bord du flux du compte → on attend.
  s.state.edge = adAtEdge(60)
  await s.clock.advance(32_000)
  assert.equal(s.live.onHq, false)
  s.state.edge = CLEAN
  await s.clock.advance(31_000)
  assert.equal(s.live.onHq, true)
  assert.equal(s.player.liveSource, 'account')
  assert.deepEqual(s.notes, ['hq_ad_fallback:1080p', 'hq_ad_back:1440p'])
  assert.equal(s.clock.pending(), 0)
})

test('pause de la chaîne sur la source sans pub : le retour l’attend', async () => {
  const s = setup()
  await s.start()
  s.live.onAdState(20)
  const before = s.asked.length
  s.live.onAdState(40)               // bandeau ouvert sur la source sans pub
  await s.clock.advance(22_000)
  assert.equal(s.asked.length, before, 'pas de vérification pendant sa pause')
  s.live.onAdState(0)
  await s.clock.advance(25_000)
  assert.equal(s.live.onHq, true)
})

test('pubs répétées, vérifications épuisées, flux injoignable : la source habituelle reste', async () => {
  // Deux pubs moins de 30 s après un retour : plus de retour.
  const a = setup()
  await a.start()
  for (let i = 0; i < 2; i++) {
    a.live.onAdState(10)
    await a.clock.advance(12_000)
    assert.equal(a.live.onHq, true, 'retour ' + (i + 1))
    await a.clock.advance(5_000)
  }
  a.live.onAdState(10)
  assert.equal(a.live.settled, true)
  assert.equal(a.state.settled, 1)
  assert.equal(a.live.current(), a.live.adFree)
  a.live.onAdState(0)
  a.live.onAdState(10)
  await a.clock.advance(60_000)
  assert.equal(a.player.liveSource, 'as', 'plus de bascule après coup')

  // Pub toujours au bord : 20 vérifications au plus.
  const b = setup()
  await b.start()
  b.live.onAdState(5)
  b.state.edge = adAtEdge(100_000)
  await b.clock.advance(30 * 60_000)
  assert.equal(b.live.settled, true)
  assert.ok(b.asked.length <= 22)

  // Flux du compte injoignable pendant la pause : la source sans pub reste.
  const c = setup()
  await c.start()
  c.live.onAdState(5)
  c.state.edge = new Error('timeout')
  await c.clock.advance(10_000)
  assert.equal(c.live.settled, true)
  assert.equal(c.live.current(), c.live.adFree)
})

test('lecture en pause : pas de bascule ; la reprise s’en charge', async () => {
  const s = setup()
  await s.start()
  s.player.video.paused = true
  s.live.onAdState(30)
  assert.equal(s.live.onHq, true, 'la bascule relancerait la lecture')
  s.player.video.paused = false
  s.player.ad = 25
  s.live.onPlay()
  assert.equal(s.live.onHq, false)
  // En pause pendant la pause pub : les vérifications s'arrêtent, et reprennent.
  s.player.video.paused = true
  await s.clock.advance(60_000)
  assert.equal(s.live.onHq, false)
  const asked = s.asked.length
  s.player.video.paused = false
  s.live.onPlay()
  await s.clock.advance(2_000)
  assert.equal(s.live.onHq, true)
  assert.equal(s.asked.length, asked + 1)
})

test('erreur fatale : sur le compte, la source habituelle pour de bon ; sur la source sans pub, ses secours', async () => {
  const s = setup()
  await s.start()
  assert.equal(s.live.onFatal(), true)
  assert.equal(s.live.settled, true)
  assert.deepEqual(s.player.swaps, ['Source'])
  assert.equal(s.live.onFatal(), false)
  const b = setup()
  await b.start()
  b.live.onAdState(30)
  assert.equal(b.live.onFatal(), false, 'source sans pub : relances et autres Workers habituels')
})

test('source habituelle relue ailleurs, ou trop ancienne au moment d’une pub', async () => {
  const s = setup()
  await s.start()
  const fresh = { links: { Auto: 'https://w2/a', Source: 'https://w2/s' }, variants: {}, source: 'eu' }
  s.live.updateAdFree(fresh)
  assert.equal(s.player.swaps.length, 0, 'le compte joue : rien ne change à l’écran')
  s.live.onAdState(20)
  assert.equal(s.player.links, s.live.adFree.links)
  assert.equal(s.player.liveSource, 'eu')
  s.live.updateAdFree({ ...fresh, source: 'al' })
  assert.equal(s.player.liveSource, 'al', 'elle joue : relue tout de suite')

  // Liens de plus de 10 min : relus d'abord, la bascule suit.
  let asks = 0
  const r = setup({ refresh: async () => { asks++; return { links: { Source: 'https://w3/s' }, variants: {}, source: 'eu' } } })
  await r.start()
  await r.clock.advance(11 * 60_000)
  r.player.ad = 20
  r.live.onAdState(20)
  assert.equal(r.live.onHq, true, 'pas encore')
  await r.clock.advance(0)
  assert.equal(asks, 1)
  assert.equal(r.live.onHq, false)
  assert.equal(r.player.links.Source, 'https://w3/s')

  // Relecture ratée : la pub reste sur le compte, pas de nouvel essai avant une minute.
  let n = 0
  const f = setup({ refresh: async () => { n++; return null } })
  await f.start()
  await f.clock.advance(11 * 60_000)
  f.live.onAdState(20)
  await f.clock.advance(0)
  f.live.onAdState(20)
  await f.clock.advance(0)
  assert.equal(n, 1)
  assert.equal(f.live.onHq, true)
})

test('playlists du lecteur : Auto d’ici, variantes par l’extension ; fermé, plus rien', async () => {
  const s = setup()
  await s.start()
  assert.equal(await s.live.text(s.hq.links.Auto), s.hq.master)
  assert.equal(await s.live.text(`tuhq://v/${ID(3)}`), CLEAN)
  assert.equal(s.asked.at(-1), ID(3))
  await assert.rejects(s.live.text('https://euw31.playlist.ttvnw.net/v1/playlist/x.m3u8'))
  s.live.onAdState(30)
  assert.ok(s.clock.pending() > 0)
  s.live.destroy()
  assert.equal(s.clock.pending(), 0, 'retour annulé')
  await assert.rejects(s.live.text(s.hq.links.Auto))
  s.live.onAdState(0)
  s.live.onPlay()
  assert.equal(s.player.swaps.length, 1)
})
