// ═══════════════════════════════════════════════════════════════════════════
//  App TwitchUnblock pour les TV LG (webOS), empaquetée dans l'IPK.
//
//  Les modules du site (public/assets/js : api, player, chat, i18n, store,
//  util) sont repris tels quels ; tools/build-webos.mjs les assemble avec
//  ceux de ce dossier en un seul script classique (esbuild) : une app
//  installée tourne depuis file://, où webOS refuse les modules ES. Ce qui
//  est propre à la TV est ici : écrans, navigation à la télécommande,
//  lecteur plein écran, chat sur le côté, connexion par code.
// ═══════════════════════════════════════════════════════════════════════════

import './polyfills.js'
import { initLang } from '../../public/assets/js/i18n.js'
import { store } from '../../public/assets/js/store.js'
import { esc } from '../../public/assets/js/util.js'
import { onAuthChange, restore, user } from './auth.js'
import { initNav } from './nav.js'
import { back, current, initRouter, open, tabScreen } from './router.js'
import { actions } from './ui.js'
import { tt } from './strings.js'
import { watchScreen } from './watch.js'
import { homeScreen } from './screens/home.js'
import { searchScreen } from './screens/search.js'
import { settingsScreen } from './screens/settings.js'
import { categoryScreen } from './screens/category.js'
import { channelScreen } from './screens/channel.js'
import { loginScreen } from './screens/login.js'

initLang(store.prefs.lang)
document.documentElement.classList.add('tv-app')

const app = document.getElementById('app')
app.innerHTML = `<nav id="topbar" data-down-initial>
    <span class="brand"><img src="icon.png" alt="">TwitchUnblock</span>
    <button type="button" data-tab="home">${esc(tt('tv_home'))}</button>
    <button type="button" data-tab="search">${esc(tt('tv_search'))}</button>
    <button type="button" data-tab="settings">${esc(tt('tv_settings'))}</button>
    <span class="account"></span>
  </nav>
  <div id="screens"></div>`

function paintAccount() {
  const box = app.querySelector('#topbar .account')
  box.innerHTML = user ? `${user.avatar ? `<img src="${esc(user.avatar)}" alt="" onerror="this.remove()">` : ''}<span>${esc(user.name)}</span>` : ''
}

// ── Ce que les cartes et les écrans demandent (ui.js, actions) ─────────────
actions.back = () => back()
actions.playLive = (login) => open(watchScreen({ kind: 'live', login }))
actions.playVod = (id, preset) => open(watchScreen({ kind: 'vod', id: String(id), preset }))
actions.openCategory = (cat) => open(categoryScreen(cat))
actions.openLogin = () => open(loginScreen())
/** Chaîne ouverte depuis le lecteur : le lecteur se ferme d'abord (Retour
 *  depuis la chaîne revient là d'où l'on venait). */
actions.openChannel = (login, { fromPlayer = false } = {}) => {
  if (fromPlayer && current()?.el.classList.contains('watch')) back()
  open(channelScreen(login))
}
actions.followsChanged = () => tabScreen('home')?.refreshFollowed?.()
actions.topChanged = () => tabScreen('home')?.markStale?.()

initNav()
initRouter({ home: homeScreen, search: searchScreen, settings: settingsScreen })
paintAccount()
onAuthChange(() => { paintAccount(); tabScreen('home')?.refreshFollowed?.() })
restore().catch(() => {})

document.getElementById('boot')?.remove()
window.__tuBooted = true
