// ═══════════════════════════════════════════════════════════════════════════
//  Hype train : approche (« En approche »), départ, niveaux et fin.
//
//  L'état initial vient de GQL (requête publique, sans compte), relu
//  régulièrement et à chaque échéance. Dans le chat principal, Hermes raconte
//  la suite à la seconde (départ, niveaux, fin) ; le chat du multi-live se
//  contente de GQL. Les deux passent par les mêmes règles, celles de Twitch :
//  - une approche n'est montrée que sans train en cours, jusqu'à son échéance
//    (elle expire en silence : aucun message Hermes) ;
//  - un train, tant que son échéance est à venir (chaque niveau la repousse) ;
//  - un train qui part après son approche, ou directement, annonce son
//    départ ; rien n'est annoncé au premier relevé (état déjà en cours).
//
//  État : { phase: 'approaching' | 'running' | 'ended', id, variant, left,
//  bigGoal, level, percent (0 à 1), endsAt (ms), flash, seq, pushedAt }.
//  L'approche et son train ont le même id, stable d'un niveau à l'autre.
// ═══════════════════════════════════════════════════════════════════════════

import { gql } from '../api.js'

const QUERY = `query($l: String!) { user(login: $l) { channel { hypeTrain {
  approaching { id goal participants expiresAt eventsRemaining { events secondsRemaining } isGoldenKappaTrain isTreasureTrain }
  execution { id expiresAt endedAt isGoldenKappaTrain isTreasureTrain progress { goal progression total remainingSeconds level { value goal } } }
} } } }`

/** Durées des messages courts, proches de celles de Twitch : les pastilles
 *  pleines (KICKOFF 1,5 s), la carte « parti » (STARTING 13 s), le niveau
 *  terminé, la fin. */
const KICKOFF_MS = 1500
const DEPARTED_MS = 11_500
const LEVEL_DONE_MS = 4000
const ENDED_MS = 15_000
/** Échéance dépassée depuis plus longtemps (relectures ratées) : la carte
 *  disparaît, l'état reste pour la prochaine lecture réussie. */
const STALE_MS = 60_000

/** `hypeTrain` de la chaîne ({ approaching, execution }), `null` si la
 *  chaîne n'existe pas. Une lecture ratée lève : elle ne change rien. Bornée
 *  à 10 s : une requête pendue ne doit pas arrêter la relecture. */
export async function fetchHypeTrain(login) {
  let timer
  const data = await Promise.race([
    gql(QUERY, { l: login }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 10_000) }),
  ]).finally(() => clearTimeout(timer))
  if (!data) throw new Error('gql')
  return data.user?.channel?.hypeTrain ?? null
}

const clamp = (x) => Math.max(0, Math.min(1, x))

/** Secondes restantes → échéance : insensible à l'heure de l'appareil et aux
 *  dates à 8 ou 9 décimales. */
function secondsFrom(now, s) {
  const n = Number(s)
  return s != null && Number.isFinite(n) && n >= 0 ? now + n * 1000 : null
}

/** Date ISO (fraction ramenée aux millisecondes, que tous les navigateurs
 *  lisent) ou nombre de millisecondes depuis 1970. */
function dateMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(t) ? t : null
}

function variantOf(o) {
  const type = String(o?.hypeTrainType ?? o?.hype_train_type ?? '').toLowerCase()
  if (o?.isGoldenKappaTrain || o?.is_golden_kappa_train || type.includes('golden')) return 'golden'
  if (o?.isTreasureTrain || o?.is_treasure_train || type.includes('treasure')) return 'treasure'
  return 'regular'
}

/** Train en cours d'après une exécution au format GQL (camelCase : lecture
 *  GQL, messages start et level-up d'Hermes). `null` s'il est fini. */
function running(exec, now, { remaining, progress, fallbackEnd } = {}) {
  if (!exec?.id || exec.endedAt) return null
  const p = exec.progress ?? progress ?? {}
  const level = Math.max(1, Number(p.level?.value) || 1)
  const goal = Number(p.goal)
  let prog = Number(p.progression ?? p.value)
  // Sans progression du niveau, elle se déduit du total cumulé.
  if (!Number.isFinite(prog)) prog = Number(p.total) - (Number(p.level?.goal) - goal)
  const endsAt = secondsFrom(now, remaining ?? p.remainingSeconds ?? p.remaining_seconds)
    ?? dateMs(exec.expiresAt) ?? dateMs(fallbackEnd)
  if (!endsAt || endsAt <= now) return null
  return {
    phase: 'running',
    id: String(exec.id),
    variant: variantOf(exec),
    level,
    percent: goal > 0 && Number.isFinite(prog) ? clamp(prog / goal) : 0,
    endsAt,
  }
}

/** Approche : soutiens qui manquent (`left`), 3 pastilles au lieu de 2 au-delà
 *  de 5 soutiens (`bigGoal`), échéance. `null` si elle est passée. */
function approaching(a, now) {
  if (!a?.id) return null
  const goal = Number(a.goal) || 0
  const bigGoal = goal > 5
  const rem = (Array.isArray(a.eventsRemaining) ? a.eventsRemaining : [])
    .filter((e) => Number(e?.events) > 0)
  const left = rem.length
    ? Math.min(...rem.map((e) => Number(e.events)))
    : Math.max(1, goal - (Array.isArray(a.participants) ? a.participants.length : 0))
  const entry = rem.find((e) => Number(e.events) === (bigGoal ? 2 : 1)) ?? rem.find((e) => Number(e.events) === left)
  const endsAt = secondsFrom(now, entry?.secondsRemaining) ?? dateMs(a.expiresAt)
  if (!endsAt || endsAt <= now) return null
  return { phase: 'approaching', id: String(a.id), variant: variantOf(a), left, bigGoal, level: 0, percent: 0, endsAt }
}

/** État tiré d'une lecture GQL, sans transition (voir mergeHype). */
export function hypeFromGQL(ht, now = Date.now()) {
  if (!ht) return null
  // Un train en cours passe avant l'approche, comme chez Twitch.
  return running(ht.execution, now) ?? approaching(ht.approaching, now)
}

function ended(prev, now) {
  return { phase: 'ended', id: prev.id, variant: prev.variant, level: prev.level, percent: prev.percent, until: now + ENDED_MS }
}

/** Passe de l'état précédent au nouveau en appliquant les transitions de
 *  Twitch. `first` : premier relevé de la chaîne, rien n'est annoncé. */
export function mergeHype(prev, next, now = Date.now(), first = false) {
  if (!next) {
    if (prev?.phase === 'ended') return prev.until > now ? prev : null
    if (prev?.phase === 'running' && !first) {
      // Hermes vient d'en parler : une lecture GQL en retard ne l'efface pas.
      if (prev.pushedAt && now - prev.pushedAt < 10_000) return prev
      // Disparu à son échéance après le niveau 1 : fin réussie (tous les cas
      // observés ; GQL ne dit jamais la cause). Avant l'échéance (fin du live,
      // chaîne changée) ou au niveau 1 (expiré) : rien, comme Twitch.
      if (now >= prev.endsAt - 3000 && now < prev.endsAt + STALE_MS && prev.level >= 2) return ended(prev, now)
    }
    return null
  }
  if (next.phase === 'approaching') {
    // Lecture en retard sur Hermes : l'approche d'un train déjà parti ou fini.
    if (prev && prev.phase !== 'approaching' && prev.id === next.id) return prev
    return next
  }
  // Fin déjà annoncée par Hermes, lecture GQL encore en retard.
  if (prev?.phase === 'ended' && prev.id === next.id) return prev
  if (prev?.phase === 'running' && prev.id === next.id) {
    // Lecture en retard sur Hermes : on garde le niveau le plus haut, et la
    // barre qu'Hermes vient de donner (la lecture GQL peut la faire reculer).
    if (next.level < prev.level) return prev
    if (!next.pushedAt && prev.pushedAt && now - prev.pushedAt < 10_000 && next.level === prev.level) return prev
    const out = { ...next, bigGoal: prev.bigGoal, seq: next.seq ?? prev.seq, pushedAt: next.pushedAt ?? prev.pushedAt }
    if (next.level > prev.level) out.flash = { kind: 'levelDone', n: prev.level, until: now + LEVEL_DONE_MS }
    else if (prev.flash && prev.flash.until > now) out.flash = prev.flash
    return out
  }
  if (first) return next
  // Départ : après son approche (la dernière pastille se remplit), ou
  // directement (6 départs sur 9 observés), comme STARTING chez Twitch.
  const fromApproach = prev?.phase === 'approaching' && prev.id === next.id
  const kickoff = fromApproach ? KICKOFF_MS : 0
  return {
    ...next,
    bigGoal: fromApproach ? prev.bigGoal : false,
    flash: { kind: 'departed', kickoffUntil: now + kickoff, until: now + kickoff + DEPARTED_MS },
  }
}

/** Message Hermes du sujet `hype-train-events-v2` → nouvel état, ou
 *  `undefined` s'il ne change rien (type inconnu, autre train, message en
 *  retard). Formats : approaching et progression en snake_case, start et
 *  `level-up.hype_train` au format GQL ; `time_to_expire` et `ended_at` sont
 *  des dates en millisecondes. */
export function hypeFromHermes(msg, prev, now = Date.now()) {
  const d = msg?.data
  if (!d || typeof d !== 'object') return undefined
  switch (msg.type) {
    case 'hype-train-approaching': {
      // Un train déjà en route ne recule pas à l'approche.
      if (prev?.phase === 'running' && prev.endsAt > now) return undefined
      const durations = d.events_remaining_durations && typeof d.events_remaining_durations === 'object' ? d.events_remaining_durations : {}
      const next = approaching({
        id: d.approaching_hype_train_id,
        goal: d.goal,
        participants: d.participants,
        expiresAt: d.expires_at,
        eventsRemaining: Object.entries(durations).map(([events, secondsRemaining]) => ({ events: Number(events), secondsRemaining })),
        is_golden_kappa_train: d.is_golden_kappa_train,
        is_treasure_train: d.is_treasure_train,
        hype_train_type: d.hype_train_type,
      }, now)
      return next ? mergeHype(prev, next, now) : undefined
    }
    case 'hype-train-start': {
      const next = running(d, now)
      return next ? mergeHype(prev, { ...next, pushedAt: now }, now) : undefined
    }
    case 'hype-train-level-up': {
      const next = running(d.hype_train, now, { remaining: d.progress?.remaining_seconds, progress: d.progress, fallbackEnd: d.time_to_expire })
      return next ? mergeHype(prev, { ...next, pushedAt: now }, now) : undefined
    }
    case 'hype-train-progression': {
      // Seulement le train affiché, et dans l'ordre (sequence_id croissant).
      if (prev?.phase !== 'running' || String(d.id ?? '') !== prev.id) return undefined
      const seq = Number(d.sequence_id)
      if (Number.isFinite(seq) && prev.seq != null && seq <= prev.seq) return undefined
      const p = d.progress ?? {}
      const goal = Number(p.goal)
      const value = Number(p.value)
      const next = {
        ...prev,
        level: Math.max(1, Number(p.level?.value) || prev.level),
        percent: goal > 0 && Number.isFinite(value) ? clamp(value / goal) : prev.percent,
        endsAt: secondsFrom(now, p.remaining_seconds) ?? dateMs(d.expires_at) ?? prev.endsAt,
        seq: Number.isFinite(seq) ? seq : prev.seq,
        pushedAt: now,
      }
      delete next.flash
      return mergeHype(prev, next, now)
    }
    case 'hype-train-end': {
      if (!prev || prev.phase !== 'running' || String(d.id ?? '') !== prev.id) return undefined
      // Twitch ne montre la fin que d'un train réussi ; expiré, il disparaît.
      return d.ending_reason === 'COMPLETED' ? ended(prev, now) : null
    }
    default:
      return undefined
  }
}

/** Ce qu'il faut afficher maintenant : 'approaching', 'kickoff' (pastilles
 *  pleines), 'departed', 'running', 'levelDone', 'ended', ou null. */
export function hypeView(s, now = Date.now()) {
  if (!s) return null
  if (s.phase === 'ended') return s.until > now ? 'ended' : null
  // Approche échue : elle disparaît (Twitch n'envoie rien quand elle expire),
  // le temps que la relecture de l'échéance dise si le train est parti.
  if (s.phase === 'approaching' && now > s.endsAt + 2000) return null
  if (now > s.endsAt + STALE_MS) return null
  const f = s.flash && s.flash.until > now ? s.flash : null
  if (f?.kind === 'departed') return now < f.kickoffUntil ? 'kickoff' : 'departed'
  if (f?.kind === 'levelDone') return 'levelDone'
  return s.phase
}
