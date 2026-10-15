// ═══════════════════════════════════════════════════════════════════════════
//  Relais vidéo sur un serveur à soi (un VPS).
//
//  Sur le site, la lecture passe par le relais du Worker (/api/proxy) :
//  chaque segment de VOD, la playlist d'un direct toutes les ~2 s. C'est
//  presque tout le quota de requêtes de Cloudflare. Ce serveur fait la même
//  chose — il exécute la même fonction, celle de worker.js —, sans quota.
//  Le Worker garde tout le reste (comptes, sauvegardes, comptage, annonces).
//
//  Seules /api/proxy et /health sont servies. Le site s'en sert quand
//  `relayUrl` est configuré (api.js) et repasse par le Worker si ce serveur
//  ne répond pas. Et /ntfy : les notifications de l'app iOS, que le Worker
//  confie à ce serveur (plus bas).
//
//  Il tourne dans l'image Docker du site (même worker.js) :
//    node /app/relay.mjs        voir relay/docker-compose.yml et le README
//
//  Variables :
//    RELAY_PORT       port d'écoute (8788). Pas PORT : l'image le fixe déjà
//                     à 8787 pour le site, le relais s'y mettait.
//    PUBLIC_ORIGIN    adresse publique (https://relais.exemple.fr), utilisée
//                     dans les playlists réécrites ; mal formée, le relais
//                     ne démarre pas
//    ALLOWED_ORIGINS  sites autorisés, séparés par des virgules ; « * » dans
//                     un nom en remplace une partie
//                     (https://test2-*-mxfia19s-projects.vercel.app).
//                     Vide = tous.
//    NTFY_WORKER      Worker dont ce serveur publie les notifications ntfy ;
//                     sa clé publique est lue sur NTFY_WORKER/api/push/key.
//                     Par défaut le Worker officiel ; vide = /ntfy coupée.
//    DISCORD_BOT_TOKEN, FEEDBACK_BOT_SECRET, FEEDBACK_WORKER, DISCORD_ADMIN_IDS
//                     pont Discord des retours (discord-bot.mjs) : répondre
//                     aux retours et changer leur état depuis Discord. Sans
//                     jeton, coupé.
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import { createHash, webcrypto } from 'node:crypto'
import { Readable, pipeline as pipe } from 'node:stream'
import { pipeline } from 'node:stream/promises'
// worker.js, copié en .mjs dans l'image : Node le lit alors sans hésiter
// comme un module (export default).
import worker from './worker.mjs'

const PORT = Number(process.env.RELAY_PORT) || 8788
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '')
// Adresse publique mal formée (« https:// » quand RELAY_DOMAIN manque dans le
// .env) : chaque requête, /health comprise, finissait en 502 sans un mot dans
// le journal. Mieux vaut ne pas démarrer, en disant pourquoi.
if (PUBLIC_ORIGIN) {
  let ok = false
  try { const u = new URL(PUBLIC_ORIGIN); ok = /^https?:$/.test(u.protocol) && Boolean(u.hostname) } catch {}
  if (!ok) {
    console.error(`PUBLIC_ORIGIN invalide (« ${PUBLIC_ORIGIN} ») : mettre RELAY_DOMAIN=… dans le fichier .env (README, « Video relay »).`)
    process.exit(1)
  }
}
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean)
  .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`, 'i'))

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  'Access-Control-Max-Age': '86400',
}

/** Un autre site ne se sert pas du relais (ni de sa bande passante) : son
 *  origine est refusée. Sans en-tête Origin (lecteur natif de Safari, VLC),
 *  la requête passe. */
const originOk = (o) => !o || !ALLOWED.length || ALLOWED.some((re) => re.test(o))

// ── Notifications ntfy de l'app iOS ────────────────────────────────────────
// ntfy.sh compte les messages par adresse IP (250 par jour) ; les Workers
// Cloudflare sortent tous par les mêmes adresses, déjà à court : ntfy.sh leur
// répond 429. Le Worker confie donc ses messages à ce serveur (POST /ntfy,
// par lots), qui les publie depuis sa propre adresse. Un lot n'est accepté
// que signé par la clé VAPID du Worker (jeton ES256 : empreinte du corps,
// expiration à 5 minutes, un seul usage). La clé publique est lue chez le
// Worker, jamais dans la requête.
const NTFY_WORKER = (process.env.NTFY_WORKER ?? 'https://test2.kurzmathis4.workers.dev').trim().replace(/\/+$/, '')
const NTFY_URL = 'https://ntfy.sh'
const NTFY_TOPIC = /^tu-[a-z0-9]{20,40}$/
const NTFY_MAX = 50                // messages par lot
const NTFY_BODY_MAX = 64 * 1024    // octets

let workerKey = null               // { key, at } : clé publique du Worker
const usedTokens = new Map()       // en-tête.revendications.r → expiration (secondes)

/** Clé publique du Worker, gardée. Relue quand une signature ne passe pas
 *  (clé changée), une fois par minute au plus. */
async function trustedKey(refresh) {
  if (workerKey && (!refresh || Date.now() - workerKey.at < 60_000)) return workerKey.key
  const r = await fetch(`${NTFY_WORKER}/api/push/key`, { signal: AbortSignal.timeout(10_000) })
  const { key } = await r.json()
  workerKey = {
    key: await webcrypto.subtle.importKey('raw', Buffer.from(key, 'base64url'),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
    at: Date.now(),
  }
  return workerKey.key
}

/** Jeton « Bearer en-tête.revendications.signature » du Worker pour ce corps. */
async function signedByWorker(auth, body) {
  const m = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(auth || '')
  if (!m) return false
  const [, header, claims, sig] = m
  let alg, c
  try {
    alg = JSON.parse(Buffer.from(header, 'base64url')).alg
    c = JSON.parse(Buffer.from(claims, 'base64url'))
  } catch { return false }
  const now = Math.floor(Date.now() / 1000)
  // Un jeton se reconnaît à ce qu'il signe (empreinte du corps, expiration,
  // identifiant jti des Workers récents) et à r, la première moitié de sa
  // signature. Une signature ECDSA a deux formes valides, (r, s) et (r, n−s) :
  // même r, la seconde est un rejeu. Une nouvelle signature du même contenu a
  // un autre r : deux lots identiques signés dans la même seconde par un
  // Worker sans jti (deux appuis sur « Tester ») ne passent plus pour un rejeu.
  const signed = `${header}.${claims}`
  const id = `${signed}.${Buffer.from(sig, 'base64url').subarray(0, 32).toString('base64url')}`
  if (alg !== 'ES256' || !(c?.exp > now && c.exp <= now + 600) || usedTokens.has(id)) return false
  if (c.sha !== createHash('sha256').update(body).digest('base64url')) return false
  // Retenu avant la moindre attente : deux requêtes simultanées avec le même
  // jeton passaient toutes les deux. Libéré si la signature ne tient pas.
  for (const [s, exp] of usedTokens) if (exp <= now) usedTokens.delete(s)
  usedTokens.set(id, c.exp)
  const verify = async (key) => webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    Buffer.from(sig, 'base64url'), Buffer.from(signed))
  let ok = false
  try {
    ok = (await verify(await trustedKey(false))) || (await verify(await trustedKey(true)))
  } finally {
    if (!ok) usedTokens.delete(id)
  }
  return ok
}

/** Publie les messages un par un ; après un refus (429), le reste attend.
 *  Pour chacun : { status } de ntfy.sh (0 : injoignable) et le code
 *  d'erreur d'un 429 (42908 : quota du jour). */
async function publishNtfy(messages) {
  const results = []
  for (const m of messages) {
    if (results.at(-1)?.status === 429) { results.push(results.at(-1)); continue }
    if (!NTFY_TOPIC.test(String(m?.topic ?? ''))) { results.push({ status: 400, code: 0 }); continue }
    // Champs connus seulement ; un clic n'ouvre que l'app.
    const msg = {
      topic: m.topic,
      title: String(m.title ?? '').slice(0, 200),
      message: String(m.message ?? '').slice(0, 1000),
      priority: Math.min(5, Math.max(1, Math.round(Number(m.priority)) || 3)),
    }
    if (typeof m.click === 'string' && m.click.startsWith('twitchunblock://')) msg.click = m.click.slice(0, 300)
    if (Array.isArray(m.tags)) msg.tags = m.tags.slice(0, 5).map((t) => String(t).slice(0, 40))
    try {
      const r = await fetch(NTFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(15_000),
      })
      const text = await r.text().catch(() => '')
      let code = 0
      if (r.status === 429) try { code = Number(JSON.parse(text).code) || 0 } catch {}
      results.push({ status: r.status, code })
    } catch {
      results.push({ status: 0, code: 0 })
    }
  }
  return results
}

/** Corps de la requête, null au-delà de `max` octets. */
async function readBody(req, max) {
  if (Number(req.headers['content-length']) > max) return null
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > max) return null
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

async function handleNtfy(req, res) {
  if (!NTFY_WORKER) { res.writeHead(404); return res.end() }
  if (req.method !== 'POST') { res.writeHead(405); return res.end() }
  const body = await readBody(req, NTFY_BODY_MAX)
  if (!body) { res.writeHead(413); return res.end() }
  if (!(await signedByWorker(req.headers.authorization, body))) {
    console.warn('ntfy : lot refusé (signature)')
    res.writeHead(403)
    return res.end('Bad signature')
  }
  let messages
  try { messages = JSON.parse(body).messages } catch {}
  if (!Array.isArray(messages) || !messages.length || messages.length > NTFY_MAX) { res.writeHead(400); return res.end() }
  const results = await publishNtfy(messages)
  const sent = results.filter((r) => r.status >= 200 && r.status < 300).length
  const other = results.filter((r) => r.status < 200 || r.status >= 300).map((r) => r.code || r.status)
  console.log(`ntfy : ${sent}/${results.length} publié(s)${other.length ? `, refus ${[...new Set(other)].join(' ')}` : ''}`)
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ results }))
}

// ── Vidéo : accès à l'amont ────────────────────────────────────────────────
// Le proxy (worker.js) suit lui-même les redirections et revérifie chaque
// adresse (https, hôtes de Twitch et des sources). Ici, en plus : jamais de
// connexion vers une adresse interne du serveur — boucle locale, réseau privé
// du VPS, passerelle Docker et conteneurs voisins, service de métadonnées du
// cloud (169.254.169.254) —, vérifiée au moment même de la connexion (une
// réponse DNS qui changerait entre la vérification et l'accès ne passe pas).
// Une redirection de l'amont pouvait y mener (SSRF).
const INTERNAL = new net.BlockList()
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) {
  INTERNAL.addSubnet(a, p, 'ipv4')
  // La même plage vue par le NAT64 du réseau (64:ff9b::<IPv4>, VPS en IPv6
  // seulement) : une IPv4 publique y passe toujours, une interne non.
  const [w, x, y, z] = a.split('.').map(Number)
  INTERNAL.addSubnet(`64:ff9b::${((w << 8) | x).toString(16)}:${((y << 8) | z).toString(16)}`, 96 + p, 'ipv6')
}
// IPv6 : boucle locale et IPv4 « compatible » (::/96, obsolète), réseaux
// privés, lien local, multicast, et les traductions d'IPv4 qu'on ne sait pas
// relire — NAT64 local (64:ff9b:1::/48), Teredo (2001::/32), 6to4
// (2002::/16) — dont aucun CDN ne se sert. Une IPv4 mappée (::ffff:…) est
// comparée par BlockList aux plages IPv4.
for (const [a, p] of [['::', 96], ['64:ff9b:1::', 48], ['2001::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  INTERNAL.addSubnet(a, p, 'ipv6')
}

function internalAddress(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  try {
    return mapped ? INTERNAL.check(mapped[1], 'ipv4') : INTERNAL.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4')
  } catch { return true }
}

/** dns.lookup, sans aucune adresse interne. */
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return callback(err)
    const bad = list.find((a) => internalAddress(a.address))
    if (bad || !list.length) {
      return callback(Object.assign(new Error(`${hostname} : adresse interne refusée (${bad?.address ?? 'aucune'})`), { code: 'EINTERNAL' }))
    }
    if (options.all) callback(null, list)
    else callback(null, list[0].address, list[0].family)
  })
}

// Connexions gardées ouvertes (une playlist de direct toutes les 2 s), fermées
// après 4 s sans usage, comme le fetch de Node.
const upstreamAgent = new https.Agent({ keepAlive: true, timeout: 4_000, lookup: publicLookup })

/** Réponse Node → Response, corps décompressé comme le ferait fetch(). */
function toResponse(res) {
  const headers = new Headers()
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    try { headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]) } catch {}
  }
  const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase()
  const unzip = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip()
    : enc === 'deflate' ? zlib.createInflate()
    : enc === 'br' ? zlib.createBrotliDecompress() : null
  let body = res
  if (unzip) {
    body = pipe(res, unzip, () => {})
    headers.delete('content-encoding')
    headers.delete('content-length')
  }
  if ([204, 205, 304].includes(res.statusCode)) {
    res.resume()
    return new Response(null, { status: res.statusCode, headers })
  }
  // File comptée en octets : face à un spectateur lent, l'amont attend au
  // lieu de remplir la mémoire d'un segment entier.
  return new Response(Readable.toWeb(body, { strategy: new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 }) }),
    { status: res.statusCode, headers })
}

/** fetch() du proxy pour worker.js (env.PROXY_FETCH) : GET en https
 *  seulement, redirections jamais suivies (le proxy les examine), adresses
 *  internes refusées, 30 s au plus sans recevoir un octet. */
function proxyFetch(input, init = {}) {
  const url = new URL(String(input))
  if (url.protocol !== 'https:') return Promise.reject(new TypeError('https seulement'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // Une adresse IP écrite telle quelle ne passe pas par le DNS.
  if (net.isIP(host) && internalAddress(host)) return Promise.reject(Object.assign(new Error(`${host} : adresse interne refusée`), { code: 'EINTERNAL' }))
  const headers = {}
  new Headers(init.headers).forEach((v, k) => { headers[k] = v })
  // Playlists compressées, comme les demandait le fetch de Node (une playlist
  // de VOD : 26 Ko au lieu de 238 Ko) ; toResponse les décompresse. Pas pour
  // une plage d'octets (segments) : une réponse partielle compressée ne se
  // décompresse pas seule.
  if (!headers.range) headers['accept-encoding'] ??= 'gzip, br'
  const attempt = (retry) => new Promise((resolve, reject) => {
    let answered = false
    const req = https.request(url, { method: init.method || 'GET', headers, agent: upstreamAgent, timeout: 30_000 }, (res) => {
      answered = true
      try { resolve(toResponse(res)) } catch (e) { res.destroy(); reject(e) }
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('amont muet depuis 30 s'), { code: 'ETIMEDOUT' })))
    req.on('error', (e) => {
      // Connexion gardée ouverte que le serveur venait de fermer, avant toute
      // réponse : une seconde chance. (Après, l'erreur passe par le corps.)
      if (!answered && retry && req.reusedSocket && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) resolve(attempt(false))
      else reject(e)
    })
    req.end()
  })
  return attempt(true)
}

// En-têtes de la réponse à ne pas recopier : ceux de la connexion, et la
// compression — fetch() a déjà décompressé le corps.
const SKIP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'upgrade'])

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', PUBLIC_ORIGIN || `http://${req.headers.host || `localhost:${PORT}`}`)
    if (url.pathname === '/health') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      return res.end('ok')
    }
    if (url.pathname === '/ntfy') return await handleNtfy(req, res)
    if (url.pathname !== '/api/proxy') { res.writeHead(404, CORS); return res.end() }
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, CORS); return res.end() }
    // Sans en-tête CORS : le site voit un échec réseau et repasse par le Worker.
    if (!originOk(req.headers.origin)) { res.writeHead(403); return res.end('Origin not allowed') }

    const headers = new Headers()
    if (req.headers.range) headers.set('Range', req.headers.range)
    const r = await worker.fetch(new Request(url, { headers }), { PROXY_FETCH: proxyFetch }, { waitUntil() {}, passThroughOnException() {} })

    // Playlist réécrite ou corps décompressé : la longueur d'origine est fausse.
    const stale = r.headers.has('content-encoding') || /mpegurl/i.test(r.headers.get('content-type') || '')
    const out = {}
    r.headers.forEach((v, k) => {
      if (SKIP.has(k) || (k === 'content-length' && stale)) return
      out[k] = v
    })
    res.writeHead(r.status, out)
    if (!r.body || req.method === 'HEAD') {
      // HEAD : rien à envoyer, la connexion vers l'amont est rendue tout de suite.
      await r.body?.cancel().catch(() => {})
      return res.end()
    }
    // Au fil de l'eau : un segment n'est jamais gardé en mémoire en entier.
    await pipeline(Readable.fromWeb(r.body), res)
  } catch (e) {
    // Spectateur parti en cours de route : rien à dire. Sinon, une ligne au
    // journal (chemin seul : l'adresse relayée peut porter un jeton) — un
    // 502 muet ne se diagnostiquait pas.
    if (!res.headersSent) {
      console.warn(`${(req.url || '/').split('?')[0]} : 502, ${e?.cause?.code || e?.code || e?.name || 'erreur'} ${e?.cause?.message || e?.message || ''}`.trim())
      res.writeHead(502, CORS); res.end()
    } else res.destroy()
  }
})

server.keepAliveTimeout = 65_000
server.listen(PORT, () => {
  console.log(`Relais vidéo sur le port ${PORT}${PUBLIC_ORIGIN ? ` — ${PUBLIC_ORIGIN}` : ''}`
    + (ALLOWED.length ? ` — ${ALLOWED.length} origine(s) autorisée(s)` : ' — toutes origines')
    + (NTFY_WORKER ? ` — ntfy pour ${NTFY_WORKER}` : ''))
})

// ── Pont Discord des retours (facultatif) ─────────────────────────────────
// Avec un jeton de bot : les retours se lisent, se répondent et changent
// d'état dans un salon forum de Discord (voir discord-bot.mjs).
const bridge = process.env.DISCORD_BOT_TOKEN?.trim()
  ? (await import('./discord-bot.mjs')).startDiscordBridge({
      token: process.env.DISCORD_BOT_TOKEN.trim(),
      secret: (process.env.FEEDBACK_BOT_SECRET || '').trim(),
      worker: (process.env.FEEDBACK_WORKER || NTFY_WORKER || 'https://test2.kurzmathis4.workers.dev').trim(),
      admins: (process.env.DISCORD_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s)),
      ...(process.env.DISCORD_API ? { api: process.env.DISCORD_API } : {}),
      ...(process.env.DISCORD_GATEWAY ? { gateway: process.env.DISCORD_GATEWAY } : {}),
      // Workers de secours surveillés, heure et fuseau du résumé du matin.
      ...(process.env.FALLBACK_WORKERS ? { fallbacks: process.env.FALLBACK_WORKERS.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      ...(process.env.SUMMARY_TZ ? { summaryTz: process.env.SUMMARY_TZ.trim() } : {}),
      ...(Number.isInteger(Number(process.env.SUMMARY_HOUR)) && process.env.SUMMARY_HOUR ? { summaryHour: Number(process.env.SUMMARY_HOUR) } : {}),
    })
  : null

// Arrêt propre (docker stop) : on finit les réponses en cours.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { bridge?.stop(); server.close(() => process.exit(0)) })
}
