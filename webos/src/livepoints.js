// ═══════════════════════════════════════════════════════════════════════════
//  Points de chaîne, série de visionnage et prédictions dans le lecteur TV,
//  avec la session web reçue de l'iPhone (websession.js). La logique est
//  dans points.js ; ici le vrai réseau et l'affichage :
//  - solde (nom et icône des points de la chaîne quand Twitch les donne),
//    série et coffre en attente : dans l'en-tête du chat et dans la barre du
//    haut du lecteur ;
//  - avis : « +50 points » (coffre ramassé), ou « Coffre disponible :
//    ramasse-le sur ton téléphone » (refusé sans jeton d'intégrité) ;
//  - prédiction en cours, en lecture seule, au-dessus du chat : Hermes
//    (chat/hermes.js du site, tel quel) et la carte du site (chat/view.js)
//    redessinée pour la TV.
//  Sans session web, ou les deux réglages coupés (« Points de chaîne »,
//  « Série de visionnage »), rien ne part et rien ne s'affiche.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../public/assets/js/api.js'
import { Hermes } from '../../public/assets/js/chat/hermes.js'
import { store } from '../../public/assets/js/store.js'
import { lang, t } from '../../public/assets/js/i18n.js'
import { esc, icon, toast } from '../../public/assets/js/util.js'
import { logError } from '../../public/assets/js/errlog.js'
import { accountGql, webSession, webSessionUserId } from './websession.js'
import { PointsCore, SPADE_DEFAULT, SpadeSender, findSettingsScript, findSpadeUrl, predFromHermes } from './points.js'
import { tt } from './strings.js'

const TICK = 1000
/** spade_url lue dans la page de la chaîne : 30 min ; page illisible
 *  (CORS d'une app installée, le cas le plus probable) : l'adresse par
 *  défaut, 6 h. */
const SPADE_FOUND_MS = 30 * 60_000
const SPADE_DEFAULT_MS = 6 * 3600_000
const PRED_RESULT_MS = 60_000
const PRED_COLORS = { BLUE: '#387aff', PINK: '#f5009b' }

/** Nombre de localStorage (0 sans valeur, ou stockage refusé). */
const stored = (key) => ({
  get: () => { try { return Number(localStorage.getItem(key)) || 0 } catch { return 0 } },
  set: (v) => { try { if (v) localStorage.setItem(key, String(v)); else localStorage.removeItem(key) } catch {} },
})

/** Workers pour /api/spade : l'ordre de lecture du site (api.js,
 *  LOOKUP_BASES) — le personnel d'abord, sinon les secours puis le
 *  principal, dont le quota reste pour ce que lui seul sait faire. */
function relayBases() {
  const all = api.WORKER_BASES
  const custom = api.CUSTOM_WORKER
  return custom ? [custom, ...all.filter((b) => b !== custom)] : [...all.slice(1), all[0]]
}

async function fetchText(url, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

let spadeCache = null   // { url, until }
/** Adresse du spade : dans la page de la chaîne (sans cookie), sinon dans
 *  son settings.<hash>.js, comme l'iPhone et l'extension ; page illisible,
 *  celle d'aujourd'hui (points.js, SPADE_DEFAULT). */
async function spadeUrl(login) {
  if (spadeCache && spadeCache.until > Date.now()) return spadeCache.url
  let url = null
  try {
    const html = await fetchText(`https://www.twitch.tv/${encodeURIComponent(login)}`, 8000)
    url = findSpadeUrl(html)
    const settings = url ? null : findSettingsScript(html)
    if (settings) url = findSpadeUrl(await fetchText(settings, 8000))
  } catch { url = null }
  if (!url) console.info(`[TwitchUnblock] spade_url illisible depuis la TV : ${SPADE_DEFAULT}`)
  spadeCache = { url: url || SPADE_DEFAULT, until: Date.now() + (url ? SPADE_FOUND_MS : SPADE_DEFAULT_MS) }
  return spadeCache.url
}

const fmt = (n) => Number(n).toLocaleString(lang())
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : fmt(n))

/** Solde, coffre, série. `full` : barre du haut (nombre entier, nom des
 *  points) ; sinon l'en-tête du chat, plus étroit. */
function pillHtml(v, full) {
  let html = ''
  if (v.balance != null) {
    const ic = v.icon ? `<img class="tvp-ic" src="${esc(v.icon)}" alt="" onerror="this.remove()">` : icon('points', 26)
    const n = v.gain ? `+${fmt(v.gain)}` : full ? fmt(v.balance) : compact(v.balance)
    html += `<span class="tvp-bal${v.gain ? ' gain' : ''}">${ic}<b>${esc(n)}</b>${full && v.name ? `<span class="tvp-name">${esc(v.name)}</span>` : ''}</span>`
  }
  if (v.chest === 'phone') html += `<span class="tvp-chest">${icon('gift', 26)}</span>`
  if (v.streak > 0) html += `<span class="tvp-streak">${icon('flame', 26)}<b>${esc(fmt(v.streak))}</b></span>`
  return html
}

export class LivePoints {
  /**
   * @param {{ side: HTMLElement, events: HTMLElement }} o  en-tête du chat
   *        (solde), et la place de la carte de prédiction au-dessus du chat
   */
  constructor(o) {
    this.o = o
    this.top = null
    this.isPlaying = () => false
    this.timer = null
    this.hermes = null
    this.hermesFor = null
    this.pred = null
    this.predHide = null
    this.core = new PointsCore({
      gql: (body, opts) => accountGql(body, opts),
      spade: new SpadeSender({
        fetch: (url, init) => fetch(url, init),
        bases: relayBases,
        log: (msg) => logError('points', msg),
        workerUntil: stored('tu_tv_spade_worker'),
      }),
      spadeUrl,
      userId: () => webSessionUserId(),
      log: (msg) => logError('points', msg),
      info: (msg) => console.info(`[TwitchUnblock] ${msg}`),
      claimPause: stored('tu_tv_chest_pause'),
      onChange: (v) => this.paint(v),
      onNotice: (kind, n) => this.notice(kind, n),
    })
  }

  /**
   * Direct ouvert. Rien sans session web valide, ni si les deux réglages
   * sont coupés.
   * @param {object} a
   * @param {string} a.login
   * @param {string | null} a.channelId
   * @param {() => string | null} a.broadcastId  id du direct (fiche relue toutes les 45 s)
   * @param {HTMLElement} a.top  place du solde dans la barre du haut
   * @param {() => boolean} a.isPlaying  direct en lecture (ni pause, ni erreur, ni app cachée)
   */
  start({ login, channelId, broadcastId, top, isPlaying }) {
    this.stop()
    const ws = webSession
    if (!ws || ws.expired) return
    const points = store.prefs.tvPoints !== false
    const streak = store.prefs.tvStreak !== false
    if (!points && !streak) return
    this.top = top
    this.isPlaying = isPlaying
    this.points = points
    this.core.start({ login, channelId, broadcastId, points, streak })
    this.timer = setInterval(() => this.tick(), TICK)
  }

  tick() {
    // Session oubliée ou refusée par Twitch pendant le direct : tout s'arrête.
    if (!webSession || webSession.expired) { this.stop(); return }
    this.core.tick(this.isPlaying())
    // Prédictions : dès que l'id de la chaîne est connu (fiche ou solde).
    const id = this.core.channelId
    if (this.points && id && this.hermesFor !== id) this.listenPredictions(id)
    this.paintPredState()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
    this.core.stop()
    this.hermes?.stop()
    this.hermes = null
    this.hermesFor = null
    this.showPrediction(null)
    this.paint(null)
    this.top = null
  }

  paint(v) {
    const boxes = [[this.top, true], [this.o.side, false]]
    for (const [box, full] of boxes) {
      if (!box) continue
      const html = v ? pillHtml(v, full) : ''
      if (box.innerHTML !== html) box.innerHTML = html
      box.hidden = !html
    }
  }

  notice(kind, n) {
    if (kind === 'chest-ok') toast(n ? t('pts_gain', { n: fmt(n) }) : tt('tv_pts_chest_done'), 'success', 3500)
    else if (kind === 'chest-phone') toast(tt('tv_pts_chest_phone'), 'info', 6000)
  }

  // ── Prédictions (lecture seule) ──────────────────────────────────────────
  listenPredictions(channelId) {
    this.hermes?.stop()
    this.hermesFor = channelId
    this.hermes = new Hermes({
      topics: [`predictions-channel-v1.${channelId}`],
      onEvent: (topic, data) => {
        if (this.hermesFor === channelId) this.showPrediction(predFromHermes(data?.data?.event))
      },
    })
  }

  /** Carte de la prédiction : issues en %, points, participants, compte à
   *  rebours, puis l'issue gagnante une minute. Annulée : retirée. */
  showPrediction(p) {
    clearTimeout(this.predHide)
    const box = this.o.events
    if (!p || p.status === 'CANCELED' || p.status === 'CANCEL_PENDING') {
      this.pred = null
      box.innerHTML = ''
      box.hidden = true
      return
    }
    this.pred = p
    const total = Math.max(1, p.outcomes.reduce((n, o) => n + (o.points || 0), 0))
    const rows = p.outcomes.map((o) => {
      const pct = Math.round(((o.points || 0) / total) * 100)
      const win = p.winnerId === o.id
      const color = p.winnerId && !win ? 'var(--muted)' : PRED_COLORS[o.color] || 'var(--purple)'
      return `<div class="tvp-pred-row${win ? ' win' : ''}">
        <div class="tvp-pred-label"><span>${win ? icon('check', 22) : ''}<em>${esc(o.title)}</em></span><span>${pct} % · ${esc(compact(o.points || 0))}${o.users ? ` · ${esc(fmt(o.users))}${icon('user', 20)}` : ''}</span></div>
        <div class="tvp-pred-bar"><i style="width:${pct}%;background:${color}"></i></div></div>`
    }).join('')
    box.innerHTML = `<div class="tvp-pred"><div class="tvp-pred-head">${icon('sparkles', 24)}<b>${esc(p.title)}</b><span class="tvp-pred-state"></span></div>${rows}</div>`
    box.hidden = false
    this.paintPredState()
    if (p.status === 'RESOLVED') this.predHide = setTimeout(() => this.showPrediction(null), PRED_RESULT_MS)
  }

  /** État ou compte à rebours de la prédiction (chaque seconde). */
  paintPredState() {
    const p = this.pred
    const el = p && this.o.events.querySelector('.tvp-pred-state')
    if (!el) return
    let text = p.status === 'RESOLVED' ? t('pred_result') : p.status === 'LOCKED' ? t('pred_locked')
      : p.status === 'RESOLVE_PENDING' ? t('pred_pending') : ''
    if (p.status === 'ACTIVE' && p.endsAt) {
      const s = Math.max(0, Math.round((p.endsAt - Date.now()) / 1000))
      text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }
    if (el.textContent !== text) el.textContent = text
  }
}
