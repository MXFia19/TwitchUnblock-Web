// Vérifications des points de chaîne de l'app TV LG (webos/src/points.js),
// sans réseau ni appareil, avec des réponses de Twitch simulées :
//  - le contenu des « minute-watched » (celui de l'app iPhone, au champ
//    près), et la route /api/spade du Worker (worker.js copié en .mjs) qui
//    les accepte et les transmet telles quelles ;
//  - l'envoi : en direct au spade, sinon par les Workers, et le passage
//    « d'abord par le Worker » ;
//  - solde, série, coffre (un essai sans jeton d'intégrité, puis « sur ton
//    téléphone ») et réglages, avec une fausse horloge ;
//  - aucun fichier de l'app TV n'envoie d'en-tête Client-Integrity.
// Lancer : node tools/points-check.mjs (Node 22 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CLAIM_PAUSE_MS, GAIN_MS, HASH, MINUTE_MS, PointsCore, Q, SPADE_DEFAULT, STREAK_MS, SpadeSender, WORKER_STICK_MS,
  base64Utf8, findSettingsScript, findSpadeUrl, minuteWatched, predFromHermes, readClaim, readPoints, readStreak,
  spadeForm, spadeUrlOk,
} from '../webos/src/points.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const decode = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
const W1 = 'https://w1.example'
const W2 = 'https://w2.example'
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
/** Valeur gardée (localStorage dans l'app). */
const box = (v = 0) => ({ v, get() { return this.v }, set(x) { this.v = x } })

// ── Minute regardée ────────────────────────────────────────────────────────
test('minute-watched : le contenu de l’app iPhone', () => {
  const p = minuteWatched({ channelId: '42', broadcastId: '314159265358', login: 'some_channel', userId: '123456789' })
  assert.deepEqual(p, [{
    event: 'minute-watched',
    properties: { channel_id: '42', broadcast_id: '314159265358', channel: 'some_channel', user_id: 123456789, player: 'site', live: true },
  }])
  const b64 = base64Utf8(JSON.stringify(p))
  assert.deepEqual(decode(b64), p)
  assert.equal(spadeForm(b64), `data=${encodeURIComponent(b64)}`)
  assert.equal(base64Utf8('é✓'), Buffer.from('é✓', 'utf8').toString('base64'))
})

test('spade_url : lue dans la page, hôtes de Twitch seulement', () => {
  assert.equal(findSpadeUrl('…,"spade_url":"https:\\/\\/spade.twitch.tv\\/track",…'), 'https://spade.twitch.tv/track')
  assert.equal(findSpadeUrl('"spade_url": "https://video-edge-abc123.pdx01.abs.hls.ttvnw.net/v1/segment/Cq0"'), 'https://video-edge-abc123.pdx01.abs.hls.ttvnw.net/v1/segment/Cq0')
  assert.equal(findSpadeUrl('"spade_url":"https://evil.example/track"'), null)
  assert.equal(findSpadeUrl('rien ici'), null)
  assert.equal(spadeUrlOk(SPADE_DEFAULT), true)
  assert.equal(spadeUrlOk('https://spade.twitch.tv:8443/track'), false)
  assert.equal(spadeUrlOk('http://spade.twitch.tv/track'), false)
  assert.equal(spadeUrlOk('https://user:pw@spade.twitch.tv/track'), false)
  assert.equal(findSettingsScript('<script src="https://static.twitchcdn.net/config/settings.0a1b2c.js">'), 'https://static.twitchcdn.net/config/settings.0a1b2c.js')
  assert.equal(findSettingsScript('<script src="https://evil.example/config/settings.0a1b2c.js">'), null)
})

test('le Worker (/api/spade) accepte la minute de la TV et la transmet telle quelle', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tu-points-'))
  try {
    copyFileSync(join(ROOT, 'worker.js'), join(tmp, 'worker.mjs'))
    const worker = (await import(pathToFileURL(join(tmp, 'worker.mjs')).href)).default
    const b64 = base64Utf8(JSON.stringify(minuteWatched({ channelId: '42', broadcastId: '314159265358', login: 'some_channel', userId: '123456789' })))
    const sent = []
    const realFetch = globalThis.fetch
    // Twitch simulé : rien ne sort de la machine.
    globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response(null, { status: 204 }) }
    let res
    try {
      res = await worker.fetch(new Request(`${W1}/api/spade`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'CF-Connecting-IP': '203.0.113.7' },
        body: JSON.stringify({ url: SPADE_DEFAULT, data: b64 }),
      }), {}, { waitUntil() {}, passThroughOnException() {} })
    } finally {
      globalThis.fetch = realFetch
    }
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true, status: 204 })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, SPADE_DEFAULT)
    assert.equal(sent[0].init.method, 'POST')
    assert.equal(sent[0].init.body, spadeForm(b64))
    assert.equal(sent[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// ── Lecture des réponses ───────────────────────────────────────────────────
test('solde, coffre, nom et icône des points', () => {
  const full = readPoints({ data: { channel: { id: '42', self: { communityPoints: { balance: 1234.0, availableClaim: { id: 'c1-uuid' } } }, communityPointsSettings: { isEnabled: true, name: ' Kappa Coins ', image: { url2x: 'https://static-cdn.jtvnw.net/x.png' } } } } })
  assert.deepEqual(full, { channelId: '42', balance: 1234, claimId: 'c1-uuid', look: { enabled: true, name: 'Kappa Coins', icon: 'https://static-cdn.jtvnw.net/x.png' } })
  // Jamais regardée : communityPoints nul → 0 ; points coupés sur la chaîne.
  assert.deepEqual(readPoints({ data: { channel: { id: '42', self: { communityPoints: null }, communityPointsSettings: null } } }), { channelId: '42', balance: 0, claimId: null, look: { enabled: false, name: null, icon: null } })
  assert.equal(readPoints({ data: { channel: null } }).error, 'channel')
  assert.equal(readPoints({ data: { channel: { id: '42', self: null } } }).error, 'self')
  assert.equal(readPoints({ errors: [{ message: 'x' }] }).error, 'response')
  assert.equal(readPoints({ data: { channel: { id: '42', self: { communityPoints: { balance: 1, availableClaim: { id: 'a b' } } } } } }).claimId, null)
})

test('série de visionnage', () => {
  const list = { data: { batchGetWatchStreaks: [{ channel: { id: '7' }, value: 3 }, { channel: { id: '42' }, value: 12 }] } }
  assert.equal(readStreak(list, '42'), 12)
  assert.equal(readStreak(list, '99'), 0)
  assert.equal(readStreak({ errors: [{ message: 'PersistedQueryNotFound' }] }, '42'), null)
})

test('réponse au coffre', () => {
  assert.deepEqual(readClaim({ status: 200, json: { data: { claimCommunityPoints: { currentPoints: 1050 } } }, errors: '' }), { ok: true, points: 1050 })
  assert.deepEqual(readClaim({ status: 200, json: { data: { claimCommunityPoints: {} } }, errors: '' }), { ok: true, points: null })
  const integrity = readClaim({ status: 200, json: { data: { claimCommunityPoints: null } }, errors: 'failed integrity check' })
  assert.equal(integrity.ok, false)
  assert.equal(integrity.integrity, true)
  assert.equal(integrity.reason, 'failed integrity check')
  const refused = readClaim({ status: 200, json: { data: { claimCommunityPoints: { error: { code: 'NOT_FOUND' } } } }, errors: '' })
  assert.deepEqual([refused.ok, refused.integrity, refused.reason], [false, false, 'NOT_FOUND'])
  assert.equal(readClaim({ status: 0, json: null, errors: '' }).network, true)
})

test('prédiction d’Hermes : la forme de la carte du site', () => {
  const p = predFromHermes({
    id: 'p1', title: 'Gagne ?', status: 'ACTIVE', created_at: '2026-11-18T20:00:00Z', prediction_window_seconds: 120, winning_outcome_id: null,
    outcomes: [{ id: 'o1', title: 'Oui', color: 'BLUE', total_points: 500, total_users: 4 }, { id: 'o2', title: 'Non', color: 'PINK' }],
  })
  assert.equal(p.endsAt, Date.parse('2026-11-18T20:02:00Z'))
  assert.deepEqual(p.outcomes, [{ id: 'o1', title: 'Oui', color: 'BLUE', points: 500, users: 4 }, { id: 'o2', title: 'Non', color: 'PINK', points: 0, users: 0 }])
  assert.equal(predFromHermes(null), null)
})

// ── Envoi : en direct ou par le Worker ─────────────────────────────────────
function sender({ fetch, now = () => 1_000_000, workerUntil = box() } = {}) {
  const logs = []
  const s = new SpadeSender({ fetch, bases: () => [W1, W2], log: (m) => logs.push(m), workerUntil, now })
  return { s, logs, workerUntil }
}

test('envoi direct : POST data=<base64>, mode CORS, sans cookie', async () => {
  const calls = []
  const { s } = sender({ fetch: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }) } })
  assert.deepEqual(await s.send(SPADE_DEFAULT, 'ZGF0YQ=='), { status: 204, relayed: false })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, SPADE_DEFAULT)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.mode, 'cors')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(calls[0].init.body, 'data=ZGF0YQ%3D%3D')
})

test('spade refusé (CORS, bloqueur) : par le Worker, puis d’abord par lui 24 h', async () => {
  const calls = []
  let t = 1_000_000
  const { s, logs, workerUntil } = sender({
    now: () => t,
    fetch: async (url, init) => {
      calls.push(url)
      if (url === SPADE_DEFAULT) throw new TypeError('Failed to fetch')
      assert.equal(init.headers['Content-Type'], 'text/plain;charset=UTF-8')
      assert.deepEqual(JSON.parse(init.body), { url: SPADE_DEFAULT, data: 'ZGF0YQ==' })
      return json({ ok: true, status: 204 })
    },
  })
  assert.deepEqual(await s.send(SPADE_DEFAULT, 'ZGF0YQ=='), { status: 204, relayed: true })
  assert.deepEqual(calls, [SPADE_DEFAULT, `${W1}/api/spade`])
  assert.equal(workerUntil.get(), t + WORKER_STICK_MS)
  calls.length = 0
  t += MINUTE_MS
  assert.deepEqual(await s.send(SPADE_DEFAULT, 'ZGF0YQ=='), { status: 204, relayed: true })
  assert.deepEqual(calls, [`${W1}/api/spade`])
  // Une fois chaque sorte d'erreur au journal.
  assert.equal(logs.filter((m) => m.includes('envoi direct à')).length, 1)
  assert.equal(logs.filter((m) => m.includes('par le Worker pendant 24 h')).length, 1)
})

test('Worker sans la route (404) : le suivant, et le premier écarté', async () => {
  const calls = []
  const { s } = sender({
    fetch: async (url) => {
      calls.push(url)
      if (url === SPADE_DEFAULT) throw new TypeError('Failed to fetch')
      return url.startsWith(W1) ? json({ error: 'Not found' }, 404) : json({ ok: true, status: 204 })
    },
  })
  assert.deepEqual(await s.send(SPADE_DEFAULT, 'ZGF0YQ=='), { status: 204, relayed: true })
  assert.deepEqual(calls, [SPADE_DEFAULT, `${W1}/api/spade`, `${W2}/api/spade`])
  calls.length = 0
  await s.send(SPADE_DEFAULT, 'ZGF0YQ==')
  assert.deepEqual(calls, [`${W2}/api/spade`])
})

test('rien ne passe : null ; le Worker qui revient en panne rend la main au direct', async () => {
  const dead = sender({ fetch: async () => { throw new TypeError('Failed to fetch') } })
  assert.equal(await dead.s.send(SPADE_DEFAULT, 'ZGF0YQ=='), null)
  // « D'abord par le Worker », Workers en panne, direct rétabli : fini.
  const back = sender({
    workerUntil: box(Number.MAX_SAFE_INTEGER),
    fetch: async (url) => {
      if (url === SPADE_DEFAULT) return new Response(null, { status: 204 })
      throw new TypeError('Failed to fetch')
    },
  })
  assert.deepEqual(await back.s.send(SPADE_DEFAULT, 'ZGF0YQ=='), { status: 204, relayed: false })
  assert.equal(back.workerUntil.get(), 0)
})

// ── Points pendant un direct ───────────────────────────────────────────────
const TOKEN_LIKE = 'secrettoken0123456789abcd'

/** Twitch simulé : solde, série, coffre. `claim` : réponse au coffre. */
function fakeTwitch({ balance = 1000, claimId = null, streak = 7, claim = null } = {}) {
  const t = {
    balance, claimId, streak, claim, calls: [],
    async gql(body, opts = {}) {
      t.calls.push({ body, opts })
      if (Array.isArray(body) && body[0].operationName === 'BatchGetWatchStreaks') {
        assert.equal(body[0].extensions.persistedQuery.sha256Hash, HASH.streak)
        return { status: 200, json: { data: { batchGetWatchStreaks: [{ channel: { id: '42' }, value: t.streak }] } }, errors: '' }
      }
      if (Array.isArray(body) && body[0].operationName === 'ClaimCommunityPoints') {
        assert.equal(body[0].extensions.persistedQuery.sha256Hash, HASH.claim)
        return t.claim(body[0].variables.input)
      }
      assert.ok(body.query === Q.points || body.query === Q.pointsFull)
      const settings = body.query === Q.pointsFull ? { communityPointsSettings: { isEnabled: true, name: 'Kappa Coins', image: { url2x: 'https://static-cdn.jtvnw.net/kc.png' } } } : {}
      return { status: 200, json: { data: { channel: { id: '42', self: { communityPoints: { balance: t.balance, availableClaim: t.claimId ? { id: t.claimId } : null } }, ...settings } } }, errors: '' }
    },
  }
  return t
}

function core(tw, { now, bid = '314159265358', userId = '123456789' } = {}) {
  const sent = []
  const logs = []
  const notices = []
  const views = []
  const claimPause = box()
  const c = new PointsCore({
    gql: (body, opts) => tw.gql(body, opts),
    spade: { send: async (url, b64) => { sent.push({ url, b64 }); return { status: 204, relayed: false } } },
    spadeUrl: async () => SPADE_DEFAULT,
    userId: async () => userId,
    log: (m) => logs.push(m),
    claimPause,
    onChange: (v) => views.push(v),
    onNotice: (kind, n) => notices.push([kind, n]),
    now,
  })
  const start = (o = {}) => c.start({ login: 'Some_Channel', channelId: '42', broadcastId: () => bid, points: true, streak: true, ...o })
  return { c, sent, logs, notices, views, claimPause, start }
}

test('direct ouvert : solde, nom, icône et série ; une minute par minute de lecture', async () => {
  let t = 5_000_000
  const tw = fakeTwitch()
  const k = core(tw, { now: () => t })
  await k.start()
  assert.deepEqual(k.c.view(), { balance: 1000, name: 'Kappa Coins', icon: 'https://static-cdn.jtvnw.net/kc.png', gain: 0, streak: 7, chest: null })
  await k.c.tick(true)
  assert.equal(k.sent.length, 1)
  assert.equal(k.sent[0].url, SPADE_DEFAULT)
  assert.deepEqual(decode(k.sent[0].b64), minuteWatched({ channelId: '42', broadcastId: '314159265358', login: 'some_channel', userId: '123456789' }))
  t += 30_000
  await k.c.tick(true)
  assert.equal(k.sent.length, 1, 'pas deux minutes en 30 s')
  t += 30_000
  tw.balance = 1010
  await k.c.tick(true)
  assert.equal(k.sent.length, 2)
  // Gain de points passifs : « +10 » un moment, puis le solde.
  assert.equal(k.c.view().gain, 10)
  assert.equal(k.c.view().balance, 1010)
  t += GAIN_MS
  await k.c.tick(false)
  assert.equal(k.c.view().gain, 0)
  // En pause : rien ne part, ni minute ni lecture.
  const before = tw.calls.length
  t += 5 * MINUTE_MS
  await k.c.tick(false)
  assert.equal(k.sent.length, 2)
  assert.equal(tw.calls.length, before)
  // La série est relue toutes les 5 min de lecture.
  tw.streak = 8
  await k.c.tick(true)
  assert.equal(k.c.view().streak, 8)
  assert.equal(k.c.minutes, 3)
})

test('sans id du direct ou du compte : pas de minute, une ligne au journal', async () => {
  const t = 5_000_000
  const noBid = core(fakeTwitch(), { now: () => t, bid: null })
  await noBid.start()
  await noBid.c.tick(true)
  assert.equal(noBid.sent.length, 0)
  assert.equal(noBid.logs.filter((m) => m.includes('id du direct')).length, 1)
  const noUser = core(fakeTwitch(), { now: () => t, userId: '' })
  await noUser.start()
  await noUser.c.tick(true)
  assert.equal(noUser.sent.length, 0)
  assert.ok(noUser.logs.some((m) => m.includes('id du compte')))
})

test('coffre refusé sans jeton d’intégrité : un essai, l’avis, puis plus rien pour ce coffre', async () => {
  let t = 5_000_000
  const tw = fakeTwitch({
    claimId: 'c1',
    // Twitch simulé : refus d'intégrité ; son message cite un faux jeton,
    // que `errors` (websession.js, accountGql) a déjà retiré.
    claim: () => ({ status: 200, json: { errors: [{ message: `failed integrity check ${TOKEN_LIKE}` }], data: { claimCommunityPoints: null } }, errors: 'failed integrity check …' }),
  })
  const k = core(tw, { now: () => t })
  await k.start()
  await new Promise((r) => setImmediate(r))
  const claims = tw.calls.filter((x) => Array.isArray(x.body) && x.body[0].operationName === 'ClaimCommunityPoints')
  assert.equal(claims.length, 1)
  assert.deepEqual(claims[0].body[0].variables, { input: { channelID: '42', claimID: 'c1' } })
  assert.deepEqual(claims[0].opts, { expire: false })
  assert.deepEqual(k.notices, [['chest-phone', undefined]])
  assert.equal(k.c.view().chest, 'phone')
  assert.equal(k.claimPause.get(), t + CLAIM_PAUSE_MS)
  assert.ok(k.logs.some((m) => m.includes('failed integrity check')))
  assert.ok(!k.logs.join('\n').includes(TOKEN_LIKE), 'jamais le jeton au journal')
  // Le même coffre, relu : ni essai, ni avis.
  t += MINUTE_MS
  await k.c.tick(true)
  assert.equal(tw.calls.filter((x) => Array.isArray(x.body) && x.body[0].operationName === 'ClaimCommunityPoints').length, 1)
  assert.equal(k.notices.length, 1)
  // Un nouveau coffre pendant la pause de 6 h : l'avis, sans essai.
  tw.claimId = 'c2'
  t += MINUTE_MS
  await k.c.tick(true)
  assert.equal(tw.calls.filter((x) => Array.isArray(x.body) && x.body[0].operationName === 'ClaimCommunityPoints').length, 1)
  assert.equal(k.notices.length, 2)
  // Ramassé sur le téléphone : l'icône disparaît.
  tw.claimId = null
  t += MINUTE_MS
  await k.c.tick(true)
  assert.equal(k.c.view().chest, null)
  // Pause finie : le coffre suivant est de nouveau essayé (une fois).
  tw.claimId = 'c3'
  t += CLAIM_PAUSE_MS
  await k.c.tick(true)
  await new Promise((r) => setImmediate(r))
  assert.equal(tw.calls.filter((x) => Array.isArray(x.body) && x.body[0].operationName === 'ClaimCommunityPoints').length, 2)
})

test('coffre accepté : « +50 » et solde mis à jour', async () => {
  const t = 5_000_000
  const tw = fakeTwitch({ claimId: 'c1', claim: () => ({ status: 200, json: { data: { claimCommunityPoints: { currentPoints: 1050 } } }, errors: '' }) })
  const k = core(tw, { now: () => t })
  await k.start()
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(k.notices, [['chest-ok', 50]])
  assert.equal(k.c.view().balance, 1050)
  assert.equal(k.c.view().chest, null)
  // Sans currentPoints dans la réponse : le solde relu donne le gain.
  const tw2 = fakeTwitch({ claimId: 'c1', claim: () => { tw2.balance = 1060; tw2.claimId = null; return { status: 200, json: { data: { claimCommunityPoints: {} } }, errors: '' } } })
  const k2 = core(tw2, { now: () => t })
  await k2.start()
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
  assert.deepEqual(k2.notices, [['chest-ok', 60]])
  assert.equal(k2.c.view().balance, 1060)
})

test('coffre sans réponse de Twitch : un second essai, puis « sur ton téléphone »', async () => {
  let t = 5_000_000
  const tw = fakeTwitch({ claimId: 'c1', claim: () => ({ status: 0, json: null, errors: '' }) })
  const k = core(tw, { now: () => t })
  await k.start()
  await new Promise((r) => setImmediate(r))
  assert.equal(k.c.view().chest, 'retry')
  assert.equal(k.notices.length, 0)
  t += MINUTE_MS
  await k.c.tick(true)
  await new Promise((r) => setImmediate(r))
  assert.equal(tw.calls.filter((x) => Array.isArray(x.body) && x.body[0].operationName === 'ClaimCommunityPoints').length, 2)
  assert.deepEqual(k.notices, [['chest-phone', undefined]])
  assert.equal(k.claimPause.get(), 0, 'pas de pause de 6 h sans refus d’intégrité')
})

test('réglages : « Points de chaîne » coupé, rien ne part ; série seule', async () => {
  let t = 5_000_000
  const tw = fakeTwitch({ claimId: 'c1', claim: () => assert.fail('pas de coffre sans les points') })
  const k = core(tw, { now: () => t })
  await k.start({ points: false, streak: true })
  t += STREAK_MS
  await k.c.tick(true)
  assert.equal(k.sent.length, 0)
  assert.ok(tw.calls.every((x) => Array.isArray(x.body) && x.body[0].operationName === 'BatchGetWatchStreaks'))
  assert.deepEqual(k.c.view(), { balance: null, name: null, icon: null, gain: 0, streak: 7, chest: null })
  // Série coupée : pas de badge.
  const k2 = core(fakeTwitch(), { now: () => t })
  await k2.start({ streak: false })
  assert.equal(k2.c.view().streak, 0)
  // Arrêt (fermeture du lecteur) : plus rien d'affiché.
  k2.c.stop()
  assert.deepEqual(k2.views.at(-1), { balance: null, name: null, icon: null, gain: 0, streak: 0, chest: null })
})

test('aucun jeton d’intégrité dans l’app TV', () => {
  const dir = join(ROOT, 'webos', 'src')
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (e.name.endsWith('.js')) files.push(join(d, e.name))
    }
  }
  walk(dir)
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    assert.ok(!/client-integrity/i.test(text), `${f} : en-tête Client-Integrity`)
    assert.ok(!/kpsdk|kasada/i.test(text.replace(/\/\/.*$/gm, '')), `${f} : Kasada`)
  }
})
