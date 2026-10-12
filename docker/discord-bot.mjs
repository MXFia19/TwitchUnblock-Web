// ═══════════════════════════════════════════════════════════════════════════
//  Pont Discord des retours (bugs, idées), lancé par relay.mjs.
//
//  Le Worker publie chaque retour dans un salon « Forum » de Discord : un post
//  par retour, où arrivent aussi les réponses de la personne. Ce bot suit ce
//  salon :
//    - ce qu'on écrit dans le post d'un retour part comme réponse du
//      développeur (la personne la lit dans « Mes signalements ») ; « // »
//      au début : note privée, rien n'est envoyé. ✅ quand c'est parti, ❌
//      sinon (avec la raison) ;
//    - l'étiquette d'état choisie (Reçu, Vu, Accepté, En cours, Fait,
//      Refusé) devient l'état du retour ; le bot crée celles qui manquent ;
//    - un changement fait ailleurs (/stats, l'app) arrive dans le post : le
//      bot remet l'étiquette qui va avec ;
//    - les retours d'avant le pont reçoivent leur post (le Worker les publie
//      quelques-uns à la fois, le bot le relance jusqu'au bout).
//  Seuls le propriétaire du serveur et DISCORD_ADMIN_IDS répondent au nom du
//  développeur ; les messages des autres restent sur Discord.
//
//  Variables (relay/docker-compose.yml, fichier .env) :
//    DISCORD_BOT_TOKEN    jeton du bot (portail développeur de Discord)
//    FEEDBACK_BOT_SECRET  secret partagé avec le Worker (même valeur des deux
//                         côtés)
//    FEEDBACK_WORKER      Worker des retours (par défaut l'officiel)
//    DISCORD_ADMIN_IDS    autres comptes autorisés à répondre (identifiants
//                         Discord, séparés par des virgules)
//
//  Sans dépendance : passerelle de Discord par le WebSocket de Node 22, API
//  REST par fetch.
// ═══════════════════════════════════════════════════════════════════════════

// GUILDS (salons, posts, étiquettes), GUILD_MESSAGES, MESSAGE_CONTENT
// (intention privilégiée, à activer dans le portail : le texte des messages).
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15)
// Fermetures sans nouvel essai possible.
const FATAL = new Map([
  [4004, 'jeton refusé (DISCORD_BOT_TOKEN)'],
  [4010, 'shard invalide'],
  [4011, 'sharding requis'],
  [4012, 'version d’API invalide'],
  [4013, 'intentions invalides'],
  [4014, 'intention « Message Content » non activée (portail développeur → Bot)'],
])
const FORUM = 15
const STATUSES = ['new', 'seen', 'accepted', 'progress', 'done', 'refused']
// Noms d'étiquettes reconnus pour chaque état (sans accents ni emoji).
const TAG_NAMES = {
  new: ['recu', 'nouveau', 'new', 'received'],
  seen: ['vu', 'seen'],
  accepted: ['accepte', 'accepted'],
  progress: ['en cours', 'in progress', 'progress'],
  done: ['fait', 'termine', 'resolu', 'done', 'fixed'],
  refused: ['refuse', 'refused', 'declined'],
}
const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]+/g, ' ').trim()
const statusOfName = (name) => STATUSES.find((s) => TAG_NAMES[s].includes(normName(name))) || null
const MAX_PHOTO_B64 = 700_000     // comme le Worker (~500 Ko d'image)
const MAX_TAGS = 5                // par post (limite de Discord)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function startDiscordBridge({
  token, secret, worker, admins = [],
  api = 'https://discord.com/api/v10',
  gateway = 'wss://gateway.discord.gg/?v=10&encoding=json',
  log = console,
}) {
  if (!token || !secret || !worker) {
    log.warn('Pont Discord coupé : DISCORD_BOT_TOKEN, FEEDBACK_BOT_SECRET et FEEDBACK_WORKER sont nécessaires')
    return null
  }
  worker = worker.replace(/\/+$/, '')
  api = api.replace(/\/+$/, '')
  const extraAdmins = new Set(admins)
  const st = {
    forum: null, forumType: null, guild: null, owner: null, me: null, labels: {},
    tagOf: new Map(),     // état → étiquette
    stateOf: new Map(),   // étiquette → état
    threads: new Map(),   // post du forum → étiquettes posées
    parents: new Map(),   // salon → parent (null : pas un post du forum)
    states: new Map(),    // post → { value: { key, status } | null, at }
    expected: new Map(),  // post → étiquettes que le bot vient de poser
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

  // ── API de Discord et du Worker ─────────────────────────────────────────
  async function rest(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${api}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': 'DiscordBot (https://github.com/MXFia19/TwitchUnblock-Web, 1)',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
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

  const react = (channel, message, emoji) => rest('PUT',
    `/channels/${channel}/messages/${message}/reactions/${encodeURIComponent(emoji)}/@me`)
    .catch((e) => log.warn(`Pont Discord : réaction impossible (${e.message})`))
  const say = (channel, content) => rest('POST', `/channels/${channel}/messages`,
    { content: content.slice(0, 1900), allowed_mentions: { parse: [] } }).catch(() => {})
  const isAdmin = (id) => Boolean(id) && (id === st.owner || extraAdmins.has(id))

  // ── Retours, posts et étiquettes ────────────────────────────────────────
  /** Retour lié au post : { key, status }, ou null. `wait` : post tout juste
   *  créé, le Worker range le lien juste après — on réessaie un peu. */
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
          log.warn(`Pont Discord : état du post ${thread} illisible (${e.message})`)
          return known?.value ?? null
        }
      }
    }
    st.states.set(thread, { value: null, at: Date.now() })
    return null
  }

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

  /** Étiquettes d'état manquantes : créées (droit « Gérer les salons »),
   *  sinon à créer à la main avec ces noms. */
  async function ensureTags(channel) {
    readTags(channel)
    const missing = STATUSES.filter((s) => !st.tagOf.has(s))
    if (!missing.length) return
    const names = missing.map((s) => st.labels[s] || s)
    const tags = channel.available_tags || []
    if (tags.length + missing.length > 20) {
      log.warn(`Pont Discord : plus de place pour les étiquettes ${names.join(', ')} (20 au plus par forum)`)
      return
    }
    try {
      const updated = await rest('PATCH', `/channels/${channel.id}`, {
        available_tags: [
          ...tags.map((t) => ({ id: t.id, name: t.name, moderated: t.moderated, emoji_id: t.emoji_id, emoji_name: t.emoji_name })),
          ...names.map((name) => ({ name, moderated: true })),
        ],
      })
      readTags(updated || channel)
      log.log(`Pont Discord : étiquettes créées (${names.join(', ')})`)
    } catch (e) {
      log.warn(`Pont Discord : étiquettes à créer à la main dans le forum (${names.join(', ')}) — ${e.message}`)
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
      log.warn(`Pont Discord : étiquette du post ${thread} non posée (${e.message})`)
    }
  }

  /** Images jointes (JPEG, PNG, WebP), en base64 pour le Worker. Trop
   *  lourde : la version réduite du CDN de Discord. */
  async function photosOf(list) {
    const ok = []
    let skipped = Math.max(0, list.length - 3)
    for (const a of list.slice(0, 3)) {
      if (!/^image\/(jpeg|png|webp)/.test(a.content_type || '')) { skipped++; continue }
      let b64 = await fetchB64(a.url)
      if ((!b64 || b64.length > MAX_PHOTO_B64) && a.proxy_url && a.width && a.height) {
        const scale = Math.min(1, 1280 / Math.max(a.width, a.height))
        const u = new URL(a.proxy_url)
        u.searchParams.set('width', String(Math.round(a.width * scale)))
        u.searchParams.set('height', String(Math.round(a.height * scale)))
        u.searchParams.set('format', 'webp')
        b64 = await fetchB64(u.href)
      }
      if (b64 && b64.length <= MAX_PHOTO_B64) ok.push(b64)
      else skipped++
    }
    return { ok, skipped }
  }

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
        if (r.error) { log.warn(`Pont Discord : anciens retours — ${r.error}`); break }
        if (!r.remaining || (!r.done && !r.retryAfter)) break
        await sleep(r.retryAfter ? Math.ceil(r.retryAfter * 1000) + 500 : 2500)
      }
    } catch (e) {
      log.warn(`Pont Discord : anciens retours non publiés (${e.message})`)
    } finally {
      backfilling = false
      if (total) log.log(`Pont Discord : ${total} ancien(s) retour(s) publié(s) dans le forum`)
    }
  }

  // ── Événements ──────────────────────────────────────────────────────────
  async function onGuild(g) {
    st.owner = g.owner_id
    const forum = (g.channels || []).find((c) => c.id === st.forum)
    if (!forum) {
      log.warn(`Pont Discord : salon ${st.forum} du webhook introuvable — le bot doit le voir (permissions du salon)`)
      return
    }
    st.forumType = forum.type
    if (forum.type !== FORUM) log.warn('Pont Discord : le webhook n’est pas dans un salon Forum — les retours n’y ont pas de post à eux')
    await ensureTags(forum)
    for (const th of g.threads || []) {
      if (th.parent_id === st.forum) st.threads.set(th.id, th.applied_tags || [])
    }
    log.log(`Pont Discord : forum « ${forum.name} » suivi — ${st.threads.size} post(s) ouvert(s), ${st.tagOf.size}/6 étiquettes d’état`)
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
      st.states.set(d.id, { value: { key: r.key, status: r.status, lastFrom: r.lastFrom }, at: Date.now() })
      await syncTags(d.id, r.status)
      log.log(`Pont Discord : ${r.key} → ${r.status}`)
    } catch (e) {
      // L'étiquette revient à l'état réel du retour.
      await syncTags(d.id, known.status)
      say(d.id, `❌ État non changé : ${e.message}`)
    }
  }

  async function onMessage(m) {
    if (!m.guild_id || m.guild_id !== st.guild || !st.forum) return
    if (m.author?.id && m.author.id === st.me) return
    if (await parentOf(m.channel_id) !== st.forum) return
    const thread = m.channel_id
    // Messages du webhook (retour, réponse de la personne, ce qui a été fait
    // dans /stats ou l'app) : l'étiquette suit l'état du retour.
    if (m.webhook_id) {
      const s = await stateOf(thread, { wait: true, fresh: true })
      if (s) await syncTags(thread, s.status)
      return
    }
    if (m.author?.bot || !isAdmin(m.author?.id)) return
    const text = String(m.content || '').trim()
    if (text.startsWith('//')) return   // note privée
    const photos = await photosOf(m.attachments || [])
    if (!text && !photos.ok.length) {
      if (photos.skipped) say(thread, '⚠️ Rien d’envoyé : seules les images JPEG, PNG ou WebP passent.')
      return
    }
    const s = await stateOf(thread)
    if (!s) { react(thread, m.id, '❔'); return }
    try {
      const r = await call({ action: 'reply', thread, message: text, photos: photos.ok })
      st.states.set(thread, { value: { key: r.key, status: r.status, lastFrom: r.lastFrom }, at: Date.now() })
      await react(thread, m.id, '✅')
      await syncTags(thread, r.status)
      if (photos.skipped) say(thread, `⚠️ ${photos.skipped} pièce(s) jointe(s) non envoyée(s) : trop lourde(s), ou pas une image JPEG, PNG ou WebP.`)
    } catch (e) {
      await react(thread, m.id, '❌')
      say(thread, `❌ Réponse non envoyée : ${e.message}`)
    }
  }

  async function dispatch(t, d) {
    switch (t) {
      case 'READY':
        session = { id: d.session_id, resume: d.resume_gateway_url }
        st.me = d.user?.id
        retries = 0
        log.log(`Pont Discord : connecté (${d.user?.username || '?'})`)
        if (st.guild && !(d.guilds || []).some((g) => g.id === st.guild)) {
          log.warn('Pont Discord : le bot n’est pas sur le serveur du webhook — invite-le (README, « Discord bridge »)')
        }
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
      case 'THREAD_LIST_SYNC':
        for (const th of d.threads || []) if (th.parent_id === st.forum) st.threads.set(th.id, th.applied_tags || [])
        break
      case 'MESSAGE_CREATE':
        await onMessage(d)
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
        dispatch(p.t, p.d).catch((e) => log.warn(`Pont Discord : ${p.t} — ${e.message}`))
        break
    }
  }

  function connect() {
    if (stopped) return
    const url = session?.resume ? `${session.resume.replace(/\/+$/, '')}/?v=10&encoding=json` : gateway
    const sock = new WebSocket(url)
    ws = sock
    sock.addEventListener('message', (ev) => {
      try { onPayload(JSON.parse(String(ev.data))) } catch (e) { log.warn(`Pont Discord : message illisible (${e.message})`) }
    })
    sock.addEventListener('error', () => {})   // suivi de « close »
    sock.addEventListener('close', (ev) => {
      if (ws !== sock) return
      clearInterval(beatTimer)
      clearTimeout(firstBeat)
      if (stopped) return
      if (FATAL.has(ev.code)) {
        stopped = true
        log.error(`Pont Discord arrêté : ${FATAL.get(ev.code)}`)
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
        break
      } catch (e) {
        log.warn(`Pont Discord : le Worker ne répond pas (${e.message}) — nouvel essai dans 1 min`
          + (e.status === 403 || e.status === 404 ? ' (même FEEDBACK_BOT_SECRET des deux côtés ? Worker à jour ?)' : ''))
        await sleep(60_000)
      }
    }
    connect()
    // Signe de vie pour /stats, et webhook déplacé dans un autre salon.
    setInterval(async () => {
      try {
        const c = await call({ action: 'config' })
        if (c.forum !== st.forum) {
          log.log(`Pont Discord : le webhook est maintenant dans le salon ${c.forum}`)
          Object.assign(st, { forum: c.forum, guild: c.guild })
          st.threads.clear()
          st.parents.clear()
          st.states.clear()
          const forum = await rest('GET', `/channels/${c.forum}`)
          st.forumType = forum?.type ?? null
          await ensureTags(forum)
        }
        // Retours dont l'envoi a raté (Discord injoignable…) : rattrapés.
        backfill()
      } catch {}
    }, 10 * 60_000).unref?.()
  }

  start()
  return {
    stop() { stopped = true; ws?.close(1000) },
  }
}
