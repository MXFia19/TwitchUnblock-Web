// ═══════════════════════════════════════════════════════════════════════════
//  Relais vidéo trop lent pour une VOD : la détection, sans réseau ni
//  navigateur (tools/slow-relay-check.mjs la vérifie).
//
//  Chaque segment d'une VOD passe par le relais principal (le CDN des VODs
//  n'envoie pas d'en-tête CORS, voir api.js). Son VPS plafonne vers
//  50 Mb/s : saturé, il répond toujours — /health passe, le secours « relais
//  en panne » ne part pas — mais ne débite plus (0,7 Mb/s le 18/11 sur un
//  segment 1080p60 de 9,4 Mo). Le lecteur (player.js) donne ici chaque
//  segment chargé ; deux de suite plus lents que leur durée, et c'est noté
//  une fois au journal (main.js, slowRelay). Du 18 au 19/11, la VOD passait
//  alors par le relais de Sofia ; son forfait ne le permet pas (api.js,
//  « Relais de Sofia »). Seulement une VOD, seulement le relais principal :
//  les segments d'un direct ne passent pas par lui.
// ═══════════════════════════════════════════════════════════════════════════

/** Un segment est lent quand son chargement dure plus de SLOW_RATIO fois sa
 *  durée. 1,0 : au-delà, le relais livre moins d'une seconde de vidéo par
 *  seconde et le tampon se vide — la lecture calera tant que ça dure. Pas
 *  plus bas : un segment chargé en 0,9 fois sa durée ne fait pas caler, et
 *  hls.js choisit en « Auto » des qualités qui se chargent près de cette
 *  limite (on noterait sans raison). Pas plus haut : à 1,2, la vidéo cale
 *  déjà. */
export const SLOW_RATIO = 1
/** Segments lents de suite avant de le noter. Un seul peut venir d'un accroc
 *  (Wi-Fi, segment froid servi d'abord au relais par le CDN) ; deux de
 *  suite, c'est de 4 à 20 s de vidéo (segments de 2 à 10 s) arrivées plus
 *  lentement qu'elles ne se lisent. */
export const SLOW_STREAK = 2
/** Segment trop court pour juger (dernier bout d'une VOD, segment
 *  d'initialisation du fMP4, de durée nulle) : l'attente de la réponse y
 *  pèse plus que le débit. Ni compté ni remis à zéro. */
export const MIN_SEGMENT_S = 1

/** Lent : chargé en plus de `ratio` fois sa durée. */
export const isSlowSegment = (loadMs, durationS, ratio = SLOW_RATIO) => loadMs > durationS * 1000 * ratio

/** Mesure d'un segment chargé, d'après l'objet `frag` de hls.js
 *  (Hls.Events.FRAG_LOADED : frag.stats est celui de son chargeur) :
 *  { loadMs, durationS, bytes } ; null sans temps de chargement ou sans
 *  durée. */
export function fragTiming(frag) {
  const loading = frag?.stats?.loading
  const loadMs = (Number(loading?.end) || 0) - (Number(loading?.start) || 0)
  const durationS = Number(frag?.duration) || 0
  if (!(loadMs > 0) || !(durationS > 0)) return null
  return { loadMs, durationS, bytes: Number(frag.stats.loaded || frag.stats.total) || 0 }
}

/** Ce que disent des segments lents : nombre, temps de chargement (ms),
 *  durée (s), octets, débit (Mb/s, 0 si inconnu), rapport chargement/durée,
 *  et ce rapport pour chacun. */
export function slowMeasure(run) {
  const loadMs = run.reduce((n, r) => n + r.loadMs, 0)
  const durationS = run.reduce((n, r) => n + r.durationS, 0)
  const bytes = run.reduce((n, r) => n + (r.bytes || 0), 0)
  return {
    segments: run.length,
    loadMs,
    durationS,
    bytes,
    mbps: bytes > 0 && loadMs > 0 ? (bytes * 8) / (loadMs / 1000) / 1e6 : 0,
    ratio: loadMs / (durationS * 1000),
    each: run.map((r) => r.loadMs / (r.durationS * 1000)),
  }
}

/** Ligne du journal des erreurs (errlog.js) : la mesure, puis ce qui en est
 *  fait (`then`). Aucune adresse : celles des segments peuvent porter un
 *  jeton. */
export function slowRelayLine(m, then) {
  const n = m.segments
  const size = m.bytes > 0 ? `${(m.bytes / 1e6).toFixed(1)} Mo en ` : ''
  const rate = m.mbps > 0 ? `${m.mbps.toFixed(1)} Mb/s, ` : ''
  return `relais lent (VOD) : ${n} segment${n > 1 ? 's' : ''} de suite plus lent${n > 1 ? 's' : ''} que leur durée, `
    + `${size}${(m.loadMs / 1000).toFixed(1)} s pour ${m.durationS.toFixed(1)} s de vidéo (${rate}×${m.each.map((r) => r.toFixed(1)).join(' ×')})`
    + (then ? ` ; ${then}` : '')
}

/**
 * Guet d'une lecture (une instance de hls.js) : note() pour chaque segment
 * chargé. Rend la mesure (slowMeasure) quand SLOW_STREAK segments de suite,
 * servis par le relais principal pendant une VOD, ont été plus lents que leur
 * durée — le compte repart alors de zéro —, sinon null. Un segment rapide, un
 * segment venu d'ailleurs (Sofia, un Worker) ou une vidéo qui n'est pas une
 * VOD remettent le compte à zéro.
 */
export class SlowRelayWatch {
  constructor({ ratio = SLOW_RATIO, streak = SLOW_STREAK, minSegment = MIN_SEGMENT_S } = {}) {
    this.ratio = ratio
    this.streak = streak
    this.minSegment = minSegment
    this.run = []
  }

  /** `vod` : la vidéo est une VOD ; `relay` : segment servi par le relais
   *  principal ; `loadMs`, `durationS`, `bytes` : fragTiming. */
  note({ vod = false, relay = false, loadMs = 0, durationS = 0, bytes = 0 } = {}) {
    if (!vod || !relay) { this.run = []; return null }
    if (!(durationS >= this.minSegment) || !(loadMs > 0)) return null
    if (!isSlowSegment(loadMs, durationS, this.ratio)) { this.run = []; return null }
    this.run.push({ loadMs, durationS, bytes })
    if (this.run.length < this.streak) return null
    const m = slowMeasure(this.run)
    this.run = []
    return m
  }
}
