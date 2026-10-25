// ═══════════════════════════════════════════════════════════════════════════
//  TwitchUnblock Connect : client du pont entre le site et l'extension.
//  Le site ne peut pas se servir de la session web Twitch (cookie de
//  twitch.tv) ; l'extension la garde chez elle et fait pour le site une
//  liste fermée d'opérations : points gagnés en regardant, coffres,
//  prédictions, sondages, bonus de raid, drops, récompenses de la chaîne.
//  Protocole commun : extension/PROTOCOL.md (v1).
//  Tout passe par window.postMessage vers la page elle-même (sa propre
//  origine), que le content script de l'extension écoute : rien ne part
//  vers le Worker ni le relais, et rien n'est compté (usage.js).
//  Sans `window` (vérifications Node), le module se charge quand même :
//  createConnect() prend une fausse fenêtre.
// ═══════════════════════════════════════════════════════════════════════════

export const PROTOCOL = 1
// Dernière release (workflow « Extension » sur main) : les deux zips à
// télécharger sans compte GitHub, et les étapes d'installation en anglais.
export const INSTALL_URL = 'https://github.com/MXFia19/TwitchUnblock-Web/releases/latest'

/** Liste fermée du protocole : rien d'autre ne part. `hq.*` : extension
 *  0.2.0 et plus seulement (qualités supérieures, hq.js). */
export const OPS = Object.freeze(['hello', 'status', 'points.get', 'points.claim', 'watch.beat',
  'predictions.get', 'predictions.bet', 'polls.get', 'polls.vote', 'raid.join',
  'drops.get', 'drops.claim', 'drops.pulse', 'rewards.get', 'rewards.redeem',
  'hq.master', 'hq.playlist'])
/** Peuvent devoir obtenir un jeton d'intégrité Twitch : 45 s au lieu de 15.
 *  `drops.pulse` et `hq.master` aussi : le jeton de lecture du compte peut en
 *  demander un. */
const SLOW_OPS = new Set(['points.claim', 'watch.beat', 'predictions.bet', 'polls.vote',
  'raid.join', 'drops.claim', 'drops.pulse', 'rewards.redeem', 'hq.master'])
export const timeoutFor = (op) => (SLOW_OPS.has(op) ? 45_000 : 15_000)

/** Détection : `hello` à 0 ; 0,5 ; 1,5 et 3 s, tant que rien n'a répondu. */
export const HELLO_AT = Object.freeze([0, 500, 1500, 3000])
/** Toujours rien 1,5 s après le dernier : absente. Une annonce plus tardive
 *  (extension installée ou rechargée entre-temps) la rend présente. */
export const ABSENT_AFTER = 4500

/** Mise d'une prédiction : entier de 1 à 250 000 (règle de Twitch). */
export const MAX_BET = 250_000
const LOGIN_RE = /^[a-z0-9_]{1,25}$/
const RAID_ID_RE = /^[A-Za-z0-9-]{1,64}$/
const DROP_INSTANCE_RE = /^[A-Za-z0-9#._:-]{1,200}$/
/** Variante de la liste du compte : identifiant opaque de l'extension. */
const HQ_ID_RE = /^[A-Za-z0-9]{22}$/
/** Codecs annoncés à Twitch (hq.master), du plus efficace au plus courant. */
export const HQ_CODECS = Object.freeze(['av1', 'h265', 'h264'])
/** Texte d'une récompense qui en demande un : 1 à 200 caractères. */
export const MAX_REWARD_INPUT = 200

/** Erreur d'une demande : `code` du protocole (disabled, no_session,
 *  needs_activation, spend_disabled, bad_args, unknown_op, rate_limited,
 *  integrity, twitch, offline, no_claim, timeout, internal) ; `detail` :
 *  le texte court de l'extension (pour `twitch`, le code de Twitch). */
export class ConnectError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'ConnectError'
    this.code = code
    this.detail = detail
  }
}

// ── Formes des réponses ───────────────────────────────────────────────────
// Chaque réponse est relue avant usage : un champ obligatoire absent ou du
// mauvais type rend la réponse entière invalide (erreur `internal`), un
// champ facultatif inconnu devient null — jamais inventé.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
/** Nombre de points ou de votes : entier positif ou nul. */
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)
/** Comme `count`, mais null permis ; `undefined` si la valeur est invalide. */
const countOrNull = (v) => (v == null ? null : count(v) ?? undefined)
const text = (v, max = 300) => (isStr(v) ? v.slice(0, max) : null)
const ident = (v) => (isStr(v) && v.length > 0 && v.length <= 128 ? v : null)
function time(v) {
  const ms = isStr(v) ? Date.parse(v) : v
  return Number.isFinite(ms) && ms > 0 ? ms : null
}
/** Adresse d'image : https seulement (elle finit dans un <img>). */
function httpsUrl(v) {
  if (!isStr(v) || v.length > 1000) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.href : null
  } catch { return null }
}

const PRED_STATUS = new Set(['ACTIVE', 'LOCKED', 'RESOLVE_PENDING', 'RESOLVED', 'CANCELED'])
const POLL_STATUS = new Set(['ACTIVE', 'COMPLETED', 'TERMINATED', 'ARCHIVED'])

function normHello(d) {
  if (d.protocol !== PROTOCOL || typeof d.enabled !== 'boolean') return null
  return {
    protocol: PROTOCOL,
    version: text(d.version, 40),
    enabled: d.enabled,
    browser: d.browser === 'chrome' || d.browser === 'firefox' ? d.browser : null,
  }
}

function normStatus(d) {
  if (typeof d.enabled !== 'boolean' || !isObj(d.settings)) return null
  const { autoClaim, allowSpend } = d.settings
  if (typeof autoClaim !== 'boolean' || typeof allowSpend !== 'boolean') return null
  let session = null
  if (d.session != null) {
    if (!isObj(d.session)) return null
    const login = isStr(d.session.login) ? d.session.login.toLowerCase() : ''
    if (!LOGIN_RE.test(login)) return null
    session = { login, userId: ident(d.session.userId) }
  }
  return { enabled: d.enabled, session, settings: { autoClaim, allowSpend } }
}

function normPoints(d) {
  const balance = count(d.balance)
  if (balance === null || typeof d.claimAvailable !== 'boolean') return null
  return {
    channelId: ident(d.channelId),
    balance,
    claimAvailable: d.claimAvailable,
    pointsName: text(d.pointsName, 60) || null,
    pointsIconUrl: httpsUrl(d.pointsIconUrl),
    // Série de visionnage sur la chaîne : facultative (null si inconnue).
    watchStreak: count(d.watchStreak),
  }
}

function normClaim(d) {
  const claimed = countOrNull(d.claimed)
  const balance = countOrNull(d.balance)
  if (claimed === undefined || balance === undefined) return null
  return { claimed, balance }
}

function normBeat(d) {
  if (typeof d.live !== 'boolean') return null
  const claim = normClaim(d)
  return claim && { live: d.live, ...claim }
}

/** Mise de l'utilisateur : null (aucune), ou `undefined` si mal formée. */
function normSelfBet(s) {
  if (s == null) return null
  if (!isObj(s) || !ident(s.outcomeId) || count(s.points) === null) return undefined
  return { outcomeId: s.outcomeId, points: count(s.points) }
}

function normEvent(e) {
  if (e == null) return null
  if (!isObj(e) || !ident(e.id) || !PRED_STATUS.has(e.status) || !Array.isArray(e.outcomes)) return undefined
  const outcomes = e.outcomes.slice(0, 10).map((o) => (isObj(o) && ident(o.id) ? {
    id: o.id,
    title: text(o.title, 200) ?? '',
    color: o.color === 'PINK' ? 'PINK' : 'BLUE',
    totalPoints: count(o.totalPoints),
    totalUsers: count(o.totalUsers),
  } : null))
  const self = normSelfBet(e.self)
  if (!outcomes.length || outcomes.includes(null) || self === undefined) return undefined
  return {
    id: e.id,
    title: text(e.title) ?? '',
    status: e.status,
    createdAt: time(e.createdAt),
    windowSeconds: count(e.windowSeconds),
    winningOutcomeId: ident(e.winningOutcomeId),
    outcomes,
    self,
  }
}

function normPrediction(d) {
  // `event` est toujours là (null sans prédiction) : absent, la réponse est mal formée.
  if (!Object.hasOwn(d, 'event')) return null
  const event = normEvent(d.event)
  const balance = countOrNull(d.balance)
  if (event === undefined || balance === undefined) return null
  return { balance, event }
}

function normBet(d) {
  const self = normSelfBet(d.self)
  const balance = countOrNull(d.balance)
  if (!self || balance === undefined) return null
  return { balance, self }
}

function normPollObj(p) {
  if (p == null) return null
  if (!isObj(p) || !ident(p.id) || !POLL_STATUS.has(p.status) || !Array.isArray(p.choices)) return undefined
  const choices = p.choices.slice(0, 10).map((c) => (isObj(c) && ident(c.id)
    ? { id: c.id, title: text(c.title, 200) ?? '', votes: count(c.votes) }
    : null))
  if (!choices.length || choices.includes(null)) return undefined
  let self = null
  if (p.self != null) {
    if (!isObj(p.self) || !Array.isArray(p.self.choiceIds)) return undefined
    self = { choiceIds: p.self.choiceIds.filter((x) => ident(x)).slice(0, 10), votes: count(p.self.votes) }
  }
  const pv = isObj(p.pointsVoting) ? p.pointsVoting : {}
  return {
    id: p.id,
    title: text(p.title) ?? '',
    status: p.status,
    startedAt: time(p.startedAt),
    durationSeconds: count(p.durationSeconds),
    totalVotes: count(p.totalVotes),
    choices,
    pointsVoting: { enabled: pv.enabled === true, cost: count(pv.cost) },
    self,
  }
}

function normPoll(d) {
  if (!Object.hasOwn(d, 'poll')) return null
  const poll = normPollObj(d.poll)
  return poll === undefined ? null : { poll }
}

function normRaid(d) {
  return typeof d.joined === 'boolean' ? { joined: d.joined } : null
}

/** Drop réclamable : identifiant de son instance, ou null. */
const dropInstance = (v) => (isStr(v) && DROP_INSTANCE_RE.test(v) ? v : null)

function normDrops(d) {
  if (typeof d.channelHasDrops !== 'boolean' || !Array.isArray(d.campaigns)) return null
  const campaigns = []
  for (const c of d.campaigns.slice(0, 20)) {
    if (!isObj(c) || !ident(c.id) || !Array.isArray(c.drops)) return null
    const drops = []
    for (const x of c.drops.slice(0, 50)) {
      if (!isObj(x) || !ident(x.id) || typeof x.claimed !== 'boolean') return null
      const requiredMinutes = count(x.requiredMinutes)
      const currentMinutes = count(x.currentMinutes)
      if (requiredMinutes === null || currentMinutes === null) return null
      drops.push({
        id: x.id,
        name: text(x.name, 200) ?? '',
        imageUrl: httpsUrl(x.imageUrl),
        requiredMinutes,
        currentMinutes,
        claimed: x.claimed,
        dropInstanceId: dropInstance(x.dropInstanceId),
      })
    }
    campaigns.push({ id: c.id, name: text(c.name, 200) ?? '', gameName: text(c.gameName, 200) || null, endsAt: time(c.endsAt), drops })
  }
  return { channelHasDrops: d.channelHasDrops, campaigns }
}

function normDropClaim(d) {
  return typeof d.claimed === 'boolean' ? { claimed: d.claimed } : null
}

function normPulse(d) {
  if (typeof d.active !== 'boolean' || !Array.isArray(d.claimed)) return null
  return { active: d.active, claimed: d.claimed.filter(isStr).slice(0, 20).map((n) => n.slice(0, 200)) }
}

/** Couleur d'une récompense (elle finit dans un style) : #rgb à #rrggbbaa. */
const color = (v) => (isStr(v) && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null)

function normRewards(d) {
  const balance = countOrNull(d.balance)
  if (balance === undefined || !Array.isArray(d.rewards)) return null
  const rewards = []
  for (const r of d.rewards.slice(0, 100)) {
    if (!isObj(r) || !ident(r.id) || count(r.cost) === null) return null
    if (['requiresInput', 'enabled', 'paused', 'inStock'].some((k) => typeof r[k] !== 'boolean')) return null
    rewards.push({
      id: r.id,
      title: text(r.title, 200) ?? '',
      cost: count(r.cost),
      prompt: text(r.prompt, 1000) || null,
      requiresInput: r.requiresInput,
      enabled: r.enabled,
      paused: r.paused,
      inStock: r.inStock,
      cooldownEndsAt: time(r.cooldownEndsAt),
      color: color(r.color),
      imageUrl: httpsUrl(r.imageUrl),
    })
  }
  return { balance, rewards }
}

function normRedeem(d) {
  const balance = countOrNull(d.balance)
  return balance === undefined ? null : { balance }
}

/** Variantes de la liste du compte : identifiant, nom, original ou non,
 *  taille, cadence, débit, codecs — jamais d'adresse (PROTOCOL.md). */
function normHqMaster(d) {
  if (!Array.isArray(d.variants) || !d.variants.length) return null
  const variants = []
  for (const v of d.variants.slice(0, 20)) {
    if (!isObj(v) || !isStr(v.id) || !HQ_ID_RE.test(v.id) || typeof v.source !== 'boolean') return null
    const width = count(v.width)
    const height = count(v.height)
    const bandwidth = count(v.bandwidth)
    if (width === null || height === null || bandwidth === null || height > 10_000) return null
    if (!isStr(v.codecs) || !/^[A-Za-z0-9.,]{1,120}$/.test(v.codecs)) return null
    variants.push({
      id: v.id,
      name: isStr(v.name) && /^[A-Za-z0-9_.-]{1,24}$/.test(v.name) ? v.name : '',
      source: v.source,
      width,
      height,
      fps: Number.isFinite(v.fps) && v.fps > 0 && v.fps <= 300 ? v.fps : 0,
      bandwidth,
      codecs: v.codecs,
    })
  }
  return { variants }
}

/** Playlist d'une variante, réécrite par l'extension (texte HLS). */
function normHqPlaylist(d) {
  return isStr(d.playlist) && d.playlist.startsWith('#EXTM3U') && d.playlist.length <= 2_000_000 ? { playlist: d.playlist } : null
}

const NORMALIZE = {
  hello: normHello,
  status: normStatus,
  'points.get': normPoints,
  'points.claim': normClaim,
  'watch.beat': normBeat,
  'predictions.get': normPrediction,
  'predictions.bet': normBet,
  'polls.get': normPoll,
  'polls.vote': normPoll,
  'raid.join': normRaid,
  'drops.get': normDrops,
  'drops.claim': normDropClaim,
  'drops.pulse': normPulse,
  'rewards.get': normRewards,
  'rewards.redeem': normRedeem,
  'hq.master': normHqMaster,
  'hq.playlist': normHqPlaylist,
}

/** Relit une réponse `data` d'une opération : sa forme propre, ou null. */
export function normalize(op, data) {
  return isObj(data) && NORMALIZE[op] ? NORMALIZE[op](data) : null
}

/** Arguments d'une demande, vérifiés comme le fera l'arrière-plan (le
 *  login de la chaîne en minuscules) : null s'ils ne passent pas. */
export function cleanArgs(op, a) {
  if (op === 'hello' || op === 'status') return {}
  if (!isObj(a)) return null
  // Sans chaîne : un drop se réclame par son instance, une playlist du
  // compte se demande par l'identifiant de sa variante.
  if (op === 'drops.claim') return dropInstance(a.dropInstanceId) ? { dropInstanceId: a.dropInstanceId } : null
  if (op === 'hq.playlist') return isStr(a.id) && HQ_ID_RE.test(a.id) ? { id: a.id } : null
  const channel = isStr(a.channel) ? a.channel.trim().toLowerCase() : ''
  if (!LOGIN_RE.test(channel)) return null
  if (op === 'hq.master') {
    // Liste fermée, sans doublon, H.264 compris ; envoyée dans l'ordre de HQ_CODECS.
    const list = Array.isArray(a.codecs) ? a.codecs : []
    if (!list.length || new Set(list).size !== list.length || !list.every((c) => HQ_CODECS.includes(c)) || !list.includes('h264')) return null
    return { channel, codecs: HQ_CODECS.filter((c) => list.includes(c)) }
  }
  if (op === 'predictions.bet') {
    const { eventId, outcomeId, points } = a
    if (!ident(eventId) || !ident(outcomeId) || !Number.isInteger(points) || points < 1 || points > MAX_BET) return null
    return { channel, eventId, outcomeId, points }
  }
  if (op === 'polls.vote') {
    const { pollId, choiceId, withPoints } = a
    if (!ident(pollId) || !ident(choiceId) || typeof withPoints !== 'boolean') return null
    return { channel, pollId, choiceId, withPoints }
  }
  if (op === 'raid.join') {
    if (!isStr(a.raidId) || !RAID_ID_RE.test(a.raidId)) return null
    return { channel, raidId: a.raidId }
  }
  if (op === 'rewards.redeem') {
    const { rewardId, cost, title, prompt = null, input = null } = a
    if (!ident(rewardId) || !Number.isInteger(cost) || cost < 1 || cost > 1e9 || !isStr(title) || title.length > 200) return null
    if (prompt !== null && (!isStr(prompt) || prompt.length > 1000)) return null
    // Texte demandé par la récompense : 1 à 200 caractères (rien sinon).
    if (input !== null && (!isStr(input) || !input.trim() || input.length > MAX_REWARD_INPUT)) return null
    return { channel, rewardId, cost, title, prompt, input }
  }
  return { channel }
}

// ── Client ────────────────────────────────────────────────────────────────
let seq = 0
/** Identifiant de demande (≤ 64 caractères), unique dans la page. */
function newId() {
  seq = (seq + 1) % 1e9
  let rnd = ''
  try {
    const a = new Uint32Array(2)
    globalThis.crypto.getRandomValues(a)
    rnd = a[0].toString(36) + a[1].toString(36)
  } catch { rnd = Math.random().toString(36).slice(2, 12) }
  return `tu-${seq.toString(36)}-${rnd}`
}

/**
 * @param {Window|null} win  la fenêtre de la page (une fausse dans les
 *   vérifications Node : addEventListener, removeEventListener,
 *   postMessage, location.origin)
 * @param {{setTimeout?: Function, clearTimeout?: Function}} [timers]
 */
export function createConnect(win, timers = {}) {
  const setT = timers.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearT = timers.clearTimeout ?? ((id) => clearTimeout(id))
  const pending = new Map()      // id → { op, resolve, reject, timer }
  const listeners = new Set()
  const detectTimers = []
  let started = false
  let answered = false
  /** availability : idle (pas lancée), detecting, absent, off (présente mais
   *  connexion au site coupée), on. session : undefined tant que `status`
   *  n'a pas répondu, null sans session Twitch dans ce navigateur. */
  let st = Object.freeze({ availability: 'idle', version: null, browser: null, session: undefined, settings: null })

  function set(patch) {
    const next = { ...st, ...patch }
    if (Object.keys(next).every((k) => JSON.stringify(next[k]) === JSON.stringify(st[k]))) return
    st = Object.freeze(next)
    for (const fn of [...listeners]) {
      try { fn(st) } catch { /* un abonné en erreur ne prive pas les autres */ }
    }
  }

  /** Réponse valide : elle prouve que l'extension est là et branchée. */
  function seen(op, data) {
    if (op === 'hello') {
      answered = true
      set({ availability: data.enabled ? 'on' : 'off', version: data.version ?? st.version, browser: data.browser ?? st.browser })
    } else if (op === 'status') {
      answered = true
      set({ availability: data.enabled ? 'on' : 'off', session: data.session, settings: data.settings })
    } else {
      answered = true
      if (st.availability !== 'on') set({ availability: 'on' })
    }
  }

  /** Erreur rendue par l'extension : ce qu'elle dit de son état. */
  function failed(err) {
    answered = true
    if (err.code === 'disabled') return set({ availability: 'off' })
    const patch = st.availability === 'on' ? {} : { availability: 'on' }
    if (err.code === 'no_session') patch.session = null
    if (err.code === 'spend_disabled' && st.settings) patch.settings = { ...st.settings, allowSpend: false }
    set(patch)
  }

  function onAnnounce(m) {
    if (m.protocol !== PROTOCOL || typeof m.enabled !== 'boolean') return
    answered = true
    set({ availability: m.enabled ? 'on' : 'off', version: text(m.version, 40) ?? st.version })
  }

  function onMessage(e) {
    // Seulement la page elle-même, à sa propre origine, et nos messages.
    if (!e || e.source !== win || e.origin !== win.location.origin) return
    const m = e.data
    if (!isObj(m) || m.tuConnect !== 1) return
    if (m.dir === 'hello') return onAnnounce(m)
    // Nos propres demandes (dir « req ») reviennent aussi à la page : ignorées.
    if (m.dir !== 'res' || !isStr(m.id)) return
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    clearT(p.timer)
    if (m.ok === true) {
      const data = normalize(p.op, m.data)
      if (data) { seen(p.op, data); p.resolve(data); return }
    } else if (m.ok === false && isObj(m.error) && isStr(m.error.code) && m.error.code) {
      const err = new ConnectError(m.error.code.slice(0, 40), text(m.error.message, 200) ?? '')
      failed(err)
      p.reject(err)
      return
    }
    p.reject(new ConnectError('internal', 'malformed'))
  }

  /**
   * Demande une opération. La demande part TOUT DE SUITE (pas d'attente
   * avant postMessage) : appelée dans un clic, elle arrive à l'extension
   * pendant que le geste de l'utilisateur compte encore (dépenses).
   * @returns {Promise<object>} la réponse relue (voir normalize)
   */
  function request(op, args = {}) {
    if (!OPS.includes(op)) return Promise.reject(new ConnectError('unknown_op'))
    const clean = cleanArgs(op, args)
    if (!clean) return Promise.reject(new ConnectError('bad_args'))
    if (!win) return Promise.reject(new ConnectError('internal', 'no window'))
    listen()
    const id = newId()
    return new Promise((resolve, reject) => {
      const timer = setT(() => {
        if (!pending.delete(id)) return
        reject(new ConnectError('timeout'))
      }, timeoutFor(op))
      pending.set(id, { op, resolve, reject, timer })
      try {
        win.postMessage({ tuConnect: 1, dir: 'req', id, op, args: clean }, win.location.origin)
      } catch {
        clearT(timer)
        pending.delete(id)
        reject(new ConnectError('internal', 'postMessage'))
      }
    })
  }

  function listen() {
    if (started || !win) return
    started = true
    win.addEventListener('message', onMessage)
  }

  /** Lance la détection (une fois) : écoute des annonces, et `hello` aux
   *  instants de HELLO_AT tant que rien n'a répondu. */
  function start() {
    if (!win || st.availability !== 'idle') return
    listen()
    set({ availability: 'detecting' })
    for (const at of HELLO_AT) {
      detectTimers.push(setT(() => { if (!answered) request('hello').catch(() => {}) }, at))
    }
    detectTimers.push(setT(() => {
      if (!answered && st.availability === 'detecting') set({ availability: 'absent' })
    }, ABSENT_AFTER))
  }

  /** Relit l'état de l'extension (session, réglages) ; null en cas d'échec. */
  function refreshStatus() {
    return request('status').catch(() => null)
  }

  /** Abonnement aux changements d'état ; rend la fonction de désabonnement. */
  function onChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  /** Vérifications : tout arrêter, sans laisser de minuteur. */
  function destroy() {
    for (const id of detectTimers.splice(0)) clearT(id)
    for (const [id, p] of pending) { clearT(p.timer); pending.delete(id); p.reject(new ConnectError('timeout')) }
    if (started) win.removeEventListener('message', onMessage)
    started = false
    listeners.clear()
  }

  return { start, request, refreshStatus, onChange, destroy, state: () => st, pendingCount: () => pending.size }
}

/** Le client de la page (aucun effet avant connect.start()). */
export const connect = createConnect(typeof window === 'undefined' ? null : window)
