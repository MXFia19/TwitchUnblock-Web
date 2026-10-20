// ═══════════════════════════════════════════════════════════════════════════
//  Multi-live : jusqu'à quatre vidéos côte à côte, directs et VODs mêlés.
//  Chaque tuile a son petit lecteur (hls.js) ; le son ne vient que d'une
//  tuile à la fois — un clic dessus le lui donne. Une VOD reprend où on en
//  était, et la tuile qui a le son porte ses commandes (±10 s, pause, barre).
//  La sélection est gardée sur l'appareil ; « /?multi=a,v:123 » la partage.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from './api.js'
import { t } from './i18n.js'
import { bufferConfig, failedProxy, heightOf, liveRequestUrl, loadHls, mediaFixAllowed, noteDirectSegmentError, sortQualities } from './player.js'
import { store } from './store.js'
import { $, esc, formatClock, icon, toast, twitchTime } from './util.js'

export const MULTI_MAX = 4
const KEY = 'tu_multi'
/** Relances d'une tuile sans image avant de la dire hors ligne. */
const MAX_RESTARTS = 3
const VOD_RE = /^\d{6,20}$/

// Déclarés avant `list = load()`, qui s'en sert à l'évaluation du module.
/** « v:<id> » pour une VOD, le login pour un direct. */
export const keyOf = (e) => (e.vod ? `v:${e.vod}` : e.login)
const text = (v) => (typeof v === 'string' ? v.slice(0, 200) : '')
const vodEntry = (id, o = {}) => ({ vod: String(id), channel: api.cleanLogin(o.channel) ?? '', name: text(o.name), title: text(o.title) })
/** Nom affiché : la chaîne d'un direct, « VOD · chaîne » pour une VOD. */
const labelOf = (e) => (e.vod ? `VOD · ${e.name || e.vod}` : e.name || e.login)

// Directs : { login, name }. VODs : { vod, channel, name, title }, sans
// champ `login` — un chemin qui ne connaît que les directs (ou un onglet
// resté sur l'ancien code) les ignore de lui-même.
let list = load()
const tiles = new Map()    // clé → { key, entry, el, video, hls, timer, token, restarts, … }
let audible = null         // clé de la tuile qui a le son
let hooks = {}
/** Instant d'un lien partagé (« v:<id>~<s> ») ou collé dans « + » : au
 *  premier démarrage de la tuile seulement, jamais gardé dans tu_multi. */
const pendingAt = new Map()
const find = (key) => list.find((x) => keyOf(x) === key)

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .map((x) => {
        if (VOD_RE.test(String(x?.vod ?? ''))) return vodEntry(x.vod, x)
        const login = api.cleanLogin(x?.login)
        return login ? { login, name: text(x.name) || login } : null
      })
      .filter(Boolean)
      .slice(0, MULTI_MAX)
  } catch { return [] }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }

export const has = (login) => list.some((x) => !x.vod && x.login === login)
export const hasVod = (id) => list.some((x) => x.vod === String(id))
/** Entrée qui a le son (son chat), la première à défaut. */
export const audibleEntry = () => find(audible) ?? list[0] ?? null
export const isOpen = () => !$('#multi').hidden
const sharePath = () => `/?multi=${list.map(keyOf).join(',')}`

/** Position d'une VOD dans sa tuile, sinon sa reprise enregistrée. */
export function positionOf(entry) {
  const tile = tiles.get(keyOf(entry))
  const cur = tile?.video.currentTime || tile?.pos || 0
  if (cur > 0) return cur
  // Tuile pas encore partie : l'instant d'un lien passe avant la reprise.
  return pendingAt.get(keyOf(entry)) ?? hooks.resume?.(entry.vod) ?? 0
}

/** Lien à copier : celui de la mosaïque, avec l'instant de chaque VOD
 *  (« v:<id>~<secondes> »). */
export function shareUrl() {
  const parts = list.map((x) => {
    if (!x.vod) return x.login
    const s = Math.floor(positionOf(x))
    return s > 0 ? `v:${x.vod}~${s}` : `v:${x.vod}`
  })
  return `${location.origin}/?multi=${parts.join(',')}`
}

/** Ce que désigne une saisie du « + » : une VOD (lien /videos/<id> ou ancien
 *  lien /<chaîne>/v/<id>, avec « ?t= » éventuel, ou un nombre de 8 chiffres
 *  et plus), sinon une chaîne. */
function parseInput(raw) {
  const s = String(raw ?? '').trim()
  const id = (/(?:videos|\/v)\/v?(\d{6,20})/.exec(s) ?? /^(\d{8,20})$/.exec(s))?.[1]
  if (id) return { vod: id, at: twitchTime(/[?&]t=([^&#\s]+)/.exec(s)?.[1]) }
  const login = api.cleanLogin(/twitch\.tv\/([A-Za-z0-9_]{1,25})(?:[/?#]|$)/i.exec(s)?.[1] ?? s)
  return login ? { login } : null
}

/**
 * @param {object} o
 * @param {() => void} o.onOpen          avant l'ouverture (le lecteur se ferme)
 * @param {() => void} o.onClose         après la fermeture (positions enregistrées)
 * @param {(entry: object, at: number|null) => void} o.onWatch  ouvrir une vidéo dans le lecteur (avec le chat)
 * @param {(path: string|null, replace?: boolean) => void} o.onUrl  adresse de la mosaïque (null : fermée)
 * @param {(entry: object|null) => void} o.onAudible  vidéo qui a le son (son chat), null à la fermeture
 * @param {(id: string) => number} o.resume  progression enregistrée d'une VOD
 * @param {(entry: object, meta: object|null) => void} o.onVodStart  premier démarrage d'une tuile VOD
 * @param {(ok: boolean) => void} o.onVodCount  premier résultat d'une tuile VOD (statistiques)
 * @param {(entry: object, t: number, d: number, o: { final: boolean, save: boolean }) => void} o.onVodTime
 *        position d'une tuile VOD ; `save` une fois la lecture partie, `final` à la pause, à la fin et au retrait
 */
export function init(o) {
  hooks = o
  $('#multi-bar').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-mb-remove]')
    if (rm) remove(rm.dataset.mbRemove)
  })
  // Ajouter une chaîne, ou une VOD par son lien ou son ID, depuis la mosaïque.
  $('#multi-add-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const input = $('#multi-add-input')
    const what = parseInput(input.value)
    if (!what) return toast(t('not_found'), 'error')
    input.value = ''
    input.blur()
    if (what.vod) addVod(what.vod, { at: what.at })
    else add(what.login)
  })
  const grid = $('#multi-grid')
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.mtile')
    if (!tile) return
    const key = tile.dataset.key
    const b = e.target.closest('[data-mt]')?.dataset.mt
    if (b === 'remove') return remove(key)
    if (b === 'earlier') return moveEarlier(key)
    if (b === 'retry') return restart(key)
    if (b === 'replay') return replay(key)
    if (b === 'play') return togglePlay(key)
    if (b === 'back' || b === 'fwd') return seekBy(key, b === 'back' ? -10 : 10)
    if (b === 'seek') return // au pointeur, plus bas
    if (b === 'watch') {
      const entry = find(key)
      if (!entry) return
      // L'instant donné au lecteur y est pris tel quel : seulement la
      // position de la tuile (ou l'instant d'un lien pas encore lu). Sinon
      // — tuile pas encore partie, ou VOD finie —, la reprise du lecteur,
      // qui fait repartir du début une VOD finie ou presque.
      const own = tiles.get(key)
      const at = entry.vod && !own?.video.ended ? own?.video.currentTime || own?.pos || pendingAt.get(key) || 0 : 0
      close({ url: false })
      return hooks.onWatch?.(entry, at > 1 ? at : null)
    }
    if (e.target.closest('.mt-bottom')) return
    setAudible(key)
  })
  // Barre de position d'une VOD : un clic, ou glisser ; la vidéo ne saute
  // qu'au lâcher (un saut à chaque mouvement rechargerait sans cesse).
  grid.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('[data-mt="seek"]')
    const tile = tiles.get(bar?.closest('.mtile')?.dataset.key)
    if (!bar || !tile || e.button !== 0) return
    e.preventDefault()
    try { bar.setPointerCapture(e.pointerId) } catch {}
    const ratio = (ev) => {
      const r = bar.getBoundingClientRect()
      return r.width ? Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) : 0
    }
    tile.dragging = true
    showTime(tile, ratio(e) * durationOf(tile))
    const move = (ev) => showTime(tile, ratio(ev) * durationOf(tile))
    const end = (ev) => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', end)
      bar.removeEventListener('pointercancel', end)
      tile.dragging = false
      if (ev.type === 'pointerup') seekTo(tile.key, ratio(ev) * durationOf(tile))
      else showTime(tile)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', end)
    bar.addEventListener('pointercancel', end)
  })
  // Double-clic : la tuile en plein écran (et retour).
  grid.addEventListener('dblclick', (e) => {
    const tile = e.target.closest('.mtile')
    if (!tile || e.target.closest('[data-mt], .mt-bottom')) return
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else tile.requestFullscreen?.().catch(() => {})
  })
  // Retour sur l'onglet : le navigateur a pu mettre en pause les tuiles
  // muettes (économie d'énergie en arrière-plan) ; elles repartent — sauf une
  // VOD mise en pause exprès ou finie (play() la relancerait depuis le début).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !isOpen()) return
    for (const tile of tiles.values()) {
      const v = tile.video
      if (v.paused && v.readyState > 0 && !tile.userPaused && !v.ended) v.play().catch(() => {})
    }
  })
  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target.closest?.('input, textarea, [contenteditable]')) return
    // Une fiche ouverte dans le chat (emote, utilisateur, sélecteur) se ferme
    // d'abord, par l'Échap du chat (posé après celui-ci) : la mosaïque reste.
    if (e.key === 'Escape' && $('#multi-chat').querySelector('.chat-info:not([hidden]), .user-card:not([hidden]), .emote-picker:not([hidden])')) return
    if (e.key === 'Escape' && !document.fullscreenElement) return close()
    // Par la touche physique : 1 à 4 aussi sur un clavier AZERTY (sans Maj).
    const n = Number(/^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1])
    if (n && n <= list.length) return setAudible(keyOf(list[n - 1]))
    if (e.key === 'm' || e.key === 'M') {
      const tile = tiles.get(audible)
      if (tile) tile.video.muted = !tile.video.muted
      return refreshSound()
    }
    // VOD qui a le son : Espace ou K (lecture/pause), ← et → (10 s).
    if (!tiles.get(audible)?.entry.vod) return
    if (e.code === 'KeyK' || (e.code === 'Space' && !e.target.closest?.('button, a'))) {
      e.preventDefault()
      return togglePlay(audible)
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault()
      return seekBy(audible, e.code === 'ArrowLeft' ? -10 : 10)
    }
  })
  renderBar()
}

// ── Sélection ────────────────────────────────────────────────────────────
/** Une entrée de plus, si la mosaïque n'est pas pleine. */
function push(entry) {
  if (list.length >= MULTI_MAX) {
    toast(t('multi_full', { max: MULTI_MAX }), 'error')
    return false
  }
  list.push(entry)
  save()
  renderBar()
  if (isOpen()) { sync(); hooks.onUrl?.(sharePath(), true) }
  toast(t('multi_added', { n: list.length, max: MULTI_MAX }), 'success')
  return true
}

/** Ajoute (ou retire, s'il y est déjà) un direct. */
export function toggle(rawLogin, name) {
  const login = api.cleanLogin(rawLogin)
  if (!login) return
  if (has(login)) {
    remove(login)
    return toast(t('multi_removed'))
  }
  push({ login, name: name || login })
}

/** Ajoute sans retirer (bouton du lecteur). */
export function add(login, name) {
  if (has(api.cleanLogin(login))) return toast(t('multi_already'))
  toggle(login, name)
}

/** Ajoute (ou retire) une VOD. `at` : instant de départ (lien collé). */
export function toggleVod(rawId, { name, title, channel, at } = {}) {
  const id = String(rawId ?? '')
  if (!VOD_RE.test(id)) return
  if (hasVod(id)) {
    remove(`v:${id}`)
    return toast(t('multi_removed'))
  }
  const entry = vodEntry(id, { name, title, channel })
  if (at > 0) pendingAt.set(keyOf(entry), at)
  if (!push(entry)) pendingAt.delete(keyOf(entry))
}

/** Ajoute une VOD sans la retirer (lecteur, champ « + »). */
export function addVod(id, o = {}) {
  if (hasVod(id)) return toast(t('multi_already'))
  toggleVod(id, o)
}

/** Une entrée retirée, par sa clé (login ou « v:<id> »). */
export function remove(key) {
  list = list.filter((x) => keyOf(x) !== key)
  pendingAt.delete(key)
  save()
  renderBar()
  if (!isOpen()) return
  if (!list.length) return close()
  sync()
  hooks.onUrl?.(sharePath(), true)
}

/** Une place plus tôt dans la mosaïque (la première est la grande, à trois) ;
 *  les vidéos continuent, seule la disposition change. */
function moveEarlier(key) {
  const i = list.findIndex((x) => keyOf(x) === key)
  if (i <= 0) return
  list.splice(i - 1, 2, list[i], list[i - 1])
  save()
  renderBar()
  if (!isOpen()) return
  sync()
  hooks.onUrl?.(sharePath(), true)
}

export function clear() {
  list = []
  save()
  close()
  renderBar()
}

/** Adresse partagée (« /?multi=xqc,v:123~456 ») : cette sélection-là, ouverte. */
export function openWith(tokens) {
  const next = []
  for (const raw of tokens) {
    const m = /^v:(\d{6,20})(?:~(\d{1,7}))?$/i.exec(String(raw ?? '').trim())
    const login = m ? null : api.cleanLogin(raw)
    const entry = m ? (find(`v:${m[1]}`) ?? vodEntry(m[1])) : login ? (find(login) ?? { login, name: login }) : null
    if (!entry || next.some((x) => keyOf(x) === keyOf(entry))) continue
    // L'instant ne vaut que pour une tuile à créer (pas celle qui joue déjà).
    if (m && Number(m[2]) > 0 && !tiles.has(keyOf(entry))) pendingAt.set(keyOf(entry), Number(m[2]))
    next.push(entry)
    if (next.length >= MULTI_MAX) break
  }
  if (!next.length) return
  list = next
  save()
  open({ url: false })
  // L'adresse garde la sélection, sans les instants : un rechargement
  // reprend chaque VOD à sa progression, pas à l'instant du lien.
  hooks.onUrl?.(sharePath(), true)
}

/** Titre et chaîne d'une VOD, connus au démarrage de sa tuile. */
function updateVod(entry, meta) {
  entry.channel = api.cleanLogin(meta.owner?.login) ?? entry.channel
  entry.name = text(meta.owner?.displayName) || entry.name
  entry.title = text(meta.title) || entry.title
  if (!list.includes(entry)) return
  save()
  renderBar()
  const tile = tiles.get(keyOf(entry))
  const name = tile && $('.mt-name', tile.el)
  if (name) {
    name.textContent = entry.name || entry.vod
    name.title = entry.title
  }
}

// ── Mosaïque ─────────────────────────────────────────────────────────────
export function open({ url = true } = {}) {
  if (!list.length) return
  hooks.onOpen?.()
  $('#multi').hidden = false
  document.documentElement.classList.add('multi-open')
  if (!find(audible)) audible = keyOf(list[0])
  sync()
  renderBar()
  if (url) hooks.onUrl?.(sharePath())
}

export function close({ url = true } = {}) {
  if (!isOpen()) return
  if (document.fullscreenElement && $('#multi').contains(document.fullscreenElement)) {
    document.exitFullscreen?.().catch(() => {})
  }
  for (const tile of tiles.values()) destroyTile(tile)
  tiles.clear()
  $('#multi').hidden = true
  document.documentElement.classList.remove('multi-open')
  hooks.onAudible?.(null)
  hooks.onClose?.()
  renderBar()
  if (url) hooks.onUrl?.(null)
}

/** Les tuiles suivent la liste : ajoutées, retirées, remises dans l'ordre. */
function sync() {
  const grid = $('#multi-grid')
  for (const [key, tile] of tiles) {
    if (!find(key)) { destroyTile(tile); tiles.delete(key) }
  }
  for (const entry of list) {
    const tile = tiles.get(keyOf(entry))
    if (tile) grid.appendChild(tile.el)
    else mountTile(entry)
  }
  grid.className = `multi-grid n${list.length}`
  $('#multi-add-form').hidden = list.length >= MULTI_MAX
  setAudible(find(audible) ? audible : list[0] ? keyOf(list[0]) : null)
}

function mountTile(entry) {
  const key = keyOf(entry)
  const el = document.createElement('div')
  el.className = entry.vod ? 'mtile vod' : 'mtile'
  el.dataset.key = key
  const btn = (mt, name, label) => `<button class="icon-btn sm" type="button" data-mt="${mt}" title="${esc(t(label))}" aria-label="${esc(t(label))}">${icon(name, 18)}</button>`
  el.innerHTML = `
    <video playsinline webkit-playsinline muted></video>
    <div class="mt-state"><span class="spinner"></span></div>
    <div class="mt-top">
      <span class="mt-sound"></span>
      ${entry.vod ? '<span class="pill vod sm">VOD</span>' : ''}
      <span class="mt-name"${entry.title ? ` title="${esc(entry.title)}"` : ''}>${esc(entry.vod ? entry.name || entry.vod : entry.name || entry.login)}</span>
      <span class="mt-gap"></span>
      <span class="mt-btns">
        <button class="icon-btn xs" type="button" data-mt="earlier" title="${esc(t('multi_earlier'))}">${icon('chevronLeft', 15)}</button>
        <button class="icon-btn xs" type="button" data-mt="watch" title="${esc(t('multi_open'))}">${icon('maximize', 14)}</button>
        <button class="icon-btn xs" type="button" data-mt="remove" title="${esc(t('multi_remove'))}">${icon('x', 15)}</button>
      </span>
    </div>
    ${entry.vod ? `
    <span class="mt-paused">${icon('pause', 22)}</span>
    <div class="mt-progress"><span></span></div>
    <div class="mt-bottom">
      ${btn('back', 'back10', 'back10')}${btn('play', 'play', 'play')}${btn('fwd', 'fwd10', 'fwd10')}
      <span class="mt-time"><span></span><span class="mt-total"></span></span>
      <div class="mt-seek" data-mt="seek" role="slider" tabindex="0" aria-label="${esc(t('multi_seek'))}" aria-valuemin="0"><span></span></div>
    </div>` : ''}`
  const tile = { key, entry, el, video: $('video', el), hls: null, timer: null, token: 0, restarts: 0 }
  tiles.set(key, tile)
  $('#multi-grid').appendChild(el)
  start(tile)
}

function restart(key) {
  const tile = tiles.get(key)
  if (!tile) return
  tile.restarts = 0
  start(tile)
}

function start(tile) {
  return tile.entry.vod ? startVod(tile) : startLive(tile)
}

/** `avoid` : Worker qui ne répondait plus (retryLive) — les liens sont
 *  redemandés aux autres d'abord. */
async function startLive(tile, { avoid = null } = {}) {
  const token = ++tile.token
  stopMedia(tile)
  setState(tile, 'loading')
  // Comme openLive : « missing », aucune source n'a de direct (404) ou nom
  // refusé (400) ; « failed », une autre erreur du Worker (5xx), qui passait
  // pour « Hors ligne » alors que la chaîne était en live.
  const res = await api.getLive(tile.entry.login, { avoid }).catch((e) => ({ error: e?.status === 404 || e?.status === 400 ? 'missing' : e?.status ? 'failed' : 'network' }))
  if (tile.token !== token) return
  const links = res?.links
  if (!links || res.error || !Object.keys(links).length) {
    return setState(tile, res?.error === 'network' ? t('err_network') : res?.error === 'failed' ? t('err_live') : t('multi_offline'), true)
  }
  const url = pickLink(links, res.variants)
  const v = tile.video
  v.onplaying = () => {
    if (tile.token !== token) return
    tile.restarts = 0
    setState(tile, null)
  }
  v.onwaiting = () => { if (tile.token === token) setState(tile, 'loading') }

  const Hls = await loadHls()
  if (tile.token !== token) return
  if (Hls?.isSupported()) {
    const hls = new Hls({
      xhrSetup: (xhr, reqUrl) => {
        const fixed = liveRequestUrl(reqUrl, url)
        if (fixed !== reqUrl) xhr.open('GET', fixed, true)
      },
      // Pas plus que la taille de la tuile : quatre directs en 1080p ne
      // passeraient pas sur toutes les connexions.
      capLevelToPlayerSize: true,
      liveSyncDuration: 4,
      // Jamais de changement de vitesse (le son se décalait de l'image) :
      // trop loin du direct, hls.js saute vers la cible. Les tuiles n'ont pas
      // de recul à protéger. Doit rester au-dessus de liveSyncDuration
      // (sinon hls.js refuse la configuration), avec de la marge pour la
      // cible qu'il relève après des calages (jusqu'à +6 s).
      liveMaxLatencyDuration: 14,
      // 10 s derrière, 12 s d'avance (bufferConfig).
      ...bufferConfig('live', { tile: true }),
    })
    tile.hls = hls
    tile.directFails = 0
    hls.loadSource(url)
    hls.attachMedia(v)
    hls.on(Hls.Events.MANIFEST_PARSED, () => play(tile))
    hls.on(Hls.Events.FRAG_LOADED, () => { tile.directFails = 0 })
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (tile.token !== token) return
      // Segments bloqués avant d'atteindre Twitch : par le relais du
      // Worker, comme dans le lecteur.
      if (noteDirectSegmentError(Hls, data, tile) && data.fatal) return hls.startLoad()
      if (!data.fatal) return
      // Erreur média réparée sur place une fois ; revenue aussitôt, la tuile
      // repart sur une nouvelle instance (retryLive) — elle restait figée.
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaFixAllowed(tile)) return hls.recoverMediaError()
      const network = data.type === Hls.ErrorTypes.NETWORK_ERROR
      retryLive(tile, token, network && navigator.onLine !== false ? failedProxy(data) : null, network)
    })
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    // HLS natif (Safari sans MSE) : une erreur relance comme avec hls.js —
    // la roue tournait sans fin.
    v.onerror = () => retryLive(tile, token, v.error?.code === 2 && navigator.onLine !== false ? api.proxyBaseOf(url) : null, true)
    v.src = url
    v.addEventListener('loadedmetadata', () => play(tile), { once: true })
    v.load()
  } else {
    setState(tile, t('err_live'), true)
  }
}

/**
 * Direct d'une tuile en échec. Relais du VPS en panne (`down`) : écarté, la
 * tuile repart aussitôt par le Worker. Sinon les liens sont redemandés —
 * à un autre Worker d'abord si c'est celui-ci qui ne répondait plus —,
 * quelques fois, puis l'erreur. Les relances reprenaient les mêmes liens,
 * par le même relais, et la tuile finissait « Hors ligne » alors que le
 * direct était en ligne (un direct fini, lui, l'est par startLive).
 */
function retryLive(tile, token, down, network) {
  if (tile.token !== token) return
  if (down && down === api.RELAY_BASE && api.markWorkerDown(down)) {
    console.info('[TwitchUnblock] Relais vidéo injoignable (multi-live), retour au Worker.')
    return startLive(tile)
  }
  if (++tile.restarts > MAX_RESTARTS) return setState(tile, t(network ? 'err_network' : 'err_live'), true)
  setState(tile, 'loading')
  tile.timer = setTimeout(() => startLive(tile, { avoid: down }), 4000)
}

async function startVod(tile) {
  const token = ++tile.token
  stopMedia(tile)
  setState(tile, 'loading')
  const id = tile.entry.vod
  const [res, meta] = await Promise.all([
    api.getVodLinks(id).catch((e) => ({ error: e?.status ? 'missing' : 'network' })),
    tile.meta ?? api.getVodMeta(id).catch(() => null),
  ])
  if (tile.token !== token) return
  if (meta) tile.meta = meta
  const ok = Boolean(res?.links && !res.error && Object.keys(res.links).length)
  // Statistiques : une fois par tuile, jamais à chaque relance.
  if (!tile.counted) { tile.counted = true; hooks.onVodCount?.(ok) }
  if (!ok) return setState(tile, res?.error === 'network' ? t('err_network') : t('err_vod'), true)
  if (meta) updateVod(tile.entry, meta)
  // Historique : au premier démarrage réussi de la tuile (sa progression
  // part alors dans la sauvegarde, comme celle du lecteur).
  if (!tile.started) { tile.started = true; hooks.onVodStart?.(tile.entry, meta) }
  // Départ : là où la tuile en était (relance), sinon l'instant d'un lien,
  // sinon la reprise — une VOD finie (ou presque) repart du début.
  let at = tile.pos
  if (!(at > 0)) {
    at = pendingAt.get(tile.key) ?? hooks.resume?.(id) ?? 0
    pendingAt.delete(tile.key)
    const length = meta?.lengthSeconds ?? 0
    if (length && at > length - 30) at = 0
    if (at < 10) at = 0
  }
  attachVod(tile, res.links, res.variants ?? {}, at, token)
}

/** Lecture d'une VOD dans sa tuile, à partir de `at`. */
async function attachVod(tile, links, variants, at, token) {
  const url = pickByCount(links, variants)
  const v = tile.video
  tile.ready = false
  v.onplaying = () => {
    if (tile.token !== token) return
    tile.restarts = 0
    tile.ready = true
    setState(tile, null)
  }
  v.onwaiting = () => { if (tile.token === token) setState(tile, 'loading') }
  v.onplay = v.onpause = () => markPaused(tile)
  v.ontimeupdate = () => {
    if (tile.token !== token) return
    if (v.currentTime > 0) tile.pos = v.currentTime
    showTime(tile)
    report(tile)
  }
  v.onended = () => {
    if (tile.token !== token) return
    // Comme une pause voulue : rien ne la relance seule.
    tile.userPaused = true
    report(tile, true)
    setState(tile, 'ended')
    markPaused(tile)
  }

  const Hls = await loadHls()
  if (tile.token !== token) return
  if (Hls?.isSupported()) {
    // Configuration propre aux VODs : aucune option de direct (ni
    // liveSyncDuration ni liveMaxLatencyDuration). Une VOD encore en cours
    // d'enregistrement n'a pas de fin déclarée : hls.js la traite comme un
    // direct, et l'aurait ramenée au bord à chaque relecture de sa playlist.
    const hls = new Hls({
      // Adresses relatives (segment d'initialisation fMP4) corrigées.
      xhrSetup: (xhr, reqUrl) => {
        const fixed = liveRequestUrl(reqUrl, url)
        if (fixed !== reqUrl) xhr.open('GET', fixed, true)
      },
      // La reprise (ou le début), même sans fin déclarée.
      startPosition: at > 1 ? at : 0,
      // 10 s derrière, 30 s d'avance au plus (bufferConfig) : sans plafond,
      // une tuile en 480p chargeait jusqu'à 60 Mo d'avance (plus de 5 min).
      ...bufferConfig('vod', { tile: true }),
    })
    tile.hls = hls
    hls.loadSource(url)
    hls.attachMedia(v)
    hls.on(Hls.Events.MANIFEST_PARSED, () => play(tile))
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal || tile.token !== token) return
      // Comme un direct : une réparation sur place, puis une nouvelle instance.
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaFixAllowed(tile)) return hls.recoverMediaError()
      const from = tile.pos > 0 ? tile.pos : at
      // Relais vidéo du VPS en panne : les mêmes liens par le Worker, au
      // même endroit, sans les redemander (comme switchWorker dans main.js).
      // Pas pour un segment introuvable (404) : même règle que le lecteur
      // (failedProxy), il l'écartait 30 min pour toutes les vidéos.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && api.RELAY_BASE && navigator.onLine !== false
          && failedProxy(data) === api.RELAY_BASE && api.markWorkerDown(api.RELAY_BASE)) {
        console.info('[TwitchUnblock] Relais vidéo injoignable (multi-live), retour au Worker.')
        const next = ++tile.token
        stopMedia(tile)
        setState(tile, 'loading')
        return attachVod(tile, api.withoutRelay(links), variants, from, next)
      }
      if (++tile.restarts > MAX_RESTARTS) return setState(tile, t('err_vod'), true)
      setState(tile, 'loading')
      tile.timer = setTimeout(() => start(tile), 4000)
    })
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.onerror = () => { if (tile.token === token) setState(tile, t('err_vod'), true) }
    v.src = url
    v.addEventListener('loadedmetadata', () => {
      if (tile.token !== token) return
      if (at > 1) { try { v.currentTime = at } catch {} }
      play(tile)
    }, { once: true })
    v.load()
  } else {
    setState(tile, t('err_vod'), true)
  }
}

/** Direct : « Auto » (le lecteur choisit selon la taille de la tuile) ;
 *  sinon comme une VOD. */
function pickLink(links, variants) {
  const auto = Object.keys(links).find((k) => k.toLowerCase() === 'auto')
  return auto ? links[auto] : pickByCount(links, variants)
}

/** Qualité qui tient à plusieurs : 1080p seul, 720p à deux, 480p au-delà,
 *  et pas plus que la qualité préférée si elle est plus basse. Jamais
 *  « Auto » : pour une VOD servie par le secours storyboard, c'est la Source
 *  elle-même (≈ 9 Mbit/s), sans adaptation au débit. À défaut, la plus basse. */
function pickByCount(links, variants = {}) {
  const keys = Object.keys(links)
  let want = list.length <= 1 ? 1080 : list.length === 2 ? 720 : 480
  const pref = String(store.prefs.qualityPref ?? '')
  if (/^\d+$/.test(pref)) want = Math.min(want, Number(pref))
  else if (pref === 'audio') want = 0 // une tuile reste une image : la plus basse
  const video = sortQualities(keys, variants).filter((k) => !/audio|^auto$/i.test(k))
  const h = (k) => heightOf(k, variants, keys)
  const fit = video.find((k) => h(k) > 0 && h(k) <= want)
  return links[fit ?? video[video.length - 1] ?? keys[0]]
}

async function play(tile) {
  const v = tile.video
  const token = tile.token
  v.muted = audible !== tile.key
  // Pause voulue ou VOD finie : une relance (relais, erreur, « Actualiser »)
  // la remet à sa place, en pause. Sans lecture, `playing` ne vient pas : la
  // roue s'efface dès les métadonnées (Safari peut ne rien charger de plus).
  if (tile.userPaused) {
    const shown = () => {
      if (tile.token !== token) return
      if (v.currentTime > 0) tile.ready = true
      setState(tile, null)
      markPaused(tile)
      showTime(tile)
    }
    if (v.readyState >= 1) shown()
    else v.addEventListener('loadedmetadata', shown, { once: true })
    v.addEventListener('canplay', shown, { once: true })
    return markPaused(tile)
  }
  try {
    await v.play()
  } catch (err) {
    if (tile.token !== token) return
    // Lecture interrompue (chargement en cours, source remplacée…) :
    // relancée dès que possible. Ce n'est pas un refus du son : la tuile qui
    // l'avait passait en muet, avec « Clique sur une vidéo… », à tort.
    if (err?.name === 'AbortError') {
      if (!document.hidden) {
        v.addEventListener('canplay', () => { if (!tile.userPaused && tile.token === token) v.play().catch(() => {}) }, { once: true })
      }
      return
    }
    if (v.muted || err?.name !== 'NotAllowedError') return
    // Son refusé tant qu'on n'a pas cliqué dans la page (adresse partagée) :
    // en muet, et un clic sur une tuile le lui donnera.
    v.muted = true
    refreshSound()
    toast(t('multi_sound'))
    try { await v.play() } catch {}
  }
}

function setAudible(key) {
  const changed = audible !== key
  audible = key
  for (const [k, tile] of tiles) {
    const v = tile.video
    v.muted = k !== key
    if (k === key && v.paused && tile.hls && !tile.userPaused && !v.ended) v.play().catch(() => {})
  }
  refreshSound()
  if (changed || !$('#multi').classList.contains('chat-ready')) hooks.onAudible?.(find(key) ?? null)
}

function refreshSound() {
  for (const [k, tile] of tiles) {
    const on = k === audible && !tile.video.muted
    tile.el.classList.toggle('audible', k === audible)
    $('.mt-sound', tile.el).innerHTML = icon(on ? 'volume' : 'mute', 15)
  }
}

// ── Commandes d'une VOD ──────────────────────────────────────────────────
function togglePlay(key) {
  const tile = tiles.get(key)
  if (!tile?.entry.vod) return
  const v = tile.video
  if (v.ended) return replay(key)
  if (v.paused) {
    tile.userPaused = false
    v.play().catch(() => {})
  } else {
    tile.userPaused = true
    v.pause()
    report(tile, true)
  }
}

/** « Revoir » : du début. */
function replay(key) {
  const tile = tiles.get(key)
  if (!tile) return
  tile.userPaused = false
  setState(tile, null)
  try { tile.video.currentTime = 0 } catch {}
  tile.video.play().catch(() => {})
}

function seekBy(key, delta) {
  const tile = tiles.get(key)
  if (tile) seekTo(key, (tile.video.currentTime || 0) + delta)
}

function seekTo(key, time) {
  const tile = tiles.get(key)
  if (!tile?.entry.vod) return
  const d = durationOf(tile)
  const to = Math.max(0, d > 1 ? Math.min(time, d - 1) : time)
  // Revenir en arrière depuis la fin : l'écran de fin s'efface (la vidéo
  // reste en pause, le bouton la relance).
  if (tile.state === 'ended') setState(tile, null)
  try { tile.video.currentTime = to } catch {}
  showTime(tile)
}

/** Durée de la VOD : celle du média, sinon la fin de ce qui est lisible
 *  (VOD en cours en HLS natif), sinon celle que donne Twitch. */
function durationOf(tile) {
  const v = tile.video
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration
  const s = v.seekable
  if (s?.length) return s.end(s.length - 1)
  return tile.meta?.lengthSeconds || 0
}

/** Temps et barres d'une tuile VOD ; `at` : position montrée pendant un glissé. */
function showTime(tile, at) {
  if (!tile.entry.vod || (tile.dragging && at === undefined)) return
  const cur = at ?? tile.video.currentTime ?? 0
  const d = durationOf(tile)
  const pct = d > 0 ? `${Math.min(100, (cur / d) * 100).toFixed(2)}%` : '0%'
  $('.mt-progress span', tile.el).style.width = pct
  $('.mt-seek span', tile.el).style.width = pct
  $('.mt-time span', tile.el).textContent = formatClock(cur)
  $('.mt-total', tile.el).textContent = d > 0 ? ` / ${formatClock(d)}` : ''
  const seek = $('.mt-seek', tile.el)
  seek.setAttribute('aria-valuemax', String(Math.round(d)))
  seek.setAttribute('aria-valuenow', String(Math.round(cur)))
  seek.setAttribute('aria-valuetext', formatClock(cur))
}

function markPaused(tile) {
  const v = tile.video
  const paused = v.paused && !v.ended
  tile.el.classList.toggle('paused', paused)
  const b = $('[data-mt="play"]', tile.el)
  if (!b) return
  const label = t(v.paused ? 'play' : 'pause')
  b.innerHTML = icon(v.paused ? 'play' : 'pause', 18)
  b.title = label
  b.setAttribute('aria-label', label)
}

/** Position d'une tuile VOD pour main.js (progression, chat rejoué). */
function report(tile, final = false) {
  const t0 = final ? tile.pos || tile.video.currentTime : tile.video.currentTime
  hooks.onVodTime?.(tile.entry, t0 || 0, durationOf(tile), { final, save: Boolean(tile.ready) })
}

/** `null` : l'image est là ; 'loading' : la roue ; 'ended' : fin d'une VOD ;
 *  sinon un message. */
function setState(tile, what, retry = false) {
  const box = $('.mt-state', tile.el)
  tile.state = what
  box.hidden = what === null
  if (what === 'loading') box.innerHTML = '<span class="spinner"></span>'
  else if (what === 'ended') {
    box.innerHTML = `<p>${esc(t('multi_vod_ended'))}</p><button class="btn ghost sm" type="button" data-mt="replay">${icon('refresh', 15)}<span>${esc(t('multi_replay'))}</span></button>`
  } else if (what) {
    box.innerHTML = `<p>${esc(what)}</p>${retry ? `<button class="btn ghost sm" type="button" data-mt="retry">${icon('refresh', 15)}<span>${esc(t('refresh'))}</span></button>` : ''}`
  }
}

function stopMedia(tile) {
  clearTimeout(tile.timer)
  tile.hls?.destroy()
  tile.hls = null
  const v = tile.video
  v.onplaying = v.onwaiting = v.onplay = v.onpause = v.ontimeupdate = v.onended = v.onerror = null
  v.pause()
  v.removeAttribute('src')
  v.load()
}

function destroyTile(tile) {
  // Dernière position d'une VOD (retrait, fermeture de la mosaïque).
  if (tile.entry.vod && tile.ready) report(tile, true)
  tile.token++
  stopMedia(tile)
  tile.el.remove()
}

// ── Barre de sélection ───────────────────────────────────────────────────
/** Barre du bas (ce qui est choisi) et état des boutons « + » des cartes. */
export function renderBar() {
  const bar = $('#multi-bar')
  if (!bar) return
  bar.hidden = !list.length || isOpen()
  $('#multi-bar-list').innerHTML = list.map((x) => `
    <span class="mb-chip"${x.title ? ` title="${esc(x.title)}"` : ''}>${esc(labelOf(x))}<button type="button" data-mb-remove="${esc(keyOf(x))}" title="${esc(t('multi_remove'))}">${icon('x', 12)}</button></span>`).join('')
  $('#multi-count').textContent = `${list.length}/${MULTI_MAX}`
  for (const b of document.querySelectorAll('[data-multi-add], [data-multi-vod]')) markButton(b)
}

/** Bouton « + » d'une carte (ou de la page d'une chaîne) : ✓ s'il y est. */
export function markButton(b) {
  const on = b.dataset.multiVod ? hasVod(b.dataset.multiVod) : has(b.dataset.multiAdd)
  b.classList.toggle('on', on)
  b.title = t(on ? 'multi_remove' : 'multi_add')
  if (b.classList.contains('madd')) b.innerHTML = icon(on ? 'check' : 'plus', 16)
}
