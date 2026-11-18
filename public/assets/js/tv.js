// ═══════════════════════════════════════════════════════════════════════════
//  Mode TV : le site à la télécommande. Activé sur les TV LG (webOS : agent
//  « Web0S »), par l'app du dossier webos/ (?tv=webos), ou à la main avec
//  ?tv=1 (gardé le temps de la session ; ?tv=0 le coupe).
//  La classe « tv » de <html> et la feuille /assets/tv.css font l'affichage
//  (cibles et textes plus grands, repère de focus) : hors du mode TV, rien
//  ne change.
//  - Flèches : l'élément le plus proche dans la direction pressée.
//  - OK / Entrée : l'active (un champ de texte s'ouvre à l'écriture).
//  - Retour (461 sur webOS), Retour arrière, Échap : ferme ce qui est ouvert
//    (champ en cours d'écriture, feuille, fiche du chat, menu du lecteur,
//    plein écran, mosaïque, lecteur), sinon revient à la page précédente ;
//    sur l'accueil, remonte en haut, puis quitte l'app.
//  - Lecteur en grand, commandes masquées ou focus sur la vidéo : gauche /
//    droite reculent ou avancent de 10 s, OK met en pause ou relance, haut /
//    bas passent dans la barre (lecture, ±10 s, qualité, chat…).
//  - Touches lecture, pause, retour et avance rapides, stop.
//  Tout passe par le DOM du site (boutons cliqués, classes lues) : main.js
//  et player.js n'en savent rien.
// ═══════════════════════════════════════════════════════════════════════════

import { t } from './i18n.js'
import { toast } from './util.js'

const KEY = 'tu_tv'
const $ = (sel, root = document) => root.querySelector(sel)

/** 'webos' (TV LG, ou ?tv=webos), 'tv' (?tv=1 ailleurs) ou null. */
export const tvMode = detect()

/** Entrées d'historique au chargement : une de plus, c'est le site qui l'a
 *  ajoutée (le lecteur ouvert depuis une page, par exemple). */
const startLength = history.length

function detect() {
  let saved = null
  try {
    const url = new URL(location.href)
    const q = url.searchParams.get('tv')
    if (q !== null) {
      saved = q === '0' ? 'off' : q === 'webos' ? 'webos' : 'tv'
      sessionStorage.setItem(KEY, saved)
      // L'adresse garde le chemin seul : liens partagés, précédent / suivant.
      url.searchParams.delete('tv')
      history.replaceState(history.state, '', url.pathname + url.search + url.hash)
    } else saved = sessionStorage.getItem(KEY)
  } catch {}
  if (saved === 'off') return null
  if (saved === 'webos' || /web0s|webos/i.test(navigator.userAgent)) return 'webos'
  return saved === 'tv' ? 'tv' : null
}

if (tvMode) {
  document.documentElement.classList.add('tv')
  const css = document.createElement('link')
  css.rel = 'stylesheet'
  css.href = '/assets/tv.css'
  document.head.append(css)
  polyfill()
}

/** Moteurs des TV LG (Chromium 87 sur webOS 22, 94 sur webOS 23) : ce dont
 *  le site se sert et qu'ils n'ont pas encore. Rien n'est remplacé ailleurs. */
function polyfill() {
  const add = (obj, name, value) => {
    if (!(name in obj)) Object.defineProperty(obj, name, { value, writable: true, configurable: true })
  }
  add(Object, 'hasOwn', (o, k) => Object.prototype.hasOwnProperty.call(o, k))
  const at = function (i) {
    let n = Math.trunc(i) || 0
    if (n < 0) n += this.length
    return n < 0 || n >= this.length ? undefined : this[n]
  }
  add(Array.prototype, 'at', at)
  add(String.prototype, 'at', at)
  add(Array.prototype, 'findLast', function (fn, that) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(that, this[i], i, this)) return this[i]
    return undefined
  })
  // Réglages seulement (données JSON) : une copie par JSON suffit.
  add(window, 'structuredClone', (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))))
}

/** Appelé une fois par main.js, au démarrage. */
export function initTv() {
  if (!tvMode || initTv.done) return
  initTv.done = true
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('focusin', remember)
  document.addEventListener('focusout', (e) => unlock(e.target))
  // Pointeur de la Magic Remote sur un champ verrouillé : on y écrit.
  document.addEventListener('pointerdown', (e) => unlock(e.target.closest?.('[data-tv-lock]')), true)
  window.addEventListener('popstate', () => setTimeout(restorePage, 80))
  setInterval(() => { heal(); keepControls() }, 500)
  if (tvMode === 'webos') guardExternal()
}

/** Dernière touche : la barre du lecteur reste affichée tant qu'on s'y
 *  promène (8 s sans touche, elle se masque comme d'habitude). */
let lastKeyAt = 0
function keepControls() {
  if (Date.now() - lastKeyAt > 8000 || !watchBig()) return
  const p = $('#player')
  if (p && $('.p-ui', p)?.contains(document.activeElement)) showControls(p)
}

// ── Touches ────────────────────────────────────────────────────────────────
const CODES = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 461: 'back', 27: 'back', 8: 'backspace',
  415: 'play', 19: 'pause', 179: 'playpause', 412: 'rewind', 417: 'forward', 413: 'stop',
}
const KEYS = {
  ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', Enter: 'ok',
  Escape: 'back', GoBack: 'back', BrowserBack: 'back', Backspace: 'backspace',
  MediaPlay: 'play', MediaPause: 'pause', MediaPlayPause: 'playpause',
  MediaRewind: 'rewind', MediaFastForward: 'forward', MediaStop: 'stop',
}
const MEDIA = new Set(['play', 'pause', 'playpause', 'rewind', 'forward', 'stop'])

function onKey(e) {
  if (!e.isTrusted || e.ctrlKey || e.metaKey || e.altKey) return
  lastKeyAt = Date.now()
  const k = CODES[e.keyCode] ?? KEYS[e.key]
  if (!k || !handle(e, k)) return
  e.preventDefault()
  e.stopImmediatePropagation()
}

/** true : touche prise ici (le site ne la voit pas). */
function handle(e, k) {
  if (MEDIA.has(k)) return media(k)
  heal()
  const a = document.activeElement
  if (k === 'backspace') {
    if (editing(a)) return false
    k = 'back'
  }
  if (k === 'back') return e.repeat || back()
  if (k === 'ok') return e.repeat || ok(a)
  if (editing(a) && !leavesField(a, k)) return false
  // Visite guidée : gauche / droite passent d'une étape à l'autre (main.js).
  if ($('#tour') && (k === 'left' || k === 'right')) return false
  if (a?.tagName === 'SELECT' && (k === 'left' || k === 'right')) {
    stepSelect(a, k === 'left' ? -1 : 1, false)
    return true
  }
  // Réglette (volume…) : gauche / droite changent sa valeur.
  if (a?.type === 'range' && (k === 'left' || k === 'right')) return false
  if (playerKey(k)) return true
  move(k)
  return true
}

// ── Champs de texte ────────────────────────────────────────────────────────
// Atteint aux flèches, un champ est en lecture seule (le clavier de la TV ne
// s'ouvre pas à chaque passage) ; OK l'ouvre à l'écriture, Retour en sort.
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week'])

function isText(el) {
  if (!el || el.disabled) return false
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
  return el.tagName === 'INPUT' && TEXT_TYPES.has(el.type)
}
const editing = (el) => isText(el) && !el.readOnly

function lock(el) {
  if (!isText(el) || el.readOnly || el.isContentEditable) return
  el.readOnly = true
  el.dataset.tvLock = '1'
}

function unlock(el) {
  if (!el?.dataset?.tvLock) return
  el.readOnly = false
  delete el.dataset.tvLock
}

/** Suggestions ouvertes sous le champ (recherche, chat) : haut / bas et
 *  Échap sont pour elles. */
const suggestBox = (el) => el.closest('form')?.querySelector('.suggest:not([hidden])')
  || el.closest('.chat')?.querySelector('.chat-suggest:not([hidden])')

/** Une flèche dans un champ en cours d'écriture : le curseur bouge, sauf au
 *  bord du texte (ou haut / bas sur une seule ligne), où l'on en sort. */
function leavesField(el, k) {
  if ((k === 'up' || k === 'down') && suggestBox(el)) return false
  if (el.tagName === 'TEXTAREA' || k === 'left' || k === 'right') {
    let start = null
    let len = 0
    try { start = el.selectionStart; len = el.value.length } catch {}
    if (typeof start !== 'number') return true
    if (k === 'left' || k === 'up') return start === 0 && el.selectionEnd === 0
    return start === len && el.selectionEnd === len
  }
  return true
}

function stepSelect(sel, step, wrap) {
  const n = sel.options.length
  let i = sel.selectedIndex
  for (let tries = 0; tries < n; tries++) {
    i += step
    if (i < 0 || i >= n) {
      if (!wrap) return
      i = (i + n) % n
    }
    if (!sel.options[i].disabled) break
  }
  if (i === sel.selectedIndex || i < 0 || i >= n) return
  sel.selectedIndex = i
  sel.dispatchEvent(new Event('input', { bubbles: true }))
  sel.dispatchEvent(new Event('change', { bubbles: true }))
}

// ── Où l'on peut aller ─────────────────────────────────────────────────────
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"], [contenteditable=""]'

function visible(el) {
  if (!el?.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const cs = getComputedStyle(el)
  // pointer-events: none : commandes du lecteur masquées, avis cachés…
  return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && cs.opacity !== '0'
}

const candidates = (scope) => [...scope.querySelectorAll(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.disabled)

const watchEl = () => $('#watch')
const fullscreenEl = () => document.fullscreenElement || document.webkitFullscreenElement || null

/** Lecteur affiché en grand (ni caché, ni réduit, ni en train de se fermer). */
function watchBig(watch = watchEl()) {
  return Boolean(watch && !watch.hidden && watch.classList.contains('open') && !watch.classList.contains('minimized'))
}

function sheetOpen() {
  const sheet = $('#sheet')
  return sheet && !sheet.hidden && sheet.classList.contains('open') ? sheet : null
}

/** Plein écran, mosaïque ou lecteur en grand : ce qui couvre la page. */
function overlay() {
  const multi = $('#multi')
  return fullscreenEl() || (multi && !multi.hidden ? multi : null) || (watchBig() ? watchEl() : null)
}

/** Là où les flèches se promènent : ce qui est ouvert par-dessus, sinon la page. */
function scopeRoot() {
  const sheet = sheetOpen()
  if (sheet) return sheet
  const tour = $('#tour')
  if (tour) return $('.tour-pop', tour) || tour
  const box = overlay()
  if (box) return $('.p-menu:not([hidden])', box) || box
  return document.body
}

// Dernier élément choisi de chaque calque (page, lecteur, feuille, menu) et
// de chaque page : Retour y ramène.
const memory = new WeakMap()
const pages = new Map()
// Le site refait certaines listes (le top se relit chaque minute) : la carte
// choisie est remplacée par une copie et le focus partait. Chaque élément
// choisi garde de quoi retrouver sa copie.
const signatures = new WeakMap()
let last = null
const SIGN_KEYS = ['live', 'vod', 'clip', 'channel', 'cat', 'category', 'pick', 'action', 'tab', 'home', 'ctab', 'q', 's', 'src', 'lang']

function signature(el) {
  try {
    if (el.id) return `#${CSS.escape(el.id)}`
    const box = el.parentElement?.closest('[id]')
    const pre = box && box !== document.body ? `#${CSS.escape(box.id)} ` : ''
    const tag = el.tagName.toLowerCase()
    for (const k of SIGN_KEYS) if (el.dataset[k] != null) return `${pre}${tag}[data-${k}="${CSS.escape(el.dataset[k])}"]`
    if (tag === 'a' && el.getAttribute('href')) return `${pre}a[href="${CSS.escape(el.getAttribute('href'))}"]`
  } catch {}
  return null
}

/** L'élément, ou sa copie quand le site a refait la liste. */
function alive(el, scope = document) {
  if (!el || el.isConnected) return el
  const sig = signatures.get(el)
  try { return sig ? scope.querySelector(sig) : null } catch { return null }
}

function remember(e) {
  const scope = scopeRoot()
  const el = e.target
  if (!scope.contains(el)) return
  signatures.set(el, signature(el))
  last = el
  memory.set(scope, el)
  if (scope !== document.body) return
  pages.delete(location.pathname)
  pages.set(location.pathname, el)
  if (pages.size > 40) pages.delete(pages.keys().next().value)
}

/** Focus parti avec un élément remplacé : sur sa copie. */
function heal() {
  const a = document.activeElement
  if ((a && a !== document.body) || !last || last.isConnected) return
  const twin = alive(last, scopeRoot())
  if (twin && visible(twin)) focusEl(twin, { reveal: false })
}

/** Premier élément d'un calque : le dernier choisi, sinon le plus logique. */
function initialIn(scope) {
  const kept = alive(memory.get(scope), scope)
  if (kept && scope.contains(kept) && visible(kept)) return kept
  const first = (root, skip) => candidates(root).find((el) => (!skip || !el.closest(skip)) && visible(el))
  const watch = watchEl()
  if (scope === watch || (scope === fullscreenEl() && scope.contains($('#player')))) {
    if (watch.classList.contains('error')) return first($('.watch-error', watch)) || $('#player')
    if (watch.classList.contains('ended')) return first($('.watch-ended', watch)) || $('#player')
    return $('#player')
  }
  if (scope.classList.contains('p-menu')) return $('button.on', scope) || first(scope)
  if (scope.id === 'sheet') return first(scope, '.sheet-head') || first(scope)
  if (scope === document.body) {
    const tab = $('.nav button.active')
    if (tab && visible(tab)) return tab
    return candidates(scope).find((el) => visible(el) && el.getBoundingClientRect().top >= 0) || first(scope)
  }
  return first(scope)
}

function focusEl(el, { reveal = true } = {}) {
  if (!el) return false
  lock(el)
  try { el.focus({ preventScroll: true }) } catch { el.focus() }
  if (document.activeElement !== el) {
    unlock(el)
    return false
  }
  if (reveal) revealEl(el)
  return true
}

/** L'élément dans l'écran ; sur la page, loin des bords (la barre du haut
 *  le cacherait), centré quand il faut faire défiler. */
function revealEl(el) {
  try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch {}
  if (scopeRoot() !== document.body || el.closest('.topbar, .watch, .multi-bar')) return
  const r = el.getBoundingClientRect()
  const top = ($('.topbar')?.getBoundingClientRect().bottom ?? 0) + 24
  const bottom = innerHeight - 24
  if (r.top >= top && r.bottom <= bottom) return
  const room = bottom - top
  window.scrollBy(0, r.height > room ? r.top - top : r.top + r.height / 2 - (top + room / 2))
}

/** Focus perdu ou hors du calque ouvert : on le remet au bon endroit. */
function restore() {
  const scope = scopeRoot()
  const a = document.activeElement
  if (a && a !== document.body && scope.contains(a) && visible(a)) return
  focusEl(initialIn(scope))
}
const later = (ms = 260) => setTimeout(restore, ms)

/** Précédent / suivant : l'élément d'où l'on était parti sur cette page. */
function restorePage() {
  if (scopeRoot() !== document.body) return
  const el = alive(pages.get(location.pathname))
  if (el && visible(el)) focusEl(el)
  else restore()
}

// ── Déplacement ────────────────────────────────────────────────────────────
// Le plus proche dans la direction : écart sur l'axe, plus l'écart sur
// l'autre axe (fort à l'horizontale, pour rester sur la même ligne), plus un
// peu de décalage des centres (le bouton en face plutôt que celui du coin),
// moins un peu de recouvrement ; à égalité, l'ordre de lecture.
const TOL = 4

function nearest(from, list, dir) {
  const c = from.getBoundingClientRect()
  const horizontal = dir === 'left' || dir === 'right'
  const center = horizontal ? (c.top + c.bottom) / 2 : (c.left + c.right) / 2
  let best = null
  let bestScore = Infinity
  for (const el of list) {
    if (el === from || el.contains(from) || from.contains(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const gap = dir === 'down' ? r.top - c.bottom
      : dir === 'up' ? c.top - r.bottom
        : dir === 'right' ? r.left - c.right
          : c.left - r.right
    if (gap < -TOL) continue
    const lo = horizontal ? Math.max(c.top, r.top) : Math.max(c.left, r.left)
    const hi = horizontal ? Math.min(c.bottom, r.bottom) : Math.min(c.right, r.right)
    const cross = Math.max(0, lo - hi)
    const overlap = Math.max(0, hi - lo)
    const offset = Math.abs((horizontal ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2) - center)
    const score = Math.max(0, gap) + cross * (horizontal ? 30 : 2) + offset * 0.25 - Math.min(overlap, 40) * 0.5
      + (horizontal ? r.top : r.left) * 0.001
    if (score < bestScore && visible(el)) {
      best = el
      bestScore = score
    }
  }
  return best
}

function move(dir) {
  const scope = scopeRoot()
  const a = document.activeElement
  // Rien de choisi dans ce calque : le premier élément, sans bouger encore.
  if (!a || a === document.body || !scope.contains(a) || !visible(a)) return focusEl(initialIn(scope))
  const next = nearest(a, candidates(scope), dir)
  if (next) return focusEl(next)
  // Plus rien dans cette direction : le texte qui reste se lit en défilant.
  if (dir === 'up' || dir === 'down') {
    const box = scope === document.body ? window : scope
    box.scrollBy?.(0, (dir === 'down' ? 1 : -1) * Math.round(innerHeight / 3))
  }
  return false
}

// ── Lecteur ────────────────────────────────────────────────────────────────
/** Commandes affichées comme au passage de la souris (player.js). */
function showControls(p) {
  if (!p) return
  try { p.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })) } catch {}
}

/** Flèches et OK sur la vidéo (commandes masquées, ou focus sur la vidéo). */
function playerKey(k) {
  const watch = watchEl()
  if (!watchBig(watch) || watch.classList.contains('error') || watch.classList.contains('ended')) return false
  const p = $('#player')
  const scope = scopeRoot()
  if (!p || !scope.contains(p)) return false   // menu du lecteur ouvert
  const a = document.activeElement
  const bar = $('.p-ui', p)
  const hidden = !p.classList.contains('ui') && !p.classList.contains('paused')
  const onVideo = a === p || a === document.body || !scope.contains(a) || (hidden && bar?.contains(a))
  if (!onVideo) {
    // Dans la barre : elle reste affichée tant qu'on s'y promène.
    if (p.contains(a)) showControls(p)
    return false
  }
  if (k === 'left' || k === 'right') {
    $(k === 'left' ? '.p-back' : '.p-fwd', p)?.click()
    focusEl(p, { reveal: false })
    return true
  }
  if (k === 'up' || k === 'down') {
    showControls(p)
    focusEl(bar?.contains(a) ? a : $('.p-play', p), { reveal: false })
    return true
  }
  if (k === 'ok') {
    $('.p-play', p)?.click()
    focusEl(p, { reveal: false })
    return true
  }
  return false
}

function media(k) {
  const watch = watchEl()
  const p = $('#player')
  const video = p && $('video', p)
  if (!watch || watch.hidden || !video) return false
  const big = watchBig(watch)
  const toggle = () => {
    // Réduit, un clic dans le lecteur le rouvrirait (main.js) : la vidéo directement.
    if (big) $('.p-play', p)?.click()
    else if (video.paused) video.play()?.catch?.(() => {})
    else video.pause()
  }
  if (k === 'play') { if (video.paused) toggle() }
  else if (k === 'pause') { if (!video.paused) toggle() }
  else if (k === 'playpause') toggle()
  else if (k === 'stop') {
    if (big) closePlayer(watch)
    else $('.watch-mini [data-action="watch-close"]', watch)?.click()
  } else if (big) $(k === 'rewind' ? '.p-back' : '.p-fwd', p)?.click()
  return true
}

/** Fermeture du lecteur. Ouvert depuis une page de cette visite, son entrée
 *  d'historique part avec lui (le site le réduit alors, puis on le ferme) :
 *  Retour sur la page ne repasse pas par la même page. Sinon, la croix. */
function closePlayer(watch) {
  memory.delete(watch)
  const close = () => {
    if (!watch.hidden) $('[data-action="watch-close"]', watch)?.click()
    later(300)
  }
  if (!history.state?.watch || history.length <= startLength) return close()
  let done = false
  let moved = false
  const finish = () => {
    if (done) return
    done = true
    window.removeEventListener('popstate', onPop)
    // Arrivé sur l'entrée d'un autre lecteur : le site le rouvre, on le laisse.
    setTimeout(() => { if (!moved || !history.state?.watch) close(); else later(300) }, 0)
  }
  const onPop = () => { moved = true; finish() }
  window.addEventListener('popstate', onPop)
  setTimeout(finish, 700)
  history.back()
}

// ── OK ─────────────────────────────────────────────────────────────────────
const NATIVE_ENTER = new Set(['button', 'submit', 'reset', 'image', 'file', 'color'])

/** Ce qu'Entrée active déjà de lui-même (un clic). */
function nativeEnter(el) {
  if (el.tagName === 'A') return el.hasAttribute('href')
  if (el.tagName === 'BUTTON' || el.tagName === 'SUMMARY') return true
  return el.tagName === 'INPUT' && NATIVE_ENTER.has(el.type)
}

function ok(a) {
  if (playerKey('ok')) return true
  if (!a || a === document.body || !scopeRoot().contains(a)) return focusEl(initialIn(scopeRoot())) || true
  if (a.dataset.tvLock) {
    // Champ verrouillé : on y écrit (le clavier de la TV s'ouvre).
    unlock(a)
    a.blur()
    a.focus()
    return true
  }
  if (editing(a)) return false   // Entrée envoie le formulaire, comme d'habitude
  const before = scopeRoot()
  let handled = true
  if (a.tagName === 'SELECT') stepSelect(a, 1, true)
  else if (a.tagName === 'INPUT' && (a.type === 'checkbox' || a.type === 'radio')) a.click()
  else if (nativeEnter(a)) handled = false
  else a.click()
  // Ce qui s'est ouvert (feuille, menu, lecteur) prend le focus.
  setTimeout(() => settle(before), 80)
  return handled
}

function settle(before) {
  const scope = scopeRoot()
  const a = document.activeElement
  if (a && a !== document.body && scope.contains(a) && visible(a)) return
  // Lecteur qui vient de s'ouvrir : sur la vidéo, commandes affichées.
  if (scope !== before && scope === watchEl()) memory.delete(scope)
  const el = initialIn(scope)
  if (el?.id === 'player') showControls(el)
  focusEl(el)
}

// ── Retour ─────────────────────────────────────────────────────────────────
/** Échap simulé, pour ce que le site ferme déjà sur Échap. Envoyé à un
 *  élément : le lecteur lit e.target.closest(), absent du document. */
function escape(target = document.activeElement || document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
}

function back() {
  const a = document.activeElement
  const watch = watchEl()
  // Champ en cours d'écriture : on en sort, le focus y reste.
  if (editing(a)) {
    if (suggestBox(a)) escape(a)
    else lock(a)
    return true
  }
  // Feuille (réglages, signalement…) : sa flèche retour, sinon fermée.
  const sheet = sheetOpen()
  if (sheet) {
    const prev = [...sheet.querySelectorAll('[data-set-back], [data-fb-back], [data-push-back]')].find(visible)
    if (prev) { prev.click(); later(80) } else { $('#sheet-backdrop')?.click(); later() }
    return true
  }
  if ($('#tour')) { escape(); later(); return true }
  const box = overlay()
  // Fiches du chat (emote, utilisateur, sélecteur, récompenses) : main.js
  // et le chat les ferment sur Échap.
  if (box && $('.chat-info:not([hidden]), .cx-rewards:not([hidden]), .user-card:not([hidden]), .emote-picker:not([hidden])', box)) {
    escape()
    later()
    return true
  }
  const menu = box && $('.p-menu:not([hidden])', box)
  if (menu) {
    const opener = $(menu.dataset.kind === 'chapters' ? '.p-chapters' : '.p-quality', menu.parentElement || box)
    escape()
    if (!menu.hidden) opener?.click()
    showControls(menu.closest('.player'))
    if (opener) focusEl(opener, { reveal: false })
    return true
  }
  if (fullscreenEl()) {
    try {
      const done = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.()
      done?.catch?.(() => {})
    } catch {}
    later()
    return true
  }
  const multi = $('#multi')
  if (multi && !multi.hidden) {
    $('[data-action="multi-close"]', multi)?.click()
    later()
    return true
  }
  if (watchBig(watch)) {
    const p = $('#player')
    // Commandes affichées pendant la lecture : d'abord masquées.
    if (p && p.classList.contains('ui') && !p.classList.contains('paused') && $('.p-ui', p)?.contains(a)) {
      p.classList.remove('ui')
      focusEl(p, { reveal: false })
      return true
    }
    closePlayer(watch)
    return true
  }
  // Accueil : le mini-lecteur se ferme, puis retour en haut, puis on quitte.
  if (location.pathname === '/' && !$('#view-discover')?.hidden) {
    if (watch && !watch.hidden && watch.classList.contains('minimized')) {
      $('.watch-mini [data-action="watch-close"]', watch)?.click()
      later()
      return true
    }
    const tab = $('.nav button.active')
    if (window.scrollY > 0 || (tab && a !== tab && visible(tab))) {
      window.scrollTo(0, 0)
      focusEl(tab, { reveal: false })
      return true
    }
    if (tvMode === 'webos') exitApp()
    return true
  }
  historyBack()
  return true
}

/** Page précédente ; s'il n'y en a pas (première page de la visite), l'accueil. */
function historyBack() {
  const from = location.href
  let moved = false
  const onPop = () => { moved = true }
  window.addEventListener('popstate', onPop, { once: true })
  history.back()
  setTimeout(() => {
    window.removeEventListener('popstate', onPop)
    if (moved || location.href !== from) return
    $('.nav [data-tab="discover"]')?.click()
    later()
  }, 450)
}

/** Quitter l'app : comme Retour sur la première page d'une app webOS
 *  (question « Quitter ? » sur webOS 6 et plus, accueil avant). */
function exitApp() {
  const sys = window.webOSSystem || window.PalmSystem
  try {
    if (sys && typeof sys.platformBack === 'function') {
      sys.platformBack()
      return
    }
  } catch {}
  try { window.close() } catch {}
}

// ── App webOS : rester sur le site ─────────────────────────────────────────
// Un autre site ouvert dans l'app n'a pas ce module : Retour n'y ferait
// rien. Ses liens sont refusés, avec un mot ; les fenêtres en plus (que
// l'app n'affiche pas) aussi : la connexion Twitch passe alors par une
// redirection dans la page, déjà prévue par le site.
function guardExternal() {
  window.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[href]')
    if (!link) return
    let url
    try { url = new URL(link.href, location.href) } catch { return }
    if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    toast(t('tv_link_blocked'), 'info', 4000)
  }, true)
  window.open = () => null
}
