// ═══════════════════════════════════════════════════════════════════════════
//  Badges de chat.
//
//  L'app passe par Helix, qui exige d'être connecté. Ici GQL suffit : la
//  requête est publique, et les badges s'affichent donc aussi pour qui lit
//  le chat sans compte.
// ═══════════════════════════════════════════════════════════════════════════

import { gql } from '../api.js'

const globalBadges = {}   // set → { version → url }
const channelBadges = {}
/** Titre et description (« Moderator », « 3-Month Subscriber »…) pour la
 *  fiche d'un badge touché : set → { version → { title, description } }. */
const globalTitles = {}
const channelTitles = {}
let globalsPromise = null
let loadedLogin = null

function index(list, into, titles) {
  for (const b of list ?? []) {
    if (!b?.setID || !b?.imageURL) continue
    ;(into[b.setID] ??= {})[b.version] = b.imageURL
    if (b.title) (titles[b.setID] ??= {})[b.version] = { title: b.title, description: b.description ?? '' }
  }
}

export function loadGlobalBadges() {
  globalsPromise ??= gql('query { badges { setID version title description imageURL(size: DOUBLE) } }')
    .then((d) => index(d?.badges, globalBadges, globalTitles))
    .catch(() => {})
  return globalsPromise
}

export async function loadChannelBadges(login) {
  if (!login || loadedLogin === login) return
  loadedLogin = login
  for (const k of Object.keys(channelBadges)) delete channelBadges[k]
  for (const k of Object.keys(channelTitles)) delete channelTitles[k]
  try {
    const d = await gql(
      'query($l: String!) { user(login: $l) { broadcastBadges { setID version title description imageURL(size: DOUBLE) } } }',
      { l: login },
    )
    if (loadedLogin === login) index(d?.user?.broadcastBadges, channelBadges, channelTitles)
  } catch { /* décoratif : leur absence ne casse rien */ }
}

/** Le badge de chaîne l'emporte : un abonnement a son propre visuel par canal. */
export function resolveBadge(set, version) {
  return channelBadges[set]?.[version] ?? globalBadges[set]?.[version] ?? ''
}

/** Titre et description d'un badge (chaîne d'abord) ; sans version, le
 *  premier connu du jeu. */
export function badgeInfo(set, version) {
  const pick = (titles) => (version ? titles[set]?.[version] : Object.values(titles[set] ?? {})[0])
  return pick(channelTitles) ?? pick(globalTitles) ?? null
}

/** `subscriber/12,premium/1` → liste d'URLs prêtes à afficher. */
export function parseBadgeTag(raw) {
  if (!raw) return []
  const out = []
  for (const part of raw.split(',')) {
    const [set, version] = part.split('/')
    if (!set || !version) continue
    const url = resolveBadge(set, version)
    if (url) out.push({ id: `${set}/${version}`, set, url, title: badgeInfo(set, version)?.title ?? '' })
  }
  return out
}
