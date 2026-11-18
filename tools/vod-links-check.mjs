// Vérifications du secours des liens de VOD par les relais des VPS, sans
// réseau ni navigateur :
//  - getVodLinks (api.js) : quand aucun Worker ne répond (quota du jour,
//    « error code: 1027 », vu le 18/11), les liens sont demandés au relais
//    principal, à celui de Sofia s'il est écarté pour lenteur, en panne ou
//    à éviter ; une vraie réponse d'un Worker (404) ne passe pas aux relais ;
//  - la route du relais (docker/relay.mjs, handleVodLinks) : branchée, ne lit
//    que l'identifiant, liens toujours par le proxy, origine vérifiée ;
//  - le site et l'app TV LG ne demandent les liens des VODs que par
//    getVodLinks ; SITE_VERSION et les nouveautés.
// api.js est importé avec un faux navigateur (window, localStorage) et un
// faux fetch : aucune requête ne part.
// Lancer : node tools/vod-links-check.mjs (Node 22 ou plus).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8')

const RELAY = 'https://relais.mxfia19.duckdns.org'
const SOFIA = 'https://2-58-32-226.sslip.io'
const WORKER = 'https://test2.kurzmathis4.workers.dev'
const FALLBACK = 'https://test2-fallback.vxcraftmanpetit.workers.dev'
const VOD_PLAYLIST = 'https://d1m7jfoe9zdc1j.cloudfront.net/abc_chaine_123_456/1080p60/index-dvr.m3u8'
const proxied = (base) => `${base}/api/proxy?url=${encodeURIComponent(VOD_PLAYLIST)}&isVod=true`
const originsOf = (links) => [...new Set(Object.values(links).map((u) => new URL(u).origin))]

// ── Faux navigateur, avant d'importer api.js ──────────────────────────────
const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => { storage.set(k, String(v)) },
  removeItem: (k) => { storage.delete(k) },
  key: (i) => [...storage.keys()][i] ?? null,
  get length() { return storage.size },
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Réponse de chaque serveur, réglée par les tests : 'ok' (défaut),
// 'network' (la page 1027 de Cloudflare n'a pas d'en-tête CORS : le
// navigateur ne voit qu'un échec réseau), '429', '404', '500'.
let behave = {}
let calls = []
const workersDown = (how = 'network') => { behave[WORKER] = how; behave[FALLBACK] = how }
const asked = (base) => calls.includes(`${base}/api/get-m3u8`)
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  calls.push(`${url.origin}${url.pathname}`)
  if (url.pathname === '/health' || url.pathname === '/') return json({ relay: 'ok' })
  const how = behave[url.origin] ?? 'ok'
  if (how === 'network') throw new TypeError('Failed to fetch')
  if (how === '429') return new Response('error code: 1027', { status: 429 })
  if (how === '404') return json({ error: 'VOD introuvable' }, 404)
  // Relais d'avant la route : 404 sans corps (docker/relay.mjs, routes inconnues).
  if (how === 'bare404') return new Response(null, { status: 404 })
  if (how === '500') return new Response('oups', { status: 500 })
  // Worker ou relais : ses liens passent par lui (workerOrigin), comme worker.js.
  if (url.pathname === '/api/get-m3u8') return json({ links: { '1080p60': proxied(url.origin), Auto: proxied(url.origin) }, variants: {} })
  return json({ error: 'inattendu' }, 500)
}
const api = await import('../public/assets/js/api.js')

beforeEach(() => { behave = {}; calls = [] })

// Les tests tournent dans l'ordre : le relais n'est marqué lent qu'au
// dernier (l'état reste en mémoire dans api.js).

test('Workers joignables : liens par le relais principal, route du relais jamais demandée', async () => {
  const data = await api.getVodLinks('123')
  assert.deepEqual(originsOf(data.links), [RELAY])
  assert.ok(asked(FALLBACK), 'le secours d’abord')
  assert.ok(!asked(RELAY) && !asked(SOFIA))
})

test('les deux Workers à court (échec réseau) : liens demandés au relais principal', async () => {
  workersDown()
  const data = await api.getVodLinks('123')
  assert.deepEqual(originsOf(data.links), [RELAY])
  assert.ok(asked(WORKER) && asked(FALLBACK), 'les Workers essayés avant')
  assert.ok(asked(RELAY))
  assert.ok(!asked(SOFIA), 'Sofia pas dérangé')
  assert.ok(calls.indexOf(`${RELAY}/api/get-m3u8`) > calls.indexOf(`${WORKER}/api/get-m3u8`))
})

test('réponse 429 des Workers (quota) : pareil', async () => {
  workersDown('429')
  const data = await api.getVodLinks('123')
  assert.deepEqual(originsOf(data.links), [RELAY])
})

test('VOD introuvable chez un Worker (404) : erreur 404, aucun relais', async () => {
  behave[FALLBACK] = '404'
  await assert.rejects(api.getVodLinks('123'), (e) => e.status === 404)
  assert.ok(!asked(RELAY) && !asked(SOFIA))
})

test('relais principal en panne (500) : celui de Sofia', async () => {
  workersDown()
  behave[RELAY] = '500'
  const data = await api.getVodLinks('123')
  assert.deepEqual(originsOf(data.links), [SOFIA])
})

test('relais principal injoignable : celui de Sofia', async () => {
  workersDown()
  behave[RELAY] = 'network'
  const data = await api.getVodLinks('123')
  assert.deepEqual(originsOf(data.links), [SOFIA])
})

test('avoid = relais principal (il vient de lâcher) : Sofia sans le redemander', async () => {
  workersDown()
  const data = await api.getVodLinks('123', { avoid: RELAY })
  assert.deepEqual(originsOf(data.links), [SOFIA])
  assert.ok(!asked(RELAY))
})

test('VOD introuvable chez le relais (404) : erreur 404, Sofia pas demandé', async () => {
  workersDown()
  behave[RELAY] = '404'
  await assert.rejects(api.getVodLinks('123'), (e) => e.status === 404)
  assert.ok(!asked(SOFIA))
})

test('relais pas encore à jour (404 nu, route inconnue) : pas « VOD introuvable », Sofia ensuite', async () => {
  workersDown()
  behave[RELAY] = 'bare404'
  const data = await api.getVodLinks('123')
  assert.deepEqual(originsOf(data.links), [SOFIA])
})

test('aucun relais à jour : l’erreur de réseau, pas « VOD introuvable »', async () => {
  workersDown()
  behave[RELAY] = 'bare404'
  behave[SOFIA] = 'bare404'
  await assert.rejects(api.getVodLinks('123'), (e) => !e.status)
})

test('tout en panne : l’erreur « Worker injoignable », sans statut (problème de réseau)', async () => {
  workersDown()
  behave[RELAY] = '500'
  behave[SOFIA] = 'network'
  await assert.rejects(api.getVodLinks('123'), (e) => !e.status && /Worker injoignable/.test(e.message))
})

test('relais principal écarté pour lenteur : Sofia d’abord', async () => {
  assert.equal(api.markRelaySlow(), true)
  workersDown()
  const data = await api.getVodLinks('123')
  assert.deepEqual(originsOf(data.links), [SOFIA])
  assert.ok(!asked(RELAY), 'le relais lent n’est pas redemandé quand Sofia répond')
})

// ── Le relais : la route ──────────────────────────────────────────────────
test('relay.mjs : /api/get-m3u8 branché, seul `id` lu, toujours par le proxy, origine vérifiée', () => {
  const src = read('docker/relay.mjs')
  assert.match(src, /if \(url\.pathname === '\/api\/get-m3u8'\) return await handleVodLinks\(req, res, url\)/)
  // Fins de ligne Windows possibles (copie de travail sous Windows).
  const fn = /async function handleVodLinks\(req, res, url\) \{[\s\S]*?\r?\n\}\r?\n/.exec(src)?.[0]
  assert.ok(fn, 'handleVodLinks')
  assert.match(fn, /if \(!originOk\(req\.headers\.origin, req\.headers\['user-agent'\]\)\) \{ res\.writeHead\(403\)/)
  assert.deepEqual([...fn.matchAll(/url\.searchParams\.get\('([^']+)'\)/g)].map((m) => m[1]), ['id'])
  assert.match(fn, /ask\.searchParams\.set\('proxy', 'true'\)/)
  assert.match(fn, /worker\.fetch\(new Request\(ask\)/)
})

test('site et app TV : les liens des VODs ne se demandent que par getVodLinks', () => {
  const files = [
    ...readdirSync(new URL('public/assets/js/', ROOT)).filter((f) => f.endsWith('.js')).map((f) => `public/assets/js/${f}`),
    ...readdirSync(new URL('webos/src/', ROOT), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => `webos/src/${String(f).replace(/\\/g, '/')}`),
  ]
  const users = files.filter((f) => read(f).includes('/api/get-m3u8'))
  assert.deepEqual(users, ['public/assets/js/api.js'])
  for (const f of ['public/assets/js/main.js', 'public/assets/js/multi.js', 'webos/src/watch.js']) {
    assert.match(read(f), /api\.getVodLinks\(/, f)
  }
})

test('SITE_VERSION 2026.11.18c et nouveautés en tête', async () => {
  const version = /export const SITE_VERSION = '([^']+)'/.exec(read('public/assets/js/usage.js'))?.[1]
  assert.equal(version, '2026.11.18c')
  const { CHANGELOG } = await import('../public/assets/js/changelog.js')
  assert.equal(CHANGELOG[0].version, version)
  assert.equal(CHANGELOG.filter((e) => e.version === version).length, 1)
  for (const l of ['fr', 'en', 'es', 'ru']) assert.ok(CHANGELOG[0].items[l]?.[0]?.length > 50, l)
})
