// ═══════════════════════════════════════════════════════════════════════════
//  Analyse des lignes IRC de Twitch.
//
//  Port de Sources/Chat/IRCParser.swift (app iOS). Les plages d'emotes du tag
//  `emotes` sont comptées en points de code (un emoji en vaut un), pas en
//  unités UTF-16 comme les chaînes JavaScript : parseEmoteRanges convertit.
// ═══════════════════════════════════════════════════════════════════════════

export function parseIRC(raw) {
  let rest = raw
  const tags = {}
  let prefix = null

  // 1 — Tags : @key=value;key2=value2 …
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ')
    if (space < 0) return null
    for (const pair of rest.slice(1, space).split(';')) {
      const eq = pair.indexOf('=')
      if (eq < 0) tags[pair] = ''
      else tags[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    rest = rest.slice(space + 1).trim()
  }

  // 2 — Préfixe : :nick!user@host
  if (rest.startsWith(':')) {
    const parts = rest.slice(1).split(' ')
    prefix = parts[0] ?? null
    rest = parts.slice(1).join(' ').trim()
  }

  // 3 — Commande et paramètres
  const components = rest.split(' ')
  const command = components.shift()
  if (!command) return null

  const params = []
  for (let i = 0; i < components.length; i++) {
    const c = components[i]
    if (c.startsWith(':')) {
      // Paramètre final : tout le reste de la ligne, espaces compris.
      params.push(components.slice(i).join(' ').slice(1))
      break
    }
    params.push(c)
  }

  return { raw, tags, command, params, prefix }
}

/** Pseudo extrait du préfixe `nick!user@host` (JOIN et PART n'ont pas de tags). */
export function prefixNick(msg) {
  if (!msg.prefix) return null
  const nick = msg.prefix.split('!')[0] ?? msg.prefix
  return nick.includes('@') ? null : nick.toLowerCase()
}

/** Corps du message, c'est-à-dire le paramètre final. */
export function ircText(msg) {
  return msg.params.length > 1 ? (msg.params[1] ?? null) : null
}

/** Twitch échappe les espaces et quelques caractères dans les valeurs de tags.
 *  Décodé en une seule passe : en série, « \\s » (barre oblique échappée puis
 *  « s ») devenait une barre suivie d'une espace. Un échappement inconnu donne
 *  le caractère seul, une barre finale isolée disparaît (règle IRCv3). */
const TAG_ESCAPES = { s: ' ', ':': ';', r: '\r', n: '\n', '\\': '\\' }
export function unescapeTag(value) {
  return String(value).replace(/\\([\s\S]?)/g, (_, c) => TAG_ESCAPES[c] ?? c)
}

/**
 * Plages d'emotes Twitch depuis le tag `emotes`, en positions UTF-16 du texte.
 * Format : `id:debut-fin,debut-fin/id2:debut-fin`, bornes incluses, comptées
 * en points de code : un emoji hors du plan de base occupe deux unités dans
 * une chaîne JavaScript, et décalait d'autant les emotes qui le suivaient
 * (« 😂 Kappa » donnait « ␠Kapp »).
 */
export function parseEmoteRanges(raw, text) {
  if (!raw) return []
  // Position UTF-16 de chaque point de code, plus celle de la fin du texte.
  const at = []
  let pos = 0
  for (const ch of text) { at.push(pos); pos += ch.length }
  at.push(pos)
  const count = at.length - 1
  const out = []
  for (const part of raw.split('/')) {
    const [id, ranges] = part.split(':')
    if (!id || !ranges) continue
    for (const r of ranges.split(',')) {
      const [a, b] = r.split('-')
      const start = Number(a)
      const end = Number(b)
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue
      if (start < 0 || start > end || end >= count) continue
      out.push({ id, start: at[start], end: at[end + 1] })
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

/**
 * Tag `gifs` (clavier GIF de Twitch) : « début-fin|id|adresse » séparés par
 * des virgules, positions en points de code comme les emotes. L'adresse est
 * gardée telle quelle (règle de Twitch), GIPHY seulement.
 */
export function parseGifRanges(raw, text) {
  const value = unescapeTag(raw || '')
  if (!value) return []
  const at = []
  let pos = 0
  for (const ch of text) { at.push(pos); pos += ch.length }
  at.push(pos)
  const count = at.length - 1
  const out = []
  for (const m of value.matchAll(/(\d+)-(\d+)\|[^|]*\|(https:\/\/[^,]+?)(?=,\d+-\d+\||$)/g)) {
    const start = Number(m[1])
    const end = Number(m[2])
    if (start > end || end >= count) continue
    let host = ''
    try { host = new URL(m[3]).hostname.toLowerCase() } catch { continue }
    if (host !== 'giphy.com' && !host.endsWith('.giphy.com')) continue
    out.push({ url: m[3], start: at[start], end: at[end + 1] })
  }
  return out
}
