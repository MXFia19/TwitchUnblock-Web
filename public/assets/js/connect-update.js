// ═══════════════════════════════════════════════════════════════════════════
//  TwitchUnblock Connect : bandeau « nouvelle version disponible ».
//  Installée à la main depuis les zips de GitHub (Chrome, Edge, Brave),
//  l'extension ne se met jamais à jour seule. Quand celle de ce navigateur est
//  plus ancienne que la dernière publiée (CONNECT_LATEST, connect.js), une
//  ligne discrète en haut du contenu le dit, avec le lien de téléchargement et
//  la marche à suivre (extension/INSTALL.md). Fermée, elle ne revient plus
//  pour cette version-là (stockage local) ; rien sans extension, rien une fois
//  qu'elle est à jour, et rien sur Firefox, où celle de Firefox Add-ons se
//  met à jour seule (updateFor).
// ═══════════════════════════════════════════════════════════════════════════
import { AMO_URL, INSTALL_URL, connect, updateFor } from './connect.js'
import { t } from './i18n.js'
import { esc, icon } from './util.js'

/** Version dont le bandeau a été fermé (la suivante l'affiche de nouveau). */
const CLOSED_KEY = 'tu_connect_update_closed'
/** Fermé dans cette page : vaut aussi quand le stockage est refusé. */
let closedHere = null
/** Ce qui est affiché (versions, navigateur, langue) : l'état de l'extension
 *  change souvent (session, réglages), le bandeau n'est refait que si ceci
 *  change — « Comment mettre à jour ? » resterait sinon refermé sous les yeux. */
let shown = ''

function isClosed(version) {
  if (closedHere === version) return true
  try { return localStorage.getItem(CLOSED_KEY) === version } catch { return false }
}

/** Le bandeau d'une mise à jour (`upd` : updateFor) ; les étapes du seul
 *  navigateur de l'extension quand on le connaît, sinon des deux. */
export function updateBannerHtml(upd, browser = null) {
  const steps = (browser === 'chrome' || browser === 'firefox' ? [browser] : ['chrome', 'firefox'])
    .map((b) => `<li>${esc(t(`connect_update_${b}`))}</li>`).join('')
  const url = browser === 'firefox' ? AMO_URL : INSTALL_URL
  return `<div class="cx-update" role="status">
    <span class="cx-update-ic">${icon('download', 16)}</span>
    <div class="cx-update-body">
      <p><b>${esc(t('connect_update', { v: upd.latest, cur: upd.current }))}</b>
        <a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('connect_update_get'))}${icon('external', 12)}</a></p>
      <details><summary>${esc(t('connect_update_how'))}</summary><ul>${steps}</ul></details>
    </div>
    <button class="icon-btn sm" type="button" data-cxu-close title="${esc(t('close'))}" aria-label="${esc(t('close'))}">${icon('x', 16)}</button>
  </div>`
}

function render() {
  const box = document.getElementById('connect-update')
  if (!box) return
  const st = connect.state()
  const upd = updateFor(st)
  if (!upd || isClosed(upd.latest)) {
    box.hidden = true
    box.innerHTML = ''
    shown = ''
    return
  }
  const key = [upd.latest, upd.current, st.browser, document.documentElement.lang].join('|')
  if (key === shown) return
  shown = key
  box.innerHTML = updateBannerHtml(upd, st.browser)
  box.hidden = false
}

/** Au démarrage, après connect.start() : le bandeau suit l'état de
 *  l'extension (détection, annonce après une mise à jour) et la langue. */
export function initConnectUpdate() {
  const box = document.getElementById('connect-update')
  if (!box) return
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-cxu-close]')) return
    const upd = updateFor(connect.state())
    if (upd) {
      closedHere = upd.latest
      try { localStorage.setItem(CLOSED_KEY, upd.latest) } catch {}
    }
    render()
  })
  connect.onChange(render)
  // Langue changée dans les réglages : setLang la pose sur <html lang>.
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  render()
}
