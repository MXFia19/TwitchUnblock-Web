// Vérifications de la réserve du quota du jour (worker.js, « Réserve du
// quota du jour »), sans réseau :
//  - le Worker (worker.js copié en .mjs, fausse base D1 en mémoire sur
//    node:sqlite) : seuils, réponse de chaque sorte de route, chiffre trop
//    vieux ou d'hier, secours sans base, contrôles CORS gardés ;
//  - le bot (docker/discord-bot.mjs) : quotas lus, envoyés au Worker (le
//    vrai, ci-dessus), une alerte par niveau, rythme de lecture ;
//  - le site (api.js) : pause des envois automatiques, et son câblage dans
//    usage.js et main.js ;
//  - la TV LG (webos/src/points.js) : relais des minutes laissé jusqu'à
//    minuit UTC.
// Lancer : node tools/quota-reserve-check.mjs (Node 22.13 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const WORKER = 'https://test2.example.workers.dev'
const SECRET = 'bot-secret-0123456789'
const DAY = 86400000
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// node:sqlite est encore « expérimental » : son avertissement est tu.
const warn = process.emitWarning
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : warn.call(process, w, ...rest))
const { DatabaseSync } = await import('node:sqlite')

// ── Le Worker, avec une fausse D1 ─────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'tu-quota-'))
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch {} })
const workerFile = join(tmp, 'worker.mjs')
copyFileSync(join(ROOT, 'worker.js'), workerFile)
let imports = 0
/** Une instance neuve du Worker (réserve gardée en mémoire comprise). */
const freshWorker = async () => (await import(`${pathToFileURL(workerFile).href}?n=${++imports}`)).default

/** Base D1 en mémoire (prepare/bind/first/all/run, batch), sur un vrai SQLite. */
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
const newEnv = (extra = {}) => ({ DB: fakeD1(), FEEDBACK_BOT_SECRET: SECRET, FEEDBACK_WEBHOOK: 'https://discord.com/api/webhooks/1/abc', ...extra })
function hit(worker, env, method, path, { body, headers = {} } = {}) {
  const init = { method, headers: { 'CF-Connecting-IP': '198.51.100.7', ...headers } }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return worker.fetch(new Request(`${WORKER}${path}`, init), env, ctx)
}
/** Chiffre du jour envoyé comme le bot. */
const push = (worker, env, requests, { day = today(), at = Date.now() } = {}) =>
  hit(worker, env, 'POST', '/api/feedback/discord', { body: { action: 'quota', day, requests, at }, headers: { Authorization: `Bearer ${SECRET}` } })
const spade = (worker, env) => hit(worker, env, 'POST', '/api/spade', { body: 'pas du json' })

// ── Worker ────────────────────────────────────────────────────────────────
test('Worker : contrôles CORS gardés par le navigateur, en-têtes de la réserve lisibles', async () => {
  const worker = await freshWorker()
  const r = await worker.fetch(new Request(`${WORKER}/api/ping`, { method: 'OPTIONS' }), newEnv(), ctx)
  assert.equal(r.headers.get('Access-Control-Max-Age'), '86400')
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*')
  const expose = r.headers.get('Access-Control-Expose-Headers')
  assert.match(expose, /X-TU-Quota/)
  assert.match(expose, /Retry-After/)
})

test('Worker : sans chiffre du bot, rien ne change', async () => {
  const worker = await freshWorker()
  const env = newEnv()
  assert.equal((await spade(worker, env)).status, 400)   // passé au relais des minutes (données refusées)
  const live = await hit(worker, env, 'GET', '/api/get-live?name=')
  assert.notEqual(live.status, 429)
  assert.equal(live.headers.get('X-TU-Quota'), null)
  const ann = await hit(worker, env, 'GET', '/api/announcement')
  assert.equal(ann.status, 200)
  assert.equal(ann.headers.get('X-TU-Quota'), null)
})

test('Worker : réserve à 80 % — minutes des points refusées, avis sur le comptage et les annonces, lecture servie', async () => {
  const worker = await freshWorker()
  const env = newEnv()
  const saved = await push(worker, env, 85000)
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), { ok: true, level: 1, daily: 100000, reserveAt: 80000, playbackAt: 95000 })

  const s = await spade(worker, env)
  assert.equal(s.status, 429)
  assert.equal(s.headers.get('Access-Control-Allow-Origin'), '*')   // lisible par la TV LG
  const body = await s.json()
  assert.equal(body.code, 'quota_reserve')
  const retry = Number(s.headers.get('Retry-After'))
  assert.equal(body.retryAfter, retry)
  assert.ok(retry >= 60 && retry <= DAY / 1000, `Retry-After jusqu'à minuit UTC (${retry})`)

  for (const [method, path, b] of [['GET', '/api/announcement'], ['POST', '/api/ping', { id: 'x' }], ['GET', '/api/stats']]) {
    const r = await hit(worker, env, method, path, { body: b })
    assert.equal(r.headers.get('X-TU-Quota'), 'reserve', `${path} : avis`)
    assert.ok(Number(r.headers.get('Retry-After')) >= 60, `${path} : Retry-After`)
  }
  const ann = await hit(worker, env, 'GET', '/api/announcement')
  assert.equal(ann.status, 200)   // servie quand même
  const live = await hit(worker, env, 'GET', '/api/get-live?name=')
  assert.notEqual(live.status, 429)
  assert.equal(live.headers.get('X-TU-Quota'), null)
  // Le reste (sauvegarde…) ne porte pas d'avis.
  const sync = await hit(worker, env, 'GET', '/api/sync/get?id=1')
  assert.equal(sync.headers.get('X-TU-Quota'), null)
})

test('Worker : passé 95 %, la lecture répond comme Cloudflare au quota atteint (sans CORS, « 1027 »)', async () => {
  const worker = await freshWorker()
  const env = newEnv()
  assert.equal((await (await push(worker, env, 96000)).json()).level, 2)
  for (const path of ['/api/get-live?name=xqc', '/api/get-m3u8?id=123', '/api/proxy?url=https%3A%2F%2Fusher.ttvnw.net%2Fx.m3u8', '/api/get-channel-videos?name=xqc', '/api/recover-list?channel=xqc', '/api/recover-resolve?login=a&streamID=1&epoch=2']) {
    const r = await hit(worker, env, 'GET', path)
    assert.equal(r.status, 429, path)
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null, `${path} : pas de CORS (échec réseau pour le navigateur)`)
    assert.match(await r.text(), /1027/, `${path} : les apps laissent ce Worker jusqu'à minuit UTC`)
    assert.ok(Number(r.headers.get('Retry-After')) >= 60)
  }
  // Ce que seul ce Worker sait faire reste servi.
  assert.notEqual((await hit(worker, env, 'GET', '/api/sync/get?id=1')).status, 429)
  assert.equal((await hit(worker, env, 'GET', '/')).status, 200)
  assert.equal((await spade(worker, env)).status, 429)
})

test('Worker : chiffre d’hier, trop vieux, ou d’un Worker sans base — rien ne change ; mauvais chiffre refusé', async () => {
  let worker = await freshWorker()
  let env = newEnv()
  const yesterday = Date.now() - DAY
  assert.equal((await push(worker, env, 99000, { day: today(yesterday), at: yesterday + 60_000 })).status, 200)
  assert.notEqual((await hit(worker, env, 'GET', '/api/get-live?name=xqc')).status, 429)
  assert.equal((await spade(worker, env)).status, 400)

  worker = await freshWorker()
  env = newEnv()
  await push(worker, env, 99000, { at: Date.now() - 31 * 60_000 })
  assert.equal((await spade(worker, env)).status, 400, 'bot arrêté depuis plus de 30 min')

  // Le secours : pas de base, pas de réserve (et pas d'action du bot).
  worker = await freshWorker()
  const fallback = { FEEDBACK_BOT_SECRET: SECRET }
  assert.equal((await spade(worker, fallback)).status, 400)
  assert.notEqual((await hit(worker, fallback, 'GET', '/api/get-live?name=xqc')).status, 429)

  worker = await freshWorker()
  env = newEnv()
  for (const bad of [{ requests: -1 }, { requests: 1.5 }, { requests: 'beaucoup' }, { day: '21/11' }, { at: Date.now() - 2 * DAY }]) {
    const r = await hit(worker, env, 'POST', '/api/feedback/discord', {
      body: { action: 'quota', day: today(), requests: 1000, at: Date.now(), ...bad }, headers: { Authorization: `Bearer ${SECRET}` },
    })
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
  const wrong = await hit(worker, env, 'POST', '/api/feedback/discord', { body: { action: 'quota', day: today(), requests: 99000, at: Date.now() }, headers: { Authorization: 'Bearer nope' } })
  assert.equal(wrong.status, 403)
  assert.equal((await spade(worker, env)).status, 400)
})

test('Worker : seuils réglables (QUOTA_RESERVE, QUOTA_PLAYBACK_RESERVE, QUOTA_DAILY_LIMIT)', async () => {
  let worker = await freshWorker()
  let env = newEnv({ QUOTA_RESERVE: '10', QUOTA_PLAYBACK_RESERVE: '0' })
  let r = await (await push(worker, env, 89000)).json()
  assert.equal(r.reserveAt, 90000)
  assert.equal(r.playbackAt, 100000)
  assert.equal(r.level, 0)
  r = await (await push(worker, env, 99999)).json()
  assert.equal(r.level, 1, 'lecture jamais coupée avec 0 %')

  worker = await freshWorker()
  env = newEnv({ QUOTA_DAILY_LIMIT: '10000000', QUOTA_RESERVE: 'n’importe quoi' })
  r = await (await push(worker, env, 7000000)).json()
  assert.equal(r.reserveAt, 8000000, 'valeur illisible : 20 % par défaut')
  assert.equal(r.level, 0)
})

// ── Bot ───────────────────────────────────────────────────────────────────
test('Bot : quotas envoyés au Worker, une alerte par niveau, relus toutes les 5 min passé 70 %', async () => {
  const worker = await freshWorker()
  const env = newEnv()
  let requests = 85000
  const graphql = []
  const realFetch = globalThis.fetch
  const realWs = globalThis.WebSocket
  const realNow = Date.now
  let shift = 0
  Date.now = () => realNow() + shift
  globalThis.WebSocket = class { constructor() {} addEventListener() {} send() {} close() {} }
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith(`${WORKER}/`)) return worker.fetch(new Request(url, init), env, ctx)
    if (url.startsWith('https://discord.com/api/webhooks/')) return json({ channel_id: '10', guild_id: '20' })
    if (url === 'https://cf.example/graphql') {
      graphql.push(JSON.parse(init.body).query)
      return json({ data: { viewer: { accounts: [{ workers: [{ sum: { requests } }], d1: [{ sum: { rowsRead: 10, rowsWritten: 5 } }] }] } } })
    }
    return json({})
  }
  const logs = []
  const log = { info() {}, warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) }
  const { startDiscordBridge } = await import('../docker/discord-bot.mjs')
  const bridge = startDiscordBridge({
    token: 'bot-token', secret: SECRET, worker: WORKER, timers: false, log,
    api: 'https://discord.example/api', gateway: 'wss://gateway.example', github: 'https://github.example',
    cloudflare: { token: 'cf-token', account: 'a'.repeat(32) }, cloudflareApi: 'https://cf.example/graphql',
  })
  try {
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0))   // démarrage (config)
    await bridge.run.watchQuotas()
    assert.equal(graphql.length, 1)
    assert.ok(logs.some((l) => l.includes('Quota reserve on') && l.includes('85,000')), logs.join('\n'))
    assert.ok(logs.some((l) => l.includes('Cloudflare quota at 85%')))
    assert.equal((await spade(worker, env)).status, 429, 'le Worker est en réserve')

    await bridge.run.watchQuotas()
    assert.equal(graphql.length, 1, 'relu au plus toutes les 4 min')
    shift = 5 * 60_000
    requests = 96000
    await bridge.run.watchQuotas()
    assert.equal(graphql.length, 2, 'passé 70 % : relu toutes les 5 min')
    assert.ok(logs.some((l) => l.includes('Playback moved off the main Worker')))
    assert.equal(logs.filter((l) => l.includes('Quota reserve on')).length, 1, 'une seule alerte par niveau et par jour')
    assert.equal((await hit(worker, env, 'GET', '/api/get-live?name=xqc')).status, 429)

    // Sous 70 % : relu toutes les 15 min seulement.
    shift += 5 * 60_000
    requests = 10000
    await bridge.run.watchQuotas()
    assert.equal(graphql.length, 3)
    shift += 5 * 60_000
    await bridge.run.watchQuotas()
    assert.equal(graphql.length, 3, 'sous 70 % : pas avant 15 min')
    shift += 10 * 60_000
    await bridge.run.watchQuotas()
    assert.equal(graphql.length, 4)
  } finally {
    bridge.stop()
    globalThis.fetch = realFetch
    globalThis.WebSocket = realWs
    Date.now = realNow
  }
})

// ── Site ──────────────────────────────────────────────────────────────────
test('Site : l’avis du Worker met les envois automatiques en pause jusqu’à minuit UTC', async () => {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)) },
    removeItem: (k) => { storage.delete(k) },
    key: (i) => [...storage.keys()][i] ?? null,
    get length() { return storage.size },
  }
  globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
  globalThis.location ??= { reload() {}, origin: 'https://twitchunblock.vercel.app' }
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => json({})
  try {
    const api = await import('../public/assets/js/api.js')
    assert.equal(api.quotaPaused(), false)
    api.noteQuotaHint(new Response('{}', { headers: { 'X-TU-Quota': 'playback', 'Retry-After': '3600' } }))
    assert.equal(api.quotaPaused(), false, 'seul « reserve » met en pause')
    api.noteQuotaHint(new Response('{}'))
    assert.equal(api.quotaPaused(), false)
    api.noteQuotaHint(new Response('{}', { headers: { 'X-TU-Quota': 'reserve', 'Retry-After': '7200' } }))
    assert.equal(api.quotaPaused(), true)
    const until = Number(storage.get('tu_quota_pause'))
    assert.ok(Math.abs(until - (Date.now() + 7200_000)) < 5000, 'gardée sur l’appareil')
    // Un Retry-After démesuré est borné à un jour.
    api.noteQuotaHint(new Response('{}', { headers: { 'X-TU-Quota': 'reserve', 'Retry-After': String(30 * 86400) } }))
    assert.ok(Number(storage.get('tu_quota_pause')) <= Date.now() + DAY + 5000)
    storage.set('tu_quota_pause', String(Date.now() - 1))
  } finally {
    globalThis.fetch = realFetch
  }
})

test('Site : comptage, annonce et sondage branchés sur la pause ; l’effacement du comptage jamais', () => {
  const usage = read('public/assets/js/usage.js')
  const ping = usage.slice(usage.indexOf('async function pingOnce'), usage.indexOf('export function pingNow'))
  assert.match(ping, /if \(quotaPaused\(\)\) return/)
  assert.match(ping, /noteQuotaHint\(res\)/)
  const forget = usage.slice(usage.indexOf('export async function forget'))
  assert.doesNotMatch(forget.slice(0, 400), /quotaPaused/)
  const main = read('public/assets/js/main.js')
  for (const fn of ['async function loadAnnouncement', 'async function loadPoll']) {
    const body = main.slice(main.indexOf(fn), main.indexOf(fn) + 900)
    assert.match(body, /if \(api\.quotaPaused\(\)\) return render/, fn)
    assert.match(body, /api\.noteQuotaHint\(res\)/, fn)
  }
  // Le vote, lui, part toujours (action de la personne).
  const vote = main.slice(main.indexOf('async function votePoll'), main.indexOf('async function votePoll') + 600)
  assert.doesNotMatch(vote, /quotaPaused/)
})

// ── TV LG ─────────────────────────────────────────────────────────────────
test('TV LG : relais des minutes en réserve laissé jusqu’à minuit UTC ; un 429 ordinaire, 10 min', async () => {
  const { SpadeSender } = await import('../webos/src/points.js')
  let now = 1_000_000
  const answers = new Map()
  const calls = []
  const sender = new SpadeSender({
    fetch: async (url) => { calls.push(url); return answers.get(new URL(url).origin)() },
    bases: () => ['https://main.example', 'https://fallback.example'],
    log() {},
    workerUntil: { get: () => Infinity, set() {} },
    now: () => now,
  })
  answers.set('https://main.example', () => json({ error: 'réserve', code: 'quota_reserve', retryAfter: 3 * 3600 }, 429))
  answers.set('https://fallback.example', () => json({ error: 'Trop d’envois' }, 429))
  assert.equal(await sender.relay('https://spade.twitch.tv/track', 'e30='), null)
  assert.equal(sender.skip.get('https://main.example'), now + 3 * 3600_000)
  assert.equal(sender.skip.get('https://fallback.example'), now + 10 * 60_000)
  now += 11 * 60_000
  calls.length = 0
  answers.set('https://fallback.example', () => json({ ok: true, status: 204 }))
  assert.deepEqual(await sender.relay('https://spade.twitch.tv/track', 'e30='), { status: 204, relayed: true })
  assert.deepEqual(calls.map((u) => new URL(u).origin), ['https://fallback.example'], 'le principal attend encore')
})
