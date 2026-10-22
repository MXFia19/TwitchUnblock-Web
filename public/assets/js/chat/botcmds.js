// ═══════════════════════════════════════════════════════════════════════════
//  Commandes des bots du chat, lues sans écrire « !commands » : mêmes API
//  publiques que l'extension « View Twitch Commands In Chat » (1011025m).
//  Nightbot, StreamElements et Fossabot acceptent les appels du navigateur ;
//  Moobot les refuse (CORS) : il passe par le Worker.
// ═══════════════════════════════════════════════════════════════════════════

import { workerJson } from '../api.js'
import { t } from '../i18n.js'
import { esc } from '../util.js'
import { linkifyHtml } from './message.js'

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
 *  sans commande exclus ; `failed` : noms des bots qui n'ont pas répondu.
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
      const bots = [['Nightbot', all[0]], ['StreamElements', all[1]], ['Fossabot', all[2]], ['Moobot', all[3]]]
      const sets = bots
        .filter(([, cmds]) => cmds?.length)
        .map(([bot, cmds]) => ({ bot, icon: ICONS[bot], commands: cmds.sort((a, b) => a.name.localeCompare(b.name)) }))
      const result = { sets, failed: bots.filter(([, cmds]) => cmds === undefined).map(([bot]) => bot) }
      if (!result.failed.length) cache.set(ch, { at: Date.now(), result })
      return result
    })().finally(() => pending.delete(ch))
    pending.set(ch, run)
  }
  return run
}

// ── Liste à l'écran ─────────────────────────────────────────────────────────
// Panneau du chat, et feuille de la page d'une chaîne hors ligne : les API
// des bots ne dépendent pas du direct, la liste non plus.

/** Filtre et liste des commandes de `channel`, ajoutés au bout de `box` et
 *  remplis à l'arrivée des réponses. `alive()` : faux quand la liste n'est
 *  plus voulue entre-temps (panneau fermé, autre chaîne) ; `onPick(nom,
 *  élément)` : clic, ou Entrée, sur une commande. */
export async function showBotCommands(box, channel, { onPick, alive = () => true }) {
  box.insertAdjacentHTML('beforeend', `<input class="bot-cmds-filter" type="search" autocomplete="off" placeholder="${esc(t('bot_commands_filter'))}">
    <div class="bot-cmds-list"><p class="muted small">${esc(t('loading'))}</p></div>`)
  const filter = box.querySelector('.bot-cmds-filter')
  const list = box.querySelector('.bot-cmds-list')
  const { sets, failed } = await fetchBotCommands(channel)
  // Panneau refait (rouvert, autre feuille) ou fermé pendant la lecture.
  if (!list.isConnected || !alive()) return
  // Bots qui n'ont pas répondu (délai, réseau, panne) : nommés, sous les
  // listes ou seuls. « Impossible de charger » n'apparaissait que si les
  // quatre échouaient : une chaîne qui n'a que Nightbot, en panne, avait
  // « Aucune commande trouvée ».
  const missing = failed.length ? `<p class="muted small">${esc(t('bot_commands_failed', { b: failed.join(', ') }))}</p>` : ''
  const render = (q = '') => {
    q = q.trim().toLowerCase()
    const shown = sets.map((s) => ({ ...s, commands: q ? s.commands.filter((c) => c.name.toLowerCase().includes(q) || c.response.toLowerCase().includes(q)) : s.commands }))
      .filter((s) => s.commands.length)
    list.innerHTML = !sets.length
      ? missing || `<p class="muted small">${esc(t('bot_commands_none'))}</p>`
      : shown.map((s) => `<section><h4><img src="${esc(s.icon)}" alt="">${esc(s.bot)} <span class="muted">${s.commands.length}</span></h4>
          ${s.commands.map((c) => `<div class="bot-cmd" role="button" tabindex="0" data-cmd="${esc(c.name)}"><code>${esc(c.name)}</code>${c.response ? `<span>${linkifyHtml(c.response)}</span>` : ''}</div>`).join('')}</section>`).join('') + missing
  }
  // Ce qui a été tapé pendant le chargement compte déjà.
  render(filter.value)
  filter.oninput = () => render(filter.value)
  // Clavier : Entrée sur une commande comme un clic.
  list.onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('[data-cmd]')) e.target.click() }
  list.onclick = (e) => {
    // Un lien dans la réponse s'ouvre, sans utiliser la commande.
    if (e.target.closest('a')) return
    const b = e.target.closest('[data-cmd]')
    if (b) onPick(b.dataset.cmd, b)
  }
}

/** Copie une commande ; une coche la confirme un instant. */
export async function copyBotCommand(name, el) {
  try {
    await navigator.clipboard.writeText(name)
    el.classList.add('copied')
    setTimeout(() => el.classList.remove('copied'), 900)
  } catch { /* presse-papiers refusé : la commande reste affichée */ }
}
