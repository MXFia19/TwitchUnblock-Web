// Vérifications de la sonde « VOD sans son chez Twitch »
// (public/assets/js/silence.js), sans réseau : segments TS et fMP4 fabriqués
// ici, faux fetch. Lancer : node tools/silence-check.mjs (Node 22 ou plus).
// Sur de vraies VODs, par le CDN : node tools/silence-check.mjs --live <id>…
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SILENT_FRAME_BYTES, fmp4SampleSizes, probeVodSilence, silenceSegments, silenceTargets, silentVerdict, tsAudioFrameSizes,
} from '../public/assets/js/silence.js'

const live = process.argv.indexOf('--live')
if (live >= 0) {
  for (const id of process.argv.slice(live + 1)) {
    const r = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `query { video(id: "${id}") { owner { login } seekPreviewsURL } }` }),
    })
    const v = (await r.json())?.data?.video
    const parts = (v?.seekPreviewsURL ?? '').split('/')
    const i = parts.indexOf('storyboards')
    if (i < 0) { console.log(id, 'pas d’aperçu'); continue }
    const raw = `https://${new URL(v.seekPreviewsURL).host}/${parts[i - 1]}/chunked/index-dvr.m3u8`
    const t0 = Date.now()
    console.log(id, v.owner?.login, await probeVodSilence({ raw }), `${Date.now() - t0} ms`)
  }
  process.exit(0)
}

// ── Fabrication de segments ───────────────────────────────────────────────

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let k = 0
  for (const p of parts) { out.set(p, k); k += p.length }
  return out
}

/** Paquets TS de 188 octets (bourrage par le champ d'adaptation). */
function packets(pid, payload) {
  const out = []
  let rest = payload
  let first = true
  while (first || rest.length) {
    const p = new Uint8Array(188)
    p[0] = 0x47
    p[1] = (first ? 0x40 : 0) | ((pid >> 8) & 0x1f)
    p[2] = pid & 0xff
    if (rest.length >= 184) {
      p[3] = 0x10
      p.set(rest.subarray(0, 184), 4)
      rest = rest.subarray(184)
    } else {
      const stuff = 184 - rest.length
      p[3] = 0x30
      p[4] = stuff - 1
      if (stuff > 1) { p[5] = 0; p.fill(0xff, 6, 4 + stuff) }
      p.set(rest, 4 + stuff)
      rest = new Uint8Array(0)
    }
    out.push(p)
    first = false
  }
  return out
}

const adts = (size) => {
  const len = size + 7
  const f = new Uint8Array(len)
  f.set([0xff, 0xf1, 0x4c, 0x80 | ((len >> 11) & 3), (len >> 3) & 0xff, ((len & 7) << 5) | 0x1f, 0xfc])
  return f
}

/** Segment TS : PAT, PMT (AAC en 256, H.264 en 257 si `video`), puis les
 *  trames audio par PES de 8 trames. `audioType` : autre type de piste. */
function tsSegment(frameSizes, { video = false, audioType = 0x0f } = {}) {
  const pat = Uint8Array.from([0, 0x00, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0x00, 0, 0, 0, 0])
  const es = [audioType, 0xe1, 0x00, 0xf0, 0x00, ...(video ? [0x1b, 0xe1, 0x01, 0xf0, 0x00] : [])]
  const pmt = Uint8Array.from([0, 0x02, 0xb0, 9 + es.length + 4, 0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0x00, ...es, 0, 0, 0, 0])
  const out = [...packets(0, pat), ...packets(0x1000, pmt)]
  for (let i = 0; i < frameSizes.length; i += 8) {
    const body = concat(...frameSizes.slice(i, i + 8).map(adts))
    const pes = concat(Uint8Array.from([0, 0, 1, 0xc0, 0, 0, 0x80, 0x80, 5, 0x21, 0, 1, 0, 1]), body)
    out.push(...packets(256, pes))
    if (video) out.push(...packets(257, concat(Uint8Array.from([0, 0, 1, 0xe0, 0, 0, 0x80, 0, 0]), new Uint8Array(900))))
  }
  return concat(...out)
}

const u32 = (n) => Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
const box = (type, ...body) => {
  const inner = concat(...body)
  return concat(u32(inner.length + 8), new TextEncoder().encode(type), inner)
}

/** Début de segment fMP4 : styp, moof (une traf par piste), en-tête de mdat. */
function fmp4Segment(trackSizes, { defaultSize = 0 } = {}) {
  const trafs = trackSizes.map((sizes, t) => {
    const tfhd = defaultSize ? box('tfhd', u32(0x10), u32(t + 1), u32(defaultSize)) : box('tfhd', u32(0), u32(t + 1))
    const trun = defaultSize
      ? box('trun', u32(0x001), u32(sizes.length), u32(0))
      : box('trun', u32(0x301), u32(sizes.length), u32(0), ...sizes.flatMap((s) => [u32(1024), u32(s)]))
    return box('traf', tfhd, trun)
  })
  return concat(box('styp', new TextEncoder().encode('msdh')), box('moof', box('mfhd', u32(0), u32(1)), ...trafs), u32(1_000_000), new TextEncoder().encode('mdat'))
}

/** Segment fMP4 comme ceux de Twitch : un emsg, puis des fragments (moof +
 *  mdat) de `per` échantillons chacun. */
function fmp4Fragments(sizes, per = 5) {
  const out = [box('emsg', new Uint8Array(404))]
  for (let i = 0; i < sizes.length; i += per) {
    const part = sizes.slice(i, i + per)
    out.push(box('moof', box('mfhd', u32(0), u32(i / per + 1)),
      box('traf', box('tfhd', u32(0x20000), u32(1)), box('tfdt', u32(0), u32(i * 1024)),
        box('trun', u32(0x301), u32(part.length), u32(0), ...part.flatMap((s) => [u32(1024), u32(s)])))))
    out.push(box('mdat', new Uint8Array(part.reduce((n, s) => n + s, 0))))
  }
  return concat(...out)
}

const SILENT = Array(469).fill(6)
const SOUND = Array.from({ length: 469 }, (_, i) => 315 + ((i * 37) % 380))

// ── Adresses ──────────────────────────────────────────────────────────────

test('playlists sondées : audio seul puis l’original, d’après n’importe quelle qualité', () => {
  const root = 'https://d2vi6trrdongqn.cloudfront.net/abc_login_1_2'
  assert.deepEqual(silenceTargets(`${root}/720p60/index-dvr.m3u8`), [`${root}/audio_only/index-dvr.m3u8`, `${root}/chunked/index-dvr.m3u8`])
  assert.deepEqual(silenceTargets(`${root}/chunked/highlight-123.m3u8?x=1`), [`${root}/audio_only/highlight-123.m3u8`, `${root}/chunked/highlight-123.m3u8`])
  assert.deepEqual(silenceTargets('https://usher.ttvnw.net/vod/2928522226.m3u8?sig=1'), [])
  assert.deepEqual(silenceTargets('https://production.assets.clips.twitchcdn.net/abc.mp4'), [])
  assert.deepEqual(silenceTargets(undefined), [])
})

test('segments sondés : 10, 50 et 90 %, à côté des passages coupés', () => {
  const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:10']
  for (let i = 0; i < 100; i++) lines.push('#EXTINF:10.000,', i === 49 || i === 50 ? `${i}-muted.ts` : `${i}.ts`)
  const { urls, fmp4 } = silenceSegments(lines.join('\n'), 'https://cdn.example/f/audio_only/index-dvr.m3u8')
  assert.equal(fmp4, false)
  // 50 % tombe sur 49 (coupé) ; 50 l'est aussi : 48.
  assert.deepEqual(urls, ['https://cdn.example/f/audio_only/9.ts', 'https://cdn.example/f/audio_only/48.ts', 'https://cdn.example/f/audio_only/89.ts'])
  const proxied = 'https://w.example/api/proxy?url=https%3A%2F%2Fcdn.example%2Ff%2Faudio_only%2F0.mp4&isVod=true'
  const one = silenceSegments(`#EXTM3U\n#EXT-X-MAP:URI="init-0.mp4"\n#EXTINF:10.000,\n${proxied}\n#EXT-X-ENDLIST`, 'https://cdn.example/f/audio_only/index-dvr.m3u8')
  assert.equal(one.fmp4, true)
  assert.deepEqual(one.urls, [proxied])
  // Rien que des passages coupés : rien à sonder.
  assert.deepEqual(silenceSegments('#EXTINF:10,\n0-muted.ts\n#EXTINF:10,\n1-unmuted.ts', 'https://cdn.example/x/').urls, [])
})

// ── Trames ────────────────────────────────────────────────────────────────

test('TS : trames de silence (6 octets) ou de son, audio seul et original', () => {
  assert.deepEqual(tsAudioFrameSizes(tsSegment([6, 6, 23])), [6, 6, 23])
  assert.equal(silentVerdict(tsSegment(SILENT), false), true)
  assert.equal(silentVerdict(tsSegment(SOUND), false), false)
  assert.equal(silentVerdict(tsSegment(SILENT.slice(0, 120), { video: true }), false), true)
  assert.equal(silentVerdict(tsSegment(SOUND.slice(0, 120), { video: true }), false), false)
  // Quelques trames plus grosses au milieu du silence : muet quand même.
  assert.equal(silentVerdict(tsSegment(SILENT.map((s, i) => (i % 20 === 0 ? 23 : s))), false), true)
  assert.ok(SILENT_FRAME_BYTES >= 6 && SILENT_FRAME_BYTES < 128)
})

test('TS : illisible ou trop court → pas de verdict', () => {
  assert.equal(silentVerdict(tsSegment(SILENT.slice(0, 20)), false), null)
  assert.equal(silentVerdict(tsSegment(SILENT, { audioType: 0x81 }), false), null)
  assert.equal(silentVerdict(new Uint8Array(4096), false), null)
  assert.equal(silentVerdict(null, false), null)
})

test('TS lu en partie : la dernière trame coupée ne gêne pas', () => {
  const seg = tsSegment(SOUND)
  assert.equal(silentVerdict(seg.subarray(0, 64 * 1024 + 77), false), false)
})

test('fMP4 : tailles des échantillons de la seule piste, ou taille par défaut', () => {
  assert.deepEqual(fmp4SampleSizes(fmp4Segment([[6, 7, 23]])), [6, 7, 23])
  assert.equal(silentVerdict(fmp4Segment([SILENT]), true), true)
  assert.equal(silentVerdict(fmp4Segment([SOUND]), true), false)
  assert.equal(silentVerdict(fmp4Segment([SILENT], { defaultSize: 6 }), true), true)
  // Image et son mêlés (l'original) : on ne sait pas quelle piste lire.
  assert.equal(fmp4SampleSizes(fmp4Segment([SILENT, SOUND])), null)
  // moof coupée par la lecture partielle.
  const seg = fmp4Segment([SILENT])
  assert.equal(fmp4SampleSizes(seg.subarray(0, 200)), null)
})

test('octets abîmés au hasard : jamais d’exception ni de boucle sans fin', () => {
  let seed = 42n
  const next = () => { seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn; return Number(seed >> 17n) }
  const sources = [tsSegment(SILENT), tsSegment(SOUND.slice(0, 120), { video: true }), fmp4Fragments(SILENT), fmp4Segment([SOUND])]
  for (let round = 0; round < 300; round++) {
    const junk = sources[round % sources.length].slice()
    for (let k = 0; k < 40; k++) junk[next() % junk.length] = next() & 0xff
    // Une boîte trun qui annoncerait 4 milliards d'échantillons sans tailles.
    if (round % 7 === 0) junk.set(concat(u32(28), new TextEncoder().encode('trun'), u32(0x001), u32(0xffffffff), u32(0)), 0)
    for (const fmp4 of [false, true]) {
      const v = silentVerdict(junk, fmp4)
      assert.ok(v === true || v === false || v === null)
    }
  }
})

test('fMP4 de Twitch : fragments de 5 échantillons, additionnés sur le morceau lu', () => {
  const sound = fmp4Fragments(SOUND)
  assert.equal(fmp4SampleSizes(fmp4Fragments([400, 410, 420, 430, 440, 450])).length, 6)
  assert.equal(silentVerdict(sound.subarray(0, 64 * 1024), true), false)
  assert.equal(silentVerdict(fmp4Fragments(SILENT).subarray(0, 64 * 1024), true), true)
  // Le fragment coupé en fin de lecture est laissé de côté.
  const n = fmp4SampleSizes(sound.subarray(0, 64 * 1024)).length
  assert.ok(n >= 40 && n % 5 === 0 && n < SOUND.length)
})

// ── Parcours complet (faux fetch) ─────────────────────────────────────────

const ROOT = 'https://d2vi6trrdongqn.cloudfront.net/abc_login_1_2'
const playlist = (n, ext = 'ts') => ['#EXTM3U', ...(ext === 'mp4' ? ['#EXT-X-MAP:URI="init-0.mp4"'] : []),
  ...Array.from({ length: n }, (_, i) => [`#EXTINF:10.000,`, `${i}.${ext}`]).flat(), '#EXT-X-ENDLIST'].join('\n')

/** Faux CDN derrière un faux relais : `files` adresse directe → contenu. */
function fakeNet(files) {
  const calls = []
  const relay = 'https://relay.example'
  const wrap = (u) => `${relay}/api/proxy?url=${encodeURIComponent(u)}&isVod=true`
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, range: init.headers?.Range ?? null })
    const u = new URL(url)
    const direct = u.origin === relay ? u.searchParams.get('url') : null
    const body = direct ? files[direct] : undefined
    if (body === undefined) return new Response('', { status: 404 })
    if (typeof body === 'string') {
      // Le relais réécrit les segments en adresses relayées, comme le Worker.
      const text = body.split('\n').map((l) => (l && !l.startsWith('#') ? wrap(new URL(l, direct).href) : l)).join('\n')
      return new Response(text, { status: 200 })
    }
    return new Response(body, { status: 200 })
  }
  return { calls, wrap, fetchImpl }
}

test('VOD muette : silence aux trois points → « silent », par le relais, avec Range', async () => {
  const files = { [`${ROOT}/audio_only/index-dvr.m3u8`]: playlist(100) }
  for (let i = 0; i < 100; i++) files[`${ROOT}/audio_only/${i}.ts`] = tsSegment(SILENT)
  const net = fakeNet(files)
  assert.equal(await probeVodSilence({ raw: `${ROOT}/480p30/index-dvr.m3u8`, wrap: net.wrap, fetchImpl: net.fetchImpl }), 'silent')
  assert.equal(net.calls.length, 4)
  assert.ok(net.calls.every((c) => c.url.startsWith('https://relay.example/api/proxy?url=')))
  assert.deepEqual(net.calls.slice(1).map((c) => c.range), Array(3).fill('bytes=0-65535'))
})

test('du son à un seul des points → « sound », sans lire la suite', async () => {
  const files = { [`${ROOT}/audio_only/index-dvr.m3u8`]: playlist(100) }
  for (let i = 0; i < 100; i++) files[`${ROOT}/audio_only/${i}.ts`] = tsSegment(i === 9 ? SOUND : SILENT)
  const net = fakeNet(files)
  assert.equal(await probeVodSilence({ raw: `${ROOT}/chunked/index-dvr.m3u8`, wrap: net.wrap, fetchImpl: net.fetchImpl }), 'sound')
  assert.equal(net.calls.length, 2)
})

test('sans « audio seul » : l’original (TS), lu sur 1 Mo', async () => {
  const files = { [`${ROOT}/chunked/index-dvr.m3u8`]: playlist(30) }
  for (let i = 0; i < 30; i++) files[`${ROOT}/chunked/${i}.ts`] = tsSegment(SILENT.slice(0, 120), { video: true })
  const net = fakeNet(files)
  assert.equal(await probeVodSilence({ raw: `${ROOT}/720p60/index-dvr.m3u8`, wrap: net.wrap, fetchImpl: net.fetchImpl }), 'silent')
  assert.equal(net.calls.at(-1).range, 'bytes=0-1048575')
})

test('fMP4 : audio seul lu ; original en fMP4 jamais jugé', async () => {
  const files = { [`${ROOT}/audio_only/index-dvr.m3u8`]: playlist(50, 'mp4') }
  for (let i = 0; i < 50; i++) files[`${ROOT}/audio_only/${i}.mp4`] = fmp4Segment([SILENT])
  let net = fakeNet(files)
  assert.equal(await probeVodSilence({ raw: `${ROOT}/chunked/index-dvr.m3u8`, wrap: net.wrap, fetchImpl: net.fetchImpl }), 'silent')
  const only = { [`${ROOT}/chunked/index-dvr.m3u8`]: playlist(50, 'mp4') }
  net = fakeNet(only)
  assert.equal(await probeVodSilence({ raw: `${ROOT}/chunked/index-dvr.m3u8`, wrap: net.wrap, fetchImpl: net.fetchImpl }), 'unknown')
  assert.equal(net.calls.length, 2)
})

test('rien de lisible, adresse inconnue ou réseau en panne → « unknown »', async () => {
  const files = { [`${ROOT}/audio_only/index-dvr.m3u8`]: playlist(10) }
  for (let i = 0; i < 10; i++) files[`${ROOT}/audio_only/${i}.ts`] = new Uint8Array(5000)
  const net = fakeNet(files)
  assert.equal(await probeVodSilence({ raw: `${ROOT}/chunked/index-dvr.m3u8`, wrap: net.wrap, fetchImpl: net.fetchImpl }), 'unknown')
  assert.equal(await probeVodSilence({ raw: 'https://usher.ttvnw.net/vod/1.m3u8', fetchImpl: net.fetchImpl }), 'unknown')
  assert.equal(await probeVodSilence({ raw: `${ROOT}/chunked/index-dvr.m3u8`, fetchImpl: async () => { throw new Error('hors ligne') } }), 'unknown')
})

test('VOD courte (un segment) : un seul point suffit', async () => {
  const files = { [`${ROOT}/audio_only/index-dvr.m3u8`]: playlist(1), [`${ROOT}/audio_only/0.ts`]: tsSegment(SILENT) }
  const net = fakeNet(files)
  assert.equal(await probeVodSilence({ raw: `${ROOT}/chunked/index-dvr.m3u8`, wrap: net.wrap, fetchImpl: net.fetchImpl }), 'silent')
})
