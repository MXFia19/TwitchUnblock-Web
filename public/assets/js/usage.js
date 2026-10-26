// ═══════════════════════════════════════════════════════════════════════════
//  Comptage d'utilisation du site.
//
//  Même mécanisme que l'app iOS (UsageService.swift) : le navigateur signale
//  « je suis là » au Worker, qui compte les identifiants distincts par jour.
//  Ce qui part : un identifiant tiré au hasard et gardé dans ce navigateur,
//  la version du site, « web » ; si l'on est connecté, le jeton Twitch, pour
//  compter le compte une seule fois sur tous les appareils (le Worker garde
//  l'identifiant et le pseudo Twitch, visibles du seul administrateur). Plus
//  la langue du site, « mobile » ou « ordinateur », et le nombre de lectures
//  depuis le signal précédent (source qui a servi un direct, échecs). Et la
//  version de l'extension TwitchUnblock Connect avec son navigateur, ou son
//  absence (connect.js, usageFields) : ni ses réglages ni la session Twitch.
//  Pas de chaîne regardée, pas d'historique ; pas d'adresse IP.
//
//  Désactivable dans les réglages : l'identifiant est alors effacé côté
//  serveur.
// ═══════════════════════════════════════════════════════════════════════════

import { API_URL } from './api.js'
import { uid } from './util.js'
import { connect, usageFields } from './connect.js'

export const SITE_VERSION = '2026.10.26c'
const ID_KEY = 'tu_install_id'
const LAST_KEY = 'tu_last_ping'
const EV_KEY = 'tu_usage_ev'
/** Un signal par heure au plus : le Worker ne compte qu'une fois par jour,
 *  inutile de lui écrire à chaque rechargement de page. */
const PING_EVERY = 60 * 60 * 1000

export function installId() {
  let id = null
  try { id = localStorage.getItem(ID_KEY) } catch {}
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = uid()
    // Repli si randomUUID manque : on garde la forme d'un UUID, seule acceptée.
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
    }
    try { localStorage.setItem(ID_KEY, id) } catch {}
  }
  return id
}

function post(body) {
  // Connecté : le jeton Twitch permet au Worker de compter le compte (une
  // seule fois sur tous les appareils) au lieu de cet identifiant aléatoire.
  let token = null
  try { token = localStorage.getItem('twitch_token') } catch {}
  return fetch(`${API_URL}/api/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    keepalive: true,
  })
}

/** Le stockage garde-t-il vraiment l'identifiant ? En navigation privée
 *  stricte ou stockage bloqué, chaque visite tirerait un nouvel identifiant
 *  et compterait une « nouvelle personne » : on ne compte pas. */
function storageWorks() {
  try {
    localStorage.setItem('tu_probe', '1')
    const ok = localStorage.getItem('tu_probe') === '1'
    localStorage.removeItem('tu_probe')
    return ok
  } catch { return false }
}

/** Une vraie visite : page affichée au moins 5 min au total, onglet visible
 *  (un robot, un aperçu de lien ou un simple coup d’œil repartent avant).
 *  Le temps se cumule si l'onglet est masqué puis réaffiché. Résolu une fois
 *  par chargement de page. */
let warm = null
function visibleFor(ms) {
  warm ??= new Promise((resolve) => {
    let left = ms, since = 0, timer = null
    const check = () => {
      clearTimeout(timer)
      if (since) { left -= Date.now() - since; since = 0 }
      if (left <= 0) { document.removeEventListener('visibilitychange', check); return resolve() }
      if (!document.hidden) { since = Date.now(); timer = setTimeout(check, left) }
    }
    document.addEventListener('visibilitychange', check)
    check()
  })
  return warm
}

/** Compteurs de lecture (« live_as », « vod_fail »…), envoyés avec le
 *  signal suivant puis remis à zéro. Jamais de chaîne ni de titre. */
export function count(event, enabled) {
  if (!enabled) return
  try {
    const all = JSON.parse(localStorage.getItem(EV_KEY) || '{}')
    all[event] = (all[event] || 0) + 1
    localStorage.setItem(EV_KEY, JSON.stringify(all))
  } catch {}
}

function pendingEvents() {
  try { return JSON.parse(localStorage.getItem(EV_KEY) || '{}') || {} } catch { return {} }
}

/** Retire ce qui vient de partir (ce qui est arrivé pendant l'envoi reste). */
function clearSent(sent) {
  try {
    const now = pendingEvents()
    for (const [k, n] of Object.entries(sent)) {
      now[k] = Math.max(0, (now[k] || 0) - n)
      if (!now[k]) delete now[k]
    }
    localStorage.setItem(EV_KEY, JSON.stringify(now))
  } catch {}
}

/** Appelé au démarrage et à intervalles réguliers. `enabled` : booléen, ou
 *  fonction relue après l'attente — un signal en attente partait après « Ne
 *  pas partager » et réinscrivait l'identifiant qui venait d'être effacé. */
let inflight = null
export async function ping(enabled) {
  if (inflight) return inflight
  inflight = pingOnce(enabled).finally(() => { inflight = null })
  return inflight
}

/** Langue du site pour le comptage : deux lettres (« fr »), ou avec son
 *  écriture pour le chinois traditionnel (« zh-Hant »), comme les apps — il
 *  aurait été compté « zh », à part de leurs utilisateurs. */
function usageLang(l) {
  const s = String(l || 'en')
  return /^[a-z]{2}-[A-Z][a-z]{3}$/.test(s) ? s : s.slice(0, 2).toLowerCase()
}

async function pingOnce(enabled) {
  const on = () => (typeof enabled === 'function' ? enabled() : enabled)
  if (!on()) return
  // Navigateur piloté par un programme (tests automatisés, robots).
  if (navigator.webdriver) return
  if (!storageWorks()) return
  await visibleFor(5 * 60_000)
  if (!on()) return
  let last = 0
  try { last = Number(localStorage.getItem(LAST_KEY)) || 0 } catch {}
  if (Date.now() - last < PING_EVERY) return
  try {
    const ev = pendingEvents()
    const res = await post({
      id: installId(), version: SITE_VERSION, platform: 'web',
      lang: usageLang(document.documentElement.lang),
      device: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop',
      // Détection finie depuis longtemps (5 min de visite au moins).
      ...usageFields(connect.state()),
      ...(Object.keys(ev).length ? { ev } : {}),
    })
    if (res.ok) {
      try { localStorage.setItem(LAST_KEY, String(Date.now())) } catch {}
      clearSent(ev)
    }
  } catch { /* le comptage ne doit jamais gêner le site */ }
}

/** Juste après une connexion : compté tout de suite comme compte, sans
 *  attendre l'heure suivante (l'historique anonyme est repris côté serveur). */
export function pingNow(enabled) {
  try { localStorage.removeItem(LAST_KEY) } catch {}
  return ping(enabled)
}

/** Refus du comptage : on efface l'identifiant côté serveur. */
export async function forget() {
  try {
    await post({ id: installId(), forget: true })
    localStorage.removeItem(LAST_KEY)
    localStorage.removeItem(EV_KEY)
  } catch {}
}

/** Chiffres agrégés. `null` si le Worker n'a pas encore les routes. */
export async function fetchStats() {
  const res = await fetch(`${API_URL}/api/stats`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}
