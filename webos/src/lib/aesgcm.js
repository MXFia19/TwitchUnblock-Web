// ═══════════════════════════════════════════════════════════════════════════
//  AES-GCM en JavaScript, de secours. La session web envoyée par l'iPhone
//  arrive chiffrée (pairing.js) et se déchiffre d'abord avec WebCrypto
//  (crypto.subtle). Une app installée tourne depuis file:// : si le moteur
//  de la TV n'y donne pas crypto.subtle (contexte jugé non sûr) ou refuse
//  AES-GCM, c'est ceci qui sert.
//
//  AES (FIPS-197) en chiffrement seul — GCM n'emploie que lui —, clés de
//  128, 192 ou 256 bits ; GCM (NIST SP 800-38D) avec un nonce de 12 octets
//  et une étiquette de 16. Octet par octet, sans tables précalculées : lent,
//  mais un paquet fait moins de 4 Ko. Écrit pour TwitchUnblock ; vérifié
//  contre WebCrypto et les vecteurs de test de la norme et du NIST
//  (tools/pair-check.mjs).
// ═══════════════════════════════════════════════════════════════════════════

// ── AES ────────────────────────────────────────────────────────────────────
// S-box : inverse dans GF(2^8) (p · q = 1, p parcourt le groupe par ×3),
// puis la transformation affine.
const SBOX = new Uint8Array(256)
;(() => {
  const rotl = (x, s) => ((x << s) | (x >>> (8 - s))) & 0xff
  let p = 1
  let q = 1
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff
    q = (q ^ (q << 1)) & 0xff
    q = (q ^ (q << 2)) & 0xff
    q = (q ^ (q << 4)) & 0xff
    if (q & 0x80) q ^= 0x09
    SBOX[p] = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63
  } while (p !== 1)
  SBOX[0] = 0x63
})()

const xtime = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff

/** Clés de tour : { w, rounds }. */
function expandKey(key) {
  const nk = key.length / 4
  if (![4, 6, 8].includes(nk)) throw new Error('AES key length')
  const rounds = nk + 6
  const w = new Uint8Array(16 * (rounds + 1))
  w.set(key)
  let rcon = 1
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    let t0 = w[4 * i - 4]
    let t1 = w[4 * i - 3]
    let t2 = w[4 * i - 2]
    let t3 = w[4 * i - 1]
    if (i % nk === 0) {
      const first = t0
      t0 = SBOX[t1] ^ rcon
      t1 = SBOX[t2]
      t2 = SBOX[t3]
      t3 = SBOX[first]
      rcon = xtime(rcon)
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX[t0]
      t1 = SBOX[t1]
      t2 = SBOX[t2]
      t3 = SBOX[t3]
    }
    const k = 4 * (i - nk)
    w[4 * i] = w[k] ^ t0
    w[4 * i + 1] = w[k + 1] ^ t1
    w[4 * i + 2] = w[k + 2] ^ t2
    w[4 * i + 3] = w[k + 3] ^ t3
  }
  return { w, rounds }
}

/** Chiffre un bloc de 16 octets (`input`) dans `out`. État en colonnes :
 *  l'octet de la ligne r, colonne c est à l'indice r + 4c. */
function encryptBlock(ks, input, out) {
  const { w, rounds } = ks
  const s = new Uint8Array(16)
  const t = new Uint8Array(16)
  for (let i = 0; i < 16; i++) s[i] = input[i] ^ w[i]
  for (let round = 1; round <= rounds; round++) {
    // SubBytes et ShiftRows (la ligne r décalée de r vers la gauche).
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) t[r + 4 * c] = SBOX[s[r + 4 * ((c + r) % 4)]]
    }
    // MixColumns, sauf au dernier tour.
    if (round !== rounds) {
      for (let c = 0; c < 16; c += 4) {
        const a0 = t[c]
        const a1 = t[c + 1]
        const a2 = t[c + 2]
        const a3 = t[c + 3]
        const all = a0 ^ a1 ^ a2 ^ a3
        t[c] = a0 ^ all ^ xtime(a0 ^ a1)
        t[c + 1] = a1 ^ all ^ xtime(a1 ^ a2)
        t[c + 2] = a2 ^ all ^ xtime(a2 ^ a3)
        t[c + 3] = a3 ^ all ^ xtime(a3 ^ a0)
      }
    }
    const k = 16 * round
    for (let i = 0; i < 16; i++) s[i] = t[i] ^ w[k + i]
  }
  out.set(s)
}

/** Un bloc chiffré (vecteurs de test de FIPS-197). */
export function aesEncryptBlock(key, block) {
  const out = new Uint8Array(16)
  encryptBlock(expandKey(key), block, out)
  return out
}

// ── GCM ────────────────────────────────────────────────────────────────────
/** 16 octets → 4 mots de 32 bits (gros-boutiste). */
function words(b, at = 0) {
  const out = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    out[i] = ((b[at + 4 * i] << 24) | (b[at + 4 * i + 1] << 16) | (b[at + 4 * i + 2] << 8) | b[at + 4 * i + 3]) >>> 0
  }
  return out
}

/** Produit dans GF(2^128), algorithme 1 de SP 800-38D (bit par bit). */
function gmul(x, h) {
  let z0 = 0
  let z1 = 0
  let z2 = 0
  let z3 = 0
  let v0 = h[0]
  let v1 = h[1]
  let v2 = h[2]
  let v3 = h[3]
  for (let i = 0; i < 128; i++) {
    if ((x[i >>> 5] >>> (31 - (i & 31))) & 1) {
      z0 ^= v0
      z1 ^= v1
      z2 ^= v2
      z3 ^= v3
    }
    const low = v3 & 1
    v3 = (v3 >>> 1) | ((v2 & 1) << 31)
    v2 = (v2 >>> 1) | ((v1 & 1) << 31)
    v1 = (v1 >>> 1) | ((v0 & 1) << 31)
    v0 >>>= 1
    if (low) v0 ^= 0xe1000000
  }
  return [z0 >>> 0, z1 >>> 0, z2 >>> 0, z3 >>> 0]
}

/** GHASH de A (données associées) et C (texte chiffré), longueurs comprises. */
function ghash(h, aad, ct) {
  let y = [0, 0, 0, 0]
  const absorb = (bytes) => {
    const block = new Uint8Array(16)
    for (let i = 0; i < bytes.length; i += 16) {
      block.fill(0)
      block.set(bytes.subarray(i, i + 16))
      const x = words(block)
      y = gmul([y[0] ^ x[0], y[1] ^ x[1], y[2] ^ x[2], y[3] ^ x[3]], h)
    }
  }
  absorb(aad)
  absorb(ct)
  // Longueurs en bits, sur 64 bits chacune.
  const lengths = new Uint8Array(16)
  const put = (at, n) => {
    const hi = Math.floor(n / 0x20000000)
    const lo = (n * 8) % 0x100000000
    for (let i = 0; i < 4; i++) {
      lengths[at + i] = (hi >>> (24 - 8 * i)) & 0xff
      lengths[at + 4 + i] = (lo >>> (24 - 8 * i)) & 0xff
    }
  }
  put(0, aad.length)
  put(8, ct.length)
  absorb(lengths)
  const out = new Uint8Array(16)
  for (let i = 0; i < 4; i++) {
    out[4 * i] = y[i] >>> 24
    out[4 * i + 1] = (y[i] >>> 16) & 0xff
    out[4 * i + 2] = (y[i] >>> 8) & 0xff
    out[4 * i + 3] = y[i] & 0xff
  }
  return out
}

/** Compteur : les 32 derniers bits + 1 (modulo 2^32). */
function inc32(block) {
  for (let i = 15; i >= 12; i--) {
    block[i] = (block[i] + 1) & 0xff
    if (block[i] !== 0) break
  }
}

function gcm(key, iv, input, aad, decrypting) {
  if (!(iv instanceof Uint8Array) || iv.length !== 12) throw new Error('GCM nonce must be 12 bytes')
  const a = aad || new Uint8Array(0)
  if (decrypting && input.length < 16) throw new Error('GCM data too short')
  const ks = expandKey(key)
  const zero = new Uint8Array(16)
  const hBlock = new Uint8Array(16)
  encryptBlock(ks, zero, hBlock)
  const h = words(hBlock)
  const j0 = new Uint8Array(16)
  j0.set(iv)
  j0[15] = 1
  const text = decrypting ? input.subarray(0, input.length - 16) : input
  // Étiquette d'abord (sur le texte chiffré) : rien n'est déchiffré si
  // elle ne correspond pas.
  const s = new Uint8Array(16)
  encryptBlock(ks, j0, s)
  const tagOf = (ct) => {
    const g = ghash(h, a, ct)
    for (let i = 0; i < 16; i++) g[i] ^= s[i]
    return g
  }
  if (decrypting) {
    const expected = tagOf(text)
    const given = input.subarray(input.length - 16)
    let diff = 0
    for (let i = 0; i < 16; i++) diff |= expected[i] ^ given[i]
    if (diff !== 0) throw new Error('GCM tag mismatch')
  }
  // GCTR à partir de inc32(J0).
  const out = new Uint8Array(text.length)
  const counter = j0.slice()
  const stream = new Uint8Array(16)
  for (let i = 0; i < text.length; i += 16) {
    inc32(counter)
    encryptBlock(ks, counter, stream)
    const n = Math.min(16, text.length - i)
    for (let j = 0; j < n; j++) out[i + j] = text[i + j] ^ stream[j]
  }
  if (decrypting) return out
  const result = new Uint8Array(out.length + 16)
  result.set(out)
  result.set(tagOf(out), out.length)
  return result
}

/** Texte chiffré suivi de son étiquette (16 octets), comme WebCrypto. */
export function aesGcmEncrypt(key, iv, plain, aad) {
  return gcm(key, iv, plain, aad, false)
}

/** `data` : texte chiffré suivi de l'étiquette. Lève une erreur si
 *  l'étiquette ne correspond pas (clé, nonce, données associées ou paquet
 *  différents). */
export function aesGcmDecrypt(key, iv, data, aad) {
  return gcm(key, iv, data, aad, true)
}
