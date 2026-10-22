// ═══════════════════════════════════════════════════════════════════════════
//  Santé du conteneur (HEALTHCHECK du Dockerfile), sans dépendance.
//
//  La même image sert le site (docker/entrypoint.sh : frontal sur PORT) et
//  le relais (node /app/relay.mjs, sur RELAY_PORT). D'abord /health du
//  relais : il répond « ok: false » quand son bot Discord est arrêté (jeton
//  refusé…) ou déconnecté depuis plus de 5 min. Pas de relais ici : le site,
//  par /api/ping (le Worker y répond sans toucher à la base).
//  Sortie 0 : en bonne santé ; 1 sinon.
//
//  Un Node neuf à chaque contrôle (chaque minute) : node:http plutôt que
//  fetch, qui chargeait en plus undici à chaque fois (temps de processeur et
//  mémoire) pour deux requêtes locales.
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http'

/** GET http://127.0.0.1:<port><path> : { ok (2xx), body }, 8 s au plus sans réponse. */
const get = (port, path) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path, agent: false, timeout: 8000 }, (res) => {
    let body = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => { if (body.length < 65536) body += chunk })
    res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body }))
    res.on('error', reject)
  })
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.on('error', reject)
})

try {
  const r = await get(Number(process.env.RELAY_PORT) || 8788, '/health')
  let j = null
  try { j = JSON.parse(r.body) } catch {}
  if (j?.relay) process.exit(r.ok && j.ok !== false ? 0 : 1)
} catch {}

try {
  const r = await get(Number(process.env.PORT) || 8787, '/api/ping')
  process.exit(r.ok ? 0 : 1)
} catch {
  process.exit(1)
}
