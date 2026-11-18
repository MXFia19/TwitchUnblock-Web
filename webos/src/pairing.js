// ═══════════════════════════════════════════════════════════════════════════
//  Session web Twitch envoyée par l'iPhone : protocole v1, côté TV (le même
//  dans l'app iPhone, et dans le Worker pour /api/pair).
//
//  1. La TV tire `id` (16 octets) et `key` (32 octets) au hasard
//     (crypto.getRandomValues), en base64url sans « = » (22 et 43
//     caractères), et montre un QR code :
//       tupair://1?id=<id>&k=<key>&w=<base du Worker, encodée en URL>
//  2. L'iPhone chiffre en AES-256-GCM (nonce de 12 octets au hasard,
//     données associées « tupair/1/<id> ») le JSON
//       {"v":1,"token":"…","login":"…","userId":"…","displayName":"…","sentAt":<ms>}
//     et dépose `blob` = base64url(nonce ‖ texte chiffré ‖ étiquette de 16
//     octets) par POST <w>/api/pair {"id","blob"}.
//  3. La TV relève GET <w>/api/pair?id=<id> toutes les 2 s, 5 minutes au
//     plus ; le Worker ne rend le paquet qu'une fois.
//  La clé ne quitte jamais le QR code : le Worker ne garde qu'un paquet
//  qu'il ne peut ni lire ni modifier sans que la TV le voie (étiquette).
//
//  Rien ici ne touche au réseau, à l'écran ni au stockage :
//  tools/pair-check.mjs le charge tel quel dans Node.
// ═══════════════════════════════════════════════════════════════════════════

import { aesGcmDecrypt } from './lib/aesgcm.js'

export const PAIR_VERSION = 1
/** Durée de validité d'un QR code (et du paquet chez le Worker). */
export const PAIR_TTL_MS = 5 * 60_000
/** Intervalle entre deux relèves. */
export const PAIR_POLL_MS = 2000
export const PAIR_ID_RE = /^[A-Za-z0-9_-]{22}$/

// ── base64url sans « = » ───────────────────────────────────────────────────
export function b64urlEncode(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Lève une erreur si `text` n'est pas du base64url sans « = ». */
export function b64urlDecode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('base64url')
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function randomBytes(n) {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

/** Texte du QR code. */
export const pairQrText = (id, k, workerBase) => `tupair://${PAIR_VERSION}?id=${id}&k=${k}&w=${encodeURIComponent(workerBase)}`

/** Données associées du chiffrement : lient le paquet à cet identifiant. */
export const pairAad = (id) => new TextEncoder().encode(`tupair/${PAIR_VERSION}/${id}`)

/**
 * Nouvel appairage, valable PAIR_TTL_MS : { id, key, workerBase, qrText,
 * expiresAt }. `key` ne sort jamais de cet objet (ni journal, ni stockage) ;
 * forgetPairing l'efface de la mémoire.
 */
export function newPairing(workerBase, now = Date.now()) {
  const id = b64urlEncode(randomBytes(16))
  const key = randomBytes(32)
  return { id, key, workerBase, qrText: pairQrText(id, b64urlEncode(key), workerBase), expiresAt: now + PAIR_TTL_MS }
}

/** Fin d'un appairage (réussi, expiré ou abandonné) : clé mise à zéro, texte
 *  du QR code oublié — le code ne peut plus rien ouvrir. */
export function forgetPairing(p) {
  if (!p) return
  if (p.key) p.key.fill(0)
  p.qrText = ''
  p.expiresAt = 0
}

// ── Ouverture du paquet ────────────────────────────────────────────────────
const LOGIN_RE = /^[a-z0-9_]{1,25}$/
// Jeton de session twitch.tv (cookie auth-token) : 30 caractères
// alphanumériques aujourd'hui ; une marge, mais jamais d'espace ni de
// retour à la ligne (il part dans un en-tête Authorization).
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

/** JSON déchiffré → session { token, login, userId, displayName, sentAt }.
 *  `userId` peut arriver vide (Twitch injoignable depuis l'iPhone au moment
 *  de l'envoi) : la session passe quand même, avec userId '', et la TV le
 *  redemande à Twitch (websession.js, checkWebSession) — rien ne s'en sert
 *  avant. Lève une erreur sans rien recopier du contenu (le jeton
 *  n'apparaît jamais dans un message). */
export function parsePayload(text) {
  let o
  try { o = JSON.parse(text) } catch { throw new Error('payload: not JSON') }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('payload: not an object')
  if (o.v !== PAIR_VERSION) throw new Error('payload: unknown version')
  const token = typeof o.token === 'string' ? o.token.trim() : ''
  if (!TOKEN_RE.test(token)) throw new Error('payload: bad token')
  const login = typeof o.login === 'string' ? o.login.trim().toLowerCase() : ''
  if (!LOGIN_RE.test(login)) throw new Error('payload: bad login')
  const userId = typeof o.userId === 'string' ? o.userId.trim() : typeof o.userId === 'number' ? String(o.userId) : ''
  if (userId && !/^\d{1,20}$/.test(userId)) throw new Error('payload: bad userId')
  // Nom affiché : caractères de contrôle ôtés, 60 au plus ; le login sinon.
  const name = typeof o.displayName === 'string' ? o.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : ''
  const sentAt = Number.isFinite(o.sentAt) ? Number(o.sentAt) : null
  return { token, login, userId, displayName: name || login, sentAt }
}

/**
 * Déchiffre le paquet reçu pour cet appairage et rend la session (voir
 * parsePayload). WebCrypto (`subtle`) s'il existe et accepte AES-GCM ;
 * sinon l'implémentation JavaScript (lib/aesgcm.js). Lève une erreur si le
 * paquet est illisible, falsifié, ou chiffré pour un autre identifiant.
 */
export async function openBlob(pairing, blob, { subtle = globalThis.crypto?.subtle } = {}) {
  const bytes = b64urlDecode(blob)
  if (bytes.length < 12 + 16) throw new Error('blob: too short')
  const iv = bytes.subarray(0, 12)
  const data = bytes.subarray(12)
  const aad = pairAad(pairing.id)
  let plain = null
  let key = null
  if (subtle) {
    try { key = await subtle.importKey('raw', pairing.key, { name: 'AES-GCM' }, false, ['decrypt']) } catch { key = null }
  }
  // Une étiquette refusée par WebCrypto lève ici (OperationError) : le
  // paquet ne s'ouvre pas, la version JavaScript n'y changerait rien.
  if (key) plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, data))
  else plain = aesGcmDecrypt(pairing.key, iv, data, aad)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(plain) } catch { throw new Error('payload: not UTF-8') } finally { plain.fill(0) }
  return parsePayload(text)
}
