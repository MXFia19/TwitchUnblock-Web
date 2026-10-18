// ════════════════════════════════════════════════════════════════════════════
//  Journal des erreurs du site : erreurs JavaScript, promesses rejetées,
//  erreurs du lecteur (hls.js, vidéo) et échecs notés par le code (Worker,
//  Twitch, direct, VOD). Gardé dans ce navigateur (50 dernières), lisible et
//  copiable dans Réglages → À propos, et joint aux signalements : un bug
//  arrive avec sa trace. Tout passe aussi par la console.
// ════════════════════════════════════════════════════════════════════════════

const KEY = 'tu_errlog'
const MAX = 50

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** Note une erreur. `where` : d'où elle vient (« api », « lecteur »…) ;
 *  `msg` : texte ou Error. La même, moins de 30 s après, est comptée (×N). */
export function logError(where, msg) {
  const text = String(msg?.message || msg || '').trim().slice(0, 300)
  if (!text) return
  console.warn(`[${where}]`, text)
  try {
    const list = read()
    const last = list[0]
    const now = Date.now()
    if (last && last.w === where && last.m === text && now - last.at < 30_000) {
      last.n = (last.n || 1) + 1
      last.at = now
    } else {
      list.unshift({ at: now, w: String(where).slice(0, 40), m: text })
    }
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch { /* stockage bloqué : la console reste */ }
}

export const errorCount = () => read().length

export function clearErrors() {
  try { localStorage.removeItem(KEY) } catch {}
}

/** Lignes lisibles, les plus récentes d'abord : « 2026-10-18 14:03:12 ·
 *  lecteur · … ×3 ». */
export function errorLines(limit = MAX) {
  const pad = (n) => String(n).padStart(2, '0')
  return read().slice(0, limit).map((e) => {
    const d = new Date(e.at)
    const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    return `${when} · ${e.w} · ${e.m}${e.n > 1 ? ` ×${e.n}` : ''}`
  })
}

/** Erreurs non rattrapées de la page (code du site, promesses). */
export function captureGlobalErrors() {
  addEventListener('error', (e) => {
    // Image ou script introuvable : pas une erreur de code.
    if (e.target && e.target !== window) return
    const file = String(e.filename || '').split('/').pop()
    logError('js', `${e.message}${file ? ` (${file}:${e.lineno || 0})` : ''}`)
  })
  addEventListener('unhandledrejection', (e) => {
    // Requête annulée exprès (changement de page, nouvelle recherche).
    if (e.reason?.name === 'AbortError') return
    logError('promise', e.reason)
  })
}
