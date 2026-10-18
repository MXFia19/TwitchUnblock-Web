// ═══════════════════════════════════════════════════════════════════════════
//  Accès réseau : le Worker (flux vidéo, sauvegarde), Helix (compte connecté)
//  et GQL (métadonnées publiques, sans connexion).
// ═══════════════════════════════════════════════════════════════════════════

import { store } from './store.js'
import { logError } from './errlog.js'

// Auto-hébergement : public/config.js peut remplacer l'adresse du Worker
// (« same-origin » = le site et le Worker servis ensemble, comme sous Docker)
// et l'application Twitch utilisée pour la connexion.
const CFG = window.TU_CONFIG ?? {}

// ── Worker personnel (réglages experts) ───────────────────────────────────
// Si les Workers officiels tombent, ou si le projet disparaît, chacun peut
// déployer le sien (ce dépôt : Cloudflare ou Docker) et le donner dans les
// réglages. Il passe alors en premier pour la lecture (lives, VODs,
// playlists) ; les officiels restent en secours. « Tout passer par lui » y
// envoie aussi la sauvegarde (avec le jeton Twitch), les retours, les
// annonces, les notifications et le comptage. Lu au chargement : la page se
// recharge quand il change.
/** Adresse nettoyée (« https:// » ajouté, « / » et « /api » finaux ôtés) ; null si invalide. */
export function normalizeWorker(raw) {
  let s = String(raw || '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.search) return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/api$/i, '')}`
  } catch { return null }
}

/** Un Worker TwitchUnblock répond à un nom de chaîne vide par une erreur
 *  JSON (400 « Nom invalide ») : c'est ce qu'on vérifie avant de s'en servir. */
export async function checkWorker(base) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(`${base}/api/get-live?name=`, { cache: 'no-store', signal: ctrl.signal })
    const data = await res.json()
    return (res.status === 400 || res.ok) && Boolean(data && (data.error || data.links))
  } catch { return false } finally { clearTimeout(timer) }
}

const CUSTOM = normalizeWorker(store.prefs.customWorker)
const CUSTOM_ALL = Boolean(CUSTOM && store.prefs.customWorkerAll)
export const CUSTOM_WORKER = CUSTOM

const OFFICIAL_URL = CFG.apiUrl === 'same-origin' ? location.origin : (CFG.apiUrl || 'https://test2.kurzmathis4.workers.dev')
export const API_URL = CUSTOM_ALL ? CUSTOM : OFFICIAL_URL

// ── Workers de secours ─────────────────────────────────────────────────────
// Le Worker gratuit est limité à 100 000 requêtes par jour et par compte
// Cloudflare : au-delà, il répond « error code: 1027 » (HTTP 429) jusqu'à
// minuit UTC. Un second Worker, déployé sur un autre compte (README,
// « Fallback Worker »), prend alors le relais pour tout ce qui ne dépend pas
// de la base D1 : lives, VODs, relais vidéo, commandes Moobot. Sauvegarde,
// comptage et annonces restent sur le principal : leurs données y sont.
// Une instance avec sa propre adresse (config.js) n'hérite pas des secours
// officiels : elle donne les siens dans `fallbackApiUrls`, ou aucun.
const DEFAULT_FALLBACK_URLS = ['https://test2-fallback.vxcraftmanpetit.workers.dev']
const FALLBACK_URLS = CFG.fallbackApiUrls ?? (CFG.apiUrl ? [] : DEFAULT_FALLBACK_URLS)
const originOf = (u) => { try { return new URL(u).origin } catch { return null } }
/** Le principal d'abord, puis les secours (et le Worker personnel), dans l'ordre. */
export const WORKER_BASES = [...new Set([API_URL, OFFICIAL_URL, ...FALLBACK_URLS.map(originOf).filter(Boolean), ...(CUSTOM ? [CUSTOM] : [])])]
/**
 * Ordre pour tout ce qui ne dépend pas de D1 (lives, VODs, relais vidéo,
 * Moobot) : les secours d'abord, le principal en dernier recours. Son quota
 * reste ainsi pour ce que lui seul sait faire — /stats, sauvegardes,
 * comptage, annonces, retours — qui tombaient avec lui quand la lecture
 * l'avait épuisé.
 */
// Un Worker personnel passe avant tous les autres.
const LOOKUP_BASES = CUSTOM
  ? [CUSTOM, ...WORKER_BASES.filter((b) => b !== CUSTOM)]
  : [...WORKER_BASES.slice(1), WORKER_BASES[0]]

// ── Relais vidéo (serveur à soi) ───────────────────────────────────────────
// La lecture fait presque tout le quota de requêtes du Worker : chaque
// segment de VOD, la playlist d'un direct toutes les ~2 s. Un relais sur un
// VPS (docker/relay.mjs, README « Video relay ») exécute le même proxy, sans
// quota : les liens de lecture du Worker y sont redirigés, le Worker garde
// tout le reste. Relais injoignable → retour au Worker, comme pour un Worker
// de secours (écarté 30 min). Une instance avec sa propre adresse
// (config.js) n'hérite pas du relais officiel : elle donne le sien dans
// `relayUrl`, ou aucun.
const DEFAULT_RELAY_URL = 'https://relais.mxfia19.duckdns.org'
// Avec un Worker personnel, pas de relais officiel : la vidéo ne repasse
// pas par l'infrastructure du projet.
export const RELAY_BASE = CUSTOM ? null : originOf(CFG.relayUrl ?? (CFG.apiUrl ? '' : DEFAULT_RELAY_URL))

// Worker mis de côté sur cet appareil, pour ne pas le retenter à chaque
// requête. La page d'erreur de Cloudflare n'a pas d'en-tête CORS : le
// navigateur ne voit qu'un échec réseau, jamais le code 1027. Un Worker qui
// échoue alors qu'un autre répond est donc écarté 30 minutes, puis retenté —
// son quota repart à minuit UTC.
const DOWN_KEY = 'tu_worker_down'
const DOWN_MS = 30 * 60_000
// Copie en mémoire : la mise à l'écart tient aussi quand le navigateur refuse
// le stockage (navigation privée, cookies bloqués) — sinon chaque requête
// repassait d'abord par le Worker en panne.
const downMem = {}
function downStored() {
  try { return JSON.parse(localStorage.getItem(DOWN_KEY) || '{}') || {} } catch { return {} }
}
const isDown = (base) => Math.max(downStored()[base] || 0, downMem[base] || 0) > Date.now()

/** Un autre Worker peut-il prendre le relais de celui-ci ? */
export const hasOtherWorker = (base) => WORKER_BASES.length > 1 && WORKER_BASES.includes(base)

/** Écarte un Worker en panne. `false` s'il n'y a aucun autre Worker vers
 *  qui se tourner : l'appelant garde alors son comportement habituel. */
export function markWorkerDown(base) {
  // Le relais a toujours un recours : le Worker.
  if (base !== RELAY_BASE && !hasOtherWorker(base)) return false
  const until = Date.now() + DOWN_MS
  downMem[base] = until
  const m = downStored()
  m[base] = until
  try { localStorage.setItem(DOWN_KEY, JSON.stringify(m)) } catch {}
  return true
}

/** Qui relaie cette adresse : le relais vidéo ou un Worker, sinon null. */
export function proxyBaseOf(url) {
  const o = originOf(url)
  return o && (o === RELAY_BASE || WORKER_BASES.includes(o)) ? o : null
}

/** Liens de lecture d'un relais à l'autre (même route /api/proxy des deux
 *  côtés) : vers le relais vidéo s'il répond, vers le Worker sinon. */
function moveLinks(links, from, to) {
  const out = {}
  for (const [q, link] of Object.entries(links ?? {})) {
    let moved = link
    try {
      const u = new URL(link)
      if (from(u.origin) && u.pathname === '/api/proxy') moved = `${to}${u.pathname}${u.search}`
    } catch {}
    out[q] = moved
  }
  return out
}
const viaRelay = (data) => (RELAY_BASE && !isDown(RELAY_BASE) && data?.links
  ? { ...data, links: moveLinks(data.links, (o) => WORKER_BASES.includes(o), RELAY_BASE) }
  : data)
/** Relais en panne en pleine lecture : les mêmes liens, par un Worker —
 *  un secours d'abord, pour ménager le principal. */
export const withoutRelay = (links) => moveLinks(links, (o) => o === RELAY_BASE,
  LOOKUP_BASES.find((b) => !isDown(b)) ?? LOOKUP_BASES[0])

/** Worker en panne en pleine lecture d'une VOD reconstruite (rien à
 *  redemander) : les mêmes liens, par un autre Worker ; null s'il n'y en a
 *  pas. */
export function linksAvoiding(links, base) {
  const to = LOOKUP_BASES.find((b) => b !== base && !isDown(b)) ?? LOOKUP_BASES.find((b) => b !== base)
  return to ? moveLinks(links, (o) => o === base, to) : null
}

/** L'adresse répond-elle (2xx) en moins de 8 s ? */
async function answers(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    return (await fetch(url, { cache: 'no-store', signal: ctrl.signal })).ok
  } catch { return false } finally { clearTimeout(timer) }
}

// Relais injoignable (VPS arrêté, mal configuré) : on le sait dès le
// chargement de la page, plutôt qu'après les essais du lecteur. Écarté
// seulement si l'appareil est en ligne et qu'un Worker répond, lui : un
// réseau mobile lent (plus de 4 s, l'ancien délai) mettait le relais à
// l'écart 30 min à tort. Sinon, un nouvel essai deux minutes plus tard.
async function checkRelay(again = true) {
  if (!RELAY_BASE || isDown(RELAY_BASE) || await answers(`${RELAY_BASE}/health`)) return
  const worker = LOOKUP_BASES.find((b) => !isDown(b)) ?? LOOKUP_BASES[0]
  if (navigator.onLine !== false && await answers(`${worker}/`)) markWorkerDown(RELAY_BASE)
  else if (again) setTimeout(() => checkRelay(false), 120_000)
}
checkRelay()

/**
 * JSON d'une route du Worker qui ne touche pas à la base D1, en passant au
 * Worker suivant quand l'un d'eux ne répond pas (quota atteint) — ceux qui
 * répondent d'abord, les Workers écartés en dernier recours.
 * Une réponse d'erreur du Worker lui-même (404 « VOD introuvable », 502
 * « Twitch injoignable »…) n'est pas une panne : un autre Worker dirait la
 * même chose — le 502 l'écartait 30 min à tort. N'en sont une qu'un échec
 * réseau (la page d'erreur de Cloudflare, quota 1027 ou plantage 1101, n'a
 * pas d'en-tête CORS), un 429, ou une erreur 5xx qui n'est pas le JSON du
 * Worker.
 * `avoid` : le Worker qui vient de lâcher en pleine lecture. Essayé après
 * les autres, il n'est écarté que si l'un d'eux répond — sinon, c'est la
 * connexion de l'appareil qui est en cause.
 */
export async function workerJson(path, { timeout = 0, avoid = null } = {}) {
  const bases = LOOKUP_BASES.filter((b) => !isDown(b) && b !== avoid)
  const failed = []
  for (const base of [...bases, ...LOOKUP_BASES.filter((b) => !bases.includes(b))]) {
    const ctrl = timeout ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null
    let res
    try {
      res = await fetch(base + path, ctrl ? { signal: ctrl.signal } : undefined)
    } catch (e) {
      // Trop lent n'est pas « hors service » : le service derrière le
      // Worker peut traîner (Moobot), un autre Worker n'y changerait rien.
      if (e?.name === 'AbortError') throw e
      failed.push(base)
      continue
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 429 || (res.status >= 500 && !/json/i.test(res.headers.get('content-type') || ''))) {
      failed.push(base)
      continue
    }
    // Ce Worker répond : ceux qui ont échoué avant lui sont bien en panne —
    // pas la connexion de l'appareil —, on les écarte un moment.
    for (const b of failed) markWorkerDown(b)
    if (avoid && base !== avoid) markWorkerDown(avoid)
    if (!res.ok) {
      // 404 : pas de direct ou VOD introuvable, une réponse normale.
      if (res.status !== 404) logError('worker', `${path.split('?')[0]} → HTTP ${res.status}`)
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return res.json()
  }
  // Aucun Worker joignable : erreur sans statut, affichée comme un problème
  // de réseau, pas comme une vidéo introuvable.
  logError('worker', `${path.split('?')[0]} : aucun Worker joignable (${failed.length} essayés)`)
  throw new Error('Worker injoignable')
}
/** Liens donnés aux applis externes (VLC, Outplayer, Infuse) : par le proxy
 *  (`true`) ou en direct depuis Twitch (`false`, ne charge pas le Worker).
 *  Décidé ici plutôt que par chaque visiteur. La lecture sur le site, elle,
 *  passe toujours par le proxy : le CDN des VODs n'accepte que twitch.tv. */
export const EXTERNAL_LINKS_VIA_PROXY = true
export const GITHUB_URL = 'https://github.com/MXFia19/TwitchUnblock-Web'
export const APP_GITHUB_URL = 'https://github.com/MXFia19/TwitchUnblock'
export const DISCORD_URL = 'https://discord.gg/cEsMRdxsVq'
export const HELIX_CLIENT_ID = CFG.twitchClientId || 'uyvqdqrz614y5wx5l4kev6c4ln7u9a'
export const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
/** Client-ID public de l'app Android de Twitch (la technique d'Xtra). Twitch
 *  n'exige le jeton d'intégrité dès la 2e page d'une liste que pour le
 *  Client-ID web (vérifié le 2026-10-14). Seulement pour les pages suivantes
 *  des listes (gqlNext) : jamais avec un jeton, jamais pour les jetons de
 *  lecture, les fiches ou le chat, qui restent sur GQL_CLIENT_ID. */
const GQL_NEXT_CLIENT_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp'
/** Seule adresse de retour déclarée chez Twitch : elle ne doit pas changer. */
export const REDIRECT_URI = CFG.redirectUri || 'https://test2-fawn-eta.vercel.app/'
/** `chat:read` / `chat:edit` en plus de l'ancien périmètre : sans eux, l'IRC
 *  refuse le jeton et on ne peut que lire le chat en anonyme. */
export const SCOPES = ['user:read:follows', 'chat:read', 'chat:edit']

const LOGIN_RE = /^[a-z0-9_]{1,25}$/

export function cleanLogin(raw) {
  const login = String(raw || '').trim().toLowerCase().replace(/^@/, '')
  return LOGIN_RE.test(login) ? login : null
}

/** « gql.twitch.tv/gql », sans les paramètres (ils peuvent porter un jeton). */
const where = (url) => { try { const u = new URL(url); return u.host + u.pathname } catch { return '?' } }

async function json(url, init) {
  let res
  try {
    res = await fetch(url, init)
  } catch (e) {
    if (e?.name !== 'AbortError') logError('réseau', `${where(url)} : ${e?.message || e}`)
    throw e
  }
  if (!res.ok) {
    logError('réseau', `${where(url)} → HTTP ${res.status}`)
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// ── GQL public ─────────────────────────────────────────────────────────────
/** Toujours avec des variables : un nom saisi n'est jamais recollé tel quel
 *  dans le texte de la requête. */
export async function gql(query, variables = {}) {
  const data = await gqlRaw(query, variables)
  return data?.data ?? null
}

/** Réponse entière : Twitch signale ses erreurs en HTTP 200, dans `errors`,
 *  avec des champs nuls dans `data` — à distinguer d'un vrai « rien ». */
export async function gqlRaw(query, variables = {}) {
  return json('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
}

/** Page suivante d'une liste, avec le Client-ID Android (voir
 *  GQL_NEXT_CLIENT_ID). Twitch signale un refus en HTTP 200 : la liste
 *  vaut null et `errors` dit « failed integrity check ». On le distingue
 *  donc d'une fin de liste : { data, refused }. Une erreur 4xx (Client-ID
 *  fermé, requête rejetée) reviendrait à l'identique à chaque clic : c'est
 *  un refus aussi. Une panne réseau, une 408, une 429 ou une 5xx lèvent,
 *  comme gql(). */
async function gqlNext(query, variables = {}) {
  let res
  try {
    res = await json('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': GQL_NEXT_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
  } catch (e) {
    if (e?.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) return { data: null, refused: true }
    throw e
  }
  const refused = (res?.errors ?? []).some((e) => e?.extensions?.code === 'IntegrityCheckFailed' || /failed integrity check/i.test(e?.message ?? ''))
  return { data: res?.data ?? null, refused }
}

/** Curseur de la suite d'une liste GQL : celui de la dernière arête, et
 *  seulement si Twitch dit qu'il y a une suite (sans suite, les curseurs
 *  des clips sont nuls ; un `after` nul redonnerait la page 1). */
const nextCursor = (conn) => (conn?.pageInfo?.hasNextPage && conn.edges?.at(-1)?.cursor) || null

/** Infos d'une chaîne : identité, et le live en cours s'il y en a un. */
export async function getChannelInfo(login) {
  const data = await gql(`query($l: String!) {
    user(login: $l) {
      id login displayName profileImageURL(width: 150) lastBroadcast { startedAt }
      stream { id title viewersCount createdAt game { id displayName name } previewImageURL(width: 640, height: 360) freeformTags { name } }
      broadcastSettings { title game { id displayName } }
    }
  }`, { l: login })
  return data?.user ?? null
}

export async function searchChannels(query) {
  const data = await gql(`query($q: String!) {
    searchUsers(userQuery: $q, first: 6) {
      edges { node { login displayName profileImageURL(width: 70) stream { viewersCount } } }
    }
  }`, { q: query })
  return (data?.searchUsers?.edges ?? []).map((e) => e.node).filter(Boolean)
}

/** Forme commune des cartes de live, quelle que soit la source. */
function streamFromGQL(n) {
  return {
    login: n?.broadcaster?.login ?? '',
    name: n?.broadcaster?.displayName ?? n?.broadcaster?.login ?? '',
    avatar: n?.broadcaster?.profileImageURL ?? '',
    title: n?.title ?? '',
    game: n?.game?.displayName ?? '',
    gameId: n?.game?.id ?? '',
    viewers: n?.viewersCount ?? 0,
    thumb: n?.previewImageURL ?? '',
    startedAt: n?.createdAt ?? null,
    // Tags de la chaîne, langue comprise (« English », « DropsEnabled »…).
    tags: (n?.freeformTags ?? []).map((x) => x?.name).filter(Boolean),
  }
}

/** Chaînes (avatar + live éventuel) par GQL public, 100 par requête.
 *  [{ login, name, avatar, stream }] ; stream au format des cartes, ou null. */
export async function getChannelsByLogins(logins) {
  const out = []
  for (let i = 0; i < logins.length; i += 100) {
    const data = await gql(`query($l: [String!]) { users(logins: $l) { login displayName profileImageURL(width: 70)
      lastBroadcast { startedAt }
      videos(first: 1, type: ARCHIVE, sort: TIME) { edges { node { publishedAt lengthSeconds } } }
      stream { title viewersCount createdAt previewImageURL(width: 440, height: 248) game { id displayName } freeformTags { name } } } }`, { l: logins.slice(i, i + 100) })
    for (const u of data?.users ?? []) {
      if (!u?.login) continue
      // Fin du dernier live : la dernière VOD (début + durée) ou, si plus
      // tard, le dernier live lancé.
      const v = u.videos?.edges?.[0]?.node
      const vodEnd = v ? Date.parse(v.publishedAt) + (v.lengthSeconds || 0) * 1000 : NaN
      const started = Date.parse(u.lastBroadcast?.startedAt)
      const best = Math.max(Number.isFinite(vodEnd) ? vodEnd : 0, Number.isFinite(started) ? started : 0)
      out.push({ login: u.login, name: u.displayName || u.login, avatar: u.profileImageURL || '', lastEnd: best ? new Date(best).toISOString() : null, stream: u.stream ? streamFromGQL({ ...u.stream, broadcaster: u }) : null })
    }
  }
  return out
}

/** Toutes les chaînes suivies par le compte (Helix, pages de 100, 1 000 max). */
export async function getFollowedLogins(userId) {
  const logins = []
  let after = ''
  do {
    const data = await helix(`channels/followed?user_id=${encodeURIComponent(userId)}&first=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    for (const f of data?.data ?? []) if (f.broadcaster_login) logins.push(f.broadcaster_login.toLowerCase())
    after = data?.pagination?.cursor ?? ''
  } while (after && logins.length < 1000)
  return logins
}

// ── Catégories (GQL public) ────────────────────────────────────────────────
const CAT_FIELDS = 'id name displayName slug boxArtURL(width: 285, height: 380) viewersCount'
const catFrom = (n) => ({ id: n.id, name: n.displayName || n.name, slug: n.slug || '', box: n.boxArtURL || '', viewers: n.viewersCount ?? null })

/** Une catégorie par son nom d'adresse (« just-chatting », comme sur Twitch). */
export async function getCategoryBySlug(slug) {
  const data = await gql(`query($s: String!) { game(slug: $s) { ${CAT_FIELDS} } }`, { s: slug })
  return data?.game ? catFrom(data.game) : null
}

// Pagination. On prend d'un coup les 100 premiers (le maximum accepté) avec
// le Client-ID web, servis par tranches. Avec lui, Twitch exige un jeton
// d'intégrité dès la 2e page (« failed integrity check ») : la suite passe
// donc par gqlNext (Client-ID Android), sans compte. Si Twitch la refuse,
// Helix continue avec le compte Twitch ; sans compte, la liste s'arrête là.
// Le « curseur » est un objet opaque :
//   { rest: à servir, seen: déjà vus, more: Twitch en a d'autres,
//     next: curseur GQL de la suite, blocked: suite GQL refusée,
//     after: curseur Helix }
function servePage(c, step) {
  const items = c.rest.slice(0, step)
  const rest = c.rest.slice(step)
  const canGql = Boolean(c.next && !c.blocked)
  const later = c.more && (canGql || Boolean(store.token))
  // `locked` : Twitch en a d'autres, mais il faut le compte pour les voir.
  return { items, cursor: rest.length || later ? { ...c, rest } : null, locked: !rest.length && c.more && !canGql && !store.token }
}

/** Page suivante sans compte, sans ce qui est déjà affiché : les lives
 *  bougent et l'ordre diffère un peu d'un Client-ID à l'autre, une page peut
 *  n'avoir que des doublons — jusqu'à 3 pages pour trouver du neuf, comme
 *  helixMore. `fetchNext(after)` rend { items, next, refused }.
 *  Refus : la liste est marquée bloquée (on ne rejoue pas une requête
 *  refusée à chaque clic), puis `helixFrom(c)` repart du début avec le
 *  compte ; sans compte, la page est verrouillée. Panne réseau : le curseur
 *  reste, et « Charger plus » avec lui. */
async function gqlMore(c, fetchNext, keyOf, step, helixFrom = null) {
  let next = c.next
  let refused = false
  const fresh = []
  try {
    for (let i = 0; i < 3 && fresh.length < step && next; i++) {
      const r = await fetchNext(next)
      if (r.refused) { refused = true; break }
      next = r.next
      for (const x of r.items) {
        const k = keyOf(x)
        if (k && !c.seen.has(k)) { c.seen.add(k); fresh.push(x) }
      }
    }
  } catch { /* panne : on garde le dernier curseur reçu */ }
  if (refused) {
    const blocked = { ...c, rest: fresh, next: null, blocked: true }
    return !fresh.length && store.token && helixFrom ? helixFrom(blocked) : servePage(blocked, step)
  }
  return servePage({ ...c, rest: fresh, next, more: Boolean(next) }, step)
}

/** Page Helix suivante, sans ce qui est déjà affiché (Helix repart du début :
 *  ses 100 premiers recouvrent ceux de GQL). Jusqu'à 3 pages pour trouver du
 *  neuf ; une erreur clôt la liste au lieu de la vider. */
async function helixMore(c, path, convert, keyOf, step) {
  let after = c.after
  const fresh = []
  try {
    for (let i = 0; i < 3 && fresh.length < step; i++) {
      const data = await helix(`${path}${path.includes('?') ? '&' : '?'}first=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
      after = data?.pagination?.cursor ?? null
      for (const x of (data?.data ?? []).map(convert)) {
        const k = keyOf(x)
        if (k && !c.seen.has(k)) { c.seen.add(k); fresh.push(x) }
      }
      if (!after) break
    }
  } catch {
    after = null
  }
  return servePage({ ...c, rest: fresh, more: Boolean(after), after }, step)
}

const catFromHelix = (g) => ({ id: g.id, name: g.name, box: String(g.box_art_url ?? '').replace('{width}', '285').replace('{height}', '380'), viewers: null })

const TOP_CATS_Q = `query($after: Cursor) { games(first: 100, after: $after) { edges { cursor node { ${CAT_FIELDS} } } pageInfo { hasNextPage } } }`
const topCatsFrom = (data) => ({ items: (data?.games?.edges ?? []).filter((e) => e?.node).map((e) => catFrom(e.node)), next: nextCursor(data?.games) })

/** Catégories les plus regardées. { items, cursor, locked } (voir servePage) */
export async function getTopCategories(cursor = null) {
  const helixFrom = (c) => helixMore(c, 'games/top', catFromHelix, (x) => x.id, 40)
  let page
  if (cursor?.rest?.length) page = servePage(cursor, 40)
  else if (cursor?.next && !cursor.blocked) {
    page = await gqlMore(cursor, async (after) => {
      const r = await gqlNext(TOP_CATS_Q, { after })
      return { ...topCatsFrom(r.data), refused: r.refused }
    }, (x) => x.id, 40, helixFrom)
  } else if (cursor) page = await helixFrom(cursor)
  else {
    const data = await gql(TOP_CATS_Q, { after: null })
    const { items, next } = topCatsFrom(data)
    page = servePage({ rest: items, seen: new Set(items.map((x) => x.id)), more: Boolean(data?.games?.pageInfo?.hasNextPage), next, after: null }, 40)
  }
  // Helix ne donne pas l'audience : complétée par GQL, en une requête.
  const missing = page.items.filter((x) => x.viewers == null).map((x) => x.id)
  if (missing.length) {
    const byId = Object.fromEntries((await getCategoriesByIds(missing).catch(() => [])).map((x) => [x.id, x]))
    page.items = page.items.map((x) => byId[x.id] ?? x)
  }
  return page
}

export async function searchCategories(q) {
  const data = await gql(`query($q: String!) { searchCategories(query: $q, first: 30) { edges { node { ${CAT_FIELDS} } } } }`, { q })
  return (data?.searchCategories?.edges ?? []).map((e) => catFrom(e.node))
}

/** Audience et jaquette à jour de catégories connues (suivies). */
export async function getCategoriesByIds(ids) {
  ids = ids.slice(0, 60)
  if (!ids.length) return []
  // Une requête, un alias par catégorie (pas de filtre par identifiants).
  const vars = Object.fromEntries(ids.map((id, i) => [`i${i}`, String(id)]))
  const q = `query(${ids.map((_, i) => `$i${i}: ID`).join(', ')}) { ${ids.map((_, i) => `g${i}: game(id: $i${i}) { ${CAT_FIELDS} }`).join(' ')} }`
  const data = await gql(q, vars)
  return ids.map((_, i) => data?.[`g${i}`]).filter(Boolean).map(catFrom)
}

/** Lives d'une catégorie, par tranches de 30, d'une seule langue si
 *  `language` (« fr », « zh_hk »). { items, cursor } (voir servePage) */
export async function getCategoryStreams(id, cursor = null, language = null) {
  const helixLang = language ? `&language=${encodeURIComponent(language.toLowerCase().replace('_', '-'))}` : ''
  const helixFrom = (c) => helixMore(c, `streams?game_id=${encodeURIComponent(id)}${helixLang}`, streamFromHelix, (s) => s.login, 30)
  // Même requête pour la page 1 (Client-ID web) et la suite (gqlNext), avec
  // les mêmes langues.
  const q = `query($id: ID!, $langs: [Language!], $after: Cursor) { game(id: $id) { streams(first: 100, after: $after, options: { broadcasterLanguages: $langs }) {
      edges { cursor node { title viewersCount createdAt previewImageURL(width: 440, height: 248) game { id displayName } freeformTags { name }
        broadcaster { login displayName profileImageURL(width: 50) } } } pageInfo { hasNextPage } } } }`
  const vars = (after) => ({ id, langs: language ? [language.toUpperCase().replace('-', '_')] : null, after })
  const from = (data) => ({ items: (data?.game?.streams?.edges ?? []).map((e) => streamFromGQL(e?.node)).filter((s) => s.login), next: nextCursor(data?.game?.streams) })
  let page
  if (cursor?.rest?.length) page = servePage(cursor, 30)
  else if (cursor?.next && !cursor.blocked) {
    page = await gqlMore(cursor, async (after) => {
      const r = await gqlNext(q, vars(after))
      return { ...from(r.data), refused: r.refused }
    }, (s) => s.login, 30, helixFrom)
  } else if (cursor) page = await helixFrom(cursor)
  else {
    const data = await gql(q, vars(null))
    const { items, next } = from(data)
    page = servePage({ rest: items, seen: new Set(items.map((s) => s.login)), more: Boolean(data?.game?.streams?.pageInfo?.hasNextPage), next, after: null }, 30)
  }
  // Helix ne donne pas les photos de profil : complétées en une requête.
  const missing = page.items.filter((s) => !s.avatar).map((s) => s.login)
  if (missing.length) {
    const avatars = await getAvatars(missing)
    for (const s of page.items) if (!s.avatar) s.avatar = avatars[s.login] ?? ''
  }
  return page
}

/** Lesquelles de ces chaînes sont en live (suivis sans compte), par GQL public. */
export async function getLiveByLogins(logins) {
  const out = []
  for (let i = 0; i < logins.length; i += 100) {
    const data = await gql(`query($l: [String!]) { users(logins: $l) { login displayName profileImageURL(width: 50)
      stream { title viewersCount createdAt previewImageURL(width: 440, height: 248) game { id displayName } freeformTags { name } } } }`, { l: logins.slice(i, i + 100) })
    for (const u of data?.users ?? []) {
      if (u?.stream) out.push(streamFromGQL({ ...u.stream, broadcaster: u }))
    }
  }
  return out.sort((a, b) => b.viewers - a.viewers)
}

export function streamFromHelix(s) {
  return {
    login: s.user_login,
    name: s.user_name || s.user_login,
    avatar: '',
    title: s.title ?? '',
    game: s.game_name ?? '',
    gameId: s.game_id ?? '',
    viewers: s.viewer_count ?? 0,
    thumb: String(s.thumbnail_url ?? '').replace('{width}', '440').replace('{height}', '248'),
    startedAt: s.started_at ?? null,
    tags: Array.isArray(s.tags) ? s.tags : [],
  }
}

const TOP_STREAMS_Q = `query($n: Int!, $langs: [Language!], $after: Cursor) {
    streams(first: $n, after: $after, options: { broadcasterLanguages: $langs }) {
      edges { cursor node {
        title viewersCount createdAt previewImageURL(width: 440, height: 248) freeformTags { name }
        broadcaster { login displayName profileImageURL(width: 50) }
        game { id displayName }
      } }
      pageInfo { hasNextPage }
    }
  }`
const topStreamsFrom = (data) => ({ items: (data?.streams?.edges ?? []).map((e) => streamFromGQL(e?.node)).filter((s) => s.login), next: nextCursor(data?.streams) })

/** Page suivante du top des lives, sans compte (gqlNext) : 30 lives, le
 *  plafond de Twitch pour `streams`. { items, next, refused } ; lève sur une
 *  panne réseau. Sert à « Charger plus » et à compléter le top. */
export async function getTopStreamsAfter(language, after) {
  const r = await gqlNext(TOP_STREAMS_Q, { n: 30, langs: language ? [language.toUpperCase()] : null, after })
  return { ...topStreamsFrom(r.data), refused: r.refused }
}

/** Top des lives, sans connexion : la requête GQL est publique. L'ancien
 *  site passait par Helix et réservait donc l'accueil aux comptes connectés.
 *  24 lives d'abord, puis par 30 avec `cursor` (voir servePage).
 *  { items, cursor, locked } */
export async function getTopStreams(language, cursor = null) {
  const helixLang = language ? `?language=${encodeURIComponent(language.toLowerCase().replace('_', '-'))}` : ''
  const helixFrom = (c) => helixMore(c, `streams${helixLang}`, streamFromHelix, (s) => s.login, 30)
  let page
  if (cursor?.rest?.length) page = servePage(cursor, 30)
  else if (cursor?.next && !cursor.blocked) page = await gqlMore(cursor, (after) => getTopStreamsAfter(language, after), (s) => s.login, 30, helixFrom)
  else if (cursor) page = await helixFrom(cursor)
  else {
    const data = await gql(TOP_STREAMS_Q, { n: 24, langs: language ? [language.toUpperCase()] : null, after: null })
    const { items, next } = topStreamsFrom(data)
    page = servePage({ rest: items, seen: new Set(items.map((s) => s.login)), more: Boolean(data?.streams?.pageInfo?.hasNextPage), next, after: null }, 24)
  }
  // Helix ne donne pas les photos de profil : complétées en une requête.
  const missing = page.items.filter((s) => !s.avatar).map((s) => s.login)
  if (missing.length) {
    const avatars = await getAvatars(missing)
    for (const s of page.items) if (!s.avatar) s.avatar = avatars[s.login] ?? ''
  }
  return page
}

/** Photos de profil d'une liste de chaînes, en une requête. */
export async function getAvatars(logins) {
  if (!logins.length) return {}
  try {
    const data = await gql('query($l: [String!]) { users(logins: $l) { login profileImageURL(width: 50) } }', { l: logins.slice(0, 100) })
    const out = {}
    for (const u of data?.users ?? []) if (u?.login) out[u.login] = u.profileImageURL
    return out
  } catch {
    return {}
  }
}

export async function getVodMeta(id) {
  const data = await gql(`query($id: ID!) {
    video(id: $id) {
      id title lengthSeconds createdAt
      previewThumbnailURL(width: 320, height: 180)
      owner { id login displayName profileImageURL(width: 70) }
      game { id displayName }
    }
  }`, { id })
  return data?.video ?? null
}

// ── Worker ─────────────────────────────────────────────────────────────────
// Dans le navigateur, la lecture passe TOUJOURS par le proxy : le CDN des
// VODs de Twitch ne renvoie aucun en-tête CORS, un lien direct est donc
// bloqué — chargement infini et « CORS error » dans la console. Le réglage
// « proxy » ne concerne plus que les liens donnés aux applis externes
// (VLC, Infuse…), voir `directUrl`.
/** `avoid` : Worker en panne en pleine lecture (voir workerJson). */
export async function getLive(login, { avoid = null } = {}) {
  // Ordre des sources (réglages) : le Worker les essaie l'une après l'autre.
  // `source` (la première) pour un Worker d'avant l'ordre.
  const order = liveSourceOrder()
  return viaRelay(await workerJson(`/api/get-live?name=${encodeURIComponent(login)}&proxy=true&source=${order[0]}&order=${order.join(',')}`, { avoid }))
}

/** Sources du direct, dans l'ordre automatique : Luminous Asie, proxy
 *  albanais (TTV.LOL), Luminous Europe, Twitch officiel (avec ses pubs). */
export const LIVE_SOURCES = ['as', 'al', 'eu', 'twitch']

/** Ordre choisi dans les réglages ; avant lui, une seule source préférée
 *  (`liveSource`), mise en tête. Une source inconnue est ignorée, une
 *  oubliée ajoutée à la fin : toutes restent essayées. */
export function liveSourceOrder(prefs = store.prefs) {
  const saved = Array.isArray(prefs.liveSourceOrder) ? prefs.liveSourceOrder
    : LIVE_SOURCES.includes(prefs.liveSource) ? [prefs.liveSource] : []
  const order = saved.filter((id, i) => LIVE_SOURCES.includes(id) && saved.indexOf(id) === i)
  return [...order, ...LIVE_SOURCES.filter((id) => !order.includes(id))]
}

export async function getVodLinks(id, { avoid = null } = {}) {
  return viaRelay(await workerJson(`/api/get-m3u8?id=${encodeURIComponent(id)}&proxy=true`, { avoid }))
}

/** Adresse d'origine derrière un lien du proxy, pour les applis externes. */
export function directUrl(link) {
  try {
    const u = new URL(link)
    if (proxyBaseOf(link) && u.pathname === '/api/proxy') return u.searchParams.get('url') || link
  } catch {}
  return link
}

/**
 * Corrige les adresses relatives que le Worker ne réécrit pas.
 *
 * Twitch sert désormais ses VODs en fMP4, avec un segment d'initialisation
 * déclaré par `#EXT-X-MAP:URI="init-0.mp4"`. Le Worker réécrit les lignes de
 * segments mais pas les attributs URI des balises : le lecteur résolvait
 * donc `init-0.mp4` par rapport au Worker (`/api/init-0.mp4`, 404) et la
 * vidéo ne démarrait jamais. On renvoie ces adresses vers le proxy, à côté
 * de la playlist d'origine.
 */
export function fixProxiedUrl(url, playlistUrl) {
  try {
    const u = new URL(url)
    // Qui a servi la playlist : le relais vidéo, le Worker ou un secours.
    const base = proxyBaseOf(playlistUrl) ?? API_URL
    // Sous-playlists de direct (Luminous, playlist.ttvnw.net) laissées en
    // direct par le Worker : le navigateur s'y faisait refuser (403) et
    // « Auto » ne démarrait pas. La cause est l'en-tête Origin qu'il ajoute
    // (mesuré le 14/10), pas un jeton lié à l'adresse IP : le proxy reste.
    if (/(^|\.)playlist\.ttvnw\.net$|(^|\.)luminous\.dev$/.test(u.hostname)) {
      return `${base}/api/proxy?url=${encodeURIComponent(url)}&isVod=false`
    }
    if (u.origin !== base || u.pathname === '/api/proxy') return url
    const source = new URL(playlistUrl).searchParams.get('url')
    if (!source) return url
    const name = u.pathname.replace(/^\/api\//, '').replace(/^\//, '')
    const target = new URL(name + u.search, source).href
    return `${base}/api/proxy?url=${encodeURIComponent(target)}&isVod=true`
  } catch {
    return url
  }
}

// ── Notifications de live (Web Push) : Worker principal (base D1) ─────────
async function pushPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** Clé publique VAPID du Worker (base64url). */
export async function pushKey() {
  const res = await fetch(`${API_URL}/api/push/key`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()).key
}
export const pushSubscribe = (subscription, channels, lang) => pushPost('/api/push/subscribe', { subscription, channels, lang })
export const pushUnsubscribe = (subscription) => pushPost('/api/push/unsubscribe', { subscription })
export const pushTest = (subscription, lang) => pushPost('/api/push/test', { subscription, lang })

/** Retour (bug, idée) : rangé par le Worker principal (base D1), qui le
 *  transmet aussi sur Discord. Rend `{ id, token }` : le jeton permet de
 *  suivre la discussion. Lève avec `status` en cas de refus. */
export async function sendFeedback(body) {
  return feedbackPost('/api/feedback', body)
}

/** État et messages des retours envoyés depuis ce navigateur. */
export async function feedbackThreads(items) {
  return feedbackPost('/api/feedback/thread', { items })
}

/** Réponse de la personne dans sa discussion. */
export async function replyFeedback(body) {
  return feedbackPost('/api/feedback/reply', body)
}

/** Photo d'une discussion (le jeton du retour en donne l'accès). */
export function feedbackPhotoUrl(id, n, token) {
  return `${API_URL}/api/feedback/photo?id=${encodeURIComponent(id)}&n=${Number(n)}&token=${encodeURIComponent(token)}`
}

async function feedbackPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    // Réponse faite seulement de captures, refusées (limite du jour) : le
    // Worker le précise, le message affiché n'est pas « trop de messages ».
    err.photosDropped = (await res.json().catch(() => null))?.photosDropped || 0
    throw err
  }
  return res.json()
}

// VODs d'une chaîne : en GQL depuis le navigateur, comme les autres listes.
// La route du Worker ne sait pas donner la suite (curseur de fin nul pour
// les vidéos, Client-ID web) ; elle ne sert plus que de repli pour la
// page 1, et elle épargne une requête Worker par page de chaîne.
const CHANNEL_VODS_Q = `query($l: String!, $after: Cursor) { user(login: $l) { profileImageURL(width: 70)
  videos(first: 100, type: ARCHIVE, sort: TIME, after: $after) {
    edges { cursor node { id title publishedAt lengthSeconds viewCount previewThumbnailURL(height: 180, width: 320) } }
    pageInfo { hasNextPage }
  } } }`
const vodsFrom = (conn) => ({
  videos: (conn?.edges ?? []).map((e) => e?.node).filter((v) => v?.id),
  after: nextCursor(conn),
  more: Boolean(conn?.pageInfo?.hasNextPage),
})

/** Les 100 dernières VODs d'une chaîne : { videos, avatar, pagination,
 *  after, more } — `after` pour la suite (getChannelVideosAfter), `more`
 *  si Twitch en a d'autres. null si la chaîne n'existe pas. Twitch
 *  injoignable depuis le navigateur : la route du Worker, sans suite. */
export async function getChannelVideos(login) {
  let data
  try {
    data = await gql(CHANNEL_VODS_Q, { l: login, after: null })
  } catch {
    const w = await workerJson(`/api/get-channel-videos?name=${encodeURIComponent(login)}`)
    return { ...w, after: null, more: Boolean(w?.pagination?.hasNextPage) }
  }
  const u = data?.user
  if (!u) return null
  const page = vodsFrom(u.videos)
  return { ...page, avatar: u.profileImageURL ?? '', pagination: { hasNextPage: page.more } }
}

/** VODs suivantes, sans compte (gqlNext) : { videos, after, more, refused }.
 *  Lève sur une panne réseau. */
export async function getChannelVideosAfter(login, after) {
  const r = await gqlNext(CHANNEL_VODS_Q, { l: login, after })
  const page = vodsFrom(r.data?.user?.videos)
  return { ...page, more: page.more || r.refused, refused: r.refused }
}

// ── Récupération de VODs supprimées ──────────────────────────────────────────
// Tout passe par le Worker : le navigateur ne peut joindre ni la source de
// métadonnées ni le CDN de Twitch (CORS).
export function getRecoverableStreams(channel) {
  return workerJson(`/api/recover-list?channel=${encodeURIComponent(channel)}`)
}
/** Liens d'une diffusion supprimée, ou lève (404) si le CDN ne la sert plus. */
export async function resolveRecovery(login, streamID, epoch) {
  return viaRelay(await workerJson(`/api/recover-resolve?login=${encodeURIComponent(login)}&streamID=${encodeURIComponent(streamID)}&epoch=${encodeURIComponent(epoch)}`))
}

// La sauvegarde exige le jeton Twitch de son propriétaire : le Worker le fait
// confirmer par Twitch et vérifie qu'il correspond à l'identifiant.
const authHeader = () => (store.token ? { Authorization: `Bearer ${store.token}` } : {})

export async function syncPull(userId) {
  try {
    // Au plus 8 s : l'ouverture de la page attend la synchro (adoptToken).
    return await json(`${API_URL}/api/sync/get?userId=${encodeURIComponent(userId)}`, { headers: authHeader(), signal: AbortSignal.timeout?.(8000) })
  } catch {
    return null
  }
}

/** true si le Worker a gardé la sauvegarde. */
export async function syncPush(userId, data) {
  try {
    const body = JSON.stringify({ userId, data })
    const res = await fetch(`${API_URL}/api/sync/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body,
      // Permet à l'envoi de finir quand l'onglet se ferme (limite : 64 Ko).
      keepalive: body.length < 60_000,
    })
    return res.ok
  } catch { return false /* la sauvegarde distante est un plus, pas une dépendance */ }
}

// ── Helix (compte connecté) ────────────────────────────────────────────────
function helix(path) {
  return json(`https://api.twitch.tv/helix/${path}`, {
    headers: { Authorization: `Bearer ${store.token}`, 'Client-Id': HELIX_CLIENT_ID },
  })
}

/** Vérifie le jeton et renvoie son titulaire et ses droits. `null` = expiré
 *  ou révoqué ; `offline` = Twitch n'a pas répondu (réseau, panne, plus de
 *  8 s : id.twitch.tv filtré laissait la page en suspens). */
export async function validateToken(token) {
  const offline = { userId: null, login: null, scopes: [], offline: true }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token}` },
      signal: ctrl.signal,
    })
    // Une panne de Twitch ne dit rien du jeton : on ne déconnecte pas.
    if (res.status >= 500 || res.status === 429) return offline
    if (!res.ok) return null
    const v = await res.json()
    return { userId: v.user_id, login: v.login, scopes: v.scopes ?? [] }
  } catch {
    // Hors ligne : on ne déconnecte pas pour autant.
    return offline
  } finally {
    clearTimeout(timer)
  }
}

export async function getMe() {
  const data = await helix('users')
  return data?.data?.[0] ?? null
}

export async function getFollowedStreams(userId) {
  const data = await helix(`streams/followed?user_id=${encodeURIComponent(userId)}&first=40`)
  const streams = (data?.data ?? []).map(streamFromHelix)
  // Helix ne donne pas les photos de profil : complétées en une requête.
  const avatars = await getAvatars(streams.map((s) => s.login))
  for (const s of streams) s.avatar = avatars[s.login] ?? ''
  return streams
}

/** Posé à la déconnexion, jamais retiré : dès lors, Twitch montre sa page
 *  d'autorisation (avec « Ce n'est pas vous ? ») au lieu de reconnecter en
 *  silence le compte dont il se souvient — impossible, sinon, de passer sur
 *  un autre compte. */
export const FORCE_VERIFY_KEY = 'tu_force_verify'

export function loginUrl({ chooseAccount = false } = {}) {
  // Valeur aléatoire vérifiée au retour (index.html et main.js).
  const state = crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now()
  try { localStorage.setItem('tu_oauth_state', state) } catch {}
  let verify = chooseAccount
  try { verify ||= localStorage.getItem(FORCE_VERIFY_KEY) === '1' } catch {}
  const params = new URLSearchParams({
    state,
    client_id: HELIX_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'token',
    scope: SCOPES.join(' '),
  })
  if (verify) params.set('force_verify', 'true')
  return `https://id.twitch.tv/oauth2/authorize?${params}`
}

// ── Clips ──────────────────────────────────────────────────────────────────
/** Clips d'une chaîne, les plus vus sur la période (LAST_DAY, LAST_WEEK,
 *  LAST_MONTH, ALL_TIME). */
/** Highlights d'une chaîne (les 50 plus récents). */
export async function getHighlights(login) {
  const data = await gql(`query($l: String!) { user(login: $l) {
    videos(first: 50, type: HIGHLIGHT, sort: TIME) { edges { node {
      id title lengthSeconds createdAt publishedAt viewCount previewThumbnailURL(width: 320, height: 180)
    } } }
  } }`, { l: login })
  return (data?.user?.videos?.edges ?? []).map((e) => e.node).filter((v) => v?.id)
}

/** Playlists (collections) d'une chaîne, avec leurs vidéos — vides exclues. */
export async function getCollections(login) {
  const data = await gql(`query($l: String!) {
    user(login: $l) { collections(first: 20) { edges { node {
      id title description
      items(first: 50) { totalCount edges { node { ... on Video {
        id title lengthSeconds createdAt viewCount
        previewThumbnailURL(width: 320, height: 180)
      } } } }
    } } } }
  }`, { l: login })
  return (data?.user?.collections?.edges ?? [])
    .map((e) => e.node)
    .filter(Boolean)
    .map((c) => ({ ...c, videos: (c.items?.edges ?? []).map((e) => e.node).filter((v) => v?.id), total: c.items?.totalCount ?? 0 }))
    .filter((c) => c.videos.length)
}

const CLIP_PERIOD_DAYS = { LAST_DAY: 1, LAST_WEEK: 7, LAST_MONTH: 30 }
const clipFromHelix = (c) => ({
  slug: c.id, title: c.title ?? '', viewCount: c.view_count ?? 0, durationSeconds: c.duration ?? 0,
  createdAt: c.created_at ?? null, thumbnailURL: c.thumbnail_url ?? '', curator: { displayName: c.creator_name ?? '' },
})

/** Clips les plus vus d'une chaîne sur la période, par tranches de 24.
 *  { items, cursor, locked } — même pagination que les catégories
 *  (servePage) : les 100 premiers, puis la suite sans compte (gqlNext) ;
 *  si Twitch la refuse, Helix continue avec le compte (il lui faut l'id
 *  de la chaîne). */
export async function getClips(login, period = 'LAST_WEEK', cursor = null, broadcasterId = null) {
  const helixFrom = (c) => {
    if (!c.broadcasterId) return { items: [], cursor: null }
    const days = CLIP_PERIOD_DAYS[period]
    const now = new Date()
    // Sans date de fin, Helix s'arrête une semaine après le début.
    const range = days ? `&started_at=${new Date(now - days * 86_400_000).toISOString()}&ended_at=${now.toISOString()}` : ''
    return helixMore(c, `clips?broadcaster_id=${encodeURIComponent(c.broadcasterId)}${range}`, clipFromHelix, (x) => x.slug, 24)
  }
  const q = `query($l: String!, $p: ClipsPeriod, $after: Cursor) {
    user(login: $l) { clips(first: 100, after: $after, criteria: { period: $p, sort: VIEWS_DESC }) { edges { cursor node {
      slug title viewCount durationSeconds createdAt thumbnailURL(width: 480, height: 272)
      curator { displayName }
    } } pageInfo { hasNextPage } } }
  }`
  const from = (data) => ({ items: (data?.user?.clips?.edges ?? []).map((e) => e?.node).filter((c) => c?.slug), next: nextCursor(data?.user?.clips) })
  if (cursor?.rest?.length) return servePage(cursor, 24)
  if (cursor?.next && !cursor.blocked) {
    return gqlMore(cursor, async (after) => {
      const r = await gqlNext(q, { l: login, p: period, after })
      return { ...from(r.data), refused: r.refused }
    }, (c) => c.slug, 24, helixFrom)
  }
  if (cursor) return helixFrom(cursor)
  const data = await gql(q, { l: login, p: period, after: null })
  const { items, next } = from(data)
  return servePage({ rest: items, seen: new Set(items.map((c) => c.slug)), more: Boolean(data?.user?.clips?.pageInfo?.hasNextPage), next, after: null, broadcasterId }, 24)
}

/** Fiche « À propos » d'une chaîne : description, followers, réseaux et
 *  panneaux (image, lien, texte), comme sous le lecteur de Twitch. */
export async function getChannelAbout(login) {
  const data = await gql(`query($l: String!) { user(login: $l) {
    description followers { totalCount }
    channel { socialMedias { name title url } }
    panels { id type ... on DefaultPanel { title imageURL linkURL description } }
  } }`, { l: login })
  const u = data?.user
  if (!u) return null
  return {
    description: u.description ?? '',
    followers: u.followers?.totalCount ?? null,
    socials: (u.channel?.socialMedias ?? []).filter((s) => /^https?:\/\//i.test(s?.url ?? '')),
    panels: (u.panels ?? []).filter((p) => p?.type === 'DEFAULT' && (p.title || p.imageURL || p.description)),
  }
}

/** Un clip prêt à lire : MP4 signé, et de quoi rejouer le chat de la VOD
 *  d'origine à cet instant quand elle existe encore. */
export async function getClip(slug) {
  const data = await gql(`query($s: ID!) { clip(slug: $s) {
    slug title viewCount durationSeconds createdAt
    broadcaster { id login displayName profileImageURL(width: 70) }
    game { id displayName }
    video { id } videoOffsetSeconds
    playbackAccessToken(params: { platform: "web", playerType: "site", playerBackend: "mediaplayer" }) { signature value }
    videoQualities { quality frameRate sourceURL }
  } }`, { s: slug })
  const c = data?.clip
  if (!c?.playbackAccessToken || !c.videoQualities?.length) return null
  const sig = `sig=${encodeURIComponent(c.playbackAccessToken.signature)}&token=${encodeURIComponent(c.playbackAccessToken.value)}`
  const links = {}
  for (const q of c.videoQualities) {
    if (!/^https:\/\//.test(q.sourceURL ?? '')) continue
    const label = `${q.quality}p${q.frameRate >= 50 ? Math.round(q.frameRate) : ''}`
    links[label] = `${q.sourceURL}${q.sourceURL.includes('?') ? '&' : '?'}${sig}`
  }
  return { ...c, links }
}

/** « clips.twitch.tv/Slug » ou « twitch.tv/chaine/clip/Slug » → Slug. */
export function clipSlugFrom(url) {
  const m = String(url).match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:clips\.twitch\.tv\/|twitch\.tv\/[a-z0-9_]+\/clip\/)([A-Za-z0-9_-]{3,100})/i)
  return m ? m[1] : null
}

/**
 * Repères d'une VOD : chapitres (changements de jeu) et passages dont Twitch a
 * coupé le son (musique protégée) — publiés par blocs de 3 min, fusionnés ici.
 */
export async function getVodMarkers(id) {
  const data = await gql(`query($id: ID!) { video(id: $id) {
    moments(first: 50, momentRequestType: VIDEO_CHAPTER_MARKERS) {
      edges { node { positionMilliseconds durationMilliseconds description } }
    }
    muteInfo { mutedSegmentConnection { nodes { offset duration } } }
  } }`, { id })
  const chapters = (data?.video?.moments?.edges ?? [])
    .map((e) => e.node)
    .filter(Boolean)
    .map((n) => ({ start: (n.positionMilliseconds ?? 0) / 1000, duration: (n.durationMilliseconds ?? 0) / 1000, title: n.description ?? '' }))
    .sort((a, b) => a.start - b.start)
  const muted = []
  const raw = (data?.video?.muteInfo?.mutedSegmentConnection?.nodes ?? [])
    .filter((n) => Number(n?.duration) > 0)
    .map((n) => ({ start: Number(n.offset) || 0, end: (Number(n.offset) || 0) + Number(n.duration) }))
    .sort((a, b) => a.start - b.start)
  for (const r of raw) {
    const last = muted[muted.length - 1]
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end)
    else muted.push({ ...r })
  }
  return { chapters, muted }
}
