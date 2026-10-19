// ═══════════════════════════════════════════════════════════════════════════
//  Santé du conteneur (HEALTHCHECK du Dockerfile), sans dépendance.
//
//  La même image sert le site (docker/entrypoint.sh : frontal sur PORT) et
//  le relais (node /app/relay.mjs, sur RELAY_PORT). D'abord /health du
//  relais : il répond « ok: false » quand son bot Discord est arrêté (jeton
//  refusé…) ou déconnecté depuis plus de 5 min. Pas de relais ici : le site,
//  par /api/ping (le Worker y répond sans toucher à la base).
//  Sortie 0 : en bonne santé ; 1 sinon.
// ═══════════════════════════════════════════════════════════════════════════

const get = (port, path) => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(8000) })

try {
  const r = await get(Number(process.env.RELAY_PORT) || 8788, '/health')
  const j = await r.json().catch(() => null)
  if (j?.relay) process.exit(r.ok && j.ok !== false ? 0 : 1)
} catch {}

try {
  const r = await get(Number(process.env.PORT) || 8787, '/api/ping')
  process.exit(r.ok ? 0 : 1)
} catch {
  process.exit(1)
}
