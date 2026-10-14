// ═══════════════════════════════════════════════════════════════════════════
//  Multi-live : jusqu'à quatre directs côte à côte. Chaque tuile a son petit
//  lecteur (hls.js, qualité adaptée à la taille de la tuile) ; le son ne vient
//  que d'une tuile à la fois — un clic dessus le lui donne.
//  La sélection est gardée sur l'appareil ; « /?multi=a,b » la partage.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from './api.js'
import { t } from './i18n.js'
import { liveRequestUrl, loadHls, sortQualities } from './player.js'
import { $, esc, icon, toast } from './util.js'

export const MULTI_MAX = 4
const KEY = 'tu_multi'
/** Relances d'une tuile sans image avant de la dire hors ligne. */
const MAX_RESTARTS = 3

let list = load()          // [{ login, name }]
const tiles = new Map()    // login → { el, video, hls, timer, token, restarts }
let audible = null         // tuile qui a le son
let hooks = {}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => api.cleanLogin(x?.login)).slice(0, MULTI_MAX) : []
  } catch { return [] }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }

export const has = (login) => list.some((x) => x.login === login)
export const audibleLogin = () => (has(audible) ? audible : list[0]?.login ?? null)
export const isOpen = () => !$('#multi').hidden
const sharePath = () => `/?multi=${list.map((x) => x.login).join(',')}`

/**
 * @param {object} o
 * @param {() => void} o.onOpen          avant l'ouverture (le lecteur se ferme)
 * @param {(login: string) => void} o.onWatch  ouvrir un direct dans le lecteur (avec le chat)
 * @param {(path: string|null, replace?: boolean) => void} o.onUrl  adresse de la mosaïque (null : fermée)
 * @param {(login: string|null) => void} o.onAudible  direct qui a le son (son chat), null à la fermeture
 */
export function init(o) {
  hooks = o
  $('#multi-bar').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-mb-remove]')
    if (rm) remove(rm.dataset.mbRemove)
  })
  // Ajouter une chaîne depuis la mosaïque, par son nom.
  $('#multi-add-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const input = $('#multi-add-input')
    const login = api.cleanLogin(input.value)
    if (!login) return toast(t('not_found'), 'error')
    input.value = ''
    input.blur()
    add(login)
  })
  const grid = $('#multi-grid')
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.mtile')
    if (!tile) return
    const login = tile.dataset.login
    const b = e.target.closest('[data-mt]')?.dataset.mt
    if (b === 'remove') return remove(login)
    if (b === 'retry') return restart(login)
    if (b === 'watch') {
      const name = list.find((x) => x.login === login)?.name
      close({ url: false })
      return hooks.onWatch?.(login, name)
    }
    setAudible(login)
  })
  // Double-clic : la tuile en plein écran (et retour).
  grid.addEventListener('dblclick', (e) => {
    const tile = e.target.closest('.mtile')
    if (!tile || e.target.closest('[data-mt]')) return
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else tile.requestFullscreen?.().catch(() => {})
  })
  // Retour sur l'onglet : le navigateur a pu mettre en pause les tuiles
  // muettes (économie d'énergie en arrière-plan) ; elles repartent.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !isOpen()) return
    for (const tile of tiles.values()) {
      if (tile.video.paused && tile.video.readyState > 0) tile.video.play().catch(() => {})
    }
  })
  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target.closest?.('input, textarea, [contenteditable]')) return
    if (e.key === 'Escape' && !document.fullscreenElement) return close()
    const n = Number(e.key)
    if (n >= 1 && n <= list.length) return setAudible(list[n - 1].login)
    if (e.key === 'm' || e.key === 'M') {
      const tile = tiles.get(audible)
      if (tile) tile.video.muted = !tile.video.muted
      return refreshSound()
    }
  })
  renderBar()
}

// ── Sélection ────────────────────────────────────────────────────────────
/** Ajoute (ou retire, s'il y est déjà) un direct. */
export function toggle(rawLogin, name) {
  const login = api.cleanLogin(rawLogin)
  if (!login) return
  if (has(login)) {
    remove(login)
    return toast(t('multi_removed'))
  }
  if (list.length >= MULTI_MAX) return toast(t('multi_full', { max: MULTI_MAX }), 'error')
  list.push({ login, name: name || login })
  save()
  renderBar()
  if (isOpen()) { sync(); hooks.onUrl?.(sharePath(), true) }
  toast(t('multi_added', { n: list.length, max: MULTI_MAX }), 'success')
}

/** Ajoute sans retirer (bouton du lecteur). */
export function add(login, name) {
  if (has(api.cleanLogin(login))) return toast(t('multi_already'))
  toggle(login, name)
}

export function remove(login) {
  list = list.filter((x) => x.login !== login)
  save()
  renderBar()
  if (!isOpen()) return
  if (!list.length) return close()
  sync()
  hooks.onUrl?.(sharePath(), true)
}

export function clear() {
  list = []
  save()
  close()
  renderBar()
}

/** Adresse partagée (« /?multi=a,b ») : cette sélection-là, ouverte. */
export function openWith(logins) {
  const clean = [...new Set(logins.map(api.cleanLogin).filter(Boolean))].slice(0, MULTI_MAX)
  if (!clean.length) return
  list = clean.map((login) => list.find((x) => x.login === login) ?? { login, name: login })
  save()
  open({ url: false })
}

// ── Mosaïque ─────────────────────────────────────────────────────────────
export function open({ url = true } = {}) {
  if (!list.length) return
  hooks.onOpen?.()
  $('#multi').hidden = false
  document.documentElement.classList.add('multi-open')
  if (!has(audible)) audible = list[0].login
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
  renderBar()
  if (url) hooks.onUrl?.(null)
}

/** Les tuiles suivent la liste : ajoutées, retirées, remises dans l'ordre. */
function sync() {
  const grid = $('#multi-grid')
  for (const [login, tile] of tiles) {
    if (!has(login)) { destroyTile(tile); tiles.delete(login) }
  }
  for (const entry of list) {
    const tile = tiles.get(entry.login)
    if (tile) grid.appendChild(tile.el)
    else mountTile(entry)
  }
  grid.className = `multi-grid n${list.length}`
  $('#multi-add-form').hidden = list.length >= MULTI_MAX
  setAudible(has(audible) ? audible : list[0]?.login ?? null)
}

function mountTile(entry) {
  const el = document.createElement('div')
  el.className = 'mtile'
  el.dataset.login = entry.login
  el.innerHTML = `
    <video playsinline webkit-playsinline muted></video>
    <div class="mt-state"><span class="spinner"></span></div>
    <div class="mt-top">
      <span class="mt-sound"></span>
      <span class="mt-name">${esc(entry.name || entry.login)}</span>
      <span class="mt-gap"></span>
      <span class="mt-btns">
        <button class="icon-btn xs" type="button" data-mt="watch" title="${esc(t('multi_open'))}">${icon('maximize', 14)}</button>
        <button class="icon-btn xs" type="button" data-mt="remove" title="${esc(t('multi_remove'))}">${icon('x', 15)}</button>
      </span>
    </div>`
  const tile = { el, video: $('video', el), hls: null, timer: null, token: 0, restarts: 0 }
  tiles.set(entry.login, tile)
  $('#multi-grid').appendChild(el)
  start(entry.login, tile)
}

function restart(login) {
  const tile = tiles.get(login)
  if (!tile) return
  tile.restarts = 0
  start(login, tile)
}

async function start(login, tile) {
  const token = ++tile.token
  stopMedia(tile)
  setState(tile, 'loading')
  const res = await api.getLive(login).catch((e) => ({ error: e?.status ? 'missing' : 'network' }))
  if (tile.token !== token) return
  const links = res?.links
  if (!links || res.error || !Object.keys(links).length) {
    return setState(tile, res?.error === 'network' ? t('err_network') : t('multi_offline'), true)
  }
  const url = pickLink(links)
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
      maxBufferLength: 12,
      backBufferLength: 10,
    })
    tile.hls = hls
    hls.loadSource(url)
    hls.attachMedia(v)
    hls.on(Hls.Events.MANIFEST_PARSED, () => play(login, tile))
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal || tile.token !== token) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError()
      // Coupure ou fin du live : on redemande les liens, quelques fois.
      if (++tile.restarts > MAX_RESTARTS) return setState(tile, t('multi_offline'), true)
      setState(tile, 'loading')
      tile.timer = setTimeout(() => start(login, tile), 4000)
    })
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = url
    v.addEventListener('loadedmetadata', () => play(login, tile), { once: true })
    v.load()
  } else {
    setState(tile, t('err_live'), true)
  }
}

/** « Auto » (le lecteur choisit selon la taille) ; sinon une qualité qui
 *  tient à plusieurs : 1080p seul, 720p à deux, 480p au-delà. */
function pickLink(links) {
  const keys = Object.keys(links)
  const auto = keys.find((k) => k.toLowerCase() === 'auto')
  if (auto) return links[auto]
  const want = list.length <= 1 ? 1080 : list.length === 2 ? 720 : 480
  const video = sortQualities(keys).filter((k) => !/audio/i.test(k))
  const height = (k) => Number(/(\d+)p/.exec(k)?.[1] || (/source|chunked/i.test(k) ? 1080 : 0))
  const fit = video.find((k) => height(k) && height(k) <= want)
  return links[fit ?? video[video.length - 1] ?? keys[0]]
}

async function play(login, tile) {
  const v = tile.video
  v.muted = audible !== login
  try {
    await v.play()
  } catch (err) {
    if (v.muted) {
      // Lecture interrompue (chargement en cours…) : relancée dès que possible.
      if (err?.name === 'AbortError' && !document.hidden) {
        v.addEventListener('canplay', () => v.play().catch(() => {}), { once: true })
      }
      return
    }
    // Son refusé tant qu'on n'a pas cliqué dans la page (adresse partagée) :
    // en muet, et un clic sur une tuile le lui donnera.
    v.muted = true
    refreshSound()
    toast(t('multi_sound'))
    try { await v.play() } catch {}
  }
}

function setAudible(login) {
  const changed = audible !== login
  audible = login
  for (const [l, tile] of tiles) {
    tile.video.muted = l !== login
    if (l === login && tile.video.paused && tile.hls) tile.video.play().catch(() => {})
  }
  refreshSound()
  if (changed || !$('#multi').classList.contains('chat-ready')) hooks.onAudible?.(login)
}

function refreshSound() {
  for (const [l, tile] of tiles) {
    const on = l === audible && !tile.video.muted
    tile.el.classList.toggle('audible', l === audible)
    $('.mt-sound', tile.el).innerHTML = icon(on ? 'volume' : 'mute', 15)
  }
}

/** `null` : l'image est là ; 'loading' : la roue ; sinon un message. */
function setState(tile, what, retry = false) {
  const box = $('.mt-state', tile.el)
  box.hidden = what === null
  if (what === 'loading') box.innerHTML = '<span class="spinner"></span>'
  else if (what) {
    box.innerHTML = `<p>${esc(what)}</p>${retry ? `<button class="btn ghost sm" type="button" data-mt="retry">${icon('refresh', 15)}<span>${esc(t('refresh'))}</span></button>` : ''}`
  }
}

function stopMedia(tile) {
  clearTimeout(tile.timer)
  tile.hls?.destroy()
  tile.hls = null
  const v = tile.video
  v.onplaying = v.onwaiting = null
  v.pause()
  v.removeAttribute('src')
  v.load()
}

function destroyTile(tile) {
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
    <span class="mb-chip">${esc(x.name || x.login)}<button type="button" data-mb-remove="${esc(x.login)}" title="${esc(t('multi_remove'))}">${icon('x', 12)}</button></span>`).join('')
  $('#multi-count').textContent = `${list.length}/${MULTI_MAX}`
  for (const b of document.querySelectorAll('[data-multi-add]')) markButton(b)
}

/** Bouton « + » d'une carte (ou de la page d'une chaîne) : ✓ s'il y est. */
export function markButton(b) {
  const on = has(b.dataset.multiAdd)
  b.classList.toggle('on', on)
  b.title = t(on ? 'multi_remove' : 'multi_add')
  if (b.classList.contains('madd')) b.innerHTML = icon(on ? 'check' : 'plus', 16)
}
