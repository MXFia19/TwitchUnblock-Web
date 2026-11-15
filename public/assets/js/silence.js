// ═══════════════════════════════════════════════════════════════════════════
//  VOD sans son chez Twitch.
//
//  Certaines chaînes n'enregistrent qu'une piste audio vide dans leurs VODs
//  (sans doute la piste VOD d'OBS, activée sans source) : du silence d'un
//  bout à l'autre, sur twitch.tv aussi, et rien à récupérer sur le CDN. Pour
//  le dire au lieu de laisser croire à une panne, on lit le début de trois
//  segments de « audio seul », à 10, 50 et 90 % de la VOD, et on mesure leurs
//  trames audio : le silence encodé tient en 6 octets par trame, le son en
//  300 à 700 (160 kb/s). Le 160p et le 360p, à débit constant (128 et 170
//  octets par trame, son ou pas), ne disent rien : « audio seul » d'abord,
//  l'original (chunked) s'il n'y en a pas. TS : trames ADTS ; fMP4 : tailles
//  des échantillons (boîte trun), « audio seul » seulement — l'original y
//  mêle image et son.
//  Mêmes seuils dans l'app iPhone (VodSilence.swift) et sur Android.
// ═══════════════════════════════════════════════════════════════════════════

/** Trame audio de cette taille ou moins : du silence (6 octets en AAC). */
export const SILENT_FRAME_BYTES = 12
/** Trames à lire au moins pour juger un segment. */
const MIN_FRAMES = 40
/** Début de segment lu : ~140 trames de son en TS « audio seul », toute la
 *  boîte moof en fMP4. L'original mêle l'image : il en faut bien plus. */
const PROBE_BYTES = 64 * 1024
const SOURCE_PROBE_BYTES = 1024 * 1024
const POINTS = [0.1, 0.5, 0.9]
/** Passages coupés par Twitch (musique protégée) : muets exprès. */
const MUTED_SEG = /-(un)?muted\.(ts|mp4)/

/** Playlists « audio seul » puis originale d'une VOD, d'après l'adresse
 *  directe d'une de ses qualités (…/<qualité>/index-dvr.m3u8, ou
 *  highlight-<id>.m3u8). Vide pour une autre adresse (liste maîtresse, clip). */
export function silenceTargets(raw) {
  const m = /^(https:\/\/[^?#]+\/)[^/?#]+\/((?:index-dvr|highlight-\d+)\.m3u8)(?:[?#].*)?$/.exec(raw || '')
  return m ? ['audio_only', 'chunked'].map((q) => `${m[1]}${q}/${m[2]}`) : []
}

/** Segments à sonder : à 10, 50 et 90 % de la playlist, à côté des passages
 *  coupés s'il le faut. Adresses absolues (relatives à `playlistUrl`). */
export function silenceSegments(text, playlistUrl) {
  const lines = String(text || '').split('\n').map((l) => l.trim())
  const segs = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXTINF') && lines[i + 1] && !lines[i + 1].startsWith('#')) segs.push(lines[i + 1])
  }
  const plain = (i) => i >= 0 && i < segs.length && !MUTED_SEG.test(segs[i])
  const picked = new Set()
  for (const p of POINTS) {
    const at = Math.floor(p * (segs.length - 1))
    for (let d = 0; d <= 5; d++) {
      if (plain(at + d)) { picked.add(at + d); break }
      if (plain(at - d)) { picked.add(at - d); break }
    }
  }
  const urls = []
  for (const i of [...picked].sort((a, b) => a - b)) {
    try { urls.push(new URL(segs[i], playlistUrl).href) } catch {}
  }
  return { urls, fmp4: lines.some((l) => l.startsWith('#EXT-X-MAP')) }
}

/** Tailles des trames audio (en-tête ADTS ôté) d'un début de segment TS ;
 *  null sans piste AAC lisible. */
export function tsAudioFrameSizes(b) {
  if (!b || b.length < 376 || b[0] !== 0x47) return null
  let pmt = -1, audio = -1, started = false
  const parts = []
  for (let o = 0; o + 188 <= b.length; o += 188) {
    if (b[o] !== 0x47) break
    const pusi = (b[o + 1] & 0x40) !== 0
    const pid = ((b[o + 1] & 0x1f) << 8) | b[o + 2]
    const afc = (b[o + 3] >> 4) & 3
    let p = o + 4
    if (afc & 2) p += 1 + b[o + 4]
    if (!(afc & 1) || p >= o + 188) continue
    if (pid === 0 && pusi) {
      // Table des programmes : où lire la table du programme (PMT).
      const t = p + 1 + b[p]
      const end = Math.min(o + 188, t + 3 + (((b[t + 1] & 0x0f) << 8) | b[t + 2]) - 4)
      for (let i = t + 8; i + 4 <= end; i += 4) {
        if (((b[i] << 8) | b[i + 1]) !== 0) { pmt = ((b[i + 2] & 0x1f) << 8) | b[i + 3]; break }
      }
    } else if (pid === pmt && pusi && audio < 0) {
      // Pistes du programme : la première en AAC (type 0x0f).
      const t = p + 1 + b[p]
      const end = Math.min(o + 188, t + 3 + (((b[t + 1] & 0x0f) << 8) | b[t + 2]) - 4)
      for (let i = t + 12 + (((b[t + 10] & 0x0f) << 8) | b[t + 11]); i + 5 <= end; i += 5 + (((b[i + 3] & 0x0f) << 8) | b[i + 4])) {
        if (b[i] === 0x0f) { audio = ((b[i + 1] & 0x1f) << 8) | b[i + 2]; break }
      }
    } else if (pid === audio) {
      if (pusi) {
        if (b[p] === 0 && b[p + 1] === 0 && b[p + 2] === 1) {
          const h = p + 9 + b[p + 8]
          if (h < o + 188) parts.push(b.subarray(h, o + 188))
          started = true
        }
      } else if (started) {
        parts.push(b.subarray(p, o + 188))
      }
    }
  }
  if (audio < 0) return null
  let total = 0
  for (const x of parts) total += x.length
  const es = new Uint8Array(total)
  let k = 0
  for (const x of parts) { es.set(x, k); k += x.length }
  const sizes = []
  for (let i = 0; i + 7 <= es.length;) {
    if (es[i] !== 0xff || (es[i + 1] & 0xf6) !== 0xf0) { i++; continue }
    const len = ((es[i + 3] & 0x03) << 11) | (es[i + 4] << 3) | (es[i + 5] >> 5)
    if (len < 7) { i++; continue }
    sizes.push(len - ((es[i + 1] & 1) ? 7 : 9))
    i += len
  }
  return sizes
}

/** Tailles des échantillons d'un début de segment fMP4 à une seule piste
 *  (« audio seul ») : moof → traf → tfhd / trun, pour chaque fragment entier
 *  du morceau lu (Twitch en met des dizaines par segment, de 5 échantillons
 *  chacun). null si rien de lisible ou s'il y a plusieurs pistes. */
export function fmp4SampleSizes(b) {
  if (!b || b.length < 16) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const boxes = (start, end) => {
    const out = []
    for (let o = start; o + 8 <= end;) {
      let size = dv.getUint32(o)
      let hdr = 8
      if (size === 1) {
        if (o + 16 > end) break
        size = Number(dv.getBigUint64(o + 8))
        hdr = 16
      } else if (size === 0) {
        size = end - o
      }
      // Boîte qui déborde (lecture partielle) : la liste s'arrête là.
      if (size < hdr || o + size > end) break
      out.push({ type: String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]), body: o + hdr, end: o + size })
      o += size
    }
    return out
  }
  const sizes = []
  for (const moof of boxes(0, b.length)) {
    if (moof.type !== 'moof' || moof.end > b.length) continue
    const trafs = boxes(moof.body, moof.end).filter((x) => x.type === 'traf')
    if (trafs.length !== 1) return null
    let def = 0
    for (const x of boxes(trafs[0].body, trafs[0].end)) {
      if (x.body + 8 > x.end) continue
      const flags = dv.getUint32(x.body) & 0xffffff
      if (x.type === 'tfhd') {
        let q = x.body + 8
        if (flags & 0x01) q += 8
        if (flags & 0x02) q += 4
        if (flags & 0x08) q += 4
        if (flags & 0x10 && q + 4 <= x.end) def = dv.getUint32(q)
      } else if (x.type === 'trun') {
        // Plafonné : une boîte abîmée annoncerait des milliards
        // d'échantillons (taille par défaut, sans rien à lire).
        const count = Math.min(dv.getUint32(x.body + 4), 100000)
        let q = x.body + 8
        if (flags & 0x01) q += 4
        if (flags & 0x04) q += 4
        for (let i = 0; i < count; i++) {
          if (flags & 0x100) q += 4
          if (flags & 0x200) {
            if (q + 4 > x.end) break
            sizes.push(dv.getUint32(q))
            q += 4
          } else {
            sizes.push(def)
          }
          if (flags & 0x400) q += 4
          if (flags & 0x800) q += 4
        }
      }
    }
  }
  return sizes.length ? sizes : null
}

/** true : segment muet ; false : du son ; null : illisible ou trop court. */
export function silentVerdict(bytes, fmp4) {
  const sizes = fmp4 ? fmp4SampleSizes(bytes) : tsAudioFrameSizes(bytes)
  if (!sizes || sizes.length < MIN_FRAMES) return null
  return sizes.filter((s) => s <= SILENT_FRAME_BYTES).length >= sizes.length * 0.9
}

/** Les `n` premiers octets d'une réponse, sans lire la suite (un relais qui
 *  ignorerait Range enverrait tout le segment). */
async function readUpTo(res, n) {
  const reader = res.body?.getReader?.()
  if (!reader) return new Uint8Array(await res.arrayBuffer()).subarray(0, n)
  const chunks = []
  let got = 0
  try {
    while (got < n) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(Math.min(got, n))
  let k = 0
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - k)
    out.set(c.subarray(0, take), k)
    k += take
    if (k >= out.length) break
  }
  return out
}

/** 'silent' (piste audio vide chez Twitch), 'sound', ou 'unknown' (rien de
 *  lisible). `raw` : adresse directe d'une qualité de la VOD ; `wrap` fait
 *  passer une adresse du CDN par le même relais que le lecteur (le CDN
 *  n'autorise que twitch.tv à le lire depuis une page). */
export async function probeVodSilence({ raw, wrap = (u) => u, fetchImpl = fetch } = {}) {
  for (const target of silenceTargets(raw)) {
    const source = target.includes('/chunked/')
    let text
    try {
      const res = await fetchImpl(wrap(target))
      if (!res.ok) continue
      text = await res.text()
    } catch {
      continue
    }
    const { urls, fmp4 } = silenceSegments(text, target)
    if (!urls.length || (source && fmp4)) continue
    const bytes = source ? SOURCE_PROBE_BYTES : PROBE_BYTES
    const verdicts = []
    for (const u of urls) {
      let v = null
      try {
        const res = await fetchImpl(u.includes('/api/proxy?') ? u : wrap(u), { headers: { Range: `bytes=0-${bytes - 1}` } })
        if (res.ok) v = silentVerdict(await readUpTo(res, bytes), fmp4)
      } catch {}
      if (v === false) return 'sound'
      verdicts.push(v)
    }
    const silent = verdicts.filter((v) => v === true).length
    if (silent > 0 && silent >= Math.min(2, urls.length)) return 'silent'
  }
  return 'unknown'
}
