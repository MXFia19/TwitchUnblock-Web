// ═══════════════════════════════════════════════════════════════════════════
//  Écrans de l'app : trois onglets (accueil, recherche, réglages) gardés en
//  mémoire, et des écrans posés par-dessus (catégorie, chaîne, lecteur,
//  connexion). Un écran caché garde son contenu et son défilement : Retour
//  le retrouve tel quel, focus compris (nav.js, dernier élément du calque).
//
//  Un écran : { el, initial?(), onKey?(k, e), onBack?(), onEdge?(dir),
//  onShow?(), onHide?(), destroy?() }. onBack rend vrai s'il a géré Retour.
// ═══════════════════════════════════════════════════════════════════════════

import { exitApp, focusEl, popLayer, pushLayer, restoreFocus, topLayer } from './nav.js'

const $ = (sel, root = document) => root.querySelector(sel)

/** { screen, layer } du bas (l'onglet) vers le haut. */
const stack = []
const tabs = new Map()
let factories = {}
let currentTab = null

const host = () => $('#screens')
const topbar = () => $('#topbar')

/** Fabriques des onglets ({ home, search, settings }), et l'onglet de départ. */
export function initRouter(make, first = 'home') {
  factories = make
  for (const b of topbar().querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => showTab(b.dataset.tab))
  }
  showTab(first, { focusTab: false })
}

function layerFor(screen, root) {
  return {
    root,
    initial: () => screen.initial?.() ?? null,
    onKey: (k, e) => Boolean(screen.onKey?.(k, e)),
    onBack: () => { if (!screen.onBack?.()) back() },
    onEdge: (dir) => screen.onEdge?.(dir),
  }
}

function paintTopbar() {
  const bar = topbar()
  const onTab = stack.length === 1
  bar.hidden = !onTab
  for (const b of bar.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === currentTab)
}

/** Onglet affiché (créé à la première visite) ; les écrans posés dessus
 *  sont fermés. */
export function showTab(name, { focusTab = true } = {}) {
  while (stack.length > 1) closeTop()
  const before = stack.pop()
  if (before) {
    popLayer(before.layer, { restore: false })
    before.screen.el.hidden = true
    before.screen.onHide?.()
  }
  let screen = tabs.get(name)
  if (!screen) {
    screen = factories[name]()
    tabs.set(name, screen)
    // Sous la barre des onglets : la page commence plus bas, et ce qu'on
    // choisit ne se cache pas derrière elle (marge de défilement, nav.js).
    screen.el.classList.add('tab')
    for (const box of [screen.el, ...screen.el.querySelectorAll('[data-scroll="y"]')]) {
      if (box.dataset.scroll === 'y') box.dataset.pad = '150'
    }
    host().append(screen.el)
  }
  currentTab = name
  screen.el.hidden = false
  const layer = pushLayer(layerFor(screen, $('#app')))
  stack.push({ screen, layer })
  paintTopbar()
  screen.onShow?.()
  const tabBtn = topbar().querySelector(`[data-tab="${name}"]`)
  if (focusTab) focusEl(tabBtn)
  else restoreFocus()
}

export const tab = () => currentTab
export const tabScreen = (name) => tabs.get(name) ?? null
/** L'écran du dessus. */
export const current = () => stack[stack.length - 1]?.screen ?? null

/** Pose un écran par-dessus (la barre des onglets se cache). */
export function open(screen) {
  const prev = stack[stack.length - 1]
  if (prev) {
    prev.screen.el.hidden = true
    prev.screen.onHide?.()
  }
  host().append(screen.el)
  const layer = pushLayer(layerFor(screen, screen.el))
  stack.push({ screen, layer })
  paintTopbar()
  screen.onShow?.()
  restoreFocus()
  return screen
}

function closeTop() {
  const top = stack.pop()
  popLayer(top.layer, { restore: false })
  top.screen.destroy?.()
  top.screen.el.remove()
}

/** Retour : l'écran du dessus se ferme ; sur un onglet, retour à l'accueil ;
 *  sur l'accueil, la barre des onglets, puis on quitte l'app. */
export function back() {
  if (stack.length > 1) {
    closeTop()
    const cur = stack[stack.length - 1]
    cur.screen.el.hidden = false
    paintTopbar()
    cur.screen.onShow?.()
    restoreFocus()
    return
  }
  if (currentTab !== 'home') { showTab('home'); return }
  const home = stack[0]?.screen
  const homeBtn = topbar().querySelector('[data-tab="home"]')
  if (document.activeElement !== homeBtn) {
    home?.toTop?.()
    focusEl(homeBtn)
    return
  }
  exitApp()
}

/** Ferme un écran précis s'il est encore ouvert (fin d'une connexion…). */
export function close(screen) {
  if (current() === screen) back()
}

/** Calque du dessus : sert aux panneaux qui se posent sur un écran. */
export const activeLayer = topLayer
