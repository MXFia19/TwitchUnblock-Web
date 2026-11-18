// ═══════════════════════════════════════════════════════════════════════════
//  Ce que les moteurs des TV LG n'ont pas encore et dont les modules du site
//  se servent (webOS 6 : Chromium 79, webOS 22 : 87, webOS 23 : 94). Importé
//  en premier par main.js, avant tout module du site. La syntaxe récente
//  (??=, ?., champs de classe…), elle, est réécrite à la fabrication
//  (esbuild, cible chrome79 : tools/build-webos.mjs). Rien n'est remplacé
//  quand le moteur l'a déjà. Mêmes ajouts que le mode TV du site (tv.js),
//  plus replaceAll (Chromium 85) et queueMicrotask.
// ═══════════════════════════════════════════════════════════════════════════

function add(obj, name, value) {
  if (!(name in obj)) Object.defineProperty(obj, name, { value, writable: true, configurable: true })
}

add(Object, 'hasOwn', (o, k) => Object.prototype.hasOwnProperty.call(o, k))

const at = function (i) {
  let n = Math.trunc(i) || 0
  if (n < 0) n += this.length
  return n < 0 || n >= this.length ? undefined : this[n]
}
add(Array.prototype, 'at', at)
add(String.prototype, 'at', at)

add(Array.prototype, 'findLast', function (fn, that) {
  for (let i = this.length - 1; i >= 0; i--) if (fn.call(that, this[i], i, this)) return this[i]
  return undefined
})

add(String.prototype, 'replaceAll', function (search, replacement) {
  if (search instanceof RegExp) {
    if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp')
    return this.replace(search, replacement)
  }
  const s = String(search)
  const parts = String(this).split(s)
  if (typeof replacement !== 'function') return parts.join(String(replacement))
  let out = parts[0]
  let pos = parts[0].length
  for (let i = 1; i < parts.length; i++) {
    out += String(replacement(s, pos, String(this))) + parts[i]
    pos += s.length + parts[i].length
  }
  return out
})

// Réglages seulement (données JSON) : une copie par JSON suffit.
add(window, 'structuredClone', (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))))
add(window, 'queueMicrotask', (fn) => { Promise.resolve().then(fn) })
