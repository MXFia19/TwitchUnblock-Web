// ═══════════════════════════════════════════════════════════════════════════
//  Direct par le compte (session web de l'iPhone, websession.js) : lecture
//  du jeton de lecture, adresse d'usher, liste maîtresse → liens du lecteur.
//  Comme l'app iPhone (TwitchAPI.swift : accountPlaybackToken,
//  usherLiveURL) et le Worker (worker.js : variantName, variantInfo,
//  parseAndProxyM3U8), pour que les qualités portent les mêmes noms qu'avec
//  les autres sources (qualité préférée, menu du lecteur).
//  Rien ici ne touche au réseau : tools/pair-check.mjs le charge dans Node.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce que Twitch a écrit dans un jeton de lecture de direct (`value`, un
 * JSON) : { anonymous, adFree, subscriber, turbo, hideAds, showAds,
 * forbidden, geo, maxResolution }. `adFree` : Twitch ne servira pas de pub à
 * ce jeton (abonné, ou Turbo si la chaîne l'accepte) — `hide_ads`, ou
 * `show_ads` faux ; jamais déduit de `turbo` seul (une chaîne peut refuser
 * Turbo, et le jeton recevrait de vraies pubs). `anonymous` : pas de
 * `user_id` (session refusée ou ignorée).
 */
export function readPlaybackToken(value) {
  let f = {}
  try { f = JSON.parse(value) || {} } catch { f = {} }
  const bool = (v) => (typeof v === 'boolean' ? v : null)
  const auth = f.authorization && typeof f.authorization === 'object' ? f.authorization : {}
  const reason = typeof auth.reason === 'string' ? auth.reason : ''
  const geo = (typeof f.geoblock_reason === 'string' && f.geoblock_reason)
    || (auth.forbidden === true && /geo|region/i.test(reason) ? reason : '')
  return {
    anonymous: !/"user_id":\d/.test(String(value)),
    hideAds: bool(f.hide_ads),
    showAds: bool(f.show_ads),
    subscriber: bool(f.subscriber),
    turbo: bool(f.turbo),
    adFree: f.hide_ads === true || f.show_ads === false,
    forbidden: auth.forbidden === true,
    geo,
    maxResolution: typeof f.maximum_resolution === 'string' ? f.maximum_resolution : '',
  }
}

const LOGIN_RE = /^[a-z0-9_]{1,25}$/

/** Liste maîtresse d'usher pour ce jeton (`{ value, signature }`), avec les
 *  paramètres de l'app iPhone ; null pour un nom de chaîne invalide. */
export function usherLiveUrl(login, token, { lowLatency = true } = {}) {
  const name = String(login || '').toLowerCase()
  if (!LOGIN_RE.test(name) || !token?.value || !token?.signature) return null
  const q = [
    ['allow_source', 'true'],
    ['allow_audio_only', 'true'],
    ['allow_spectre', 'true'],
    ['fast_bread', lowLatency ? 'true' : 'false'],
    ['low_latency', lowLatency ? 'true' : 'false'],
    ['player_backend', 'mediaplayer'],
    ['playlist_include_framerate', 'true'],
    ['segment_preference', '4'],
    ['sig', token.signature],
    ['token', token.value],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `https://usher.ttvnw.net/api/channel/hls/${name}.m3u8?${q}`
}

/** Lien du proxy (relais vidéo ou Worker, même route /api/proxy) pour une
 *  playlist de direct. */
export const proxyLink = (base, url) => `${base}/api/proxy?url=${encodeURIComponent(url)}&isVod=false`

// ── Noms des qualités (worker.js : variantName et voisines) ────────────────
function variantName(streamInf, sourceGroups, ivsSource) {
  const attr = (name) => (streamInf.match(new RegExp(`[:,]${name}="([^"]+)"`)) || [])[1]
  const name = attr('VIDEO') || attr('STABLE-VARIANT-ID') || attr('IVS-NAME') || ''
  const ivs = ivsSource && attr('IVS-VARIANT-SOURCE') === 'source' && /[:,]RESOLUTION=/.test(streamInf)
  return name === 'chunked' || sourceGroups.has(name) || ivs ? 'Source' : name
}

function singleIvsSource(lines) {
  return lines.filter((l) => l.startsWith('#EXT-X-STREAM-INF')
    && /[:,]IVS-VARIANT-SOURCE="source"/.test(l) && /[:,]RESOLUTION=/.test(l)).length <= 1
}

function sourceGroupsOf(lines) {
  const groups = new Set()
  for (const l of lines) {
    if (!l.startsWith('#EXT-X-MEDIA') || !/\(source\)/i.test(l)) continue
    const g = (l.match(/GROUP-ID="([^"]+)"/) || [])[1]
    if (g) groups.add(g)
  }
  return groups
}

const ORDER = ['Source', '1080p60', '1080p30', '720p60', '720p30', '480p30', '360p30', '160p30', 'audio_only']

/**
 * Liste maîtresse déjà réécrite par le proxy (chaque variante est un lien
 * /api/proxy absolu) → { links, variants }, comme /api/get-live du Worker :
 * « Auto » = la liste maîtresse elle-même (`masterUrl`), puis chaque qualité
 * sous son nom (Source, 1080p60…), et { h, fps, bw } par qualité.
 */
export function masterLinks(text, masterUrl) {
  const lines = String(text || '').split('\n').map((l) => l.trim())
  const sources = sourceGroupsOf(lines)
  const single = singleIvsSource(lines)
  const found = {}
  const variants = {}
  let last = null
  for (const l of lines) {
    if (l.startsWith('#EXT-X-STREAM-INF')) {
      const name = variantName(l, sources, single)
      const num = (re) => Number((l.match(re) || [])[1]) || 0
      last = name ? { name, info: { h: num(/[:,]RESOLUTION=\d+x(\d+)/), fps: Math.round(num(/[:,]FRAME-RATE=([\d.]+)/)), bw: num(/[:,]BANDWIDTH=(\d+)/) } } : null
    } else if (l.startsWith('http') && last) {
      found[last.name] = l
      variants[last.name] = last.info
      last = null
    }
  }
  const links = { Auto: masterUrl }
  for (const key of ORDER) {
    for (const k of Object.keys(found)) {
      if (k.toLowerCase().includes(key.toLowerCase())) { links[k] = found[k]; delete found[k] }
    }
  }
  Object.assign(links, found)
  return { links, variants }
}
