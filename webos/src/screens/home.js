// ═══════════════════════════════════════════════════════════════════════════
//  Accueil, en rangées : chaînes suivies en direct (compte Twitch, session
//  web de l'iPhone et suivis sur cette TV), VODs à reprendre, plus gros
//  directs, catégories. Au bout d'une rangée, la suite se charge. Relu au
//  retour sur l'accueil après deux minutes, le focus restant sur la même
//  carte.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../../public/assets/js/api.js'
import { store } from '../../../public/assets/js/store.js'
import { t } from '../../../public/assets/js/i18n.js'
import { user, withAuth } from '../auth.js'
import { followedLiveByWebSession, webSession } from '../websession.js'
import { focusEl } from '../nav.js'
import { bindCards, categoryCard, emptyHtml, errorHtml, loadingHtml, rowHtml, screenEl, streamCard, vodCard } from '../ui.js'
import { tt } from '../strings.js'

const STALE_MS = 2 * 60_000
// Langues du top des lives chez Twitch (main.js du site, TOP_LANGS).
const TOP_LANGS = ['ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'th', 'tl', 'tr', 'uk', 'vi', 'zh', 'zh_hk']

/** Langue du top : celle de la TV (si Twitch la connaît), ou toutes. */
export function deviceTopLang() {
  for (const raw of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const tag = String(raw).toLowerCase()
    if (/^zh-(hk|mo|tw|hant)/.test(tag)) return 'zh_hk'
    const code = tag.slice(0, 2)
    if (code === 'nb' || code === 'nn') return 'no'
    if (TOP_LANGS.includes(code)) return code
  }
  return null
}
const topLangCode = () => (store.prefs.tvTopAll ? null : deviceTopLang())

export function homeScreen() {
  const root = screenEl('home')
  const page = root.querySelector('.page')
  page.innerHTML = rowHtml('row-followed', tt('tv_followed_live'), loadingHtml())
    + rowHtml('row-resume', t('continue_watching'))
    + rowHtml('row-top', t('top'), loadingHtml())
    + rowHtml('row-cats', t('nav_categories'), loadingHtml())
  bindCards(root)
  const track = (id) => page.querySelector(`#${id} .track`)
  const block = (id) => page.querySelector(`#${id}`)
  let loadedAt = 0
  let top = null
  let cats = null
  let more = false

  const keyOf = (el) => ['live', 'vod', 'cat', 'channel'].map((k) => el?.dataset?.[k] && `[data-${k}="${CSS.escape(el.dataset[k])}"]`).find(Boolean) ?? null
  // Dernière carte choisie : au retour d'un écran (lecteur…), l'accueil se
  // relit avant que le focus revienne ; c'est elle qu'on retrouve.
  let lastKey = null
  root.addEventListener('focusin', (e) => { lastKey = keyOf(e.target) ?? lastKey })

  /** Carte choisie remplacée par sa copie après une relecture. */
  function keepFocus(fn) {
    const a = document.activeElement
    const inPage = Boolean(a && page.contains(a))
    const key = inPage ? keyOf(a) : !a || a === document.body ? lastKey : null
    fn()
    if (key && (!inPage || !a.isConnected) && !root.hidden) {
      const twin = page.querySelector(`.card${key}`)
      if (twin) focusEl(twin)
    }
  }

  /** Suivis du compte connecté par code (Helix), du compte de la session web
   *  de l'iPhone (GQL) et de cette TV, sans doublon. Une source qui échoue
   *  (null) n'empêche pas les autres ; l'erreur ne s'affiche que si rien
   *  d'autre ne vient. */
  async function loadFollowed() {
    const local = store.prefs.localFollows ?? []
    const lists = await Promise.all([
      user ? withAuth(() => api.getFollowedStreams(user.id)).catch(() => null) : [],
      webSession && !webSession.expired ? followedLiveByWebSession().catch(() => null) : [],
      local.length ? api.getLiveByLogins(local).catch(() => null) : [],
    ])
    const streams = []
    const seen = new Set()
    for (const s of lists.flatMap((l) => l ?? [])) {
      if (s?.login && !seen.has(s.login)) { seen.add(s.login); streams.push(s) }
    }
    const failed = lists.some((l) => l === null)
    streams.sort((a, b) => b.viewers - a.viewers)
    keepFocus(() => {
      track('row-followed').innerHTML = streams.length ? streams.map(streamCard).join('')
        : failed ? errorHtml() : emptyHtml(tt('tv_followed_empty'))
    })
  }

  function loadResume() {
    const items = store.history.filter((h) => h.type === 'vod').filter((h) => {
      const pos = store.getProgress(h.term)
      const len = store.getLength(h.term)
      return pos > 10 && (!len || pos < len - 30)
    }).slice(0, 15)
    block('row-resume').hidden = !items.length
    keepFocus(() => {
      track('row-resume').innerHTML = items.map((h) => vodCard({ id: h.term, title: h.display, previewThumbnailURL: h.thumb }, { streamer: h.streamer || '' })).join('')
    })
  }

  async function loadTop() {
    try {
      const pg = await api.getTopStreams(topLangCode())
      top = { cursor: pg.cursor, seen: new Set(pg.items.map((s) => s.login)) }
      keepFocus(() => { track('row-top').innerHTML = pg.items.length ? pg.items.map(streamCard).join('') : emptyHtml(t('no_live')) })
    } catch {
      track('row-top').innerHTML = errorHtml()
    }
  }

  async function loadCats() {
    try {
      const pg = await api.getTopCategories()
      cats = { cursor: pg.cursor }
      keepFocus(() => { track('row-cats').innerHTML = pg.items.map(categoryCard).join('') })
    } catch {
      track('row-cats').innerHTML = errorHtml()
    }
  }

  function loadAll() {
    loadedAt = Date.now()
    loadResume()
    return Promise.all([loadFollowed(), loadTop(), loadCats()])
  }

  /** Bout d'une rangée atteint : la page suivante, ajoutée à la suite. */
  async function loadMore(rowId) {
    if (more) return
    const state = rowId === 'row-top' ? top : rowId === 'row-cats' ? cats : null
    if (!state?.cursor) return
    more = true
    try {
      if (rowId === 'row-top') {
        const pg = await api.getTopStreams(topLangCode(), state.cursor)
        state.cursor = pg.cursor
        const fresh = pg.items.filter((s) => !state.seen.has(s.login))
        for (const s of fresh) state.seen.add(s.login)
        track(rowId).insertAdjacentHTML('beforeend', fresh.map(streamCard).join(''))
      } else {
        const pg = await api.getTopCategories(state.cursor)
        state.cursor = pg.cursor
        track(rowId).insertAdjacentHTML('beforeend', pg.items.map(categoryCard).join(''))
      }
    } catch {} finally { more = false }
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-retry]')) loadAll()
  })
  // Quatre cartes avant le bout : la suite arrive avant qu'on l'atteigne.
  root.addEventListener('focusin', (e) => {
    const card = e.target.closest?.('.card')
    const row = card?.closest('.block')
    if (!row || (row.id !== 'row-top' && row.id !== 'row-cats')) return
    const cards = row.querySelectorAll('.card')
    if ([...cards].indexOf(card) >= cards.length - 4) loadMore(row.id)
  })

  loadAll()

  return {
    el: root,
    initial: () => page.querySelector('.card') ?? null,
    onShow() {
      if (Date.now() - loadedAt > STALE_MS) loadAll()
      else loadResume()
    },
    /** Retour sur l'accueil : tout en haut. */
    toTop() {
      root.scrollTop = 0
      for (const r of page.querySelectorAll('.row')) r.scrollLeft = 0
    },
    /** Compte connecté ou déconnecté, suivis changés : la rangée relue. */
    refreshFollowed: () => loadFollowed(),
    /** Langue du top changée : tout est relu au prochain affichage. */
    markStale() { loadedAt = 0 },
  }
}
