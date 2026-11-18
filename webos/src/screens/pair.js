// ═══════════════════════════════════════════════════════════════════════════
//  Session web depuis l'iPhone : la TV montre un QR code (identifiant et clé
//  de cet appairage, adresse du Worker), un compte à rebours de 5 minutes,
//  et relève le Worker toutes les 2 s (websession.js). La session arrivée
//  est déchiffrée, gardée, et l'écran se ferme. Retour l'abandonne ; à la
//  fin (réussite, expiration, abandon), la clé est effacée de la mémoire et
//  le code ne sert plus.
// ═══════════════════════════════════════════════════════════════════════════

import { t } from '../../../public/assets/js/i18n.js'
import { esc, toast } from '../../../public/assets/js/util.js'
import { qrEncode, qrSvg } from '../lib/qr.js'
import { endPairing, saveWebSession, startPairing, waitForSession } from '../websession.js'
import { focusEl } from '../nav.js'
import { actions, el } from '../ui.js'
import { tt } from '../strings.js'

/** « 4:59 » */
const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function pairScreen() {
  const root = el(`<div class="screen pair"><div class="pair-box"></div></div>`)
  const box = root.querySelector('.pair-box')
  let closed = false
  let attempt = 0
  let pairing = null
  let clock = null

  /** Fin de l'appairage en cours : compte à rebours arrêté, clé effacée. */
  function stop() {
    clearInterval(clock)
    clock = null
    if (pairing) endPairing(pairing)
    pairing = null
  }

  function paintError(text) {
    stop()
    box.innerHTML = `<div class="pair-text"><h1>${esc(tt('tv_ws_connect'))}</h1><p class="login-note">${esc(text)}</p>
      <div class="login-actions"><button class="btn primary" type="button" data-again>${esc(tt('tv_login_new_code'))}</button>
      <button class="btn" type="button" data-cancel>${esc(t('back'))}</button></div></div>`
    focusEl(box.querySelector('[data-again]'), { reveal: false })
  }

  async function run() {
    stop()
    const mine = ++attempt
    const p = startPairing()
    pairing = p
    let svg
    try {
      svg = qrSvg(qrEncode(p.qrText, { ecl: 'M' }))
    } catch {
      paintError(tt('tv_pair_failed'))
      return
    }
    box.innerHTML = `<div class="pair-qr">${svg}</div>
      <div class="pair-text">
        <h1>${esc(tt('tv_ws_connect'))}</h1>
        <p class="pair-step">${esc(tt('tv_pair_steps'))}</p>
        <p class="pair-left"></p>
        <p class="login-wait pair-wait"><span class="spinner"></span><span class="pair-state">${esc(tt('tv_pair_waiting'))}</span></p>
        <p class="pair-note">${esc(tt('tv_pair_secure'))}</p>
        <div class="login-actions"><button class="btn" type="button" data-cancel>${esc(t('back'))}</button></div>
      </div>`
    const left = box.querySelector('.pair-left')
    const state = box.querySelector('.pair-state')
    const tick = () => { left.textContent = tt('tv_pair_left', { t: clockText(p.expiresAt - Date.now()) }) }
    tick()
    clock = setInterval(tick, 1000)
    focusEl(box.querySelector('[data-cancel]'), { reveal: false })
    const r = await waitForSession(p, {
      cancelled: () => closed || mine !== attempt,
      onState: (s) => { if (mine === attempt) state.textContent = tt(s === 'offline' ? 'tv_pair_offline' : 'tv_pair_waiting') },
    })
    if (closed || mine !== attempt || r.result === 'cancelled') return
    stop()
    if (r.result === 'ok') {
      saveWebSession(r.session)
      toast(tt('tv_ws_connected', { u: r.session.displayName || r.session.login }), 'success', 3500)
      actions.back?.()
      return
    }
    paintError(tt(r.result === 'expired' ? 'tv_login_expired' : 'tv_pair_failed'))
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-again]')) run()
    else if (e.target.closest?.('[data-cancel]')) actions.back?.()
  })
  run()

  return {
    el: root,
    initial: () => box.querySelector('.btn') ?? null,
    destroy() {
      closed = true
      stop()
    },
  }
}
