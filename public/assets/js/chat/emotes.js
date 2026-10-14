// ═══════════════════════════════════════════════════════════════════════════
//  Emotes Twitch, BTTV, FFZ et 7TV.
//
//  Port de Sources/Chat/EmoteService.swift. Les trois API tierces répondent
//  avec les en-têtes CORS qu'il faut : le navigateur les appelle en direct.
// ═══════════════════════════════════════════════════════════════════════════

const globals = new Map()   // nom → emote
const channel = new Map()   // nom → emote (canal courant)
/** Les emotes Twitch n'arrivent que par les messages : on les mémorise au vol
 *  pour l'autocomplétion et le sélecteur. */
const twitchSeen = new Map()

let globalsPromise = null
let loadedChannelId = null
/** Emotes personnelles BTTV Pro : id Twitch de l'auteur → Map(nom → emote). */
const personal = new Map()

async function getJSON(url) {
  // Abandon après 8 s : sans délai, une API qui ne répond pas (réseau
  // filtré) gardait la requête ouverte des minutes durant.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    // Une source tierce indisponible ne doit pas empêcher le chat de tourner.
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function loadGlobalEmotes() {
  globalsPromise ??= (async () => {
    const [bttv, ffz, stv] = await Promise.all([
      getJSON('https://api.betterttv.net/3/cached/emotes/global'),
      getJSON('https://api.frankerfacez.com/v1/set/global'),
      getJSON('https://7tv.io/v3/emote-sets/global'),
    ])
    for (const e of readBTTV(bttv, 'global')) globals.set(e.name, e)
    for (const e of readFFZSets(ffz?.sets, 'global')) globals.set(e.name, e)
    for (const e of read7TV(stv?.emotes, 'global')) globals.set(e.name, e)
  })()
  return globalsPromise
}

export async function loadChannelEmotes(channelId, login) {
  if (loadedChannelId === channelId && channelId) return
  // Toujours vider : sans identifiant (infos de la chaîne indisponibles),
  // les emotes de la chaîne précédente restaient affichées.
  loadedChannelId = channelId || null
  channel.clear()
  if (!channelId) return

  const [bttv, ffz, stv] = await Promise.all([
    getJSON(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`),
    getJSON(`https://api.frankerfacez.com/v1/room/${login}`),
    getJSON(`https://7tv.io/v3/users/twitch/${channelId}`),
  ])
  // Une réponse tardive d'une chaîne quittée entre-temps est ignorée.
  if (loadedChannelId !== channelId) return

  for (const e of readBTTV(bttv?.channelEmotes, 'channel', login)) channel.set(e.name, e)
  for (const e of readBTTV(bttv?.sharedEmotes, 'channel')) channel.set(e.name, e)
  for (const e of readFFZSets(ffz?.sets, 'channel')) channel.set(e.name, e)
  for (const e of read7TV(stv?.emote_set?.emotes, 'channel')) channel.set(e.name, e)
}

// Pour la fiche d'une emote, en plus de l'image : `scope` (global, channel,
// personal), `by` (auteur), `orig` (nom d'origine 7TV, quand la chaîne l'a
// renommée), `zw` (7TV : se superpose à l'emote précédente), `mod` (BTTV et
// FFZ : modificateur comme w! ou ffzW — ce n'est PAS un zero-width) et
// `large` (plus grande image servie). Tout est déjà dans les réponses : rien
// de plus à télécharger.

/** `login` : auteur des emotes propres à la chaîne (channelEmotes), que BTTV
 *  ne nomme pas ; les emotes partagées portent le nom de leur auteur. */
function readBTTV(arr, scope, login) {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((o) => typeof o?.id === 'string' && typeof o?.code === 'string')
    .map((o) => ({
      id: o.id, name: o.code, url: `https://cdn.betterttv.net/emote/${o.id}/2x`, source: 'bttv', scope,
      by: o.user?.displayName || o.user?.name || login || undefined, mod: Boolean(o.modifier),
    }))
}

const absURL = (u) => (u.startsWith('//') ? `https:${u}` : u)

function readFFZSets(sets, scope) {
  if (!sets || typeof sets !== 'object') return []
  const out = []
  for (const set of Object.values(sets)) {
    if (!Array.isArray(set?.emoticons)) continue
    for (const o of set.emoticons) {
      // Une emote animée l'est dans `animated` (WebP) : `urls` n'en garde
      // qu'une image fixe.
      const raw = o?.animated?.['2'] ?? o?.urls?.['2'] ?? o?.urls?.['1']
      if (typeof o?.name !== 'string' || typeof raw !== 'string') continue
      const large = o.animated?.['4'] ?? o.urls?.['4']
      out.push({
        id: String(o.id), name: o.name, url: absURL(raw), source: 'ffz', scope,
        large: typeof large === 'string' ? absURL(large) : undefined,
        by: o.owner?.display_name || o.owner?.name || undefined, mod: Boolean(o.modifier),
      })
    }
  }
  return out
}

function read7TV(arr, scope) {
  if (!Array.isArray(arr)) return []
  const out = []
  for (const o of arr) {
    const host = o?.data?.host?.url
    if (typeof o?.id !== 'string' || typeof o?.name !== 'string' || typeof host !== 'string') continue
    const orig = o.data.name
    out.push({
      id: o.id, name: o.name, url: `https:${host}/2x.webp`, source: '7tv', scope,
      large: `https:${host}/4x.webp`,
      by: o.data.owner?.display_name || undefined,
      orig: typeof orig === 'string' && orig !== o.name ? orig : undefined,
      // Drapeau actif dans ce jeu d'emotes (data.flags n'est que le réglage
      // conseillé par l'auteur).
      zw: ((o.flags ?? 0) & 1) === 1,
    })
  }
  return out
}

/** Emote BTTV, FFZ ou 7TV par sa source et son id, pour sa fiche : chaîne,
 *  emotes personnelles, puis globales. */
export function findEmote(source, id) {
  if (!source || !id) return null
  const match = (e) => e.source === source && e.id === id
  for (const e of channel.values()) if (match(e)) return e
  for (const map of personal.values()) for (const e of map.values()) if (match(e)) return e
  for (const e of globals.values()) if (match(e)) return e
  return null
}

/** Le canal l'emporte sur le global : un streamer peut redéfinir une emote.
 *  `userId` : auteur du message, pour ses emotes personnelles BTTV Pro
 *  (après celles de la chaîne, avant les globales). */
export function resolveEmote(name, userId) {
  return channel.get(name) ?? (userId ? personal.get(String(userId))?.get(name) : null) ?? globals.get(name) ?? null
}

export function twitchEmote(id, name) {
  const existing = twitchSeen.get(name)
  if (existing) return existing
  const emote = {
    id,
    name,
    url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
    source: 'twitch',
  }
  twitchSeen.set(name, emote)
  return emote
}

/** Propositions pour l'autocomplétion : le préfixe l'emporte sur l'occurrence
 *  — en tapant « Kappa » on veut Kappa avant KappaPride. */
export function suggestEmotes(prefix, limit = 8) {
  const kw = prefix.toLowerCase()
  if (!kw) return []
  const starts = []
  const contains = []
  for (const e of pool()) {
    const n = e.name.toLowerCase()
    if (n.startsWith(kw)) starts.push(e)
    else if (n.includes(kw)) contains.push(e)
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit)
}

function pool() {
  const all = new Map()
  for (const [n, e] of channel) all.set(n, e)
  for (const [n, e] of twitchSeen) if (!all.has(n)) all.set(n, e)
  for (const [n, e] of globals) if (!all.has(n)) all.set(n, e)
  return all.values()
}

/** Pour le sélecteur : celles de la chaîne d'abord, puis les globales. */
export function emoteCatalog() {
  const seen = new Set(channel.keys())
  const chan = [...channel.values()]
  const global = [...twitchSeen.values(), ...globals.values()].filter((e) => {
    if (seen.has(e.name)) return false
    seen.add(e.name)
    return true
  })
  return { channel: chan, global }
}
// ── BetterTTV en direct ─────────────────────────────────────────────────────
// Connexion en direct de BTTV (le protocole de son extension) : emotes
// personnelles des abonnés Pro (« lookup_user », annoncées quand ils ouvrent
// le chat ; pas de rattrapage pour ceux d'avant notre arrivée) et emotes
// ajoutées, renommées ou retirées sur la chaîne pendant le live.
let bttvSocket = null
let bttvChannel = null
let bttvRetry = 2000

function bttvSend(name, data) {
  if (bttvSocket?.readyState === 1) bttvSocket.send(JSON.stringify({ name, data }))
}

/** Suit la chaîne du chat en direct (une seule à la fois). */
export function joinBttvLive(channelId) {
  if (!channelId || bttvChannel === channelId) return
  if (bttvChannel) bttvSend('part_channel', { name: `twitch:${bttvChannel}` })
  bttvChannel = channelId
  if (!bttvSocket || bttvSocket.readyState > 1) connectBttv()
  else bttvSend('join_channel', { name: `twitch:${channelId}` })
}

export function leaveBttvLive(channelId) {
  if (!bttvChannel || (channelId && channelId !== bttvChannel)) return
  bttvSend('part_channel', { name: `twitch:${bttvChannel}` })
  bttvChannel = null
  const ws = bttvSocket
  bttvSocket = null
  ws?.close()
}

function connectBttv() {
  let ws
  try { ws = new WebSocket('wss://sockets.betterttv.net/ws') } catch { return }
  bttvSocket = ws
  ws.onopen = () => {
    bttvRetry = 2000
    if (bttvChannel) bttvSend('join_channel', { name: `twitch:${bttvChannel}` })
  }
  ws.onmessage = (ev) => onBttvEvent(ev.data)
  ws.onclose = () => {
    if (bttvSocket !== ws) return
    bttvSocket = null
    if (!bttvChannel) return
    // Recul progressif : inutile de marteler un serveur absent.
    setTimeout(() => { if (!bttvSocket && bttvChannel) connectBttv() }, bttvRetry)
    bttvRetry = Math.min(60_000, bttvRetry * 2)
  }
}

function onBttvEvent(raw) {
  let evt
  try { evt = JSON.parse(raw) } catch { return }
  const d = evt?.data ?? {}
  const chan = String(d.channel ?? '').split(':').pop()
  if (evt.name === 'lookup_user') {
    if (!d.pro || !d.providerId || !Array.isArray(d.emotes) || !d.emotes.length) return
    const map = new Map(readBTTV(d.emotes, 'personal').map((e) => [e.name, { ...e, personal: true }]))
    if (!map.size) return
    personal.delete(String(d.providerId))
    personal.set(String(d.providerId), map)
    if (personal.size > 500) personal.delete(personal.keys().next().value)
  } else if ((evt.name === 'emote_create' || evt.name === 'emote_update') && chan === loadedChannelId && d.emote?.id) {
    const old = [...channel.values()].find((e) => e.source === 'bttv' && e.id === d.emote.id)
    const code = d.emote.code ?? old?.name
    if (!code) return
    if (old) channel.delete(old.name)
    channel.set(code, {
      id: d.emote.id, name: code, url: `https://cdn.betterttv.net/emote/${d.emote.id}/2x`, source: 'bttv', scope: 'channel',
      by: d.emote.user?.displayName || d.emote.user?.name || old?.by, mod: old?.mod ?? false,
    })
  } else if (evt.name === 'emote_delete' && chan === loadedChannelId && d.emoteId) {
    const old = [...channel.values()].find((e) => e.source === 'bttv' && e.id === d.emoteId)
    if (old) channel.delete(old.name)
  }
}
