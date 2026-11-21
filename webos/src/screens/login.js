// ═══════════════════════════════════════════════════════════════════════════
//  Connexion par code : la TV affiche un code à valider sur
//  twitch.tv/activate depuis un téléphone ou un ordinateur, puis attend
//  (auth.js). Retour l'abandonne.
// ═══════════════════════════════════════════════════════════════════════════

import { t } from '../../../public/assets/js/i18n.js'
import { esc, toast } from '../../../public/assets/js/util.js'
import { requestCode, user, waitForApproval } from '../auth.js'
import { focusEl } from '../nav.js'
import { actions, el, loadingHtml } from '../ui.js'
import { tt } from '../strings.js'

export function loginScreen() {
  const root = el(`<div class="screen login"><div class="login-box"></div></div>`)
  const box = root.querySelector('.login-box')
  let closed = false
  let attempt = 0

  function paintError(text) {
    box.innerHTML = `<h1>${esc(tt('tv_account'))}</h1><p class="login-note">${esc(text)}</p>
      <div class="login-actions"><button class="btn primary" type="button" data-again>${esc(tt('tv_login_new_code'))}</button>
      <button class="btn" type="button" data-cancel>${esc(t('back'))}</button></div>`
    focusEl(box.querySelector('[data-again]'), { reveal: false })
  }

  async function run() {
    const mine = ++attempt
    box.innerHTML = `<h1>${esc(tt('tv_account'))}</h1>${loadingHtml()}`
    let code
    try {
      code = await requestCode()
    } catch {
      if (!closed && mine === attempt) paintError(tt('tv_login_failed'))
      return
    }
    if (closed || mine !== attempt) return
    // Adresse sans « https://www. » : plus courte à recopier.
    const short = code.uri.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, '')
    box.innerHTML = `<h1>${esc(tt('tv_account'))}</h1>
      <p class="login-step">${esc(tt('tv_login_steps'))}</p>
      <p class="login-url">${esc(short)}</p>
      <p class="login-step">${esc(tt('tv_login_code'))}</p>
      <p class="login-code">${esc(code.userCode)}</p>
      <p class="login-wait"><span class="spinner"></span>${esc(tt('tv_login_waiting'))}</p>
      <div class="login-actions"><button class="btn" type="button" data-cancel>${esc(t('back'))}</button></div>`
    focusEl(box.querySelector('[data-cancel]'), { reveal: false })
    const result = await waitForApproval(code, () => closed || mine !== attempt)
    if (closed || mine !== attempt || result === 'cancelled') return
    if (result === 'ok') {
      toast(tt('tv_logged_in', { u: user?.name || '' }), 'success', 3500)
      actions.back?.()
      return
    }
    // Autre compte que celui qui était connecté (rangé, auth.js) : l'app
    // redémarre pour lui (suivis, chat, points, session web).
    if (result === 'switched') {
      toast(tt('tv_logged_in', { u: user?.name || '' }), 'success', 3500)
      setTimeout(() => location.reload(), 1200)
      return
    }
    paintError(tt(result === 'expired' ? 'tv_login_expired' : 'tv_login_failed'))
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-again]')) run()
    else if (e.target.closest?.('[data-cancel]')) actions.back?.()
  })
  run()

  return {
    el: root,
    initial: () => box.querySelector('.btn') ?? null,
    destroy() { closed = true },
  }
}
