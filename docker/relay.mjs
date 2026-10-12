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
//                     dans les playlists réécrites
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
import { createHash, webcrypto } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
// worker.js, copié en .mjs dans l'image : Node le lit alors sans hésiter
// comme un module (export default).
import worker from './worker.mjs'

const PORT = Number(process.env.RELAY_PORT) || 8788
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '')
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
const usedTokens = new Map()       // signature → expiration (secondes)

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
  if (alg !== 'ES256' || !(c?.exp > now && c.exp <= now + 600) || usedTokens.has(sig)) return false
  if (c.sha !== createHash('sha256').update(body).digest('base64url')) return false
  const verify = async (key) => webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    Buffer.from(sig, 'base64url'), Buffer.from(`${header}.${claims}`))
  if (!(await verify(await trustedKey(false))) && !(await verify(await trustedKey(true)))) return false
  for (const [s, exp] of usedTokens) if (exp <= now) usedTokens.delete(s)
  usedTokens.set(sig, c.exp)
  return true
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
    const r = await worker.fetch(new Request(url, { headers }), {}, { waitUntil() {}, passThroughOnException() {} })

    // Playlist réécrite ou corps décompressé : la longueur d'origine est fausse.
    const stale = r.headers.has('content-encoding') || /mpegurl/i.test(r.headers.get('content-type') || '')
    const out = {}
    r.headers.forEach((v, k) => {
      if (SKIP.has(k) || (k === 'content-length' && stale)) return
      out[k] = v
    })
    res.writeHead(r.status, out)
    if (!r.body || req.method === 'HEAD') return res.end()
    // Au fil de l'eau : un segment n'est jamais gardé en mémoire en entier.
    await pipeline(Readable.fromWeb(r.body), res)
  } catch {
    // Spectateur parti en cours de route, ou Twitch injoignable.
    if (!res.headersSent) { res.writeHead(502, CORS); res.end() } else res.destroy()
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
