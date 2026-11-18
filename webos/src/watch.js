// ═══════════════════════════════════════════════════════════════════════════
//  Lecteur plein écran, pour les directs et les VODs.
//
//  Le moteur est celui du site (public/assets/js/player.js : hls.js,
//  qualités, pauses pub annoncées, relais et Workers de secours, reprise sur
//  erreur) ; ses commandes à la souris sont masquées (app.css), celles-ci
//  sont faites pour la télécommande :
//  - commandes masquées : gauche / droite = −10 s / +10 s, OK = pause,
//    haut / bas = la barre de commandes, Retour = fermer le lecteur ;
//  - barre affichée : flèches et OK dans la barre, Retour la masque ;
//  - touches lecture, pause, retour et avance rapides, stop.
//  Le chat se pose sur le côté (réglages : côté, taille, affiché ou non).
//  Le démarrage d'un direct ou d'une VOD reprend celui du site (main.js,
//  openLive / openVod), sans l'extension TwitchUnblock Connect. Avec la
//  session web de l'iPhone, un direct passe d'abord par le compte s'il y
//  est sans pub (abonné, Turbo : websession.js, accountLive), source
//  « Compte Twitch (sans pub) » ; sinon les sources habituelles. Avec elle
//  aussi, pendant un direct : points de chaîne, série de visionnage et
//  prédiction en cours (livepoints.js), dans la barre du haut et le chat.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../public/assets/js/api.js'
import { Player, qualityText, sortQualities } from '../../public/assets/js/player.js'
import { store } from '../../public/assets/js/store.js'
import { lang, t } from '../../public/assets/js/i18n.js'
import { esc, formatClock, formatViewers, icon, toast, uptimeSince } from '../../public/assets/js/util.js'
import { logError } from '../../public/assets/js/errlog.js'
import { slowRelayLine } from '../../public/assets/js/slowrelay.js'
import { canChat } from './auth.js'
import { accountLive, webSession } from './websession.js'
import { TvChat } from './chat.js'
import { LivePoints } from './livepoints.js'
import { createKeyboard } from './keyboard.js'
import { focusEl, popLayer, pushLayer, restoreFocus, sinceKey } from './nav.js'
import { actions, el } from './ui.js'
import { tt } from './strings.js'

const HIDE_MS = 5000
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

/** Nom d'une source du direct (« account » : le compte de la session web). */
const sourceLabel = (id) => (id === 'account' ? tt('tv_src_account') : t(`src_${id}`))

/** Direct par le compte de la session web s'il y est sans pub : { links,
 *  variants, source: 'account' } ; sinon null. `w.accountAdFree` retient si
 *  le compte y est sans pub (le menu des sources le propose alors). */
async function accountFirst(w, login) {
  if (!webSession || webSession.expired) return null
  const acct = await accountLive(login, { lowLatency: store.prefs.lowLatency !== false }).catch(() => null)
  w.accountAdFree = Boolean(acct?.adFree)
  return acct?.links ? acct : null
}

let player = null
let playerRoot = null
let chat = null
let chatRoot = null
/** Points de chaîne du direct (session web de l'iPhone). */
let points = null
/** Lecture en cours : { kind, login, id, links, variants, source, info }. */
let session = null
let lastWorkerSwitch = 0

/** Le lecteur du site, créé une fois (il pose ses écouteurs sur le document). */
function getPlayer() {
  if (player) return player
  playerRoot = document.createElement('div')
  chatRoot = document.createElement('div')
  chatRoot.className = 'pv-chat'
  chat = new TvChat(chatRoot, { getDelay: () => player?.chatDelay() ?? 0 })
  points = new LivePoints({ side: chat.el.points, events: chat.el.events })
  player = new Player(playerRoot, {
    fullscreenTarget: playerRoot,
    prefs: store.prefs,
    savePrefs: () => store.savePrefs(),
    // Ses raccourcis clavier coupés : la télécommande passe par cet écran.
    keysActive: () => false,
    isChatOpen: () => store.prefs.chatOpen !== false,
    onToggleChat: () => {},
    onTime: (cur, duration) => onTime(cur, duration),
    onError: () => {
      const kind = session?.kind
      logError('lecteur', `TV ${kind || '?'} ${session?.login || session?.id || ''} : la lecture s'est arrêtée (${player?.debugInfo?.() || '?'})`)
      current?.showMessage(t(kind === 'live' ? 'err_live' : 'err_vod'), { retry: true })
    },
    onWorkerDown: (base) => switchWorker(base),
    onSlowRelay: (m) => slowRelay(m),
    onUnplayable: (bad, next) => toast(t('quality_unplayable', { q: bad, n: next }), 'info'),
  })
  // App mise en arrière-plan (touche Accueil, autre app) : la lecture
  // s'arrête, plutôt que le son continue derrière une autre app.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && player && !player.video.paused) player.video.pause()
  })
  player.video.addEventListener('pause', () => current?.showUI({ focus: false }))
  player.video.addEventListener('play', () => current?.paint())
  player.video.addEventListener('ended', () => current?.showUI())
  return player
}

/** Écran du lecteur ouvert (un seul à la fois). */
let current = null

/** Débogage sur la TV (ares-inspect, console) : ce que lit le lecteur. */
window.tuDebug = () => (player ? { ...session, links: undefined, info: undefined, player: player.debugInfo() } : null)

/**
 * Relais ou Worker injoignable en pleine lecture : la même vidéo par un
 * autre, au même endroit (main.js, switchWorker). Faux : rien fait, le
 * lecteur retente lui-même avant l'erreur.
 */
function switchWorker(base) {
  const w = session
  if ((w?.kind !== 'live' && w?.kind !== 'vod') || navigator.onLine === false) return false
  if (base === api.RELAY_BASE && w.links && api.markWorkerDown(base)) {
    console.info('[TwitchUnblock] Relais vidéo injoignable, retour au Worker :', base)
    w.links = api.withoutRelay(w.links)
    player.swapLinks(w.links, w.variants)
    return true
  }
  // Relais de Sofia en panne pendant une VOD sortie d'un relais trop lent
  // (slowRelay) : par le Worker, le filet habituel (main.js). Un direct de
  // la source « bg » garde ses relances.
  if (base === api.SOFIA_BASE && w.kind === 'vod' && w.links && api.markWorkerDown(base)) {
    console.info('[TwitchUnblock] Relais de Sofia injoignable, retour au Worker :', base)
    logError('lecteur', 'TV : relais de Sofia injoignable pendant une VOD, retour au Worker')
    w.links = api.withoutSofia(w.links)
    player.swapLinks(w.links, w.variants)
    return true
  }
  if (Date.now() - lastWorkerSwitch < 60_000 || !w.links || !api.hasOtherWorker(base)) return false
  lastWorkerSwitch = Date.now()
  // Direct par le compte : rien à redemander, les mêmes liens par un autre
  // Worker (redemandés à un Worker, ce seraient les sources habituelles).
  if (w.kind === 'live' && w.source === 'account') {
    const moved = api.linksAvoiding(w.links, base)
    if (!moved) return false
    api.markWorkerDown(base)
    w.links = moved
    player.swapLinks(w.links, w.variants)
    return true
  }
  const request = w.kind === 'live' ? api.getLive(w.login, { avoid: base }) : api.getVodLinks(w.id, { avoid: base })
  request.then((links) => {
    if (session !== w) return
    if (!links?.links || !Object.keys(links.links).length) throw new Error('none')
    w.links = links.links
    w.variants = links.variants ?? {}
    player.swapLinks(links.links, w.variants)
    if (w.kind === 'live') { w.source = links.source; player.setLiveSource(links.source) }
  }).catch(() => {
    if (session === w) player.swapLinks(w.links, w.variants)
  })
  return true
}

/**
 * Relais principal trop lent pendant une VOD (player.js, slowrelay.js) : la
 * suite par le relais de Sofia, au même endroit, sans nouvelle instance du
 * lecteur ; le relais écarté des VODs 30 min (main.js, slowRelay).
 */
function slowRelay(m) {
  const w = session
  if (w?.kind !== 'vod' || !w.links) return
  if (!api.markRelaySlow()) {
    if (!w.slowKept) logError('lecteur', `TV ${slowRelayLine(m, 'relais de Sofia indisponible, la VOD reste sur le relais')}`)
    w.slowKept = true
    return
  }
  console.info('[TwitchUnblock] Relais vidéo trop lent pour cette VOD : la suite passe par le relais de Sofia.')
  logError('lecteur', `TV ${slowRelayLine(m, 'la suite passe par le relais de Sofia (relais écarté des VODs 30 min)')}`)
  w.links = api.toSofia(w.links)
  player.moveRelay(w.links, api.RELAY_BASE, api.SOFIA_BASE)
  toast(t('relay_slow'), 'info', 5000)
}

// Relais revenu (api.js) : la vidéo y repasse, deux fois au plus (main.js) —
// sauf une VOD sortie d'un relais trop lent, avant la fin du délai.
window.addEventListener('tu-relay-back', () => {
  const w = session
  if ((w?.kind !== 'live' && w?.kind !== 'vod') || !w.links) return
  const moved = api.backToRelay(w.links, { vod: w.kind === 'vod' })
  if (JSON.stringify(moved) === JSON.stringify(w.links)) return
  w.relayReturns = (w.relayReturns || 0) + 1
  if (w.relayReturns > 2) return
  w.links = moved
  player.swapLinks(w.links, w.variants)
})

let lastSave = 0
function onTime(cur, duration) {
  const w = session
  if (!w) return
  if (w.kind === 'vod') {
    chat.tick(cur)
    if (cur > 0 && Math.abs(cur - lastSave) > 5) {
      lastSave = cur
      store.setProgress(w.id, cur)
      if (Number.isFinite(duration) && duration > 0) store.setLength(w.id, duration)
    }
  }
  current?.tickUI()
}

/** Ordre des sources : `id` en tête ; le direct repart par lui (main.js,
 *  switchLiveSource). « account » (le compte de la session web, proposé
 *  quand il est sans pub sur la chaîne) ne change pas l'ordre retenu. */
async function switchSource(id) {
  if (id !== 'account') {
    const order = [id, ...api.liveSourceOrder().filter((x) => x !== id)]
    store.prefs.liveSourceOrder = order
    store.prefs.liveSource = null
    store.savePrefs()
  }
  const w = session
  if (w?.kind !== 'live') return
  const links = id === 'account' ? await accountFirst(w, w.login) : await api.getLive(w.login).catch(() => null)
  if (session !== w) return
  if (!links?.links || !Object.keys(links.links).length) { toast(t('err_live'), 'error'); return }
  w.links = links.links
  w.variants = links.variants ?? {}
  w.source = links.source
  player.swapLinks(links.links, w.variants)
  player.setLiveSource(links.source)
  if (links.source) toast(tt('tv_source_now', { s: sourceLabel(links.source) }), 'info')
  current?.paint()
}

/**
 * Écran du lecteur. `what` : { kind: 'live', login } ou { kind: 'vod', id,
 * preset: { title, thumb, streamer } }.
 */
export function watchScreen(what) {
  const p = getPlayer()
  const root = el(`<div class="screen watch">
    <div class="pv-stage">
      <div class="pv-ui">
        <div class="pv-top">
          <img class="pv-avatar" alt="" hidden>
          <div class="pv-top-text"><b class="pv-name"></b><span class="pv-title"></span><span class="pv-sub"></span></div>
          <span class="pv-points" hidden></span>
          <span class="pv-badge" hidden></span>
        </div>
        <div class="pv-bottom">
          <div class="pv-progress" data-focusable tabindex="0" hidden>
            <span class="pv-time-cur"></span>
            <div class="pv-track"><i class="pv-played"></i></div>
            <span class="pv-time-end"></span>
          </div>
          <div class="pv-bar"></div>
        </div>
      </div>
      <div class="pv-loading"><span class="spinner"></span><span class="pv-loading-text"></span></div>
      <div class="pv-msg" hidden><p class="pv-msg-text"></p><div class="pv-msg-actions"></div></div>
    </div>
    <div class="pv-panel" hidden></div>
    <div class="pv-compose" hidden></div>
  </div>`)
  const $ = (s) => root.querySelector(s)
  const stage = $('.pv-stage')
  stage.prepend(playerRoot)
  root.append(chatRoot)
  const ui = {
    top: $('.pv-ui'), avatar: $('.pv-avatar'), name: $('.pv-name'), title: $('.pv-title'), sub: $('.pv-sub'),
    points: $('.pv-points'), badge: $('.pv-badge'), progress: $('.pv-progress'), cur: $('.pv-time-cur'), end: $('.pv-time-end'),
    played: $('.pv-played'), bar: $('.pv-bar'), loading: $('.pv-loading'), loadingText: $('.pv-loading-text'),
    msg: $('.pv-msg'), msgText: $('.pv-msg-text'), msgActions: $('.pv-msg-actions'), panel: $('.pv-panel'), compose: $('.pv-compose'),
  }

  let uiOn = false
  let hideTimer = null
  let infoTimer = null
  let uptimeTimer = null
  let panelLayer = null
  let composeLayer = null
  let seekRun = 0
  let lastSeekAt = 0

  function applyChat() {
    const on = store.prefs.chatOpen !== false
    root.classList.toggle('chat-on', on)
    root.classList.toggle('chat-left', store.prefs.tvChatSide === 'left')
    root.classList.remove('chat-s', 'chat-m', 'chat-l')
    root.classList.add(`chat-${['s', 'm', 'l'].includes(store.prefs.tvChatSize) ? store.prefs.tvChatSize : 'm'}`)
  }

  const btn = (act, ic, label, cls = '') => `<button class="pv-btn ${cls}" type="button" data-act="${act}">${icon(ic, 30)}<span>${esc(label)}</span></button>`

  /** Barre de commandes et infos, selon l'état de la lecture. */
  function paint() {
    const w = session
    if (!w) return
    const paused = p.video.paused
    const live = w.kind === 'live'
    const q = p.quality ? `${qualityText(p.quality)}${p.autoLevel && String(p.quality).toLowerCase() === 'auto' ? ` · ${p.autoLevel}` : ''}` : '—'
    const focusedAct = document.activeElement?.closest?.('.pv-btn')?.dataset.act
    ui.bar.innerHTML = [
      btn('play', paused ? 'play' : 'pause', t(paused ? 'play' : 'pause'), 'main'),
      btn('back', 'back10', '−10 s'),
      btn('fwd', 'fwd10', '+10 s'),
      live ? btn('golive', 'radio', t('go_live')) : '',
      btn('quality', 'settings', `${t('quality')} · ${q}`),
      live ? btn('source', 'globe', sourceLabel(p.liveSource || api.liveSourceOrder()[0])) : '',
      !live ? btn('speed', 'gauge', `${t('speed')} · ${p.video.playbackRate.toLocaleString(lang())}×`) : '',
      btn('chat', 'chat', tt(store.prefs.chatOpen !== false ? 'tv_hide_chat' : 'tv_show_chat')),
      live && canChat() ? btn('write', 'send', tt('tv_write')) : '',
      (w.login || w.info?.owner?.login) ? btn('channel', 'user', tt('tv_open_channel')) : '',
    ].join('')
    if (focusedAct && uiOn) {
      const again = ui.bar.querySelector(`[data-act="${focusedAct}"]`)
      if (again) focusEl(again, { reveal: false })
    }
    ui.progress.hidden = live
    tickUI()
  }

  /** Temps, retard et progression (à chaque timeupdate). */
  function tickUI() {
    const w = session
    if (!w || !uiOn) return
    const v = p.video
    if (w.kind === 'vod') {
      const d = v.duration
      ui.cur.textContent = formatClock(v.currentTime)
      ui.end.textContent = Number.isFinite(d) ? formatClock(d) : ''
      ui.played.style.width = Number.isFinite(d) && d > 0 ? `${Math.min(100, (v.currentTime / d) * 100).toFixed(2)}%` : '0%'
    } else {
      const lat = p.liveDelay()
      ui.badge.hidden = false
      ui.badge.textContent = lat > 0 ? `${t('live_now')} · ${lat.toFixed(1)} s` : t('live_now')
    }
  }

  function showUI({ focus = true } = {}) {
    if (!session) return
    if (!uiOn) {
      uiOn = true
      root.classList.add('ui')
      paint()
    }
    if (focus && !panelLayer && !composeLayer) {
      const a = document.activeElement
      if (!(a && ui.top.contains(a))) focusEl(ui.bar.querySelector('[data-act="play"]'), { reveal: false })
    }
    scheduleHide()
  }

  function hideUI() {
    uiOn = false
    root.classList.remove('ui')
    clearTimeout(hideTimer)
  }

  function scheduleHide(ms = HIDE_MS) {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (p.video.paused || panelLayer || composeLayer || !ui.msg.hidden) return
      if (sinceKey() < ms - 100) { scheduleHide(); return }
      hideUI()
    }, ms)
  }

  /** ±secondes : la VOD, ou dans ce que garde le direct (Player.seekBy).
   *  Une touche gardée enfoncée va de plus en plus vite. */
  function seek(dir, repeat) {
    const now = Date.now()
    seekRun = repeat && now - lastSeekAt < 600 ? seekRun + 1 : 0
    lastSeekAt = now
    const step = session?.kind === 'vod' ? (seekRun > 12 ? 60 : seekRun > 4 ? 30 : 10) : 10
    p.seekBy(dir * step)
    if (session?.kind === 'vod') {
      // Barre affichée sans y prendre le focus : on voit où l'on va.
      if (!uiOn) { uiOn = true; root.classList.add('ui'); paint() }
      scheduleHide(2500)
      tickUI()
    }
  }

  function togglePlay() {
    if (!p.el.unmute.hidden) {
      // Lecture lancée sans le son (navigateur) : OK le rend.
      p.video.muted = false
      p.el.unmute.hidden = true
      return
    }
    p.togglePlay()
  }

  // ── Panneau de choix (qualité, source, vitesse) ──────────────────────────
  function openPanel(title, items, onPick) {
    closePanel(false)
    ui.panel.innerHTML = `<h3>${esc(title)}</h3><div class="pv-list" data-scroll="y">${items.map((it) => `<button class="pv-item${it.on ? ' on' : ''}" type="button" data-v="${esc(it.value)}"><span>${esc(it.label)}</span>${it.on ? icon('check', 28) : ''}</button>`).join('')}</div>`
    ui.panel.hidden = false
    ui.panel.onclick = (e) => {
      const b = e.target.closest?.('.pv-item')
      if (!b) return
      closePanel()
      onPick(b.dataset.v)
    }
    panelLayer = pushLayer({
      root: ui.panel,
      initial: () => ui.panel.querySelector('.pv-item.on') || ui.panel.querySelector('.pv-item'),
      onBack: () => closePanel(),
    })
    restoreFocus()
    clearTimeout(hideTimer)
  }

  /** Panneau fermé avant de rendre le focus : sinon il restait sur une
   *  ligne du panneau, retirée aussitôt (focus perdu). */
  function closePanel(restore = true) {
    if (!panelLayer) return
    const layer = panelLayer
    panelLayer = null
    ui.panel.hidden = true
    ui.panel.innerHTML = ''
    popLayer(layer, { restore })
    scheduleHide()
  }

  // ── Écrire dans le chat (compte connecté) ────────────────────────────────
  function openCompose() {
    if (!chat.canSend) { toast(tt('tv_chat_readonly'), 'info', 4000); return }
    const kb = createKeyboard({
      placeholder: tt('tv_chat_placeholder'),
      max: 500,
      symbols: true,
      submit: tt('tv_send'),
      onSubmit: (text) => {
        if (!text.trim()) return
        if (!chat.send(text)) { toast(tt('tv_chat_readonly'), 'info', 4000); return }
        closeCompose()
      },
    })
    ui.compose.innerHTML = ''
    ui.compose.append(kb.el)
    ui.compose.hidden = false
    composeLayer = pushLayer({ root: ui.compose, initial: () => kb.first(), onBack: () => closeCompose() })
    restoreFocus()
    clearTimeout(hideTimer)
  }

  function closeCompose() {
    if (!composeLayer) return
    const layer = composeLayer
    composeLayer = null
    ui.compose.hidden = true
    ui.compose.innerHTML = ''
    popLayer(layer)
    scheduleHide()
  }

  ui.bar.addEventListener('click', (e) => {
    const b = e.target.closest?.('.pv-btn')
    if (!b) return
    const w = session
    switch (b.dataset.act) {
      case 'play': togglePlay(); break
      case 'back': p.seekBy(-10); break
      case 'fwd': p.seekBy(10); break
      case 'golive': p.goLive(); break
      case 'quality': {
        const keys = sortQualities(Object.keys(p.links), p.variants)
        openPanel(t('quality'), keys.map((k) => ({ value: k, label: qualityText(k), on: k === p.quality })), (k) => { p.setQuality(k); paint() })
        return
      }
      case 'source': {
        const cur = p.liveSource ?? api.liveSourceOrder()[0]
        // Le compte de la session web en tête, s'il est sans pub ici.
        const ids = [...(w?.accountAdFree && webSession && !webSession.expired ? ['account'] : []), ...api.liveSourceOrder()]
        openPanel(t('live_source'), ids.map((id) => ({ value: id, label: sourceLabel(id), on: id === cur })), (id) => switchSource(id))
        return
      }
      case 'speed':
        openPanel(t('speed'), SPEEDS.map((s) => ({ value: String(s), label: s === 1 ? t('normal') : `${s}×`, on: p.video.playbackRate === s })), (s) => { p.setSpeed(Number(s)); paint() })
        return
      case 'chat':
        store.prefs.chatOpen = store.prefs.chatOpen === false
        store.savePrefs()
        applyChat()
        break
      case 'write': openCompose(); return
      case 'channel': {
        const login = w?.login || w?.info?.owner?.login
        if (login) actions.openChannel?.(login, { fromPlayer: true })
        return
      }
    }
    paint()
    scheduleHide()
  })

  // ── Messages (erreur, hors ligne, fin du direct) ─────────────────────────
  function showMessage(text, { retry = false, channel = false } = {}) {
    ui.loading.hidden = true
    hideUI()
    ui.msgText.textContent = text
    const login = session?.login || session?.info?.owner?.login
    ui.msgActions.innerHTML = [
      retry ? `<button class="btn" type="button" data-msg="retry">${esc(tt('tv_retry'))}</button>` : '',
      channel && login ? `<button class="btn" type="button" data-msg="channel">${esc(tt('tv_open_channel'))}</button>` : '',
      `<button class="btn" type="button" data-msg="close">${esc(t('back'))}</button>`,
    ].join('')
    ui.msg.hidden = false
    focusEl(ui.msgActions.querySelector('.btn'), { reveal: false })
  }
  ui.msgActions.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-msg]')
    if (!b) return
    if (b.dataset.msg === 'retry') start()
    else if (b.dataset.msg === 'channel') {
      const login = session?.login || session?.info?.owner?.login
      if (login) actions.openChannel?.(login, { fromPlayer: true })
    } else actions.back?.()
  })

  function paintInfo(info) {
    const w = session
    if (!w) return
    if (w.kind === 'live') {
      const s = info?.stream
      ui.name.textContent = info?.displayName || w.login
      ui.title.textContent = s?.title || info?.broadcastSettings?.title || ''
      const parts = [s?.game?.displayName, s ? `${formatViewers(s.viewersCount)} ${t('viewers')}` : '', s?.createdAt ? uptimeSince(s.createdAt) : '']
      ui.sub.textContent = parts.filter(Boolean).join(' · ')
      setAvatar(info?.profileImageURL)
    } else {
      const m = info
      ui.name.textContent = m?.owner?.displayName || w.preset?.streamer || ''
      ui.title.textContent = m?.title || w.preset?.title || `VOD ${w.id}`
      const date = m?.createdAt ? new Date(m.createdAt).toLocaleDateString(lang(), { day: 'numeric', month: 'long', year: 'numeric' }) : ''
      ui.sub.textContent = [m?.game?.displayName, date].filter(Boolean).join(' · ')
      ui.badge.hidden = false
      ui.badge.textContent = 'VOD'
      setAvatar(m?.owner?.profileImageURL)
    }
  }

  function setAvatar(src) {
    if (src) { ui.avatar.src = src; ui.avatar.hidden = false } else ui.avatar.hidden = true
  }

  // ── Démarrage (main.js du site : openLive, openVod) ──────────────────────
  async function startLive(login) {
    const token = session
    ui.loadingText.textContent = t('loading_live')
    // Le compte de la session web d'abord (sans pub ici), puis les sources
    // habituelles (Worker) s'il n'y est pas ou ne répond pas.
    const live = async () => (await accountFirst(token, login)) ?? (session === token ? api.getLive(login) : null)
    const [links, info] = await Promise.all([
      live().catch((e) => ({ error: e?.code === 'geo_blocked' ? 'geo'
        : e?.status === 404 || e?.status === 400 ? 'missing'
        : e?.status || e?.name === 'AbortError' ? 'failed' : 'network' })),
      api.getChannelInfo(login).catch(() => null),
    ])
    if (session !== token) return
    const ok = links && !links.error && links.links && Object.keys(links.links).length
    const sourcesDown = !ok && links?.error === 'missing' && Boolean(info?.stream)
    if (!ok) {
      if (links?.error !== 'missing' || sourcesDown) logError('direct', `TV ${login} : ${sourcesDown ? 'toutes les sources ont échoué' : links?.error || 'aucun lien'}`)
      const offline = links?.error === 'missing' && Boolean(info) && !sourcesDown
      token.info = info
      paintInfo(info)
      return showMessage(links?.error === 'network' ? t('err_network')
        : links?.error === 'geo' ? t('err_geo_blocked')
        : sourcesDown ? t('err_live_sources')
        : offline ? t('offline') : t('err_live'), { retry: !offline, channel: true })
    }
    token.links = links.links
    token.variants = links.variants ?? {}
    token.source = links.source
    token.info = info
    ui.loading.hidden = true
    p.load({ links: links.links, variants: token.variants, kind: 'live' })
    p.setLiveSource(links.source)
    chat.openLive({ channel: login, channelId: info?.id ?? null })
    // Points, série et prédiction : seulement avec la session web (et
    // selon les réglages) ; une minute regardée seulement pendant la lecture.
    points.start({
      login,
      channelId: info?.id ?? null,
      broadcastId: () => token.info?.stream?.id ?? null,
      top: ui.points,
      isPlaying: () => session === token && !p.video.paused && !p.video.ended && ui.msg.hidden && !document.hidden,
    })
    paintInfo(info)
    paint()
    store.addHistory(login, 'channel', info?.displayName || login, { avatar: info?.profileImageURL || '' })
    // Titre, jeu et spectateurs relus toutes les 45 s ; la fin du direct aussi.
    clearInterval(infoTimer)
    infoTimer = setInterval(async () => {
      if (session !== token) return clearInterval(infoTimer)
      const fresh = await api.getChannelInfo(login).catch(() => null)
      if (!fresh || session !== token) return
      if (!fresh.stream && token.info?.stream) {
        clearInterval(infoTimer)
        p.stop()
        chat.close()
        points.stop()
        return showMessage(tt('tv_live_ended'), { channel: true })
      }
      token.info = fresh
      paintInfo(fresh)
    }, 45_000)
    clearInterval(uptimeTimer)
    uptimeTimer = setInterval(() => { if (uiOn && session === token) paintInfo(token.info) }, 1000)
  }

  async function startVod(id, preset = {}) {
    const token = session
    ui.loadingText.textContent = t('loading_vod')
    const [links, meta] = await Promise.all([
      api.getVodLinks(id).catch((e) => ({ error: e?.status ? 'missing' : 'network' })),
      api.getVodMeta(id).catch(() => null),
    ])
    if (session !== token) return
    token.info = meta
    paintInfo(meta)
    if (!links || links.error || !links.links || !Object.keys(links.links).length) {
      logError('vod', `TV ${id} : ${links?.error || 'aucun lien'}`)
      return showMessage(links?.error === 'network' ? t('err_network') : t('err_vod'), { retry: true, channel: true })
    }
    token.links = links.links
    token.variants = links.variants ?? {}
    token.login = meta?.owner?.login ?? null
    const length = meta?.lengthSeconds ?? 0
    if (length) store.setLength(id, length)
    let startAt = store.getProgress(id)
    if (length && startAt > length - 30) startAt = 0
    if (startAt < 10) startAt = 0
    ui.loading.hidden = true
    lastSave = startAt
    p.load({ links: links.links, variants: token.variants, kind: 'vod', startAt })
    api.getVodMarkers(id).then((m) => {
      if (session !== token) return
      p.setChapters(m.chapters)
      p.setMuted(m.muted)
      p.setBroadcastStart(m.broadcastStart)
    }).catch(() => {})
    chat.openVod({ videoId: id, channelId: meta?.owner?.id ?? null, channelLogin: meta?.owner?.login ?? null, startAt })
    if (startAt) toast(t('resume_at', { t: formatClock(startAt) }))
    store.addHistory(id, 'vod', meta?.title || preset.title || `VOD ${id}`, {
      thumb: meta?.previewThumbnailURL || preset.thumb || '',
      streamer: meta?.owner?.displayName || preset.streamer || '',
    })
    paint()
  }

  function start() {
    stopPlayback()
    session = { ...what, links: null, variants: {}, info: null }
    ui.msg.hidden = true
    ui.loading.hidden = false
    ui.badge.hidden = true
    hideUI()
    applyChat()
    if (what.kind === 'live') startLive(what.login)
    else startVod(what.id, what.preset)
  }

  function stopPlayback() {
    clearInterval(infoTimer)
    clearInterval(uptimeTimer)
    p.destroy()
    chat.close()
    points.stop()
    lastSave = 0
  }

  const screen = {
    el: root,
    initial: () => (ui.msg.hidden ? null : ui.msgActions.querySelector('.btn')),
    showMessage,
    showUI,
    paint,
    tickUI,
    onShow() {
      current = screen
      // Revenu sur le lecteur après un écran posé dessus : il repart.
      if (!session) start()
    },
    onHide() {
      // Fiche de la chaîne ouverte par-dessus : la lecture s'arrête (le son
      // continuerait derrière un écran sans lecteur).
      if (session) stopPlayback()
      session = null
      hideUI()
    },
    onKey(k, e) {
      if (!session) return false
      // Touches de lecture : toujours pour la vidéo.
      if (k === 'play') { if (p.video.paused) togglePlay(); return true }
      if (k === 'pause') { if (!p.video.paused) p.video.pause(); return true }
      if (k === 'playpause') { togglePlay(); return true }
      if (k === 'stop') { actions.back?.(); return true }
      if (k === 'rewind' || k === 'forward') { seek(k === 'rewind' ? -1 : 1, e.repeat); return true }
      if (!ui.msg.hidden) return false
      if (!uiOn || (!root.contains(document.activeElement) || document.activeElement === document.body)) {
        if (k === 'left' || k === 'right') { seek(k === 'left' ? -1 : 1, e.repeat); return true }
        if (k === 'up' || k === 'down') { showUI(); return true }
        if (k === 'ok') { if (!e.repeat) { togglePlay(); if (p.video.paused) showUI() } return true }
        return false
      }
      scheduleHide()
      // Barre de progression choisie : gauche / droite déplacent la lecture.
      if (document.activeElement === ui.progress && (k === 'left' || k === 'right')) { seek(k === 'left' ? -1 : 1, e.repeat); return true }
      return false
    },
    onBack() {
      if (uiOn && ui.msg.hidden) { hideUI(); return true }
      return false
    },
    destroy() {
      if (current === screen) current = null
      closePanel(false)
      closeCompose()
      stopPlayback()
      session = null
      clearTimeout(hideTimer)
      playerRoot.remove()
      chatRoot.remove()
    },
  }
  current = screen
  start()
  return screen
}
