// ═══════════════════════════════════════════════════════════════════════════
//  Session web Twitch reçue de l'iPhone (pairing.js : le protocole ; le
//  Worker : /api/pair) : ce que la TV en fait.
//
//  - Gardée sur cette TV seulement (localStorage « tu_tv_websession »), à
//    part des réglages, jamais au journal, envoyée seulement à Twitch (GQL,
//    en-tête Authorization). « Oublier la session » l'efface
//    (forgetWebSession), avec l'identifiant d'appareil qui l'accompagnait.
//    Elle n'est pas révoquée chez Twitch : c'est celle de l'iPhone, qui
//    serait déconnecté avec.
//  - Direct sans pub des chaînes où ce compte est abonné (ou Turbo, si la
//    chaîne l'accepte) : accountLive, avant les sources habituelles, comme
//    l'app iPhone (TwitchAPI.swift : accountPlaybackToken, usherLiveLinks).
//    Jamais pour un compte qui aurait des pubs : il en recevrait de vraies.
//    Twitch exige un jeton d'intégrité ou refuse : sources habituelles, et
//    une ligne au journal.
//  - Chaînes suivies du compte (GQL currentUser) : followedLiveByWebSession,
//    mêlées sur l'accueil à celles de la TV.
//  - Points de chaîne et série de visionnage pendant un direct
//    (livepoints.js, points.js) : leurs requêtes au nom du compte passent
//    par accountGql, l'identifiant du compte par webSessionUserId.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../public/assets/js/api.js'
import { logError } from '../../public/assets/js/errlog.js'
import { PAIR_POLL_MS, forgetPairing, newPairing, openBlob } from './pairing.js'
import { masterLinks, proxyLink, readPlaybackToken, usherLiveUrl } from './playback.js'

const KEY = 'tu_tv_websession'
const DEVICE_KEY = 'tu_tv_device_id'
const GQL_URL = 'https://gql.twitch.tv/gql'
/** La session est revérifiée chez Twitch au plus toutes les 12 h. */
const CHECK_MS = 12 * 3600_000
const LOGIN_RE = /^[a-z0-9_]{1,25}$/
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    // userId vide : pas encore relu chez Twitch (voir saveWebSession).
    if (s && TOKEN_RE.test(s.token) && LOGIN_RE.test(s.login) && /^(\d{1,20})?$/.test(s.userId ?? '')) return s
  } catch {}
  return null
}

function store(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {}
}

/** Session web connectée : { token, login, userId, displayName, sentAt, at,
 *  checkedAt, expired } ; null sans session. Le jeton ne sort d'ici que
 *  vers Twitch. */
export let webSession = load()

const listeners = new Set()
/** Appelé à chaque session reçue, oubliée, refusée ou relue. */
export function onWebSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const changed = () => { for (const fn of listeners) { try { fn(webSession) } catch {} } }

/** Session ouverte par pairing.js (openBlob) : gardée, puis vérifiée chez
 *  Twitch en arrière-plan (currentUser), qui donne aussi l'identifiant et
 *  le nom quand l'iPhone n'a pas pu les lire (userId vide, nom = login). Une
 *  panne n'y change rien : la session reste, revérifiée au démarrage
 *  suivant. userId sert aux minutes regardées (webSessionUserId). */
export function saveWebSession(s) {
  webSession = {
    token: s.token, login: s.login, userId: s.userId || '', displayName: s.displayName || s.login,
    sentAt: s.sentAt ?? null, at: Date.now(), checkedAt: 0, expired: false,
  }
  store(webSession)
  changed()
  checkWebSession({ force: true }).catch(() => {})
}

/** « Oublier la session » : effacée de la mémoire et du stockage de la TV,
 *  avec l'identifiant d'appareil envoyé à Twitch avec elle. */
export function forgetWebSession() {
  if (webSession) webSession.token = ''
  webSession = null
  store(null)
  try { localStorage.removeItem(DEVICE_KEY) } catch {}
  changed()
}

function markExpired(s, why) {
  if (webSession !== s || s.expired) return
  s.expired = true
  store(s)
  logError('session', `Session web refusée par Twitch (${why}) : à reconnecter depuis l'iPhone`)
  changed()
}

/** Identifiant d'appareil des requêtes au nom du compte (X-Device-Id, comme
 *  l'app iPhone), tiré une fois. */
function deviceId() {
  let d = null
  try { d = localStorage.getItem(DEVICE_KEY) } catch {}
  if (!d || !/^[A-Za-z0-9]{32}$/.test(d)) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const r = new Uint8Array(32)
    crypto.getRandomValues(r)
    d = Array.from(r, (b) => chars[b % chars.length]).join('')
    try { localStorage.setItem(DEVICE_KEY, d) } catch {}
  }
  return d
}

/** fetch borné dans le temps (AbortSignal.timeout manque aux TV de 2021-2023). */
async function fetchTimeout(url, init, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Messages d'erreur GQL en une ligne courte, sans jamais le jeton. */
function errorsText(json, token) {
  const text = (Array.isArray(json?.errors) ? json.errors : []).map((e) => String(e?.message || '')).filter(Boolean).join(' · ')
  return (token ? text.split(token).join('…') : text).slice(0, 160)
}

/** Requête GQL au nom du compte : { status, json } (status 0 : réseau ou
 *  délai). 401 / 403 : la session est marquée refusée. */
const sessionGql = (query, variables, ms = 8000) => postGql(variables ? { query, variables } : { query }, ms, true)

/** Corps GQL quelconque (requête écrite, ou enregistrée en liste) envoyé au
 *  nom du compte, sans jeton d'intégrité. `expire` faux : un 401 / 403 ne
 *  marque pas la session refusée. */
async function postGql(payload, ms, expire) {
  const s = webSession
  if (!s?.token || s.expired) return { status: 0, json: null }
  let res
  try {
    res = await fetchTimeout(GQL_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Client-ID': api.GQL_CLIENT_ID,
        Authorization: `OAuth ${s.token}`,
        'X-Device-Id': deviceId(),
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body: JSON.stringify(payload),
    }, ms)
  } catch {
    return { status: 0, json: null }
  }
  // Session oubliée ou remplacée pendant la requête : sa réponse ne compte plus.
  if (webSession !== s) return { status: 0, json: null }
  if (res.status === 401 || res.status === 403) {
    if (expire) markExpired(s, `HTTP ${res.status}`)
    return { status: res.status, json: null }
  }
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json: Array.isArray(json) ? json[0] ?? null : json }
}

/**
 * Requête GQL au nom du compte, pour les points (points.js) : `body` est
 * { query, variables } ou une requête enregistrée en liste ([{
 * operationName, variables, extensions }], comme l'app iPhone). Rend {
 * status, json, errors } : json, le premier élément d'une réponse en liste ;
 * errors, les messages d'erreur de Twitch en une ligne, sans jamais le
 * jeton. `expire` faux (coffre, que Twitch peut refuser sans jeton
 * d'intégrité) : un 401 / 403 ne marque pas la session refusée — la lecture
 * suivante du solde le dira, si c'est elle.
 */
export async function accountGql(body, { ms = 8000, expire = true } = {}) {
  const s = webSession
  const r = await postGql(body, ms, expire)
  return { status: r.status, json: r.json, errors: errorsText(r.json, s?.token) }
}

let idAskedAt = 0
/** Identifiant Twitch du compte (user_id des minutes regardées) : relu chez
 *  Twitch s'il manque (l'iPhone n'a pas toujours pu le lire), au plus une
 *  fois toutes les 10 min. '' s'il reste inconnu. */
export async function webSessionUserId() {
  const s = webSession
  if (!s || s.expired) return ''
  if (!s.userId && Date.now() - idAskedAt > 600_000) {
    idAskedAt = Date.now()
    await checkWebSession({ force: true }).catch(() => {})
  }
  return webSession === s && !s.expired ? s.userId || '' : ''
}

/** Session revérifiée chez Twitch (au plus toutes les 12 h, sauf `force`) :
 *  nom à jour, ou marquée refusée. Une panne laisse tout en place. */
export async function checkWebSession({ force = false } = {}) {
  const s = webSession
  if (!s || s.expired || (!force && Date.now() - (s.checkedAt || 0) < CHECK_MS)) return
  const r = await sessionGql('query { currentUser { id login displayName } }')
  if (webSession !== s || r.status !== 200 || !r.json) return
  const u = r.json.data?.currentUser
  if (!u) {
    // currentUser nul sans erreur : jeton rejeté. Avec des erreurs : panne
    // passagère de Twitch, la session reste.
    if (!(Array.isArray(r.json.errors) && r.json.errors.length)) markExpired(s, 'currentUser vide')
    return
  }
  if (!/^\d{1,20}$/.test(String(u.id || ''))) return
  const before = `${s.userId}|${s.login}|${s.displayName}`
  s.userId = String(u.id)
  const login = String(u.login || '').toLowerCase()
  if (LOGIN_RE.test(login)) s.login = login
  if (typeof u.displayName === 'string' && u.displayName.trim()) s.displayName = u.displayName.trim().slice(0, 60)
  s.checkedAt = Date.now()
  store(s)
  // Seul un compte ou un nom changé se voit (réglages, suivis).
  if (`${s.userId}|${s.login}|${s.displayName}` !== before) changed()
}

// ── Appairage (écran screens/pair.js) ──────────────────────────────────────
/** Nouveau QR code, pour le Worker que la TV utilise (base D1 : le
 *  principal, ou le Worker personnel s'il prend tout). */
export const startPairing = () => newPairing(api.API_URL)
export const endPairing = (p) => forgetPairing(p)

/**
 * Relève le Worker toutes les 2 s jusqu'à l'arrivée du paquet ou la fin du
 * code (la dernière relève tombe à l'expiration). Rend { result: 'ok',
 * session } (déchiffrée, pas encore gardée), 'expired', 'failed' ou
 * 'cancelled'. `onState('offline' | 'waiting')` : Worker injoignable ou
 * revenu.
 */
export async function waitForSession(p, { cancelled = () => false, onState = () => {} } = {}) {
  let delay = PAIR_POLL_MS
  let offline = false
  for (;;) {
    const left = p.expiresAt - Date.now()
    if (left <= 0) return { result: 'expired' }
    await sleep(Math.min(delay, left))
    if (cancelled()) return { result: 'cancelled' }
    let res = null
    try {
      res = await fetchTimeout(`${p.workerBase}/api/pair?id=${encodeURIComponent(p.id)}`, { cache: 'no-store' }, 8000)
    } catch { res = null }
    if (cancelled()) return { result: 'cancelled' }
    const down = !res || res.status >= 500
    if (down !== offline) { offline = down; onState(down ? 'offline' : 'waiting') }
    delay = res?.status === 429 ? 10_000 : PAIR_POLL_MS
    if (res?.status === 400) return { result: 'failed' }
    if (res?.status !== 200) continue
    const data = await res.json().catch(() => null)
    if (cancelled()) return { result: 'cancelled' }
    if (typeof data?.blob !== 'string') return { result: 'failed' }
    try {
      return { result: 'ok', session: await openBlob(p, data.blob) }
    } catch (e) {
      // Messages de pairing.js et de WebCrypto : jamais le contenu.
      logError('session', `Session reçue de l'iPhone illisible (${e?.name === 'OperationError' ? 'étiquette refusée' : e?.message || 'erreur'})`)
      return { result: 'failed' }
    }
  }
}

// ── Direct sans pub par le compte ──────────────────────────────────────────
const PAT_QUERY = `query($l: String!) { streamPlaybackAccessToken(channelName: $l,
  params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`

const note = (login, msg) => logError('compte', `TV ${login} : ${msg}, sources habituelles`)
const yn = (b) => (b == null ? '?' : b ? 'oui' : 'non')
const hostOf = (u) => { try { return new URL(u).host } catch { return '?' } }

/** Liste maîtresse d'usher par le proxy (relais ou Worker) : usher refuse
 *  l'origine d'une app installée. */
async function getMaster(base, usher) {
  const url = proxyLink(base, usher)
  try {
    const res = await fetchTimeout(url, { cache: 'no-store' }, 8000)
    if (!res.ok) return { ok: false, status: res.status }
    const text = await res.text()
    return text.includes('#EXT-X-STREAM-INF') ? { ok: true, text, url } : { ok: false, status: res.status }
  } catch {
    return { ok: false, network: true }
  }
}

/**
 * Direct par le compte de la session web, s'il est sans pub sur cette
 * chaîne. Rend null (pas de session, réseau, refus, jeton anonyme), { adFree:
 * false } (ce compte aurait des pubs ici), { adFree: true, links: null } (sans
 * pub, mais le flux ne répond pas), ou { adFree: true, links, variants,
 * source: 'account', subscriber } — mêmes liens que /api/get-live (proxy).
 * 6 s au plus pour le jeton (comme l'iPhone), 8 s pour la liste maîtresse.
 */
export async function accountLive(login, { lowLatency = true } = {}) {
  const s = webSession
  if (!s || s.expired) return null
  const r = await sessionGql(PAT_QUERY, { l: login }, 6000)
  if (!r.status) { note(login, 'jeton du compte sans réponse (réseau ou plus de 6 s)'); return null }
  if (r.status === 401 || r.status === 403) { note(login, `session web refusée par Twitch (HTTP ${r.status})`); return null }
  const errs = errorsText(r.json, s.token)
  if (/integrity/i.test(errs)) { note(login, 'Twitch exige un jeton d’intégrité pour le jeton du compte'); return null }
  const pat = r.json?.data?.streamPlaybackAccessToken
  if (r.status !== 200 || !pat?.value || !pat?.signature) { note(login, `jeton du compte indisponible (${errs || `HTTP ${r.status}`})`); return null }
  const info = readPlaybackToken(pat.value)
  if (info.anonymous) { note(login, 'jeton du compte anonyme (session web expirée ?)'); return null }
  console.info(`[TwitchUnblock] Jeton du compte pour ${login} : abonné ${yn(info.subscriber)} · turbo ${yn(info.turbo)} · hide_ads ${yn(info.hideAds)} · show_ads ${yn(info.showAds)}${info.forbidden ? ' · lecture refusée' : ''}`)
  if (info.forbidden || !info.adFree) return { adFree: false }
  const usher = usherLiveUrl(login, pat, { lowLatency })
  if (!usher) return null
  let base = api.playbackBase()
  let got = await getMaster(base, usher)
  // Relais injoignable : écarté comme ailleurs, et un Worker à la place.
  if (!got.ok && got.network && base === api.RELAY_BASE && api.markWorkerDown(base)) {
    base = api.playbackBase()
    got = await getMaster(base, usher)
  }
  if (webSession !== s) return null
  if (!got.ok) {
    note(login, got.network ? `flux du compte injoignable (${hostOf(base)})` : `flux du compte refusé (HTTP ${got.status})`)
    return { adFree: true, links: null }
  }
  const { links, variants } = masterLinks(got.text, got.url)
  if (Object.keys(links).length < 2) { note(login, 'flux du compte sans qualité'); return { adFree: true, links: null } }
  console.info(`[TwitchUnblock] Direct de ${login} par le compte (sans pub) : ${Object.keys(links).length - 1} qualités`)
  return { adFree: true, links, variants, source: 'account', subscriber: info.subscriber }
}

// ── Chaînes suivies du compte ──────────────────────────────────────────────
const FOLLOWED_QUERY = `query { currentUser { followedLiveUsers(first: 100) { edges { node {
  login displayName profileImageURL(width: 50)
  stream { title viewersCount createdAt previewImageURL(width: 440, height: 248) game { id displayName } freeformTags { name } }
} } } } }`

/** Chaînes suivies par le compte de la session web et en direct, au format
 *  des cartes (api.js, streamFromGQL). Lève une erreur si Twitch ne répond
 *  pas ou refuse (noté au journal). */
export async function followedLiveByWebSession() {
  const s = webSession
  if (!s || s.expired) return []
  const r = await sessionGql(FOLLOWED_QUERY)
  if (r.status !== 200 || !r.json) throw new Error(r.status ? `HTTP ${r.status}` : 'network')
  const user = r.json.data?.currentUser
  const edges = user?.followedLiveUsers?.edges
  if (!Array.isArray(edges)) {
    const errs = errorsText(r.json, s.token)
    if (!user && !errs) markExpired(s, 'currentUser vide')
    else logError('session', `Chaînes suivies du compte refusées par Twitch${errs ? ` (${errs})` : ''}`)
    throw new Error('refused')
  }
  return edges.map((e) => e?.node).filter((n) => n?.login && n.stream).map((n) => ({
    login: String(n.login).toLowerCase(),
    name: n.displayName || n.login,
    avatar: n.profileImageURL || '',
    title: n.stream.title || '',
    game: n.stream.game?.displayName || '',
    gameId: n.stream.game?.id || '',
    viewers: n.stream.viewersCount || 0,
    thumb: n.stream.previewImageURL || '',
    startedAt: n.stream.createdAt || null,
    tags: (n.stream.freeformTags || []).map((x) => x?.name).filter(Boolean),
  }))
}
