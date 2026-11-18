// ═══════════════════════════════════════════════════════════════════════════
//  Codes QR (ISO/IEC 18004), en mode octets : la TV y montre de quoi lui
//  envoyer la session web depuis l'iPhone (screens/pair.js).
//
//  Versions 1 à 40 ; correction d'erreurs L, M, Q ou H, relevée tant que la
//  même version le permet ; masque choisi par les pénalités de la norme.
//  Écrit pour TwitchUnblock d'après la norme ; tools/pair-check.mjs le fait
//  relire par un vrai lecteur (OpenCV, s'il est installé) et vérifie les
//  capacités de chaque version.
// ═══════════════════════════════════════════════════════════════════════════

const LEVELS = ['L', 'M', 'Q', 'H']
// Bits du niveau dans l'information de format.
const LEVEL_BITS = [1, 0, 3, 2]

// Par niveau (L, M, Q, H) et par version (indice 0 inutilisé) : octets de
// correction de chaque bloc, et nombre de blocs (tableaux 9 de la norme).
const ECC_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]
const BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

/** Modules de données (et de correction) d'une version : tout, moins les
 *  motifs fixes et les informations de format et de version. */
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}

/** Octets de données d'une version à ce niveau (indice de LEVELS). */
export function dataCapacity(ver, level) {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[level][ver] * BLOCKS[level][ver]
}

/** Centres des motifs d'alignement (lignes et colonnes). */
function alignPositions(ver, size) {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

// ── Reed-Solomon dans GF(256), polynôme 0x11D ──────────────────────────────
function rsMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

/** Générateur de degré `degree` (coefficients, sans celui du terme de tête). */
function rsDivisor(degree) {
  const out = new Array(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = rsMul(out[j], root)
      if (j + 1 < degree) out[j] ^= out[j + 1]
    }
    root = rsMul(root, 0x02)
  }
  return out
}

function rsRemainder(data, divisor) {
  const out = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ out.shift()
    out.push(0)
    for (let i = 0; i < divisor.length; i++) out[i] ^= rsMul(divisor[i], factor)
  }
  return out
}

/** Blocs de données + correction, entrelacés comme le veut la norme. */
function interleave(data, ver, level) {
  const blocks = BLOCKS[level][ver]
  const eccLen = ECC_PER_BLOCK[level][ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const shortBlocks = blocks - (raw % blocks)
  const shortLen = Math.floor(raw / blocks)
  const divisor = rsDivisor(eccLen)
  const all = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const part = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += part.length
    const ecc = rsRemainder(part, divisor)
    if (i < shortBlocks) part.push(0)   // place vide, sautée plus bas
    all.push(part.concat(ecc))
  }
  const out = []
  for (let i = 0; i < all[0].length; i++) {
    for (let j = 0; j < all.length; j++) {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(all[j][i])
    }
  }
  return out
}

function utf8(text) {
  return Array.from(new TextEncoder().encode(String(text)))
}

/**
 * Code QR d'un texte (mode octets, UTF-8). `ecl` : niveau minimal
 * ('L', 'M', 'Q', 'H') ; `mask` (0 à 7) impose un masque (vérifications).
 * Rend { version, size, ecl, mask, isDark(x, y) }. Lève RangeError si le
 * texte ne tient pas dans la version 40.
 */
export function qrEncode(text, { ecl = 'M', boost = true, mask = -1 } = {}) {
  const data = utf8(text)
  let level = Math.max(0, LEVELS.indexOf(ecl))
  let ver = 1
  const fits = (v, l) => 4 + (v <= 9 ? 8 : 16) + data.length * 8 <= dataCapacity(v, l) * 8
  while (!fits(ver, level)) {
    if (++ver > 40) throw new RangeError('Text too long for a QR code')
  }
  if (boost) while (level < 3 && fits(ver, level + 1)) level++

  // Bits : mode octets (0100), longueur, octets, fin, remplissage.
  const capacity = dataCapacity(ver, level) * 8
  const bits = []
  const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  push(4, 4)
  push(data.length, ver <= 9 ? 8 : 16)
  for (const b of data) push(b, 8)
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)
  const codewords = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    codewords.push(b)
  }
  const stream = interleave(codewords, ver, level)

  const size = ver * 4 + 17
  const dark = new Uint8Array(size * size)
  const fixed = new Uint8Array(size * size)
  const set = (x, y, on) => { dark[y * size + x] = on ? 1 : 0; fixed[y * size + x] = 1 }

  // Motifs de repérage (trois coins), de synchronisation, d'alignement.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const align = alignPositions(ver, size)
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)
      if (corner) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }

  // Information de format (niveau, masque) : BCH(15,5), masque 0x5412.
  const format = (mask) => {
    const value = (LEVEL_BITS[level] << 3) | mask
    let rem = value
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const f = ((value << 10) | rem) ^ 0x5412
    const bit = (i) => (f >>> i) & 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6))
    set(8, 8, bit(7))
    set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)   // module toujours sombre
  }
  format(0)   // réserve sa place avant de poser les données

  // Information de version (7 et plus) : BCH(18,6).
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const v = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const on = (v >>> i) & 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, on)
      set(b, a, on)
    }
  }

  // Données, en zigzag par colonnes de deux depuis le coin bas droit (la
  // colonne 6, celle de la synchronisation, est sautée).
  let k = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (fixed[y * size + x] || k >= stream.length * 8) continue
        dark[y * size + x] = (stream[k >>> 3] >>> (7 - (k & 7))) & 1
        k++
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fixed[y * size + x] && MASKS[m](x, y)) dark[y * size + x] ^= 1
      }
    }
  }
  const at = (x, y) => dark[y * size + x]

  /** Pénalités d'une ligne : séries de 5 et plus, motifs 1:1:3:1:1. */
  const linePenalty = (get) => {
    let p = 0
    let run = 1
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) run++
      else {
        if (run >= 5) p += run - 2
        run = 1
      }
    }
    if (run >= 5) p += run - 2
    const light = (i) => i < 0 || i >= size || !get(i)
    for (let i = 0; i + 6 < size; i++) {
      if (get(i) && !get(i + 1) && get(i + 2) && get(i + 3) && get(i + 4) && !get(i + 5) && get(i + 6)) {
        const before = light(i - 1) && light(i - 2) && light(i - 3) && light(i - 4)
        const after = light(i + 7) && light(i + 8) && light(i + 9) && light(i + 10)
        if (before || after) p += 40
      }
    }
    return p
  }
  const penalty = () => {
    let p = 0
    for (let y = 0; y < size; y++) p += linePenalty((x) => at(x, y))
    for (let x = 0; x < size; x++) p += linePenalty((y) => at(x, y))
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = at(x, y)
        if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3
      }
    }
    let darkCount = 0
    for (let i = 0; i < dark.length; i++) darkCount += dark[i]
    const total = size * size
    p += Math.max(0, Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10
    return p
  }

  const forced = Number.isInteger(mask) && mask >= 0 && mask < 8
  let best = forced ? mask : 0
  let bestScore = Infinity
  for (let m = 0; !forced && m < 8; m++) {
    applyMask(m)
    format(m)
    const score = penalty()
    if (score < bestScore) { best = m; bestScore = score }
    applyMask(m)   // le masque est un OU exclusif : réappliqué, il s'annule
  }
  applyMask(best)
  format(best)

  return {
    version: ver,
    size,
    ecl: LEVELS[level],
    mask: best,
    isDark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && at(x, y) === 1,
  }
}

/** Le code en SVG : modules noirs sur fond blanc, `border` modules de marge
 *  (4 pour la norme). Une ligne de modules sombres = un rectangle. */
export function qrSvg(qr, { border = 4 } = {}) {
  const n = qr.size + border * 2
  let d = ''
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.isDark(x, y)) continue
      let w = 1
      while (qr.isDark(x + w, y)) w++
      d += `M${x + border} ${y + border}h${w}v1h-${w}z`
      x += w - 1
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
