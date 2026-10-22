// ═══════════════════════════════════════════════════════════════════════════
//  Frontal du conteneur Docker : le seul serveur joignable de l'extérieur.
//
//  `wrangler dev` sert, en plus du site et du Worker, ses outils locaux sous
//  /cdn-cgi/local/… : la tâche planifiée (/cdn-cgi/local/scheduled), et
//  depuis wrangler 4.80 l'explorateur, qui lit et modifie la base D1 en SQL
//  brut (/cdn-cgi/local/explorer/api/d1/…) — sauvegardes, retours et
//  contacts, comptage, abonnements, clés VAPID. Son seul garde-fou est
//  l'en-tête Host, que n'importe quel client choisit (« Host: localhost »).
//  wrangler écoute donc sur 127.0.0.1, dans le conteneur seulement, et ce
//  frontal publie le port : il relaie le site et /api, rien de wrangler.
//
//    node front.mjs node --no-warnings <wrangler>/wrangler-dist/cli.js dev …
//    (docker/entrypoint.sh ; « node front.mjs wrangler dev … » marche aussi)
//
//  Il lance la commande reçue, lui transmet l'arrêt (docker stop) et s'arrête
//  avec elle : le conteneur redémarre si wrangler tombe. Il lance aussi la
//  tâche planifiée du Worker chaque minute (cronLoop), n'ouvre le relais
//  vidéo qu'aux sites admis (originOk) et note au journal, une fois par
//  heure, ce qu'il a servi (« [trafic] »).
//
//  Variables : PORT (8787, publié), INNER_PORT (8786, celui de wrangler),
//  TRUST_PROXY (voir clientIp), ALLOWED_ORIGINS et PUBLIC_URL (originOk),
//  CRON_SECRET (posé par docker/entrypoint.sh, cronLoop).
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream'

const PORT = Number(process.env.PORT) || 8787
const INNER_PORT = Number(process.env.INNER_PORT) || 8786
// Derrière un mandataire (Caddy, nginx…) qui ajoute l'adresse du visiteur à
// X-Forwarded-For : TRUST_PROXY=1. Sans lui (par défaut), seule l'adresse de
// la connexion compte.
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || '').trim())

// En-têtes propres à une connexion (pas à relayer), et Expect : le corps est
// déjà accepté ici.
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer',
  'upgrade', 'proxy-authorization', 'proxy-authenticate', 'expect'])

/** Chemin décodé (plusieurs fois s'il le faut), barres groupées, sans
 *  casse : internalPath et proxyPath le lisent ainsi, et aucune écriture
 *  détournée ne passe. */
function plainPath(pathname) {
  let p = pathname
  for (let i = 0; i < 3; i++) {
    let d
    try { d = decodeURIComponent(p) } catch { break }
    if (d === p) break
    p = d
  }
  return p.replace(/[\\/]+/g, '/').toLowerCase()
}

/** Outils de wrangler et de Miniflare : /cdn-cgi/… (tâche planifiée,
 *  explorateur de la base, e-mails, R2…) et /__… (/__scheduled des anciennes
 *  versions, /__cf_local/…). */
function internalPath(pathname) {
  const p = plainPath(pathname)
  return p.startsWith('/cdn-cgi') || p.startsWith('/__')
}

/** Relais vidéo du Worker (/api/proxy) : presque toute la bande passante. */
const proxyPath = (pathname) => plainPath(pathname).replace(/\/+$/, '') === '/api/proxy'

// ── Sites admis sur le relais vidéo ───────────────────────────────────────
// /api/proxy répondait à tout le monde : une instance joignable d'Internet
// servait de relais gratuit à n'importe quel autre site. Comme le relais du
// VPS (docker/relay.mjs), un navigateur qui annonce une autre origine reçoit
// 403, sans en-tête CORS (le site officiel repasse alors par ses Workers).
// Sans en-tête Origin, rien ne change : le site de l'instance (ses requêtes
// vidéo sont de même origine), les apps, VLC.
//   ALLOWED_ORIGINS vide : le site de l'instance (PUBLIC_URL, et l'adresse
//   par laquelle on l'ouvre) et le site officiel, où l'instance peut servir
//   de « Worker personnel » (réglages) ; « * » : tout le monde ; sinon la
//   liste, séparée par des virgules (« * » dans un nom en remplace une
//   partie), à la place du site officiel. Le site officiel : les mêmes
//   adresses que relay/docker-compose.yml.
const OFFICIAL_ORIGINS = ['https://twitchunblock.vercel.app', 'https://test2-fawn-eta.vercel.app',
  'https://twitchunblock-*-mxfia19s-projects.vercel.app', 'https://test2-*-mxfia19s-projects.vercel.app']
const ORIGINS_SETTING = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
const ANY_ORIGIN = ORIGINS_SETTING.includes('*')
const OWN_ORIGIN = (() => { try { return new URL(process.env.PUBLIC_URL).origin } catch { return '' } })()
const ALLOWED = [...(ORIGINS_SETTING.length ? ORIGINS_SETTING : OFFICIAL_ORIGINS), OWN_ORIGIN]
  .map((s) => s.replace(/\/+$/, ''))
  .filter(Boolean)
  .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`, 'i'))

function originOk(req) {
  const origin = req.headers.origin
  if (!origin || ANY_ORIGIN) return true
  // Même hôte que la requête : le site de l'instance, ouvert par une autre
  // adresse que PUBLIC_URL (réseau local…).
  try { if (new URL(origin).host === String(req.headers.host || '').toLowerCase()) return true } catch {}
  return ALLOWED.some((re) => re.test(origin))
}

/** Adresse du visiteur pour les limites du Worker (clientKey) : celle de la
 *  connexion, ou avec TRUST_PROXY la dernière de X-Forwarded-For (celle
 *  qu'a vue le mandataire). Le CF-Connecting-IP envoyé par le client était
 *  relayé tel quel : une adresse inventée par requête, une « personne »
 *  neuve à chaque fois, et toutes les limites contournées. Derrière un
 *  mandataire sans TRUST_PROXY, tous les visiteurs partagent son adresse. */
function clientIp(req) {
  let ip = req.socket.remoteAddress || ''
  if (TRUST_PROXY) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
    const last = (hops.at(-1) || '').replace(/^\[(.*)\]$/, '$1')
    if (net.isIP(last)) ip = last
  }
  return ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')
}

/** En-têtes relayés : sans ceux de la connexion, ni ceux de Miniflare
 *  (MF-Original-URL réécrit l'adresse que voit wrangler — /cdn-cgi/…
 *  comprise —, MF-CF-Blob, MF-Route-Override…), ni l'adresse annoncée par
 *  le client (CF-Connecting-IP, clientIp). */
function forwardHeaders(req) {
  const named = String(req.headers.connection || '').toLowerCase().split(',').map((s) => s.trim())
  const out = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP.has(k) || named.includes(k) || k.startsWith('mf-') || k === 'cf-connecting-ip') continue
    out[k] = v
  }
  // Adresse du client pour les limites du Worker (clientKey), comme la posait
  // wrangler quand il recevait la connexion lui-même.
  const ip = clientIp(req)
  if (ip) out['cf-connecting-ip'] = ip
  return out
}

// ── Trafic servi : une ligne par heure au journal ──────────────────────────
// « docker stats » ne donne que des totaux depuis le démarrage du conteneur.
// Cette ligne dit ce qui est parti dans l'heure, dont la vidéo, et vers qui :
// réseau local ou Internet (derrière un mandataire, avec TRUST_PROXY
// seulement), en nombre d'adresses — aucune n'est écrite. Rien quand
// personne n'est venu ; la boucle locale (contrôle de santé) n'est pas
// comptée.  docker logs twitchunblock | grep trafic
const LOCAL_NET = new net.BlockList()
for (const [a, p] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['169.254.0.0', 16]]) {
  LOCAL_NET.addSubnet(a, p, 'ipv4')
}
LOCAL_NET.addSubnet('fc00::', 7, 'ipv6')
LOCAL_NET.addSubnet('fe80::', 10, 'ipv6')
const LOOPBACK = new net.BlockList()
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACK.addAddress('::1', 'ipv6')
const blankTraffic = () => ({ n: 0, video: 0, refused: 0, local: { ips: new Set(), bytes: 0 }, internet: { ips: new Set(), bytes: 0 } })
let traffic = blankTraffic()

/** Compte la requête et ses octets envoyés (en-têtes compris), à la fin de
 *  la réponse, dans l'heure en cours. */
function noteTraffic(req, res, video) {
  const ip = clientIp(req)
  const family = net.isIP(ip) === 6 ? 'ipv6' : net.isIP(ip) === 4 ? 'ipv4' : null
  if (!family || LOOPBACK.check(ip, family)) return
  const side = LOCAL_NET.check(ip, family) ? 'local' : 'internet'
  const socket = req.socket
  const start = socket.bytesWritten
  res.once('close', () => {
    const t = traffic
    t.n++
    if (video) t.video++
    t[side].bytes += Math.max(0, socket.bytesWritten - start)
    if (t[side].ips.size < 10_000) t[side].ips.add(ip)
  })
}

setInterval(() => {
  const t = traffic
  traffic = blankTraffic()
  if (!t.n) return
  const mb = (b) => `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0).replace('.', ',')} Mo`
  const side = (name, s) => `${name} ${s.ips.size} adresse(s), ${mb(s.bytes)}`
  console.log(`[trafic] dernière heure : ${t.n} requête(s) dont ${t.video} vidéo (/api/proxy), ${mb(t.local.bytes + t.internet.bytes)} envoyés`
    + ` — ${side('réseau local', t.local)} ; ${side('Internet', t.internet)}`
    + (t.refused ? ` ; ${t.refused} refusée(s) : origine non admise (ALLOWED_ORIGINS)` : ''))
}, 3600_000).unref()

const server = http.createServer((req, res) => {
  // Lu comme un chemin (« //cdn-cgi/… » n'est pas l'hôte cdn-cgi), ou comme
  // l'adresse complète qu'envoie un client mandataire.
  const target = req.url || '/'
  let url
  try { url = new URL(target.startsWith('/') ? `http://front.invalid${target}` : target) } catch {
    res.writeHead(400); return res.end()
  }
  const video = proxyPath(url.pathname)
  noteTraffic(req, res, video)
  if (internalPath(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('Not Found')
  }
  if (video && !originOk(req)) {
    traffic.refused++
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    return res.end('Origin not allowed')
  }
  // Adresse normalisée (points, encodage) : wrangler reçoit exactement ce qui
  // vient d'être vérifié.
  const up = http.request({
    host: '127.0.0.1', port: INNER_PORT, method: req.method,
    path: url.pathname + url.search, headers: forwardHeaders(req),
    // Une connexion par requête : rien à garder entre deux, et pas de course
    // avec une connexion que workerd fermerait au même moment.
    agent: false,
  }, (upRes) => {
    const headers = []
    for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
      if (!HOP.has(upRes.rawHeaders[i].toLowerCase())) headers.push(upRes.rawHeaders[i], upRes.rawHeaders[i + 1])
    }
    res.writeHead(upRes.statusCode, upRes.statusMessage || undefined, headers)
    pipeline(upRes, res, () => {})
  })
  up.on('error', (e) => {
    if (res.headersSent) return res.destroy()
    // wrangler pas encore prêt (démarrage du conteneur) : réessayer.
    if (e.code === 'ECONNREFUSED') {
      res.writeHead(503, { 'Retry-After': '2', 'Content-Type': 'text/plain' })
      return res.end('Starting, try again in a few seconds')
    }
    console.warn(`${url.pathname} : 502, ${e.code || e.message}`)
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end()
  })
  pipeline(req, up, () => {})
})
// Derrière un autre serveur (Caddy, nginx…) qui garde ses connexions ouvertes.
server.keepAliveTimeout = 65_000

// ── Tâche planifiée du Worker ──────────────────────────────────────────────
// Hors de Cloudflare, pas de Cron Trigger : POST /api/cron chaque minute,
// directement à wrangler, avec le secret tiré au démarrage
// (docker/entrypoint.sh). Une boucle du shell lançait pour cela un Node neuf
// à chaque minute (~40 Mo et ~0,1 s de processeur chacun, bien plus sur un
// Raspberry Pi) ; ici, une minuterie. Calée sur la minute (pushTick vérifie
// les lives une minute sur deux : un passage par minute, sans dérive) et
// jamais deux à la fois : la réponse n'arrive qu'une fois la tâche finie (5
// minutes au plus), et le passage suivant attend la minute d'après.
const CRON_SECRET = String(process.env.CRON_SECRET || '')

function cronRun() {
  return new Promise((done) => {
    const r = http.request({
      host: '127.0.0.1', port: INNER_PORT, method: 'POST', path: '/api/cron', agent: false, timeout: 300_000,
      headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Length': 0 },
    }, (up) => {
      up.on('end', done).on('close', done).on('error', done)
      up.resume()
    })
    // wrangler pas encore prêt (démarrage) ou muet : le passage suivant.
    r.on('timeout', () => r.destroy())
    r.on('error', done)
    r.end()
  })
}

function cronLoop(first = false) {
  let wait = 60_000 - (Date.now() % 60_000) + 1_000
  // Au démarrage, laisser à wrangler le temps de se lancer.
  if (first && wait < 30_000) wait += 60_000
  setTimeout(() => cronRun().then(() => cronLoop()), wait)
}
// Même condition que le Worker (dockerCron) : sans secret, pas de route.
if (CRON_SECRET.length >= 16) cronLoop(true)

// ── La commande (wrangler dev) ─────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error('Usage : node front.mjs <commande> [arguments…]')
  process.exit(2)
}
const child = spawn(cmd, args, { stdio: 'inherit' })
child.on('error', (e) => {
  console.error(`${cmd} : ${e.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  server.close()
  process.exit(code ?? (signal ? 1 : 0))
})
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => child.kill(sig))

server.on('error', (e) => {
  console.error(`Port ${PORT} : ${e.message}`)
  child.kill('SIGTERM')
  process.exitCode = 1
})
server.listen(PORT, '0.0.0.0')
