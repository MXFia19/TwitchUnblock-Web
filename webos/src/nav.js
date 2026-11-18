// ═══════════════════════════════════════════════════════════════════════════
//  Télécommande : touches, calques et navigation spatiale.
//
//  - Un calque (écran, panneau, clavier) est posé par-dessus les autres ;
//    les flèches ne se promènent que dans le dernier. Chacun garde son
//    dernier élément choisi : Retour y ramène.
//  - Flèches : l'élément le plus proche dans la direction (même calcul que
//    le mode TV du site, public/assets/js/tv.js). Une rangée (data-row)
//    retient sa dernière carte : y redescendre la retrouve.
//  - OK : l'élément choisi (un champ de texte s'ouvre à l'écriture).
//  - Retour : 461 sur webOS, Échap, Retour arrière hors d'un champ.
//  - Lecture, pause, avance et retour rapides, stop : au calque (lecteur).
//  - Pointeur de la Magic Remote : le survol choisit, le clic active, la
//    molette fait défiler.
// ═══════════════════════════════════════════════════════════════════════════

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
const DIRS = new Set(['left', 'right', 'up', 'down'])

/** Calques, du plus ancien au plus récent : { root, onKey, onBack, initial, last }. */
const layers = []
/** Dernière carte choisie de chaque rangée. */
const rowMemory = new WeakMap()
let lastKeyAt = 0

/** Pose un calque : `root` (ce qui se parcourt), et facultatifs `onKey(k, e)`
 *  (vrai : touche prise), `onBack()`, `initial()` (premier élément). */
export function pushLayer(layer) {
  layers.push(layer)
  return layer
}

/** Retire un calque (et ceux posés après lui) ; le focus revient au
 *  précédent, sur son dernier élément. */
export function popLayer(layer, { restore = true } = {}) {
  const i = layers.indexOf(layer)
  if (i < 0) return
  layers.splice(i)
  if (restore) restoreFocus()
}

export const topLayer = () => layers[layers.length - 1] ?? null

/** Millisecondes depuis la dernière touche (les commandes du lecteur
 *  restent affichées tant qu'on s'y promène). */
export const sinceKey = () => Date.now() - lastKeyAt

// ── Champs de texte ────────────────────────────────────────────────────────
// Atteint aux flèches, un champ est en lecture seule : le clavier de la TV
// ne s'ouvre pas à chaque passage. OK l'ouvre à l'écriture, Retour en sort.
const isText = (el) => el?.tagName === 'INPUT' && !el.disabled && /^(text|search|url|email|tel)$/.test(el.type)
export const editing = (el) => isText(el) && !el.readOnly

function lock(el) {
  if (!isText(el) || el.readOnly) return
  el.readOnly = true
  el.dataset.tvLock = '1'
}

function unlock(el) {
  if (!el?.dataset?.tvLock) return
  el.readOnly = false
  delete el.dataset.tvLock
}

// ── Où l'on peut aller ─────────────────────────────────────────────────────
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [data-focusable]'

function visible(el) {
  if (!el?.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.opacity !== '0'
}

function candidates(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.closest('[data-nofocus]'))
}

/** Premier élément d'un calque : le dernier choisi, sinon le sien, sinon
 *  le plus haut à gauche. */
function initialIn(layer) {
  if (layer.last?.isConnected && layer.root.contains(layer.last) && visible(layer.last)) return layer.last
  const own = layer.initial?.()
  if (own && visible(own)) return own
  return candidates(layer.root).find(visible) ?? null
}

/** Le focus, et l'élément amené dans l'écran. */
export function focusEl(el, { reveal = true } = {}) {
  if (!el) return false
  lock(el)
  try { el.focus({ preventScroll: true }) } catch { el.focus() }
  if (document.activeElement !== el) return false
  if (reveal) revealEl(el)
  return true
}

/** Focus remis sur le calque du dessus (après un changement d'écran). */
export function restoreFocus() {
  const layer = topLayer()
  if (!layer) return
  const a = document.activeElement
  if (a && a !== document.body && layer.root.contains(a) && visible(a)) return
  focusEl(initialIn(layer))
}

/** Défilement des conteneurs marqués data-scroll="x" ou "y" pour que
 *  l'élément s'y voie en entier, avec une marge. Dans une page (y), c'est le
 *  bloc de sa rangée (data-block : titre compris) qui doit se voir. */
export function revealEl(el) {
  for (let c = el.parentElement; c && c !== document.body; c = c.parentElement) {
    const axis = c.dataset?.scroll
    if (!axis) continue
    const cr = c.getBoundingClientRect()
    if (axis === 'x') {
      const r = el.getBoundingClientRect()
      const pad = Number(c.dataset.pad || 60)
      if (r.left < cr.left + pad) c.scrollLeft -= cr.left + pad - r.left
      else if (r.right > cr.right - pad) c.scrollLeft += r.right - (cr.right - pad)
    } else {
      const target = el.closest('[data-block]') && c.contains(el.closest('[data-block]')) ? el.closest('[data-block]') : el
      const r = target.getBoundingClientRect()
      const pad = Number(c.dataset.pad || 40)
      // Premier bloc de la page : tout en haut (le titre de l'écran se voit).
      if (target.matches?.('[data-block]:first-child') && c.scrollTop > 0 && r.top < cr.top + pad) c.scrollTop = 0
      else if (r.top < cr.top + pad) c.scrollTop -= cr.top + pad - r.top
      else if (r.bottom > cr.bottom - pad) c.scrollTop += Math.min(r.bottom - (cr.bottom - pad), r.top - (cr.top + pad))
    }
  }
}

// Le plus proche dans la direction : écart sur l'axe, plus l'écart sur
// l'autre axe (fort à l'horizontale, pour rester sur la même ligne), plus un
// peu de décalage des centres, moins un peu de recouvrement ; à égalité,
// l'ordre de lecture (repris de public/assets/js/tv.js). En haut et en bas,
// seules les cartes visibles dans la largeur de l'écran comptent : celles
// qu'une rangée a fait défiler hors de l'écran ne sont pas en face.
const TOL = 4

function nearest(from, list, dir) {
  const c = from.getBoundingClientRect()
  const horizontal = dir === 'left' || dir === 'right'
  const center = horizontal ? (c.top + c.bottom) / 2 : (c.left + c.right) / 2
  const width = window.innerWidth
  let best = null
  let bestScore = Infinity
  for (const el of list) {
    if (el === from || el.contains(from) || from.contains(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (!horizontal && (r.right <= 0 || r.left >= width)) continue
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

/** Une flèche : l'élément suivant dans le calque du dessus. Rien dans
 *  cette direction : onEdge du calque (charger la suite…). */
export function move(dir) {
  const layer = topLayer()
  if (!layer) return false
  const a = document.activeElement
  if (!a || a === document.body || !layer.root.contains(a) || !visible(a)) return focusEl(initialIn(layer))
  // De la barre des onglets vers le bas : là où l'on était dans l'écran,
  // sinon son premier élément (pas le plus proche à la verticale, parfois
  // tout en bas : la langue dans les réglages).
  if (dir === 'down' && a.closest('[data-down-initial]')) {
    const back = layer.content?.isConnected && layer.root.contains(layer.content) && visible(layer.content) ? layer.content : layer.initial?.()
    if (back && visible(back)) return focusEl(back)
  }
  const list = candidates(layer.root)
  // Barre des onglets : gauche / droite y restent. À gauche du premier
  // onglet, le focus sautait dans la page, sur son bouton le plus à gauche
  // (« Oublier la session » dans les réglages : un OK de trop l'effaçait).
  const bar = a.closest('[data-down-initial]')
  if (bar && (dir === 'left' || dir === 'right')) {
    const beside = nearest(a, list.filter((el) => bar.contains(el)), dir)
    return beside ? focusEl(beside) : false
  }
  const row = a.closest('[data-row]')
  let next
  if (row && (dir === 'left' || dir === 'right')) {
    // Au bout d'une rangée, on n'entre pas dans une autre rangée (la carte
    // suivante se charge, onEdge) ; on peut en sortir vers ce qui n'en est
    // pas une (le clavier à gauche des résultats de recherche).
    next = nearest(a, list.filter((el) => row.contains(el)), dir)
      ?? nearest(a, list.filter((el) => !el.closest('[data-row]')), dir)
  } else next = nearest(a, list, dir)
  if (next && (dir === 'up' || dir === 'down')) {
    // Une autre rangée : sa dernière carte choisie, si elle se voit encore.
    const row = next.closest('[data-row]')
    if (row && row !== a.closest('[data-row]')) {
      const kept = rowMemory.get(row)
      if (kept?.isConnected && row.contains(kept) && visible(kept)) next = kept
    }
  }
  if (next) return focusEl(next)
  layer.onEdge?.(dir)
  return false
}

/** OK sur un élément : un champ verrouillé s'ouvre à l'écriture, le reste
 *  reçoit un clic. */
export function activate(el) {
  if (!el || el === document.body) return
  if (el.dataset?.tvLock) {
    unlock(el)
    el.blur()
    el.focus()
    return
  }
  el.click()
}

// ── Touches ────────────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  let k = CODES[e.keyCode] ?? KEYS[e.key]
  if (!k) return
  lastKeyAt = Date.now()
  const a = document.activeElement
  if (k === 'backspace') {
    if (editing(a)) return
    k = 'back'
  }
  // Champ en cours d'écriture : le curseur et le clavier de la TV gardent
  // les flèches gauche / droite et Entrée ; Retour en sort, haut / bas aussi.
  if (editing(a)) {
    if (k === 'left' || k === 'right' || k === 'ok') return
    if (k === 'back') {
      e.preventDefault()
      lock(a)
      return
    }
    if (k === 'up' || k === 'down') lock(a)
  }
  const layer = topLayer()
  if (!layer) return
  e.preventDefault()
  e.stopPropagation()
  if (layer.onKey?.(k, e)) return
  if (k === 'back') { if (!e.repeat) layer.onBack?.(); return }
  if (k === 'ok') {
    if (e.repeat) return
    if (a && a !== document.body && layer.root.contains(a)) activate(a)
    else restoreFocus()
    return
  }
  if (DIRS.has(k)) move(k)
}

function onFocusIn(e) {
  const el = e.target
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!layers[i].root.contains(el)) continue
    layers[i].last = el
    if (!el.closest('[data-down-initial]')) layers[i].content = el
    break
  }
  const row = el.closest?.('[data-row]')
  if (row) rowMemory.set(row, el)
}

/** Quitter l'app : comme Retour sur la première page d'une app webOS. */
export function exitApp() {
  const sys = window.webOSSystem || window.PalmSystem
  try {
    if (sys && typeof sys.platformBack === 'function') { sys.platformBack(); return }
  } catch {}
  try { window.close() } catch {}
}

/** Branché une fois, au démarrage (main.js). */
export function initNav() {
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', (e) => unlock(e.target))
  // Magic Remote : le survol choisit (sans faire défiler), la molette fait
  // défiler la page ou la rangée sous le pointeur.
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.(FOCUSABLE)
    const layer = topLayer()
    if (!el || !layer?.root.contains(el) || el === document.activeElement || editing(document.activeElement)) return
    focusEl(el, { reveal: false })
  })
  document.addEventListener('wheel', (e) => {
    const box = e.target.closest?.('[data-scroll="y"]')
    if (box) box.scrollTop += e.deltaY
  }, { passive: true })
}
