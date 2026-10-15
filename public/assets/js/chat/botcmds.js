// ═══════════════════════════════════════════════════════════════════════════
//  Commandes des bots du chat, lues sans écrire « !commands » : mêmes API
//  publiques que l'extension « View Twitch Commands In Chat » (1011025m).
//  Nightbot, StreamElements et Fossabot acceptent les appels du navigateur ;
//  Moobot les refuse (CORS) : il passe par le Worker.
// ═══════════════════════════════════════════════════════════════════════════

import { workerJson } from '../api.js'

const ICONS = {
  Moobot: 'https://static-cdn.jtvnw.net/jtv_user_pictures/663db70b-80e7-424b-a54f-ed88f7ac9355-profile_image-50x50.png',
  Nightbot: 'https://static-cdn.jtvnw.net/jtv_user_pictures/nightbot-profile_image-2345338c09b4d468-50x50.png',
  StreamElements: 'https://static-cdn.jtvnw.net/jtv_user_pictures/streamelements-profile_image-a89b9d61499d365f-50x50.png',
  Fossabot: 'https://static-cdn.jtvnw.net/jtv_user_pictures/719a0ffa-6c86-4321-83f1-44990fd644bc-profile_image-50x50.png',
}

/** Réponse JSON ; null quand le service refuse (chaîne inconnue de ce bot) ;
 *  undefined quand la requête n'a pas abouti (délai, réseau, 429, panne du
 *  service, corps illisible) : un échec n'est pas « aucune commande ». */
async function json(url, headers) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (!res.ok) return res.status === 429 || res.status >= 500 ? undefined : null
    return await res.json()
  } catch { return undefined } finally { clearTimeout(timer) }
}

const bang = (n) => (String(n).trim().startsWith('!') ? String(n).trim() : `!${String(n).trim()}`)

// Chaque bot : la liste de ses commandes ([] : aucune, ou chaîne inconnue
// de lui), ou undefined si l'une de ses requêtes n'a pas abouti.
async function nightbot(ch) {
  const chan = await json(`https://api.nightbot.tv/1/channels/t/${ch}`)
  const id = chan?.channel?._id
  if (!id) return chan === undefined ? undefined : []
  const res = await json('https://api.nightbot.tv/1/commands', { 'Nightbot-Channel': id })
  if (res === undefined) return undefined
  return (res?.commands ?? []).map((c) => ({ name: String(c.name ?? ''), response: String(c.message ?? '') })).filter((c) => c.name)
}

async function streamElements(ch) {
  const chan = await json(`https://api.streamelements.com/kappa/v2/channels/${ch}`)
  const id = chan?._id
  if (!id) return chan === undefined ? undefined : []
  const list = await json(`https://api.streamelements.com/kappa/v2/bot/commands/${id}/public`)
  if (list === undefined) return undefined
  return (Array.isArray(list) ? list : [])
    .filter((c) => c.command && c.enabled !== false && c.hidden !== true)
    .map((c) => ({ name: bang(c.command), response: String(c.reply ?? '') }))
}

async function fossabot(ch) {
  const chan = await json(`https://api.fossabot.com/v2/cached/channels/by-slug/${ch}`)
  const id = chan?.channel?.id
  if (!id) return chan === undefined ? undefined : []
  const res = await json(`https://api.fossabot.com/v2/cached/channels/${id}/commands`)
  if (res === undefined) return undefined
  return (res?.commands ?? []).filter((c) => c.name && c.enabled_online !== false).map((c) => ({ name: bang(c.name), response: String(c.response ?? '') }))
}

// Par le Worker, ou son secours quand le quota du jour est atteint.
async function moobot(ch) {
  try {
    const res = await workerJson(`/api/bot-commands/moobot?channel=${ch}`, { timeout: 10_000 })
    // Moobot n'a pas répondu au Worker : un échec, pas une liste vide.
    return res?.unavailable ? undefined : res?.commands ?? []
  } catch { return undefined }
}

const cache = new Map()     // chaîne → { at, result }
const pending = new Map()   // chaîne → lecture en cours

/** { sets: [{ bot, icon, commands: [{ name, response }] }], failed } — bots
 *  sans commande exclus ; `failed` : nombre de bots qui n'ont pas répondu.
 *  Une liste incomplète n'est pas gardée : la prochaine ouverture redemande
 *  (un échec passait pour « aucune commande » pendant 10 min). Deux
 *  ouvertures rapides partagent la même lecture. */
export function fetchBotCommands(channel) {
  const ch = encodeURIComponent(String(channel).toLowerCase())
  const hit = cache.get(ch)
  if (hit && Date.now() - hit.at < 10 * 60_000) return Promise.resolve(hit.result)
  let run = pending.get(ch)
  if (!run) {
    run = (async () => {
      const all = await Promise.all([nightbot(ch), streamElements(ch), fossabot(ch), moobot(ch)])
      const sets = [['Nightbot', all[0]], ['StreamElements', all[1]], ['Fossabot', all[2]], ['Moobot', all[3]]]
        .filter(([, cmds]) => cmds?.length)
        .map(([bot, cmds]) => ({ bot, icon: ICONS[bot], commands: cmds.sort((a, b) => a.name.localeCompare(b.name)) }))
      const result = { sets, failed: all.filter((x) => x === undefined).length }
      if (!result.failed) cache.set(ch, { at: Date.now(), result })
      return result
    })().finally(() => pending.delete(ch))
    pending.set(ch, run)
  }
  return run
}
