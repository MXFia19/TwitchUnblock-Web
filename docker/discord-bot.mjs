// ═══════════════════════════════════════════════════════════════════════════
//  Bot Discord de TwitchUnblock, lancé par relay.mjs. Tout ce qu'il écrit est
//  en anglais : la communauté l'est surtout.
//
//  Retours (bugs, idées) — le pont :
//    - le Worker publie chaque retour dans un salon « Forum » (un post par
//      retour, où arrivent aussi les réponses de la personne) ;
//    - ce qu'on écrit dans le post part comme réponse du développeur (« // »
//      au début : note privée) ; ✅ quand c'est parti, ❌ sinon ;
//    - l'étiquette d'état (New, Seen, Accepted, In progress, Done, Declined)
//      devient l'état du retour ; le bot crée celles qui manquent et renomme
//      en anglais les anciennes ;
//    - boutons de réponses rapides sous chaque nouveau retour ;
//    - /delete, /block (la personne ne peut plus écrire), /merge (doublon) ;
//    - passé à « Done », le bot demande où sortira le correctif, et la
//      personne est prévenue quand la version sort (« It's live ») ;
//    - posts « Done » ou « Declined » archivés après un jour sans activité ;
//    - /bug et /idea : n'importe quel membre signale depuis Discord (une
//      capture en option de la commande) ; les réponses lui arrivent en
//      message privé, images jointes, avec deux boutons pour répondre
//      (« Reply » : texte ; « Send screenshots » : captures) ;
//    - les retours d'avant le pont reçoivent leur post.
//  Surveillance (salon privé choisi avec /setup) : Workers en panne, ntfy en
//  pause, webhook refusé, CI de l'app ou du site en échec, forum des retours
//  visible de tous ; résumé chaque matin. Le relais lui-même : le Worker
//  prévient (ALERT_WEBHOOK).
//  Communauté : /announce (bandeau de l'app et du site), /poll et
//  /poll-end (sondage, résultats postés à la fin) ; brouillon des
//  notes de version à chaque sortie, publié d'un bouton (avec la mention du
//  rôle des sorties choisi par /setup) ; versions de test annoncées aux
//  testeurs ; /release-pings (ou le bouton posté par /setup, gardé tout en
//  bas du salon des annonces) : chacun prend ou rend ce rôle (sans
//  permission ni accès à un salon, vérifié).
//  À faire : « Add to to-do » (menu Apps d'un message : une bonne idée lue
//  sur le serveur) et /todo (texte libre) postent une carte dans le salon
//  choisi par /setup, avec un bouton Done / Reopen.
//  Exploitation (salon privé) : plafonds du jour à 80 %, base à 70 % de sa
//  taille, tâche planifiée muette depuis 5 min, quotas gratuits de
//  Cloudflare à 70 % (avec CLOUDFLARE_API_TOKEN), VPS ou Worker en retard
//  sur GitHub ; /status (état en un message), /forget-user (effacer les
//  données d'une personne, après confirmation). Chaque action du
//  développeur part avec son auteur (`by`) : le Worker la note au journal
//  d'audit.
//  Seuls le propriétaire du serveur et DISCORD_ADMIN_IDS agissent au nom du
//  développeur.
//
//  Variables (relay/docker-compose.yml, fichier .env) : DISCORD_BOT_TOKEN,
//  FEEDBACK_BOT_SECRET (même valeur que sur le Worker), FEEDBACK_WORKER,
//  DISCORD_ADMIN_IDS ; facultatives : FALLBACK_WORKERS, SUMMARY_TZ,
//  SUMMARY_HOUR, CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID (quotas).
//
//  Sans dépendance : passerelle de Discord par le WebSocket de Node 22, API
//  REST par fetch. Sa mémoire (réglages, versions vues, brouillons) est
//  rangée par le Worker (D1), rien sur le disque du VPS.
// ═══════════════════════════════════════════════════════════════════════════

// GUILDS (salons, posts, étiquettes), GUILD_MESSAGES, DIRECT_MESSAGES (pour
// renvoyer vers les boutons qui écrit au bot en privé), MESSAGE_CONTENT
// (intention privilégiée, à activer dans le portail : le texte des messages).
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15)
// Fermetures sans nouvel essai possible.
const FATAL = new Map([
  [4004, 'token refused (DISCORD_BOT_TOKEN)'],
  [4010, 'invalid shard'],
  [4011, 'sharding required'],
  [4012, 'invalid API version'],
  [4013, 'invalid intents'],
  [4014, 'Message Content intent not enabled (developer portal → Bot)'],
])
const FORUM = 15
const STATUSES = ['new', 'seen', 'accepted', 'progress', 'done', 'refused']
const LABELS = { new: 'New', seen: 'Seen', accepted: 'Accepted', progress: 'In progress', done: 'Done', refused: 'Declined' }
// Noms d'étiquettes reconnus pour chaque état (sans accents ni emoji).
const TAG_NAMES = {
  new: ['new', 'received', 'recu', 'nouveau'],
  seen: ['seen', 'vu'],
  accepted: ['accepted', 'accepte'],
  progress: ['in progress', 'progress', 'en cours'],
  done: ['done', 'fixed', 'fait', 'termine', 'resolu'],
  refused: ['declined', 'refused', 'refuse'],
}
const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]+/g, ' ').trim()
const statusOfName = (name) => STATUSES.find((s) => TAG_NAMES[s].includes(normName(name))) || null
// Réponses rapides : envoyées telles quelles à la personne. « Fixed next
// version » passe aussi le retour à « Done ».
const QUICK = [
  { label: 'Thanks, noted', text: "Thanks for the report! It's noted — I'll keep you posted here." },
  { label: 'Send a screenshot', text: 'Thanks! Could you send a screenshot or a short screen recording of the problem? You can attach it to your reply.' },
  { label: 'More details', text: 'Thanks! Could you tell me a bit more: which channel or video, what you did just before, and whether it happens every time?' },
  { label: 'Fixed next version', text: "Good news: it's fixed and will be in the next version. I'll tell you here as soon as it's out.", status: 'done' },
  { label: 'Already fixed', text: 'This should already be fixed in the latest version. Could you update and tell me if it still happens?' },
  { label: "Can't reproduce", text: "I can't reproduce it on my side. Does it still happen? A screenshot or more details would help a lot." },
]
// Commandes : celles du développeur sont réservées par défaut aux
// administrateurs du serveur (default_member_permissions « 0 »), et le bot
// le vérifie aussi.
const ADMIN = '0'
// /bug et /idea : capture facultative (type 11, pièce jointe), gardée le
// temps de remplir le formulaire.
const screenshotOption = (description) => [{ type: 11, name: 'screenshot', description, required: false }]
const COMMANDS = [
  { name: 'bug', description: 'Report a bug in TwitchUnblock (app or website)', options: screenshotOption('A screenshot of the problem (optional)') },
  { name: 'idea', description: 'Suggest an idea for TwitchUnblock', options: screenshotOption('An image to go with your idea (optional)') },
  { name: 'delete', description: 'Delete this report (run it in its post)', default_member_permissions: ADMIN },
  { name: 'block', description: 'Close this report: the user can no longer write in it', default_member_permissions: ADMIN },
  {
    name: 'merge', description: 'Merge this report into another one (duplicate)', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'into', description: 'Link or ID of the other report’s post', required: true }],
  },
  {
    name: 'announce', description: 'Show an announcement in the app and on the website', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'template', description: 'Start from a saved template (edit them in /stats)', required: false, autocomplete: true }],
  },
  { name: 'announce-clear', description: 'Remove the current announcement', default_member_permissions: ADMIN },
  { name: 'poll', description: 'Start a poll in the app and on the website', default_member_permissions: ADMIN },
  { name: 'poll-end', description: 'End the current poll and post its results', default_member_permissions: ADMIN },
  {
    name: 'setup', description: 'Use this channel for the bot', default_member_permissions: ADMIN,
    options: [
      {
        type: 3, name: 'use', description: 'What this channel is for', required: true,
        choices: [
          { name: 'Alerts, daily summary and release drafts (private)', value: 'alerts' },
          { name: 'Release announcements', value: 'announcements' },
          { name: 'Test builds', value: 'testers' },
          { name: 'To-do list (suggestions to keep)', value: 'todo' },
        ],
      },
      { type: 8, name: 'role', description: 'Role to mention (release announcements or test builds)', required: false },
    ],
  },
  { name: 'summary', description: 'Post the daily summary now', default_member_permissions: ADMIN },
  // Menu « Apps » d'un message (clic droit, ou appui long sur mobile).
  { type: 3, name: 'Add to to-do', default_member_permissions: ADMIN },
  {
    name: 'todo', description: 'Add an item to the to-do channel', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'text', description: 'What to do', required: true, max_length: 1500 }],
  },
  { name: 'release-pings', description: 'Get pinged when a new version is out (run it again to stop)' },
  { name: 'status', description: 'Server status: Workers, database, notifications, versions, quotas', default_member_permissions: ADMIN },
  {
    name: 'forget-user', description: 'Erase a person’s data (shows what will go, then asks to confirm)', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'who', description: 'Twitch name/ID, install ID, report link/ID, @user, ntfy topic (several allowed)', required: true, max_length: 1000 }],
  },
]
const MAX_PHOTO_B64 = 700_000     // comme le Worker (~500 Ko d'image)
// Octets d'une image qui tient dans MAX_PHOTO_B64 : au-delà, pas la peine de
// la télécharger.
const MAX_PHOTO_BYTES = MAX_PHOTO_B64 / 4 * 3
const MAX_PHOTOS = 3              // par message, comme le Worker
const MAX_TAGS = 5                // par post (limite de Discord)
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_TYPES = 'JPEG, PNG or WebP'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n)
const row = (...components) => ({ type: 1, components })
const button = (label, custom_id, style = 2) => ({ type: 2, style, label, custom_id })
const textInput = (custom_id, label, style, { min, max, required = true, placeholder, value } = {}) =>
  ({ type: 4, custom_id, label, style, required, ...(min ? { min_length: min } : {}), ...(max ? { max_length: max } : {}), ...(placeholder ? { placeholder } : {}),
    ...(value ? { value: String(value).slice(0, max || 4000) } : {}) })
// Formulaire « Send screenshots » : chaque champ dans un « Label » (type 18,
// libellé de 45 caractères au plus, description de 100), les fichiers dans
// un « File Upload » (type 19).
const labelled = (label, component, description) => ({ type: 18, label, ...(description ? { description } : {}), component })
const fileUpload = (custom_id) => ({ type: 19, custom_id, min_values: 1, max_values: MAX_PHOTOS, required: true })
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`
const bullets = (body) => String(body || '').split('\n').map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => `- ${l.slice(2).trim()}`)

/** Entrées anglaises d'une version dans changelog.js du site (chaînes entre
 *  apostrophes droites, lues sans exécuter le fichier). */
function changelogItems(src, version) {
  const at = src.indexOf(`version: '${version}'`)
  if (at < 0) return []
  const end = src.indexOf('version: ', at + 10)
  const block = src.slice(at, end > 0 ? end : undefined)
  const en = block.match(/\ben:\s*\[([\s\S]*?)\]/)
  if (!en) return []
  return [...en[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
}

/** Compare deux versions (« 1.4.12 », « 2026.10.18a ») : nombres comparés en
 *  nombres, lettres en texte. < 0, 0 ou > 0. */
export function compareVersions(a, b) {
  const parts = (v) => String(v).match(/\d+|[^\d.]+/g) || []
  const x = parts(a), y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1
    if (y[i] === undefined) return 1
    const c = /^\d+$/.test(x[i]) && /^\d+$/.test(y[i]) ? Number(x[i]) - Number(y[i]) : x[i].localeCompare(y[i])
    if (c) return c
  }
  return 0
}

/** Texte en morceaux de `max` caractères au plus, coupés aux lignes (une
 *  ligne trop longue est coupée elle aussi, plutôt que tronquée). */
function chunks(text, max = 1900) {
  const parts = []
  let cur = ''
  for (let line of String(text).split('\n')) {
    while (line.length > max) {
      if (cur) { parts.push(cur); cur = '' }
      parts.push(line.slice(0, max))
      line = line.slice(max)
    }
    if (cur && cur.length + line.length + 1 > max) { parts.push(cur); cur = '' }
    cur = cur ? `${cur}\n${line}` : line
  }
  if (cur) parts.push(cur)
  return parts
}

export function startDiscordBridge({
  token, secret, worker, admins = [],
  api = 'https://discord.com/api/v10',
  gateway = 'wss://gateway.discord.gg/?v=10&encoding=json',
  github = 'https://api.github.com',
  site = 'https://twitchunblock.vercel.app',
  repos = { ios: 'MXFia19/TwitchUnblock', web: 'MXFia19/TwitchUnblock-Web', android: 'MXFia19/TwitchUnblock-Android' },
  fallbacks = ['https://test2-fallback.vxcraftmanpetit.workers.dev'],
  testSource = 'https://raw.githubusercontent.com/MXFia19/TwitchUnblock/test-17d298/apps-test.json',
  summaryTz = 'Europe/Paris',
  summaryHour = 9,
  // Commit et branche de l'image du relais (GIT_SHA, GIT_BRANCH) ; quotas de
  // Cloudflare : { token, account } (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
  version = '',
  branch = '',
  cloudflare = {},
  cloudflareApi = 'https://api.cloudflare.com/client/v4/graphql',
  timers = true,
  log = console,
}) {
  if (!token || !secret || !worker) {
    log.warn('Discord bridge off: DISCORD_BOT_TOKEN, FEEDBACK_BOT_SECRET and FEEDBACK_WORKER are needed')
    return null
  }
  try { new Intl.DateTimeFormat('en', { timeZone: summaryTz }) } catch {
    log.warn(`Discord bridge: SUMMARY_TZ “${summaryTz}” isn’t a time zone — Europe/Paris used instead`)
    summaryTz = 'Europe/Paris'
  }
  if (!Number.isInteger(summaryHour) || summaryHour < 0 || summaryHour > 23) {
    log.warn('Discord bridge: SUMMARY_HOUR must be between 0 and 23 — 9 used instead')
    summaryHour = 9
  }
  worker = worker.replace(/\/+$/, '')
  api = api.replace(/\/+$/, '')
  site = site.replace(/\/+$/, '')
  const extraAdmins = new Set(admins)
  const st = {
    forum: null, forumType: null, guild: null, owner: null, me: null, app: null, labels: {},
    settings: {},          // salons choisis avec /setup
    tagOf: new Map(),      // état → étiquette
    stateOf: new Map(),    // étiquette → état
    threads: new Map(),    // post du forum → étiquettes posées
    parents: new Map(),    // salon → parent (null : pas un post du forum)
    states: new Map(),     // post → { value: état du retour | null, at }
    expected: new Map(),   // post → étiquettes que le bot vient de poser
    quickDone: new Set(),  // posts qui ont leurs réponses rapides
    fixAsked: new Set(),   // posts où l'on a demandé où sort le correctif
    dmWarned: new Set(),
    alerts: null,          // pannes en cours (watchHealth), copie dans le Worker
    shots: new Map(),      // personne → capture de /bug ou /idea, le temps du formulaire
    dmHints: new Map(),    // personne → dernier renvoi vers les boutons (MP tapé)
    summaryDay: null,
  }
  let ws = null
  let seq = null
  let session = null
  let beatTimer = null
  let firstBeat = null
  let acked = true
  let retries = 0
  let stopped = false
  let backfilling = false
  const intervals = []
  // Passerelle : état pour /health du relais (sa HEALTHCHECK) et /status.
  // waiting (réglages du Worker), connecting, ready, stopped (refus définitif).
  const gw = { state: 'waiting', since: Date.now(), readyAt: 0, lastAck: 0, interval: 0 }
  const gwState = (s) => { if (gw.state !== s) Object.assign(gw, { state: s, since: Date.now() }) }

  // ── API de Discord, du Worker, de GitHub ────────────────────────────────
  /** `files` ({ bytes, type, name }) : envoyés en multipart (payload_json +
   *  files[n]), formulaire refait à chaque essai ; fetch pose lui-même le
   *  Content-Type avec sa frontière. */
  async function rest(method, path, body, files = []) {
    for (let attempt = 0; ; attempt++) {
      let payload = body ? JSON.stringify(body) : undefined
      if (files.length) {
        payload = new FormData()
        payload.append('payload_json', JSON.stringify({ ...body, attachments: files.map((f, n) => ({ id: n, filename: f.name })) }))
        files.forEach((f, n) => payload.append(`files[${n}]`, new Blob([f.bytes], { type: f.type }), f.name))
      }
      const r = await fetch(`${api}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': 'DiscordBot (https://github.com/MXFia19/TwitchUnblock-Web, 1)',
          ...(body && !files.length ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload,
        signal: AbortSignal.timeout(files.length ? 30_000 : 15_000),
      })
      if (r.status === 429 && attempt < 3) {
        const j = await r.json().catch(() => ({}))
        await sleep(Math.min(10, Number(j.retry_after) || 1) * 1000)
        continue
      }
      const text = await r.text().catch(() => '')
      if (!r.ok) {
        let code = 0
        try { code = JSON.parse(text).code || 0 } catch {}
        const e = new Error(`${method} ${path.split('?')[0]} → ${r.status}${code ? ` (${code})` : ''}`)
        e.code = code
        throw e
      }
      try { return text ? JSON.parse(text) : null } catch { return null }
    }
  }

  async function call(body) {
    const r = await fetch(`${worker}/api/feedback/discord`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const e = new Error(data.error || `HTTP ${r.status}`)
      e.status = r.status
      throw e
    }
    return data
  }
  const kvGet = async (key) => (await call({ action: 'get', key })).value
  const kvSet = (key, value, ttl) => call({ action: 'set', key, value, ...(ttl ? { ttl } : {}) })

  async function fetchText(url) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'TwitchUnblock-relay' }, signal: AbortSignal.timeout(15_000) })
      return r.ok ? await r.text() : null
    } catch { return null }
  }
  async function gh(path) {
    const text = await fetchText(`${github}${path}`)
    try { return text ? JSON.parse(text) : null } catch { return null }
  }

  const react = (channel, message, emoji) => rest('PUT',
    `/channels/${channel}/messages/${message}/reactions/${encodeURIComponent(emoji)}/@me`)
    .catch((e) => log.warn(`Discord bridge: reaction failed (${e.message})`))
  const say = (channel, content, extra = {}) => rest('POST', `/channels/${channel}/messages`,
    { content: content.slice(0, 1900), allowed_mentions: { parse: [] }, ...extra }).catch(() => null)
  const isAdmin = (id) => Boolean(id) && (id === st.owner || extraAdmins.has(id))
  const label = (s) => st.labels[s] || LABELS[s] || s
  /** Auteur d'une action du développeur, pour le journal d'audit du Worker
   *  (un Worker d'avant l'ignore). */
  const byOf = (u) => (u?.id ? { id: u.id, name: u.global_name || u.username || '' } : null)

  /** Texte en messages de 1900 caractères au plus, coupés aux lignes ;
   *  `components` sur le dernier. */
  async function sendChunks(channel, text, { components, allowed_mentions = { parse: [] } } = {}) {
    const parts = chunks(text)
    let last = null
    for (let n = 0; n < parts.length; n++) {
      last = await rest('POST', `/channels/${channel}/messages`, {
        content: parts[n], allowed_mentions, ...(n === parts.length - 1 && components ? { components } : {}),
      })
    }
    return last
  }

  // ── Retours, posts et étiquettes ────────────────────────────────────────
  /** Retour lié au post (état, correctif, Discord…), ou null. `wait` : post
   *  tout juste créé, le Worker range le lien juste après — on réessaie. */
  async function stateOf(thread, { wait = false, fresh = false } = {}) {
    const known = st.states.get(thread)
    if (!fresh && known && (known.value || Date.now() - known.at < 60_000)) return known.value
    for (const delay of wait ? [0, 1500, 4000, 10_000] : [0]) {
      if (delay) await sleep(delay)
      try {
        const s = await call({ action: 'state', thread })
        st.states.set(thread, { value: s, at: Date.now() })
        return s
      } catch (e) {
        if (e.status !== 404) {
          log.warn(`Discord bridge: state of post ${thread} unreadable (${e.message})`)
          return known?.value ?? null
        }
      }
    }
    st.states.set(thread, { value: null, at: Date.now() })
    return null
  }
  const remember = (thread, s) => st.states.set(thread, { value: s, at: Date.now() })
  const forget = (thread) => { st.threads.delete(thread); st.states.delete(thread); st.parents.delete(thread) }

  function readTags(channel) {
    st.tagOf.clear()
    st.stateOf.clear()
    for (const t of channel?.available_tags || []) {
      const s = statusOfName(t.name)
      if (s && !st.tagOf.has(s)) {
        st.tagOf.set(s, t.id)
        st.stateOf.set(t.id, s)
      }
    }
  }

  /** Étiquettes d'état : créées s'il en manque, renommées en anglais
   *  (même identifiant : les posts gardent les leurs). Droit « Gérer les
   *  salons » ; sinon, à faire à la main avec ces noms. */
  async function ensureTags(channel) {
    if (!channel) return
    readTags(channel)
    const tags = channel.available_tags || []
    const missing = STATUSES.filter((s) => !st.tagOf.has(s))
    const renamed = new Map([...st.tagOf].filter(([s, id]) => tags.find((t) => t.id === id)?.name !== label(s)).map(([s, id]) => [id, label(s)]))
    if (!missing.length && !renamed.size) return
    if (tags.length + missing.length > 20) {
      log.warn(`Discord bridge: no room left for the tags ${missing.map(label).join(', ')} (20 per forum)`)
      return
    }
    try {
      const updated = await rest('PATCH', `/channels/${channel.id}`, {
        available_tags: [
          ...tags.map((t) => ({ id: t.id, name: renamed.get(t.id) || t.name, moderated: t.moderated, emoji_id: t.emoji_id, emoji_name: t.emoji_name })),
          ...missing.map((s) => ({ name: label(s), moderated: true })),
        ],
      })
      readTags(updated || channel)
      if (missing.length) log.log(`Discord bridge: tags created (${missing.map(label).join(', ')})`)
      if (renamed.size) log.log(`Discord bridge: tags renamed (${[...renamed.values()].join(', ')})`)
    } catch (e) {
      log.warn(`Discord bridge: create or rename the tags by hand (${STATUSES.map(label).join(', ')}) — ${e.message}`)
    }
  }

  /** Post du forum ? Son parent, d'après ce qu'on a vu ou demandé à Discord. */
  async function parentOf(channel) {
    if (st.threads.has(channel)) return st.forum
    if (st.parents.has(channel)) return st.parents.get(channel)
    try {
      const c = await rest('GET', `/channels/${channel}`)
      st.parents.set(channel, c?.parent_id || null)
      if (c?.parent_id === st.forum) st.threads.set(channel, c.applied_tags || [])
      return c?.parent_id || null
    } catch {
      return null
    }
  }

  /** Étiquettes du post accordées à l'état du retour : celle de l'état, les
   *  autres étiquettes (hors états) gardées. */
  async function syncTags(thread, status) {
    const tag = st.tagOf.get(status)
    const cur = st.threads.get(thread)
    if (!tag || !cur) return
    let next = [...cur.filter((t) => !st.stateOf.has(t)), tag]
    if (next.length > MAX_TAGS) next = next.slice(-MAX_TAGS)
    if (next.length === cur.length && next.every((t) => cur.includes(t))) return
    st.expected.set(thread, next)
    try {
      try {
        await rest('PATCH', `/channels/${thread}`, { applied_tags: next })
      } catch (e) {
        // Post archivé (inactif) : rouvert le temps de changer l'étiquette.
        if (e.code !== 50083) throw e
        await rest('PATCH', `/channels/${thread}`, { archived: false, applied_tags: next })
      }
      st.threads.set(thread, next)
    } catch (e) {
      st.expected.delete(thread)
      log.warn(`Discord bridge: tag of post ${thread} not set (${e.message})`)
    }
  }

  /** Images jointes (JPEG, PNG, WebP), en base64 pour le Worker. Trop
   *  lourde : la version réduite du CDN de Discord (1280 px au plus, WebP).
   *  `reduce` (captures des personnes) : la version réduite d'abord, moins
   *  lourde à ranger, l'original en repli. */
  async function photosOf(list, { reduce = false } = {}) {
    const ok = []
    let skipped = Math.max(0, list.length - MAX_PHOTOS)
    for (const a of list.slice(0, MAX_PHOTOS)) {
      if (!/^image\/(jpeg|png|webp)/.test(a.content_type || '')) { skipped++; continue }
      let small = null
      if (a.proxy_url && a.width && a.height) {
        const scale = Math.min(1, 1280 / Math.max(a.width, a.height))
        const u = new URL(a.proxy_url)
        u.searchParams.set('width', String(Math.round(a.width * scale)))
        u.searchParams.set('height', String(Math.round(a.height * scale)))
        u.searchParams.set('format', 'webp')
        small = u.href
      }
      const fits = (b64) => Boolean(b64) && b64.length <= MAX_PHOTO_B64
      // L'original, seulement s'il peut tenir (taille annoncée par Discord).
      const original = () => (Number(a.size) > MAX_PHOTO_BYTES ? null : fetchB64(a.url))
      let b64 = reduce && small ? await fetchB64(small) : null
      if (!fits(b64)) b64 = await original()
      if (!fits(b64) && small && !reduce) b64 = await fetchB64(small)
      if (fits(b64)) ok.push(b64)
      else skipped++
    }
    return { ok, skipped }
  }
  const skippedNote = (n) => (n ? ` (${plural(n, 'file')} not sent: too big, or not a ${PHOTO_TYPES} image — ${MAX_PHOTOS} at most.)` : '')
  /** Captures envoyées au Worker mais pas rangées (Worker pas encore à
   *  jour : il ignore les photos) : la personne le sait. */
  const unsavedNote = (sent, r) => (sent && (Number(r?.photos) || 0) < sent ? ' ⚠️ The screenshot(s) couldn’t be saved — please send them again later.' : '')

  /** Fichier en base64, ou null au-delà de MAX_PHOTO_BYTES : lu par
   *  morceaux, le téléchargement s'arrête dès qu'il dépasse. Chargé en entier
   *  avant d'être refusé, un faux « .png » de plusieurs centaines de Mo
   *  (n'importe quel membre, /bug) pouvait faire tomber le processus, qui
   *  porte aussi le relais vidéo et ntfy. */
  async function fetchB64(url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!r.ok || Number(r.headers.get('content-length')) > MAX_PHOTO_BYTES) {
        await r.body?.cancel().catch(() => {})
        return null
      }
      const parts = []
      let size = 0
      for await (const chunk of r.body || []) {
        size += chunk.length
        if (size > MAX_PHOTO_BYTES) return null   // sortir de la boucle annule le téléchargement
        parts.push(chunk)
      }
      return Buffer.concat(parts).toString('base64')
    } catch {
      return null
    }
  }

  // ── Messages privés (retours envoyés depuis Discord) ────────────────────
  const dmChannels = new Map()
  /** `key` : boutons pour répondre, en texte (« Reply », le formulaire le
   *  plus simple, lu par tous les clients) ou en captures. Long texte : en
   *  plusieurs messages (photos sur le premier, boutons sur le dernier). */
  async function sendDm(userId, content, key, files = []) {
    let ch = dmChannels.get(userId)
    if (!ch) {
      ch = (await rest('POST', '/users/@me/channels', { recipient_id: userId }))?.id
      if (!ch) throw new Error('no DM channel')
      dmChannels.set(userId, ch)
    }
    const parts = chunks(content)
    for (let n = 0; n < parts.length; n++) {
      await rest('POST', `/channels/${ch}/messages`, {
        content: parts[n], allowed_mentions: { parse: [] },
        ...(key && n === parts.length - 1 ? { components: [row(button('Reply', `ur:${key}`, 1), button('Send screenshots', `us:${key}`))] } : {}),
      }, n === 0 ? files : [])
    }
  }

  /** Réponses du développeur pas encore envoyées à qui a écrit depuis
   *  Discord : en message privé, une par une, dans l'ordre, images jointes
   *  (lues une par une au Worker). Discord refuse les fichiers : le texte
   *  part seul, et le post le dit. */
  const dmQueue = new Map()
  function deliverDm(thread) {
    const run = (dmQueue.get(thread) || Promise.resolve()).then(async () => {
      // `peek` : le Worker ne note rien ; ce qui part vraiment est noté
      // après coup (delivered). Noté d'avance, un envoi raté était perdu.
      const r = await call({ action: 'deliver', thread, pics: true, peek: true })
      if (!r?.du || !r.items?.length) return
      for (const it of r.items) {
        const files = []
        for (const n of it.pics || []) {
          const p = await call({ action: 'photo', thread, n }).catch(() => null)
          if (p?.b64) files.push({ bytes: Buffer.from(p.b64, 'base64'), type: p.type, name: `picture${files.length + 1}.${EXT[p.type] || 'jpg'}` })
        }
        const ph = it.ph || 0
        const withLost = (text, k) => (k > 0 ? `${text}\n(📷 ${plural(k, 'picture')} couldn’t be sent here)` : text)
        const text = it.m || ph
          ? `💬 **The developer replied** about your report “${r.excerpt}”:${it.m ? `\n${it.m}` : ''}`
          : `📌 Your report “${r.excerpt}” is now **${it.label}**.`
        try {
          try {
            await sendDm(r.du, withLost(text, ph - files.length), r.key, files)
          } catch (e) {
            // MP fermés : rien ne passera. Autre refus avec des fichiers
            // (trop lourds, délai…) : le texte seul.
            if (!files.length || e.code === 50007) throw e
            await sendDm(r.du, withLost(text, ph), r.key)
            await say(thread, `⚠️ The picture(s) couldn’t be sent to the user in a direct message (${e.message}) — the text went through.`)
          }
        } catch (e) {
          if (e.code !== 50007) log.warn(`Discord bridge: DM to the user of post ${thread} not sent (${e.message})`)
          if (!st.dmWarned.has(thread)) {
            st.dmWarned.add(thread)
            // La vraie raison : ce n'est pas toujours des MP fermés. Le reste
            // repartira à la prochaine réponse (rien n'a été noté comme livré).
            await say(thread, `⚠️ I couldn’t send this to the user in a direct message (${e.code === 50007 ? 'their DMs are closed' : e.message}). It will be tried again with the next reply.`)
          }
          break
        }
        if (Number.isInteger(it.i)) await call({ action: 'delivered', thread, upTo: it.i }).catch(() => {})
      }
    }).catch((e) => log.warn(`Discord bridge: DM delivery failed (${e.message})`))
    dmQueue.set(thread, run)
    return run
  }

  // ── Après une réponse ou un état du développeur ─────────────────────────
  /** Nouveau retour : réponses rapides, et le propriétaire du serveur
   *  mentionné (notification Discord) avec son genre (`kind` : titre de
   *  l'encadré du webhook, « 💡 Idea », « 🐞 Bug »…) — une fois toutes les
   *  10 min au plus : une rafale de retours le faisait sonner à chacun. */
  let lastPing = 0
  async function postQuickReplies(thread, kind = '') {
    if (st.quickDone.has(thread)) return
    st.quickDone.add(thread)
    const mention = Boolean(st.owner) && Date.now() - lastPing >= 10 * 60_000
    if (mention) lastPing = Date.now()
    const ping = mention ? `🔔 <@${st.owner}> New report${kind ? `: ${kind}` : ''}\n` : ''
    await say(thread, `${ping}⚡ **Quick replies** — sent to the user as your reply:`, {
      ...(mention ? { allowed_mentions: { parse: [], users: [st.owner] } } : {}),
      components: [
        row(...QUICK.slice(0, 3).map((q, n) => button(q.label, `qr:${n}`))),
        row(...QUICK.slice(3).map((q, n) => button(q.label, `qr:${n + 3}`))),
      ],
    })
  }

  async function fixPrompt(thread) {
    if (st.fixAsked.has(thread)) return
    st.fixAsked.add(thread)
    await say(thread, '🚀 **Where will the fix ship?** I’ll tell the user as soon as it’s live.', {
      components: [
        row(button('In the app', 'fx:ios', 1), button('On the website', 'fx:web', 1), button('Both', 'fx:both', 1), button('Don’t tell them', 'fx:none')),
        row(button('Apple TV app', 'fx:tvos', 1), button('Android app', 'fx:android', 1)),
      ],
    })
  }

  async function afterTeamUpdate(thread, s, prevStatus) {
    if (!s) return
    await syncTags(thread, s.status)
    // État précédent inconnu (bot redémarré, changement fait dans /stats) :
    // la question est posée quand même (une fois) — la personne n'était
    // sinon jamais prévenue.
    if (s.status === 'done' && prevStatus !== 'done' && !s.fix) await fixPrompt(thread)
    if (s.discord) await deliverDm(thread)
    // Doublons fusionnés ici : leur état a suivi (Worker) ; leur étiquette et
    // leurs messages privés aussi.
    for (const dt of s.dupThreads || []) {
      const ds = await stateOf(dt, { fresh: true }).catch(() => null)
      if (!ds) continue
      await syncTags(dt, ds.status)
      if (ds.discord) await deliverDm(dt)
    }
  }

  /** Retours d'avant le pont : le Worker en publie quelques-uns par appel,
   *  on rappelle jusqu'au bout (au rythme demandé par Discord). Seulement
   *  dans un salon Forum : ailleurs, ils n'auraient pas de post à eux. */
  async function backfill() {
    if (backfilling || st.forumType !== FORUM) return
    backfilling = true
    let total = 0
    try {
      for (let round = 0; round < 500 && !stopped; round++) {
        const r = await call({ action: 'backfill' })
        total += r.done || 0
        if (r.error) { log.warn(`Discord bridge: older reports — ${r.error}`); break }
        if (!r.remaining || (!r.done && !r.retryAfter)) break
        await sleep(r.retryAfter ? Math.ceil(r.retryAfter * 1000) + 500 : 2500)
      }
    } catch (e) {
      log.warn(`Discord bridge: older reports not published (${e.message})`)
    } finally {
      backfilling = false
      if (total) log.log(`Discord bridge: ${total} older report(s) published in the forum`)
    }
  }

  // ── Événements de la passerelle ─────────────────────────────────────────
  async function onGuild(g) {
    st.owner = g.owner_id
    const forum = (g.channels || []).find((c) => c.id === st.forum)
    if (!forum) {
      log.warn(`Discord bridge: channel ${st.forum} of the webhook not found — the bot must be able to see it (channel permissions)`)
      return
    }
    st.forumType = forum.type
    if (forum.type !== FORUM) log.warn('Discord bridge: the webhook isn’t in a Forum channel — reports have no post of their own')
    // Retours, contacts et erreurs récentes (chaînes et vidéos regardées) y
    // sont publiés : le salon doit être privé (README), comme /stats.
    // @everyone sans « Voir le salon » (1 << 10), sinon on prévient.
    const everyone = (forum.permission_overwrites || []).find((o) => o.id === g.id)
    if (!(everyone && BigInt(everyone.deny || 0) & 1024n)) {
      const text = `⚠️ The reports channel <#${forum.id}> looks visible to everyone, but reports, contacts and recent errors (channels watched) are posted there: make it private (@everyone without “View Channel”).`
      log.warn(`Discord bridge: ${text}`)
      await alert(text)
    }
    await ensureTags(forum)
    for (const th of g.threads || []) {
      if (th.parent_id === st.forum) st.threads.set(th.id, th.applied_tags || [])
    }
    log.log(`Discord bridge: following forum “${forum.name}” — ${st.threads.size} open post(s), ${st.tagOf.size}/6 status tags`)
    // Changements faits pendant que le bot était arrêté : étiquettes remises.
    for (const id of [...st.threads.keys()].slice(0, 50)) {
      const s = await stateOf(id)
      if (s) await syncTags(id, s.status)
    }
    backfill()
  }

  async function onThreadUpdate(d) {
    if (d.parent_id !== st.forum) return
    const wasKnown = st.threads.has(d.id)
    const prev = st.threads.get(d.id) || []
    const tags = d.applied_tags || []
    st.threads.set(d.id, tags)
    const expected = st.expected.get(d.id)
    if (expected) {
      st.expected.delete(d.id)
      if (expected.length === tags.length && expected.every((t) => tags.includes(t))) return   // notre changement
    }
    // Post inconnu (archivé avant un redémarrage du bot) : ses étiquettes ne
    // disent rien d'un changement — toutes passaient pour « ajoutées », et
    // rouvert après un changement d'état depuis /stats, l'ancienne étiquette
    // l'annulait. L'état du Worker fait foi.
    if (!wasKnown) {
      const known = await stateOf(d.id)
      if (known) await syncTags(d.id, known.status)
      return
    }
    const added = tags.filter((t) => st.stateOf.has(t) && !prev.includes(t))
    if (!added.length) return
    const status = st.stateOf.get(added[added.length - 1])
    const known = await stateOf(d.id)
    if (!known) return
    if (known.status === status) return syncTags(d.id, status)
    try {
      // Étiquette changée à la main : Discord ne dit pas par qui.
      const r = await call({ action: 'status', thread: d.id, status, by: { name: 'post tag' } })
      remember(d.id, r)
      log.log(`Discord bridge: ${r.key} → ${r.status}`)
      await afterTeamUpdate(d.id, r, known.status)
    } catch (e) {
      // L'étiquette revient à l'état réel du retour.
      await syncTags(d.id, known.status)
      say(d.id, `❌ Status not changed: ${e.message}`)
    }
  }

  /** Message privé tapé au bot : il ne le lit pas (rien n'est gardé), il
   *  renvoie vers les boutons, au plus une fois par heure et par personne. */
  async function onDirectMessage(m) {
    const who = m.author?.id
    if (!who || m.author.bot || who === st.me) return
    const now = Date.now()
    if (now - (st.dmHints.get(who) || 0) < 3600_000) return
    if (st.dmHints.size > 5000) st.dmHints.clear()
    st.dmHints.set(who, now)
    await say(m.channel_id, 'ℹ️ I don’t read messages sent here. To answer about your report, use the buttons under my last message: **Reply** for text, **Send screenshots** for pictures. To report something new, use /bug or /idea in the server.')
  }

  async function onMessage(m) {
    if (!m.guild_id) return onDirectMessage(m)
    if (m.guild_id === st.guild && m.channel_id && m.channel_id === st.settings.announcements) return noteAnnouncement(m)
    if (m.guild_id !== st.guild || !st.forum) return
    if (m.author?.id && m.author.id === st.me) return
    if (await parentOf(m.channel_id) !== st.forum) return
    const thread = m.channel_id
    // Messages du webhook (retour, réponse de la personne, ce qui a été fait
    // dans /stats ou l'app, « c'est en ligne ») : l'étiquette suit l'état,
    // les réponses partent en message privé, un nouveau retour reçoit ses
    // réponses rapides.
    if (m.webhook_id) {
      // Retour supprimé dans /stats : le Worker l'annonce par un mot dans
      // son post, que la corbeille supprime.
      if ((await emptyTrash().catch(() => [])).includes(thread)) return
      const prev = st.states.get(thread)?.value?.status
      const s = await stateOf(thread, { wait: true, fresh: true })
      if (!s) return
      await afterTeamUpdate(thread, s, prev)
      if (m.id === thread && s.status === 'new') await postQuickReplies(thread, m.embeds?.[0]?.title || '')
      return
    }
    if (m.author?.bot || !isAdmin(m.author?.id)) return
    const text = String(m.content || '').trim()
    if (text.startsWith('//')) return   // note privée
    if (text.length > 2000) {
      await react(thread, m.id, '⚠️')
      say(thread, `⚠️ Not sent: ${text.length} characters, 2000 at most — split it into several messages.`)
      return
    }
    const photos = await photosOf(m.attachments || [])
    if (!text && !photos.ok.length) {
      if (photos.skipped) say(thread, `⚠️ Nothing sent: too big, or not a ${PHOTO_TYPES} image.`)
      return
    }
    const s = await stateOf(thread)
    if (!s) { react(thread, m.id, '❔'); return }
    try {
      const r = await call({ action: 'reply', thread, message: text, photos: photos.ok, by: byOf(m.author) })
      remember(thread, r)
      await react(thread, m.id, '✅')
      await afterTeamUpdate(thread, r, s.status)
      if (photos.skipped) say(thread, `⚠️ ${photos.skipped} attachment(s) not sent: too big, or not a JPEG, PNG or WebP image.`)
    } catch (e) {
      await react(thread, m.id, '❌')
      say(thread, `❌ Reply not sent: ${e.message}`)
    }
  }

  // ── Commandes, boutons, formulaires ─────────────────────────────────────
  const respond = (i, type, data) => rest('POST', `/interactions/${i.id}/${i.token}/callback`, data ? { type, data } : { type })
  const editOriginal = (i, data) => rest('PATCH', `/webhooks/${st.app}/${i.token}/messages/@original`, data).catch(() => null)
  const opt = (i, name) => i.data?.options?.find((o) => o.name === name)?.value
  // Champs d'un formulaire : en rangée (type 1) ou dans un Label (type 18).
  const inputs = (i) => (i.data?.components || []).flatMap((r) => r.components || (r.component ? [r.component] : []))
  const field = (i, id) => String(inputs(i).find((c) => c.custom_id === id)?.value || '').trim()
  /** Fichiers d'un champ « File Upload » : ses valeurs sont des numéros de
   *  pièces jointes, décrites dans `resolved`. */
  const uploads = (i, id) => (inputs(i).find((c) => c.custom_id === id)?.values || [])
    .map((v) => i.data?.resolved?.attachments?.[v]).filter(Boolean)
  /** Réponse différée (le Worker peut prendre plus de 3 s), visible de soi seul. */
  async function deferred(i, fn) {
    await respond(i, 5, { flags: 64 })
    try {
      await editOriginal(i, { content: String(await fn()).slice(0, 1900) })
    } catch (e) {
      await editOriginal(i, { content: `❌ ${e.message}` })
    }
  }
  const adminOnly = (i) => respond(i, 4, { flags: 64, content: 'Only the developer can use this.' })

  const reportModal = (kind, shot) => ({
    custom_id: `report:${kind}`,
    // 45 caractères au plus (« Suggest an idea — file ignored (not an image) » : 45)
    title: `${kind === 'idea' ? 'Suggest an idea' : 'Report a bug'}${shot === 'ok' ? ' — screenshot attached' : shot === 'bad' ? ' — file ignored (not an image)' : ''}`,
    components: [
      row(textInput('text', kind === 'idea' ? 'Your idea' : 'What happened?', 2, {
        min: 5, max: 2000,
        placeholder: kind === 'idea' ? 'What would you like to see in TwitchUnblock?' : 'What you did, what you expected, what happened instead',
      })),
      row(textInput('where', 'App or website, and version (optional)', 1, { max: 60, required: false, placeholder: 'e.g. iOS app 1.3.0, or the website' })),
    ],
  })
  /** `tpl` : modèle choisi (/announce template:), qui pré-remplit le formulaire. */
  const announceModal = (tpl = null) => ({
    custom_id: 'announce',
    title: 'Announcement (app and website)',
    components: [
      row(textInput('title', 'Title (optional)', 1, { max: 80, required: false, value: tpl?.title })),
      row(textInput('message', 'Message', 2, { max: 500, required: false, value: tpl?.message })),
      row(textInput('link', 'Link (optional, https://…)', 1, { max: 300, required: false, value: tpl?.link })),
      row(textInput('hours', 'Show it for how many hours? (default 24)', 1, { max: 4, required: false })),
    ],
  })

  const pollModal = () => ({
    custom_id: 'poll',
    title: 'Poll (app and website)',
    components: [
      row(textInput('question', 'Question', 1, { max: 140 })),
      row(textInput('options', 'Choices, one per line (2 to 6)', 2, { max: 400 })),
      row(textInput('multi', 'Several choices per person? (yes / no)', 1, { max: 3, required: false, placeholder: 'no' })),
      row(textInput('hours', 'Open for how many hours? (default 24)', 1, { max: 4, required: false })),
    ],
  })

  async function onInteraction(i) {
    const user = i.member?.user || i.user
    if (!user) return
    if (i.type === 2) return onCommand(i, user)
    if (i.type === 3) return onComponent(i, user)
    if (i.type === 4) return onAutocomplete(i, user)
    if (i.type === 5) return onModal(i, user)
  }

  /** Modèles d'annonce (/announce template:, modifiés dans /stats), gardés
   *  ici : relus par le battement (10 min) et, en arrière-plan, à chaque
   *  saisie. Discord n'attend que 3 s une réponse ; demandés au Worker avant
   *  de répondre, un Worker lent ou froid faisait « L'application n'a pas
   *  répondu ». */
  const templates = { list: [], at: 0 }
  async function refreshTemplates() {
    const r = await call({ action: 'announce-templates' })
    if (Array.isArray(r?.templates)) Object.assign(templates, { list: r.templates, at: Date.now() })
  }

  /** /announce template: : les modèles enregistrés. */
  async function onAutocomplete(i, user) {
    if (!isAdmin(user.id)) return respond(i, 8, { choices: [] })
    if (Date.now() - templates.at > 30_000) refreshTemplates().catch(() => {})
    const typed = String(i.data?.options?.find((o) => o.focused)?.value || '').toLowerCase()
    const choices = templates.list.filter((x) => String(x.name).toLowerCase().includes(typed))
      .slice(0, 25).map((x) => ({ name: String(x.name).slice(0, 100), value: String(x.id) }))
    return respond(i, 8, { choices })
  }

  /** Capture passée en option de /bug ou /idea : gardée 10 minutes, le
   *  temps de remplir le formulaire (une par personne, la dernière). Un
   *  fichier qui n'est pas une image n'est pas gardé : le titre du
   *  formulaire le dit ('ok', 'bad', ou null sans fichier). */
  function keepShot(i, user) {
    const shot = i.data?.resolved?.attachments?.[opt(i, 'screenshot')]
    const image = /^image\/(jpeg|png|webp)/.test(shot?.content_type || '')
    const now = Date.now()
    for (const [id, s] of st.shots) if (now - s.at > 10 * 60_000) st.shots.delete(id)
    if (image) st.shots.set(user.id, { at: now, att: shot })
    else st.shots.delete(user.id)
    return shot ? (image ? 'ok' : 'bad') : null
  }
  function takeShot(user) {
    const s = st.shots.get(user.id)
    st.shots.delete(user.id)
    return s && Date.now() - s.at <= 10 * 60_000 ? [s.att] : []
  }

  async function onCommand(i, user) {
    const name = i.data?.name
    if (name === 'bug' || name === 'idea') return respond(i, 9, reportModal(name, keepShot(i, user)))
    if (name === 'release-pings') return deferred(i, () => toggleReleaseRole(i, user))
    if (!isAdmin(user.id)) return adminOnly(i)
    switch (name) {
      case 'Add to to-do':
      case 'todo':
        return deferred(i, () => addTodo(i, user))
      case 'announce': {
        // Modèle choisi : formulaire pré-rempli (à relire avant d'envoyer),
        // depuis les modèles gardés (refreshTemplates).
        const id = opt(i, 'template')
        const tpl = id ? templates.list.find((x) => String(x.id) === String(id)) : null
        return respond(i, 9, announceModal(tpl))
      }
      case 'announce-clear':
        return deferred(i, async () => { await call({ action: 'announce', clear: true, by: byOf(user) }); return 'Announcement removed from the app and the website.' })
      case 'poll': return respond(i, 9, pollModal())
      case 'poll-end':
        return deferred(i, async () => {
          const r = await call({ action: 'poll-end', by: byOf(user) })
          await postPollResults(r.poll, r.results)
          return st.settings.alerts ? `Poll ended: its results are in <#${st.settings.alerts}>.` : 'Poll ended (pick an alerts channel with /setup to get its results).'
        })
      case 'setup': return deferred(i, () => setup(i))
      case 'summary':
        return deferred(i, async () => ((await postSummary(st.settings.alerts || i.channel_id)) ? 'Summary posted.' : 'Nothing to post.'))
      case 'status': return deferred(i, statusText)
      case 'forget-user': return forgetCommand(i, user)
      case 'delete':
      case 'block':
      case 'merge': {
        const thread = i.channel_id
        if (await parentOf(thread) !== st.forum || !(await stateOf(thread))) {
          return respond(i, 4, { flags: 64, content: 'Run this in the post of a report.' })
        }
        if (name === 'delete') {
          return respond(i, 4, {
            flags: 64,
            content: 'Delete this report for good? The user will no longer see it, and this post will be deleted.',
            components: [row(button('Delete for good', 'del:yes', 4), button('Cancel', 'del:no'))],
          })
        }
        if (name === 'block') {
          return deferred(i, async () => {
            await call({ action: 'block', thread, by: byOf(user) })
            await say(thread, '🔒 Conversation closed: the user can no longer write in this report.')
            return 'Done: the user can no longer write in this report.'
          })
        }
        return deferred(i, () => merge(thread, String(opt(i, 'into') || ''), user))
      }
    }
    return respond(i, 4, { flags: 64, content: 'Unknown command.' })
  }

  async function merge(thread, into, user = null) {
    const r = await call({ action: 'merge', thread, into, by: byOf(user) })
    if (r.intoThread) {
      await say(thread, `🔀 Merged into <#${r.intoThread}>: the user was told, and this report will follow its status.`)
      await say(r.intoThread, `🔀 Duplicate merged here: <#${thread}>.`)
    }
    await deliverDm(thread)
    // Son étiquette suit l'état repris de l'autre retour.
    const s = await stateOf(thread, { fresh: true }).catch(() => null)
    if (s) await syncTags(thread, s.status)
    await rest('PATCH', `/channels/${thread}`, { archived: true }).catch(() => {})
    return 'Merged.'
  }

  async function setup(i) {
    const use = String(opt(i, 'use') || '')
    const role = opt(i, 'role') || null
    if (use === 'announcements' && role) {
      const problem = await releaseRoleProblem(i.guild_id || st.guild, role, i.data?.resolved?.roles?.[role])
      if (problem) return `❌ Not set: ${problem}`
    }
    const settings = { ...((await kvGet('settings').catch(() => null)) || st.settings) }
    if (use === 'alerts') settings.alerts = i.channel_id
    else if (use === 'announcements') { settings.announcements = i.channel_id; settings.announcementsRole = role }
    else if (use === 'testers') { settings.testers = i.channel_id; settings.testersRole = role }
    else if (use === 'todo') settings.todo = i.channel_id
    else return 'Unknown choice.'
    await kvSet('settings', settings)
    st.settings = settings
    // Journal d'audit du Worker (un Worker d'avant refuse : sans importance).
    call({ action: 'audit', what: 'bot.setup', detail: `${use} → #${i.channel_id}${role ? ` (role ${role})` : ''}`, by: byOf(i.member?.user || i.user) }).catch(() => {})
    // Rôle des sorties : un bouton dans le salon, pour le prendre ou le rendre.
    if (use === 'announcements' && role) await postReleasePing(i.channel_id)
    return {
      alerts: 'This channel now gets the alerts, the daily summary and the release-notes drafts. Keep it private.',
      announcements: role
        ? `Published release notes will go to this channel and mention <@&${role}> (the role must be mentionable). `
          + 'Members take or drop it with /release-pings or the button I just posted — I need “Manage Roles”, above that role.'
        : 'Published release notes will go to this channel (add a role to mention it at each release).',
      testers: `New test builds will be posted here${role ? ` and mention <@&${role}> (the role must be mentionable)` : ''}.`,
      todo: 'To-do items will be listed here: right-click a message → Apps → “Add to to-do”, or /todo.',
    }[use]
  }

  // ── Bouton du rôle des sorties, toujours en bas du salon des annonces ──
  // Discord n'épingle rien en bas : après chaque nouveau message du salon
  // (notes de version publiées comprises), le bouton est reposté puis
  // l'ancien supprimé — 8 s plus tard, pour qu'une rafale de messages ne le
  // fasse reposter qu'une fois. Le message actuel est retenu dans les
  // réglages (releasePingMsg), y compris d'un redémarrage à l'autre.
  const RELEASE_PING_TEXT = '🔔 Want a ping when a new version of TwitchUnblock is out? Tap the button (tap it again to stop).'
  let releasePingTimer = null
  const isReleasePing = (m) => m.author?.id === st.me
    && (m.components || []).some((r) => (r.components || []).some((c) => c.custom_id === 'rp:toggle'))

  function noteAnnouncement(m) {
    if (!st.settings.announcementsRole || isReleasePing(m)) return
    clearTimeout(releasePingTimer)
    releasePingTimer = setTimeout(() => {
      postReleasePing(st.settings.announcements)
        .catch((e) => log.warn(`Discord bridge: release pings button not moved down (${e.message})`))
    }, 8000)
  }

  /** Le bouton posté en bas de `channel`, puis l'ancien supprimé (jamais un
   *  moment sans bouton). */
  async function postReleasePing(channel) {
    if (!channel) return
    const old = st.settings.releasePingMsg
    const m = await rest('POST', `/channels/${channel}/messages`, {
      content: RELEASE_PING_TEXT, allowed_mentions: { parse: [] },
      components: [row(button('🔔 Release pings', 'rp:toggle', 1))],
    })
    if (old?.id && old.id !== m?.id) {
      await rest('DELETE', `/channels/${old.channel || channel}/messages/${old.id}`).catch(() => {})
    } else if (!old?.id && m?.id) {
      // Boutons postés avant qu'il soit retenu : retirés des derniers messages.
      const recent = await rest('GET', `/channels/${channel}/messages?limit=50`).catch(() => null)
      for (const r of recent || []) {
        if (r.id !== m.id && isReleasePing(r)) await rest('DELETE', `/channels/${channel}/messages/${r.id}`).catch(() => {})
      }
    }
    if (!m?.id) return
    const settings = { ...st.settings, releasePingMsg: { channel, id: m.id } }
    await kvSet('settings', settings)
    st.settings = settings
  }

  /** Pourquoi `role` ne peut pas servir de rôle des sorties, que n'importe
   *  quel membre se donne lui-même ; null s'il convient. Un rôle géré (bot,
   *  Boost…), avec des permissions, ou qui ouvre un salon (droits accordés
   *  au rôle dans les permissions d'un salon) en faisait cadeau à tout le
   *  monde. `known` : le rôle décrit par l'interaction (/setup), sinon relu. */
  async function releaseRoleProblem(guild, role, known = null) {
    if (role === guild) return '@everyone can’t be used.'
    const info = known || (await rest('GET', `/guilds/${guild}/roles`).catch(() => null))?.find?.((r) => r.id === role)
    if (!info) return 'I can’t read this role.'
    if (info.managed) return `<@&${role}> is managed by an integration (bot, Boost…).`
    if (BigInt(info.permissions || 0) !== 0n) return `<@&${role}> has permissions — use a role without any, only for pings.`
    const channels = await rest('GET', `/guilds/${guild}/channels`).catch(() => null)
    if (!Array.isArray(channels)) return 'I can’t read the channels to check this role.'
    const opens = channels.find((c) => (c.permission_overwrites || []).some((o) => o.id === role && BigInt(o.allow || 0) !== 0n))
    return opens ? `<@&${role}> is given access in <#${opens.id}> — use a role only for pings.` : null
  }

  /** /release-pings et le bouton du salon des sorties : le rôle mentionné à
   *  chaque sortie, pris ou rendu. Revérifié avant d'être donné : ses droits
   *  ont pu changer depuis /setup. */
  async function toggleReleaseRole(i, user) {
    const role = st.settings.announcementsRole
    if (!role || !st.guild) return 'Release pings aren’t set up yet.'
    const has = (i.member?.roles || []).includes(role)
    if (!has) {
      const problem = await releaseRoleProblem(st.guild, role)
      if (problem) {
        log.warn(`Discord bridge: release role not given — ${problem}`)
        return '❌ Release pings are unavailable for now (the role isn’t safe to hand out) — please tell the developer.'
      }
    }
    try {
      await rest(has ? 'DELETE' : 'PUT', `/guilds/${st.guild}/members/${user.id}/roles/${role}`)
    } catch (e) {
      log.warn(`Discord bridge: release role not changed (${e.message})`)
      return `❌ I couldn’t change your roles (${e.message}). The bot needs “Manage Roles”, and its role must be above <@&${role}>.`
    }
    return has ? '🔕 You won’t be pinged for new versions anymore.' : '🔔 You’ll be pinged when a new version is out.'
  }

  /** « Add to to-do » (menu d'un message) et /todo : une carte dans le salon
   *  des choses à faire, avec un bouton Done. Le message d'origine reçoit 📝 :
   *  la personne voit que son idée est notée. */
  async function addTodo(i, user) {
    const channel = st.settings.todo
    if (!channel) return 'Pick the to-do channel first: run /setup there with “To-do list”.'
    const by = `Added by ${user.global_name || user.username}`
    let embed
    if (i.data?.type === 3) {
      const m = i.data?.resolved?.messages?.[i.data?.target_id]
      if (!m) return '❌ Message not found.'
      const author = m.author || {}
      const link = `https://discord.com/channels/${i.guild_id}/${m.channel_id}/${m.id}`
      const text = String(m.content || '').trim() || String(m.embeds?.[0]?.description || '').trim()
      const files = (m.attachments || []).length
      embed = {
        title: 'Suggestion',
        description: `${(text || '(no text)').slice(0, 3500)}

[Original message](${link})`
          + (files ? ` · 📎 ${files} attachment${files > 1 ? 's' : ''}` : ''),
        color: 0x9146ff,
        author: {
          name: String(author.global_name || author.username || 'Unknown').slice(0, 100),
          ...(author.id && author.avatar ? { icon_url: `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=64` } : {}),
        },
        footer: { text: by },
        timestamp: m.timestamp || new Date().toISOString(),
      }
      react(m.channel_id, m.id, '📝')
    } else {
      const text = String(opt(i, 'text') || '').trim()
      if (!text) return 'Nothing to add.'
      embed = { title: 'To-do', description: text.slice(0, 3500), color: 0x9146ff, footer: { text: by }, timestamp: new Date().toISOString() }
    }
    await rest('POST', `/channels/${channel}/messages`, {
      embeds: [embed], components: [row(button('Done', 'todo:done', 3))], allowed_mentions: { parse: [] },
    })
    return `📝 Added to <#${channel}>.`
  }

  /** Carte du salon à faire, rebâtie (Done : ✅ et vert ; Reopen : comme avant). */
  function todoCard(embed, done) {
    const title = String(embed?.title || 'To-do').replace(/^✅ /, '')
    return {
      title: done ? `✅ ${title}` : title,
      description: embed?.description || '',
      color: done ? 0x2ecc71 : 0x9146ff,
      ...(embed?.author?.name ? { author: { name: embed.author.name, ...(embed.author.icon_url ? { icon_url: embed.author.icon_url } : {}) } } : {}),
      ...(embed?.footer?.text ? { footer: { text: embed.footer.text } } : {}),
      ...(embed?.timestamp ? { timestamp: embed.timestamp } : {}),
    }
  }

  const publishing = new Set()   // brouillons de notes en cours de publication
  async function onComponent(i, user) {
    const [kind, a, b] = String(i.data?.custom_id || '').split(':')
    // Boutons d'un message privé : « Reply » (texte seul) et « Send
    // screenshots » (captures, texte facultatif).
    if (kind === 'ur') {
      return respond(i, 9, {
        custom_id: `ureply:${a}`,
        title: 'Reply to the developer',
        components: [row(textInput('text', 'Your message', 2, { min: 1, max: 2000 }))],
      })
    }
    if (kind === 'us') {
      return respond(i, 9, {
        custom_id: `ushots:${a}`,
        title: 'Send screenshots to the developer',
        components: [
          labelled('Screenshots', fileUpload('pics'), `${PHOTO_TYPES} — up to ${MAX_PHOTOS}`),
          labelled('Message (optional)', { type: 4, custom_id: 'text', style: 2, required: false, max_length: 2000 }),
        ],
      })
    }
    if (kind === 'rp') return deferred(i, () => toggleReleaseRole(i, user))
    if (!isAdmin(user.id)) return adminOnly(i)
    const thread = i.channel_id
    switch (kind) {
      case 'todo': {
        const done = a === 'done'
        return respond(i, 7, {
          embeds: [todoCard(i.message?.embeds?.[0], done)],
          components: [row(done ? button('Reopen', 'todo:open') : button('Done', 'todo:done', 3))],
        })
      }
      case 'qr': {
        const q = QUICK[Number(a)]
        if (!q) return
        await respond(i, 6)
        try {
          const prev = (await stateOf(thread))?.status
          const r = await call({ action: 'reply', thread, message: q.text, ...(q.status ? { status: q.status } : {}), by: byOf(user) })
          remember(thread, r)
          await editOriginal(i, { content: `${i.message?.content || ''}\n✅ Sent: “${q.label}”`.slice(0, 1900), components: i.message?.components })
          await afterTeamUpdate(thread, r, prev)
        } catch (e) {
          await say(thread, `❌ Reply not sent: ${e.message}`)
        }
        return
      }
      case 'fx': {
        await respond(i, 6)
        try {
          await call({ action: 'fix', thread, platform: a, by: byOf(user) })
          const where = { ios: 'the app', web: 'the website', both: 'the app and the website', tvos: 'the Apple TV app', android: 'the Android app' }[a]
          await editOriginal(i, { content: where ? `✅ I’ll tell the user when the fix is live in ${where}.` : 'OK, I won’t tell the user.', components: [] })
        } catch (e) {
          await editOriginal(i, { content: `❌ ${e.message}`, components: [] })
        }
        return
      }
      case 'del': {
        if (a !== 'yes') return respond(i, 7, { content: 'Cancelled.', components: [] })
        await respond(i, 6)
        try {
          await call({ action: 'delete', thread, by: byOf(user) })
        } catch (e) {
          await editOriginal(i, { content: `❌ ${e.message}`, components: [] })
          return
        }
        forget(thread)
        await editOriginal(i, { content: 'Deleted.', components: [] })
        try {
          await rest('DELETE', `/channels/${thread}`)
        } catch (e) {
          await rest('PATCH', `/channels/${thread}`, { archived: true, locked: true }).catch(() => {})
          await editOriginal(i, { content: `Report deleted, but this post couldn’t be (${e.message}): it’s closed instead — delete it by hand.`, components: [] })
        }
        return
      }
      case 'rel': {
        const head = String(i.message?.content || '').split('\n')[0]
        if (a === 'del') {
          await kvSet(`draft_${b}`, null, 60).catch(() => {})
          call({ action: 'audit', what: 'release.discard', detail: b, by: byOf(user) }).catch(() => {})
          return respond(i, 7, { content: `${head}\n🗑️ Discarded.`, components: [] })
        }
        const channel = st.settings.announcements
        if (!channel) return respond(i, 4, { flags: 64, content: 'Pick the announcements channel first: run /setup there with “Release announcements”.' })
        if (publishing.has(b)) return respond(i, 4, { flags: 64, content: 'Already being published.' })
        publishing.add(b)
        await respond(i, 6)
        try {
          const draft = await kvGet(`draft_${b}`).catch(() => null)
          if (!draft?.text) return editOriginal(i, { content: `${head}\n❌ This draft expired.`, components: [] })
          const role = st.settings.announcementsRole
          await sendChunks(channel, (role ? `<@&${role}> ` : '') + draft.text,
            { allowed_mentions: role ? { parse: [], roles: [role] } : { parse: [] } })
          await kvSet(`draft_${b}`, null, 60).catch(() => {})
          call({ action: 'audit', what: 'release.publish', detail: b, by: byOf(user) }).catch(() => {})
          await editOriginal(i, { content: `${head}\n✅ Published in <#${channel}>.`, components: [] })
        } catch (e) {
          await editOriginal(i, { content: `${head}\n❌ Not published: ${e.message}`, components: i.message?.components })
        } finally {
          publishing.delete(b)
        }
        return
      }
      case 'fg': return forgetConfirm(i, user, a, b)
    }
  }

  async function onModal(i, user) {
    const [kind, a] = String(i.data?.custom_id || '').split(':')
    if (kind === 'report') {
      return deferred(i, async () => {
        const what = a === 'idea' ? 'idea' : 'report'
        // Capture de l'option de la commande : téléchargée maintenant (son
        // lien expire), rangée par le Worker avec le retour.
        const photos = await photosOf(takeShot(user), { reduce: true })
        const r = await call({
          action: 'create', kind: a === 'idea' ? 'idea' : 'bug',
          message: field(i, 'text'), where: field(i, 'where'), photos: photos.ok,
          user: { id: user.id, name: user.global_name || user.username },
        })
        const dm = await sendDm(user.id, `👋 Thanks for your ${what}! It was sent to the developer — their replies will arrive here, and you can answer with the buttons (text or screenshots).`, r.key)
          .then(() => true, () => false)
        return `Thanks! Your ${what} was sent to the developer.` + (dm
          ? ' Replies will come in a direct message.'
          : ' I couldn’t send you a direct message: allow DMs from this server’s members (Privacy settings) to get the replies.')
          + skippedNote(photos.skipped) + unsavedNote(photos.ok.length, r)
      })
    }
    if (kind === 'ureply') {
      return deferred(i, async () => {
        await call({ action: 'userReply', key: a, du: user.id, message: field(i, 'text') })
        return 'Sent! The developer will see it.'
      })
    }
    if (kind === 'ushots') {
      return deferred(i, async () => {
        const text = field(i, 'text')
        const photos = await photosOf(uploads(i, 'pics'), { reduce: true })
        if (!text && !photos.ok.length) {
          return photos.skipped ? `❌ Nothing sent: the file was too big, or not a ${PHOTO_TYPES} image.` : '❌ Attach a screenshot (or use “Reply” to write a message).'
        }
        const r = await call({ action: 'userReply', key: a, du: user.id, message: text, photos: photos.ok })
        return 'Sent! The developer will see it.' + skippedNote(photos.skipped) + unsavedNote(photos.ok.length, r)
      })
    }
    if (kind === 'announce') {
      if (!isAdmin(user.id)) return adminOnly(i)
      return deferred(i, async () => {
        const r = await call({
          action: 'announce', title: field(i, 'title'), message: field(i, 'message'),
          link: field(i, 'link'), hours: Number(field(i, 'hours')) || 24, by: byOf(user),
        })
        return `Announcement live in the app and on the website until <t:${Math.floor(r.announcement.until / 1000)}:f>.`
      })
    }
    if (kind === 'poll') {
      if (!isAdmin(user.id)) return adminOnly(i)
      return deferred(i, async () => {
        const r = await call({
          action: 'poll', question: field(i, 'question'), options: field(i, 'options'),
          multi: /^(y|yes|o|oui|1|true)$/i.test(String(field(i, 'multi') || '').trim()),
          hours: Number(field(i, 'hours')) || 24, by: byOf(user),
        })
        return `Poll live in the app and on the website until <t:${Math.floor(r.poll.until / 1000)}:f>: “${r.poll.question}” (${r.poll.options.length} choices${r.poll.multi ? ', several per person' : ', one per person'}). Its results will be posted in the alerts channel when it ends, or with /poll-end.`
      })
    }
  }

  /** Résultats d'un sondage fini, une fois : dans le salon d'alertes, avec
   *  « Publish » vers le salon des annonces, comme les notes de version. Un
   *  à la fois : /poll-end et le passage des 10 min, au même moment, les
   *  postaient deux fois. `poll_done` : les derniers sondages postés (le
   *  dernier seul, avant ; une lecture ratée abandonne, sans doublon). */
  function postPollResults(poll, results) {
    return serial('poll-results', () => postPollResultsOnce(poll, results))
  }
  async function postPollResultsOnce(poll, results) {
    if (!poll) return
    const done = await kvGet('poll_done')
    const ids = Array.isArray(done) ? done : done ? [done] : []
    if (ids.includes(poll.id)) return
    await kvSet('poll_done', [...ids, poll.id].slice(-20), 30 * 86400)
    const voters = results?.voters || 0
    const lines = poll.options.map((o, n) => {
      const c = results?.counts?.[n] || 0
      return `- ${o} — **${voters ? Math.round((c / voters) * 100) : 0}%** (${c})`
    })
    const text = `📊 **Poll results — ${poll.question}**\n${lines.join('\n')}\n\n${voters} ${voters === 1 ? 'voter' : 'voters'}${poll.multi ? ' · several choices per person' : ''}`
    if (!st.settings.alerts) { log.log(`Discord bridge: poll ${poll.id} ended (no /setup alerts channel for its results)`); return }
    const id = `poll-${poll.id}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50)
    await kvSet(`draft_${id}`, { text }, 30 * 86400)
    await sendChunks(st.settings.alerts, text)
    const where = st.settings.announcements ? `<#${st.settings.announcements}>` : 'the announcements channel (pick it with /setup)'
    await say(st.settings.alerts, `📝 **Poll results draft**\n“Publish” posts the text above in ${where}.`, {
      components: [row(button('Publish', `rel:pub:${id}`, 3), button('Discard', `rel:del:${id}`, 4))],
    })
  }

  /** Sondage arrivé au bout de sa durée : ses résultats (toutes les 10 min).
   *  D'abord ceux du précédent, fini puis remplacé avant ce passage
   *  (`previous`, Worker à jour) : un sondage lancé moins de 10 min après la
   *  fin de l'autre, sans /poll-end, les faisait perdre. */
  async function checkPoll() {
    const r = await call({ action: 'poll-state' })
    if (r?.previous?.poll) await postPollResults(r.previous.poll, r.previous.results)
    if (r?.poll?.ended) await postPollResults(r.poll, r.results)
  }

  // ── Surveillance ────────────────────────────────────────────────────────
  async function alert(text) {
    if (st.settings.alerts) await sendChunks(st.settings.alerts, text).catch((e) => log.warn(`Discord bridge: alert not posted (${e.message})`))
    else log.warn(`Discord bridge alert (no /setup alerts channel): ${text}`)
  }

  /** Workers (principal et secours), ntfy, webhook : prévenu à la panne,
   *  puis au retour. */
  async function watchHealth() {
    // État gardé en mémoire : relu dans le Worker lui-même, il revenait vide
    // pendant sa panne — l'alerte repartait toutes les 5 min, et le retour
    // n'était jamais annoncé. La copie du Worker ne sert qu'après un redémarrage.
    if (!st.alerts) st.alerts = (await kvGet('alerts').catch(() => null)) || null
    const prev = st.alerts || {}
    const next = { ...prev }
    // La racine répond sans base de données (un Worker de secours n'en a
    // pas : /api/push/key y vaut 503) et passe en 429 au quota du jour.
    const probe = async (base) => {
      try {
        const r = await fetch(`${base}/`, { signal: AbortSignal.timeout(15_000) })
        return r.ok ? null : `HTTP ${r.status}${r.status === 429 ? ' — daily request quota reached?' : ''}`
      } catch {
        return 'unreachable'
      }
    }
    const checks = [['w:main', 'Main Worker', worker], ...fallbacks.map((f, n) => [`w:fb${n}`, 'Fallback Worker', f])]
    for (const [id, name, base] of checks) {
      const problem = await probe(base)
      if (problem && !prev[id]) { await alert(`⚠️ **${name} failing**: ${problem}\n<${base}>`); next[id] = Date.now() }
      if (!problem && prev[id]) { await alert(`✅ **${name} is back** after ${Math.max(1, Math.round((Date.now() - prev[id]) / 60000))} min.`); next[id] = 0 }
    }
    const h = await call({ action: 'health' }).catch(() => null)
    if (h) {
      const until = h.ntfy?.until || 0
      if (until && !prev.ntfy) {
        await alert(`⚠️ **ntfy notifications paused** until <t:${Math.floor(until / 1000)}:t> (${h.ntfy.code === 42908 ? 'daily quota reached' : `429${h.ntfy.code ? `, code ${h.ntfy.code}` : ''}`}).`)
        next.ntfy = until
      }
      if (!until && prev.ntfy) { await alert('✅ **ntfy notifications are going out again.**'); next.ntfy = 0 }
      const hook = h.webhook
      if (hook && hook.ok === false && !['missing'].includes(hook.detail) && hook.at && hook.at !== prev.hookAt) {
        await alert(`⚠️ **Discord webhook delivery failed**: HTTP ${hook.status || '—'}${hook.detail ? ` — ${hook.detail}` : ''}`)
        next.hookAt = hook.at
      }
    }
    st.alerts = next
    if (JSON.stringify(next) !== JSON.stringify(prev)) await kvSet('alerts', next).catch(() => {})
  }

  /** CI de l'app et du site : un échec, une alerte (une seule fois). Mémoire
   *  illisible (Worker injoignable) : passage abandonné — prise pour un
   *  premier passage, elle refaisait l'alerte des échecs déjà signalés. */
  async function watchActions() {
    const stored = await kvGet('runs')
    const seen = stored || { since: Date.now() - 15 * 60_000, ids: [] }
    let changed = false
    for (const [name, repo] of [['iOS app', repos.ios], ['Website', repos.web]]) {
      const data = await gh(`/repos/${repo}/actions/runs?per_page=15&status=completed`)
      for (const run of data?.workflow_runs || []) {
        if (run.conclusion !== 'failure' || seen.ids.includes(run.id) || Date.parse(run.updated_at) < seen.since) continue
        await alert(`❌ **${name} — “${run.name}” failed** on \`${run.head_branch}\` (\`${String(run.head_sha).slice(0, 7)}\`)\n<${run.html_url}>`)
        seen.ids.push(run.id)
        changed = true
      }
    }
    if (changed) { seen.ids = seen.ids.slice(-100); await kvSet('runs', seen) }
    else if (!stored) await kvSet('runs', seen)
  }

  async function siteVersion() {
    const src = await fetchText(`${site}/assets/js/usage.js?ts=${Date.now()}`)
    return src?.match(/SITE_VERSION = '([^']+)'/)?.[1] || null
  }

  /** Brouillon des notes de version dans le salon privé ; « Publish » le
   *  poste dans le salon des annonces. */
  async function draftRelease(kind, v, rel) {
    let text
    if (kind === 'ios') {
      const items = bullets(rel?.body)
      text = `**TwitchUnblock ${v} — iOS app**\n${items.join('\n') || '- Improvements and fixes'}\n\nUpdate from your source (Feather, SideStore, AltStore…) or download the IPA: <${rel.html_url}>`
    } else {
      const src = await fetchText(`${site}/assets/js/changelog.js?ts=${Date.now()}`)
      const items = src ? changelogItems(src, v) : []
      text = `**TwitchUnblock website — ${v}**\n${items.map((x) => `- ${x}`).join('\n') || '- Improvements and fixes'}\n\n<${site}>`
    }
    if (!st.settings.alerts) { log.log(`Discord bridge: new ${kind} version ${v} (no /setup alerts channel for its draft)`); return }
    const id = `${kind}-${v}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50)
    await kvSet(`draft_${id}`, { text }, 30 * 86400)
    await sendChunks(st.settings.alerts, text)
    const where = st.settings.announcements ? `<#${st.settings.announcements}>` : 'the announcements channel (pick it with /setup)'
    await say(st.settings.alerts, `📝 **Release notes draft — ${kind === 'ios' ? 'iOS app' : 'website'} ${v}**\n“Publish” posts the text above in ${where}.`, {
      components: [row(button('Publish', `rel:pub:${id}`, 3), button('Discard', `rel:del:${id}`, 4))],
    })
  }

  async function postTestBuild(rel) {
    const channel = st.settings.testers
    if (!channel) return
    const role = st.settings.testersRole
    const tv = /^tv-test-/.test(rel.tag_name || '')
    const items = bullets(rel.body).slice(0, 12)
    // Apple TV : sa source (apps-tv.json, à côté de celle de test) pour
    // ATVLoadly, qui se met alors à jour seul.
    const how = tv
      ? `Apple TV build: add the source <${testSource.replace(/apps-test\.json$/, 'apps-tv.json')}> in ATVLoadly for automatic updates, or install it with Xcode (see the README): <${rel.html_url}>`
      : `Install it from the test source <${testSource}>, or download the IPA: <${rel.html_url}>`
    await sendChunks(channel, `${role ? `<@&${role}> ` : ''}🧪 **New test build: ${rel.name}**\n${items.join('\n')}\n\n${how}`,
      { allowed_mentions: role ? { parse: [], roles: [role] } : { parse: [] } })
  }

  /** Sorties : app (GitHub, versions stables et de test) et site (version
   *  en ligne). Nouvelle version stable : brouillon des notes, et le Worker
   *  prévient les retours qui l'attendaient. La première fois, on retient.
   *  Mémoire illisible (Worker injoignable) : passage abandonné — prise
   *  pour un premier passage, les sorties parues entre-temps étaient notées
   *  sans brouillon ni annonce aux testeurs. */
  async function watchReleases() {
    const seen = (await kvGet('seen')) || {}
    const next = { ...seen }
    const rels = await gh(`/repos/${repos.ios}/releases?per_page=50`)
    if (Array.isArray(rels)) {
      // La plus récemment publiée de chaque sorte : l'API ne les trie pas par
      // date (tv-test-10 arrivait après tv-test-6, et n'était jamais annoncée).
      const latest = (keep) => rels.filter(keep)
        .sort((a, b) => Date.parse(b.published_at || b.created_at || 0) - Date.parse(a.published_at || a.created_at || 0))[0]
      const stable = latest((r) => !r.prerelease && !r.draft && /^TwitchUnblock \d/.test(r.name || ''))
      const test = latest((r) => r.prerelease && /^test-/.test(r.tag_name || ''))
      const tv = latest((r) => r.prerelease && /^tv-test-/.test(r.tag_name || ''))
      if (stable) {
        const v = stable.name.replace(/^TwitchUnblock\s+/, '').trim()
        if (!seen.ios || compareVersions(v, seen.ios) > 0) {
          if (seen.ios) await draftRelease('ios', v, stable)
          next.ios = v
        }
      }
      const num = (tag) => Number(String(tag || '').match(/(\d+)$/)?.[1]) || 0
      if (test && num(test.tag_name) > num(seen.iosTest)) { if (seen.iosTest) await postTestBuild(test); next.iosTest = test.tag_name }
      if (tv && num(tv.tag_name) > num(seen.tvTest)) { if (seen.tvTest) await postTestBuild(tv); next.tvTest = tv.tag_name }
      // App Apple TV stable (« TwitchUnblock TV 0.1.N ») : retenue pour
      // prévenir les retours qui attendaient son correctif, sans brouillon.
      const tvStable = latest((r) => !r.prerelease && !r.draft && /^TwitchUnblock TV \d/.test(r.name || ''))
      const tvos = tvStable?.name.replace(/^TwitchUnblock TV\s+/, '').trim()
      if (tvos && (!seen.tvos || compareVersions(tvos, seen.tvos) > 0)) next.tvos = tvos
    }
    // App Android (son dépôt), version stable « TwitchUnblock X.Y.N » : pareil.
    const apks = repos.android ? await gh(`/repos/${repos.android}/releases?per_page=20`) : null
    if (Array.isArray(apks)) {
      const stable = apks.filter((r) => !r.prerelease && !r.draft && /^TwitchUnblock \d/.test(r.name || ''))
        .sort((a, b) => Date.parse(b.published_at || b.created_at || 0) - Date.parse(a.published_at || a.created_at || 0))[0]
      const android = stable?.name.replace(/^TwitchUnblock\s+/, '').trim()
      if (android && (!seen.android || compareVersions(android, seen.android) > 0)) next.android = android
    }
    const web = await siteVersion()
    if (web && (!seen.web || compareVersions(web, seen.web) > 0)) {
      if (seen.web) await draftRelease('web', web)
      next.web = web
    }
    if (JSON.stringify(next) !== JSON.stringify(seen)) await kvSet('seen', next)
    if (next.ios || next.web || next.tvos || next.android) {
      const r = await call({ action: 'released', ios: next.ios, web: next.web, tvos: next.tvos, android: next.android }).catch(() => null)
      if (r?.notified) log.log(`Discord bridge: ${r.notified} user(s) told their fix is live`)
    }
  }

  /** Posts « Done » ou « Declined » sans activité depuis un jour :
   *  archivés (une réponse de la personne les rouvre). */
  async function tidy() {
    if (!st.guild || !st.forum) return
    const data = await rest('GET', `/guilds/${st.guild}/threads/active`).catch(() => null)
    const now = Date.now()
    for (const th of data?.threads || []) {
      if (th.parent_id !== st.forum) continue
      const status = (th.applied_tags || []).map((t) => st.stateOf.get(t)).find(Boolean)
      if (status !== 'done' && status !== 'refused') continue
      if (now - snowflakeTime(th.last_message_id || th.id) < 24 * 3600_000) continue
      await rest('PATCH', `/channels/${th.id}`, { archived: true }).catch((e) => log.warn(`Discord bridge: post ${th.id} not archived (${e.message})`))
    }
  }

  /** Résumé du jour : retours à traiter, fréquentation de la veille,
   *  notifications, versions. */
  async function postSummary(channel) {
    if (!channel) return false
    const [fb, statsText, seen] = await Promise.all([
      call({ action: 'summary' }).catch(() => null),
      fetchText(`${worker}/api/stats`),
      kvGet('seen').catch(() => null),
    ])
    let stats = null
    try { stats = statsText ? JSON.parse(statsText) : null } catch {}
    const lines = [`☀️ **Daily summary** — <t:${Math.floor(Date.now() / 1000)}:D>`]
    if (fb) {
      lines.push(`**Reports**: ${fb.awaitingCount} awaiting your reply · ${fb.new24h} new in 24 h · ${fb.open} open`)
      for (const a of fb.awaiting.slice(0, 8)) {
        lines.push(`• ${a.thread ? `<#${a.thread}>` : `\`${a.key}\``} “${a.excerpt}” — waiting since <t:${Math.floor(a.since / 1000)}:R>`)
      }
    }
    if (stats) {
      const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
      const act = stats.activeDaily?.find((d) => d.date === y)
      const nw = stats.daily?.find((d) => d.date === y)
      const pu = stats.push?.daily?.find((d) => d.date === y)
      const fresh = nw ? (nw.newIos || 0) + (nw.newWeb || 0) + (nw.newTv || 0) + (nw.newAndroid || 0) : 0
      if (act) lines.push(`**Users yesterday**: ${act.total} active (iOS ${act.ios} · web ${act.web} · Apple TV ${act.tvos || 0} · Android ${act.android || 0})${nw ? ` · ${fresh} new` : ''}`)
      if (pu) lines.push(`**Live notifications sent yesterday**: ${(pu.ok_web || 0) + (pu.ok_ntfy || 0)} (web ${pu.ok_web || 0} · ntfy ${pu.ok_ntfy || 0})`)
    }
    if (seen) {
      lines.push(`**Versions**: app ${seen.ios || '?'} · website ${seen.web || '?'}${seen.tvos ? ` · Apple TV ${seen.tvos}` : ''}`
        + `${seen.android ? ` · Android ${seen.android}` : ''}${seen.iosTest ? ` · latest test build ${seen.iosTest}` : ''}`)
    }
    if (lines.length === 1) return false
    await sendChunks(channel, lines.join('\n'))
    return true
  }

  function localTime(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: summaryTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d)
    const get = (t) => parts.find((p) => p.type === t)?.value
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
  }

  async function summaryClock() {
    const now = localTime()
    if (now.hour !== summaryHour || st.summaryDay === now.day || !st.settings.alerts) return
    st.summaryDay = now.day
    if ((await kvGet('summary_day').catch(() => null)) === now.day) return
    await kvSet('summary_day', now.day)
    await postSummary(st.settings.alerts)
  }

  /** Posts des retours supprimés dans /stats (liste `trash` écrite par le
   *  Worker, qui ne peut pas les supprimer lui-même) : supprimés ici, au mot
   *  du Worker et toutes les 10 min. Rend ceux qui sont partis. */
  async function emptyTrash() {
    if (!st.forum) return []
    const list = await kvGet('trash').catch(() => null)
    if (!Array.isArray(list) || !list.length) return []
    const done = []
    for (const t of list.slice(0, 50)) {
      const id = String(t)
      if (!/^\d{5,25}$/.test(id)) { done.push(t); continue }
      try {
        // Seulement un post du forum des retours : tout autre salon ou fil
        // que le bot peut gérer, mis dans la liste, était supprimé.
        const parent = st.threads.has(id) ? st.forum : (await rest('GET', `/channels/${id}`))?.parent_id || null
        if (parent !== st.forum) {
          log.warn(`Discord bridge: ${id} isn’t a post of the reports forum — not deleted`)
          done.push(t)
          continue
        }
        await rest('DELETE', `/channels/${id}`)
      } catch (e) {
        // Déjà supprimé (10003) : rien à faire ; autre refus : retenté plus tard.
        if (e.code !== 10003) { log.warn(`Discord bridge: post ${id} not deleted (${e.message})`); continue }
      }
      forget(id)
      done.push(t)
    }
    if (done.length) {
      // Retirés sur place par le Worker : relue puis réécrite ici, la liste
      // perdait un post qu'il y ajoutait entre les deux. Worker d'avant
      // (action inconnue : 400), comme avant. Pas mise à jour : ces posts,
      // déjà partis (10003), en sortiront au passage suivant.
      await call({ action: 'trash-done', ids: done.map(String) }).catch(async (e) => {
        if (e.status !== 400) throw e
        const now = (await kvGet('trash').catch(() => null)) || []
        await kvSet('trash', now.filter((t) => !done.includes(t)), 7 * 86400)
      }).catch((e) => log.warn(`Discord bridge: trash list not updated (${e.message})`))
      log.log(`Discord bridge: ${done.length} post(s) of reports deleted in /stats removed`)
    }
    return done
  }

  async function heartbeat() {
    emptyTrash().catch((e) => log.warn(`Discord bridge: trash — ${e.message}`))
    // Worker plus ancien (sans sondages ni modèles) : refus attendu, rien à signaler.
    checkPoll().catch(() => {})
    refreshTemplates().catch(() => {})
    const c = await call({ action: 'config' })
    if (c.forum !== st.forum || c.guild !== st.guild) {
      log.log(`Discord bridge: the webhook moved to channel ${c.forum}`)
      const newGuild = c.guild !== st.guild
      Object.assign(st, { forum: c.forum, guild: c.guild, labels: c.labels || st.labels })
      if (newGuild) {
        const g = await rest('GET', `/guilds/${c.guild}`).catch(() => null)
        st.owner = g?.owner_id || null
        await registerCommands()
      }
      st.threads.clear()
      st.parents.clear()
      st.states.clear()
      const forum = await rest('GET', `/channels/${c.forum}`).catch(() => null)
      st.forumType = forum?.type ?? null
      await ensureTags(forum)
    }
    // Retours dont l'envoi a raté (Discord injoignable…) : rattrapés.
    backfill()
  }

  async function registerCommands() {
    if (!st.app || !st.guild) return
    try {
      await rest('PUT', `/applications/${st.app}/guilds/${st.guild}/commands`, COMMANDS)
      log.log(`Discord bridge: ${COMMANDS.length} slash commands ready`)
    } catch (e) {
      log.warn(`Discord bridge: slash commands not registered (${e.message}) — invite the bot again with the applications.commands scope (README)`)
    }
  }

  // ── Exploitation : pics, base, tâche planifiée, quotas, versions ───────
  // Une alerte par mesure et par jour (UTC) au plus : mémoire `ops_alerts`
  // gardée par le Worker (un redémarrage ne les refait pas), avec l'état de
  // la tâche planifiée (muette depuis…).
  const num = (n) => Number(n || 0).toLocaleString('en-US')
  const pct = (n, max) => (max > 0 ? Math.round((Number(n || 0) / max) * 100) : 0)
  const mb = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`
  const ago = (ms) => `<t:${Math.floor(ms / 1000)}:R>`
  function dur(ms) {
    const m = Math.floor(Math.max(0, ms) / 60_000)
    if (m < 1) return `${Math.round(Math.max(0, ms) / 1000)} s`
    if (m < 60) return `${m} min`
    const h = Math.floor(m / 60)
    return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`
  }
  let opsMemo = null
  let opsLoad = null   // lecture de la mémoire, une seule, attendue par tous
  async function opsAlerts() {
    const day = new Date().toISOString().slice(0, 10)
    // watchOps et watchQuotas partent ensemble au démarrage : chacun lisait
    // la mémoire et posait sa propre copie, l'alerte notée par l'un était
    // perdue, et refaite au passage suivant.
    opsLoad ??= kvGet('ops_alerts').catch(() => null)
    const stored = await opsLoad
    opsMemo ??= stored || {}
    if (opsMemo.day !== day) opsMemo = { ...opsMemo, day, sent: [] }
    return opsMemo
  }
  const saveOpsAlerts = () => kvSet('ops_alerts', opsMemo, 3 * 86400)
    .catch((e) => log.warn(`Discord bridge: alerts memory not saved (${e.message})`))
  /** Alerte `id` une fois par jour (UTC) au plus. */
  async function alertOncePerDay(id, text) {
    const memo = await opsAlerts()
    if (memo.sent.includes(id)) return
    memo.sent = [...memo.sent, id].slice(-100)
    await alert(text)
    await saveOpsAlerts()
  }

  /** État du Worker, toutes les 5 min : plafonds du jour à 80 %, base à 70 %
   *  de sa taille maximale, tâche planifiée muette depuis 5 min (puis
   *  revenue). Worker d'avant (action inconnue : 400) : rien. */
  async function watchOps() {
    const o = await call({ action: 'ops' }).catch((e) => { if (e.status === 400) return null; throw e })
    if (!Array.isArray(o?.caps)) return
    for (const c of o.caps) {
      if (!(c.max > 0) || c.n < 0.8 * c.max) continue
      await alertOncePerDay(`cap:${c.id}`, `📈 **${c.label}: ${pct(c.n, c.max)}% of today’s cap** (${num(c.n)} / ${num(c.max)}, UTC day). Past it, more are refused until midnight UTC.`)
    }
    if (o.db?.max > 0 && o.db.bytes >= 0.7 * o.db.max) {
      await alertOncePerDay('db', `🗄️ **Database at ${pct(o.db.bytes, o.db.max)}%** of D1’s ${mb(o.db.max)} (free plan): ${mb(o.db.bytes)}. New reports stop at ${mb(o.db.pauseAt)}; once full, nothing can be written any more (backups, counts, notifications).`)
    }
    // Tâche planifiée : muette depuis 5 min, puis revenue (une alerte chacune).
    const last = Number(o.cron?.at) || 0
    if (!last) return   // jamais notée (Worker tout juste à jour)
    const memo = await opsAlerts()
    const silent = Date.now() - last > 5 * 60_000
    if (silent && !memo.cron) {
      memo.cron = last
      await alert(`⏱️ **Scheduled task silent**: no run since ${ago(last)} — live notifications and the relay watch are stopped. Check the Worker’s Cron Trigger (Cloudflare → Workers & Pages → the Worker → Settings → Triggers).`)
      await saveOpsAlerts()
    } else if (!silent && memo.cron) {
      const gap = Date.now() - memo.cron
      memo.cron = 0
      await alert(`✅ **Scheduled task running again** (silent for about ${dur(gap)}).`)
      await saveOpsAlerts()
    }
  }

  // Quotas gratuits de Cloudflare, par jour UTC, pour tout le compte du Worker
  // principal (le secours est sur un autre compte). Sans jeton : coupé.
  const cfOn = /^[0-9a-f]{32}$/i.test(String(cloudflare.account || '')) && Boolean(cloudflare.token)
  const CF_QUOTAS = [
    ['requests', 'Worker requests', 100_000, 'past it, the main Worker answers 1027 until midnight UTC and the apps switch to the fallback'],
    ['rowsRead', 'D1 rows read', 5_000_000, 'past it, D1 refuses reads until midnight UTC'],
    ['rowsWritten', 'D1 rows written', 100_000, 'past it, D1 refuses writes until midnight UTC (backups, reports, counts, notifications)'],
  ]
  /** Requêtes des Workers et lignes D1 lues et écrites du jour, par l'API
   *  GraphQL Analytics (jeton en lecture seule). Valeurs écrites dans la
   *  requête : dates calculées ici, compte vérifié (32 caractères hexa). */
  async function cfQuotas() {
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const until = now.toISOString().replace(/\.\d+Z$/, 'Z')
    const query = `{ viewer { accounts(filter: { accountTag: "${cloudflare.account}" }) {
      workers: workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: "${day}T00:00:00Z", datetime_leq: "${until}" }) { sum { requests } }
      d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: "${day}", date_leq: "${day}" }) { sum { rowsRead rowsWritten } }
    } } }`
    const r = await fetch(cloudflareApi, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudflare.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20_000),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok || j?.errors?.length) throw new Error(String(j?.errors?.[0]?.message || `HTTP ${r.status}`).slice(0, 200))
    const acc = j?.data?.viewer?.accounts?.[0]
    if (!acc) throw new Error('account not found (CLOUDFLARE_ACCOUNT_ID, or the token’s account)')
    const sum = (list, k) => (Array.isArray(list) ? list : []).reduce((n, g) => n + (Number(g?.sum?.[k]) || 0), 0)
    return { at: Date.now(), day, requests: sum(acc.workers, 'requests'), rowsRead: sum(acc.d1, 'rowsRead'), rowsWritten: sum(acc.d1, 'rowsWritten') }
  }
  /** Toutes les 15 min : une alerte par quota et par jour, passé 70 %. */
  async function watchQuotas() {
    if (!cfOn) return
    let q
    try {
      q = await cfQuotas()
    } catch (e) {
      log.warn(`Discord bridge: Cloudflare quotas unreadable (${e.message})`)
      return
    }
    for (const [id, label, max, note] of CF_QUOTAS) {
      const n = q[id]
      if (n >= 0.7 * max) await alertOncePerDay(`cf:${id}`, `☁️ **Cloudflare quota at ${pct(n, max)}%**: ${label} — ${num(n)} of ${num(max)} today (UTC, free plan); ${note}.`)
    }
  }

  // Versions : l'image du relais (GIT_SHA) et le Worker (version_metadata)
  // face aux derniers commits de GitHub (API publique, sans jeton), toutes
  // les 30 min. Une alerte par version manquée, quand le retard dure encore
  // 30 min après avoir été vu (le temps d'une construction, d'un déploiement).
  // Pour le relais, seuls comptent ses fichiers : un changement du site seul
  // (public/) ne le concerne pas.
  const RELAY_PATHS = /^(worker\.js|Dockerfile|\.dockerignore|docker\/)/
  const WORKER_PATHS = /^(worker\.js|wrangler\.toml)$/
  const SHA = /^[0-9a-f]{7,40}$/
  let lastVersions = null   // { at, relay, worker } : pour /status
  /** Retard constaté (`target` : le commit attendu) → { target, since, sent } ;
   *  null quand c'est à jour. */
  async function lag(prev, target, text) {
    if (!target) return null
    const p = prev?.target === target ? prev : { target, since: Date.now(), sent: false }
    if (p.sent || Date.now() - p.since < 30 * 60_000) return p
    await alert(text())
    return { ...p, sent: true }
  }
  /** Mémoire illisible (Worker injoignable) : passage abandonné. */
  async function watchVersions() {
    const prev = (await kvGet('version_alerts')) || {}
    const next = { ...prev }
    const out = { at: Date.now(), relay: null, worker: null }
    if (SHA.test(version)) {
      const ref = branch || 'main'
      const cmp = await gh(`/repos/${repos.web}/compare/${version}...${encodeURIComponent(ref)}`)
      if (cmp) {
        const head = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : null
        const stale = Boolean(head) && (cmp.files || []).some((f) => RELAY_PATHS.test(f.filename || ''))
        out.relay = { sha: version, branch: ref, head, ahead: Number(cmp.ahead_by) || 0, stale }
        next.relay = await lag(prev.relay, stale ? head : null, () => `⬆️ **VPS not up to date**: the relay runs \`${version.slice(0, 7)}\`, \`${ref}\` is at \`${head.slice(0, 7)}\` (${plural(out.relay.ahead, 'commit')} ahead, the relay’s files changed). In the relay’s folder: \`docker compose pull && docker compose up -d\`.`)
      }
    }
    const v = (await call({ action: 'ops' }).catch(() => null))?.version
    if (v) {
      let latest = null
      let stale = false
      if (SHA.test(v.tag || '')) {
        // Étiquette = commit déployé (image Docker) : comparaison exacte.
        const cmp = await gh(`/repos/${repos.web}/compare/${v.tag}...main`)
        if (cmp) {
          latest = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : null
          stale = Boolean(latest) && (cmp.files || []).some((f) => WORKER_PATHS.test(f.filename || ''))
        }
      } else if (v.timestamp) {
        // Cloudflare : la date de la version face au dernier commit de main qui change worker.js.
        const list = await gh(`/repos/${repos.web}/commits?sha=main&path=worker.js&per_page=1`)
        const c = Array.isArray(list) ? list[0] : null
        if (c?.sha) {
          latest = c.sha
          stale = Date.parse(c.commit?.committer?.date || '') > Date.parse(v.timestamp) + 60_000
        }
      }
      out.worker = { id: v.id || null, tag: v.tag || null, deployedAt: Date.parse(v.timestamp || '') || null, latest, stale }
      next.worker = await lag(prev.worker, stale ? latest : null, () => `⬆️ **Worker not up to date**: the last change to \`worker.js\` on \`main\` (\`${latest.slice(0, 7)}\`) is newer than the deployed version${out.worker.deployedAt ? ` (${ago(out.worker.deployedAt)})` : ''}. Check the Worker’s builds (Cloudflare → Workers & Pages → the Worker → Deployments).`)
    }
    lastVersions = out
    if (JSON.stringify(next) !== JSON.stringify(prev)) await kvSet('version_alerts', next)
  }

  /** La racine d'un Worker répond-elle, et en combien de temps ? */
  async function probeWorker(base) {
    const t0 = Date.now()
    try {
      const r = await fetch(`${base}/`, { signal: AbortSignal.timeout(15_000) })
      await r.body?.cancel().catch(() => {})
      return { ok: r.ok, ms: Date.now() - t0, problem: r.ok ? null : `HTTP ${r.status}${r.status === 429 ? ' (daily quota?)' : ''}` }
    } catch {
      return { ok: false, ms: null, problem: 'unreachable' }
    }
  }

  /** /status : l'état du serveur en un message. Quotas de Cloudflare relus ;
   *  versions : la dernière comparaison (30 min au plus). */
  async function statusText() {
    const now = Date.now()
    const [o, probes, q] = await Promise.all([
      call({ action: 'ops' }).catch((e) => ({ error: e.status === 400 ? 'the Worker isn’t up to date' : e.message })),
      Promise.all([['main', worker], ...fallbacks.map((f) => ['fallback', f])].map(async ([kind, base]) => ({ kind, ...(await probeWorker(base)) }))),
      cfOn ? cfQuotas().catch((e) => ({ at: Date.now(), error: e.message })) : null,
    ])
    const L = [`📟 **Status** — <t:${Math.floor(now / 1000)}:f>`]
    L.push(`**Workers**: ${probes.map((p) => `${p.kind} ${p.ok ? '✅' : `❌ ${p.problem}`}${p.ms !== null ? ` (${p.ms} ms)` : ''}`).join(' · ')}`)
    if (o.error) L.push(`**Worker state**: unavailable (${o.error})`)
    else {
      L.push(`**Database**: ${mb(o.db?.bytes)} of ${mb(o.db?.max)} (${pct(o.db?.bytes, o.db?.max)}%)`)
      const n = o.ntfy || {}
      L.push(`**ntfy**: ${num(n.sentToday)}${n.quota ? ` / ${num(n.quota)}` : ''} sent today (${n.route === 'relay' ? 'through the relay' : 'direct'})`
        + (n.pausedUntil ? ` · ⏸️ paused until <t:${Math.floor(n.pausedUntil / 1000)}:t>${n.code === 42908 ? ' (daily quota reached)' : ''}` : ''))
      const lane = (k) => {
        const x = o.queue?.[k] || {}
        return `${k} ${num(x.n)}${x.n && x.oldest ? ` (oldest ${ago(x.oldest)})` : ''}`
      }
      L.push(`**Notification queue**: ${lane('web')} · ${lane('ntfy')}`)
      const last = Number(o.cron?.at) || 0
      L.push(`**Scheduled task**: ${last ? `last run ${ago(last)}${now - last > 5 * 60_000 ? ' ⚠️' : ''}` : 'no run recorded yet'}`)
      const busy = (o.caps || []).filter((c) => c.n > 0 && c.max > 0).sort((a, b) => b.n / b.max - a.n / a.max).slice(0, 6)
      L.push(`**Daily caps** (UTC): ${busy.length ? busy.map((c) => `${c.label} ${num(c.n)}/${num(c.max)}`).join(' · ') : 'nothing used yet'}`)
    }
    const vr = lastVersions?.relay
    const relayV = SHA.test(version)
      ? `\`${version.slice(0, 7)}\`${vr ? (vr.stale ? ` ⚠️ \`${vr.branch}\` is at \`${String(vr.head).slice(0, 7)}\`` : ' ✅') : ''}`
      : 'unknown (image built without GIT_SHA)'
    const wv = o.error ? null : o.version
    const vw = lastVersions?.worker
    const workerV = wv
      ? `\`${String(wv.tag || wv.id).slice(0, 8)}\`${wv.timestamp ? ` deployed ${ago(Date.parse(wv.timestamp))}` : ''}${vw ? (vw.stale ? ' ⚠️ behind main' : ' ✅') : ''}`
      : 'unknown (no version_metadata)'
    L.push(`**Versions**: relay ${relayV} · Worker ${workerV}${lastVersions ? ` · compared with GitHub ${ago(lastVersions.at)}` : ''}`)
    L.push(`**Bot**: ${gw.state === 'ready' && gw.readyAt ? `connected for ${dur(now - gw.readyAt)}` : gw.state}`
      + `${gw.lastAck ? ` · last heartbeat ack ${dur(now - gw.lastAck)} ago` : ''} · relay up for ${dur(process.uptime() * 1000)}`)
    if (!cfOn) L.push('**Cloudflare quotas**: off — set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the relay’s .env')
    else if (q?.error) L.push(`**Cloudflare quotas**: unreadable (${q.error})`)
    else L.push(`**Cloudflare quotas** (today, UTC, free plan): ${CF_QUOTAS.map(([id, label, max]) => `${label} ${num(q[id])} / ${num(max)} (${pct(q[id], max)}%)`).join(' · ')}`)
    return L.join('\n')
  }

  // ── /forget-user ─────────────────────────────────────────────────────────
  // Aperçu d'abord (rien n'est effacé), puis « Erase for good ». Le texte que
  // rend l'aperçu (`who` : chaque @pseudo y est déjà l'identifiant du compte
  // montré) est gardé ici 10 min, sous un jeton dans l'identifiant du bouton
  // (100 caractères au plus pour lui) : la confirmation efface ce compte-là,
  // sans chercher le pseudo une seconde fois.
  const forgets = new Map()   // jeton → { who, at }
  const FORGET_LABELS = {
    sync: 'backup (history, progress)', settings: 'synced settings', usage: 'usage entries', votes: 'poll votes',
    reactions: 'reactions', reports: 'reports', pictures: 'pictures', posts: 'Discord posts',
    subscriptions: 'notification subscriptions', channels: 'followed channels',
  }
  const FORGET_HINT = 'ℹ️ Reports and notification subscriptions aren’t tied to a Twitch account or an install: add the report’s post (link or ID) or the person’s @Discord account, and their ntfy topic (tu-…) for the iOS app’s notifications.'
  function forgetSummary(r) {
    const found = Object.entries(r.found || {}).filter(([, n]) => n > 0).map(([k, n]) => `${FORGET_LABELS[k] || k} ${num(n)}`)
    return [
      `**Recognised**: ${(r.targets || []).map((x) => x.label).join(' · ') || 'nothing'}`,
      `**${r.dry ? 'Found' : 'Erased'}**: ${found.join(' · ') || 'nothing stored'}`,
      ...(r.unknown?.length ? [`**Not recognised**: ${r.unknown.join(' · ')}`] : []),
    ].join('\n')
  }
  // Worker d'avant : l'action inconnue tombe sur « Bad post ID ».
  const FORGET_OUTDATED = 'the Worker isn’t up to date (it can’t erase yet): update it first.'
  const forgetError = (e) => (e.status === 400 && /post ID/i.test(e.message) ? FORGET_OUTDATED : e.message)

  async function forgetCommand(i, user) {
    const who = String(opt(i, 'who') || '').slice(0, 1000)
    await respond(i, 5, { flags: 64 })
    try {
      const r = await call({ action: 'forget', who, dry: true, by: byOf(user) })
      const any = Object.values(r.found || {}).some((n) => n > 0)
      // Sans `who`, le Worker d'avant chercherait le pseudo à nouveau.
      if (any && typeof r.who !== 'string') throw new Error(FORGET_OUTDATED)
      let components = []
      if (any) {
        const now = Date.now()
        for (const [k, f] of forgets) if (now - f.at > 10 * 60_000) forgets.delete(k)
        const id = crypto.randomUUID().slice(0, 8)
        forgets.set(id, { who: r.who, at: now })
        components = [row(button('Erase for good', `fg:yes:${id}`, 4), button('Cancel', `fg:no:${id}`))]
      }
      const head = any ? '🧹 **Erase this person’s data?** Preview — nothing is erased yet.' : '🧹 Nothing stored for this — nothing to erase.'
      await editOriginal(i, { content: `${head}\n${forgetSummary(r)}\n${FORGET_HINT}`.slice(0, 1900), components })
    } catch (e) {
      await editOriginal(i, { content: `❌ ${forgetError(e)}` })
    }
  }

  async function forgetConfirm(i, user, choice, id) {
    const f = forgets.get(id)
    forgets.delete(id)
    if (choice !== 'yes') return respond(i, 7, { content: 'Cancelled — nothing was erased.', components: [] })
    if (!f || Date.now() - f.at > 10 * 60_000) return respond(i, 7, { content: 'This preview expired: run /forget-user again.', components: [] })
    await respond(i, 6)
    try {
      const r = await call({ action: 'forget', who: f.who, dry: false, by: byOf(user) })
      // Posts Discord des retours : dans la corbeille du Worker, vidée tout de suite.
      if (r.found?.posts) emptyTrash().catch((e) => log.warn(`Discord bridge: trash — ${e.message}`))
      await editOriginal(i, { content: `✅ **Erased.**\n${forgetSummary(r)}`.slice(0, 1900), components: [] })
    } catch (e) {
      await editOriginal(i, { content: `❌ Not erased: ${forgetError(e)}`, components: [] })
    }
  }

  /** État de la passerelle pour /health du relais : `ok` faux quand le bot est
   *  arrêté (jeton refusé…), pas connecté depuis plus de 5 min, ou sans accusé
   *  de battement depuis trois battements. */
  function health() {
    const now = Date.now()
    const late = gw.state === 'ready' && gw.interval > 0 && gw.lastAck > 0 && now - gw.lastAck > 3 * gw.interval
    const stuck = gw.state !== 'ready' && now - gw.since > 5 * 60_000
    return { state: gw.state, ok: gw.state !== 'stopped' && !late && !stuck, since: gw.since, readyAt: gw.readyAt || null, lastAck: gw.lastAck || null }
  }

  function startTimers() {
    if (!timers || intervals.length) return
    const every = (ms, fn) => {
      const h = setInterval(() => { if (!stopped) fn().catch((e) => log.warn(`Discord bridge: ${fn.name} — ${e.message}`)) }, ms)
      h.unref?.()
      intervals.push(h)
    }
    every(10 * 60_000, heartbeat)
    every(10 * 60_000, watchReleases)
    every(5 * 60_000, watchHealth)
    every(10 * 60_000, watchActions)
    every(60 * 60_000, tidy)
    every(60_000, summaryClock)
    every(5 * 60_000, watchOps)
    every(15 * 60_000, watchQuotas)
    every(30 * 60_000, watchVersions)
    const first = setTimeout(() => {
      for (const fn of [watchReleases, watchActions, watchHealth, tidy, watchOps, watchQuotas, watchVersions]) fn().catch((e) => log.warn(`Discord bridge: ${fn.name} — ${e.message}`))
    }, 30_000)
    first.unref?.()
    intervals.push(first)
  }

  // Événements d'un même post traités l'un après l'autre : en parallèle, deux
  // écritures dans le Worker pouvaient s'écraser (réponse perdue, ✅ affiché).
  const queues = new Map()
  function serial(key, fn) {
    const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn)
    queues.set(key, run)
    run.catch(() => {}).finally(() => { if (queues.get(key) === run) queues.delete(key) })
    return run
  }

  async function dispatch(t, d) {
    switch (t) {
      case 'READY':
        session = { id: d.session_id, resume: d.resume_gateway_url }
        st.me = d.user?.id
        st.app = d.application?.id || d.user?.id
        retries = 0
        gwState('ready')
        gw.readyAt = Date.now()
        log.log(`Discord bridge: connected (${d.user?.username || '?'})`)
        if (st.guild && !(d.guilds || []).some((g) => g.id === st.guild)) {
          log.warn('Discord bridge: the bot isn’t on the webhook’s server — invite it (README, “Discord bot”)')
        }
        await registerCommands()
        break
      case 'RESUMED':
        retries = 0
        gwState('ready')
        break
      case 'GUILD_CREATE':
        if (d.id === st.guild) await onGuild(d)
        break
      case 'CHANNEL_UPDATE':
        if (d.id === st.forum) readTags(d)
        break
      case 'THREAD_CREATE':
        if (d.parent_id === st.forum) st.threads.set(d.id, d.applied_tags || [])
        break
      case 'THREAD_UPDATE':
        await serial(d.id, () => onThreadUpdate(d))
        break
      case 'THREAD_DELETE':
        forget(d.id)
        break
      case 'THREAD_LIST_SYNC':
        for (const th of d.threads || []) if (th.parent_id === st.forum) st.threads.set(th.id, th.applied_tags || [])
        break
      case 'MESSAGE_CREATE':
        await serial(d.channel_id, () => onMessage(d))
        break
      case 'INTERACTION_CREATE':
        await onInteraction(d)
        break
    }
  }

  // ── Passerelle (WebSocket) ──────────────────────────────────────────────
  const send = (op, d) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ op, d })) }

  // Connexions déjà relancées (par leur « close » ou par hangUp) : une
  // relance chacune, jamais deux connexions en même temps.
  const relaunched = new WeakSet()

  /** Ferme `sock` et, si son « close » n'est pas arrivé 5 s plus tard, relance
   *  la connexion sans l'attendre : sur une connexion à moitié ouverte, il
   *  pouvait traîner des minutes, et le bot restait sourd. */
  function hangUp(sock) {
    clearInterval(beatTimer)
    clearTimeout(firstBeat)
    try { sock?.close(4000) } catch {}
    setTimeout(() => {
      if (!sock || ws !== sock || relaunched.has(sock) || stopped) return
      relaunched.add(sock)
      connect()
    }, 5000)
  }

  function beat() {
    // Pas d'accusé depuis le dernier battement : connexion morte, on reprend.
    if (!acked) { hangUp(ws); return }
    acked = false
    send(1, seq)
  }

  function onPayload(p) {
    if (p.s != null) seq = p.s
    switch (p.op) {
      case 10: {   // Hello
        clearInterval(beatTimer)
        clearTimeout(firstBeat)
        acked = true
        const every = p.d.heartbeat_interval
        Object.assign(gw, { interval: every, lastAck: Date.now() })
        firstBeat = setTimeout(beat, Math.random() * every)
        beatTimer = setInterval(beat, every)
        if (session) send(6, { token, session_id: session.id, seq })
        else send(2, { token, intents: INTENTS, properties: { os: 'linux', browser: 'twitchunblock-relay', device: 'twitchunblock-relay' } })
        break
      }
      case 11: acked = true; gw.lastAck = Date.now(); break
      case 1: send(1, seq); break
      case 7: ws.close(4000); break   // Discord demande de se reconnecter
      case 9:                         // session invalide : reprise ou nouvelle
        if (!p.d) { session = null; seq = null }
        setTimeout(() => ws.close(4000), 1000 + Math.random() * 4000)
        break
      case 0:
        dispatch(p.t, p.d).catch((e) => log.warn(`Discord bridge: ${p.t} — ${e.message}`))
        break
    }
  }

  function connect() {
    if (stopped) return
    gwState('connecting')
    const url = session?.resume ? `${session.resume.replace(/\/+$/, '')}/?v=10&encoding=json` : gateway
    const sock = new WebSocket(url)
    ws = sock
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return   // connexion remplacée (hangUp) : plus écoutée
      try { onPayload(JSON.parse(String(ev.data))) } catch (e) { log.warn(`Discord bridge: unreadable message (${e.message})`) }
    })
    sock.addEventListener('error', () => {})   // suivi de « close »
    sock.addEventListener('close', (ev) => {
      if (ws !== sock || relaunched.has(sock)) return
      relaunched.add(sock)
      clearInterval(beatTimer)
      clearTimeout(firstBeat)
      if (stopped) return
      if (FATAL.has(ev.code)) {
        stopped = true
        gwState('stopped')
        log.error(`Discord bridge stopped: ${FATAL.get(ev.code)}`)
        return
      }
      // Numéro de séquence ou session périmés : nouvelle session.
      if (ev.code === 4007 || ev.code === 4009) { session = null; seq = null }
      setTimeout(connect, Math.min(60_000, 1000 * 2 ** Math.min(retries++, 6)))
    })
  }

  async function start() {
    while (!stopped) {
      try {
        const c = await call({ action: 'config' })
        st.forum = c.forum
        st.guild = c.guild
        st.labels = c.labels || {}
        st.settings = (await kvGet('settings')) || {}
        refreshTemplates().catch(() => {})
        break
      } catch (e) {
        log.warn(`Discord bridge: the Worker doesn’t answer (${e.message}) — trying again in 1 min`
          + (e.status === 403 || e.status === 404 ? ' (same FEEDBACK_BOT_SECRET on both sides? Worker up to date?)' : ''))
        await sleep(60_000)
      }
    }
    connect()
    startTimers()
  }

  start()
  return {
    stop() {
      stopped = true
      for (const h of intervals) { clearInterval(h); clearTimeout(h) }
      ws?.close(1000)
    },
    // Passerelle Discord, pour /health du relais.
    health,
    // Pour le banc : les tâches périodiques, à la demande.
    run: { watchReleases, watchHealth, watchActions, tidy, postSummary, summaryClock, heartbeat, watchOps, watchQuotas, watchVersions, statusText },
  }
}
