// ═══════════════════════════════════════════════════════════════════════════
//  Réglages : compte Twitch (par code), session web envoyée par l'iPhone
//  (screens/pair.js, websession.js), langue, ordre des sources du direct,
//  qualité préférée, faible latence, langue du top, chat. Un choix = une
//  rangée de boutons, coche sur la valeur retenue (comme l'Apple TV). Les
//  réglages sont ceux du site (store.prefs), plus quelques-uns propres à
//  la TV (tvChatSide, tvChatSize, tvTopAll, et avec une session web
//  tvPoints, tvStreak : allumés tant qu'ils ne sont pas coupés).
// ═══════════════════════════════════════════════════════════════════════════

import * as api from '../../../public/assets/js/api.js'
import { store } from '../../../public/assets/js/store.js'
import { LANGS, t } from '../../../public/assets/js/i18n.js'
import { QUALITY_PREFS, validQualityPref } from '../../../public/assets/js/player.js'
import { esc, icon, toast } from '../../../public/assets/js/util.js'
import { logout, onAuthChange, removeAccount, savedAccounts, switchAccount, user } from '../auth.js'
import { forgetWebSession, mismatch, onWebSessionChange, webSession } from '../websession.js'
import { focusEl } from '../nav.js'
import { actions, screenEl } from '../ui.js'
import { tt } from '../strings.js'
import { deviceTopLang } from './home.js'

/* global TU_TV_VERSION, TU_TV_BUILD */
const VERSION = typeof TU_TV_VERSION === 'string' ? TU_TV_VERSION : 'dev'
const BUILD = typeof TU_TV_BUILD === 'string' ? TU_TV_BUILD : ''

const QUALITY_LABEL = { auto: () => t('q_auto'), source: () => t('q_source'), audio: () => t('q_audio') }

export function settingsScreen() {
  const root = screenEl('settings')
  const page = root.querySelector('.page')

  const choice = (key, label, options, current, sub = '') => `<section class="block setting" data-block>
      <h2 class="block-title">${esc(label)}</h2>${sub ? `<p class="setting-sub">${esc(sub)}</p>` : ''}
      <div class="choices" data-row>${options.map(([v, text]) => {
        const on = String(v) === String(current)
        return `<button class="choice${on ? ' on' : ''}" type="button" data-set="${esc(key)}" data-v="${esc(String(v))}">${on ? icon('check', 26) : ''}<span>${esc(text)}</span></button>`
      }).join('')}</div>
    </section>`

  const yesNo = [['1', tt('tv_on')], ['0', tt('tv_off')]]
  const bool = (v) => (v ? '1' : '0')

  /** Session web de l'iPhone : connecter, ou qui est connecté et l'oublier.
   *  Refusée par Twitch : la reconnecter, ou l'oublier. */
  function webSessionBlock() {
    const ws = webSession
    const name = ws ? ws.displayName || ws.login : ''
    const connect = `<button class="choice" type="button" data-act="pair">${icon('link', 26)}<span>${esc(tt('tv_ws_connect'))}</span></button>`
    const forget = `<button class="choice" type="button" data-act="ws-forget">${icon('trash', 26)}<span>${esc(tt('tv_ws_forget'))}</span></button>`
    // Dernière session refusée : elle était d'un autre compte que celui de
    // la TV (websession.js, comme l'app iPhone).
    const refused = !ws && mismatch ? `<p class="setting-sub setting-status">${esc(tt('tv_ws_mismatch', { w: mismatch.web, a: mismatch.account }))}</p>` : ''
    return `<section class="block setting" data-block>
        <h2 class="block-title">${esc(tt('tv_ws_title'))}</h2>
        ${ws ? `<p class="setting-sub setting-status">${esc(ws.expired ? tt('tv_ws_expired', { u: name }) : tt('tv_ws_connected', { u: name }))}</p>` : ''}${refused}
        <p class="setting-sub">${esc(tt('tv_ws_sub'))}</p>
        <div class="choices" data-row>${ws ? `${ws.expired ? connect : ''}${forget}` : connect}</div>
      </section>`
  }

  /** Comptes rangés sur la TV (auth.js) : passer à l'un d'eux (l'app
   *  redémarre), ou le retirer. Une rangée par compte. */
  function savedAccountsHtml() {
    const list = savedAccounts()
    if (!list.length) return ''
    return `<p class="setting-sub">${esc(tt('tv_other_accounts'))}</p>${list.map((a) => `<div class="choices" data-row>
        <button class="choice" type="button" data-switch="${esc(a.user.id)}">${icon('user', 26)}<span>${esc(tt('tv_switch_to', { u: a.user.name || a.user.login }))}</span></button>
        <button class="choice" type="button" data-remove="${esc(a.user.id)}">${icon('trash', 26)}<span>${esc(tt('tv_remove_account'))}</span></button>
      </div>`).join('')}`
  }

  function paint() {
    const p = store.prefs
    const order = api.liveSourceOrder()
    const tvLang = deviceTopLang()
    const langName = (code) => { try { return new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'language' }).of(code.replace('_', '-')) } catch { return code } }
    page.innerHTML = `<h1 class="screen-title">${esc(tt('tv_settings'))}</h1>
      <section class="block setting" data-block>
        <h2 class="block-title">${esc(tt('tv_account'))}</h2>
        <p class="setting-sub">${esc(user ? tt('tv_logged_as', { u: user.name }) : tt('tv_login_sub'))}</p>
        <div class="choices" data-row>${user
          ? `<button class="choice" type="button" data-act="add-account">${icon('plus', 26)}<span>${esc(tt('tv_add_account'))}</span></button>
            <button class="choice" type="button" data-act="logout">${icon('logout', 26)}<span>${esc(t('logout'))}</span></button>`
          : `<button class="choice" type="button" data-act="login">${icon('twitch', 26)}<span>${esc(tt('tv_login'))}</span></button>`}</div>
        ${savedAccountsHtml()}
      </section>
      ${webSessionBlock()}
      ${webSession ? choice('tvPoints', tt('tv_points'), yesNo, bool(p.tvPoints !== false), tt('tv_points_sub')) : ''}
      ${webSession ? choice('tvStreak', tt('tv_streak'), yesNo, bool(p.tvStreak !== false), tt('tv_streak_sub')) : ''}
      ${choice('lang', tt('tv_language'), [['auto', t('lang_auto')], ...LANGS.map((l) => [l.id, l.label])], p.lang || 'auto')}
      <section class="block setting" data-block>
        <h2 class="block-title">${esc(tt('tv_sources'))}</h2><p class="setting-sub">${esc(tt('tv_sources_sub'))}</p>
        <div class="sources">${order.map((id, i) => `<div class="source" data-row>
          <span class="rank">${i + 1}</span><span class="src-name">${esc(t(`src_${id}`))}</span>
          <button class="choice sm" type="button" data-src-up="${esc(id)}" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 26)}<span>${esc(t('src_up'))}</span></button>
          <button class="choice sm" type="button" data-src-down="${esc(id)}" ${i === order.length - 1 ? 'disabled' : ''}>${icon('chevronDown', 26)}<span>${esc(t('src_down'))}</span></button>
        </div>`).join('')}</div>
      </section>
      ${choice('qualityPref', t('pref_quality'), QUALITY_PREFS.map((q) => [q, QUALITY_LABEL[q]?.() ?? `${q}p`]), validQualityPref(p.qualityPref) ? p.qualityPref : 'auto')}
      ${choice('lowLatency', t('low_latency'), yesNo, bool(p.lowLatency !== false), t('low_latency_sub'))}
      ${choice('tvTopAll', tt('tv_top_lang'), [['0', tt('tv_top_lang_tv', { l: tvLang ? langName(tvLang) : '—' })], ['1', t('cat_lang_all')]], bool(p.tvTopAll))}
      ${choice('chatOpen', tt('tv_chat_open'), yesNo, bool(p.chatOpen !== false))}
      ${choice('tvChatSide', tt('tv_chat_side'), [['left', tt('tv_left')], ['right', tt('tv_right')]], p.tvChatSide === 'left' ? 'left' : 'right')}
      ${choice('tvChatSize', tt('tv_chat_size'), [['s', tt('tv_small')], ['m', tt('tv_medium')], ['l', tt('tv_large')]], ['s', 'l'].includes(p.tvChatSize) ? p.tvChatSize : 'm')}
      ${choice('chatSync', t('chat_sync'), yesNo, bool(p.chatSync !== false))}
      ${choice('timestamps', t('timestamps'), yesNo, bool(p.timestamps))}
      ${choice('hideBots', t('hide_bots'), yesNo, bool(p.hideBots))}
      <section class="block setting" data-block>
        <h2 class="block-title">${esc(tt('tv_about'))}</h2>
        <p class="setting-sub">TwitchUnblock · ${esc(tt('tv_version', { v: VERSION }))}${BUILD ? ` (${esc(BUILD)})` : ''} · github.com/MXFia19/TwitchUnblock-Web</p>
      </section>`
  }

  /** Valeur d'un bouton → réglage. */
  function apply(key, v) {
    const p = store.prefs
    switch (key) {
      case 'lang':
        p.lang = v === 'auto' ? null : v
        store.savePrefs()
        // Toute l'app est dans l'ancienne langue : on repart.
        location.reload()
        return
      case 'qualityPref': p.qualityPref = v; break
      case 'tvChatSide': case 'tvChatSize': p[key] = v; break
      case 'lowLatency': case 'chatOpen': case 'chatSync': case 'timestamps': case 'hideBots': case 'tvTopAll':
      case 'tvPoints': case 'tvStreak':
        p[key] = v === '1'
        break
      default: return
    }
    store.savePrefs()
    if (key === 'tvTopAll') actions.topChanged?.()
  }

  /** Bouton à reprendre quand l'écran revient (repeint pendant qu'un écran
   *  était posé dessus : connexion, session de l'iPhone). */
  let pendingFocus = null

  /** Repeint, le focus sur le même bouton (ou son voisin). */
  function repaint(sel) {
    paint()
    const again = sel && page.querySelector(sel)
    if (!again) return
    if (root.hidden) pendingFocus = sel
    else focusEl(again, { reveal: false })
  }

  function moveSource(id, delta) {
    const order = api.liveSourceOrder()
    const i = order.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    store.prefs.liveSourceOrder = order
    store.prefs.liveSource = null
    store.savePrefs()
    const attr = delta < 0 ? 'data-src-up' : 'data-src-down'
    repaint(`[${attr}="${CSS.escape(id)}"]:not([disabled])`)
    // Arrivée en tête ou en bas : son bouton dans ce sens est grisé, l'autre prend le focus.
    if (!page.contains(document.activeElement)) focusEl(page.querySelector(`[data-src-up="${CSS.escape(id)}"]:not([disabled]), [data-src-down="${CSS.escape(id)}"]:not([disabled])`), { reveal: false })
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('button')
    if (!b) return
    if (b.dataset.set) {
      apply(b.dataset.set, b.dataset.v)
      repaint(`[data-set="${CSS.escape(b.dataset.set)}"][data-v="${CSS.escape(b.dataset.v)}"]`)
    } else if (b.dataset.srcUp) moveSource(b.dataset.srcUp, -1)
    else if (b.dataset.srcDown) moveSource(b.dataset.srcDown, 1)
    else if (b.dataset.act === 'login' || b.dataset.act === 'add-account') actions.openLogin?.()
    else if (b.dataset.switch) {
      toast(tt('tv_switching'), 'info')
      switchAccount(b.dataset.switch)
    } else if (b.dataset.remove) {
      const a = savedAccounts().find((x) => x.user.id === b.dataset.remove)
      removeAccount(b.dataset.remove)
      if (a) toast(tt('tv_account_removed', { u: a.user.name || a.user.login }), 'info')
      repaint(user ? '[data-act="add-account"]' : '[data-act="login"]')
    }
    else if (b.dataset.act === 'logout') {
      logout()
      toast(tt('tv_logged_out'), 'info')
      repaint('[data-act="login"]')
    } else if (b.dataset.act === 'pair') actions.openPair?.()
    else if (b.dataset.act === 'ws-forget') {
      forgetWebSession()
      toast(tt('tv_ws_forgotten'), 'info')
    }
  })
  onAuthChange(() => { if (root.isConnected) repaint(document.activeElement?.dataset?.act ? `[data-act="${user ? 'logout' : 'login'}"]` : null) })
  // Session reçue, oubliée ou refusée : le bloc change, le focus va sur
  // son bouton (« Oublier la session » ou « Connecter avec l'iPhone »).
  onWebSessionChange(() => {
    if (!root.isConnected) return
    const act = document.activeElement?.dataset?.act
    const fromBlock = act === 'pair' || act === 'ws-forget' || root.hidden
    repaint(fromBlock ? `[data-act="${webSession && !webSession.expired ? 'ws-forget' : 'pair'}"]` : null)
  })
  paint()

  return {
    el: root,
    initial: () => page.querySelector('.choice') ?? null,
    onShow() {
      const again = pendingFocus && page.querySelector(pendingFocus)
      pendingFocus = null
      if (again) focusEl(again, { reveal: false })
    },
  }
}
