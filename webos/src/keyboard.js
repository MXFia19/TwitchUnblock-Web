// ═══════════════════════════════════════════════════════════════════════════
//  Clavier à l'écran, pour la télécommande : lettres, chiffres, espace,
//  effacer. Le champ au-dessus reste un vrai champ : OK dessus ouvre le
//  clavier de la TV (nav.js), ce qu'on y tape arrive ici aussi.
//  `symbols` : une ligne de ponctuation en plus (messages du chat).
// ═══════════════════════════════════════════════════════════════════════════

import { esc } from '../../public/assets/js/util.js'
import { el } from './ui.js'
import { tt } from './strings.js'

const LETTERS = ['abcdefghi', 'jklmnopqr', 'stuvwxyz_', '1234567890']
const SYMBOLS = ".,!?'@:-()"

/**
 * @param {object} o
 * @param {string} [o.placeholder]
 * @param {number} [o.max]  longueur maximale
 * @param {boolean} [o.symbols]
 * @param {string} [o.submit]  texte du bouton de validation (sinon aucun)
 * @param {(text: string) => void} [o.onInput]
 * @param {(text: string) => void} [o.onSubmit]
 */
export function createKeyboard(o = {}) {
  const rows = [...LETTERS, ...(o.symbols ? [SYMBOLS] : [])]
  const root = el(`<div class="kb">
    <input class="kb-field" type="text" maxlength="${o.max || 100}" placeholder="${esc(o.placeholder || '')}" autocomplete="off" spellcheck="false">
    <div class="kb-keys">
      ${rows.map((r) => `<div class="kb-row">${[...r].map((c) => `<button class="key" type="button" data-k="${esc(c)}">${esc(c === '_' ? '_' : c)}</button>`).join('')}</div>`).join('')}
      <div class="kb-row">
        <button class="key wide" type="button" data-k=" ">${esc(tt('tv_kb_space'))}</button>
        <button class="key mid" type="button" data-act="del">⌫ ${esc(tt('tv_kb_delete'))}</button>
        <button class="key mid" type="button" data-act="clear">${esc(tt('tv_kb_clear'))}</button>
      </div>
      ${o.submit ? `<div class="kb-row"><button class="key submit" type="button" data-act="submit">${esc(o.submit)}</button></div>` : ''}
    </div>
  </div>`)
  const field = root.querySelector('.kb-field')
  const changed = () => o.onInput?.(field.value)
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('button.key')
    if (!b) return
    const max = o.max || 100
    if (b.dataset.k != null) { if (field.value.length < max) field.value += b.dataset.k }
    else if (b.dataset.act === 'del') field.value = field.value.slice(0, -1)
    else if (b.dataset.act === 'clear') field.value = ''
    else if (b.dataset.act === 'submit') { o.onSubmit?.(field.value); return }
    changed()
  })
  field.addEventListener('input', changed)
  // Entrée sur le clavier de la TV : validé comme le bouton.
  field.addEventListener('keydown', (e) => {
    if (e.keyCode !== 13 || field.readOnly) return
    e.preventDefault()
    o.onSubmit?.(field.value)
  })
  return {
    el: root,
    field,
    get value() { return field.value },
    set value(v) { field.value = String(v ?? ''); changed() },
    /** Première touche, pour poser le focus. */
    first: () => root.querySelector('.key'),
  }
}
