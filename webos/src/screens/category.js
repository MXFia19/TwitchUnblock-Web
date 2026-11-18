// ═══════════════════════════════════════════════════════════════════════════
//  Catégorie : ses directs en grille, les plus regardés d'abord ; la suite
//  arrive quand on approche du bas (et par « Charger plus »).
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../../public/assets/js/api.js'
import { t } from '../../../public/assets/js/i18n.js'
import { esc, formatViewers, thumb } from '../../../public/assets/js/util.js'
import { bindCards, emptyHtml, errorHtml, loadingHtml, screenEl, streamCard } from '../ui.js'
import { tt } from '../strings.js'

export function categoryScreen(cat) {
  const root = screenEl('category')
  const page = root.querySelector('.page')
  page.innerHTML = `<header class="hero" data-block>
      ${cat.box ? `<img class="hero-box" src="${esc(thumb(cat.box, 285, 380))}" alt="" onerror="this.remove()">` : ''}
      <div class="hero-text"><h1>${esc(cat.name)}</h1><p class="hero-sub"></p></div>
    </header>
    <section class="block" id="cat-streams"><h2 class="block-title">${esc(tt('tv_streams'))}</h2><div class="grid"></div></section>
    <div class="more-wrap"><button class="btn" type="button" data-more hidden>${esc(t('load_more'))}</button></div>`
  bindCards(root)
  const grid = page.querySelector('.grid')
  const moreBtn = page.querySelector('[data-more]')
  let cursor = null
  let loading = false
  const seen = new Set()

  async function load(first) {
    if (loading) return
    loading = true
    if (first) grid.innerHTML = loadingHtml()
    try {
      const pg = await api.getCategoryStreams(cat.id, first ? null : cursor)
      cursor = pg.cursor
      const fresh = pg.items.filter((s) => !seen.has(s.login))
      for (const s of fresh) seen.add(s.login)
      if (first) grid.innerHTML = fresh.length ? '' : emptyHtml(t('no_live'))
      grid.insertAdjacentHTML('beforeend', fresh.map(streamCard).join(''))
    } catch {
      if (first) grid.innerHTML = errorHtml()
    } finally {
      loading = false
      moreBtn.hidden = !cursor
    }
  }

  api.getCategoriesByIds([cat.id]).then(([c]) => {
    if (c?.viewers != null) page.querySelector('.hero-sub').textContent = `${formatViewers(c.viewers)} ${t('viewers')}`
  }).catch(() => {})
  moreBtn.addEventListener('click', () => load(false))
  root.addEventListener('click', (e) => { if (e.target.closest?.('[data-retry]')) load(true) })
  // Dernière ligne atteinte : la suite d'avance.
  root.addEventListener('focusin', (e) => {
    const card = e.target.closest?.('.card')
    if (!card || !cursor) return
    const cards = grid.querySelectorAll('.card')
    if ([...cards].indexOf(card) >= cards.length - 4) load(false)
  })
  load(true)

  return {
    el: root,
    initial: () => grid.querySelector('.card') ?? null,
  }
}
