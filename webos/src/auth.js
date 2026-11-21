// ═══════════════════════════════════════════════════════════════════════════
//  Compte Twitch par code (Device Code Grant), comme l'app Android
//  (core/Auth.kt) et l'Apple TV : une app installée sur la TV n'a pas de page
//  de retour (elle tourne depuis file://). La TV affiche un code, on le
//  valide sur twitch.tv/activate depuis un téléphone. Même client public que
//  l'iPhone, l'Apple TV et Android (config.js : twitchClientId, repris par
//  api.js pour Helix) ; son jeton de renouvellement évite de se reconnecter
//  quand le jeton expire (au bout de quelques heures).
//
//  Jeton : la clé du site (store.token, « twitch_token ») ; renouvellement
//  et compte à côté. Rien ne part ailleurs que chez Twitch.
//
//  Plusieurs comptes (demande de SuperPikaBoy, 20/11) : le compte actif
//  reste dans ces clés ; les autres sont rangés à part (tu_tv_accounts),
//  chacun avec son jeton de renouvellement et sa session web de l'iPhone
//  (websession.js). Se connecter avec un autre compte range l'actif ; passer
//  à un compte rangé remet ses clés en place, puis l'app redémarre (suivis,
//  chat et points relus pour lui).
// ═══════════════════════════════════════════════════════════════════════════

import { HELIX_CLIENT_ID, getMe, validateToken } from '../../public/assets/js/api.js'
import { store } from '../../public/assets/js/store.js'

/** Suivis (Helix), chat (lire, écrire) : les droits de l'app Android, sans
 *  la couleur du pseudo, dont la TV ne se sert pas. */
export const SCOPES = 'user:read:follows chat:read chat:edit'
const REFRESH_KEY = 'tu_tv_refresh'
const USER_KEY = 'tu_tv_user'
const ACCOUNTS_KEY = 'tu_tv_accounts'
/** Session web de l'iPhone du compte actif (clé de websession.js, lue ici
 *  telle quelle pour la ranger avec son compte). */
const WS_KEY = 'tu_tv_websession'
const MAX_ACCOUNTS = 5
const ID_RE = /^\d{1,20}$/
const ID = 'https://id.twitch.tv/oauth2'

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function write(key, v) {
  try {
    if (v == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {}
}

/** Compte connecté : { id, login, name, avatar } ; null sans compte. */
export let user = store.token ? read(USER_KEY) : null
const listeners = new Set()
/** Appelé à chaque connexion ou déconnexion. */
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const changed = () => { for (const fn of listeners) { try { fn(user) } catch {} } }

async function post(path, params) {
  const res = await fetch(`${ID}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

/** Un code à afficher : { deviceCode, userCode, uri, interval, expiresAt }. */
export async function requestCode() {
  const { status, data } = await post('device', { client_id: HELIX_CLIENT_ID, scopes: SCOPES })
  if (status !== 200 || !data.device_code || !data.user_code) throw new Error(data.message || `HTTP ${status}`)
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    uri: data.verification_uri || 'https://www.twitch.tv/activate',
    interval: Math.max(1, Number(data.interval) || 5),
    expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000,
  }
}

/** Attend la validation du code : 'ok', 'switched' (connecté avec un autre
 *  compte que l'actif, rangé), 'expired' ou 'failed'. `cancelled()` arrête
 *  l'attente (écran fermé). */
export async function waitForApproval(code, cancelled) {
  let interval = code.interval
  while (Date.now() < code.expiresAt) {
    await new Promise((r) => setTimeout(r, interval * 1000))
    if (cancelled()) return 'cancelled'
    let r
    try {
      r = await post('token', {
        client_id: HELIX_CLIENT_ID,
        scopes: SCOPES,
        device_code: code.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    } catch { continue }   // réseau : on réessaie au tour suivant
    if (cancelled()) return 'cancelled'
    if (r.data.access_token) {
      // Un autre compte que celui qui était connecté : 'switched' (l'écran
      // de connexion fait redémarrer l'app pour lui).
      const other = await adopt(r.data.access_token, r.data.refresh_token)
      return user ? (other ? 'switched' : 'ok') : 'failed'
    }
    const msg = String(r.data.message || '').toLowerCase()
    if (msg.includes('slow_down')) interval += 5
    else if (msg.includes('expired')) return 'expired'
    else if (msg && !msg.includes('authorization_pending')) return 'failed'
  }
  return 'expired'
}

/** Comptes rangés sur cette TV (pas l'actif) : [{ user, token, refresh, ws }]. */
export function savedAccounts() {
  const list = read(ACCOUNTS_KEY)
  return Array.isArray(list)
    ? list.filter((a) => a && ID_RE.test(String(a.user?.id || '')) && typeof a.token === 'string' && a.token)
    : []
}

/** Le compte actif, prêt à être rangé (null sans compte). */
function activeEntry() {
  if (!user?.id || !store.token) return null
  let ws = null
  try { ws = JSON.parse(localStorage.getItem(WS_KEY) || 'null') } catch {}
  return { user, token: store.token, refresh: read(REFRESH_KEY), ws: ws && typeof ws === 'object' ? ws : null }
}

/** Nouveau jeton : gardé, et le compte lu chez Twitch. Un autre compte que
 *  l'actif : celui-ci est rangé avec sa session web, et un compte déjà
 *  rangé reprend la sienne. true si le compte a changé (l'app redémarre). */
async function adopt(token, refresh) {
  const prev = activeEntry()
  store.token = token
  write(REFRESH_KEY, refresh || null)
  await loadUser()
  const other = Boolean(prev && user && prev.user.id !== user.id)
  if (other) {
    const saved = savedAccounts().find((a) => a.user.id === user.id)
    write(ACCOUNTS_KEY, [prev, ...savedAccounts().filter((a) => a.user.id !== prev.user.id && a.user.id !== user.id)].slice(0, MAX_ACCOUNTS))
    try {
      if (saved?.ws) localStorage.setItem(WS_KEY, JSON.stringify(saved.ws))
      else localStorage.removeItem(WS_KEY)
    } catch {}
  } else if (user) {
    // Reconnexion d'un compte rangé : il n'est plus à part.
    write(ACCOUNTS_KEY, savedAccounts().filter((a) => a.user.id !== user.id))
  }
  changed()
  return other
}

/** Passe à un compte rangé : l'actif est rangé à son tour, l'autre remis en
 *  place, et l'app redémarre. Son jeton est vérifié (et renouvelé) au
 *  démarrage, comme d'habitude (restore). */
export function switchAccount(id) {
  const list = savedAccounts()
  const target = list.find((a) => a.user.id === id)
  if (!target) return false
  const prev = activeEntry()
  const rest = list.filter((a) => a.user.id !== id)
  write(ACCOUNTS_KEY, (prev ? [prev, ...rest] : rest).slice(0, MAX_ACCOUNTS))
  store.token = target.token
  write(REFRESH_KEY, target.refresh || null)
  write(USER_KEY, target.user)
  try {
    if (target.ws) localStorage.setItem(WS_KEY, JSON.stringify(target.ws))
    else localStorage.removeItem(WS_KEY)
  } catch {}
  location.reload()
  return true
}

/** Retire un compte rangé de la TV : oublié ici et son jeton révoqué chez
 *  Twitch (sans attendre), comme une déconnexion. Sa session web n'est pas
 *  révoquée : c'est celle de l'iPhone. */
export function removeAccount(id) {
  const target = savedAccounts().find((a) => a.user.id === id)
  if (!target) return
  write(ACCOUNTS_KEY, savedAccounts().filter((a) => a.user.id !== id))
  post('revoke', { client_id: HELIX_CLIENT_ID, token: target.token }).catch(() => {})
}

async function loadUser() {
  const me = await getMe().catch(() => null)
  if (!me?.id) return
  user = { id: me.id, login: me.login, name: me.display_name || me.login, avatar: me.profile_image_url || '' }
  write(USER_KEY, user)
}

let renewing = null
/** Jeton renouvelé (refusé ou expiré) : true si c'est fait. Un seul à la
 *  fois : Twitch n'accepte qu'une fois un jeton de renouvellement. Refus
 *  explicite (400, 401) : déconnecté ; panne : rien ne change. */
export function renew() {
  renewing ??= (async () => {
    const refresh = read(REFRESH_KEY)
    if (!refresh) { clear(); return false }
    let r
    try {
      r = await post('token', { client_id: HELIX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refresh })
    } catch { return false }
    if (!r.data.access_token) {
      if (r.status === 400 || r.status === 401) clear()
      return false
    }
    store.token = r.data.access_token
    write(REFRESH_KEY, r.data.refresh_token || refresh)
    return true
  })().finally(() => { renewing = null })
  return renewing
}

/** Au démarrage : jeton vérifié, renouvelé s'il a expiré, compte relu. */
export async function restore() {
  const token = store.token
  if (!token) { user = null; return }
  const v = await validateToken(token)
  if (v?.offline) return   // Twitch injoignable : la session reste
  if (!v && !(await renew())) return
  if (!user || (v && v.userId !== user.id)) await loadUser()
  changed()
}

/** Appel Helix avec le jeton, renouvelé une fois s'il est refusé (401). */
export async function withAuth(fn) {
  try {
    return await fn()
  } catch (e) {
    if (e?.status !== 401 || !store.token || !(await renew())) throw e
    return fn()
  }
}

function clear() {
  store.token = null
  write(REFRESH_KEY, null)
  write(USER_KEY, null)
  user = null
  changed()
}

/** Déconnexion : jeton oublié ici et révoqué chez Twitch (sans attendre). */
export function logout() {
  const token = store.token
  clear()
  if (token) post('revoke', { client_id: HELIX_CLIENT_ID, token }).catch(() => {})
}

/** Le chat peut écrire avec ce jeton (droits du code). */
export const canChat = () => Boolean(store.token && user?.login)
