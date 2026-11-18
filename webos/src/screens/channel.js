// ═══════════════════════════════════════════════════════════════════════════
//  Chaîne : son direct s'il y en a un, « Suivre sur cette TV » (la liste du
//  site, prefs.localFollows), puis ses VODs en grille (les 100 dernières,
//  puis la suite).
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../../public/assets/js/api.js'
import { store } from '../../../public/assets/js/store.js'
import { t } from '../../../public/assets/js/i18n.js'
import { esc, formatViewers, icon, uptimeSince } from '../../../public/assets/js/util.js'
import { focusEl } from '../nav.js'
import { actions, bindCards, emptyHtml, errorHtml, loadingHtml, screenEl, vodCard } from '../ui.js'
import { tt } from '../strings.js'

const PAGE = 24

const followed = (login) => (store.prefs.localFollows ?? []).includes(login)

export function channelScreen(login) {
  const root = screenEl('channel')
  const page = root.querySelector('.page')
  page.innerHTML = `<header class="hero" data-block><div class="hero-text">${loadingHtml()}</div></header>
    <section class="block" id="chan-vods"><h2 class="block-title">${esc(t('vods'))}</h2><div class="grid">${loadingHtml()}</div></section>
    <div class="more-wrap"><button class="btn" type="button" data-more hidden>${esc(t('load_more'))}</button></div>`
  bindCards(root)
  const hero = page.querySelector('.hero')
  const grid = page.querySelector('.grid')
  const moreBtn = page.querySelector('[data-more]')
  let info = null
  // VODs reçues (100 par requête) servies par PAGE, curseur de la suite.
  let rest = []
  let after = null
  let more = false
  let busy = false

  function paintHero() {
    const s = info?.stream
    const name = info?.displayName || login
    const isFollowed = followed(login)
    hero.innerHTML = `${info?.profileImageURL ? `<img class="hero-avatar" src="${esc(info.profileImageURL)}" alt="" onerror="this.remove()">` : ''}
      <div class="hero-text">
        <h1>${esc(name)}</h1>
        ${s ? `<p class="hero-live"><span class="badge red">${esc(t('live_now'))}</span> ${esc(s.title || '')}</p>
          <p class="hero-sub">${esc([s.game?.displayName, `${formatViewers(s.viewersCount)} ${t('viewers')}`, s.createdAt ? uptimeSince(s.createdAt) : ''].filter(Boolean).join(' · '))}</p>`
          : `<p class="hero-sub">${esc(info ? t('offline') : t('not_found'))}</p>`}
        <div class="hero-actions">
          ${s ? `<button class="btn primary" type="button" data-watch>${icon('play', 28)}<span>${esc(t('watch_live'))}</span></button>` : ''}
          ${info ? `<button class="btn${isFollowed ? ' on' : ''}" type="button" data-follow>${icon(isFollowed ? 'check' : 'heart', 28)}<span>${esc(tt(isFollowed ? 'tv_unfollow_tv' : 'tv_follow_tv'))}</span></button>` : ''}
        </div>
      </div>`
  }

  function serve() {
    const items = rest.splice(0, PAGE)
    grid.insertAdjacentHTML('beforeend', items.map((v) => vodCard(v, { streamer: info?.displayName || login })).join(''))
    moreBtn.hidden = !rest.length && !(after && more)
  }

  async function loadMore() {
    if (busy) return
    if (rest.length) { serve(); return }
    if (!after || !more) return
    busy = true
    try {
      const r = await api.getChannelVideosAfter(login, after)
      after = r.refused ? null : r.after
      more = !r.refused && r.more
      rest = r.videos
      serve()
    } catch {} finally { busy = false }
  }

  async function load() {
    const [ch, vods] = await Promise.allSettled([api.getChannelInfo(login), api.getChannelVideos(login)])
    info = ch.status === 'fulfilled' ? ch.value : null
    paintHero()
    if (vods.status === 'rejected') { grid.innerHTML = errorHtml(); return }
    const v = vods.value
    grid.innerHTML = ''
    rest = v?.videos ?? []
    after = v?.after ?? null
    more = Boolean(v?.more)
    if (!rest.length) grid.innerHTML = emptyHtml(t('no_vod'))
    serve()
    // Rien de choisi encore (chargement) : le premier bouton de la fiche.
    const a = document.activeElement
    if (!a || a === document.body || !root.contains(a)) focusEl(hero.querySelector('.btn') || grid.querySelector('.card'))
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-watch]')) actions.playLive?.(login)
    else if (e.target.closest?.('[data-follow]')) {
      const list = store.prefs.localFollows ?? []
      store.prefs.localFollows = list.includes(login) ? list.filter((x) => x !== login) : [login, ...list].slice(0, 300)
      store.savePrefs()
      paintHero()
      focusEl(hero.querySelector('[data-follow]'), { reveal: false })
      actions.followsChanged?.()
    } else if (e.target.closest?.('[data-retry]')) load()
  })
  moreBtn.addEventListener('click', () => loadMore())
  root.addEventListener('focusin', (e) => {
    const card = e.target.closest?.('.card')
    if (!card) return
    const cards = grid.querySelectorAll('.card')
    if ([...cards].indexOf(card) >= cards.length - 4) loadMore()
  })
  load()

  return {
    el: root,
    initial: () => hero.querySelector('.btn') ?? grid.querySelector('.card') ?? null,
  }
}
