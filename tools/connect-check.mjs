// Vérifications du client de TwitchUnblock Connect (public/assets/js/connect.js),
// sans navigateur ni réseau : une fausse fenêtre (postMessage rendu à la page
// comme le fait un vrai navigateur), une fausse extension et une horloge
// simulée. Lancer : node tools/connect-check.mjs (Node 22 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ABSENT_AFTER, ConnectError, HELLO_AT, MAX_BET, MAX_REWARD_INPUT, OPS, cleanArgs, connect, createConnect, normalize, timeoutFor,
} from '../public/assets/js/connect.js'
import { ConnectLive, errorText, isRepeatClick } from '../public/assets/js/chat/connect-live.js'
import { t } from '../public/assets/js/i18n.js'
// Version publiée : bandeau de mise à jour et comptage d'usage.
import { CONNECT_LATEST, INSTALL_URL, compareVersions, updateFor, usageFields } from '../public/assets/js/connect.js'
import { updateBannerHtml } from '../public/assets/js/connect-update.js'
import { esc } from '../public/assets/js/util.js'

const ORIGIN = 'https://twitchunblock.vercel.app'
const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Horloge simulée : les minuteurs ne partent qu'avec advance(). */
function fakeClock() {
  let now = 0
  let seq = 0
  const timers = new Map()
  return {
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn, seq: id }); return id },
    clearTimeout: (id) => { timers.delete(id) },
    async advance(ms) {
      const end = now + ms
      for (;;) {
        let next = null
        for (const [id, tm] of timers) {
          if (tm.at <= end && (!next || tm.at < next.tm.at || (tm.at === next.tm.at && tm.seq < next.tm.seq))) next = { id, tm }
        }
        if (!next) break
        timers.delete(next.id)
        now = next.tm.at
        next.tm.fn()
        await flush()
      }
      now = end
      await flush()
    },
    get now() { return now },
  }
}

/** Réponses d'une extension en bon état (forme du protocole v1). */
const GOOD = {
  hello: () => ({ protocol: 1, version: '1.0.0', enabled: true, browser: 'chrome' }),
  status: () => ({ enabled: true, session: { login: 'Viewer_1', userId: '123' }, settings: { autoClaim: false, allowSpend: true } }),
  'points.get': () => ({ channelId: '42', balance: 1234, claimAvailable: true, pointsName: 'Plumes', pointsIconUrl: 'https://static-cdn.jtvnw.net/x.png', watchStreak: 7 }),
  'points.claim': () => ({ claimed: 50, balance: 1284 }),
  'watch.beat': () => ({ live: true, balance: 1300, claimed: null }),
  'predictions.get': () => ({
    balance: 1300,
    event: {
      id: 'ev1', title: 'Win?', status: 'ACTIVE', createdAt: '2026-10-20T12:00:00Z', windowSeconds: 120, winningOutcomeId: null,
      outcomes: [
        { id: 'o1', title: 'Yes', color: 'BLUE', totalPoints: 500, totalUsers: 3 },
        { id: 'o2', title: 'No', color: 'PINK', totalPoints: null, totalUsers: null },
      ],
      self: null,
    },
  }),
  'predictions.bet': (a) => ({ balance: 1300 - a.points, self: { outcomeId: a.outcomeId, points: a.points } }),
  'polls.get': () => ({
    poll: {
      id: 'p1', title: 'Map?', status: 'ACTIVE', startedAt: '2026-10-20T12:00:00Z', durationSeconds: 60, totalVotes: 10,
      choices: [{ id: 'c1', title: 'A', votes: 6 }, { id: 'c2', title: 'B', votes: 4 }],
      pointsVoting: { enabled: true, cost: 100 }, self: null,
    },
  }),
  'polls.vote': () => ({ poll: null }),
  'raid.join': () => ({ joined: true }),
  'drops.get': () => ({
    channelHasDrops: true,
    campaigns: [{
      id: 'camp1', name: 'Rust drops', gameName: 'Rust', endsAt: '2026-10-30T00:00:00Z',
      drops: [
        { id: 'd1', name: 'Hoodie', imageUrl: 'https://static-cdn.jtvnw.net/d1.png', requiredMinutes: 60, currentMinutes: 60, claimed: false, dropInstanceId: '123#camp1#d1' },
        { id: 'd2', name: 'Door', imageUrl: null, requiredMinutes: 120, currentMinutes: 75, claimed: false, dropInstanceId: null },
      ],
    }],
  }),
  'drops.claim': () => ({ claimed: true }),
  'drops.pulse': () => ({ active: true, claimed: [] }),
  'rewards.get': () => ({
    balance: 1300,
    rewards: [{
      id: 'r1', title: 'Hydrate', cost: 500, prompt: null, requiresInput: false, enabled: true, paused: false, inStock: true,
      cooldownEndsAt: null, color: '#00C7AC', imageUrl: null,
    }],
  }),
  'rewards.redeem': (a) => ({ balance: 1300 - a.cost }),
}

/**
 * Fausse page : tout message posté revient à la page (comme window.postMessage),
 * et la fausse extension (content script) répond après `latency` ms.
 * `ext` : null (pas d'extension), ou des réponses par opération — une
 * fonction (args → data | { error } | { raw }).
 */
function setup({ ext = GOOD, latency = 5, origin = ORIGIN } = {}) {
  const clock = fakeClock()
  const listeners = new Set()
  const posted = []
  const win = {
    location: { origin },
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn) },
    postMessage(data, targetOrigin) {
      posted.push({ data: structuredClone(data), targetOrigin })
      const copy = structuredClone(data)
      clock.setTimeout(() => deliver(copy), 0)   // la page reçoit aussi sa propre demande
      if (ext && targetOrigin === origin) clock.setTimeout(() => answer(copy), latency)
    },
  }
  function deliver(data, { source = win, from = origin } = {}) {
    for (const fn of [...listeners]) fn({ data, source, origin: from })
  }
  function answer(m) {
    if (m?.tuConnect !== 1 || m.dir !== 'req') return
    const h = ext[m.op]
    if (!h) return deliver({ tuConnect: 1, dir: 'res', id: m.id, ok: false, error: { code: 'unknown_op' } })
    const r = h(m.args)
    if (r?.raw) return deliver({ tuConnect: 1, dir: 'res', id: m.id, ...r.raw })
    if (r?.error) return deliver({ tuConnect: 1, dir: 'res', id: m.id, ok: false, error: r.error })
    deliver({ tuConnect: 1, dir: 'res', id: m.id, ok: true, data: r })
  }
  const client = createConnect(win, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout })
  const reqs = (op) => posted.filter((p) => p.data.op === op)
  return { clock, win, posted, deliver, client, reqs, listeners }
}

/** État d'une promesse sans l'attendre. */
function track(promise) {
  const s = { done: false, value: undefined, error: undefined }
  promise.then((v) => { s.done = true; s.value = v }, (e) => { s.done = true; s.error = e })
  return s
}

// ── Détection ──────────────────────────────────────────────────────────────
test('détection : extension présente, un seul hello suffit', async () => {
  const { client, clock, reqs } = setup()
  const seen = []
  client.onChange((st) => seen.push(st.availability))
  assert.equal(client.state().availability, 'idle')
  client.start()
  assert.equal(client.state().availability, 'detecting')
  await clock.advance(20)
  assert.equal(client.state().availability, 'on')
  assert.equal(client.state().version, '1.0.0')
  assert.equal(client.state().browser, 'chrome')
  await clock.advance(10_000)
  assert.equal(reqs('hello').length, 1, 'les hello suivants ne partent plus')
  assert.deepEqual(seen, ['detecting', 'on'])
  client.destroy()
})

test('détection : sans extension, hello à 0 ; 0,5 ; 1,5 ; 3 s puis « absente »', async () => {
  const { client, clock, reqs, posted } = setup({ ext: null })
  client.start()
  await clock.advance(0)
  assert.equal(reqs('hello').length, 1)
  await clock.advance(499)
  assert.equal(reqs('hello').length, 1)
  await clock.advance(1)
  assert.equal(reqs('hello').length, 2)
  await clock.advance(1000)
  assert.equal(reqs('hello').length, 3)
  await clock.advance(1500)
  assert.equal(reqs('hello').length, 4)
  assert.deepEqual(HELLO_AT, [0, 500, 1500, 3000])
  assert.equal(client.state().availability, 'detecting')
  await clock.advance(ABSENT_AFTER - 3000 - 1)
  assert.equal(client.state().availability, 'detecting')
  await clock.advance(1)
  assert.equal(client.state().availability, 'absent')
  // Les hello sans réponse expirent (15 s) sans rien laisser en attente.
  await clock.advance(20_000)
  assert.equal(client.pendingCount(), 0)
  assert.ok(posted.every((p) => p.targetOrigin === ORIGIN), 'toujours vers sa propre origine')
  client.destroy()
})

test('détection : annonce tardive (extension installée après) → présente', async () => {
  const { client, clock, deliver } = setup({ ext: null })
  client.start()
  await clock.advance(5000)
  assert.equal(client.state().availability, 'absent')
  deliver({ tuConnect: 1, dir: 'hello', protocol: 1, version: '1.1.0', enabled: true })
  assert.equal(client.state().availability, 'on')
  assert.equal(client.state().version, '1.1.0')
  client.destroy()
})

test('détection : annonce « connexion coupée » → off, et plus de hello', async () => {
  const { client, clock, deliver, reqs } = setup({ ext: null })
  client.start()
  await clock.advance(0)
  deliver({ tuConnect: 1, dir: 'hello', protocol: 1, version: '1.0.0', enabled: false })
  assert.equal(client.state().availability, 'off')
  await clock.advance(5000)
  assert.equal(reqs('hello').length, 1)
  assert.equal(client.state().availability, 'off', 'pas « absente » après une annonce')
  client.destroy()
})

test('détection : annonce d’un autre protocole ou mal formée → ignorée', async () => {
  const { client, clock, deliver } = setup({ ext: null })
  client.start()
  deliver({ tuConnect: 1, dir: 'hello', protocol: 2, version: '9', enabled: true })
  deliver({ tuConnect: 1, dir: 'hello', protocol: 1, version: '1', enabled: 'yes' })
  deliver({ tuConnect: 1, dir: 'hello', protocol: 1 })
  assert.equal(client.state().availability, 'detecting')
  await clock.advance(5000)
  assert.equal(client.state().availability, 'absent')
  client.destroy()
})

// ── Messages étrangers ─────────────────────────────────────────────────────
test('messages étrangers ignorés (autre fenêtre, autre origine, autre marque, écho, id inconnu)', async () => {
  const { client, clock, deliver, posted } = setup({ ext: null })
  const r = track(client.request('points.get', { channel: 'xqc' }))
  const id = posted.at(-1).data.id
  const res = { tuConnect: 1, dir: 'res', id, ok: true, data: GOOD['points.get']() }
  deliver(res, { source: {} })                              // autre fenêtre (iframe…)
  deliver(res, { source: null })
  deliver(res, { from: 'https://evil.example' })             // autre origine
  deliver(res, { from: 'https://twitchunblock.vercel.app.evil.example' })
  deliver({ ...res, tuConnect: 2 })                          // pas notre protocole
  deliver({ ...res, tuConnect: '1' })
  deliver({ ...res, dir: 'req' })                            // une demande, pas une réponse
  deliver({ ...res, id: 'tu-autre' })                        // demande inconnue
  deliver(null)
  deliver('{"tuConnect":1}')
  deliver([res])
  deliver({ tuConnect: 1, dir: 'hello', protocol: 1, version: 'x', enabled: true }, { from: 'https://evil.example' })
  await clock.advance(10)                                    // l'écho de notre propre demande passe aussi
  assert.equal(r.done, false)
  assert.equal(client.state().availability, 'idle', 'annonce étrangère sans effet')
  deliver(res)
  await flush()
  assert.equal(r.done, true)
  assert.equal(r.value.balance, 1234)
  // Une réponse en double pour le même id ne fait plus rien.
  deliver({ ...res, data: { ...res.data, balance: 1 } })
  await flush()
  assert.equal(r.value.balance, 1234)
  client.destroy()
})

// ── Demandes, délais ───────────────────────────────────────────────────────
test('demande : forme exacte, origine de la page, envoi immédiat (geste de l’utilisateur)', async () => {
  const { client, clock, posted } = setup()
  const before = posted.length
  const p = client.request('predictions.bet', { channel: 'XQC', eventId: 'ev1', outcomeId: 'o1', points: 100 })
  // Partie dans l'appel même, sans attendre : un clic compte encore.
  assert.equal(posted.length, before + 1)
  const sent = posted.at(-1)
  assert.equal(sent.targetOrigin, ORIGIN)
  assert.deepEqual(Object.keys(sent.data).sort(), ['args', 'dir', 'id', 'op', 'tuConnect'])
  assert.equal(sent.data.tuConnect, 1)
  assert.equal(sent.data.dir, 'req')
  assert.equal(sent.data.op, 'predictions.bet')
  assert.deepEqual(sent.data.args, { channel: 'xqc', eventId: 'ev1', outcomeId: 'o1', points: 100 })
  assert.ok(typeof sent.data.id === 'string' && sent.data.id.length > 0 && sent.data.id.length <= 64)
  await clock.advance(10)
  assert.deepEqual(await p, { balance: 1200, self: { outcomeId: 'o1', points: 100 } })
  client.destroy()
})

test('identifiants de demande uniques', () => {
  const { client, posted } = setup({ ext: null })
  for (let i = 0; i < 200; i++) client.request('status').catch(() => {})
  const ids = new Set(posted.map((p) => p.data.id))
  assert.equal(ids.size, 200)
  client.destroy()
})

test('délais d’attente : 15 s, et 45 s pour ce qui peut demander un jeton d’intégrité', async () => {
  const slow = ['points.claim', 'watch.beat', 'predictions.bet', 'polls.vote', 'raid.join', 'drops.claim', 'drops.pulse', 'rewards.redeem', 'hq.master']
  for (const op of OPS) assert.equal(timeoutFor(op), slow.includes(op) ? 45_000 : 15_000, op)
  // Pulsation : le jeton de lecture du compte peut demander un jeton
  // d'intégrité (jusqu'à ~40 s) ; à 15 s, la réponse et ses drops réclamés
  // se perdaient, et la suivante partait pendant la première.
  assert.equal(timeoutFor('drops.pulse'), 45_000)
  const args = {
    'points.get': { channel: 'a' }, 'points.claim': { channel: 'a' }, 'watch.beat': { channel: 'a' },
    'predictions.get': { channel: 'a' }, 'polls.get': { channel: 'a' }, status: {}, hello: {},
    'predictions.bet': { channel: 'a', eventId: 'e', outcomeId: 'o', points: 1 },
    'polls.vote': { channel: 'a', pollId: 'p', choiceId: 'c', withPoints: false },
    'raid.join': { channel: 'a', raidId: 'abc-123' },
    'drops.get': { channel: 'a' }, 'drops.pulse': { channel: 'a' }, 'drops.claim': { dropInstanceId: '1#2#3' },
    'rewards.get': { channel: 'a' }, 'rewards.redeem': { channel: 'a', rewardId: 'r', cost: 10, title: 'T', prompt: null, input: null },
    'hq.master': { channel: 'a', codecs: ['h264'] }, 'hq.playlist': { id: 'A'.repeat(22) },
  }
  for (const op of OPS) {
    const { client, clock } = setup({ ext: null })
    const r = track(client.request(op, args[op]))
    await clock.advance(timeoutFor(op) - 1)
    assert.equal(r.done, false, `${op} encore en attente`)
    await clock.advance(1)
    assert.ok(r.error instanceof ConnectError, op)
    assert.equal(r.error.code, 'timeout', op)
    assert.equal(client.pendingCount(), 0)
    client.destroy()
  }
})

test('arguments vérifiés avant tout envoi', async () => {
  const { client, posted } = setup()
  const bad = [
    ['points.get', { channel: '' }], ['points.get', { channel: 'a-b' }], ['points.get', { channel: 'x'.repeat(26) }],
    ['points.get', {}], ['points.get', null], ['watch.beat', { channel: 42 }],
    ['predictions.bet', { channel: 'a', eventId: 'e', outcomeId: 'o', points: 0 }],
    ['predictions.bet', { channel: 'a', eventId: 'e', outcomeId: 'o', points: MAX_BET + 1 }],
    ['predictions.bet', { channel: 'a', eventId: 'e', outcomeId: 'o', points: 1.5 }],
    ['predictions.bet', { channel: 'a', eventId: 'e', outcomeId: 'o', points: '10' }],
    ['predictions.bet', { channel: 'a', eventId: '', outcomeId: 'o', points: 10 }],
    ['polls.vote', { channel: 'a', pollId: 'p', choiceId: 'c' }],
    ['polls.vote', { channel: 'a', pollId: 'p', choiceId: 'c', withPoints: 'yes' }],
    ['raid.join', { channel: 'a', raidId: 'a b' }], ['raid.join', { channel: 'a', raidId: 'x'.repeat(65) }], ['raid.join', { channel: 'a' }],
    ['drops.claim', {}], ['drops.claim', { dropInstanceId: 'a b' }], ['drops.claim', { dropInstanceId: 'x'.repeat(201) }],
    ['drops.claim', { dropInstanceId: 42 }], ['drops.get', { channel: 'A B' }], ['drops.pulse', {}],
    ['rewards.redeem', { channel: 'a', rewardId: 'r', cost: 0, title: 'T' }],
    ['rewards.redeem', { channel: 'a', rewardId: 'r', cost: 1.5, title: 'T' }],
    ['rewards.redeem', { channel: 'a', rewardId: '', cost: 10, title: 'T' }],
    ['rewards.redeem', { channel: 'a', rewardId: 'r', cost: 10 }],
    ['rewards.redeem', { channel: 'a', rewardId: 'r', cost: 10, title: 'T', input: '' }],
    ['rewards.redeem', { channel: 'a', rewardId: 'r', cost: 10, title: 'T', input: '   ' }],
    ['rewards.redeem', { channel: 'a', rewardId: 'r', cost: 10, title: 'T', input: 'x'.repeat(MAX_REWARD_INPUT + 1) }],
    ['rewards.redeem', { channel: 'a', rewardId: 'r', cost: 10, title: 'T', prompt: 5 }],
  ]
  for (const [op, a] of bad) {
    await assert.rejects(client.request(op, a), (e) => e instanceof ConnectError && e.code === 'bad_args', `${op} ${JSON.stringify(a)}`)
  }
  await assert.rejects(client.request('gql.raw', {}), (e) => e.code === 'unknown_op')
  await assert.rejects(client.request('__proto__', {}), (e) => e.code === 'unknown_op')
  assert.equal(posted.length, 0, 'rien n’est parti')
  assert.deepEqual(cleanArgs('predictions.bet', { channel: 'A', eventId: 'e', outcomeId: 'o', points: MAX_BET, extra: 1 }),
    { channel: 'a', eventId: 'e', outcomeId: 'o', points: MAX_BET })
  assert.deepEqual(cleanArgs('status', { anything: 1 }), {})
  // drops.claim : seulement l'instance du drop (pas de chaîne).
  assert.deepEqual(cleanArgs('drops.claim', { dropInstanceId: '1#c:2.d-3_x', channel: 'a' }), { dropInstanceId: '1#c:2.d-3_x' })
  assert.deepEqual(cleanArgs('rewards.redeem', { channel: 'A', rewardId: 'r', cost: 10, title: 'T', input: 'x'.repeat(MAX_REWARD_INPUT) }),
    { channel: 'a', rewardId: 'r', cost: 10, title: 'T', prompt: null, input: 'x'.repeat(MAX_REWARD_INPUT) })
  client.destroy()
})

test('drops et récompenses : demandes et réponses relues', async () => {
  const { client, clock, posted } = setup()
  const drops = track(client.request('drops.get', { channel: 'Rust_Streamer' }))
  const claim = track(client.request('drops.claim', { dropInstanceId: '123#camp1#d1' }))
  const pulse = track(client.request('drops.pulse', { channel: 'rust_streamer' }))
  const rewards = track(client.request('rewards.get', { channel: 'rust_streamer' }))
  // Récompense : la demande part dans l'appel même (clic de confirmation).
  const before = posted.length
  const redeem = track(client.request('rewards.redeem', { channel: 'rust_streamer', rewardId: 'r1', cost: 500, title: 'Hydrate', prompt: null, input: null }))
  assert.equal(posted.length, before + 1)
  assert.deepEqual(posted.at(-1).data.args, { channel: 'rust_streamer', rewardId: 'r1', cost: 500, title: 'Hydrate', prompt: null, input: null })
  assert.deepEqual(posted.find((p) => p.data.op === 'drops.claim').data.args, { dropInstanceId: '123#camp1#d1' })
  await clock.advance(10)
  const camp = drops.value.campaigns[0]
  assert.equal(drops.value.channelHasDrops, true)
  assert.equal(camp.endsAt, Date.parse('2026-10-30T00:00:00Z'))
  assert.deepEqual(camp.drops.map((d) => d.dropInstanceId), ['123#camp1#d1', null])
  assert.deepEqual(claim.value, { claimed: true })
  assert.deepEqual(pulse.value, { active: true, claimed: [] })
  assert.equal(rewards.value.rewards[0].color, '#00C7AC')
  assert.deepEqual(redeem.value, { balance: 800 })
  client.destroy()
})

test('drops et récompenses : valeurs douteuses écartées, formes invalides refusées', () => {
  // Couleur et image finissent dans la page : seulement #hex et https.
  const r = normalize('rewards.get', { balance: 1, rewards: [{ id: 'r', title: 'T', cost: 1, requiresInput: true, enabled: true, paused: false, inStock: true, color: 'red;background:url(x)', imageUrl: 'data:image/png;base64,AA', cooldownEndsAt: 'bientôt' }] }).rewards[0]
  assert.equal(r.color, null)
  assert.equal(r.imageUrl, null)
  assert.equal(r.cooldownEndsAt, null)
  assert.equal(r.prompt, null)
  const d = normalize('drops.get', { channelHasDrops: false, campaigns: [{ id: 'c', name: 'C', drops: [{ id: 'x', name: 'X', requiredMinutes: 10, currentMinutes: 3, claimed: false, dropInstanceId: 'bad id', imageUrl: 'http://x/y.png' }] }] })
  assert.equal(d.campaigns[0].drops[0].dropInstanceId, null)
  assert.equal(d.campaigns[0].drops[0].imageUrl, null)
  assert.equal(d.campaigns[0].gameName, null)
  assert.deepEqual(normalize('drops.pulse', { active: false, claimed: ['A', 3, null, 'B'] }), { active: false, claimed: ['A', 'B'] })
  for (const bad of [
    ['drops.get', { campaigns: [] }], ['drops.get', { channelHasDrops: true }],
    ['drops.get', { channelHasDrops: true, campaigns: [{ id: 'c', drops: [{ id: 'x', claimed: false, requiredMinutes: 'dix', currentMinutes: 0 }] }] }],
    ['drops.get', { channelHasDrops: true, campaigns: [{ id: 'c', drops: [{ id: 'x', requiredMinutes: 1, currentMinutes: 0 }] }] }],
    ['drops.claim', { claimed: 'oui' }], ['drops.pulse', { active: true }], ['drops.pulse', { claimed: [] }],
    ['rewards.get', { balance: 1 }], ['rewards.get', { balance: 1, rewards: [{ id: 'r', cost: -1, requiresInput: false, enabled: true, paused: false, inStock: true }] }],
    ['rewards.get', { balance: 1, rewards: [{ id: 'r', cost: 1, enabled: true, paused: false, inStock: true }] }],
    ['rewards.redeem', { balance: 'x' }],
  ]) assert.equal(normalize(...bad), null, JSON.stringify(bad))
})

// ── Réponses ───────────────────────────────────────────────────────────────
test('réponses mal formées → erreur « internal », jamais de données inventées', async () => {
  const cases = {
    'points.get': [{ raw: { ok: true } }, { raw: { ok: true, data: null } }, { raw: { ok: true, data: [] } },
      { balance: '12', claimAvailable: true }, { balance: -1, claimAvailable: true }, { balance: 5 }],
    status: [{ enabled: true, session: null }, { enabled: 'yes', session: null, settings: { autoClaim: true, allowSpend: true } },
      { enabled: true, session: { login: 'bad login!' }, settings: { autoClaim: true, allowSpend: true } },
      { enabled: true, session: 'me', settings: { autoClaim: true, allowSpend: true } }],
    'predictions.get': [{ balance: 1, event: { id: 'e', status: 'ACTIVE', outcomes: 'x' } },
      { balance: 1, event: { id: 'e', status: 'WEIRD', outcomes: [] } },
      { balance: 1, event: { id: 'e', status: 'ACTIVE', outcomes: [] } },
      { balance: 1, event: { id: 'e', status: 'ACTIVE', outcomes: [{ title: 'no id' }] } },
      { balance: 1, event: { id: 'e', status: 'ACTIVE', outcomes: [{ id: 'o' }], self: { outcomeId: 'o' } } },
      { balance: 'x', event: null }],
    'predictions.bet': [{ balance: 1 }, { balance: 1, self: null }],
    'polls.get': [{}, { poll: { id: 'p', status: 'ACTIVE', choices: [] } }, { poll: { id: 'p', status: 'OPEN', choices: [{ id: 'c' }] } },
      { poll: { id: 'p', status: 'ACTIVE', choices: [{ id: 'c' }], self: { choiceIds: 'c' } } }],
    'raid.join': [{}, { joined: 'yes' }],
    'watch.beat': [{ balance: 1 }, { live: true, claimed: 'x' }],
    'points.claim': [{ claimed: -5, balance: 1 }],
  }
  const args = {
    'points.get': { channel: 'a' }, status: {}, 'predictions.get': { channel: 'a' }, 'polls.get': { channel: 'a' },
    'predictions.bet': { channel: 'a', eventId: 'e', outcomeId: 'o', points: 1 }, 'raid.join': { channel: 'a', raidId: 'r1' },
    'watch.beat': { channel: 'a' }, 'points.claim': { channel: 'a' },
  }
  for (const [op, list] of Object.entries(cases)) {
    for (const data of list) {
      const { client, clock } = setup({ ext: { ...GOOD, [op]: () => data } })
      const r = track(client.request(op, args[op]))
      await clock.advance(10)
      assert.ok(r.error, `${op} ${JSON.stringify(data)} devrait échouer`)
      assert.equal(r.error.code, 'internal', `${op} ${JSON.stringify(data)}`)
      client.destroy()
    }
  }
  // Erreur sans code, ou ni ok ni erreur : mal formée aussi.
  for (const raw of [{ ok: false }, { ok: false, error: {} }, { ok: false, error: { code: '' } }, { ok: 'true', data: {} }, {}]) {
    const { client, clock } = setup({ ext: { ...GOOD, 'points.get': () => ({ raw }) } })
    const r = track(client.request('points.get', { channel: 'a' }))
    await clock.advance(10)
    assert.equal(r.error?.code, 'internal', JSON.stringify(raw))
    client.destroy()
  }
})

test('réponses valides relues : champs inconnus à null, adresses d’icône en https seulement', () => {
  const p = normalize('points.get', { ...GOOD['points.get'](), extra: 'x', pointsIconUrl: 'javascript:alert(1)' })
  assert.deepEqual(p, { channelId: '42', balance: 1234, claimAvailable: true, pointsName: 'Plumes', pointsIconUrl: null, watchStreak: 7 })
  assert.equal(normalize('points.get', { balance: 0, claimAvailable: false, pointsIconUrl: 'http://x.test/a.png' }).pointsIconUrl, null)
  assert.equal(normalize('points.get', { balance: 0, claimAvailable: false }).watchStreak, null, 'série inconnue : null')
  assert.equal(normalize('points.get', { balance: 0, claimAvailable: false, watchStreak: 'x' }).watchStreak, null)
  assert.equal(normalize('points.get', { balance: 0, claimAvailable: false, channelId: null, pointsName: null }).pointsName, null)
  const s = normalize('status', GOOD.status())
  assert.deepEqual(s, { enabled: true, session: { login: 'viewer_1', userId: '123' }, settings: { autoClaim: false, allowSpend: true } })
  assert.deepEqual(normalize('status', { enabled: true, session: null, settings: { autoClaim: true, allowSpend: false } }).session, null)
  const ev = normalize('predictions.get', GOOD['predictions.get']()).event
  assert.equal(ev.createdAt, Date.parse('2026-10-20T12:00:00Z'))
  assert.equal(ev.outcomes[1].totalPoints, null, 'inconnu de Twitch : null')
  assert.equal(ev.outcomes[1].color, 'PINK')
  assert.equal(normalize('predictions.get', { balance: null, event: null }).event, null)
  const poll = normalize('polls.get', GOOD['polls.get']()).poll
  assert.deepEqual(poll.pointsVoting, { enabled: true, cost: 100 })
  assert.equal(normalize('polls.get', { poll: null }).poll, null)
  assert.deepEqual(normalize('raid.join', { joined: false }), { joined: false })
  assert.deepEqual(normalize('watch.beat', { live: false }), { live: false, claimed: null, balance: null })
  assert.equal(normalize('hello', { protocol: 1, enabled: true, version: 7 }).version, null)
})

test('erreurs de l’extension : code et message transmis, état mis à jour', async () => {
  let session = true
  const ext = {
    ...GOOD,
    status: () => ({ enabled: true, session: session ? { login: 'me', userId: '1' } : null, settings: { autoClaim: true, allowSpend: true } }),
    'points.get': () => ({ error: { code: 'no_session' } }),
    'predictions.bet': () => ({ error: { code: 'spend_disabled' } }),
    'polls.vote': () => ({ error: { code: 'twitch', message: 'NOT_ENOUGH_POINTS' } }),
    'watch.beat': () => ({ error: { code: 'disabled' } }),
  }
  const { client, clock } = setup({ ext })
  client.start()
  await clock.advance(10)
  const st = track(client.refreshStatus())
  await clock.advance(10)
  assert.equal(st.value.session.login, 'me')
  assert.deepEqual(client.state().session, { login: 'me', userId: '1' })

  const bet = track(client.request('predictions.bet', { channel: 'a', eventId: 'e', outcomeId: 'o', points: 5 }))
  await clock.advance(10)
  assert.equal(bet.error.code, 'spend_disabled')
  assert.equal(client.state().settings.allowSpend, false)

  const vote = track(client.request('polls.vote', { channel: 'a', pollId: 'p', choiceId: 'c', withPoints: true }))
  await clock.advance(10)
  assert.equal(vote.error.code, 'twitch')
  assert.equal(vote.error.detail, 'NOT_ENOUGH_POINTS')

  session = false
  const pts = track(client.request('points.get', { channel: 'a' }))
  await clock.advance(10)
  assert.equal(pts.error.code, 'no_session')
  assert.equal(client.state().session, null)

  const beat = track(client.request('watch.beat', { channel: 'a' }))
  await clock.advance(10)
  assert.equal(beat.error.code, 'disabled')
  assert.equal(client.state().availability, 'off')
  client.destroy()
})

test('abonnement aux changements, et désabonnement', async () => {
  const { client, clock } = setup()
  const a = []
  const b = []
  const offA = client.onChange((st) => a.push(st.availability))
  client.onChange(() => { throw new Error('abonné en erreur') })
  client.onChange((st) => b.push(st.availability))
  client.start()
  offA()
  await clock.advance(10)
  assert.deepEqual(a, ['detecting'])
  assert.deepEqual(b, ['detecting', 'on'], 'un abonné en erreur ne prive pas les autres')
  client.destroy()
})

test('sans fenêtre (Node), le client de la page refuse proprement', async () => {
  assert.equal(connect.state().availability, 'idle')
  connect.start()
  assert.equal(connect.state().availability, 'idle')
  await assert.rejects(connect.request('status'), (e) => e.code === 'internal')
})

test('destroy : plus d’écoute ni de minuteur', async () => {
  const { client, clock, listeners } = setup({ ext: null })
  client.start()
  const r = track(client.request('status'))
  client.destroy()
  await flush()
  assert.equal(r.error?.code, 'timeout')
  assert.equal(listeners.size, 0)
  await clock.advance(60_000)
  assert.equal(client.pendingCount(), 0)
})

// ── Version publiée : bandeau de mise à jour, comptage d'usage ────────────
const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
/** État du client tel que le rend connect.state(), session et réglages compris. */
const cxState = (availability, version = '0.1.0', browser = 'chrome') => ({
  availability, version, browser, session: { login: 'moi', userId: '1' }, settings: { autoClaim: true, allowSpend: false },
})

test('versions comparées nombre par nombre', () => {
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1)
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1, 'pas en texte')
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0)
  assert.equal(compareVersions('1.2.3.4', '1.2.3'), 1)
  for (const bad of [null, undefined, '', 'v0.1.0', '0.1.0-beta', '0..1', '1.2.3.4.5', 12]) {
    assert.ok(Number.isNaN(compareVersions(bad, '0.2.0')), String(bad))
    assert.ok(Number.isNaN(compareVersions('0.2.0', bad)), String(bad))
  }
})

test('mise à jour proposée seulement à une extension détectée plus ancienne', () => {
  assert.deepEqual(updateFor(cxState('on', '0.1.0'), '0.2.0'), { latest: '0.2.0', current: '0.1.0' })
  assert.deepEqual(updateFor(cxState('off', '0.1.9'), '0.2.0'), { latest: '0.2.0', current: '0.1.9' }, 'connexion au site coupée : installée quand même')
  assert.equal(updateFor(cxState('on', '0.2.0'), '0.2.0'), null, 'à jour')
  assert.equal(updateFor(cxState('on', '0.10.0'), '0.2.0'), null, 'plus récente (développement)')
  for (const a of ['idle', 'detecting', 'absent']) assert.equal(updateFor(cxState(a, '0.1.0'), '0.2.0'), null, a)
  for (const v of [null, 'n/a']) assert.equal(updateFor(cxState('on', v), '0.2.0'), null, String(v))
  assert.equal(updateFor(cxState('on', CONNECT_LATEST)), null, 'dernière publiée par défaut')
})

test('bandeau : versions, lien de téléchargement, étapes du navigateur, texte échappé', () => {
  const upd = { latest: '0.2.0', current: '0.1.0' }
  const has = (html, key, params) => html.includes(esc(t(key, params)))
  const chrome = updateBannerHtml(upd, 'chrome')
  assert.ok(has(chrome, 'connect_update', { v: '0.2.0', cur: '0.1.0' }))
  assert.ok(chrome.includes(`href="${esc(INSTALL_URL)}"`) && chrome.includes('rel="noopener"'))
  assert.ok(has(chrome, 'connect_update_chrome') && !has(chrome, 'connect_update_firefox'))
  const firefox = updateBannerHtml(upd, 'firefox')
  assert.ok(has(firefox, 'connect_update_firefox') && !has(firefox, 'connect_update_chrome'))
  const unknown = updateBannerHtml(upd, null)
  assert.ok(has(unknown, 'connect_update_chrome') && has(unknown, 'connect_update_firefox'), 'navigateur inconnu : les deux')
  assert.ok(chrome.includes('data-cxu-close'), 'fermable')
  assert.ok(!updateBannerHtml({ latest: '<img src=x>', current: '"><b>' }).includes('<img'), 'échappé')
})

test('comptage d’usage : version et navigateur de l’extension, ou son absence, rien d’autre', () => {
  assert.deepEqual(usageFields(cxState('on')), { ext: '0.1.0', extBrowser: 'chrome' })
  assert.deepEqual(usageFields(cxState('off', '0.2.0', 'firefox')), { ext: '0.2.0', extBrowser: 'firefox' }, 'connexion coupée : installée')
  assert.deepEqual(usageFields(cxState('absent', null, null)), { ext: 'none' })
  for (const a of ['idle', 'detecting']) assert.deepEqual(usageFields(cxState(a)), {}, `${a} : on ne sait pas encore`)
  // Navigateur pas encore donné par `hello` : celui de la page.
  assert.equal(usageFields(cxState('on', '0.1.0', null), UA_FIREFOX).extBrowser, 'firefox')
  assert.equal(usageFields(cxState('on', '0.1.0', null), UA_EDGE).extBrowser, 'chrome')
  assert.equal(usageFields(cxState('on', '0.1.0', null), 'Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15').extBrowser, 'other')
  // Version hors du format compté : rien (le Worker l'ignorerait).
  for (const v of [null, '1.0', '0.1.0.1', '0.1.0-beta', '9'.repeat(40)]) assert.deepEqual(usageFields(cxState('on', v)), {}, String(v))
})

test('comptage d’usage d’après la détection : hello, puis annonce seule', async () => {
  const withExt = setup()
  withExt.client.start()
  await withExt.clock.advance(10)
  assert.deepEqual(usageFields(withExt.client.state()), { ext: '1.0.0', extBrowser: 'chrome' })
  assert.deepEqual(updateFor(withExt.client.state(), '1.1.0'), { latest: '1.1.0', current: '1.0.0' })
  withExt.client.destroy()

  const { client, clock, deliver } = setup({ ext: null })
  client.start()
  await clock.advance(5000)
  assert.deepEqual(usageFields(client.state()), { ext: 'none' })
  // Installée page ouverte : l'annonce donne la version, pas le navigateur.
  deliver({ tuConnect: 1, dir: 'hello', protocol: 1, version: '0.1.0', enabled: true })
  assert.equal(client.state().browser, null)
  assert.deepEqual(usageFields(client.state(), UA_FIREFOX), { ext: '0.1.0', extBrowser: 'firefox' })
  client.destroy()
})

// ── Lecteur (chat/connect-live.js), sans DOM : seulement ce qui s'en passe ──
/** Un ConnectLive sans vue ni document, pour une méthode à la fois. */
function fakeLive({ availability = 'on', session = { login: 'moi', userId: '1' }, ...extra } = {}) {
  let statusReads = 0
  const connect = {
    state: () => ({ availability, session, settings: { autoClaim: true, allowSpend: true } }),
    refreshStatus: async () => { statusReads++ },
  }
  const live = Object.assign(Object.create(ConnectLive.prototype), {
    channel: 'chaine', gen: 0, connect, at: { status: 0 }, busy: {}, ...extra,
  })
  return { live, statusReads: () => statusReads }
}

test('lecteur : refus « bad_args » de l’extension expliqués (prédiction fermée, points, récompense…)', () => {
  const bad = (detail) => new ConnectError('bad_args', detail)
  for (const d of ['not_active', 'eventId', 'pollId']) assert.equal(errorText(bad(d)), t('connect_err_closed'), d)
  assert.equal(errorText(bad('points')), t('connect_err_points'))
  assert.equal(errorText(bad('points'), 'reward'), t('connect_err_points'))
  assert.equal(errorText(bad('other_outcome')), t('pred_one_outcome'))
  for (const d of ['paused', 'out_of_stock', 'cooldown', 'not_enabled', 'points_disabled']) {
    assert.equal(errorText(bad(d), 'reward'), t('reward_err_unavailable'), d)
  }
  for (const d of ['cost', 'title', 'rewardId']) assert.equal(errorText(bad(d), 'reward'), t('reward_err_changed'), d)
  assert.equal(errorText(bad('input'), 'reward'), t('reward_input_needed'))
  // Raison inconnue, ou demande refusée par le site lui-même : le code, comme avant.
  assert.equal(errorText(bad('outcomeId')), t('connect_err_other', { c: 'bad_args' }))
  assert.equal(errorText(new ConnectError('bad_args')), t('connect_err_other', { c: 'bad_args' }))
  assert.equal(errorText(new ConnectError('twitch', 'NOT_ENOUGH_POINTS')), t('connect_err_points'))
  assert.equal(errorText(new ConnectError('timeout')), t('connect_err_timeout'))
})

test('lecteur : le second clic d’un double-clic ne confirme ni mise ni échange', () => {
  assert.equal(isRepeatClick({ detail: 0 }), false)   // clavier : Entrée, Espace
  assert.equal(isRepeatClick({ detail: 1 }), false)
  assert.equal(isRepeatClick({ detail: 2 }), true)
  const confirm = (detail) => ({ detail, currentTarget: {}, target: { closest: (s) => (s === '[data-cx-confirm]' ? {} : null) } })
  const { live } = fakeLive({ view: { pred: { id: 'e1' }, el: { rewards: {} } }, bet: { id: 'e1' }, rw: { step: 'confirm' } })
  let bets = 0
  let redeems = 0
  live.placeBet = () => { bets++ }
  live.redeem = () => { redeems++ }
  live.onActClick(confirm(2))
  live.onRewardsClick(confirm(2))
  assert.deepEqual([bets, redeems], [0, 0])
  for (const d of [1, 0]) { live.onActClick(confirm(d)); live.onRewardsClick(confirm(d)) }
  assert.deepEqual([bets, redeems], [2, 2])
})

test('lecteur : état relu connexion coupée ou sans session, jamais extension absente', () => {
  for (const [availability, session, reads] of [['off', null, 1], ['on', null, 1], ['absent', undefined, 0], ['detecting', undefined, 0]]) {
    const { live, statusReads } = fakeLive({ availability, session })
    live.tick()
    live.tick()   // pas plus d'une fois par STATUS_EVERY
    assert.equal(statusReads(), reads, availability)
    assert.equal(live.installed(), reads === 1, availability)
  }
})

test('lecteur : carte du sondage retirée → son compte à rebours arrêté', () => {
  const timer = setInterval(() => {}, 60_000)
  const { live } = fakeLive({ availability: 'off', session: null, view: { el: { events: { querySelector: () => null } } }, tpoll: { id: 'p' }, pollTimer: timer })
  live.renderPoll()
  clearInterval(timer)
  assert.equal(live.pollTimer, null)
})
