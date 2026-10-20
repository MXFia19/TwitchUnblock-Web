// Vérifications du client de TwitchUnblock Connect (public/assets/js/connect.js),
// sans navigateur ni réseau : une fausse fenêtre (postMessage rendu à la page
// comme le fait un vrai navigateur), une fausse extension et une horloge
// simulée. Lancer : node tools/connect-check.mjs (Node 22 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ABSENT_AFTER, ConnectError, HELLO_AT, MAX_BET, OPS, cleanArgs, connect, createConnect, normalize, timeoutFor,
} from '../public/assets/js/connect.js'

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
  const slow = ['points.claim', 'watch.beat', 'predictions.bet', 'polls.vote']
  for (const op of OPS) assert.equal(timeoutFor(op), slow.includes(op) ? 45_000 : 15_000, op)
  const args = {
    'points.get': { channel: 'a' }, 'points.claim': { channel: 'a' }, 'watch.beat': { channel: 'a' },
    'predictions.get': { channel: 'a' }, 'polls.get': { channel: 'a' }, status: {}, hello: {},
    'predictions.bet': { channel: 'a', eventId: 'e', outcomeId: 'o', points: 1 },
    'polls.vote': { channel: 'a', pollId: 'p', choiceId: 'c', withPoints: false },
    'raid.join': { channel: 'a', raidId: 'abc-123' },
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
  client.destroy()
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
