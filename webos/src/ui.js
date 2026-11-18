// ═══════════════════════════════════════════════════════════════════════════
//  Briques d'affichage : cartes (direct, catégorie, VOD, chaîne), rangées,
//  grilles, états vides. Tout texte venu de Twitch passe par esc().
//  Une carte est un bouton ; son clic passe par `actions`, rempli par
//  main.js (ouvrir une chaîne, lancer un direct…) : les écrans n'ont pas à
//  se connaître entre eux.
// ═══════════════════════════════════════════════════════════════════════════

import { esc, formatClock, formatDuration, formatViewers, thumb } from '../../public/assets/js/util.js'
import { lang, t } from '../../public/assets/js/i18n.js'
import { store } from '../../public/assets/js/store.js'
import { tt } from './strings.js'

/** Rempli par main.js : openChannel(login), playLive(login, preset),
 *  playVod(id, preset), openCategory(cat). */
export const actions = {}

/** Petit élément depuis du HTML. */
export function el(html) {
  const t0 = document.createElement('template')
  t0.innerHTML = html.trim()
  return t0.content.firstElementChild
}

const viewersText = (n) => `${formatViewers(n)} ${t('viewers')}`

/** Image qui disparaît si elle ne charge pas (l'emplacement reste). */
const img = (src, cls, alt = '') => (src
  ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`
  : `<span class="${cls} ph"></span>`)

export function streamCard(s) {
  return `<button class="card live" type="button" data-live="${esc(s.login)}">
    <span class="thumb">${img(thumb(s.thumb, 440, 248), 'thumb-img')}
      <span class="badge red">${esc(t('live_now'))}</span>
      <span class="badge dark corner">${esc(viewersText(s.viewers))}</span></span>
    <span class="meta">${img(s.avatar, 'avatar sm')}
      <span class="lines"><b class="name">${esc(s.name || s.login)}</b>
      <span class="title">${esc(s.title)}</span>
      <span class="sub">${esc(s.game || '')}</span></span></span>
  </button>`
}

export function categoryCard(c) {
  return `<button class="card cat" type="button" data-cat="${esc(c.id)}" data-cat-name="${esc(c.name)}" data-cat-box="${esc(c.box || '')}">
    <span class="box">${img(thumb(c.box, 285, 380), 'box-img')}</span>
    <span class="lines"><b class="name">${esc(c.name)}</b>
    ${c.viewers != null ? `<span class="sub">${esc(viewersText(c.viewers))}</span>` : ''}</span>
  </button>`
}

/** Carte de VOD ; `v` au format GQL (id, title, lengthSeconds,
 *  publishedAt, previewThumbnailURL), ou d'historique (preset). */
export function vodCard(v, { streamer = '' } = {}) {
  const length = v.lengthSeconds || store.getLength(v.id) || 0
  const pos = store.getProgress(v.id)
  const ratio = length > 0 && pos > 10 ? Math.min(1, pos / length) : 0
  const date = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString(lang(), { day: 'numeric', month: 'short' }) : ''
  return `<button class="card vod" type="button" data-vod="${esc(v.id)}" data-title="${esc(v.title || '')}" data-thumb="${esc(v.previewThumbnailURL || '')}" data-streamer="${esc(streamer)}">
    <span class="thumb">${img(v.previewThumbnailURL, 'thumb-img')}
      ${length ? `<span class="badge dark corner">${esc(formatClock(length))}</span>` : ''}
      ${ratio ? `<span class="progress"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span>` : ''}</span>
    <span class="meta"><span class="lines"><b class="name">${esc(v.title || `VOD ${v.id}`)}</b>
      <span class="sub">${esc([streamer, date, length ? formatDuration(length) : ''].filter(Boolean).join(' · '))}</span></span></span>
  </button>`
}

/** Chaîne (résultats de recherche) : photo, nom, en direct ou non. */
export function channelCard(u) {
  const live = Boolean(u.stream)
  return `<button class="card chan" type="button" data-channel="${esc(u.login)}">
    <span class="chan-pic">${img(u.profileImageURL || u.avatar, 'avatar lg')}${live ? `<span class="badge red">${esc(t('live_now'))}</span>` : ''}</span>
    <span class="lines"><b class="name">${esc(u.displayName || u.name || u.login)}</b>
    <span class="sub">${live ? esc(viewersText(u.stream.viewersCount ?? u.stream.viewers ?? 0)) : esc(t('offline'))}</span></span>
  </button>`
}

/** Rangée horizontale avec son titre. `id` : pour la retrouver et la
 *  remplir plus tard. */
export function rowHtml(id, title, inner = '') {
  return `<section class="block" data-block id="${id}">
    <h2 class="block-title">${esc(title)}</h2>
    <div class="row" data-row data-scroll="x"><div class="track">${inner}</div></div>
  </section>`
}

/** Bloc vertical (grille) avec son titre. */
export function gridHtml(id, title, inner = '') {
  return `<section class="block" id="${id}">
    <h2 class="block-title">${esc(title)}</h2>
    <div class="grid">${inner}</div>
  </section>`
}

export const loadingHtml = () => `<div class="state"><span class="spinner"></span>${esc(t('loading'))}</div>`
export const emptyHtml = (text) => `<div class="state">${esc(text)}</div>`
export const errorHtml = (text = t('err_loading')) => `<div class="state error">${esc(text)}<button class="btn" type="button" data-retry>${esc(tt('tv_retry'))}</button></div>`

/** Clics des cartes d'un écran, vers `actions`. */
export function bindCards(root) {
  root.addEventListener('click', (e) => {
    const card = e.target.closest?.('button.card')
    if (!card || !root.contains(card)) return
    const d = card.dataset
    if (d.live) actions.playLive?.(d.live)
    else if (d.vod) actions.playVod?.(d.vod, { title: d.title, thumb: d.thumb, streamer: d.streamer })
    else if (d.cat) actions.openCategory?.({ id: d.cat, name: d.catName, box: d.catBox })
    else if (d.channel) actions.openChannel?.(d.channel)
  })
}

/** Écran à défilement vertical : `<div class="screen">` et sa page. */
export function screenEl(cls = '') {
  return el(`<div class="screen ${cls}" data-scroll="y"><div class="page"></div></div>`)
}
