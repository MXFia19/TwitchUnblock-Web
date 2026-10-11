// ═══════════════════════════════════════════════════════════════════════════
//  Point d'entrée : navigation, accueil, page streamer, lecteur, réglages.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from './api.js'
import { store } from './store.js'
import { LANGS, applyStatic, deviceLang, initLang, setLang, t, lang } from './i18n.js'
import { Player, loadHls, qualityLabel } from './player.js'
import { ChatView } from './chat/view.js'
import { linkifyHtml } from './chat/message.js'
import { Hermes } from './chat/hermes.js'
import * as usage from './usage.js'
import { CHANGELOG } from './changelog.js'
import {
  $, $$, debounce, esc, formatClock, formatDuration, formatViewers, icon, isIOS, isMobile,
  thumb, toast, uptimeSince,
} from './util.js'

// ── État ───────────────────────────────────────────────────────────────────
const session = {
  token: null, userId: null, login: null, avatar: null, scopes: [],
  get canChat() { return Boolean(this.token && this.login && this.scopes.includes('chat:edit') && this.scopes.includes('chat:read')) },
  get needRescope() { return Boolean(this.token && !this.canChat) },
}

const state = {
  tab: 'discover',
  topLang: 'local',       // 'local' (langue choisie) ou 'all'
  loaded: { followed: 0, top: 0 },
  channel: null,          // { login, info, videos }
  watch: null,            // { kind, login?, id?, info, links }
  vodMeta: new Map(),     // id → { title, thumb, streamer }
}

let player = null
let chat = null
let infoTimer = null
let uptimeTimer = null
let channelTimer = null
/** Événements temps réel de la chaîne regardée (raid, fin du live…). */
let hermes = null
let lastSave = 0

// ── Démarrage ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot)

async function boot() {
  initLang(store.prefs.lang)
  loadHls()   // prêt avant le premier clic
  applyStatic()
  renderTopLocal()
  applyLayout()
  applyHomeTab()
  setupCategories()
  loadAnnouncement(true)
  setTimeout(welcomeOrWhatsNew, 900)
  renderIcons()
  bindGlobal()
  setupPlayer()
  renderContinue()
  renderRecentChannels()
  startLiveTicker()
  usage.ping(store.prefs.shareUsage)
  setInterval(() => usage.ping(store.prefs.shareUsage), 15 * 60 * 1000)
  // Installable comme une app (et la coque s'ouvre hors ligne).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }

  // Jeton déjà là (session précédente, ou retour de connexion sans popup).
  if (store.token) await adoptToken(store.token, { silent: true })
  else renderAccount()

  // L'adresse ouvre la page voulue (/xqc, /videos/123, /directory…), et les
  // boutons précédent / suivant du navigateur passent d'une page à l'autre.
  window.addEventListener('popstate', () => applyRoute(routeFromLocation()))
  applyRoute(routeFromLocation(), { initial: true })
}

// ── Adresses comme sur Twitch ──────────────────────────────────────────────
// Remplacer « twitch.tv » par l'adresse du site suffit : /xqc (la chaîne, et
// son direct s'il est en ligne), /xqc/videos, /xqc/clips, /xqc/about,
// /videos/123, /xqc/clip/<clip>, /directory, /directory/category/just-chatting.
// Les anciennes adresses (?channel=, ?id=, ?clip=) marchent toujours.

/** Pendant qu'une adresse est appliquée (chargement, précédent / suivant),
 *  les pages ouvertes remplacent l'entrée d'historique au lieu d'en ajouter. */
let routing = false

/** `watch` marque l'entrée d'un lecteur : « /xqc » est la page de la chaîne,
 *  ou son direct quand on l'a lancé (précédent / suivant le rouvrent). */
function go(path, { replace = false, watch = false } = {}) {
  if (!path) return
  if (location.pathname + location.search === path && Boolean(history.state?.watch) === watch) return
  const entry = watch ? { watch: true } : null
  try {
    if (routing || replace) history.replaceState(entry, '', path)
    else history.pushState(entry, '', path)
  } catch {}
}

/** Adresse de ce que joue le lecteur (une VOD reconstruite n'en a pas). */
function watchPath() {
  const w = state.watch
  if (w?.kind === 'live') return `/${w.login}`
  if (w?.kind === 'vod' && !w.recovered) return `/videos/${w.id}`
  if (w?.kind === 'clip') return w.login ? `/${w.login}/clip/${encodeURIComponent(w.id)}` : `/clip/${encodeURIComponent(w.id)}`
  return null
}

const CHANNEL_SECTIONS = { vods: '', highlights: '/videos?filter=highlights', playlists: '/videos?filter=collections', clips: '/clips', about: '/about' }
const channelPath = (login, tab = state.channelTab ?? 'vods') => `/${login}${CHANNEL_SECTIONS[tab] ?? ''}`
const categoryPath = (c) => `/directory/category/${encodeURIComponent(c.slug || c.id)}`

/** Adresse de la page affichée (sous le lecteur s'il est ouvert). */
function pagePath(tab = state.tab) {
  if (tab === 'categories') return cat.current ? categoryPath(cat.current) : '/directory'
  if (tab === 'channel' && state.channel) return channelPath(state.channel.login)
  return '/'
}

/** L'adresse courante, lue comme une page à ouvrir. */
const routeFromLocation = () => routeFrom(location.pathname, location.search)

/** Une adresse (d'ici ou de twitch.tv) lue comme une page à ouvrir. */
function routeFrom(pathname, search = '') {
  const q = new URLSearchParams(search)
  const clip = q.get('clip')
  const vod = q.get('id') ?? q.get('vod')
  const channel = api.cleanLogin(q.get('channel'))
  // « ?t=1h2m3s » : la VOD démarre à cet instant, comme sur Twitch.
  const at = twitchTime(q.get('t'))
  if (clip) return { clip }
  if (vod) return { vod, at }
  if (channel) return { channel, live: true }
  const parts = pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p) } catch { return p } })
  const [a = '', b = '', c = ''] = parts
  const first = a.toLowerCase()
  if (!first) return { tab: 'discover' }
  if (first === 'videos') return /^\d{6,}$/.test(b) ? { vod: b, at } : { tab: 'discover' }
  if (first === 'clip' && b) return { clip: b }
  if (first === 'directory') {
    if ((b === 'category' || b === 'game') && c) return { category: c }
    return { tab: b === 'following' ? 'discover' : 'categories' }
  }
  if (['discover', 'discovery', 'following'].includes(first)) return { tab: 'discover' }
  const login = api.cleanLogin(a)
  if (!login) return { tab: 'discover' }
  const section = b.toLowerCase()
  if (section === 'clip' && c) return { clip: c }
  if (section === 'videos' && /^\d{6,}$/.test(c)) return { vod: c, at }
  const filter = q.get('filter')
  const tab = section === 'clips' ? 'clips'
    : section === 'about' ? 'about'
    : section === 'videos' ? (filter === 'highlights' ? 'highlights' : filter === 'collections' ? 'playlists' : 'vods')
    : null
  return { channel: login, tab, live: !section }
}

/** « 1h2m3s », « 3723s » ou « 3723 » → secondes (null sinon). */
function twitchTime(raw) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i.exec(String(raw ?? '').trim())
  const sec = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
  return sec > 0 ? sec : null
}

/** Ouvre la page d'une adresse. `initial` : premier chargement (le direct
 *  d'une chaîne en ligne se lance, comme sur Twitch). */
async function applyRoute(r, { initial = false } = {}) {
  routing = true
  try {
    // « /xqc » : son direct au premier chargement (comme sur Twitch), ensuite
    // seulement si cette entrée d'historique était celle du lecteur.
    const live = r.channel && r.live && (initial || Boolean(history.state?.watch))
    // L'entrée du lecteur déjà ouvert (suivant, ou précédent depuis une page
    // ouverte à partir du lecteur) : il repasse en grand.
    const w = state.watch
    if (!initial && w && ((r.vod && w.kind === 'vod' && w.id === r.vod)
      || (r.clip && w.kind === 'clip' && w.id === r.clip)
      || (live && w.kind === 'live' && w.login === r.channel))) {
      expandWatch({ url: false })
      return
    }
    if (r.clip) {
      if (/^[A-Za-z0-9_-]{3,100}$/.test(r.clip)) openClip(r.clip)
      return
    }
    if (r.vod) {
      if (/^\d{6,}$/.test(r.vod)) openVod(r.vod, undefined, { at: r.at })
      return
    }
    // Retour à une page : le lecteur passe en mini-lecteur et continue,
    // comme avec la flèche retour de l'app (la croix le ferme).
    if (!initial) minimizeWatch({ url: false })
    if (r.channel) {
      setTab('channel', { url: false })
      $('#channel-input').value = r.channel
      if (state.channel?.login === r.channel) setChannelTab(r.tab ?? 'vods')
      else await searchChannel(r.channel, { tab: r.tab ?? 'vods' })
      if (live && state.channel?.login === r.channel && state.channel.info?.stream) openLive(r.channel)
      return
    }
    if (r.category) {
      await openCategoryBySlug(r.category)
      return
    }
    if (r.tab === 'categories' && cat.current) closeCategory()
    setTab(r.tab ?? 'discover', { url: false })
  } finally {
    routing = false
  }
}

/** Remplit les emplacements d'icônes déclarés dans le HTML. */
function renderIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, Number(el.dataset.size) || 20))
    el.removeAttribute('data-icon')
  }
}

// ── Session Twitch ─────────────────────────────────────────────────────────
async function adoptToken(token, { silent = false } = {}) {
  const v = await api.validateToken(token)
  if (!v) {
    store.token = null
    Object.assign(session, { token: null, userId: null, login: null, avatar: null, scopes: [] })
    if (!silent) toast(t('session_expired'), 'error')
    else toast(t('session_expired'))
    renderAccount()
    return
  }
  store.token = token
  session.token = token
  if (!v.offline) Object.assign(session, { userId: v.userId, login: v.login, scopes: v.scopes })
  renderAccount()

  if (session.login) {
    api.getAvatars([session.login]).then((a) => { session.avatar = a[session.login] ?? null; renderAccount() })
  }
  if (session.userId) await pullSync()
  if (!silent) usage.pingNow(store.prefs.shareUsage)
  state.loaded.followed = 0
  if (state.tab === 'discover') loadFollowed()
  chat?.sessionChanged()
}

function login(opts) {
  const url = api.loginUrl(opts)
  const w = 500
  const h = 720
  const left = (screen.width - w) / 2
  const top = (screen.height - h) / 2
  const popup = isMobile ? null : window.open(url, 'TwitchLogin', `width=${w},height=${h},left=${left},top=${top}`)
  // Mobile, ou popup bloquée : redirection pleine page. Le script de tête
  // récupère le jeton au retour.
  if (!popup) location.href = url
}

function logout() {
  // Jeton révoqué chez Twitch, pas seulement oublié ici.
  if (session.token) {
    fetch('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: api.HELIX_CLIENT_ID, token: session.token }),
    }).catch(() => {})
  }
  store.token = null
  Object.assign(session, { token: null, userId: null, login: null, avatar: null, scopes: [] })
  // La prochaine connexion passera par la page d'autorisation de Twitch :
  // sans elle, il reconnectait aussitôt le compte dont il se souvient.
  try { localStorage.setItem(api.FORCE_VERIFY_KEY, '1') } catch {}
  renderAccount()
  state.loaded.followed = 0
  loadFollowed()
  chat?.sessionChanged()
  closeSheet()
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return
  const raw = typeof e.data === 'string' ? e.data : ''
  if (!raw.includes('access_token=')) return
  const params = new URLSearchParams(raw.replace(/^#/, ''))
  const token = params.get('access_token')
  let expected = null
  try { expected = localStorage.getItem('tu_oauth_state') } catch {}
  if (!token || !expected || params.get('state') !== expected) return
  try { localStorage.removeItem('tu_oauth_state') } catch {}
  adoptToken(token)
})

function renderAccount() {
  const btn = $('#account-btn')
  if (session.login) {
    btn.innerHTML = session.avatar
      ? `<img src="${esc(session.avatar)}" alt="">`
      : `<span class="initial">${esc(session.login[0].toUpperCase())}</span>`
    btn.title = t('connected_as', { u: session.login })
    btn.classList.add('logged')
  } else {
    btn.innerHTML = `${icon('twitch', 18)}<span>${esc(t('login'))}</span>`
    btn.title = t('login')
    btn.classList.remove('logged')
  }
  renderSettingsAccount()
}

// ── Sauvegarde distante ────────────────────────────────────────────────────
async function pullSync() {
  const data = await api.syncPull(session.userId)
  if (!data) return
  if (Array.isArray(data.history) && data.history.length) {
    // Fusion plutôt que remplacement : ce qui a été vu ici depuis la dernière
    // sauvegarde ne doit pas disparaître.
    const seen = new Set(store.history.map((h) => String(h.term).toLowerCase()))
    store.history = [...store.history, ...data.history.filter((h) => !seen.has(String(h.term).toLowerCase()))].slice(0, 30)
    store.saveHistory()
  }
  for (const [id, time] of Object.entries(data.progress ?? {})) {
    if (time > store.getProgress(id)) store.setProgress(id, time)
  }
  renderContinue()
  renderRecentChannels()
}

// Envoi économe. Avant, chaque sauvegarde de progression (toutes les 5 s de
// lecture) partait au serveur : ~700 écritures par heure de VOD et par
// personne, pour un KV gratuit plafonné à 1 000 écritures par jour au total.
// Désormais un changement ne fait que marquer la sauvegarde « à envoyer » ;
// l'envoi a lieu à la fermeture du lecteur, quand la page passe en arrière-
// plan, ou au plus toutes les 10 minutes — et jamais si rien n'a changé.
const SYNC_EVERY = 10 * 60_000
let syncDirty = false
let lastSyncBody = ''
let lastSyncAt = 0

/** Un changement à sauvegarder. Aucun envoi immédiat. */
function pushSync() { syncDirty = true }

function flushSync({ force = false } = {}) {
  if (!syncDirty || !session.userId) return
  if (!force && Date.now() - lastSyncAt < SYNC_EVERY) return
  // Seule la progression des VODs de l'historique part : le Worker garde
  // déjà les autres (il fusionne), inutile d'alourdir chaque envoi.
  const vods = new Set(store.history.filter((h) => h.type === 'vod').map((h) => String(h.term)))
  const progress = Object.fromEntries(Object.entries(store.allProgress())
    .filter(([id]) => vods.has(id)).map(([id, t]) => [id, Math.round(t)]))
  const data = { history: store.history, progress }
  const body = JSON.stringify(data)
  syncDirty = false
  if (body === lastSyncBody) return
  lastSyncBody = body
  lastSyncAt = Date.now()
  api.syncPush(session.userId, data)
}

setInterval(() => flushSync(), 60_000)
// Fermeture d'onglet, changement d'appli sur mobile : dernier envoi.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSync({ force: true })
  else { loadAnnouncement(); refreshFeedbackInbox() }
})
// Réponses aux retours envoyés d'ici : pastille sur les boutons de retour.
// Après l'évaluation du module : ces fonctions lisent des constantes
// déclarées plus bas.
setTimeout(() => updateFeedbackBadges(), 0)
setTimeout(() => refreshFeedbackInbox(), 4000)
// Page laissée ouverte : la pastille suit sans recharger (au plus toutes
// les 3 min, et seulement onglet visible).
setInterval(() => { if (!document.hidden) refreshFeedbackInbox() }, 3 * 60 * 1000)
window.addEventListener('pagehide', () => flushSync({ force: true }))

// ── Navigation ─────────────────────────────────────────────────────────────
function setTab(tab, { url = true } = {}) {
  state.tab = tab
  if (url) go(pagePath(tab))
  for (const b of $$('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab)
  for (const v of $$('.view')) v.hidden = v.id !== `view-${tab}`
  if (tab === 'discover') {
    const stale = (k) => Date.now() - state.loaded[k] > 90_000
    if (stale('followed')) loadFollowed()
    if (stale('top')) loadTop(state.topLang)
    renderContinue()
  }
  if (tab === 'channel') renderRecentChannels()
  if (tab === 'categories' && !cat.current && (cat.tab === 'followed' || Date.now() - cat.loaded > 120_000)) loadCategories()
  window.scrollTo({ top: 0 })
}

function bindGlobal() {
  document.addEventListener('click', (e) => {
    // Cartes et chaînes sont de vrais liens (/xqc, /videos/…) : Ctrl, Cmd ou
    // Maj + clic ouvrent un nouvel onglet ou une fenêtre, comme partout — le
    // clic molette aussi, sans passer par ici. Un clic simple reste dans la
    // page, sans la recharger.
    const link = e.target.closest('a[href]')
    if (link && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0)) return
    if (link?.matches('[data-live], [data-vod], [data-clip], [data-cat], [data-channel]')) e.preventDefault()

    const tab = e.target.closest('[data-tab]')
    if (tab) return setTab(tab.dataset.tab)

    const del = e.target.closest('[data-del]')
    if (del) {
      e.stopPropagation()
      store.removeHistory(del.dataset.del)
      pushSync()
      renderContinue()
      renderRecentChannels()
      return
    }
    // Pseudo et catégorie d'une carte : avant la carte elle-même (le direct).
    const catLink = e.target.closest('[data-category]')
    if (catLink) {
      if (catLink.closest('#watch')) minimizeWatch({ url: false })
      return openCategoryById(catLink.dataset.category, catLink.dataset.categoryName)
    }
    const chanLink = e.target.closest('[data-channel]')
    if (chanLink) {
      // Depuis le lecteur (pseudo) : réduit en mini-lecteur pour voir la page.
      if (chanLink.closest('#watch')) minimizeWatch({ url: false })
      // L'adresse de la chaîne vient avec elle (searchChannel).
      setTab('channel', { url: false })
      $('#channel-input').value = chanLink.dataset.channel
      return searchChannel(chanLink.dataset.channel)
    }
    const live = e.target.closest('[data-live]')
    if (live) return openLive(live.dataset.live)
    const vod = e.target.closest('[data-vod]')
    if (vod) return openVod(vod.dataset.vod)
    const all = e.target.closest('[data-play-all]')
    if (all) return playPlaylist(all.dataset.playAll)
    const clip = e.target.closest('[data-clip]')
    if (clip) return openClip(clip.dataset.clip)
    const ctab = e.target.closest('[data-ctab]')
    if (ctab) return setChannelTab(ctab.dataset.ctab)
    const period = e.target.closest('[data-clip-period]')
    if (period) return loadChannelClips(period.dataset.clipPeriod)
    const rec = e.target.closest('[data-recover]')
    if (rec) return recoverAndPlay(rec)
    const act = e.target.closest('[data-action]')?.dataset.action
    if (act) actions[act]?.(e)
  })

  // Accueil
  $('#top-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]')
    if (b) loadTop(b.dataset.lang)
  })

  // Streamer
  $('#channel-form').addEventListener('submit', (e) => {
    e.preventDefault()
    hideSuggest()
    searchChannel($('#channel-input').value)
  })
  const debouncedSuggest = debounce(suggestChannels, 250)
  $('#channel-input').addEventListener('input', () => debouncedSuggest(++suggestSeq))
  $('#channel-input').addEventListener('keydown', onSuggestKey)
  $('#channel-input').addEventListener('blur', () => setTimeout(hideSuggest, 150))
  $('#channel-suggest').addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-pick]')
    if (!b) return
    e.preventDefault()
    pickSuggestion(b.dataset.pick)
  })

  // Lien / ID
  $('#link-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const raw = $('#link-input').value.trim()
    const slug = api.clipSlugFrom(raw)
    if (slug) return openClip(slug)
    const id = (raw.match(/videos\/(\d+)/) ?? raw.match(/\b(\d{6,})\b/) ?? [])[1]
    if (!id) return toast(t('invalid_id'), 'error')
    openVod(id, undefined, { at: twitchTime(/[?&]t=([^&#\s]+)/.exec(raw)?.[1]) })
  })

  // Feuilles (réglages, ouvrir dans…)
  $('#sheet-backdrop').addEventListener('click', closeSheet)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#sheet-backdrop').hidden) closeSheet()
  })
}

const actions = {
  login: () => (session.login ? openSettings() : login()),
  logout,
  settings: () => openSettings(),
  'refresh-discover': () => { loadFollowed(); loadTop(state.topLang) },
  'cat-more': () => loadCategories({ more: true }),
  'cat-streams-more': () => cat.current && openCategory(cat.current, { more: true }),
  'cat-back': () => closeCategory(),
  'clips-more': () => loadChannelClips(state.clipPeriod, { more: true }),
  'cat-follow': (e) => {
    const c = cat.current
    if (!c) return
    const list = followedCats()
    store.prefs.followedCategories = isCatFollowed(c.id) ? list.filter((x) => x.id !== c.id) : [{ id: c.id, name: c.name, box: c.box }, ...list].slice(0, 200)
    store.savePrefs()
    const b = e.target.closest('[data-action="cat-follow"]')
    const on = isCatFollowed(c.id)
    b.classList.toggle('on', on)
    b.innerHTML = `${icon('heart', 15)}<span>${esc(t(on ? 'following' : 'follow'))}</span>`
  },
  'whats-new': () => showWhatsNew(CHANGELOG, 'changelog'),
  feedback: () => openFeedback(),
  'feedback-bug': () => openFeedback('bug'),
  'replay-tutorial': () => startTour(),
  'home-offline': () => setHomeTab('offline'),
  'toggle-layout': () => { store.prefs.homeList = !store.prefs.homeList; store.savePrefs(); applyLayout() },
  'follow-local': (e) => {
    const b = e.target.closest('[data-follow]')
    if (!b) return
    toggleLocalFollow(b.dataset.follow)
    const on = isLocallyFollowed(b.dataset.follow)
    b.classList.toggle('on', on)
    b.innerHTML = followLocalInner(on)
  },
  'export-data': () => exportData(),
  'import-data': () => $('#import-file')?.click(),
  'clear-blocked': () => {
    store.prefs.blockedUsers = []
    store.savePrefs()
    toast(t('hidden_cleared'))
    openSettings()
  },
  'clear-channels': () => { store.clearHistory('channel'); pushSync(); renderRecentChannels() },
  'watch-minimize': () => minimizeWatch(),
  'watch-expand': () => expandWatch(),
  'watch-close': () => closeWatch(),
  'watch-toggle-play': () => player.togglePlay(),
  'open-in': () => openInSheet(),
  'see-vods': () => {
    const login = state.watch?.login ?? state.watch?.info?.owner?.login
    if (!login) return
    minimizeWatch({ url: false })
    setTab('channel', { url: false })
    $('#channel-input').value = login
    searchChannel(login)
  },
  'watch-retry': () => {
    const w = state.watch
    if (!w) return
    if (w.kind === 'live') openLive(w.login)
    else openVod(w.id)
  },
}

// Bouton « Suivre » sans compte (page d'une chaîne).
function followLocalInner(on) {
  return `${icon('heart', 15)}<span>${esc(t(on ? 'following' : 'follow'))}</span><small class="muted">· ${esc(t('on_this_device'))}</small>`
}

// ── Cartes ─────────────────────────────────────────────────────────────────
/** Nom de catégorie cliquable (ouvre ses lives), comme sur Twitch ; texte
 *  simple si son identifiant est inconnu. */
function gameLink(id, name) {
  return id ? `<span class="card-link" data-category="${esc(id)}" data-category-name="${esc(name)}">${esc(name)}</span>` : esc(name)
}

/** Tags d'un live, comme sous les cartes de Twitch (langue comprise) : une
 *  seule ligne, ceux qui ne tiennent pas restent masqués. */
function tagsHtml(tags) {
  return tags?.length ? `<div class="tags">${tags.slice(0, 10).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''
}

function streamCard(s) {
  return `
    <a class="card stream-card" href="/${esc(s.login)}" data-live="${esc(s.login)}">
      <div class="thumb">
        <img src="${esc(thumb(s.thumb, 440, 248))}" alt="" loading="lazy" decoding="async">
        <span class="pill live">${esc(t('live_now'))}</span>
        <span class="pill viewers">${icon('eye', 12)}${esc(formatViewers(s.viewers))}</span>
        ${s.startedAt ? `<span class="pill uptime" data-started="${esc(s.startedAt)}">${esc(uptimeSince(s.startedAt))}</span>` : ''}
      </div>
      <div class="card-body">
        ${s.avatar ? `<img class="avatar sm" src="${esc(s.avatar)}" alt="" loading="lazy">` : `<span class="avatar sm placeholder">${esc((s.name || '?')[0])}</span>`}
        <div class="card-text">
          <h3 title="${esc(s.title)}">${esc(s.title)}</h3>
          <p class="name"><span class="card-link" data-channel="${esc(s.login)}">${esc(s.name)}</span></p>
          ${s.game ? `<p class="meta">${gameLink(s.gameId, s.game)}</p>` : ''}
          ${tagsHtml(s.tags)}
        </div>
      </div>
    </a>`
}

function vodCard(v, streamer) {
  state.vodMeta.set(String(v.id), { title: v.title, thumb: v.previewThumbnailURL, streamer, length: v.lengthSeconds })
  const progress = store.getProgress(v.id)
  const ratio = v.lengthSeconds ? Math.min(1, progress / v.lengthSeconds) : 0
  const date = new Date(v.publishedAt ?? v.createdAt)
  const dateStr = Number.isFinite(date.getTime())
    ? date.toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
  return `
    <a class="card vod-card" href="/videos/${esc(v.id)}" data-vod="${esc(v.id)}">
      <div class="thumb">
        <img src="${esc(thumb(v.previewThumbnailURL, 320, 180))}" alt="" loading="lazy" decoding="async"
             onerror="this.src='https://vod-secure.twitch.tv/_404/404_processing_320x180.png'">
        <span class="pill duration">${esc(formatDuration(v.lengthSeconds))}</span>
        ${ratio > 0.01 ? `<span class="progress"><span style="width:${(ratio * 100).toFixed(1)}%"></span></span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-text">
          <h3 title="${esc(v.title)}">${esc(v.title)}</h3>
          <p class="meta">${esc(dateStr)}</p>
        </div>
      </div>
    </a>`
}

function skeleton(n, kind = 'stream') {
  return Array.from({ length: n }, () => `<div class="card skeleton ${kind}"><div class="thumb"></div><div class="card-body"><span></span><span></span></div></div>`).join('')
}

function emptyState(text, iconName = 'radio') {
  return `<div class="empty">${icon(iconName, 28)}<p>${esc(text)}</p></div>`
}

// ── Accueil ────────────────────────────────────────────────────────────────
function renderContinue() {
  const vods = store.history.filter((h) => h.type === 'vod').slice(0, 12)
  const block = $('#continue-block')
  block.hidden = vods.length === 0
  if (!vods.length) return
  $('#continue-rail').innerHTML = vods.map((h) => {
    state.vodMeta.set(String(h.term), { title: h.display, thumb: h.thumb, streamer: h.streamer })
    const p = store.getProgress(h.term)
    const len = store.getLength(h.term)
    const ratio = len ? Math.min(1, p / len) : 0
    return `
      <a class="card rail-card" href="/videos/${esc(h.term)}" data-vod="${esc(h.term)}">
        <div class="thumb">
          <img src="${esc(h.thumb || 'https://vod-secure.twitch.tv/_404/404_processing_320x180.png')}" alt="" loading="lazy">
          ${p > 5 ? `<span class="pill duration">${esc(formatClock(p))}</span>` : ''}
          ${ratio > 0.01 ? `<span class="progress"><span style="width:${(ratio * 100).toFixed(1)}%"></span></span>` : ''}
          <button class="del" type="button" data-del="${esc(h.term)}" aria-label="${esc(t('close'))}">${icon('x', 14)}</button>
        </div>
        <div class="card-body"><div class="card-text">
          <h3 title="${esc(h.display)}">${esc(h.display)}</h3>
          <p class="name">${esc(h.streamer || 'VOD')}</p>
        </div></div>
      </a>`
  }).join('')
}

// ── Suivis sans compte et affichage de l'accueil ─────────────────────────
const localFollows = () => store.prefs.localFollows ?? []
function isLocallyFollowed(login) { return localFollows().includes(String(login).toLowerCase()) }
function toggleLocalFollow(login) {
  const l = String(login).toLowerCase()
  const list = localFollows()
  store.prefs.localFollows = list.includes(l) ? list.filter((x) => x !== l) : [l, ...list].slice(0, 300)
  store.savePrefs()
  state.loaded.followed = 0
}

/** Grille de cartes ou liste façon Twitch, au choix (bouton + réglage). */
function applyLayout() {
  const list = Boolean(store.prefs.homeList)
  for (const id of ['#followed-grid', '#top-grid']) $(id)?.classList.toggle('as-list', list)
  const b = $('#layout-toggle')
  if (b) {
    b.innerHTML = icon(list ? 'grid' : 'list', 18)
    b.title = t(list ? 'layout_grid' : 'layout_list')
    b.setAttribute('aria-label', b.title)
  }
}

async function loadFollowed({ silent = false } = {}) {
  const grid = $('#followed-grid')
  const head = $('#followed-block')
  state.loaded.followed = Date.now()
  const local = localFollows()
  if (!session.token) {
    head.classList.add('logged-out')
    const loginCard = (compact) => `
      <div class="login-card${compact ? ' compact' : ''}">
        ${compact ? '' : `<div class="login-card-icon">${icon('heart', 26)}</div>`}
        <p>${esc(t(compact ? 'login_optional' : 'login_prompt_local'))}</p>
        <button class="btn primary${compact ? ' sm' : ''}" type="button" data-action="login">${icon('twitch', 18)}<span>${esc(t('login'))}</span></button>
      </div>`
    if (!local.length) { grid.innerHTML = loginCard(false); renderOffline([]); return }
    // Sans compte : les chaînes suivies sur cet appareil, par la requête publique.
    if (!silent) { grid.innerHTML = skeleton(Math.min(4, local.length)); offlinePending() }
    try {
      const channels = await api.getChannelsByLogins(local)
      if (session.token) return
      const live = channels.filter((c) => c.stream).map((c) => c.stream).sort((a, b) => b.viewers - a.viewers)
      const offline = channels.filter((c) => !c.stream)
      grid.innerHTML = (live.length ? live.map(streamCard).join('') : noLiveFollowed(offline.length)) + loginCard(true)
      renderOffline(offline, live.length > 0)
    } catch {
      if (!silent) { grid.innerHTML = emptyState(t('err_loading'), 'refresh'); offlineFailed() }
    }
    return
  }
  head.classList.remove('logged-out')
  if (!session.userId) return
  if (!silent) { grid.innerHTML = skeleton(4); offlinePending() }
  const token = session.token
  try {
    // Lives du compte (Helix), plus toutes les chaînes suivies (compte +
    // appareil) pour les lives de l'appareil et la liste hors ligne.
    const [streams, logins] = await Promise.all([
      api.getFollowedStreams(session.userId),
      api.getFollowedLogins(session.userId).catch(() => []),
    ])
    state.accountFollows = logins
    const all = [...new Set([...logins, ...local])]
    const channels = await api.getChannelsByLogins(all).catch(() => null)
    if (session.token !== token) return   // déconnecté entre-temps
    followedRetried = false
    const known = new Set(streams.map((s) => s.login.toLowerCase()))
    const extra = (channels ?? []).filter((c) => c.stream && !known.has(c.login.toLowerCase())).map((c) => c.stream)
    // Mêlés et triés par audience, comme sur Twitch (pas relégués en bas).
    const live = [...streams, ...extra].sort((a, b) => b.viewers - a.viewers)
    const offline = channels ? channels.filter((c) => !c.stream) : null
    grid.innerHTML = live.length ? live.map(streamCard).join('') : noLiveFollowed(offline?.length ?? 0)
    if (offline) renderOffline(offline, live.length > 0)
    else if (!silent) offlineFailed()
  } catch (err) {
    if (session.token !== token) return
    // Une seule nouvelle tentative : un jeton valide mais refusé par Helix
    // (autre application, droit manquant) relançait la boucle sans fin.
    if (err.status === 401 && !followedRetried) { followedRetried = true; await adoptToken(session.token); return }
    // En rafraîchissement silencieux, une panne passagère garde l'existant.
    if (!silent) { grid.innerHTML = emptyState(t('err_loading'), 'refresh'); offlineFailed() }
  }
}

/** Onglet « Hors ligne » pendant le chargement, ou s'il a échoué : une
 *  liste déjà affichée reste en place. */
function offlinePending() {
  const box = $('#followed-offline')
  if (box && !box.querySelector('.offline-list')) box.innerHTML = `<p class="muted small">${esc(t('loading'))}</p>`
}
function offlineFailed() {
  const box = $('#followed-offline')
  if (box && !box.querySelector('.offline-list')) box.innerHTML = emptyState(t('err_loading'), 'refresh')
}

/** Aucune chaîne suivie en live : et, s'il y en a hors ligne, un pas vers
 *  leur onglet. */
function noLiveFollowed(offlineCount) {
  return `<div class="empty">${icon('heart', 28)}<p>${esc(t('no_live_followed'))}</p>${offlineCount
    ? `<button class="btn ghost sm" type="button" data-action="home-offline">${icon('clock', 16)}<span>${esc(t('see_offline', { n: offlineCount }))}</span></button>`
    : ''}</div>`
}

/** Onglet « Hors ligne » : les chaînes suivies hors ligne, pour ouvrir leur
 *  page (VODs, clips, diffusions supprimées) sans chercher. */
function renderOffline(list, anyLive = false) {
  const box = $('#followed-offline')
  if (!box) return
  list = list.slice().sort((a, b) => a.name.localeCompare(b.name, lang()))
  $('#offline-count').textContent = list.length ? String(list.length) : ''
  box.innerHTML = list.length ? `
    <div class="offline-list">${list.map((c) => `
      <a class="offline-row" href="/${esc(c.login)}" data-channel="${esc(c.login)}">
        ${c.avatar ? `<img class="avatar sm" src="${esc(c.avatar)}" alt="" loading="lazy">` : `<span class="avatar sm placeholder">${esc((c.name || '?')[0])}</span>`}
        <span class="offline-text"><span>${esc(c.name)}</span>${c.lastEnd ? `<small class="muted">${esc(offlineFor(null, 0, c.lastEnd))} · ${esc(offlineDate(null, 0, c.lastEnd))}</small>` : ''}</span>
      </a>`).join('')}</div>`
    : emptyState(t(anyLive ? 'offline_all_live' : 'offline_none'), anyLive ? 'radio' : 'heart')
}

// ── Sous-onglets de l'accueil : Suivies | Top | Hors ligne ───────────────
const HOME_TABS = ['followed', 'top', 'offline']
function applyHomeTab() {
  const tab = HOME_TABS.includes(store.prefs.homeTab) ? store.prefs.homeTab : 'followed'
  for (const b of $$('#home-seg [data-home]')) b.classList.toggle('active', b.dataset.home === tab)
  $('#followed-block').hidden = tab !== 'followed'
  $('#top-block').hidden = tab !== 'top'
  $('#offline-block').hidden = tab !== 'offline'
}

function setHomeTab(tab) {
  store.prefs.homeTab = tab
  store.savePrefs()
  applyHomeTab()
}

// ── Catégories ─────────────────────────────────────────────────────────
const cat = { tab: 'all', items: [], cursor: null, q: '', loaded: 0, current: null, streamsCursor: null, locked: false }
const followedCats = () => store.prefs.followedCategories ?? []
/** Jaquette en 285×380 quelle que soit la taille enregistrée (les catégories
 *  suivies gardent l'adresse en 188×250 des versions précédentes). */
const boxArt = (u) => String(u || '').replace(/-\d+x\d+(\.(?:jpe?g|png|webp))$/i, '-285x380$1')
const isCatFollowed = (id) => followedCats().some((c) => c.id === id)

function catCard(c) {
  return `<a class="cat-card" href="/directory/category/${esc(encodeURIComponent(c.slug || c.id))}" data-cat="${esc(c.id)}" data-cat-name="${esc(c.name)}" data-cat-slug="${esc(c.slug ?? '')}" data-cat-box="${esc(c.box)}">
    <div class="cat-box"><img src="${esc(boxArt(c.box))}" alt="" loading="lazy" decoding="async"></div>
    <h3 title="${esc(c.name)}">${esc(c.name)}</h3>
    ${c.viewers != null ? `<p class="meta">${icon('eye', 12)} ${esc(formatViewers(c.viewers))}</p>` : ''}
  </a>`
}

async function loadCategories({ more = false } = {}) {
  const grid = $('#cat-grid')
  for (const b of $$('#cat-seg [data-cat-tab]')) b.classList.toggle('active', b.dataset.catTab === cat.tab)
  $('#cat-search-wrap').hidden = cat.tab !== 'all'
  $('#cat-more').innerHTML = ''
  if (cat.tab === 'followed') {
    const list = followedCats()
    if (!list.length) { grid.innerHTML = emptyState(t('cat_followed_empty_web'), 'heart'); return }
    grid.innerHTML = list.map(catCard).join('')
    // Audience à jour, triées de la plus regardée à la moins regardée.
    try {
      const fresh = await api.getCategoriesByIds(list.map((c) => c.id))
      if (cat.tab !== 'followed') return
      const byId = Object.fromEntries(fresh.map((c) => [c.id, c]))
      grid.innerHTML = list.map((c) => byId[c.id] ?? c).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0)).map(catCard).join('')
    } catch {}
    return
  }
  if (!more) grid.innerHTML = skeleton(12, 'cat')
  try {
    if (cat.q) {
      cat.items = await api.searchCategories(cat.q); cat.cursor = null
    } else {
      const page = await api.getTopCategories(more ? cat.cursor : null)
      cat.items = more ? [...cat.items, ...page.items.filter((x) => !cat.items.some((y) => y.id === x.id))] : page.items
      cat.cursor = page.cursor
      cat.locked = page.locked
    }
    cat.loaded = Date.now()
    grid.innerHTML = cat.items.length ? cat.items.map(catCard).join('') : emptyState(t('no_result'), 'search')
    if (!cat.q) $('#cat-more').innerHTML = moreHtml({ cursor: cat.cursor, locked: cat.locked }, 'cat-more')
  } catch {
    grid.innerHTML = emptyState(t('err_loading'), 'refresh')
  }
}

/** « Charger plus », ou l'invitation à se connecter quand seul le compte
 *  Twitch permet d'aller au-delà des 100 premiers (voir api.servePage). */
function moreHtml(page, action) {
  if (page?.cursor) return `<button class="btn ghost" type="button" data-action="${action}">${esc(t('load_more'))}</button>`
  return page?.locked ? `<p class="muted small">${esc(t('more_needs_login'))}</p>` : ''
}

async function openCategory(c, { more = false } = {}) {
  cat.current = c
  $('#cat-browser').hidden = true
  const box = $('#cat-detail')
  box.hidden = false
  if (!more) {
    go(categoryPath(c))
    const on = isCatFollowed(c.id)
    box.innerHTML = `
      <div class="cat-head">
        <button class="btn ghost sm" type="button" data-action="cat-back">${icon('chevronLeft', 16)}<span>${esc(t('nav_categories'))}</span></button>
        ${c.box ? `<img class="cat-head-box" src="${esc(boxArt(c.box))}" alt="">` : ''}
        <h2>${esc(c.name)}</h2>
        <button class="btn ghost sm follow-local${on ? ' on' : ''}" type="button" data-action="cat-follow">${icon('heart', 15)}<span>${esc(t(on ? 'following' : 'follow'))}</span></button>
      </div>
      <div class="grid${store.prefs.homeList ? ' as-list' : ''}" id="cat-streams">${skeleton(8)}</div>
      <div class="load-more" id="cat-streams-more"></div>`
    window.scrollTo({ top: 0 })
  }
  try {
    const page = await api.getCategoryStreams(c.id, more ? cat.streamsCursor : null)
    if (cat.current !== c) return
    cat.streamsCursor = page.cursor
    const grid = $('#cat-streams')
    const html = page.items.map(streamCard).join('')
    if (more) grid.insertAdjacentHTML('beforeend', html)
    else grid.innerHTML = html || emptyState(t('no_live'))
    $('#cat-streams-more').innerHTML = moreHtml(page, 'cat-streams-more')
  } catch {
    if (!more) $('#cat-streams').innerHTML = emptyState(t('err_loading'), 'refresh')
  }
}

function closeCategory() {
  cat.current = null
  $('#cat-detail').hidden = true
  $('#cat-browser').hidden = false
  go('/directory')
  if (cat.tab === 'followed') loadCategories()
}

/** Une catégorie par son adresse : « just-chatting » (comme sur Twitch) ou
 *  un identifiant numérique. */
async function openCategoryBySlug(slug) {
  setTab('categories', { url: false })
  const c = /^\d+$/.test(slug)
    ? (await api.getCategoriesByIds([slug]).catch(() => []))[0]
    : await api.getCategoryBySlug(slug).catch(() => null)
  if (c) openCategory(c)
}

/** Une catégorie ouverte d'ailleurs (carte de live, lecteur) : on complète
 *  jaquette et nom d'adresse avant d'afficher ses lives. */
async function openCategoryById(id, name = '') {
  setTab('categories', { url: false })
  const [full] = await api.getCategoriesByIds([String(id)]).catch(() => [])
  openCategory(full ?? { id: String(id), name, slug: '', box: '' })
}

function setupCategories() {
  $('#cat-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat-tab]')
    if (b && b.dataset.catTab !== cat.tab) { cat.tab = b.dataset.catTab; loadCategories() }
  })
  $('#cat-grid').addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return
    const c = e.target.closest('[data-cat]')
    if (c) openCategory({ id: c.dataset.cat, name: c.dataset.catName, slug: c.dataset.catSlug, box: c.dataset.catBox })
  })
  $('#cat-search').addEventListener('input', debounce((e) => { cat.q = e.target.value.trim(); loadCategories() }, 350))
  $('#home-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-home]')
    if (b) setHomeTab(b.dataset.home)
  })
}

async function loadTop(language, { silent = false } = {}) {
  state.topLang = language
  state.loaded.top = Date.now()
  for (const b of $$('#top-seg [data-lang]')) b.classList.toggle('active', b.dataset.lang === language)
  const grid = $('#top-grid')
  if (!silent) grid.innerHTML = skeleton(8)
  try {
    const streams = await api.getTopStreams(language === 'all' ? null : topLangCode())
    if (state.topLang !== language) return
    grid.innerHTML = streams.length ? streams.map(streamCard).join('') : emptyState(t('no_live'))
  } catch {
    if (!silent) grid.innerHTML = emptyState(t('err_loading'), 'refresh')
  }
}

/**
 * Accueil vivant : les durées de live avancent chaque seconde, et les
 * listes (spectateurs, nouveaux lives) sont relues chaque minute sans
 * squelette, tant que l'onglet est affiché et la page visible.
 */
function startLiveTicker() {
  setInterval(() => {
    if (document.hidden) return
    for (const el of document.querySelectorAll('[data-started]')) {
      el.textContent = uptimeSince(el.dataset.started)
    }
    if (state.tab !== 'discover' || document.hidden || !$('#watch').hidden && !$('#watch').classList.contains('minimized')) return
    const now = Date.now()
    if (now - state.loaded.top > 60_000) loadTop(state.topLang, { silent: true })
    if (session.userId && now - state.loaded.followed > 60_000) loadFollowed({ silent: true })
  }, 1000)
}

// ── Visite guidée du premier passage et nouveautés ─────────────────────
// Première visite : la visite guidée. Ensuite, à chaque nouvelle version du
// site (SITE_VERSION), les nouveautés pas encore vues.
const SEEN_VERSION = 'tu_seen_version'
// Lu au chargement, avant que le site n'écrive quoi que ce soit : une trace
// d'une visite précédente = pas de tutoriel, mais les nouveautés.
const RETURNING = (() => {
  try { return Boolean(localStorage.getItem('tu_prefs') || localStorage.getItem('twitch_token') || localStorage.getItem('twitch_vod_history')) } catch { return true }
})()
/** Visite guidée remise à plus tard : arrivé par un lien vers une page
 *  précise, elle attend la prochaine ouverture de l'accueil. */
const TOUR_PENDING = 'tu_tour_pending'
function welcomeOrWhatsNew() {
  if (!$('#sheet')?.hidden) return
  // Lien vers une page précise (/xqc/clips, /videos/…, lecture partagée) : la
  // visite guidée, qui passe par l'accueil, l'aurait remplacée — c'est
  // justement par un lien partagé qu'arrivent les nouveaux visiteurs.
  const deepLink = Boolean(state.watch) || location.pathname !== '/'
  let seen = null
  let pending = false
  try {
    seen = localStorage.getItem(SEEN_VERSION)
    pending = localStorage.getItem(TOUR_PENDING) === '1'
  } catch { return }
  if ((!seen && !RETURNING) || pending) {
    try {
      localStorage.setItem(SEEN_VERSION, usage.SITE_VERSION)
      if (deepLink) localStorage.setItem(TOUR_PENDING, '1')
      else localStorage.removeItem(TOUR_PENDING)
    } catch {}
    if (!deepLink) startTour()
    return
  }
  // Une lecture partagée en cours : on ne la couvre pas, les nouveautés
  // attendront la prochaine visite.
  if (state.watch) return
  try { localStorage.setItem(SEEN_VERSION, usage.SITE_VERSION) } catch {}
  const unseen = seen ? CHANGELOG.filter((e) => e.version > seen) : CHANGELOG.slice(0, 1)
  if (unseen.length) showWhatsNew(unseen)
}

/** Nouveautés : celles pas encore vues (au chargement), ou tout le journal
 *  (Réglages → Journal des modifications). */
function showWhatsNew(entries, titleKey = 'whats_new') {
  const l = lang()
  openSheet(`
    <div class="sheet-head"><h2>${icon('sparkles', 20)} ${esc(t(titleKey))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    ${entries.map((e) => `<div class="sheet-section whats-new">
      <h3>${esc(versionDate(e.version))}<small>${esc(e.version)}</small></h3>
      <ul>${(e.items[l] ?? e.items.en).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`).join('')}
    <div class="sheet-section whats-new-actions">
      <button class="btn primary" type="button" data-sheet-close>${esc(t('got_it'))}</button>
      <button class="btn ghost" type="button" data-action="feedback">${icon('bug', 16)}<span>${esc(t('feedback'))}</span></button>
    </div>`)
  $('#sheet').onclick = (e) => { if (e.target.closest('[data-sheet-close]')) closeSheet() }
}

/** « 2026.10.05c » → « 5 octobre 2026 », dans la langue du site. */
function versionDate(version) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version)
  if (!m) return version
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString(lang(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// ── Visite guidée ────────────────────────────────────────────────────────
// Plutôt que des pages d'explication détachées du site, la visite se pose
// sur les vrais écrans : un voile sombre percé autour de l'élément montré,
// et une bulle qui l'explique. Elle ouvre les onglets d'elle-même et, aux
// étapes « appuie dessus », c'est le vrai bouton qui fait avancer.
const TOUR = [
  { card: 'welcome', tab: 'discover' },
  { sel: '#home-seg', tab: 'discover', icon: 'radio', title: 'tour_home_title', text: 'tour_home_text' },
  { sel: '[data-tab="channel"]', tab: 'discover', icon: 'user', title: 'nav_channel', text: 'tour_channel_tab_text', tap: true },
  { sel: '#channel-form', tab: 'channel', icon: 'search', title: 'tour_channel_title', text: 'tour_channel_text' },
  { sel: '[data-tab="link"]', tab: 'channel', icon: 'link', title: 'nav_link', text: 'tour_link_text', tap: true },
  { sel: '[data-tab="categories"]', tab: 'link', icon: 'layers', title: 'nav_categories', text: 'tour_cat_text', tap: true },
  { sel: '.topbar-actions', tab: 'categories', icon: 'settings', title: 'tour_settings_title', text: 'tour_settings_text' },
  { card: 'player', tab: 'discover' },
]
const TOUR_TIPS = [['play', 'tour_tip_keys'], ['clock', 'tour_tip_seek'], ['chevronDown', 'tour_tip_mini'], ['sparkles', 'tour_tip_app']]
const tour = { step: -1, el: null }

function startTour() {
  closeSheet()
  if (!$('#watch').hidden) minimizeWatch({ url: false })
  let root = $('#tour')
  if (!root) {
    root = document.createElement('div')
    root.id = 'tour'
    root.className = 'tour'
    root.innerHTML = '<div class="tour-hole"></div><div class="tour-pop" role="dialog" aria-modal="true"></div>'
    root.addEventListener('click', onTourClick)
    document.body.append(root)
  }
  document.documentElement.classList.add('touring')
  window.addEventListener('resize', placeTour)
  document.addEventListener('keydown', onTourKey, true)
  goTour(0)
}

function endTour() {
  $('#tour')?.remove()
  document.documentElement.classList.remove('touring')
  window.removeEventListener('resize', placeTour)
  document.removeEventListener('keydown', onTourKey, true)
  tour.step = -1
  tour.el = null
  setTab('discover')
}

function goTour(i) {
  if (i < 0) return
  if (i >= TOUR.length) return endTour()
  tour.step = i
  if (state.tab !== TOUR[i].tab) setTab(TOUR[i].tab)
  renderTour()
}

/** Suivant : aux étapes « appuie dessus », c'est le vrai bouton qui agit. */
function nextTour() {
  const s = TOUR[tour.step]
  if (s?.tap && tour.el) tour.el.click()
  goTour(tour.step + 1)
}

/** L'exemplaire affiché d'un élément : les onglets existent en haut
 *  (ordinateur) et dans la barre du bas (téléphone). */
function visibleEl(sel) {
  return [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length > 0) ?? null
}

function renderTour() {
  const s = TOUR[tour.step]
  const pop = $('#tour .tour-pop')
  if (!pop) return
  if (s.card === 'welcome') {
    pop.innerHTML = `
      <div class="tour-badge">${icon('twitch', 34)}</div>
      <h2>${esc(t('tour_welcome_title'))}</h2>
      <p>${esc(t('tour_welcome_text'))}</p>
      <div class="segmented full tour-langs">
        <button type="button" data-tour-lang="auto" class="${store.prefs.lang ? '' : 'active'}">${esc(t('lang_auto'))}</button>
        ${LANGS.map((l) => `<button type="button" data-tour-lang="${l.id}" class="${store.prefs.lang === l.id ? 'active' : ''}">${esc(l.label)}</button>`).join('')}
      </div>
      <button class="btn primary full" type="button" data-tour="next">${esc(t('tour_start'))}</button>
      <button class="link-btn" type="button" data-tour="skip">${esc(t('tour_skip'))}</button>`
  } else if (s.card === 'player') {
    pop.innerHTML = `
      <div class="tour-badge">${icon('play', 34)}</div>
      <h2>${esc(t('tour_player_title'))}</h2>
      <ul class="tour-tips">${TOUR_TIPS.map(([ic, k]) => `<li>${icon(ic, 18)}<span>${esc(t(k))}</span></li>`).join('')}</ul>
      <button class="btn primary full" type="button" data-tour="next">${esc(t('tour_done'))}</button>`
  } else {
    pop.innerHTML = `
      <div class="tour-head"><span class="tour-ic">${icon(s.icon, 16)}</span><strong>${esc(t(s.title))}</strong><small class="muted">${tour.step}/${TOUR.length - 2}</small></div>
      <p>${esc(t(s.text))}</p>
      ${s.tap ? `<p class="tour-tap">${icon('chevronRight', 14)}<span>${esc(t('tour_tap'))}</span></p>` : ''}
      <div class="tour-actions">
        <button class="link-btn" type="button" data-tour="skip">${esc(t('tour_skip'))}</button>
        <button class="icon-btn sm" type="button" data-tour="back" title="${esc(t('back'))}" aria-label="${esc(t('back'))}">${icon('chevronLeft', 18)}</button>
        <button class="btn primary sm" type="button" data-tour="next">${esc(t('next'))}</button>
      </div>`
  }
  pop.classList.toggle('card', Boolean(s.card))
  placeTour()
  pop.querySelector('[data-tour="next"]')?.focus({ preventScroll: true })
}

/** Perce le voile autour de l'élément montré et cale la bulle dessous (ou
 *  dessus, s'il est en bas de l'écran). Refait à chaque redimensionnement. */
function placeTour() {
  const root = $('#tour')
  if (!root || tour.step < 0) return
  const s = TOUR[tour.step]
  const hole = root.querySelector('.tour-hole')
  const pop = root.querySelector('.tour-pop')
  const el = s.sel ? visibleEl(s.sel) : null
  tour.el = el
  root.classList.toggle('tap', Boolean(el && s.tap))
  if (!el) {
    // Carte centrée (accueil, astuces), ou élément introuvable.
    root.classList.add('no-hole')
    Object.assign(hole.style, { top: '50%', left: '50%', width: '0px', height: '0px' })
    pop.style.transition = 'none'
    Object.assign(pop.style, { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' })
    void pop.offsetWidth
    pop.style.transition = ''
    return
  }
  // En quittant une carte centrée, la bulle apparaît à sa place au lieu de
  // glisser depuis le centre (seul le trou s'anime, depuis le centre).
  const fromCard = root.classList.contains('no-hole')
  root.classList.remove('no-hole')
  if (fromCard) pop.style.transition = 'none'
  el.scrollIntoView({ block: 'nearest' })
  const r = el.getBoundingClientRect()
  const pad = 6
  Object.assign(hole.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` })
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const pw = pop.offsetWidth
  const ph = pop.offsetHeight
  const below = r.top + r.height / 2 < vh / 2
  const top = below ? r.bottom + pad + 12 : r.top - pad - 12 - ph
  const left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), vw - pw - 12)
  Object.assign(pop.style, { top: `${Math.max(12, Math.min(top, vh - ph - 12))}px`, left: `${left}px`, transform: 'none' })
  if (fromCard) { void pop.offsetWidth; pop.style.transition = '' }
}

function onTourClick(e) {
  // Les clics de la visite ne concernent pas le reste du site.
  e.stopPropagation()
  const l = e.target.closest('[data-tour-lang]')?.dataset.tourLang
  if (l) return setTourLang(l)
  const act = e.target.closest('[data-tour]')?.dataset.tour
  if (act === 'skip') return endTour()
  if (act === 'back') return goTour(tour.step - 1)
  if (act === 'next') return nextTour()
  // Clic dans le trou d'une étape « appuie dessus » : le vrai bouton.
  const s = TOUR[tour.step]
  if (!s?.tap || !tour.el || e.target.closest('.tour-pop')) return
  const r = tour.el.getBoundingClientRect()
  if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) nextTour()
}

function onTourKey(e) {
  const go = { Escape: endTour, ArrowRight: nextTour, ArrowLeft: () => goTour(tour.step - 1) }[e.key]
  if (!go) return
  e.preventDefault()
  e.stopPropagation()
  go()
}

/** La langue d'abord : toute la visite, et le site derrière, la suivent. */
function setTourLang(l) {
  store.prefs.lang = l === 'auto' ? null : l
  setLang(l === 'auto' ? deviceLang() : l)
  store.savePrefs()
  applyStatic()
  renderAccount()
  refreshTexts()
  renderTour()
}

function creditsHtml() {
  const items = [
    ['Twitch', 'https://www.twitch.tv'],
    ['hls.js', 'https://github.com/video-dev/hls.js'],
    ['BetterTTV', 'https://betterttv.com'],
    ['FrankerFaceZ', 'https://www.frankerfacez.com'],
    ['7TV', 'https://7tv.app'],
    ['recent-messages', 'https://recent-messages.robotty.de'],
    ['Lucide', 'https://lucide.dev'],
    ['Inter', 'https://rsms.me/inter/'],
  ]
  return `
    <p class="credits-title">${esc(t('credits'))}</p>
    <p class="muted small credits">${esc(t('made_by'))} <a href="https://github.com/MXFia19" target="_blank" rel="noopener">MXFia19</a>.
      ${esc(t('thanks'))} ${items.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join(', ')}.
      ${esc(t('not_affiliated'))}</p>`
}

// ── Page streamer ──────────────────────────────────────────────────────────
function renderRecentChannels() {
  const chans = store.history.filter((h) => h.type === 'channel').slice(0, 10)
  const box = $('#recent-channels')
  // Masquables dans les réglages (« Chaînes récentes »).
  box.hidden = chans.length === 0 || store.prefs.showRecent === false
  $('#recent-list').innerHTML = chans.map((h) => `
    <a class="chip" href="/${esc(h.term)}" data-channel="${esc(h.term)}">
      ${h.avatar ? `<img src="${esc(h.avatar)}" alt="">` : icon('user', 14)}
      <span>${esc(h.display)}</span>
      <button type="button" data-del="${esc(h.term)}" aria-label="${esc(t('close'))}">${icon('x', 12)}</button>
    </a>`).join('')
}

let suggestions = []
let suggestIndex = -1
/** Numéro de la frappe en cours. Valider ou choisir l'incrémente : une
 *  suggestion différée arrivée après coup ne rouvre plus la liste par-dessus
 *  les résultats. */
let suggestSeq = 0

async function suggestChannels(seq) {
  if (seq !== suggestSeq) return
  const raw = $('#channel-input').value
  const word = raw.trim().split(/\s+/)[0] ?? ''
  if (!word || raw.trim().includes(' ') || word.length < 2) return hideSuggest()
  const local = store.history
    .filter((h) => h.type === 'channel' && h.term.toLowerCase().includes(word.toLowerCase()))
    .map((h) => ({ login: h.term, displayName: h.display, profileImageURL: h.avatar, stream: null }))
  let remote = []
  try { remote = await api.searchChannels(word) } catch {}
  if (seq !== suggestSeq) return
  const seen = new Set()
  suggestions = [...local, ...remote].filter((s) => s?.login && !seen.has(s.login) && seen.add(s.login)).slice(0, 7)
  suggestIndex = -1
  renderSuggest()
}

function renderSuggest() {
  const box = $('#channel-suggest')
  if (!suggestions.length) return hideSuggest()
  box.innerHTML = suggestions.map((s, i) => `
    <button type="button" class="suggest-row${i === suggestIndex ? ' active' : ''}" data-pick="${esc(s.login)}">
      ${s.profileImageURL ? `<img class="avatar xs" src="${esc(s.profileImageURL)}" alt="">` : `<span class="avatar xs placeholder">${icon('user', 14)}</span>`}
      <span class="suggest-name">${esc(s.displayName || s.login)}</span>
      ${s.stream ? `<span class="pill live sm">${esc(formatViewers(s.stream.viewersCount))}</span>` : ''}
    </button>`).join('')
  box.hidden = false
}

function hideSuggest() { suggestSeq++; $('#channel-suggest').hidden = true; suggestions = [] }

function onSuggestKey(e) {
  if ($('#channel-suggest').hidden || !suggestions.length) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = suggestions.length
    suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n
    renderSuggest()
  } else if (e.key === 'Enter' && suggestIndex >= 0) {
    e.preventDefault()
    pickSuggestion(suggestions[suggestIndex].login)
  } else if (e.key === 'Escape') hideSuggest()
}

function pickSuggestion(login) {
  $('#channel-input').value = login
  hideSuggest()
  searchChannel(login)
}

let searchSeq = 0
let followedRetried = false
async function searchChannel(raw, { tab } = {}) {
  const parts = String(raw || '').trim().split(/\s+/)
  // Un lien Twitch collé (« twitch.tv/xqc », « https://www.twitch.tv/xqc/clips »,
  // une VOD, un clip, une catégorie) : on ouvre ce qu'il désigne.
  const slug = api.clipSlugFrom(parts[0] ?? '')
  if (slug) return openClip(slug)
  const link = /(?:^|\/\/|\.)twitch\.tv(\/[^\s#]*)/i.exec(parts[0] ?? '')
  let route = null
  if (link) {
    try { const u = new URL(link[1], 'https://www.twitch.tv'); route = routeFrom(u.pathname, u.search) } catch {}
    if (route?.vod) return openVod(route.vod, undefined, { at: route.at })
    if (route?.category) return openCategoryBySlug(route.category)
    if (!route?.channel) return route?.tab && setTab(route.tab)
    tab ??= route.tab ?? undefined
  }
  const login = api.cleanLogin(route?.channel ?? parts[0])
  const keyword = parts.slice(1).join(' ').toLowerCase()
  const out = $('#channel-result')
  if (!login) { out.innerHTML = ''; return }

  out.innerHTML = `<div class="channel-hero skeleton"></div><div class="grid vods">${skeleton(8, 'vod')}</div>`
  const seq = ++searchSeq
  const [info, videos] = await Promise.all([
    api.getChannelInfo(login).catch(() => null),
    api.getChannelVideos(login).catch(() => null),
  ])
  if (seq !== searchSeq) return   // une recherche plus récente a pris la main
  if (!info && (!videos || videos.error)) {
    out.innerHTML = emptyState(t('not_found'), 'search')
    return
  }
  if (tab) state.channelTab = tab
  else if (state.channel?.login !== login) state.channelTab = 'vods'
  state.channel = { login, info, videos: videos?.videos ?? [] }
  store.addHistory(login, 'channel', info?.displayName || login, { avatar: info?.profileImageURL || videos?.avatar || '' })
  pushSync()
  renderRecentChannels()
  if (state.tab === 'channel') go(channelPath(login))
  renderChannel(keyword)
}

// Onglets de la page streamer, comme sur Twitch.
const CHANNEL_TABS = [['vods', 'vods'], ['highlights', 'highlights'], ['playlists', 'playlists'], ['clips', 'clips'], ['about', 'about']]

/** Charge le contenu de l'onglet à sa première ouverture. */
function loadChannelTab(tab) {
  if (tab === 'highlights') loadChannelHighlights()
  if (tab === 'playlists') loadChannelPlaylists()
  if (tab === 'clips') loadChannelClips()
  if (tab === 'about') loadChannelAbout()
}

// ── Onglet « À propos » ──────────────────────────────────────────────────
// Ce qu'on trouve sous le lecteur sur Twitch : description, followers,
// réseaux, et les panneaux du streamer (image, lien, texte).
async function loadChannelAbout() {
  const login = state.channel?.login
  if (!login || !$('#channel-about')) return
  state.aboutCache ??= new Map()
  let about = state.aboutCache.get(login)
  if (!about) {
    $('#channel-about').innerHTML = `<p class="muted small">${esc(t('loading'))}</p>`
    about = await api.getChannelAbout(login).catch(() => null)
    if (about) state.aboutCache.set(login, about)
  }
  const box = $('#channel-about')
  if (state.channel?.login !== login || !box) return
  if (!about) { box.innerHTML = emptyState(t('err_loading'), 'refresh'); return }
  const name = state.channel.info?.displayName || login
  box.innerHTML = `
    <div class="about-card">
      <h3>${esc(t('about_channel', { u: name }))}</h3>
      ${about.followers != null ? `<p class="about-followers"><b>${esc(formatViewers(about.followers))}</b> ${esc(t('followers'))}</p>` : ''}
      ${about.description ? `<p class="about-desc">${linkifyHtml(about.description)}</p>` : `<p class="muted small">${esc(t('about_empty'))}</p>`}
      ${about.socials.length ? `<div class="about-socials">${about.socials.map((s) => `
        <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon(socialIcon(s.name), 15)}<span>${esc(s.title || s.name)}</span></a>`).join('')}</div>` : ''}
    </div>
    ${about.panels.length ? `<div class="panels">${about.panels.map(panelCard).join('')}</div>` : ''}`
}

/** Icône d'un réseau (celles du site, sinon un lien générique). */
function socialIcon(name) {
  const n = String(name).toLowerCase()
  return n === 'discord' ? 'discord' : n === 'github' ? 'github' : n === 'twitch' ? 'twitch' : 'external'
}

function panelCard(p) {
  const img = p.imageURL ? `<img src="${esc(p.imageURL)}" alt="${esc(p.title || '')}" loading="lazy" decoding="async">` : ''
  const link = /^https?:\/\//i.test(p.linkURL ?? '') ? p.linkURL : ''
  return `<article class="panel">
    ${img ? (link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${img}</a>` : img) : ''}
    ${p.title ? `<h4>${esc(p.title)}</h4>` : ''}
    ${p.description ? `<div class="panel-text">${panelMarkdown(p.description)}</div>` : ''}
  </article>`
}

/** Le texte des panneaux est du Markdown simple (liens, gras, titres,
 *  listes) : rendu après échappement, sans HTML étranger. */
function panelMarkdown(text) {
  // \u0000 sert de repère aux liens mis de côté (panelInline).
  return String(text).replace(/\u0000/g, '').split('\n').map((line) => {
    // Citation (« > ») : le chevron saute, le texte reste.
    const plain = line.replace(/^\s*>\s?/, '')
    const heading = /^#{1,6}\s+(.*)$/.exec(plain)
    const item = /^\s*[-*+]\s+(.*)$/.exec(plain)
    const html = panelInline(heading ? heading[1] : item ? item[1] : plain)
    if (heading) return `<b class="panel-h">${html}</b>`
    if (item) return `<span class="panel-li">• ${html}</span>`
    return html
  }).join('<br>')
}

/** Une ligne : liens [texte](https://…), liens nus et gras. Les liens sont mis
 *  de côté pendant le gras, qui ne touche ainsi jamais une adresse. */
function panelInline(body) {
  const links = []
  const keep = (a) => `\u0000${links.push(a) - 1}\u0000`
  const bold = (html) => html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>')
  const bare = (s) => linkifyHtml(s).replace(/<a [^>]*>.*?<\/a>/g, keep)
  let html = ''
  let last = 0
  // Une image (![…](…)) devient un simple lien.
  for (const m of body.matchAll(/!?\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi)) {
    html += bare(body.slice(last, m.index))
    html += keep(`<a href="${esc(m[2])}" target="_blank" rel="noopener noreferrer">${bold(esc(m[1] || m[2]))}</a>`)
    last = m.index + m[0].length
  }
  html += bare(body.slice(last))
  return bold(html).replace(/\u0000(\d+)\u0000/g, (_, i) => links[Number(i)])
}

function setChannelTab(tab) {
  state.channelTab = tab
  if (state.channel) go(channelPath(state.channel.login, tab), { replace: true })
  for (const b of $$('#channel-tabs [data-ctab]')) b.classList.toggle('active', b.dataset.ctab === tab)
  for (const p of $$('[data-cpanel]')) p.hidden = p.dataset.cpanel !== tab
  loadChannelTab(tab)
}

async function loadChannelHighlights() {
  const login = state.channel?.login
  const box = $('#channel-highlights')
  if (!login || !box) return
  state.highlightCache ??= new Map()
  let list = state.highlightCache.get(login)
  if (!list) {
    box.innerHTML = skeleton(4, 'vod')
    list = await api.getHighlights(login).catch(() => null)
    if (list) state.highlightCache.set(login, list)
  }
  if (state.channel?.login !== login || !$('#channel-highlights')) return
  const name = state.channel.info?.displayName || login
  $('#channel-highlights').innerHTML = list?.length ? list.map((v) => vodCard(v, name)).join('') : emptyState(t('no_highlights'), 'film')
}

// ── VODs non listées (supprimées ou masquées) ──────────────────────────────
// Une source externe connaît chaque diffusion récente : celles sans VOD dans
// la liste de Twitch ont une VOD supprimée ou masquée. Elles sont rangées à
// leur date parmi les VODs, marquées « VOD non listée », et reconstruites au
// clic. Leur liste arrive après les VODs : la grille ne l'attend pas.
const SAME_STREAM = 15 * 60_000

async function loadUnlisted(login) {
  state.recoverCache ??= new Map()
  if (!state.recoverCache.has(login)) {
    const data = await api.getRecoverableStreams(login).catch(() => null)
    if (!data) return
    state.recoverCache.set(login, data)
  }
  if (state.channel?.login === login) renderVodGrid()
}

/** Diffusions sans VOD listée. Une VOD les couvre si sa vignette porte leur
 *  id de diffusion, ou si elle commence à la même heure (vignette « en cours
 *  de traitement »). Le Worker renvoie 100 VODs au plus : une diffusion plus
 *  ancienne que la dernière reste de côté, sa VOD est peut-être au-delà. */
function unlistedStreams() {
  const ch = state.channel
  const streams = state.recoverCache?.get(ch?.login)?.streams ?? []
  if (!streams.length) return []
  const dated = ch.videos.map((v) => ({ v, t: Date.parse(v.publishedAt) })).filter((x) => Number.isFinite(x.t))
  const oldest = ch.videos.length >= 100 && dated.length ? Math.min(...dated.map((x) => x.t)) : -Infinity
  // Le direct en cours a sa propre page : pas une VOD perdue.
  const liveStart = Date.parse(ch.info?.stream?.createdAt)
  return streams.filter((s) => {
    const start = s.epoch * 1000
    if (dated.some(({ v, t }) => String(v.previewThumbnailURL ?? '').includes(`_${s.streamID}_`) || Math.abs(t - start) < SAME_STREAM)) return false
    if (Number.isFinite(liveStart) && Math.abs(liveStart - start) < SAME_STREAM) return false
    return start >= oldest - SAME_STREAM
  })
}

function unlistedCard(s) {
  const dateStr = new Date(s.epoch * 1000).toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' })
  return `
    <article class="card vod-card unlisted" tabindex="0" data-recover data-login="${esc(s.login)}" data-stream="${esc(s.streamID)}" data-epoch="${esc(s.epoch)}" data-title="${esc(s.title || '')}">
      <div class="thumb">
        <span class="unlisted-ic">${icon('eyeOff', 26)}</span>
        <span class="pill unlisted-pill">${esc(t('unlisted_vod'))}</span>
        ${s.duration ? `<span class="pill duration">${esc(formatDuration(s.duration))}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-text">
          <h3 title="${esc(s.title || '')}">${esc(s.title || s.login)}</h3>
          <p class="meta">${esc([dateStr, s.game].filter(Boolean).join(' · '))}</p>
        </div>
      </div>
    </article>`
}

/** Grille des VODs, non listées comprises, filtrée par le mot-clé (titre ou
 *  date). Refaite à la frappe et à l'arrivée des non listées. */
function renderVodGrid() {
  const ch = state.channel
  const grid = $('#channel-vods')
  if (!grid || !ch) return
  const keyword = ($('#vod-filter')?.value ?? '').trim().toLowerCase()
  const name = ch.info?.displayName || ch.login
  const unlisted = unlistedStreams()
  const match = (title, ms) => !keyword || String(title ?? '').toLowerCase().includes(keyword)
    || new Date(ms).toLocaleDateString(lang()).includes(keyword)
  const items = [
    ...ch.videos.map((v) => ({ t: Date.parse(v.publishedAt) || 0, title: v.title, html: () => vodCard(v, name) })),
    ...unlisted.map((s) => ({ t: s.epoch * 1000, title: s.title, html: () => unlistedCard(s) })),
  ].filter((x) => match(x.title, x.t)).sort((a, b) => b.t - a.t)
  grid.innerHTML = items.length ? items.map((x) => x.html()).join('') : (keyword ? '' : emptyState(t('no_vod'), 'film'))
  const count = $('#vod-filter-count')
  if (count) {
    count.hidden = !keyword
    count.textContent = keyword ? (items.length ? t('filter_count', { n: items.length, k: keyword }) : t('filter_none', { k: keyword })) : ''
  }
  const hint = $('#unlisted-hint')
  if (hint) hint.hidden = !unlisted.length
}

/** Reconstruit une VOD non listée puis la lit. Si le CDN ne la sert plus,
 *  sa carte le dit ; un nouveau clic retente. */
async function recoverAndPlay(card) {
  if (card.classList.contains('busy')) return
  const { login, stream, epoch, title } = card.dataset
  const pill = card.querySelector('.unlisted-pill')
  card.classList.add('busy')
  card.classList.remove('gone')
  if (pill) pill.textContent = t('recover_resolving')
  try {
    const r = await api.resolveRecovery(login, stream, Number(epoch))
    if (!r?.links || !Object.keys(r.links).length) throw new Error('none')
    stopPlayback()
    state.watch = { kind: 'vod', id: `recovered-${stream}`, info: null, links: r.links, recovered: true }
    const tok = state.watch
    // Pas d'adresse à partager : une VOD reconstruite garde celle de la page.
    showWatch('vod', title || login)
    if (state.watch !== tok) return
    $('#watch-loading').hidden = true
    player.load({ links: r.links, kind: 'vod', startAt: 0 })
    $('#watch-title').textContent = title || login
    $('#mini-title').textContent = title || login
    setWatchChannel(login)
  } catch (e) {
    card.classList.add('gone')
    toast(t('recover_failed'), 'error')
  } finally {
    card.classList.remove('busy')
    if (pill) pill.textContent = t(card.classList.contains('gone') ? 'unlisted_gone' : 'unlisted_vod')
  }
}

function renderChannel(keyword = '') {
  const { login, info, videos } = state.channel
  const tab = state.channelTab ?? 'vods'
  watchChannelLive()
  const name = info?.displayName || login
  const avatar = info?.profileImageURL || ''
  const live = info?.stream
  let status = ''
  if (live) {
    status = `
      <div class="hero-live">
        <div class="hero-badges">
          <span class="pill live">${esc(t('live_now'))}</span>
          <span class="muted">${icon('eye', 14)} <span id="channel-viewers">${esc(formatViewers(live.viewersCount))}</span></span>
          <span class="muted">${icon('clock', 14)} <span id="channel-uptime">${esc(uptimeSince(live.createdAt))}</span></span>
        </div>
        <p class="hero-title">${esc(live.title)}</p>
        ${live.game ? `<p class="hero-game">${icon('gamepad', 14)} ${gameLink(live.game.id, live.game.displayName)}</p>` : ''}
        <button class="btn primary" type="button" data-live="${esc(login)}">${icon('play', 16)}<span>${esc(t('watch_live'))}</span></button>
      </div>
      <img class="hero-thumb" src="${esc(live.previewImageURL)}" alt="" data-live="${esc(login)}">`
  } else {
    const last = videos[0]
    const lastStart = info?.lastBroadcast?.startedAt
    const since = offlineFor(last?.publishedAt, last?.lengthSeconds, lastStart)
    const sinceDate = offlineDate(last?.publishedAt, last?.lengthSeconds, lastStart)
    status = `
      <div class="hero-live">
        <div class="hero-badges"><span class="pill off">${esc(t('offline'))}</span>
        ${since ? `<span class="muted">${esc(t('offline_since', { t: since }))} · ${esc(sinceDate)}</span>` : ''}</div>
        ${info?.broadcastSettings?.title ? `<p class="hero-title muted">${esc(info.broadcastSettings.title)}</p>` : ''}
      </div>`
  }

  $('#channel-result').innerHTML = `
    <section class="channel-hero${live ? ' is-live' : ''}">
      <div class="hero-id">
        ${avatar ? `<img class="avatar lg${live ? ' ring' : ''}" src="${esc(avatar)}" alt="">` : ''}
        <div><h2>${esc(name)}</h2><p class="muted">@${esc(login)}</p></div>
        <button class="btn ghost sm follow-local${isLocallyFollowed(login) ? ' on' : ''}" type="button" data-action="follow-local" data-follow="${esc(login)}" title="${esc(t('follow_local_sub'))}">${followLocalInner(isLocallyFollowed(login))}</button>
      </div>
      ${status}
    </section>
    <div class="segmented channel-tabs" id="channel-tabs">
      ${CHANNEL_TABS.map(([id, k]) => `<button type="button" data-ctab="${id}" class="${tab === id ? 'active' : ''}">${esc(t(k))}</button>`).join('')}
    </div>
    <section class="block" data-cpanel="vods" ${tab === 'vods' ? '' : 'hidden'}>
      <div class="block-head">
        <h2>${icon('film', 18)}<span>${esc(t('vods'))}</span></h2>
        <label class="filter">${icon('search', 16)}<input id="vod-filter" type="search" value="${esc(keyword)}" placeholder="${esc(t('search'))}…"></label>
      </div>
      <p class="muted filter-count" id="vod-filter-count" hidden></p>
      <p class="muted small unlisted-hint" id="unlisted-hint" hidden>${icon('eyeOff', 14)}<span>${esc(t('unlisted_hint'))}</span></p>
      <div class="grid vods" id="channel-vods"></div>
    </section>
    <section class="block" data-cpanel="highlights" ${tab === 'highlights' ? '' : 'hidden'}>
      <div class="grid vods" id="channel-highlights"></div>
    </section>
    <section class="block" data-cpanel="playlists" id="channel-playlists" ${tab === 'playlists' ? '' : 'hidden'}></section>
    <section class="block" data-cpanel="clips" ${tab === 'clips' ? '' : 'hidden'}>
      <div class="block-head">
        <div class="segmented sm">
          ${[['LAST_DAY', 'period_day'], ['LAST_WEEK', 'period_week'], ['LAST_MONTH', 'period_month'], ['ALL_TIME', 'period_all']]
            .map(([p, k]) => `<button type="button" data-clip-period="${p}" class="${(state.clipPeriod ?? 'LAST_WEEK') === p ? 'active' : ''}">${esc(t(k))}</button>`).join('')}
        </div>
      </div>
      <div class="grid vods" id="channel-clips"></div>
      <div class="load-more" id="channel-clips-more"></div>
    </section>
    <section class="block" data-cpanel="about" ${tab === 'about' ? '' : 'hidden'}>
      <div id="channel-about"></div>
    </section>`
  loadChannelTab(tab)
  renderVodGrid()
  loadUnlisted(login)

  // Seule la grille est refaite à la frappe : le champ garde son focus.
  $('#vod-filter').addEventListener('input', debounce(renderVodGrid, 200))
}

/**
 * Page streamer : le temps de live avance chaque seconde et les spectateurs
 * sont relus chaque minute. Rendue une seule fois, la page restait figée.
 */
function watchChannelLive() {
  clearInterval(channelTimer)
  const ch = state.channel
  if (!ch?.info?.stream) return
  let ticks = 0
  channelTimer = setInterval(async () => {
    if (state.channel !== ch) return clearInterval(channelTimer)
    if (document.hidden) return
    const s = ch.info?.stream
    const el = $('#channel-uptime')
    if (el && s?.createdAt) el.textContent = uptimeSince(s.createdAt)
    if (++ticks % 60 || state.tab !== 'channel') return
    const fresh = await api.getChannelInfo(ch.login).catch(() => null)
    if (!fresh || state.channel !== ch) return
    const wasLive = Boolean(ch.info?.stream)
    ch.info = fresh
    const v = $('#channel-viewers')
    if (wasLive !== Boolean(fresh.stream)) renderChannel($('#vod-filter')?.value?.trim().toLowerCase() ?? '')
    else if (v && fresh.stream) v.textContent = formatViewers(fresh.stream.viewersCount)
  }, 1000)
}

/** Fin du dernier live connu : la VOD la plus récente (début + durée) ou,
 *  si plus tard, le dernier live lancé (un live sans VOD n'en laisse pas). */
function lastLiveEnd(publishedAt, lengthSeconds, lastStart) {
  const fromVod = Date.parse(publishedAt) + (lengthSeconds || 0) * 1000
  const start = Date.parse(lastStart)
  const end = Math.max(Number.isFinite(fromVod) ? fromVod : 0, Number.isFinite(start) ? start : 0)
  return end || NaN
}

/** « 13 j » en français, « 13d » en anglais : unités de la langue choisie. */
function offlineFor(publishedAt, lengthSeconds, lastStart) {
  const end = lastLiveEnd(publishedAt, lengthSeconds, lastStart)
  const diff = Date.now() - end
  if (!Number.isFinite(diff) || diff < 0) return ''
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor(diff / 60_000)
  const [n, unit] = d > 0 ? [d, 'day'] : h > 0 ? [h, 'hour'] : [m, 'minute']
  try {
    return new Intl.NumberFormat(lang(), { style: 'unit', unit, unitDisplay: 'narrow' }).format(n)
  } catch {
    return `${n} ${unit[0]}`
  }
}

/** Date du dernier live, courte (« 21 sept. »), avec l'année si ce n'est pas celle-ci. */
function offlineDate(publishedAt, lengthSeconds, lastStart) {
  const end = new Date(lastLiveEnd(publishedAt, lengthSeconds, lastStart))
  if (!Number.isFinite(end.getTime())) return ''
  const sameYear = end.getFullYear() === new Date().getFullYear()
  return end.toLocaleDateString(lang(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

// ── Lecteur ────────────────────────────────────────────────────────────────
function setupPlayer() {
  const watch = $('#watch')
  player = new Player($('#player'), {
    fullscreenTarget: $('#watch-body'),
    prefs: store.prefs,
    savePrefs: () => store.savePrefs(),
    onToggleChat: () => toggleChat(),
    onTheatre: () => toggleTheatre(),
    onHelp: () => toast(t('shortcuts_help'), 'info'),
    onSource: (id) => switchLiveSource(id),
    // Raccourcis actifs : lecteur affiché en grand, aucune feuille ouverte.
    keysActive: () => !$('#watch').hidden && !$('#watch').classList.contains('minimized') && !$('#sheet')?.classList.contains('open'),
    isChatOpen: () => store.prefs.chatOpen,
    onTime: (cur, duration) => onPlaybackTime(cur, duration),
    // Une pause est un bon moment pour sauvegarder — sans dépasser un envoi
    // par minute si l'on enchaîne pause et lecture.
    onPause: () => { if (Date.now() - lastSyncAt > 60_000) flushSync({ force: true }) },
    onError: () => showWatchError(state.watch?.kind === 'live' ? t('err_live') : t('err_vod')),
    onWorkerDown: (base) => switchWorker(base),
    // « Signaler un problème » du menu du lecteur : hors plein écran, la
    // feuille n'y serait pas visible.
    onReport: () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
      openFeedback('bug')
    },
  })
  chat = new ChatView($('#chat'), {
    prefs: store.prefs,
    // Retard de l'image à compenser dans le chat, si le réglage est actif.
    getDelay: () => (store.prefs.chatSync ? player.chatDelay() : 0),
    onOpenChannel: (login) => openLive(login),
    onOpenClip: (slug) => openClip(slug),
    onPrefsChange: () => store.savePrefs(),
    session: () => session,
    onLogin: () => login(),
    onHide: () => toggleChat(false),
  })
  applyChatOpen()
  applyStatic(watch)
  // Playlist lancée avec « Tout lire » : vidéo suivante à la fin.
  player.video.addEventListener('ended', () => playNextInPlaylist())
  // Clic sur la vidéo réduite : on rouvre.
  $('#player').addEventListener('click', (e) => {
    if (watch.classList.contains('minimized')) { e.stopPropagation(); expandWatch() }
  }, true)
}

/**
 * Le Worker qui servait la vidéo ne répond plus (quota du jour atteint) : on
 * redemande les liens — un autre Worker répond — et la lecture reprend au
 * même endroit. Au plus une fois par minute, pour ne pas boucler si tous les
 * Workers tombent : le lecteur retente alors comme avant. `false` = rien fait.
 */
let lastWorkerSwitch = 0
function switchWorker(base) {
  const w = state.watch
  if (w?.kind !== 'live' && w?.kind !== 'vod') return false
  // Relais vidéo du VPS en panne : les mêmes liens, par le Worker — sans
  // redemander quoi que ce soit (une VOD reconstruite n'a rien à redemander).
  if (base === api.RELAY_BASE && w.links && api.markWorkerDown(base)) {
    console.info('[TwitchUnblock] Relais vidéo injoignable, retour au Worker :', base)
    w.links = api.withoutRelay(w.links)
    player.swapLinks(w.links)
    return true
  }
  if (Date.now() - lastWorkerSwitch < 60_000 || !api.markWorkerDown(base)) return false
  lastWorkerSwitch = Date.now()
  console.info('[TwitchUnblock] Worker injoignable, passage au secours :', base)
  const request = w.kind === 'live' ? api.getLive(w.login) : api.getVodLinks(w.id)
  request
    .then((links) => {
      if (state.watch !== w || !links?.links || !Object.keys(links.links).length) return
      w.links = links.links
      player.swapLinks(links.links)
      if (w.kind === 'live') player.setLiveSource(links.source)
    })
    .catch(() => {})
  return true
}

/** « Source du direct » changée (réglages ou menu ⚙ du lecteur) : enregistrée,
 *  et le direct en cours repart aussitôt par elle. */
async function switchLiveSource(id) {
  store.prefs.liveSource = id === 'auto' ? null : id
  store.savePrefs()
  const w = state.watch
  if (w?.kind !== 'live') return
  const links = await api.getLive(w.login).catch(() => null)
  if (state.watch !== w) return
  if (!links?.links || !Object.keys(links.links).length) return toast(t('err_live'), 'error')
  w.links = links.links
  player.swapLinks(links.links)
  player.setLiveSource(links.source)
  if (links.source) toast(t('src_now', { s: t(`src_${links.source}`) }), 'info')
}

/** Mode théâtre : la vidéo prend toute la hauteur, sans le bandeau d'infos. */
function toggleTheatre(force) {
  store.prefs.theatre = typeof force === 'boolean' ? force : !store.prefs.theatre
  store.savePrefs()
  $('#watch').classList.toggle('theatre', store.prefs.theatre)
}

function toggleChat(force) {
  store.prefs.chatOpen = typeof force === 'boolean' ? force : !store.prefs.chatOpen
  store.savePrefs()
  applyChatOpen()
}

function applyChatOpen() {
  $('#watch').classList.toggle('theatre', Boolean(store.prefs.theatre))
  $('#watch').classList.toggle('chat-hidden', !store.prefs.chatOpen)
  player.setChatOpen(store.prefs.chatOpen)
}

function showWatch(kind, title) {
  const watch = $('#watch')
  watch.hidden = false
  watch.classList.remove('minimized', 'error')
  watch.dataset.kind = kind
  document.documentElement.classList.add('watching')
  $('#watch-loading').hidden = false
  $('#watch-title').textContent = title || ''
  setWatchChannel(kind === 'live' ? state.watch?.login : null)
  $('#watch-sub').innerHTML = ''
  $('#watch-avatar').hidden = true
  $('#mini-title').textContent = title || ''
  $('#watch-info').innerHTML = ''
  requestAnimationFrame(() => watch.classList.add('open'))
}

function showWatchError(message) {
  $('#watch').classList.add('error')
  $('#watch-loading').hidden = true
  $('#watch-error-text').textContent = message
}

async function openLive(rawLogin) {
  const login = api.cleanLogin(rawLogin)
  if (!login) return
  stopPlayback()
  state.watch = { kind: 'live', login, info: null, links: null }
  const token = state.watch
  showWatch('live', login)
  go(`/${login}`, { watch: true })

  const [links, info] = await Promise.all([
    api.getLive(login).catch((e) => ({ error: e?.status ? 'missing' : 'network' })),
    api.getChannelInfo(login).catch(() => null),
  ])
  if (state.watch !== token) return
  if (!links || links.error || !links.links || !Object.keys(links.links).length) {
    return showWatchError(links?.error === 'network' ? t('err_network') : t('err_live'))
  }
  token.links = links.links
  token.info = info
  $('#watch-loading').hidden = true
  player.load({ links: links.links, kind: 'live' })
  player.setLiveSource(links.source)
  chat.openLive({ channel: login, channelId: info?.id ?? null })
  renderLiveInfo(info, links)
  if (info?.id) startHermes(token, login, info.id)

  store.addHistory(login, 'channel', info?.displayName || login, { avatar: info?.profileImageURL || links.avatar || '' })
  pushSync()
  renderRecentChannels()

  // Spectateurs et titre : rafraîchis toutes les 30 s. Le temps de live,
  // lui, est recalculé chaque seconde à partir de l'heure de début — il
  // restait figé sur sa valeur d'ouverture.
  clearInterval(infoTimer)
  infoTimer = setInterval(async () => {
    if (document.hidden) return   // en arrière-plan, Hermes suffit
    if (state.watch !== token) return clearInterval(infoTimer)
    const fresh = await api.getChannelInfo(login).catch(() => null)
    if (!fresh || state.watch !== token) return
    // Repli si Hermes n'a rien dit : le live a disparu entre deux relectures.
    if (!fresh.stream && token.info?.stream) return liveEnded(token)
    token.info = fresh
    renderLiveInfo(fresh, links)
  }, 30_000)
  clearInterval(uptimeTimer)
  uptimeTimer = setInterval(() => {
    if (state.watch !== token) return clearInterval(uptimeTimer)
    const el = $('#watch-uptime')
    if (el && token.startedAt) el.textContent = uptimeSince(token.startedAt)
  }, 1000)
}

// ── Temps réel (Hermes) ──────────────────────────────────────────────────
function startHermes(token, login, channelId) {
  hermes?.stop()
  hermes = new Hermes({
    topics: [`raid.${channelId}`, `video-playback-by-id.${channelId}`, `predictions-channel-v1.${channelId}`, `pinned-chat-updates-v1.${channelId}`],
    onEvent: (topic, data) => {
      if (state.watch !== token) return
      const kind = topic.split('.')[0]
      if (kind === 'video-playback-by-id') {
        if (data.type === 'viewcount' && Number.isFinite(data.viewers) && token.info?.stream) {
          token.info.stream.viewersCount = data.viewers
          renderLiveInfo(token.info, token.links)
        } else if (data.type === 'stream-down') {
          // Laisse au raid éventuel le temps d'arriver avant d'afficher la fin.
          setTimeout(() => { if (state.watch === token) liveEnded(token) }, 4000)
        }
      } else if (kind === 'raid') onRaid(token, data)
      else if (kind === 'predictions-channel-v1') chat.setPrediction(data.data?.event)
      else if (kind === 'pinned-chat-updates-v1') chat.refreshPinned()
    },
  })
}

/** Raid sortant : bandeau dans le chat, puis on suit le streamer chez sa
 *  cible au départ du raid (réglable). */
function onRaid(token, data) {
  const raid = data.raid
  if (!raid?.target_login) return
  const target = api.cleanLogin(raid.target_login)
  if (!target) return
  token.raidTarget = { login: target, name: raid.target_display_name || target }
  const follow = () => { chat.hideRaid(); openLive(target) }
  if (data.type === 'raid_update_v2' || data.type === 'raid_update') {
    chat.showRaid(raid, {
      auto: store.prefs.autoRaid,
      onFollow: follow,
      onCancel: () => { token.raidCancelled = true },
    })
  } else if (data.type === 'raid_go_v2' || data.type === 'raid_go') {
    if (store.prefs.autoRaid && !token.raidCancelled) {
      toast(t('raid_following', { u: token.raidTarget.name }))
      follow()
    } else chat.showRaid(raid, { auto: false, onFollow: follow, onCancel: () => {} })
  } else if (data.type === 'raid_cancel_v2' || data.type === 'raid_cancel') {
    token.raidTarget = null
    chat.hideRaid()
  }
}

/** Fin du live : un écran à la place de l'image figée, avec la suite. */
function liveEnded(token) {
  if (state.watch !== token || token.ended) return
  token.ended = true
  if (token.info) token.info.stream = null
  clearInterval(uptimeTimer)
  const box = $('#watch-ended')
  const raid = token.raidTarget
  box.innerHTML = `
    <span class="ended-ic">${icon('radio', 30)}</span>
    <p class="ended-title">${esc(t('live_ended'))}</p>
    <div class="ended-actions">
      ${raid ? `<button class="btn primary" type="button" data-ended-raid>${icon('play', 16)}<span>${esc(t('watch_target', { u: raid.name }))}</span></button>` : ''}
      <button class="btn" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>
    </div>`
  const btn = $('[data-ended-raid]', box)
  if (btn) btn.onclick = () => openLive(raid.login)
  $('#watch').classList.add('ended')
  player.video?.pause()
  $('#watch-sub').innerHTML = `<span class="pill sm">${esc(t('offline'))}</span>`
}

function renderLiveInfo(info, links) {
  const name = info?.displayName || state.watch?.login
  const avatar = info?.profileImageURL || links?.avatar
  const s = info?.stream
  const title = s?.title || links?.title || ''
  const game = s?.game?.displayName || links?.game || ''
  const gameId = s?.game?.displayName ? s.game.id : ''
  if (state.watch && s?.createdAt) state.watch.startedAt = s.createdAt
  $('#watch-title').textContent = name
  setWatchChannel(state.watch?.login)
  $('#mini-title').textContent = `${name}${title ? ` · ${title}` : ''}`
  setAvatar(avatar)
  $('#watch-sub').innerHTML = `
    <span class="pill live sm">${esc(t('live_now'))}</span>
    ${s ? `<span>${icon('eye', 13)} ${esc(formatViewers(s.viewersCount))}</span><span>${icon('clock', 13)} <span id="watch-uptime">${esc(uptimeSince(s.createdAt))}</span></span>` : ''}`
  $('#watch-info').innerHTML = `
    <div class="wi-text">
      <h1 title="${esc(title)}">${esc(title)}</h1>
      ${game ? `<p class="hero-game">${icon('gamepad', 14)} ${gameLink(gameId, game)}</p>` : ''}
      ${tagsHtml((s?.freeformTags ?? []).map((x) => x?.name).filter(Boolean))}
    </div>
    <div class="wi-actions">
      <button class="btn ghost sm" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>
      <button class="btn ghost sm" type="button" data-action="open-in">${icon('external', 16)}<span>${esc(t('open_in'))}</span></button>
    </div>`
}

// ── Clips ────────────────────────────────────────────────────────────────
async function openClip(slug) {
  stopPlayback()
  state.watch = { kind: 'clip', id: slug, info: null, links: null, offset: null }
  const token = state.watch
  showWatch('vod', t('clip'))
  go(`/clip/${encodeURIComponent(slug)}`, { watch: true })
  const clip = await api.getClip(slug).catch(() => null)
  if (state.watch !== token) return
  if (!clip || !Object.keys(clip.links).length) return showWatchError(t('err_clip'))
  token.links = clip.links
  token.info = clip
  token.login = clip.broadcaster?.login ?? null
  // Adresse complète, comme sur Twitch, une fois la chaîne connue.
  if (token.login) go(`/${token.login}/clip/${encodeURIComponent(slug)}`, { replace: true, watch: true })
  $('#watch-loading').hidden = true
  player.load({ links: clip.links, kind: 'vod', startAt: 0 })
  // Chat de la VOD d'origine, si elle existe encore.
  if (clip.video?.id && Number.isFinite(clip.videoOffsetSeconds)) {
    token.offset = clip.videoOffsetSeconds
    chat.openVod({ videoId: clip.video.id, channelId: clip.broadcaster?.id ?? null, channelLogin: token.login, startAt: token.offset })
  }
  const name = clip.broadcaster?.displayName || token.login || ''
  $('#watch-title').textContent = name
  setWatchChannel(clip.broadcaster?.login || token.login)
  $('#mini-title').textContent = clip.title || t('clip')
  setAvatar(clip.broadcaster?.profileImageURL)
  $('#watch-sub').innerHTML = `<span class="pill vod sm">${esc(t('clip'))}</span><span>${icon('eye', 13)} ${esc(formatViewers(clip.viewCount ?? 0))}</span><span>${icon('clock', 13)} ${esc(formatClock(clip.durationSeconds ?? 0))}</span>`
  $('#watch-info').innerHTML = `
    <div class="wi-text">
      <h1 title="${esc(clip.title ?? '')}">${esc(clip.title ?? '')}</h1>
      ${clip.game?.displayName ? `<p class="hero-game">${icon('gamepad', 14)} ${gameLink(clip.game.id, clip.game.displayName)}</p>` : ''}
    </div>
    <div class="wi-actions">
      ${token.login ? `<button class="btn ghost sm" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>` : ''}
      ${clip.video?.id ? `<button class="btn ghost sm" type="button" data-vod="${esc(clip.video.id)}">${icon('play', 16)}<span>${esc(t('full_vod'))}</span></button>` : ''}
    </div>`
}

function clipCard(c) {
  const date = new Date(c.createdAt)
  const dateStr = Number.isFinite(date.getTime()) ? date.toLocaleDateString(lang(), { day: 'numeric', month: 'short' }) : ''
  return `
    <a class="card vod-card" href="/clip/${esc(encodeURIComponent(c.slug))}" data-clip="${esc(c.slug)}">
      <div class="thumb">
        <img src="${esc(c.thumbnailURL)}" alt="" loading="lazy" decoding="async">
        <span class="pill duration">${esc(formatClock(c.durationSeconds ?? 0))}</span>
        <span class="pill views">${icon('eye', 12)} ${esc(formatViewers(c.viewCount ?? 0))}</span>
      </div>
      <div class="card-body">
        <div class="card-text">
          <h3 title="${esc(c.title)}">${esc(c.title)}</h3>
          <p class="meta">${esc([dateStr, c.curator?.displayName ? t('clipped_by', { u: c.curator.displayName }) : ''].filter(Boolean).join(' · '))}</p>
        </div>
      </div>
    </a>`
}

/** Section Clips de la page chaîne, chargée à part (période au choix), avec
 *  « Charger plus » (voir api.getClips : 100 d'un coup, puis Helix connecté). */
async function loadChannelClips(period = state.clipPeriod ?? 'LAST_WEEK', { more = false } = {}) {
  const login = state.channel?.login
  const box = $('#channel-clips')
  if (!login || !box) return
  state.clipPeriod = period
  for (const b of document.querySelectorAll('[data-clip-period]')) b.classList.toggle('active', b.dataset.clipPeriod === period)
  // Gardés en mémoire : on revient sur une période sans tout recharger.
  const key = `${login}|${period}`
  state.clipCache ??= new Map()
  let entry = state.clipCache.get(key)
  let added = null
  if (!entry || more) {
    if (more && !entry?.cursor) return
    if (!more) box.innerHTML = skeleton(4, 'vod')
    const moreBtn = $('#channel-clips-more button')
    if (moreBtn) moreBtn.disabled = true
    const page = await api.getClips(login, period, more ? entry.cursor : null, state.channel.info?.id).catch(() => null)
    if (page) {
      const known = new Set((more ? entry.items : []).map((c) => c.slug))
      added = page.items.filter((c) => !known.has(c.slug))
      entry = { items: more ? [...entry.items, ...added] : added, cursor: page.cursor, locked: page.locked }
      state.clipCache.set(key, entry)
    } else if (more) entry = { ...entry, cursor: null }
  }
  if (state.channel?.login !== login || state.clipPeriod !== period || !$('#channel-clips')) return
  // « Charger plus » ajoute à la suite : la grille ne remonte pas en haut.
  if (more && added) $('#channel-clips').insertAdjacentHTML('beforeend', added.map(clipCard).join(''))
  else $('#channel-clips').innerHTML = entry?.items?.length ? entry.items.map(clipCard).join('') : emptyState(t('no_clips'), 'film')
  $('#channel-clips-more').innerHTML = moreHtml(entry, 'clips-more')
}

/** Playlists de la chaîne : une rangée défilante par playlist, comme sur Twitch. */
async function loadChannelPlaylists() {
  const login = state.channel?.login
  if (!login) return
  state.playlistCache ??= new Map()
  let lists = state.playlistCache.get(login)
  if (!lists) {
    const b = $('#channel-playlists')
    if (b) b.innerHTML = `<div class="grid vods">${skeleton(4, 'vod')}</div>`
    lists = await api.getCollections(login).catch(() => null)
    if (lists) state.playlistCache.set(login, lists)
  }
  const box = $('#channel-playlists')
  if (state.channel?.login !== login || !box) return
  if (!lists?.length) { box.innerHTML = emptyState(t('no_playlists'), 'list'); return }
  const name = state.channel.info?.displayName || login
  box.innerHTML = `
    ${lists.map((c) => `
      <div class="playlist">
        <div class="playlist-head">
          <h3>${esc(c.title)}</h3>
          <button class="btn ghost sm" type="button" data-play-all="${esc(c.id)}">${icon('play', 14)}<span>${esc(t('play_all'))}</span></button>
        </div>
        <p class="muted playlist-sub">${c.description ? `${esc(c.description)} · ` : ''}${esc(t('videos_count', { n: c.total }))}</p>
        <div class="rail">${c.videos.map((v) => vodCard(v, name)).join('')}</div>
      </div>`).join('')}`
}

/** « Tout lire » : lance la première vidéo, la suivante démarre à la fin. */
function playPlaylist(id) {
  const list = state.playlistCache?.get(state.channel?.login)?.find((c) => c.id === id)
  if (!list) return
  state.playlist = { ids: list.videos.map((v) => String(v.id)) }
  openVod(list.videos[0].id)
}

function playNextInPlaylist() {
  const w = state.watch, q = state.playlist
  if (w?.kind !== 'vod' || !q) return
  const next = q.ids[q.ids.indexOf(w.id) + 1]
  if (next) openVod(next, undefined, { keepPlaylist: true })
  else state.playlist = null
}

async function openVod(id, preset, { keepPlaylist = false, at = null } = {}) {
  const vodId = String(id)
  if (!keepPlaylist && !state.playlist?.ids.includes(vodId)) state.playlist = null
  stopPlayback()
  const known = preset ?? state.vodMeta.get(vodId) ?? {}
  state.watch = { kind: 'vod', id: vodId, info: null, links: null }
  const token = state.watch
  showWatch('vod', known.title || `VOD ${vodId}`)
  go(`/videos/${vodId}`, { watch: true })

  const [links, meta] = await Promise.all([
    api.getVodLinks(vodId).catch((e) => ({ error: e?.status ? 'missing' : 'network' })),
    api.getVodMeta(vodId).catch(() => null),
  ])
  if (state.watch !== token) return
  if (!links || links.error || !links.links || !Object.keys(links.links).length) {
    return showWatchError(links?.error === 'network' ? t('err_network') : t('err_vod'))
  }
  token.links = links.links
  token.info = meta
  token.login = meta?.owner?.login ?? null

  const length = meta?.lengthSeconds ?? known.length ?? 0
  if (length) store.setLength(vodId, length)
  // L'instant d'un lien (« ?t= ») passe avant la reprise.
  let startAt = at ?? store.getProgress(vodId)
  // Une VOD finie (ou presque) repart du début plutôt que de se terminer aussitôt.
  if (length && startAt > length - 30) startAt = 0
  if (startAt < 10) startAt = 0

  $('#watch-loading').hidden = true
  player.load({ links: links.links, kind: 'vod', startAt })
  api.getVodMarkers(vodId).then((m) => {
    if (state.watch !== token) return
    player.setChapters(m.chapters)
    player.setMuted(m.muted)
  }).catch(() => {})
  chat.openVod({ videoId: vodId, channelId: meta?.owner?.id ?? null, channelLogin: meta?.owner?.login ?? null, startAt })
  if (startAt && !at) toast(t('resume_at', { t: formatClock(startAt) }))

  const title = meta?.title || known.title || `VOD ${vodId}`
  const streamer = meta?.owner?.displayName || known.streamer || ''
  const thumbUrl = meta?.previewThumbnailURL || known.thumb || ''
  store.addHistory(vodId, 'vod', title, { thumb: thumbUrl, streamer })
  pushSync()

  $('#watch-title').textContent = streamer || title
  setWatchChannel(meta?.owner?.login)
  $('#mini-title').textContent = title
  setAvatar(meta?.owner?.profileImageURL)
  const date = meta?.createdAt ? new Date(meta.createdAt).toLocaleDateString(lang(), { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  $('#watch-sub').innerHTML = `<span class="pill vod sm">VOD</span>${date ? `<span>${esc(date)}</span>` : ''}${length ? `<span>${icon('clock', 13)} ${esc(formatDuration(length))}</span>` : ''}`
  $('#watch-info').innerHTML = `
    <div class="wi-text">
      <h1 title="${esc(title)}">${esc(title)}</h1>
      ${meta?.game?.displayName ? `<p class="hero-game">${icon('gamepad', 14)} ${gameLink(meta.game.id, meta.game.displayName)}</p>` : ''}
    </div>
    <div class="wi-actions">
      ${token.login ? `<button class="btn ghost sm" type="button" data-action="see-vods">${icon('film', 16)}<span>${esc(t('see_vods'))}</span></button>` : ''}
      <button class="btn ghost sm" type="button" data-action="open-in">${icon('external', 16)}<span>${esc(t('open_in'))}</span></button>
    </div>`
}

function setAvatar(url) {
  const img = $('#watch-avatar')
  if (url) { img.src = url; img.hidden = false } else img.hidden = true
}

function onPlaybackTime(cur, duration) {
  const w = state.watch
  // Clip : le chat de la VOD d'origine suit, décalé de la position du clip.
  if (w?.kind === 'clip') { if (w.offset != null) chat.tick(w.offset + cur); return }
  if (!w || w.kind !== 'vod') return
  chat.tick(cur)
  if (cur > 0 && Math.abs(cur - lastSave) > 5) {
    lastSave = cur
    store.setProgress(w.id, cur)
    if (Number.isFinite(duration) && duration > 0) store.setLength(w.id, duration)
    pushSync()
  }
}

function stopPlayback() {
  hermes?.stop()
  hermes = null
  $('#watch')?.classList.remove('ended')
  clearInterval(infoTimer)
  clearInterval(uptimeTimer)
  player.destroy()
  chat.close()
  lastSave = 0
}

/** Pseudo et avatar du lecteur cliquables : ouvrent la page de la chaîne. */
function setWatchChannel(login) {
  for (const el of [$('#watch-title'), $('#watch-avatar')]) {
    if (!el) continue
    if (login) { el.dataset.channel = String(login).toLowerCase(); el.classList.add('linkish') }
    else { delete el.dataset.channel; el.classList.remove('linkish') }
  }
}

/** `url` : l'adresse suit (page dessous ↔ lecteur), pour que précédent /
 *  suivant passent de l'un à l'autre. */
function minimizeWatch({ url = true } = {}) {
  const watch = $('#watch')
  if (watch.hidden || watch.classList.contains('minimized')) return
  if (player.isFullscreen) document.exitFullscreen?.().catch(() => {})
  watch.classList.add('minimized')
  document.documentElement.classList.remove('watching')
  if (url) go(pagePath())
}

function expandWatch({ url = true } = {}) {
  const watch = $('#watch')
  if (!watch.classList.contains('minimized')) return
  watch.classList.remove('minimized')
  document.documentElement.classList.add('watching')
  if (url) go(watchPath(), { watch: true })
}

function closeWatch({ url = true } = {}) {
  const watch = $('#watch')
  if (player.isFullscreen) document.exitFullscreen?.().catch(() => {})
  stopPlayback()
  flushSync({ force: true })
  state.watch = null
  watch.classList.remove('open')
  document.documentElement.classList.remove('watching')
  setTimeout(() => { if (!state.watch) { watch.hidden = true; watch.classList.remove('minimized') } }, 220)
  // L'adresse redevient celle de la page sous le lecteur.
  if (url) go(pagePath(), { replace: true })
  renderContinue()
  if (state.channel) {
    // Les barres de progression des cartes ont pu changer.
    const kw = $('#vod-filter')?.value?.trim().toLowerCase() ?? ''
    if (state.tab === 'channel') renderChannel(kw)
  }
}

// ── Retours : bug, idée ────────────────────────────────────────────────────
// Depuis l'en-tête, les réglages ou le lecteur. Le Worker range le message
// (captures comprises) et le transmet sur Discord ; ce qui part est montré
// avant l'envoi. Il rend un jeton que ce navigateur garde : avec lui, on
// relit la discussion (« Mes signalements »), on voit où en est le retour
// (accepté, en cours, fait…) et on répond.
const FEEDBACK_KINDS = ['bug', 'idea', 'other']
const MY_FB_KEY = 'tu_my_feedback'
const MAX_FB_PHOTOS = 3

/** Infos techniques jointes : de quoi reproduire un bug, rien de plus. */
function feedbackInfo() {
  const brands = navigator.userAgentData?.brands?.filter((b) => !/not.?a.?brand/i.test(b.brand))
  const w = state.watch
  return {
    browser: brands?.length ? brands.map((b) => `${b.brand} ${b.version}`).join(', ') : navigator.userAgent.slice(0, 160),
    os: navigator.userAgentData?.platform || navigator.platform || '',
    lang: lang(),
    page: location.pathname + location.search,
    screen: `${screen.width}×${screen.height}`,
    // Ce qui se lisait : la VOD ou la chaîne en cause, pour un bug de lecture.
    watching: w ? [w.kind, w.login, w.kind !== 'live' ? w.id : null].filter(Boolean).join(' ') : null,
    account: Boolean(session.login),
  }
}

/** Retours envoyés d'ici : id, jeton, et le dernier état connu. */
function myFeedback() {
  try {
    const list = JSON.parse(localStorage.getItem(MY_FB_KEY) || '[]')
    return Array.isArray(list) ? list.filter((r) => r?.id && r?.token) : []
  } catch { return [] }
}
function saveMyFeedback(list) {
  try { localStorage.setItem(MY_FB_KEY, JSON.stringify(list.slice(0, 50))) } catch {}
  updateFeedbackBadges()
}
const fbUnread = (r) => r.lastFrom === 'a' && (r.updatedAt || 0) > (r.seen || 0)

/** Pastille « nouvelle réponse » sur chaque bouton de retour. */
function updateFeedbackBadges() {
  const n = myFeedback().filter(fbUnread).length
  for (const b of $$('[data-action="feedback"], [data-fb-mine]')) {
    let dot = b.querySelector('.fb-dot')
    if (!n) { dot?.remove(); continue }
    if (!dot) { dot = document.createElement('span'); dot.className = 'fb-dot'; b.appendChild(dot) }
    dot.textContent = n > 9 ? '9+' : String(n)
    dot.title = t('fb_unread', { n })
  }
}

/** État de toutes les discussions, en une requête (au plus toutes les 3 min
 *  sans `force`). Un retour effacé ou expiré disparaît de la liste. */
let fbCheckedAt = 0
async function refreshFeedbackInbox(force = false) {
  const list = myFeedback()
  if (!list.length || (!force && Date.now() - fbCheckedAt < 3 * 60 * 1000)) return list
  fbCheckedAt = Date.now()
  try {
    const { items } = await api.feedbackThreads(list.map(({ id, token }) => ({ id, token })))
    const byId = new Map((items ?? []).map((i) => [i.id, i]))
    const next = list.filter((r) => !byId.get(r.id)?.gone).map((r) => {
      const it = byId.get(r.id)
      return it ? { ...r, status: it.status, updatedAt: it.updatedAt, lastFrom: it.lastFrom, thread: it.thread } : r
    })
    saveMyFeedback(next)
    return next
  } catch { return list }
}

/** Image choisie ou collée → JPEG réduit (1600 px, ~500 Ko au plus), base64. */
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file)
  let side = 1600
  let quality = 0.8
  let out = ''
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * scale))
    c.height = Math.max(1, Math.round(bmp.height * scale))
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    out = c.toDataURL('image/jpeg', quality)
    if (out.length < 660000) break
    side = Math.round(side * 0.8)
    quality = Math.max(0.5, quality - 0.1)
  }
  bmp.close?.()
  return out
}

/** Pièces jointes d'un formulaire : vignettes, retrait, collage d'une capture. */
function photoPicker(box, input, attach, textarea) {
  const photos = []
  const draw = () => {
    box.innerHTML = photos.map((p, i) => `<span class="fb-thumb"><img src="${p}" alt=""><button type="button" data-unphoto="${i}" aria-label="${esc(t('close'))}">${icon('x', 12)}</button></span>`).join('')
    attach.hidden = photos.length >= MAX_FB_PHOTOS
  }
  const add = async (files) => {
    for (const f of [...files].filter((x) => x.type?.startsWith('image/'))) {
      if (photos.length >= MAX_FB_PHOTOS) { toast(t('fb_photos_max')); break }
      try { photos.push(await shrinkImage(f)) } catch {}
    }
    draw()
  }
  input.onchange = () => { add(input.files); input.value = '' }
  // Capture d'écran collée (Ctrl+V) directement dans le message.
  textarea.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])]
    if (files.some((f) => f.type.startsWith('image/'))) add(files)
  })
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unphoto]')
    if (!b) return
    photos.splice(Number(b.dataset.unphoto), 1)
    draw()
  })
  return { photos, reset: () => { photos.length = 0; draw() } }
}

function openFeedback(kind = 'bug', { prefill = '' } = {}) {
  const info = feedbackInfo()
  const summary = [info.browser, info.os, `v${usage.SITE_VERSION}`, info.page, info.watching].filter(Boolean).join(' · ')
  let current = FEEDBACK_KINDS.includes(kind) ? kind : 'bug'
  const mine = myFeedback()
  openSheet(`
    <div class="sheet-head"><h2>${esc(t('feedback'))}</h2>
      ${mine.length ? `<button class="btn sm ghost fb-mine-btn" type="button" data-fb-mine>${icon('inbox', 15)}<span>${esc(t('fb_mine'))}</span></button>` : ''}
      <button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <form class="sheet-section feedback-form" id="feedback-form">
      <div class="segmented full" id="fb-kind">
        ${FEEDBACK_KINDS.map((k) => `<button type="button" data-fb="${k}" class="${k === current ? 'active' : ''}">${esc(t(`fb_${k}`))}</button>`).join('')}
      </div>
      <textarea class="text-input" id="fb-message" rows="6" maxlength="2000" placeholder="${esc(t(`fb_ph_${current}`))}">${esc(prefill)}</textarea>
      <div class="fb-photos" id="fb-photos"></div>
      <label class="btn sm ghost fb-attach" id="fb-attach">${icon('image', 15)}<span>${esc(t('fb_add_photos'))}</span><input type="file" id="fb-file" accept="image/*" multiple hidden></label>
      <input class="text-input" id="fb-contact" type="text" maxlength="100" autocomplete="off" placeholder="${esc(t('fb_contact_ph'))}">
      <p class="muted small">${esc(t('fb_info'))}<br><span class="fb-info">${esc(summary)}</span></p>
      <button class="btn primary" type="submit" id="fb-send">${icon('send', 16)}<span>${esc(t('fb_send'))}</span></button>
    </form>`)
  updateFeedbackBadges()
  const picker = photoPicker($('#fb-photos'), $('#fb-file'), $('#fb-attach'), $('#fb-message'))
  const sheet = $('#sheet')
  sheet.onclick = (e) => {
    if (e.target.closest('[data-sheet-close]')) return closeSheet()
    if (e.target.closest('[data-fb-mine]')) return openMyFeedback()
    const b = e.target.closest('[data-fb]')
    if (!b) return
    current = b.dataset.fb
    for (const x of $$('[data-fb]', sheet)) x.classList.toggle('active', x === b)
    $('#fb-message').placeholder = t(`fb_ph_${current}`)
  }
  $('#feedback-form').onsubmit = async (e) => {
    e.preventDefault()
    const message = $('#fb-message').value.trim()
    if (message.length < 5) {
      toast(t('fb_short'), 'error')
      return $('#fb-message').focus()
    }
    const btn = $('#fb-send')
    btn.disabled = true
    try {
      const r = await api.sendFeedback({
        kind: current, message, contact: $('#fb-contact').value.trim(),
        platform: 'web', version: usage.SITE_VERSION, info, photos: picker.photos,
      })
      if (r?.id && r?.token) {
        const now = Date.now()
        saveMyFeedback([{ id: r.id, token: r.token, at: now, kind: current, text: message.slice(0, 200), status: 'new', updatedAt: now, lastFrom: 'u', seen: now }, ...myFeedback()])
      }
      closeSheet()
      toast(t(r?.token ? 'fb_thanks_follow' : 'fb_thanks'), 'success')
    } catch (err) {
      btn.disabled = false
      toast(t(err?.status === 429 ? 'fb_too_many' : 'fb_failed'), 'error')
    }
  }
  if (!prefill) setTimeout(() => $('#fb-message')?.focus(), 250)
}
actions['report-translation'] = () => openFeedback('other', { prefill: `[${lang()}] ` })

const fbDate = (at) => new Date(at).toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
let fbThreadTimer = null
const fbStatus = (s) => `<span class="fb-status ${esc(s || 'new')}">${esc(t(`fb_status_${s || 'new'}`))}</span>`

/** « Mes signalements » : les retours envoyés d'ici, réponses en tête. */
function openMyFeedback() {
  const listHtml = (list) => list.length ? `<div class="fb-mine">${list
    .slice().sort((a, b) => (b.updatedAt || b.at) - (a.updatedAt || a.at))
    .map((r) => `<button class="fb-mine-row ${fbUnread(r) ? 'unread' : ''}" type="button" data-fb-open="${esc(r.id)}">
      <span class="fb-mine-top"><span class="fb-kind ${esc(r.kind)}">${esc(t(`fb_${r.kind || 'other'}`))}</span>${fbStatus(r.status)}
        ${fbUnread(r) ? '<span class="fb-dot">1</span>' : ''}<span class="muted small">${esc(fbDate(r.updatedAt || r.at))}</span></span>
      <span class="fb-mine-text">${esc(r.text || '')}</span>
    </button>`).join('')}</div>` : `<p class="muted small">${esc(t('fb_mine_empty'))}</p>`
  openSheet(`
    <div class="sheet-head"><button class="icon-btn" type="button" data-fb-back>${icon('chevronLeft', 20)}</button><h2>${esc(t('fb_mine'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <div class="sheet-section" id="fb-mine-list">${listHtml(myFeedback())}</div>`)
  refreshFeedbackInbox(true).then((list) => { const box = $('#fb-mine-list'); if (box) box.innerHTML = listHtml(list) })
  $('#sheet').onclick = (e) => {
    if (e.target.closest('[data-sheet-close]')) return closeSheet()
    if (e.target.closest('[data-fb-back]')) return openFeedback()
    const row = e.target.closest('[data-fb-open]')
    if (row) openFeedbackThread(row.dataset.fbOpen)
  }
}

/** Une discussion : messages, état, photos, et la réponse. */
function openFeedbackThread(id) {
  const rec = myFeedback().find((r) => r.id === id)
  if (!rec) return openMyFeedback()
  const chatHtml = (r) => (r.thread?.length ? r.thread : [{ f: 'u', m: r.text, at: r.at }]).map((m) => {
    if (m.s) return `<div class="fb-event">${esc(t('fb_status_line', { s: t(`fb_status_${m.s}`) }))} · ${esc(fbDate(m.at))}</div>`
    const pics = (m.ph ?? []).map((n) => {
      const src = api.feedbackPhotoUrl(r.id, n, r.token)
      return `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="" loading="lazy"></a>`
    }).join('')
    const mineMsg = m.f !== 'a'
    return `<div class="fb-bubble ${mineMsg ? 'mine' : ''}">${m.m ? esc(m.m) : ''}${pics ? `<div class="fb-pics">${pics}</div>` : ''}<small>${esc(mineMsg ? t('fb_you') : t('fb_team'))} · ${esc(fbDate(m.at))}</small></div>`
  }).join('')
  const markSeen = () => saveMyFeedback(myFeedback().map((r) => (r.id === id ? { ...r, seen: Date.now() } : r)))
  openSheet(`
    <div class="sheet-head"><button class="icon-btn" type="button" data-fb-back>${icon('chevronLeft', 20)}</button>
      <h2><span class="fb-kind ${esc(rec.kind)}">${esc(t(`fb_${rec.kind || 'other'}`))}</span> <span id="fb-thread-status">${fbStatus(rec.status)}</span></h2>
      <button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <div class="sheet-section">
      <div class="fb-chat" id="fb-chat">${chatHtml(rec)}</div>
      <form class="feedback-form fb-reply-form" id="fb-reply-form">
        <textarea class="text-input" id="fb-reply" rows="2" maxlength="2000" placeholder="${esc(t('fb_reply_ph'))}"></textarea>
        <div class="fb-photos" id="fb-reply-photos"></div>
        <div class="fb-reply-actions">
          <label class="btn sm ghost fb-attach" id="fb-reply-attach">${icon('image', 15)}<span>${esc(t('fb_add_photos'))}</span><input type="file" id="fb-reply-file" accept="image/*" multiple hidden></label>
          <button class="btn primary sm" type="submit" id="fb-reply-send">${icon('send', 15)}<span>${esc(t('fb_reply_send'))}</span></button>
        </div>
      </form>
    </div>`)
  const scrollEnd = () => { const c = $('#fb-chat'); if (c) c.scrollTop = c.scrollHeight }
  scrollEnd()
  markSeen()
  const picker = photoPicker($('#fb-reply-photos'), $('#fb-reply-file'), $('#fb-reply-attach'), $('#fb-reply'))
  const apply = (item) => {
    const list = myFeedback().map((r) => (r.id === id ? { ...r, status: item.status, updatedAt: item.updatedAt, lastFrom: item.lastFrom, thread: item.thread, seen: Date.now() } : r))
    saveMyFeedback(list)
    const r = list.find((x) => x.id === id)
    if (!r || !$('#fb-chat')) return
    $('#fb-chat').innerHTML = chatHtml(r)
    $('#fb-thread-status').innerHTML = fbStatus(r.status)
    scrollEnd()
  }
  // Version à jour (réponse arrivée depuis la dernière vérification).
  api.feedbackThreads([{ id, token: rec.token }]).then(({ items }) => {
    const it = items?.[0]
    if (it?.gone) { toast(t('fb_gone')); saveMyFeedback(myFeedback().filter((r) => r.id !== id)); return openMyFeedback() }
    if (it) apply(it)
  }).catch(() => {})
  $('#sheet').onclick = (e) => {
    if (e.target.closest('[data-sheet-close]')) return closeSheet()
    if (e.target.closest('[data-fb-back]')) return openMyFeedback()
  }
  // Relue toutes les 20 s tant qu'elle est affichée : la réponse et le
  // nouvel état apparaissent sans recharger. Seuls les messages sont
  // redessinés, la réponse en cours d'écriture ne bouge pas.
  const chat = $('#fb-chat')
  clearInterval(fbThreadTimer)
  fbThreadTimer = setInterval(async () => {
    if (!chat.isConnected) return clearInterval(fbThreadTimer)
    if (document.hidden) return
    try {
      const { items } = await api.feedbackThreads([{ id, token: rec.token }])
      const it = items?.[0]
      const known = myFeedback().find((r) => r.id === id)
      if (it && !it.gone && it.updatedAt !== known?.updatedAt) apply(it)
    } catch {}
  }, 20000)
  $('#fb-reply-form').onsubmit = async (e) => {
    e.preventDefault()
    const message = $('#fb-reply').value.trim()
    if (!message && !picker.photos.length) return $('#fb-reply').focus()
    const btn = $('#fb-reply-send')
    btn.disabled = true
    try {
      const r = await api.replyFeedback({ id, token: rec.token, message, photos: picker.photos })
      $('#fb-reply').value = ''
      picker.reset()
      if (r?.item) apply(r.item)
    } catch (err) {
      toast(t(err?.status === 429 ? 'fb_too_many' : 'fb_reply_failed'), 'error')
    } finally { btn.disabled = false }
  }
}

// ── Feuilles : ouvrir dans…, réglages ─────────────────────────────────────
function openSheet(html) {
  const sheet = $('#sheet')
  sheet.innerHTML = html
  renderIcons(sheet)
  $('#sheet-backdrop').hidden = false
  sheet.hidden = false
  requestAnimationFrame(() => { sheet.classList.add('open'); $('#sheet-backdrop').classList.add('open') })
}

function closeSheet() {
  const sheet = $('#sheet')
  sheet.classList.remove('open')
  $('#sheet-backdrop').classList.remove('open')
  setTimeout(() => { sheet.hidden = true; $('#sheet-backdrop').hidden = true }, 200)
}

function currentStreamUrl() {
  const links = state.watch?.links
  if (!links) return ''
  const link = links[player.quality] ?? Object.values(links)[0] ?? ''
  // Proxy coupé : l'appli externe reçoit l'adresse directe de Twitch.
  return api.EXTERNAL_LINKS_VIA_PROXY ? link : api.directUrl(link)
}

function openInSheet() {
  const url = currentStreamUrl()
  if (!url) return
  const name = (state.watch?.login || state.watch?.id || 'Twitch').replace(/[^a-zA-Z0-9]/g, '_')
  const apps = isMobile ? `
    <a class="sheet-row" href="vlc://${esc(url)}"><span class="app-dot vlc"></span><span>VLC</span>${icon('chevronRight', 16)}</a>
    <a class="sheet-row" href="outplayer://${esc(url)}"><span class="app-dot outplayer"></span><span>Outplayer</span>${icon('chevronRight', 16)}</a>
    <a class="sheet-row" href="infuse://x-callback-url/play?url=${esc(encodeURIComponent(url.replace('/api/proxy', `/api/proxy/${name}.m3u8`)))}"><span class="app-dot infuse"></span><span>Infuse</span>${icon('chevronRight', 16)}</a>` : ''
  openSheet(`
    <div class="sheet-head"><h2>${esc(t('open_in'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <p class="muted sheet-sub">${esc(t('quality'))} : ${esc(qualityLabel(player.quality ?? ''))}</p>
    <div class="sheet-group">
      ${apps}
      <button class="sheet-row" type="button" data-sheet="copy">${icon('copy', 18)}<span>${esc(t('copy_link'))}</span></button>
      <button class="sheet-row" type="button" data-sheet="m3u">${icon('download', 18)}<span>${esc(t('download_m3u'))}</span></button>
    </div>
    <input class="link-box" readonly value="${esc(url)}">`)

  const sheet = $('#sheet')
  sheet.onclick = async (e) => {
    if (e.target.closest('[data-sheet-close]')) return closeSheet()
    const act = e.target.closest('[data-sheet]')?.dataset.sheet
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(url) } catch { $('.link-box', sheet).select(); document.execCommand('copy') }
      toast(t('copied'), 'success')
    }
    if (act === 'm3u') {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([`#EXTM3U\n#EXTINF:-1,${name}\n${url}\n`], { type: 'audio/x-mpegurl' }))
      a.download = `${name}.m3u`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
  }
}

function openSettings() {
  const p = store.prefs
  const toggle = (id, label, checked, sub = '') => `
    <label class="setting">
      <span class="setting-text"><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <input type="checkbox" class="switch" id="${id}" ${checked ? 'checked' : ''}>
    </label>`
  openSheet(`
    <div class="sheet-head"><h2>${esc(t('settings'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <div class="sheet-section" id="settings-account"></div>
    <div class="sheet-section">
      <button class="feedback-card" type="button" data-action="feedback">
        <span class="feedback-card-ic">${icon('bug', 18)}</span>
        <span class="feedback-card-text"><b>${esc(t('feedback'))}</b><small>${esc(t('feedback_sub'))}</small></span>
        ${icon('chevronRight', 16)}
      </button>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('language'))}</h3>
      <div class="segmented full" id="set-lang">
        <button type="button" data-l="auto" class="${p.lang ? '' : 'active'}">${esc(t('lang_auto'))}</button>
        ${LANGS.map((l) => `<button type="button" data-l="${l.id}" class="${p.lang === l.id ? 'active' : ''}">${esc(l.label)}</button>`).join('')}
      </div>
      <p class="muted small lang-hint">${esc(t('lang_auto_sub', { l: LANGS.find((x) => x.id === deviceLang())?.label ?? 'English' }))}</p>
      ${LANGS.find((x) => x.id === lang())?.ai ? `<div class="lang-ai">${icon('sparkles', 15)}<span>${esc(t('lang_ai_note'))}</span>
        <button class="btn sm ghost" type="button" data-action="report-translation">${esc(t('lang_ai_report'))}</button></div>` : ''}
      <label class="setting setting-col">
        <span class="setting-text"><span>${esc(t('top_lang'))}</span><small>${esc(t('top_lang_sub', { l: topLangName(deviceTopLang()) }))}</small></span>
        <select class="text-input" id="set-toplang">
          <option value="auto" ${p.topLang ? '' : 'selected'}>${esc(t('lang_auto'))} · ${esc(topLangName(deviceTopLang()))}</option>
          ${TOP_LANGS.map((c) => [c, topLangName(c)]).sort((a, b) => a[1].localeCompare(b[1], lang())).map(([c, n]) => `<option value="${c}" ${p.topLang === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
      </label>
      ${toggle('set-homelist', t('home_list'), p.homeList, t('home_list_sub'))}
      ${toggle('set-recent', t('show_recent'), p.showRecent !== false, t('show_recent_sub'))}
    </div>
    <div class="sheet-section">
      <h3>${esc(t('player_settings'))}</h3>
      ${toggle('set-clickpause', t('click_pause'), p.clickPause !== false, t('click_pause_sub'))}
      <label class="setting setting-col">
        <span class="setting-text"><span>${esc(t('live_source'))}</span><small>${esc(t('live_source_sub'))}</small></span>
        <select class="text-input" id="set-source">
          ${api.LIVE_SOURCES.map((id) => `<option value="${id}" ${(p.liveSource || 'auto') === id ? 'selected' : ''}>${esc(t(`src_${id}`))}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('chat_settings'))}</h3>
      ${toggle('set-sync', t('chat_sync'), p.chatSync, t('chat_sync_sub'))}
      ${toggle('set-raid', t('auto_raid'), p.autoRaid, t('auto_raid_sub'))}
      ${toggle('set-ts', t('timestamps'), p.timestamps)}
      ${toggle('set-deleted', t('keep_deleted'), p.keepDeleted)}
      ${toggle('set-history', t('load_history'), p.loadHistory)}
      ${toggle('set-bots', t('hide_bots'), p.hideBots, t('hide_bots_sub'))}
      ${toggle('set-cmds', t('hide_commands'), p.hideCommands, t('hide_commands_sub'))}
      <label class="setting setting-col">
        <span class="setting-text"><span>${esc(t('muted_words'))}</span><small>${esc(t('muted_words_sub'))}</small></span>
        <input class="text-input" type="text" id="set-muted" autocomplete="off" spellcheck="false" maxlength="300" value="${esc((p.mutedWords ?? []).join(', '))}">
      </label>
      ${(p.blockedUsers ?? []).length ? `<div class="setting">
        <span class="setting-text"><span>${esc(t('hidden_users', { n: p.blockedUsers.length }))}</span><small>${esc(p.blockedUsers.slice(-6).join(', '))}</small></span>
        <button class="btn sm ghost" type="button" data-action="clear-blocked">${esc(t('clear'))}</button>
      </div>` : ''}
      <label class="setting setting-col">
        <span class="setting-text"><span>${esc(t('highlight_words'))}</span><small>${esc(t('highlight_words_sub'))}</small></span>
        <input class="text-input" type="text" id="set-words" autocomplete="off" spellcheck="false" maxlength="300" value="${esc((p.highlightWords ?? []).join(', '))}">
      </label>
      <label class="setting">
        <span class="setting-text"><span>${esc(t('chat_size'))}</span></span>
        <span class="size-ctl"><input type="range" id="set-size" min="12" max="20" step="1" value="${p.chatSize}"><output>${p.chatSize}</output></span>
      </label>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('backup'))}</h3>
      <p class="muted small">${esc(t('backup_sub'))}</p>
      <div class="sheet-group">
        <button class="sheet-row" type="button" data-action="export-data">${icon('download', 18)}<span>${esc(t('export_data'))}</span></button>
        <button class="sheet-row" type="button" data-action="import-data">${icon('refresh', 18)}<span>${esc(t('import_data'))}</span></button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>
    <div class="sheet-section">
      <h3>${esc(t('usage'))}</h3>
      <div class="usage-stats" id="usage-stats"><p class="muted small">${esc(t('loading'))}</p></div>
      <a class="sheet-row" href="/stats" target="_blank" rel="noopener">${icon('trending', 18)}<span>${esc(t('usage_details'))}</span>${icon('external', 16)}</a>
      ${toggle('set-usage', t('share_usage'), p.shareUsage, t('share_usage_sub'))}
    </div>
    <div class="sheet-section">
      <h3>${esc(t('about'))}</h3>
      <p class="muted small">${esc(t('about_text'))}</p>
      <div class="sheet-group">
        <a class="sheet-row" href="${api.GITHUB_URL}" target="_blank" rel="noopener">${icon('github', 18)}<span>${esc(t('source_site'))}</span>${icon('external', 16)}</a>
        <a class="sheet-row" href="${api.APP_GITHUB_URL}" target="_blank" rel="noopener">${icon('github', 18)}<span>${esc(t('source_app'))}</span>${icon('external', 16)}</a>
        <a class="sheet-row" href="${api.DISCORD_URL}" target="_blank" rel="noopener">${icon('discord', 18)}<span>${esc(t('discord_join'))}</span>${icon('external', 16)}</a>
        <button class="sheet-row" type="button" data-action="feedback">${icon('bug', 18)}<span>${esc(t('feedback'))}</span></button>
        <button class="sheet-row" type="button" data-action="whats-new">${icon('sparkles', 18)}<span>${esc(t('changelog'))}</span></button>
        <button class="sheet-row" type="button" data-action="replay-tutorial">${icon('play', 18)}<span>${esc(t('replay_tutorial'))}</span></button>
      </div>
      ${creditsHtml()}
    </div>`)
  renderSettingsAccount()
  renderUsageStats()

  const sheet = $('#sheet')
  sheet.onclick = (e) => {
    if (e.target.closest('[data-sheet-close]')) return closeSheet()
    const l = e.target.closest('[data-l]')?.dataset.l
    if (l) {
      // « Appareil » n'enregistre rien : la langue suivra l'appareil, y
      // compris s'il change de langue plus tard.
      store.prefs.lang = l === 'auto' ? null : l
      setLang(l === 'auto' ? deviceLang() : l)
      store.savePrefs()
      applyStatic()
      renderAccount()
      refreshTexts()
      // La feuille elle-même est refaite dans la nouvelle langue.
      const scroll = sheet.scrollTop
      openSettings()
      $('#sheet').scrollTop = scroll
    }
  }
  sheet.onchange = (e) => {
    const id = e.target.id
    if (id === 'set-ts') p.timestamps = e.target.checked
    if (id === 'set-sync') p.chatSync = e.target.checked
    if (id === 'set-raid') p.autoRaid = e.target.checked
    if (id === 'set-deleted') p.keepDeleted = e.target.checked
    if (id === 'set-history') p.loadHistory = e.target.checked
    if (id === 'set-bots') p.hideBots = e.target.checked
    if (id === 'set-cmds') p.hideCommands = e.target.checked
    if (id === 'set-muted') {
      p.mutedWords = e.target.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 50)
    }
    if (id === 'set-words') {
      p.highlightWords = e.target.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 30)
    }
    if (id === 'import-file') { importData(e.target.files?.[0]); e.target.value = ''; return }
    if (id === 'set-clickpause') p.clickPause = e.target.checked
    if (id === 'set-source') { switchLiveSource(e.target.value); return }
    if (id === 'set-homelist') { p.homeList = e.target.checked; store.savePrefs(); applyLayout(); return }
    if (id === 'set-recent') { p.showRecent = e.target.checked; store.savePrefs(); renderRecentChannels(); return }
    if (id === 'set-toplang') {
      p.topLang = e.target.value === 'auto' ? null : e.target.value
      store.savePrefs()
      renderTopLocal()
      loadTop('local')
      return
    }
    if (id === 'set-usage') {
      p.shareUsage = e.target.checked
      if (p.shareUsage) usage.ping(true)
      else usage.forget()
    }
    store.savePrefs()
    chat.applyPrefs()
  }
  sheet.oninput = (e) => {
    if (e.target.id !== 'set-size') return
    p.chatSize = Number(e.target.value)
    e.target.nextElementSibling.textContent = p.chatSize
    store.savePrefs()
    chat.applyPrefs()
  }
}

// ── Sauvegarde : export / import ───────────────────────────────────────
// Même format que l'app iOS : les suivis passent d'un appareil à l'autre,
// et les réglages communs aux deux portent le même nom.
const BACKUP_FORMAT = 'twitchunblock-backup'
// Réglages exportés : tout sauf ce qui dépend de l'appareil.
const BACKUP_SKIP = new Set(['volume', 'muted', 'chatOpen'])

function exportData() {
  const p = store.prefs
  const settings = Object.fromEntries(Object.entries(p).filter(([k]) => !BACKUP_SKIP.has(k) && k !== 'localFollows' && k !== 'followedCategories'))
  const data = {
    format: BACKUP_FORMAT,
    version: 1,
    platform: 'web',
    exportedAt: new Date().toISOString(),
    follows: [...(p.localFollows ?? [])],
    accountFollows: [...(state.accountFollows ?? [])],
    followedCategories: [...(p.followedCategories ?? [])],
    settings,
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  a.download = `twitchunblock-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  toast(t('export_done'), 'success')
}

async function importData(file) {
  if (!file) return
  let data
  try {
    if (file.size > 2_000_000) throw new Error('size')
    data = JSON.parse(await file.text())
    if (data?.format !== BACKUP_FORMAT) throw new Error('format')
  } catch {
    return toast(t('import_bad'), 'error')
  }
  const p = store.prefs
  const login = (x) => (typeof x === 'string' && /^[a-zA-Z0-9_]{1,25}$/.test(x) ? x.toLowerCase() : null)
  const incoming = [...(data.follows ?? []), ...(data.accountFollows ?? [])].map(login).filter(Boolean)
  const before = new Set(p.localFollows ?? [])
  p.localFollows = [...new Set([...(p.localFollows ?? []), ...incoming])].slice(0, 300)
  const added = p.localFollows.filter((l) => !before.has(l)).length

  const cats = new Map((p.followedCategories ?? []).map((c) => [c.id, c]))
  for (const c of data.followedCategories ?? []) {
    if (c && typeof c.id === 'string' && typeof c.name === 'string' && !cats.has(c.id)) {
      cats.set(c.id, { id: c.id, name: c.name, box: typeof c.box === 'string' ? c.box : '' })
    }
  }
  p.followedCategories = [...cats.values()].slice(0, 200)

  // Réglages : seulement les clés connues du site, du même type que la
  // valeur actuelle. Une sauvegarde de l'app iOS apporte les réglages
  // communs (langue, filtres du chat…), qu'elle exporte sous ces noms-là.
  if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
    for (const [k, v] of Object.entries(data.settings)) {
      if (BACKUP_SKIP.has(k) || !(k in p) || k === 'localFollows' || k === 'followedCategories') continue
      const cur = p[k]
      if (cur === null || typeof cur === typeof v || (Array.isArray(cur) && Array.isArray(v))) p[k] = v
    }
  }
  store.savePrefs()
  if (p.lang) setLang(p.lang)
  applyStatic()
  applyLayout()
  chat.applyPrefs()
  loadFollowed()
  toast(t('import_done', { n: added }), 'success')
  openSettings()
}

// ── Langue du top des lives ────────────────────────────────────────────
// Twitch ne filtre pas par pays mais par langue du streamer : on prend la
// langue choisie dans les réglages, sinon la première langue de l'appareil
// que Twitch connaît (« pt-BR » → portugais), sinon l'anglais.
const TOP_LANGS = ['ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'th', 'tl', 'tr', 'uk', 'vi', 'zh', 'zh_hk']
const TOP_ALIAS = { nb: 'no', nn: 'no', fil: 'tl' }
function deviceTopLang() {
  for (const raw of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const tag = String(raw || '').toLowerCase()
    if (/^zh-(hk|mo|hant)/.test(tag)) return 'zh_hk'
    const base = tag.split('-')[0]
    const code = TOP_ALIAS[base] ?? base
    if (TOP_LANGS.includes(code)) return code
  }
  return 'en'
}
const topLangCode = () => (TOP_LANGS.includes(store.prefs.topLang) ? store.prefs.topLang : deviceTopLang())
function topLangName(code) {
  try {
    const n = new Intl.DisplayNames([lang()], { type: 'language' }).of(code === 'zh_hk' ? 'zh-HK' : code)
    return n ? n.charAt(0).toLocaleUpperCase(lang()) + n.slice(1) : code.toUpperCase()
  } catch { return code.toUpperCase() }
}
function renderTopLocal() {
  const b = $('#top-local')
  if (b) b.textContent = topLangName(topLangCode())
}

// ── Annonce du développeur ─────────────────────────────────────────────
// Même annonce que dans l'app (publiée depuis /stats), en haut de l'accueil.
// Relue à l'ouverture et au retour sur l'onglet (au plus toutes les 5 min) ;
// une annonce fermée ne revient pas (une nouvelle, si).
const ANN_DISMISSED = 'tu_ann_dismissed'
// Réactions : une par appareil, la même toucher deux fois la retire.
const ANN_REACTIONS = ['👍', '❤️', '🔥', '😂', '👎']
const ANN_REACTED = 'tu_ann_reacted'
function annReactions() { try { return JSON.parse(localStorage.getItem(ANN_REACTED) || '{}') } catch { return {} } }
function annReaction(id) { return annReactions()[id] ?? null }
async function reactToAnnouncement(a, emoji) {
  const all = annReactions()
  const prev = all[a.id] ?? null
  const next = prev === emoji ? null : emoji
  // Affichage immédiat ; on revient en arrière si le serveur refuse.
  const save = (v) => {
    const m = annReactions()
    if (v) m[a.id] = v; else delete m[a.id]
    // Seules les 10 dernières annonces sont gardées.
    try { localStorage.setItem(ANN_REACTED, JSON.stringify(Object.fromEntries(Object.entries(m).slice(-10)))) } catch {}
    renderAnnouncement()
  }
  save(next)
  try {
    const res = await fetch(`${api.API_URL}/api/announcement/react`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcementId: a.id, id: usage.installId(), emoji: next }),
    })
    if (!res.ok) throw new Error(String(res.status))
  } catch { save(prev); toast(t('react_failed')) }
}
let annFetchedAt = 0
let annCurrent = null
async function loadAnnouncement(force = false) {
  if (!force && Date.now() - annFetchedAt < 5 * 60_000) return renderAnnouncement()
  try {
    const res = await fetch(`${api.API_URL}/api/announcement`, { cache: 'no-store' })
    if (!res.ok) return
    annCurrent = (await res.json()).announcement ?? null
    annFetchedAt = Date.now()
  } catch { return }
  renderAnnouncement()
}
function renderAnnouncement() {
  const box = $('#announcement')
  if (!box) return
  let dismissed = []
  try { dismissed = JSON.parse(localStorage.getItem(ANN_DISMISSED) || '[]') } catch {}
  const a = annCurrent
  if (!a || !(a.until > Date.now()) || dismissed.includes(a.id)) { box.hidden = true; box.innerHTML = ''; return }
  const link = /^https:\/\//i.test(a.link || '') ? a.link : null
  box.innerHTML = `<div class="announce" role="status">
    <span class="announce-ic">${icon('megaphone', 18)}</span>
    <div class="announce-body">
      ${a.title ? `<h3>${esc(a.title)}</h3>` : ''}
      ${a.message ? `<p>${esc(a.message)}</p>` : ''}
      ${link ? `<a class="btn primary sm" href="${esc(link)}" target="_blank" rel="noopener">${esc(t('announcement_open'))} ${icon('external', 14)}</a>` : ''}
      <div class="announce-reacts" role="group" aria-label="${esc(t('react'))}">${ANN_REACTIONS.map((e) => `<button type="button" data-react="${e}" class="${annReaction(a.id) === e ? 'on' : ''}" aria-pressed="${annReaction(a.id) === e}">${e}</button>`).join('')}</div>
    </div>
    <button class="icon-btn" type="button" data-ann-close title="${esc(t('close'))}">${icon('x', 18)}</button>
  </div>`
  box.hidden = false
  box.querySelector('.announce-reacts').onclick = (e) => {
    const b = e.target.closest('[data-react]')
    if (b) reactToAnnouncement(a, b.dataset.react)
  }
  box.querySelector('[data-ann-close]').onclick = () => {
    try { localStorage.setItem(ANN_DISMISSED, JSON.stringify([...dismissed, a.id].slice(-20))) } catch {}
    box.hidden = true
  }
}

/** Combien de gens utilisent le site et l'app : aujourd'hui, 7 et 30 jours. */
async function renderUsageStats() {
  const box = $('#usage-stats')
  if (!box) return
  let s = null
  try { s = await usage.fetchStats() } catch {}
  if (!$('#usage-stats')) return
  if (!s) { box.innerHTML = `<p class="muted small">${esc(t('usage_unavailable'))}</p>`; return }
  const web = s.platforms?.web ?? { today: 0, week: 0, month: 0 }
  const ios = s.platforms?.ios ?? { today: s.today, week: s.week, month: s.month }
  const row = (label, k) => `
    <div class="usage-cell">
      <span class="usage-label">${esc(label)}</span>
      <strong>${esc(formatViewers(s[k] ?? 0))}</strong>
      <span class="usage-split">${icon('globe', 12)} ${esc(formatViewers(web[k] ?? 0))} · iOS ${esc(formatViewers(ios[k] ?? 0))}</span>
    </div>`
  box.innerHTML = `
    <div class="usage-grid">${row(t('usage_today'), 'today')}${row(t('usage_week'), 'week')}${row(t('usage_month'), 'month')}</div>
    <p class="muted small">${esc(t('usage_note'))}</p>`
}

function renderSettingsAccount() {
  const box = $('#settings-account')
  if (!box) return
  box.innerHTML = session.login ? `
    <h3>${esc(t('account'))}</h3>
    <div class="account-row">
      ${session.avatar ? `<img class="avatar" src="${esc(session.avatar)}" alt="">` : `<span class="avatar placeholder">${esc(session.login[0].toUpperCase())}</span>`}
      <div class="account-id"><strong>${esc(session.login)}</strong>
        <small class="muted">${esc(session.canChat ? t('connected_as', { u: session.login }) : t('chat_rescope'))}</small></div>
      ${session.canChat ? '' : `<button class="btn sm primary" type="button" data-action="login-again">${esc(t('login'))}</button>`}
      <button class="btn sm danger" type="button" data-action="logout">${icon('logout', 16)}<span>${esc(t('logout'))}</span></button>
    </div>
    <button class="sheet-row switch-account" type="button" data-action="switch-account">${icon('users', 18)}<span class="setting-text"><span>${esc(t('switch_account'))}</span><small>${esc(t('switch_account_sub'))}</small></span></button>` : `
    <h3>${esc(t('account'))}</h3>
    <div class="account-row">
      <span class="avatar placeholder">${icon('user', 18)}</span>
      <div class="account-id"><strong>${esc(t('not_connected'))}</strong><small class="muted">${esc(t('login_prompt'))}</small></div>
    </div>
    <button class="btn primary full" type="button" data-action="login">${icon('twitch', 18)}<span>${esc(t('login'))}</span></button>`
}
actions['login-again'] = () => login()
// Le compte actuel reste en place tant que le nouveau n'est pas connecté.
actions['switch-account'] = () => login({ chooseAccount: true })

/** Après un changement de langue : ce qui a été rendu en JS est refait. */
function refreshTexts() {
  renderTopLocal()
  applyLayout()
  renderAnnouncement()
  renderContinue()
  renderRecentChannels()
  state.loaded.followed = 0
  state.loaded.top = 0
  if (state.tab === 'discover') { loadFollowed(); loadTop(state.topLang) }
  if (state.channel) renderChannel($('#vod-filter')?.value?.trim().toLowerCase() ?? '')
  chat.applyPrefs()
}
