// Vérifications de l'envoi de la session web de l'iPhone à l'app TV LG, sans
// réseau ni appareil :
//  - la route /api/pair du Worker (worker.js copié en .mjs, avec une fausse
//    base D1 en mémoire sur node:sqlite : le même SQL qu'en production) ;
//  - le protocole côté TV (webos/src/pairing.js) et l'AES-GCM de secours
//    (webos/src/lib/aesgcm.js), contre WebCrypto et les vecteurs du NIST ;
//  - les codes QR (webos/src/lib/qr.js), relus par OpenCV s'il est installé
//    (python + cv2 ; sinon ce test est sauté) ;
//  - le direct par le compte (webos/src/playback.js).
// L'iPhone est joué ici avec le WebCrypto de Node, comme CryptoKit : blob =
// base64url(nonce ‖ chiffré ‖ étiquette).
// Lancer : node tools/pair-check.mjs (Node 22.13 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { aesEncryptBlock, aesGcmDecrypt, aesGcmEncrypt } from '../webos/src/lib/aesgcm.js'
import { dataCapacity, qrEncode, qrSvg } from '../webos/src/lib/qr.js'
import {
  PAIR_ID_RE, PAIR_TTL_MS, b64urlDecode, b64urlEncode, forgetPairing, newPairing, openBlob, pairAad, parsePayload,
} from '../webos/src/pairing.js'
import { masterLinks, proxyLink, readPlaybackToken, usherLiveUrl } from '../webos/src/playback.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER_BASE = 'https://test2.kurzmathis4.workers.dev'
const hex = (s) => Uint8Array.from((s.match(/../g) || []).map((h) => parseInt(h, 16)))
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const { subtle } = globalThis.crypto

// node:sqlite est encore « expérimental » : son avertissement est tu.
const warn = process.emitWarning
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : warn.call(process, w, ...rest))
const { DatabaseSync } = await import('node:sqlite')

// ── Le Worker, avec une fausse D1 ─────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'tu-pair-'))
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch {} })
const workerFile = join(tmp, 'worker.mjs')
copyFileSync(join(ROOT, 'worker.js'), workerFile)
let imports = 0
/** Une instance neuve du Worker (limites, schéma, réglages en mémoire). */
const freshWorker = async () => (await import(`${pathToFileURL(workerFile).href}?n=${++imports}`)).default

/** Base D1 en mémoire : prepare/bind/first/all/run et batch (transaction),
 *  sur un vrai SQLite. */
function fakeD1() {
  const db = new DatabaseSync(':memory:')
  const plain = (args) => args.map((v) => (typeof v === 'boolean' ? Number(v) : v === undefined ? null : v))
  function exec(sql, args) {
    const st = db.prepare(sql)
    if (/\bRETURNING\b/i.test(sql) || /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
      const results = st.all(...args).map((r) => ({ ...r }))
      const changes = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) ? 0 : Number(db.prepare('SELECT changes() AS c').get().c)
      return { success: true, results, meta: { changes } }
    }
    const r = st.run(...args)
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => statement(sql, plain(a)),
    first: async (col) => {
      const row = exec(sql, args).results[0] ?? null
      return col ? (row ? row[col] : null) : row
    },
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
  })
  return {
    sqlite: db,
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      db.exec('BEGIN')
      try {
        const out = list.map((s) => exec(s.sql, s.args))
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

const ctx = { waitUntil() {}, passThroughOnException() {} }
let ipSeq = 0
const newIp = () => `203.0.113.${++ipSeq}`

function call(worker, env, method, path, { body, ip = '198.51.100.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const init = { method, headers }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  return worker.fetch(new Request(`${WORKER_BASE}${path}`, init), env, ctx)
}

/** Ce que les tests écrivent au journal (console), pour vérifier qu'aucun
 *  paquet, identifiant ni jeton n'y passe. */
const logged = []
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = console[level]
  console[level] = (...a) => { logged.push(a.map(String).join(' ')); return orig.apply(console, a) }
}

// ── L'iPhone (WebCrypto de Node, comme CryptoKit) ─────────────────────────
async function iphoneBlob(id, keyB64, payload) {
  const key = await subtle.importKey('raw', b64urlDecode(keyB64), { name: 'AES-GCM' }, false, ['encrypt'])
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(`tupair/1/${id}`) }, key, new TextEncoder().encode(JSON.stringify(payload))))
  const combined = new Uint8Array(12 + sealed.length)
  combined.set(nonce)
  combined.set(sealed, 12)
  return b64urlEncode(combined)
}

/** Ce que l'iPhone lit dans le QR code. */
function scanQrText(text) {
  const u = new URL(text)
  assert.equal(u.protocol, 'tupair:')
  assert.equal(u.host, '1')
  return { id: u.searchParams.get('id'), k: u.searchParams.get('k'), w: u.searchParams.get('w') }
}

const TOKEN = 'abcdefghij0123456789klmnopqrst'
const PAYLOAD = { v: 1, token: TOKEN, login: 'viewer_one', userId: '123456789', displayName: 'Viewer One', sentAt: 1763500000000 }

// ── AES et AES-GCM ─────────────────────────────────────────────────────────
test('AES : vecteurs de FIPS-197 (128, 192, 256 bits)', () => {
  const pt = hex('00112233445566778899aabbccddeeff')
  assert.equal(toHex(aesEncryptBlock(hex('000102030405060708090a0b0c0d0e0f'), pt)), '69c4e0d86a7b0430d8cdb78070b4c55a')
  assert.equal(toHex(aesEncryptBlock(hex('000102030405060708090a0b0c0d0e0f1011121314151617'), pt)), 'dda97ca4864cdfe06eaf70a0ec0d7191')
  assert.equal(toHex(aesEncryptBlock(hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'), pt)), '8ea2b7ca516745bfeafc49904b496089')
})

test('AES-GCM : vecteurs du NIST (cas 13, 14, 16, AES-256)', () => {
  const zero = (n) => new Uint8Array(n)
  assert.equal(toHex(aesGcmEncrypt(zero(32), zero(12), zero(0), zero(0))), '530f8afbc74536b9a963b4f1c4cb738b')
  assert.equal(toHex(aesGcmEncrypt(zero(32), zero(12), zero(16), zero(0))), 'cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919')
  const K = hex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308')
  const IV = hex('cafebabefacedbaddecaf888')
  const P = hex('d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39')
  const A = hex('feedfacedeadbeeffeedfacedeadbeefabaddad2')
  const C = '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662'
  const T = '76fc6ece0f4e1768cddf8853bb2d551b'
  assert.equal(toHex(aesGcmEncrypt(K, IV, P, A)), C + T)
  assert.equal(toHex(aesGcmDecrypt(K, IV, hex(C + T), A)), toHex(P))
})

test('AES-GCM : comme WebCrypto, et rien ne s’ouvre une fois touché', async () => {
  for (let n = 0; n < 60; n++) {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plain = crypto.getRandomValues(new Uint8Array(Math.floor(Math.random() * 700)))
    const aad = crypto.getRandomValues(new Uint8Array(Math.floor(Math.random() * 60)))
    const k = await subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt'])
    const wc = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k, plain))
    assert.equal(toHex(aesGcmEncrypt(key, iv, plain, aad)), toHex(wc))
    assert.equal(toHex(aesGcmDecrypt(key, iv, wc, aad)), toHex(plain))
    const bad = wc.slice()
    bad[Math.floor(Math.random() * bad.length)] ^= 1 << Math.floor(Math.random() * 8)
    assert.throws(() => aesGcmDecrypt(key, iv, bad, aad), /tag/)
    const otherAad = new Uint8Array([...aad, 1])
    assert.throws(() => aesGcmDecrypt(key, iv, wc, otherAad), /tag/)
  }
})

// ── Codes QR ───────────────────────────────────────────────────────────────
test('QR : capacités de la norme (mode octets)', () => {
  const known = {
    L: { 1: 17, 2: 32, 5: 106, 7: 154, 8: 192, 10: 271, 20: 858, 27: 1465, 40: 2953 },
    M: { 1: 14, 2: 26, 5: 84, 7: 122, 8: 152, 10: 213, 20: 666, 27: 1125, 40: 2331 },
    Q: { 1: 11, 5: 60, 10: 151, 20: 482, 40: 1663 },
    H: { 1: 7, 5: 44, 10: 119, 20: 382, 40: 1273 },
  }
  for (const [lv, row] of Object.entries(known)) {
    for (const [v, chars] of Object.entries(row)) {
      const ver = Number(v)
      const header = 4 + (ver <= 9 ? 8 : 16)
      assert.equal(Math.floor((dataCapacity(ver, 'LMQH'.indexOf(lv)) * 8 - header) / 8), chars, `${lv} v${v}`)
    }
  }
})

test('QR : motifs fixes et information de format', () => {
  const p = newPairing(WORKER_BASE)
  const qr = qrEncode(p.qrText, { ecl: 'M' })
  assert.equal(qr.size, qr.version * 4 + 17)
  assert.ok(qr.version >= 7 && qr.version <= 9, `version ${qr.version}`)
  // Repérage : 7 × 7, anneau clair, centre 3 × 3, aux trois coins.
  for (const [cx, cy] of [[3, 3], [qr.size - 4, 3], [3, qr.size - 4]]) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        assert.equal(qr.isDark(cx + dx, cy + dy), d !== 2, `repérage ${cx},${cy} ${dx},${dy}`)
      }
    }
  }
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.isDark(i, 6), i % 2 === 0)
    assert.equal(qr.isDark(6, i), i % 2 === 0)
  }
  assert.equal(qr.isDark(8, qr.size - 8), true)
  // Les deux copies du format disent la même chose : niveau et masque.
  const first = []
  for (let i = 0; i <= 5; i++) first.push(qr.isDark(8, i))
  first.push(qr.isDark(8, 7), qr.isDark(8, 8), qr.isDark(7, 8))
  for (let i = 9; i < 15; i++) first.push(qr.isDark(14 - i, 8))
  const second = []
  for (let i = 0; i < 8; i++) second.push(qr.isDark(qr.size - 1 - i, 8))
  for (let i = 8; i < 15; i++) second.push(qr.isDark(8, qr.size - 15 + i))
  assert.deepEqual(first, second)
  const bits = first.reduce((n, b, i) => n | (Number(b) << i), 0) ^ 0x5412
  assert.equal(bits >>> 10, (0 << 3) | qr.mask, 'niveau M (00) et masque')
  assert.match(qrSvg(qr), /^<svg [^>]*viewBox="0 0 \d+ \d+"[^>]*>.*<\/svg>$/)
  assert.throws(() => qrEncode('x'.repeat(3000), { ecl: 'L' }), RangeError)
})

/** Python avec OpenCV, s'il est là : une fonction qui relit des images PGM.
 *  Lancé depuis le dossier temporaire de ce test (rien d'autre n'y est),
 *  sans -I : OpenCV est souvent installé dans les paquets de l'utilisateur. */
function opencvReader() {
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const run = (code, input) => spawnSync(py, ['-c', code], { cwd: tmp, input, encoding: 'utf8' })
  const probe = run('import cv2; print(cv2.__version__)')
  if (probe.status !== 0) return null
  return (files) => {
    const code = `import cv2, json, sys
files = json.loads(sys.stdin.read())
out = []
for f in files:
    img = cv2.imread(f, cv2.IMREAD_GRAYSCALE)
    t = cv2.QRCodeDetector().detectAndDecode(img)[0]
    if not t and hasattr(cv2, 'QRCodeDetectorAruco'):
        t = cv2.QRCodeDetectorAruco().detectAndDecode(img)[0]
    out.append(t)
print(json.dumps(out))`
    const r = run(code, JSON.stringify(files))
    if (r.status !== 0) throw new Error(r.stderr)
    return JSON.parse(r.stdout)
  }
}
const readQr = opencvReader()

/** Image PGM d'un code (marge de 4 modules), `scale` pixels par module. */
function pgm(qr, file, scale) {
  const n = (qr.size + 8) * scale
  const px = Buffer.alloc(n * n, 255)
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.isDark(x, y)) continue
      for (let dy = 0; dy < scale; dy++) px.fill(0, ((y + 4) * scale + dy) * n + (x + 4) * scale, ((y + 4) * scale + dy) * n + (x + 5) * scale)
    }
  }
  writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), px]))
}

test('QR : relu par un vrai lecteur (OpenCV)', { skip: readQr ? false : 'python + opencv absents' }, () => {
  const rnd = (n) => b64urlEncode(crypto.getRandomValues(new Uint8Array(n))).slice(0, n)
  const texts = [
    newPairing(WORKER_BASE).qrText,
    newPairing('https://my-own-worker.example.workers.dev').qrText,
    newPairing('http://localhost:8787').qrText,
    rnd(10), rnd(60), rnd(250), rnd(700),
  ]
  const cases = []
  for (const text of texts) {
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      const qr = qrEncode(text, { ecl, boost: false })
      // Deux tailles par code : le lecteur d'OpenCV en rate parfois une.
      const files = [4, 7].map((scale) => { const f = join(tmp, `qr${cases.length}-${scale}.pgm`); pgm(qr, f, scale); return f })
      cases.push({ text, ecl, version: qr.version, files })
    }
  }
  const read = readQr(cases.flatMap((c) => c.files))
  cases.forEach((c, i) => {
    assert.ok(read[2 * i] === c.text || read[2 * i + 1] === c.text, `${c.ecl} v${c.version} (${c.text.length} car.) illisible`)
  })
})

// ── Protocole côté TV ─────────────────────────────────────────────────────
test('appairage : identifiant, clé, texte du QR code', () => {
  const a = newPairing(WORKER_BASE, 1000)
  const b = newPairing(WORKER_BASE, 1000)
  assert.match(a.id, PAIR_ID_RE)
  assert.equal(a.key.length, 32)
  assert.notEqual(a.id, b.id)
  assert.notEqual(toHex(a.key), toHex(b.key))
  assert.equal(a.expiresAt, 1000 + PAIR_TTL_MS)
  const s = scanQrText(a.qrText)
  assert.equal(s.id, a.id)
  assert.match(s.k, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(toHex(b64urlDecode(s.k)), toHex(a.key))
  assert.equal(s.w, WORKER_BASE)
  assert.ok(a.qrText.includes(`&w=${encodeURIComponent(WORKER_BASE)}`))
  assert.equal(new TextDecoder().decode(pairAad(a.id)), `tupair/1/${a.id}`)
  forgetPairing(a)
  assert.equal(toHex(a.key), '00'.repeat(32))
  assert.equal(a.qrText, '')
})

test('base64url sans « = »', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = crypto.getRandomValues(new Uint8Array(n))
    const s = b64urlEncode(bytes)
    assert.match(s, /^[A-Za-z0-9_-]*$/)
    assert.equal(s, Buffer.from(bytes).toString('base64url'))
    assert.equal(toHex(b64urlDecode(s)), toHex(bytes))
  }
  for (const bad of ['ab=c', 'a+bc', 'a/bc', 'abcde', 'ab c']) assert.throws(() => b64urlDecode(bad))
})

test('contenu : champs contrôlés, userId vide accepté, jamais le jeton dans une erreur', () => {
  const ok = parsePayload(JSON.stringify(PAYLOAD))
  assert.deepEqual(ok, { token: TOKEN, login: 'viewer_one', userId: '123456789', displayName: 'Viewer One', sentAt: PAYLOAD.sentAt })
  // Twitch injoignable depuis l'iPhone : userId vide, nom = login.
  const noId = parsePayload(JSON.stringify({ ...PAYLOAD, userId: '', displayName: 'viewer_one' }))
  assert.equal(noId.userId, '')
  assert.equal(noId.displayName, 'viewer_one')
  assert.equal(parsePayload(JSON.stringify({ ...PAYLOAD, userId: 42 })).userId, '42')
  assert.equal(parsePayload(JSON.stringify({ ...PAYLOAD, login: 'Viewer_One' })).login, 'viewer_one')
  assert.equal(parsePayload(JSON.stringify({ ...PAYLOAD, displayName: '  ' })).displayName, 'viewer_one')
  assert.equal(parsePayload(JSON.stringify({ ...PAYLOAD, displayName: 'a\nb\u0007c' })).displayName, 'abc')
  const bad = [
    { ...PAYLOAD, v: 2 }, { ...PAYLOAD, token: `${TOKEN}\r\nX-Evil: 1` }, { ...PAYLOAD, token: 'short' },
    { ...PAYLOAD, token: `${TOKEN} x` }, { ...PAYLOAD, login: 'not a login' }, { ...PAYLOAD, userId: '12a' },
    { ...PAYLOAD, token: undefined },
  ]
  for (const o of bad) {
    assert.throws(() => parsePayload(JSON.stringify(o)), (e) => !String(e.message).includes(TOKEN.slice(0, 10)))
  }
  assert.throws(() => parsePayload('not json'))
  assert.throws(() => parsePayload('[1]'))
})

test('ouverture du paquet : WebCrypto et secours JavaScript, falsification refusée', async () => {
  const p = newPairing(WORKER_BASE)
  const { id, k } = scanQrText(p.qrText)
  const blob = await iphoneBlob(id, k, PAYLOAD)
  const viaSubtle = await openBlob(p, blob)
  const viaJs = await openBlob(p, blob, { subtle: null })
  assert.deepEqual(viaSubtle, viaJs)
  assert.equal(viaSubtle.token, TOKEN)
  assert.equal(viaSubtle.displayName, 'Viewer One')
  // Un octet changé, n'importe où : refusé, par les deux chemins.
  const raw = b64urlDecode(blob)
  for (const at of [0, 11, 12, raw.length - 17, raw.length - 1]) {
    const bad = raw.slice()
    bad[at] ^= 0x01
    await assert.rejects(openBlob(p, b64urlEncode(bad)))
    await assert.rejects(openBlob(p, b64urlEncode(bad), { subtle: null }))
  }
  // Chiffré pour un autre identifiant (données associées) : refusé.
  const other = newPairing(WORKER_BASE)
  other.key.set(p.key)
  await assert.rejects(openBlob(other, blob))
  await assert.rejects(openBlob(other, blob, { subtle: null }))
  await assert.rejects(openBlob(p, 'AAAA'))
  await assert.rejects(openBlob(p, 'not base64url!'))
  // Clé effacée (code abandonné) : plus rien ne s'ouvre.
  forgetPairing(p)
  await assert.rejects(openBlob(p, blob))
})

// ── Worker : /api/pair ─────────────────────────────────────────────────────
const validBlob = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(200)))
const validId = () => newPairing(WORKER_BASE).id

test('Worker : dépôt, relève unique, en-têtes CORS', async () => {
  const worker = await freshWorker()
  const env = { DB: fakeD1() }
  const ip = newIp()
  const opt = await call(worker, env, 'OPTIONS', '/api/pair', { ip })
  assert.equal(opt.status, 200)
  assert.equal(opt.headers.get('Access-Control-Allow-Origin'), '*')
  assert.match(opt.headers.get('Access-Control-Allow-Methods'), /POST/)
  assert.match(opt.headers.get('Access-Control-Allow-Headers'), /Content-Type/)
  const id = validId()
  const blob = validBlob()
  assert.equal((await call(worker, env, 'GET', `/api/pair?id=${id}`, { ip })).status, 404)
  const put = await call(worker, env, 'POST', '/api/pair', { body: { id, blob }, ip })
  assert.equal(put.status, 200)
  assert.deepEqual(await put.json(), { ok: true })
  assert.equal(put.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(put.headers.get('Cache-Control'), 'no-store')
  const got = await call(worker, env, 'GET', `/api/pair?id=${id}`, { ip })
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(got.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await got.json(), { blob })
  // Une seule fois : ensuite 404, et l'identifiant ne resert pas (409).
  assert.equal((await call(worker, env, 'GET', `/api/pair?id=${id}`, { ip })).status, 404)
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id, blob: validBlob() }, ip })).status, 409)
  assert.equal((await call(worker, env, 'GET', `/api/pair?id=${id}`, { ip })).status, 404)
  // Le paquet est vraiment effacé de la base, pas seulement caché.
  const row = env.DB.sqlite.prepare('SELECT value, meta FROM kv WHERE key = ?').get(`tvpair_${id}`)
  assert.equal(row.value, '')
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM kv WHERE value LIKE '%' || ? || '%'").get(blob.slice(0, 40)).n, 0)
  // Même identifiant déposé deux fois avant la relève : 409, le premier reste.
  const id2 = validId()
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: id2, blob }, ip })).status, 200)
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: id2, blob: validBlob() }, ip })).status, 409)
  assert.deepEqual(await (await call(worker, env, 'GET', `/api/pair?id=${id2}`, { ip })).json(), { blob })
})

test('Worker : requêtes invalides (400, 405, 413)', async () => {
  const worker = await freshWorker()
  const env = { DB: fakeD1() }
  const post = (body) => call(worker, env, 'POST', '/api/pair', { body, ip: newIp() })
  const id = validId()
  assert.equal((await post('not json')).status, 400)
  assert.equal((await post([id, validBlob()])).status, 400)
  assert.equal((await post({ blob: validBlob() })).status, 400)
  assert.equal((await post({ id: `${id}x`, blob: validBlob() })).status, 400)
  assert.equal((await post({ id: id.slice(1), blob: validBlob() })).status, 400)
  assert.equal((await post({ id: `${id.slice(0, 21)}=`, blob: validBlob() })).status, 400)
  assert.equal((await post({ id, blob: 42 })).status, 400)
  assert.equal((await post({ id, blob: `${validBlob()}=` })).status, 400)
  assert.equal((await post({ id, blob: `a+b/${validBlob()}` })).status, 400)
  assert.equal((await post({ id, blob: 'A'.repeat(37) })).status, 400)
  assert.equal((await post({ id, blob: 'A'.repeat(41) })).status, 400)   // longueur ≡ 1 (mod 4)
  assert.equal((await post({ id, blob: 'A'.repeat(4097) })).status, 413)
  assert.equal((await post(`{"id":"${id}","blob":"${'A'.repeat(4096)}","pad":"${'x'.repeat(400)}"}`)).status, 413)
  assert.equal((await post({ id, blob: 'A'.repeat(4096) })).status, 200)   // la limite exacte passe
  assert.equal((await call(worker, env, 'GET', '/api/pair?id=short', { ip: newIp() })).status, 400)
  assert.equal((await call(worker, env, 'GET', '/api/pair', { ip: newIp() })).status, 400)
  assert.equal((await call(worker, env, 'PUT', '/api/pair', { body: { id, blob: validBlob() }, ip: newIp() })).status, 405)
  assert.equal((await call(worker, env, 'DELETE', `/api/pair?id=${id}`, { ip: newIp() })).status, 405)
  // Sans base D1 (Worker de secours) : 503, rien d'écrit nulle part.
  assert.equal((await call(worker, {}, 'POST', '/api/pair', { body: { id: validId(), blob: validBlob() }, ip: newIp() })).status, 503)
  assert.equal((await call(worker, {}, 'GET', `/api/pair?id=${validId()}`, { ip: newIp() })).status, 503)
})

test('Worker : 5 minutes au plus', async () => {
  const worker = await freshWorker()
  const env = { DB: fakeD1() }
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  try {
    const ip = newIp()
    const a = validId()
    const b = validId()
    const blob = validBlob()
    assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: a, blob }, ip })).status, 200)
    assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: b, blob }, ip })).status, 200)
    offset = 299_000
    assert.equal((await call(worker, env, 'GET', `/api/pair?id=${a}`, { ip })).status, 200)
    offset = 301_000
    assert.equal((await call(worker, env, 'GET', `/api/pair?id=${b}`, { ip })).status, 404)
    // Le ménage du dépôt suivant efface les paquets et marques expirés.
    assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: validId(), blob }, ip })).status, 200)
    const left = env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM kv WHERE key >= 'tvpair_' AND key < 'tvpair`'").get().n
    assert.equal(left, 1)
    // Expiré, l'identifiant peut resservir (la TV l'a abandonné depuis longtemps).
    assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: b, blob }, ip })).status, 200)
  } finally {
    Date.now = realNow
  }
})

test('Worker : limites par adresse et plafond global (429)', async () => {
  const worker = await freshWorker()
  const env = { DB: fakeD1() }
  const ip = newIp()
  for (let i = 0; i < 10; i++) {
    assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: validId(), blob: validBlob() }, ip })).status, 200)
  }
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: validId(), blob: validBlob() }, ip })).status, 429)
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: validId(), blob: validBlob() }, ip: newIp() })).status, 200)
  // IPv6 : tout le /64 compte pour une seule adresse.
  const v6 = (n) => `2001:db8:1:2::${n.toString(16)}`
  for (let i = 0; i < 10; i++) await call(worker, env, 'POST', '/api/pair', { body: { id: validId(), blob: validBlob() }, ip: v6(i + 1) })
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: validId(), blob: validBlob() }, ip: v6(99) })).status, 429)
  // Relèves : 75 par minute (la TV en fait 30).
  const tv = newIp()
  const id = validId()
  for (let i = 0; i < 75; i++) assert.equal((await call(worker, env, 'GET', `/api/pair?id=${id}`, { ip: tv })).status, 404)
  assert.equal((await call(worker, env, 'GET', `/api/pair?id=${id}`, { ip: tv })).status, 429)
  // Plafond de paquets en attente pour tout le Worker.
  const db = env.DB.sqlite
  const insert = db.prepare('INSERT INTO kv (key, value, expires) VALUES (?, ?, ?)')
  for (let i = 0; i < 500; i++) insert.run(`tvpair_${String(i).padStart(22, '0')}`, 'x', Date.now() + 60_000)
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id: validId(), blob: validBlob() }, ip: newIp() })).status, 429)
})

test('Worker : deux relèves en même temps, un seul gagnant', async () => {
  const worker = await freshWorker()
  const env = { DB: fakeD1() }
  const id = validId()
  const blob = validBlob()
  assert.equal((await call(worker, env, 'POST', '/api/pair', { body: { id, blob }, ip: newIp() })).status, 200)
  const res = await Promise.all([1, 2, 3].map(() => call(worker, env, 'GET', `/api/pair?id=${id}`, { ip: newIp() })))
  assert.deepEqual(res.map((r) => r.status).sort(), [200, 404, 404])
})

test('de bout en bout : la TV montre le code, l’iPhone l’envoie, la TV l’ouvre', async () => {
  const worker = await freshWorker()
  const env = { DB: fakeD1() }
  // La TV : nouveau code, et sa première relève (rien encore).
  const tv = newPairing(WORKER_BASE)
  const tvIp = newIp()
  const poll = () => call(worker, env, 'GET', `/api/pair?id=${encodeURIComponent(tv.id)}`, { ip: tvIp })
  assert.equal((await poll()).status, 404)
  // L'iPhone lit le QR code (relu par OpenCV quand il est là), chiffre et dépose.
  let text = tv.qrText
  if (readQr) {
    const f = join(tmp, 'e2e.pgm')
    pgm(qrEncode(tv.qrText, { ecl: 'M' }), f, 10)
    text = readQr([f])[0]
    assert.equal(text, tv.qrText)
  }
  const scan = scanQrText(text)
  assert.equal(scan.w, WORKER_BASE)
  // userId vide : envoyé quand Twitch ne répondait pas à l'iPhone.
  const payload = { ...PAYLOAD, userId: '', displayName: PAYLOAD.login, sentAt: Date.now() }
  const blob = await iphoneBlob(scan.id, scan.k, payload)
  const put = await call(worker, env, 'POST', '/api/pair', { body: { id: scan.id, blob }, ip: newIp() })
  assert.equal(put.status, 200)
  // La TV relève, ouvre, et le code ne sert plus.
  const got = await poll()
  assert.equal(got.status, 200)
  const session = await openBlob(tv, (await got.json()).blob)
  assert.deepEqual(session, { token: TOKEN, login: PAYLOAD.login, userId: '', displayName: PAYLOAD.login, sentAt: payload.sentAt })
  forgetPairing(tv)
  assert.equal((await poll()).status, 404)
  // Jamais au journal : ni paquet, ni identifiant, ni clé, ni jeton.
  const all = logged.join('\n')
  for (const secret of [blob.slice(0, 30), scan.id, scan.k, TOKEN]) assert.ok(!all.includes(secret), 'trouvé au journal')
})

// ── Direct par le compte ───────────────────────────────────────────────────
test('jeton de lecture du compte : sans pub, abonné, anonyme, refusé', () => {
  const sub = readPlaybackToken(JSON.stringify({ user_id: 123, subscriber: true, turbo: false, hide_ads: true, show_ads: false, authorization: { forbidden: false, reason: '' }, maximum_resolution: 'FULL_HD' }))
  assert.equal(sub.adFree, true)
  assert.equal(sub.subscriber, true)
  assert.equal(sub.anonymous, false)
  assert.equal(sub.forbidden, false)
  assert.equal(sub.maxResolution, 'FULL_HD')
  // Turbo seul, pubs annoncées : pas sans pub (la chaîne peut refuser Turbo).
  const turbo = readPlaybackToken(JSON.stringify({ user_id: 123, subscriber: false, turbo: true, hide_ads: false, show_ads: true }))
  assert.equal(turbo.adFree, false)
  assert.equal(readPlaybackToken(JSON.stringify({ user_id: 123, show_ads: false })).adFree, true)
  const anon = readPlaybackToken(JSON.stringify({ user_id: null, hide_ads: false, show_ads: true }))
  assert.equal(anon.anonymous, true)
  const geo = readPlaybackToken(JSON.stringify({ user_id: 1, hide_ads: true, authorization: { forbidden: true, reason: 'Content geo restricted' } }))
  assert.equal(geo.forbidden, true)
  assert.equal(geo.geo, 'Content geo restricted')
  assert.equal(readPlaybackToken('{broken').adFree, false)
})

test('adresse d’usher et liens par le proxy', () => {
  const token = { value: '{"user_id":1,"channel":"x"}', signature: 'abc123' }
  const u = new URL(usherLiveUrl('Some_Channel', token, { lowLatency: false }))
  assert.equal(u.host, 'usher.ttvnw.net')
  assert.equal(u.pathname, '/api/channel/hls/some_channel.m3u8')
  assert.equal(u.searchParams.get('token'), token.value)
  assert.equal(u.searchParams.get('sig'), 'abc123')
  assert.equal(u.searchParams.get('low_latency'), 'false')
  assert.equal(u.searchParams.get('allow_source'), 'true')
  assert.equal(new URL(usherLiveUrl('x', token)).searchParams.get('fast_bread'), 'true')
  assert.equal(usherLiveUrl('bad name', token), null)
  assert.equal(usherLiveUrl('ok', { value: 'v' }), null)
  const link = proxyLink('https://relais.example', u.href)
  assert.equal(new URL(link).searchParams.get('url'), u.href)
  assert.equal(new URL(link).searchParams.get('isVod'), 'false')
})

test('liste maîtresse du compte → qualités nommées comme le Worker', () => {
  const p = (q) => `https://relais.example/api/proxy?url=${encodeURIComponent(`https://video-weaver.example.hls.ttvnw.net/v1/playlist/${q}.m3u8`)}&isVod=false`
  const master = [
    '#EXTM3U',
    '#EXT-X-TWITCH-INFO:NODE="video-edge-x",MANIFEST-NODE-TYPE="weaver_cluster"',
    '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES',
    '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000',
    p('chunked'),
    '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="480p30",NAME="480p",AUTOSELECT=YES,DEFAULT=YES',
    '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=852x480,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="480p30",FRAME-RATE=30.000',
    p('480p30'),
    '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES',
    '#EXT-X-STREAM-INF:BANDWIDTH=3400000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="720p60",FRAME-RATE=60.000',
    p('720p60'),
    '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="audio_only",NAME="audio_only",AUTOSELECT=NO,DEFAULT=NO',
    '#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"',
    p('audio_only'),
  ].join('\n')
  const masterUrl = 'https://relais.example/api/proxy?url=master&isVod=false'
  const { links, variants } = masterLinks(master, masterUrl)
  assert.deepEqual(Object.keys(links), ['Auto', 'Source', '720p60', '480p30', 'audio_only'])
  assert.equal(links.Auto, masterUrl)
  assert.equal(links.Source, p('chunked'))
  assert.deepEqual(variants.Source, { h: 1080, fps: 60, bw: 8000000 })
  assert.deepEqual(variants['720p60'], { h: 720, fps: 60, bw: 3400000 })
  // Format IVS (STABLE-VARIANT-ID) : une seule variante « source ».
  const ivs = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.0,STABLE-VARIANT-ID="1080p60",IVS-VARIANT-SOURCE="source"',
    p('1080p60'),
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.0,STABLE-VARIANT-ID="720p60",IVS-VARIANT-SOURCE="transcode"',
    p('720p60'),
  ].join('\n')
  assert.deepEqual(Object.keys(masterLinks(ivs, masterUrl).links), ['Auto', 'Source', '720p60'])
  assert.deepEqual(Object.keys(masterLinks('', masterUrl).links), ['Auto'])
})
