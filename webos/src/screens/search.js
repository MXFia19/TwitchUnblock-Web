// ═══════════════════════════════════════════════════════════════════════════
//  Recherche : clavier à l'écran à gauche (ou celui de la TV, OK sur le
//  champ), chaînes et catégories à droite, mises à jour pendant la frappe.
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../../public/assets/js/api.js'
import { t } from '../../../public/assets/js/i18n.js'
import { esc } from '../../../public/assets/js/util.js'
import { createKeyboard } from '../keyboard.js'
import { bindCards, categoryCard, channelCard, el, emptyHtml, errorHtml, loadingHtml } from '../ui.js'
import { tt } from '../strings.js'

export function searchScreen() {
  const root = el(`<div class="screen search">
    <div class="search-left"></div>
    <div class="search-right" data-scroll="y">
      <div class="page">
        <section class="block" data-block id="res-channels"><h2 class="block-title">${esc(tt('tv_channels'))}</h2><div class="row" data-row data-scroll="x"><div class="track"></div></div></section>
        <section class="block" data-block id="res-cats"><h2 class="block-title">${esc(t('nav_categories'))}</h2><div class="row" data-row data-scroll="x"><div class="track"></div></div></section>
      </div>
    </div>
  </div>`)
  const kb = createKeyboard({ placeholder: tt('tv_search_hint'), max: 60, onInput: (q) => schedule(q) })
  root.querySelector('.search-left').append(kb.el)
  bindCards(root)
  const chans = root.querySelector('#res-channels .track')
  const cats = root.querySelector('#res-cats .track')
  let timer = null
  let gen = 0

  function paintIdle(text) {
    chans.innerHTML = emptyHtml(text)
    cats.innerHTML = ''
  }

  function schedule(raw) {
    clearTimeout(timer)
    const q = raw.trim()
    if (q.length < 2) { gen++; paintIdle(q ? tt('tv_search_more') : tt('tv_search_hint')); return }
    timer = setTimeout(() => run(q), 450)
  }

  async function run(q) {
    const mine = ++gen
    chans.innerHTML = loadingHtml()
    cats.innerHTML = ''
    const [c, g] = await Promise.allSettled([api.searchChannels(q), api.searchCategories(q)])
    if (mine !== gen) return
    if (c.status === 'rejected' && g.status === 'rejected') { chans.innerHTML = errorHtml(); return }
    const users = c.status === 'fulfilled' ? c.value : []
    const games = g.status === 'fulfilled' ? g.value : []
    chans.innerHTML = users.length ? users.map(channelCard).join('') : emptyHtml(t('no_result'))
    cats.innerHTML = games.map(categoryCard).join('')
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-retry]')) schedule(kb.value)
  })
  paintIdle(tt('tv_search_hint'))

  return {
    el: root,
    initial: () => kb.first(),
  }
}
