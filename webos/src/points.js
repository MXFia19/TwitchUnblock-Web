// ═══════════════════════════════════════════════════════════════════════════
//  Points de chaîne et série de visionnage du compte de la session web
//  (websession.js), pendant un direct. Ici la logique seule : ni réseau ni
//  écran, tout passe par les fonctions données au constructeur
//  (livepoints.js les branche sur le vrai réseau et dessine ;
//  tools/points-check.mjs les remplace par des réponses simulées). Comme
//  l'app iPhone (ChannelPointsService.swift, LiveEventsService.swift) :
//  - « minute-watched » toutes les 60 s pendant la lecture (jamais en pause),
//    vers l'adresse de statistiques de Twitch (spade_url), ou par la route
//    /api/spade du Worker quand elle ne répond pas (CORS refusé à l'origine
//    de l'app installée, bloqueur, DNS filtrant) : c'est ce qui crédite les
//    points et fait avancer la série ;
//  - solde, coffre disponible, nom et icône des points (GQL, toutes les
//    60 s), série de visionnage (BatchGetWatchStreaks, toutes les 5 min) ;
//  - coffre : ClaimCommunityPoints avec le seul jeton web, sans jeton
//    d'intégrité (jamais fabriqué, récupéré ni emprunté à un autre
//    appareil). Refusé : un avis « ramasse-le sur ton téléphone », plus
//    d'essai pour ce coffre, et plus d'essai du tout pendant 6 h si Twitch
//    a dit « intégrité ».
//  Prédictions (lecture seule, Hermes) : predFromHermes, comme le site
//  (chat/view.js).
// ═══════════════════════════════════════════════════════════════════════════

export const MINUTE_MS = 60_000
export const POINTS_MS = 60_000
export const STREAK_MS = 5 * 60_000
/** « +N » à la place du solde après un gain. */
export const GAIN_MS = 3000
/** Coffre refusé faute de jeton d'intégrité : plus d'essai pendant 6 h. */
export const CLAIM_PAUSE_MS = 6 * 3600_000
/** Minutes envoyées d'abord par le Worker pendant 24 h, une fois l'envoi
 *  direct en échec et le Worker en état de les passer : une TV ne change
 *  pas de réseau, et chaque nouvel essai direct risquerait une minute en
 *  double (envoyée, mais réponse illisible sans en-tête CORS). */
export const WORKER_STICK_MS = 24 * 3600_000
const SEND_MS = 15_000

/** Adresse de statistiques de Twitch aujourd'hui (README, « How it
 *  works ») : prise quand la page de la chaîne ne peut pas être lue. */
export const SPADE_DEFAULT = 'https://spade.twitch.tv/track'
/** Hôtes admis : les mêmes que la route /api/spade du Worker (worker.js,
 *  SPADE_HOST_RE), qui refuserait les autres. */
export const SPADE_HOST_RE = /^(?:spade\.twitch\.tv|video-edge-[a-z0-9-]{1,63}\.[a-z0-9-]{1,63}\.abs\.hls\.ttvnw\.net)$/

/** Requêtes enregistrées du client web de Twitch (celles de l'app iPhone). */
export const HASH = {
  streak: '7d04fbaa5bb32d193c742caa2c855dfde371a2a8cb25afed5b5c3d45f5ee9278',   // BatchGetWatchStreaks
  claim: '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0',    // ClaimCommunityPoints
}
/** Solde et coffre (fetchBalance de l'app, avec l'id de la chaîne), et la
 *  première fois le nom et l'icône des points (requêtes de l'extension). */
export const Q = {
  points: 'query($l: String!) { channel(name: $l) { id self { communityPoints { balance availableClaim { id } } } } }',
  pointsFull: 'query($l: String!) { channel(name: $l) { id self { communityPoints { balance availableClaim { id } } } communityPointsSettings { isEnabled name image { url2x } } } }',
}

/** Corps d'une requête enregistrée, en liste comme l'app iPhone. */
export const persisted = (operationName, variables, sha256Hash) => [{
  operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash } },
}]

// ── Minute regardée ────────────────────────────────────────────────────────
/** L'événement de l'app iPhone (sendMinuteWatched), au champ près :
 *  user_id en nombre, les identifiants de chaîne et de direct en texte. */
export function minuteWatched({ channelId, broadcastId, login, userId }) {
  return [{
    event: 'minute-watched',
    properties: {
      channel_id: String(channelId),
      broadcast_id: String(broadcastId),
      channel: String(login),
      user_id: Number(userId),
      player: 'site',
      live: true,
    },
  }]
}

/** base64 d'un texte en UTF-8. */
export function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/** Corps envoyé au spade : `data=<base64>`, encodé pour un formulaire. */
export const spadeForm = (b64) => `data=${encodeURIComponent(b64)}`

/** Adresse de spade utilisable (et que le Worker accepterait). */
export function spadeUrlOk(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && SPADE_HOST_RE.test(u.hostname) && (u.pathname + u.search).length <= 2000
  } catch { return false }
}

/** `spade_url` dans la page d'une chaîne ou dans son settings.<hash>.js. */
export function findSpadeUrl(text) {
  const m = /"spade_url"\s*:\s*"(https:[^"]+)"/.exec(text || '')
  const url = m ? m[1].replace(/\\\//g, '/') : null
  return url && spadeUrlOk(url) ? url : null
}

/** Adresse du fichier settings.<hash>.js de la page (hôtes de Twitch seulement). */
export function findSettingsScript(html) {
  const m = /(https:\/\/[^"']+?\/config\/settings\.[A-Za-z0-9]+\.js)/.exec(html || '')
  if (!m) return null
  try {
    const u = new URL(m[1])
    return u.protocol === 'https:' && (u.hostname === 'static.twitchcdn.net' || u.hostname.endsWith('.twitch.tv')) ? m[1] : null
  } catch { return null }
}

// ── Lecture des réponses de Twitch ─────────────────────────────────────────
const CLAIM_ID_RE = /^[A-Za-z0-9_-]{1,100}$/

/**
 * Réponse de Q.points / Q.pointsFull → { channelId, balance, claimId, look }
 * (look : { enabled, name, icon } avec Q.pointsFull) ; avec `error`
 * (« channel » : chaîne inconnue, « self » : pas de compte dans la réponse,
 * « response » : forme inattendue). communityPoints nul (chaîne jamais
 * regardée) : 0, comme l'app.
 */
export function readPoints(json) {
  const ch = json?.data?.channel
  if (ch === null) return { error: 'channel' }
  if (!ch || typeof ch !== 'object') return { error: 'response' }
  const channelId = /^\d{1,20}$/.test(String(ch.id ?? '')) ? String(ch.id) : null
  let look
  if (Object.hasOwn(ch, 'communityPointsSettings')) {
    const s = ch.communityPointsSettings
    const name = typeof s?.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : null
    const url = typeof s?.image?.url2x === 'string' ? s.image.url2x : ''
    look = { enabled: Boolean(s) && s.isEnabled !== false, name, icon: /^https:\/\/[^\s"'<>\\]{1,500}$/.test(url) ? url : null }
  }
  if (!ch.self || typeof ch.self !== 'object') return { error: 'self', channelId, look }
  const cp = ch.self.communityPoints
  const balance = cp && typeof cp.balance === 'number' && Number.isFinite(cp.balance) ? Math.max(0, Math.trunc(cp.balance)) : 0
  const id = cp?.availableClaim?.id
  return { channelId, balance, claimId: typeof id === 'string' && CLAIM_ID_RE.test(id) ? id : null, look }
}

/** Série de visionnage de la chaîne dans BatchGetWatchStreaks : absente de
 *  la liste, 0 (comme l'app) ; réponse illisible, null. */
export function readStreak(json, channelId) {
  const list = json?.data?.batchGetWatchStreaks
  if (!Array.isArray(list)) return null
  const item = list.find((i) => i?.channel?.id != null && String(i.channel.id) === String(channelId))
  return item && typeof item.value === 'number' && Number.isFinite(item.value) ? Math.max(0, Math.trunc(item.value)) : 0
}

/**
 * Réponse de ClaimCommunityPoints (`r` : { status, json, errors }) →
 * { ok: true, points } (points : le nouveau solde, s'il est donné), ou
 * { ok: false, reason, integrity, network }. `errors` : messages de Twitch
 * déjà nettoyés du jeton (websession.js, accountGql).
 */
export function readClaim(r) {
  const c = r?.json?.data?.claimCommunityPoints
  const code = c?.error?.code ? String(c.error.code).slice(0, 60) : ''
  const errors = String(r?.errors || '')
  if (r?.status === 200 && c && typeof c === 'object' && !code && !errors) {
    return { ok: true, points: typeof c.currentPoints === 'number' && Number.isFinite(c.currentPoints) ? Math.trunc(c.currentPoints) : null }
  }
  const reason = code || errors || (r?.status ? `HTTP ${r.status}` : 'pas de réponse')
  return { ok: false, reason, integrity: /integrity/i.test(`${code} ${errors}`), network: !r?.status }
}

/** Prédiction reçue d'Hermes (PubSub, champs en snake_case) → forme de la
 *  carte : la même fonction que le site (chat/view.js, predFromHermes). */
export function predFromHermes(ev) {
  if (!ev?.id) return null
  const created = Date.parse(ev.created_at)
  return {
    id: ev.id,
    title: ev.title ?? '',
    status: ev.status,
    endsAt: Number.isFinite(created) && ev.prediction_window_seconds ? created + ev.prediction_window_seconds * 1000 : null,
    winnerId: ev.winning_outcome_id ?? null,
    outcomes: (ev.outcomes ?? []).map((o) => ({
      id: o.id, title: o.title ?? '', color: o.color, points: o.total_points ?? 0, users: o.total_users ?? 0,
    })),
  }
}

// ── Envoi au spade : en direct, ou par le Worker ───────────────────────────
const hostOf = (u) => { try { return new URL(u).host } catch { return '?' } }
const ok2xx = (s) => s >= 200 && s < 300

/**
 * Envoie une minute à Twitch, comme l'app iPhone (sendSpade) : en direct
 * (POST `data=<base64>`, en mode CORS pour lire le code de Twitch), sinon
 * par un Worker (POST /api/spade { url, data }, en text/plain : pas de
 * requête préalable OPTIONS), qui rend le code de Twitch.
 */
export class SpadeSender {
  /**
   * @param {object} o
   * @param {typeof fetch} o.fetch
   * @param {() => string[]} o.bases  Workers pour /api/spade, dans l'ordre
   * @param {(msg: string) => void} o.log  journal (une fois par sorte d'erreur)
   * @param {{ get(): number, set(v: number): void }} o.workerUntil  « d'abord par le Worker » jusqu'à…
   * @param {() => number} [o.now]
   */
  constructor(o) {
    this.o = o
    this.now = o.now ?? (() => Date.now())
    this.skip = new Map()    // Worker → écarté jusqu'à (404 : route absente ; 429)
    this.noted = new Set()
  }

  note(key, msg) {
    if (this.noted.has(key)) return
    this.noted.add(key)
    this.o.log(msg)
  }

  /** fetch borné dans le temps (AbortSignal.timeout manque aux TV de 2021-2023). */
  async fetchT(url, init, ms) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    try {
      return await this.o.fetch(url, { ...init, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /** { status, relayed } ; null si la minute n'a pu partir ni en direct, ni
   *  par un Worker. */
  async send(url, b64) {
    const now = this.now()
    const viaWorker = this.o.workerUntil.get() > now
    if (viaWorker) {
      const r = await this.relay(url, b64)
      if (r) return r
    }
    const d = await this.direct(url, b64)
    if (ok2xx(d.status)) {
      if (viaWorker) {
        this.o.workerUntil.set(0)
        this.o.log('minute-watched : envoi direct rétabli')
      }
      return { status: d.status, relayed: false }
    }
    this.note(`direct ${d.status || d.error}`, d.status
      ? `minute-watched : ${hostOf(url)} a répondu HTTP ${d.status}`
      : `minute-watched : envoi direct à ${hostOf(url)} impossible (${d.error})`)
    // Les Workers viennent déjà d'échouer pour cette minute.
    if (viaWorker) return d.status ? { status: d.status, relayed: false } : null
    const r = await this.relay(url, b64)
    if (r && ok2xx(r.status)) {
      this.o.workerUntil.set(now + WORKER_STICK_MS)
      this.note('worker', 'minute-watched : envoyées par le Worker pendant 24 h (envoi direct impossible)')
    }
    return r || (d.status ? { status: d.status, relayed: false } : null)
  }

  /** Envoi direct : { status } (réponse de Twitch, même refusée), ou
   *  { status: 0, error } (réseau, délai, ou CORS : la réponse est alors
   *  illisible même si la minute est partie). */
  async direct(url, b64) {
    try {
      const res = await this.fetchT(url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: spadeForm(b64),
      }, SEND_MS)
      return { status: res.status }
    } catch (e) {
      return { status: 0, error: e?.name === 'AbortError' ? 'délai dépassé' : 'réseau ou CORS' }
    }
  }

  /** Par les Workers, dans l'ordre : { status (de Twitch), relayed: true },
   *  ou null si aucun n'a pu la transmettre. */
  async relay(url, b64) {
    const body = JSON.stringify({ url, data: b64 })
    for (const base of this.o.bases()) {
      if ((this.skip.get(base) || 0) > this.now()) continue
      let res
      let json = null
      try {
        res = await this.fetchT(`${base}/api/spade`, {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body,
        }, SEND_MS)
        json = await res.json().catch(() => null)
      } catch {
        this.note(`worker ${base}`, `Relais des minutes injoignable (${hostOf(base)})`)
        continue
      }
      if (res.status === 200 && json?.ok === true && Number.isFinite(json.status)) return { status: json.status, relayed: true }
      this.note(`worker ${base} ${res.status}`, `Relais des minutes refusé (HTTP ${res.status} · ${hostOf(base)}${typeof json?.error === 'string' ? ` · ${json.error.slice(0, 60)}` : ''})`)
      // Adresse ou données refusées : un autre Worker dirait pareil.
      if (res.status === 400) return null
      // Route absente (Worker d'avant) ; trop d'envois : le suivant.
      if (res.status === 404) this.skip.set(base, Infinity)
      else if (res.status === 429) this.skip.set(base, this.now() + 10 * 60_000)
    }
    return null
  }
}

// ── Points pendant un direct ───────────────────────────────────────────────
/**
 * Points d'une chaîne pendant son direct. `tick(playing)` est appelé
 * régulièrement (chaque seconde) par livepoints.js : ce qui est dû part,
 * seulement pendant la lecture. Chaque appel rend une promesse résolue
 * quand ses requêtes sont finies (les essais l'attendent).
 */
export class PointsCore {
  /**
   * @param {object} d
   * @param {(body: any, o?: { expire?: boolean }) => Promise<{ status: number, json: any, errors: string }>} d.gql
   *        requête au nom du compte (websession.js, accountGql : erreurs sans le jeton)
   * @param {{ send(url: string, b64: string): Promise<{ status: number, relayed: boolean } | null> }} d.spade
   * @param {(login: string) => Promise<string>} d.spadeUrl
   * @param {() => Promise<string>} d.userId  identifiant Twitch du compte
   * @param {(msg: string) => void} d.log  journal des erreurs (jamais le jeton)
   * @param {(msg: string) => void} [d.info]  console
   * @param {{ get(): number, set(v: number): void }} d.claimPause  pas d'essai de coffre jusqu'à…
   * @param {(view: object) => void} [d.onChange]
   * @param {(kind: 'chest-ok' | 'chest-phone', n?: number | null) => void} [d.onNotice]
   * @param {() => number} [d.now]
   */
  constructor(d) {
    this.d = d
    this.now = d.now ?? (() => Date.now())
    this.gen = 0
    this.reset()
  }

  reset() {
    this.ch = null
    this.state = { balance: null, enabled: true, name: null, icon: null, streak: null, chest: null, gain: 0 }
    this.at = { minute: 0, points: 0, streak: 0 }
    this.busy = {}
    this.claimId = null
    this.tries = new Map()      // coffre → essais
    this.phoneSaid = new Set()  // coffres déjà annoncés « sur ton téléphone »
    this.noted = new Set()
    this.gainUntil = 0
    this.minutes = 0
  }

  /**
   * @param {object} c
   * @param {string} c.login
   * @param {string | null} c.channelId  (sinon lu avec le solde)
   * @param {() => string | null} c.broadcastId  id du direct en cours
   * @param {boolean} c.points  gagner et afficher les points
   * @param {boolean} c.streak  afficher la série
   */
  start({ login, channelId = null, broadcastId, points = true, streak = true }) {
    this.stop()
    this.ch = { login: String(login).toLowerCase(), channelId: channelId ? String(channelId) : null, broadcastId, points, streak }
    const jobs = []
    if (points) jobs.push(this.readPoints(true))
    if (streak) jobs.push(this.readStreak())
    return Promise.all(jobs)
  }

  stop() {
    const had = Boolean(this.ch)
    this.gen++
    this.reset()
    if (had) this.changed()
  }

  get channelId() { return this.ch?.channelId ?? null }

  tick(playing) {
    const c = this.ch
    if (!c) return Promise.resolve()
    const now = this.now()
    if (this.state.gain && now >= this.gainUntil) {
      this.state.gain = 0
      this.changed()
    }
    if (!playing) return Promise.resolve()
    const jobs = []
    if (c.points && now - this.at.minute >= MINUTE_MS - 500) jobs.push(this.sendMinute())
    if (c.points && now - this.at.points >= POINTS_MS - 500) jobs.push(this.readPoints(false))
    if (c.streak && now - this.at.streak >= STREAK_MS - 500) jobs.push(this.readStreak())
    return Promise.all(jobs)
  }

  /** Ce que l'écran affiche. */
  view() {
    const c = this.ch
    const s = this.state
    return {
      balance: c?.points && s.balance != null && s.enabled ? s.balance : null,
      name: s.name,
      icon: s.icon,
      gain: c?.points ? s.gain : 0,
      streak: c?.streak && s.streak > 0 ? s.streak : 0,
      chest: c?.points && s.enabled ? s.chest : null,
    }
  }

  changed() { this.d.onChange?.(this.view()) }

  /** Au journal une fois par sorte et par direct. */
  note(key, msg) {
    if (this.noted.has(key) || !this.ch) return
    this.noted.add(key)
    this.d.log(`TV ${this.ch.login} : ${msg}`)
  }

  async sendMinute() {
    const busy = this.busy
    if (busy.minute) return
    busy.minute = true
    this.at.minute = this.now()
    const gen = this.gen
    const c = this.ch
    try {
      const bid = c.broadcastId?.() ?? null
      if (!bid || !/^\d{1,20}$/.test(String(bid)) || !c.channelId) {
        this.note('minute-ids', `pas de minute-watched (${c.channelId ? 'id du direct inconnu' : 'id de la chaîne inconnu'})`)
        return
      }
      const uid = await this.d.userId()
      if (gen !== this.gen) return
      if (!/^\d{1,20}$/.test(String(uid || ''))) {
        this.note('minute-user', 'pas de minute-watched (id du compte inconnu)')
        return
      }
      const url = await this.d.spadeUrl(c.login)
      if (gen !== this.gen) return
      const b64 = base64Utf8(JSON.stringify(minuteWatched({ channelId: c.channelId, broadcastId: bid, login: c.login, userId: uid })))
      const sent = await this.d.spade.send(url, b64)
      if (gen !== this.gen || !sent) return
      if (ok2xx(sent.status)) this.minutes++
      this.d.info?.(`minute-watched ${c.login} : HTTP ${sent.status}${sent.relayed ? ' (par le Worker)' : ''}`)
    } finally {
      busy.minute = false
    }
  }

  /** Solde et coffre ; `full` : avec le nom et l'icône des points. */
  async readPoints(full) {
    const busy = this.busy
    if (busy.points) return
    busy.points = true
    this.at.points = this.now()
    const gen = this.gen
    const c = this.ch
    try {
      const r = await this.d.gql({ query: full ? Q.pointsFull : Q.points, variables: { l: c.login } })
      if (gen !== this.gen) return
      if (r.status !== 200 || !r.json) {
        if (r.status) this.note(`points ${r.status}`, `solde illisible (HTTP ${r.status})`)
        return
      }
      const p = readPoints(r.json)
      if (p.channelId) c.channelId = p.channelId
      if (p.look) Object.assign(this.state, p.look)
      if (p.error) {
        this.note(`points ${p.error}`, `solde refusé par Twitch (${r.errors || p.error})`)
        if (p.look) this.changed()
        return
      }
      this.setBalance(p.balance)
      this.chestSeen(p.claimId)
    } finally {
      busy.points = false
    }
  }

  setBalance(n) {
    const s = this.state
    const before = s.balance
    s.balance = n
    if (before != null && n > before) {
      s.gain = n - before
      this.gainUntil = this.now() + GAIN_MS
    }
    this.changed()
  }

  /** Coffre annoncé (ou plus) par la dernière lecture du solde. */
  chestSeen(id) {
    const s = this.state
    if (!id) {
      if (this.claimId || s.chest) {
        this.claimId = null
        s.chest = null
        this.changed()
      }
      return
    }
    if (id === this.claimId && s.chest !== 'retry') return
    // Un essai encore en cours : ce coffre sera revu à la lecture suivante.
    if (this.busy.claim) return
    this.claimId = id
    this.claim(id)
  }

  /** Le coffre, une fois, sans jeton d'intégrité (deux fois si Twitch n'a
   *  pas répondu du tout). */
  async claim(id) {
    const s = this.state
    const c = this.ch
    if (this.d.claimPause.get() > this.now() || !c.channelId) return this.phone(id)
    const busy = this.busy
    busy.claim = true
    const tries = (this.tries.get(id) || 0) + 1
    this.tries.set(id, tries)
    s.chest = 'claiming'
    this.changed()
    const gen = this.gen
    try {
      const before = s.balance
      const r = await this.d.gql(persisted('ClaimCommunityPoints', { input: { channelID: c.channelId, claimID: id } }, HASH.claim), { expire: false })
      if (gen !== this.gen) return
      const res = readClaim(r)
      if (res.ok) {
        s.chest = null
        if (res.points != null) this.setBalance(res.points)
        else {
          // La réponse ne donne pas toujours le solde : relu.
          busy.claim = false
          await this.readPoints(false)
          if (gen !== this.gen) return
        }
        const gained = before != null && s.balance != null && s.balance > before ? s.balance - before : null
        this.d.info?.(`coffre ramassé sur ${c.login}${gained ? ` (+${gained})` : ''}`)
        this.d.onNotice?.('chest-ok', gained)
        this.changed()
        return
      }
      if (res.network && tries < 2) {
        // Pas de réponse : nouvel essai à la prochaine lecture du solde.
        s.chest = 'retry'
        this.changed()
        return
      }
      if (res.integrity) this.d.claimPause.set(this.now() + CLAIM_PAUSE_MS)
      this.d.log(`TV ${c.login} : coffre refusé par Twitch sans jeton d'intégrité (${res.reason})${res.integrity ? ', plus d’essai pendant 6 h' : ''}`)
      this.phone(id)
    } finally {
      busy.claim = false
    }
  }

  /** Coffre à ramasser sur le téléphone : l'icône reste tant qu'il est là,
   *  l'avis une seule fois. */
  phone(id) {
    this.state.chest = 'phone'
    this.changed()
    if (this.phoneSaid.has(id)) return
    this.phoneSaid.add(id)
    this.d.onNotice?.('chest-phone')
  }

  async readStreak() {
    const busy = this.busy
    if (busy.streak) return
    busy.streak = true
    this.at.streak = this.now()
    const gen = this.gen
    try {
      const r = await this.d.gql(persisted('BatchGetWatchStreaks', {}, HASH.streak))
      if (gen !== this.gen) return
      const id = this.ch.channelId
      // Chaîne pas encore connue (fiche et solde en retard) : à la suivante.
      if (!id && r.status === 200) return
      const v = r.status === 200 ? readStreak(r.json, id) : null
      if (v == null) {
        this.note('streak', `série de visionnage illisible (${r.errors || (r.status ? `HTTP ${r.status}` : 'pas de réponse')})`)
        return
      }
      if (v !== this.state.streak) {
        this.state.streak = v
        this.changed()
      }
    } finally {
      busy.streak = false
    }
  }
}
