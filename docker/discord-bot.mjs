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
//  pause, webhook refusé, CI de l'app ou du site en échec ; résumé chaque
//  matin. Le relais lui-même : le Worker prévient (ALERT_WEBHOOK).
//  Communauté : /announce (bandeau de l'app et du site) ; brouillon des
//  notes de version à chaque sortie, publié d'un bouton ; versions de test
//  annoncées aux testeurs.
//  Seuls le propriétaire du serveur et DISCORD_ADMIN_IDS agissent au nom du
//  développeur.
//
//  Variables (relay/docker-compose.yml, fichier .env) : DISCORD_BOT_TOKEN,
//  FEEDBACK_BOT_SECRET (même valeur que sur le Worker), FEEDBACK_WORKER,
//  DISCORD_ADMIN_IDS ; facultatives : FALLBACK_WORKERS, SUMMARY_TZ,
//  SUMMARY_HOUR.
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
  { name: 'announce', description: 'Show an announcement in the app and on the website', default_member_permissions: ADMIN },
  { name: 'announce-clear', description: 'Remove the current announcement', default_member_permissions: ADMIN },
  {
    name: 'setup', description: 'Use this channel for the bot', default_member_permissions: ADMIN,
    options: [
      {
        type: 3, name: 'use', description: 'What this channel is for', required: true,
        choices: [
          { name: 'Alerts, daily summary and release drafts (private)', value: 'alerts' },
          { name: 'Release announcements', value: 'announcements' },
          { name: 'Test builds', value: 'testers' },
        ],
      },
      { type: 8, name: 'role', description: 'Role to mention (test builds)', required: false },
    ],
  },
  { name: 'summary', description: 'Post the daily summary now', default_member_permissions: ADMIN },
]
const MAX_PHOTO_B64 = 700_000     // comme le Worker (~500 Ko d'image)
const MAX_PHOTOS = 3              // par message, comme le Worker
const MAX_TAGS = 5                // par post (limite de Discord)
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_TYPES = 'JPEG, PNG or WebP'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n)
const row = (...components) => ({ type: 1, components })
const button = (label, custom_id, style = 2) => ({ type: 2, style, label, custom_id })
const textInput = (custom_id, label, style, { min, max, required = true, placeholder } = {}) =>
  ({ type: 4, custom_id, label, style, required, ...(min ? { min_length: min } : {}), ...(max ? { max_length: max } : {}), ...(placeholder ? { placeholder } : {}) })
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

export function startDiscordBridge({
  token, secret, worker, admins = [],
  api = 'https://discord.com/api/v10',
  gateway = 'wss://gateway.discord.gg/?v=10&encoding=json',
  github = 'https://api.github.com',
  site = 'https://twitchunblock.vercel.app',
  repos = { ios: 'MXFia19/TwitchUnblock', web: 'MXFia19/TwitchUnblock-Web' },
  fallbacks = ['https://test2-fallback.vxcraftmanpetit.workers.dev'],
  testSource = 'https://raw.githubusercontent.com/MXFia19/TwitchUnblock/test-17d298/apps-test.json',
  summaryTz = 'Europe/Paris',
  summaryHour = 9,
  timers = true,
  log = console,
}) {
  if (!token || !secret || !worker) {
    log.warn('Discord bridge off: DISCORD_BOT_TOKEN, FEEDBACK_BOT_SECRET and FEEDBACK_WORKER are needed')
    return null
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

  /** Texte en messages de 1900 caractères au plus, coupés aux lignes ;
   *  `components` sur le dernier. */
  async function sendChunks(channel, text, { components, allowed_mentions = { parse: [] } } = {}) {
    const parts = []
    let cur = ''
    for (const line of text.split('\n')) {
      if (cur && cur.length + line.length + 1 > 1900) { parts.push(cur); cur = '' }
      cur = cur ? `${cur}\n${line}` : line.slice(0, 1900)
    }
    if (cur) parts.push(cur)
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
      let b64 = reduce && small ? await fetchB64(small) : null
      if (!fits(b64)) b64 = await fetchB64(a.url)
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

  async function fetchB64(url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!r.ok) return null
      const buf = Buffer.from(await r.arrayBuffer())
      return buf.length > 4_000_000 ? null : buf.toString('base64')
    } catch {
      return null
    }
  }

  // ── Messages privés (retours envoyés depuis Discord) ────────────────────
  const dmChannels = new Map()
  /** `key` : boutons pour répondre, en texte (« Reply », le formulaire le
   *  plus simple, lu par tous les clients) ou en captures. */
  async function sendDm(userId, content, key, files = []) {
    let ch = dmChannels.get(userId)
    if (!ch) {
      ch = (await rest('POST', '/users/@me/channels', { recipient_id: userId }))?.id
      if (!ch) throw new Error('no DM channel')
      dmChannels.set(userId, ch)
    }
    await rest('POST', `/channels/${ch}/messages`, {
      content: content.slice(0, 1900), allowed_mentions: { parse: [] },
      ...(key ? { components: [row(button('Reply', `ur:${key}`, 1), button('Send screenshots', `us:${key}`))] } : {}),
    }, files)
  }

  /** Réponses du développeur pas encore envoyées à qui a écrit depuis
   *  Discord : en message privé, une par une, dans l'ordre, images jointes
   *  (lues une par une au Worker). Discord refuse les fichiers : le texte
   *  part seul, et le post le dit. */
  const dmQueue = new Map()
  function deliverDm(thread) {
    const run = (dmQueue.get(thread) || Promise.resolve()).then(async () => {
      const r = await call({ action: 'deliver', thread, pics: true })
      if (!r?.du || !r.items?.length) return
      for (const it of r.items) {
        const files = []
        for (const n of it.pics || []) {
          const p = await call({ action: 'photo', thread, n }).catch(() => null)
          if (p?.b64) files.push({ bytes: Buffer.from(p.b64, 'base64'), type: p.type, name: `picture${files.length + 1}.${EXT[p.type] || 'jpg'}` })
        }
        const ph = it.ph || 0
        // Mention ajoutée après la coupe : une longue réponse ne la cache pas.
        const withLost = (text, k) => {
          const note = k > 0 ? `\n(📷 ${plural(k, 'picture')} couldn’t be sent here)` : ''
          return text.slice(0, 1900 - note.length) + note
        }
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
            await say(thread, '⚠️ I couldn’t send this to the user in a direct message (their DMs are closed).')
          }
          break
        }
      }
    }).catch((e) => log.warn(`Discord bridge: DM delivery failed (${e.message})`))
    dmQueue.set(thread, run)
    return run
  }

  // ── Après une réponse ou un état du développeur ─────────────────────────
  async function postQuickReplies(thread) {
    if (st.quickDone.has(thread)) return
    st.quickDone.add(thread)
    await say(thread, '⚡ **Quick replies** — sent to the user as your reply:', {
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
      components: [row(button('In the app', 'fx:ios', 1), button('On the website', 'fx:web', 1), button('Both', 'fx:both', 1), button('Don’t tell them', 'fx:none'))],
    })
  }

  async function afterTeamUpdate(thread, s, prevStatus) {
    if (!s) return
    await syncTags(thread, s.status)
    if (s.status === 'done' && prevStatus && prevStatus !== 'done' && !s.fix) await fixPrompt(thread)
    if (s.discord) await deliverDm(thread)
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
    const prev = st.threads.get(d.id) || []
    const tags = d.applied_tags || []
    st.threads.set(d.id, tags)
    const expected = st.expected.get(d.id)
    if (expected) {
      st.expected.delete(d.id)
      if (expected.length === tags.length && expected.every((t) => tags.includes(t))) return   // notre changement
    }
    const added = tags.filter((t) => st.stateOf.has(t) && !prev.includes(t))
    if (!added.length) return
    const status = st.stateOf.get(added[added.length - 1])
    const known = await stateOf(d.id)
    if (!known) return
    if (known.status === status) return syncTags(d.id, status)
    try {
      const r = await call({ action: 'status', thread: d.id, status })
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
    if (m.guild_id !== st.guild || !st.forum) return
    if (m.author?.id && m.author.id === st.me) return
    if (await parentOf(m.channel_id) !== st.forum) return
    const thread = m.channel_id
    // Messages du webhook (retour, réponse de la personne, ce qui a été fait
    // dans /stats ou l'app, « c'est en ligne ») : l'étiquette suit l'état,
    // les réponses partent en message privé, un nouveau retour reçoit ses
    // réponses rapides.
    if (m.webhook_id) {
      const prev = st.states.get(thread)?.value?.status
      const s = await stateOf(thread, { wait: true, fresh: true })
      if (!s) return
      await afterTeamUpdate(thread, s, prev)
      if (m.id === thread && s.status === 'new') await postQuickReplies(thread)
      return
    }
    if (m.author?.bot || !isAdmin(m.author?.id)) return
    const text = String(m.content || '').trim()
    if (text.startsWith('//')) return   // note privée
    const photos = await photosOf(m.attachments || [])
    if (!text && !photos.ok.length) {
      if (photos.skipped) say(thread, `⚠️ Nothing sent: too big, or not a ${PHOTO_TYPES} image.`)
      return
    }
    const s = await stateOf(thread)
    if (!s) { react(thread, m.id, '❔'); return }
    try {
      const r = await call({ action: 'reply', thread, message: text, photos: photos.ok })
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
  const announceModal = () => ({
    custom_id: 'announce',
    title: 'Announcement (app and website)',
    components: [
      row(textInput('title', 'Title (optional)', 1, { max: 80, required: false })),
      row(textInput('message', 'Message', 2, { max: 500, required: false })),
      row(textInput('link', 'Link (optional, https://…)', 1, { max: 300, required: false })),
      row(textInput('hours', 'Show it for how many hours? (default 24)', 1, { max: 4, required: false })),
    ],
  })

  async function onInteraction(i) {
    const user = i.member?.user || i.user
    if (!user) return
    if (i.type === 2) return onCommand(i, user)
    if (i.type === 3) return onComponent(i, user)
    if (i.type === 5) return onModal(i, user)
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
    if (!isAdmin(user.id)) return adminOnly(i)
    switch (name) {
      case 'announce': return respond(i, 9, announceModal())
      case 'announce-clear':
        return deferred(i, async () => { await call({ action: 'announce', clear: true }); return 'Announcement removed from the app and the website.' })
      case 'setup': return deferred(i, () => setup(i))
      case 'summary':
        return deferred(i, async () => ((await postSummary(st.settings.alerts || i.channel_id)) ? 'Summary posted.' : 'Nothing to post.'))
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
            await call({ action: 'block', thread })
            await say(thread, '🔒 Conversation closed: the user can no longer write in this report.')
            return 'Done: the user can no longer write in this report.'
          })
        }
        return deferred(i, () => merge(thread, String(opt(i, 'into') || '')))
      }
    }
    return respond(i, 4, { flags: 64, content: 'Unknown command.' })
  }

  async function merge(thread, into) {
    const r = await call({ action: 'merge', thread, into })
    if (r.intoThread) {
      await say(thread, `🔀 Merged into <#${r.intoThread}>: the user was told, and this report will follow its status.`)
      await say(r.intoThread, `🔀 Duplicate merged here: <#${thread}>.`)
    }
    await deliverDm(thread)
    await rest('PATCH', `/channels/${thread}`, { archived: true }).catch(() => {})
    return 'Merged.'
  }

  async function setup(i) {
    const use = String(opt(i, 'use') || '')
    const role = opt(i, 'role') || null
    const settings = { ...st.settings }
    if (use === 'alerts') settings.alerts = i.channel_id
    else if (use === 'announcements') settings.announcements = i.channel_id
    else if (use === 'testers') { settings.testers = i.channel_id; settings.testersRole = role }
    else return 'Unknown choice.'
    await kvSet('settings', settings)
    st.settings = settings
    return {
      alerts: 'This channel now gets the alerts, the daily summary and the release-notes drafts. Keep it private.',
      announcements: 'Published release notes will go to this channel.',
      testers: `New test builds will be posted here${role ? ` and mention <@&${role}> (the role must be mentionable)` : ''}.`,
    }[use]
  }

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
    if (!isAdmin(user.id)) return adminOnly(i)
    const thread = i.channel_id
    switch (kind) {
      case 'qr': {
        const q = QUICK[Number(a)]
        if (!q) return
        await respond(i, 6)
        try {
          const prev = (await stateOf(thread))?.status
          const r = await call({ action: 'reply', thread, message: q.text, ...(q.status ? { status: q.status } : {}) })
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
          await call({ action: 'fix', thread, platform: a })
          const where = { ios: 'the app', web: 'the website', both: 'the app and the website' }[a]
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
          await call({ action: 'delete', thread })
          await editOriginal(i, { content: 'Deleted.', components: [] })
          await rest('DELETE', `/channels/${thread}`)
          forget(thread)
        } catch (e) {
          await editOriginal(i, { content: `❌ ${e.message}`, components: [] })
        }
        return
      }
      case 'rel': {
        const head = String(i.message?.content || '').split('\n')[0]
        if (a === 'del') {
          await kvSet(`draft_${b}`, null, 60).catch(() => {})
          return respond(i, 7, { content: `${head}\n🗑️ Discarded.`, components: [] })
        }
        const channel = st.settings.announcements
        if (!channel) return respond(i, 4, { flags: 64, content: 'Pick the announcements channel first: run /setup there with “Release announcements”.' })
        await respond(i, 6)
        const draft = await kvGet(`draft_${b}`).catch(() => null)
        if (!draft?.text) return editOriginal(i, { content: `${head}\n❌ This draft expired.`, components: [] })
        await sendChunks(channel, draft.text)
        await editOriginal(i, { content: `${head}\n✅ Published in <#${channel}>.`, components: [] })
        return
      }
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
          link: field(i, 'link'), hours: Number(field(i, 'hours')) || 24,
        })
        return `Announcement live in the app and on the website until <t:${Math.floor(r.announcement.until / 1000)}:f>.`
      })
    }
  }

  // ── Surveillance ────────────────────────────────────────────────────────
  async function alert(text) {
    if (st.settings.alerts) await sendChunks(st.settings.alerts, text).catch((e) => log.warn(`Discord bridge: alert not posted (${e.message})`))
    else log.warn(`Discord bridge alert (no /setup alerts channel): ${text}`)
  }

  /** Workers (principal et secours), ntfy, webhook : prévenu à la panne,
   *  puis au retour. */
  async function watchHealth() {
    const prev = (await kvGet('alerts').catch(() => null)) || {}
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
    if (JSON.stringify(next) !== JSON.stringify(prev)) await kvSet('alerts', next)
  }

  /** CI de l'app et du site : un échec, une alerte (une seule fois). */
  async function watchActions() {
    const seen = (await kvGet('runs').catch(() => null)) || { since: Date.now() - 15 * 60_000, ids: [] }
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
    else if (!(await kvGet('runs').catch(() => null))) await kvSet('runs', seen)
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
    const how = tv
      ? 'Apple TV build: install it with Xcode (see the README).'
      : `Install it from the test source <${testSource}>, or download the IPA: <${rel.html_url}>`
    await sendChunks(channel, `${role ? `<@&${role}> ` : ''}🧪 **New test build: ${rel.name}**\n${items.join('\n')}\n\n${how}`,
      { allowed_mentions: role ? { parse: [], roles: [role] } : { parse: [] } })
  }

  /** Sorties : app (GitHub, versions stables et de test) et site (version
   *  en ligne). Nouvelle version stable : brouillon des notes, et le Worker
   *  prévient les retours qui l'attendaient. La première fois, on retient. */
  async function watchReleases() {
    const seen = (await kvGet('seen').catch(() => null)) || {}
    const next = { ...seen }
    const rels = await gh(`/repos/${repos.ios}/releases?per_page=20`)
    if (Array.isArray(rels)) {
      const stable = rels.find((r) => !r.prerelease && !r.draft && /^TwitchUnblock \d/.test(r.name || ''))
      const test = rels.find((r) => r.prerelease && /^test-/.test(r.tag_name || ''))
      const tv = rels.find((r) => r.prerelease && /^tv-test-/.test(r.tag_name || ''))
      if (stable) {
        const v = stable.name.replace(/^TwitchUnblock\s+/, '').trim()
        if (seen.ios && seen.ios !== v) await draftRelease('ios', v, stable)
        next.ios = v
      }
      if (test && test.tag_name !== seen.iosTest) { if (seen.iosTest) await postTestBuild(test); next.iosTest = test.tag_name }
      if (tv && tv.tag_name !== seen.tvTest) { if (seen.tvTest) await postTestBuild(tv); next.tvTest = tv.tag_name }
    }
    const web = await siteVersion()
    if (web) {
      if (seen.web && seen.web !== web) await draftRelease('web', web)
      next.web = web
    }
    if (JSON.stringify(next) !== JSON.stringify(seen)) await kvSet('seen', next)
    if (next.ios || next.web) {
      const r = await call({ action: 'released', ios: next.ios, web: next.web }).catch(() => null)
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
      if (act) lines.push(`**Users yesterday**: ${act.total} active (iOS ${act.ios} · web ${act.web})${nw ? ` · ${(nw.newIos || 0) + (nw.newWeb || 0)} new` : ''}`)
      if (pu) lines.push(`**Live notifications sent yesterday**: ${(pu.ok_web || 0) + (pu.ok_ntfy || 0)} (web ${pu.ok_web || 0} · ntfy ${pu.ok_ntfy || 0})`)
    }
    if (seen) lines.push(`**Versions**: app ${seen.ios || '?'} · website ${seen.web || '?'}${seen.iosTest ? ` · latest test build ${seen.iosTest}` : ''}`)
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
    if ((await kvGet('summaryDay').catch(() => null)) === now.day) return
    await kvSet('summaryDay', now.day)
    await postSummary(st.settings.alerts)
  }

  async function heartbeat() {
    const c = await call({ action: 'config' })
    if (c.forum !== st.forum) {
      log.log(`Discord bridge: the webhook moved to channel ${c.forum}`)
      Object.assign(st, { forum: c.forum, guild: c.guild })
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
    const first = setTimeout(() => {
      for (const fn of [watchReleases, watchActions, watchHealth, tidy]) fn().catch((e) => log.warn(`Discord bridge: ${fn.name} — ${e.message}`))
    }, 30_000)
    first.unref?.()
    intervals.push(first)
  }

  async function dispatch(t, d) {
    switch (t) {
      case 'READY':
        session = { id: d.session_id, resume: d.resume_gateway_url }
        st.me = d.user?.id
        st.app = d.application?.id || d.user?.id
        retries = 0
        log.log(`Discord bridge: connected (${d.user?.username || '?'})`)
        if (st.guild && !(d.guilds || []).some((g) => g.id === st.guild)) {
          log.warn('Discord bridge: the bot isn’t on the webhook’s server — invite it (README, “Discord bot”)')
        }
        await registerCommands()
        break
      case 'RESUMED':
        retries = 0
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
        await onThreadUpdate(d)
        break
      case 'THREAD_DELETE':
        forget(d.id)
        break
      case 'THREAD_LIST_SYNC':
        for (const th of d.threads || []) if (th.parent_id === st.forum) st.threads.set(th.id, th.applied_tags || [])
        break
      case 'MESSAGE_CREATE':
        await onMessage(d)
        break
      case 'INTERACTION_CREATE':
        await onInteraction(d)
        break
    }
  }

  // ── Passerelle (WebSocket) ──────────────────────────────────────────────
  const send = (op, d) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ op, d })) }

  function beat() {
    // Pas d'accusé depuis le dernier battement : connexion morte, on reprend.
    if (!acked) { ws?.close(4000); return }
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
        firstBeat = setTimeout(beat, Math.random() * every)
        beatTimer = setInterval(beat, every)
        if (session) send(6, { token, session_id: session.id, seq })
        else send(2, { token, intents: INTENTS, properties: { os: 'linux', browser: 'twitchunblock-relay', device: 'twitchunblock-relay' } })
        break
      }
      case 11: acked = true; break
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
    const url = session?.resume ? `${session.resume.replace(/\/+$/, '')}/?v=10&encoding=json` : gateway
    const sock = new WebSocket(url)
    ws = sock
    sock.addEventListener('message', (ev) => {
      try { onPayload(JSON.parse(String(ev.data))) } catch (e) { log.warn(`Discord bridge: unreadable message (${e.message})`) }
    })
    sock.addEventListener('error', () => {})   // suivi de « close »
    sock.addEventListener('close', (ev) => {
      if (ws !== sock) return
      clearInterval(beatTimer)
      clearTimeout(firstBeat)
      if (stopped) return
      if (FATAL.has(ev.code)) {
        stopped = true
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
        st.settings = (await kvGet('settings').catch(() => null)) || {}
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
    // Pour le banc : les tâches périodiques, à la demande.
    run: { watchReleases, watchHealth, watchActions, tidy, postSummary, summaryClock, heartbeat },
  }
}
