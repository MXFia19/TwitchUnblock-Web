// ═══════════════════════════════════════════════════════════════════════════
//  Lecteur vidéo maison.
//
//  Remplace Plyr. Celui-ci posait ses propres commandes et son propre plein
//  écran par-dessus la vidéo : impossible d'y loger le chat proprement, et
//  sur iPhone son plein écran basculait sur le lecteur natif d'Apple, chat
//  perdu. Ici les commandes sont les nôtres, le plein écran englobe la vidéo
//  ET le chat, et la logique reprend celle du lecteur immersif de l'app.
// ═══════════════════════════════════════════════════════════════════════════

import { lang, t } from './i18n.js'
import { API_URL, RELAY_BASE, WORKER_BASES, fixProxiedUrl, liveSourceOrder, proxyBaseOf } from './api.js'
import { $, esc, formatClock, icon, isIOS } from './util.js'
import { logError } from './errlog.js'
import { isHqUrl } from './hq.js'

// Mêmes vitesses que dans l'app. Pas au-delà de 2× : Twitch ne publie pas
// de playlist I-frame, et le débit double déjà à 2×.
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const HIDE_AFTER = 2800
// Empreinte du fichier attendu (identique sur les deux CDN) : un CDN
// compromis ne peut pas substituer son propre script.
// hls.js 1.5.20, la dernière de la série 1.5 (même interface que la 1.5.17
// d'avant) : depuis la 1.5.18, un arrêt demandé par ManagedMediaSource
// (« endstreaming ») suspend seulement le chargement des segments — la 1.5.17
// arrêtait tout (requête abandonnée, démultiplexeur détruit puis recréé).
const HLS_INTEGRITY = 'sha384-V5ruNBgmYcC3SJRUQeNykAAAgde5gOFq/Hu0CZj7bygDP0yRIhkvX8+w0u/7mRvr'
const HLS_SOURCES = [
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js',
]

// ── Segments par le relais du Worker (secours) ──────────────────────────
// Les segments d'un direct partent normalement en direct vers le CDN de
// Twitch (moins de requêtes sur le Worker). Chez certains (Firefox avec la
// protection renforcée, extensions, réseaux filtrés), ces requêtes
// n'aboutissent jamais : on bascule alors sur le relais, et on s'en souvient
// une semaine sur cet appareil.
// Un seul raté suffisait (Wi-Fi qui décroche, mise en veille…) : l'appareil
// passait ensuite une semaine sur le relais alors que le CDN répondait. Il
// en faut maintenant trois de suite, appareil en ligne, sans un segment reçu
// entre deux. Et sur le relais, le CDN est retenté en douce (une requête
// HEAD, toutes les 10 min au plus) : s'il répond, retour au direct.
const SEG_PROXY_KEY = 'tu_segment_proxy'
const SEG_PROXY_DAYS = 7
const SEG_PROXY_FAILS = 3
const SEG_RECHECK_MS = 10 * 60 * 1000
/** Segments des directs par le relais sur cet appareil (CDN bloqué) ? Les
 *  qualités supérieures ne s'y lancent pas (main.js) : leurs segments ne
 *  passent jamais par nos serveurs. */
export function segmentProxyOn() {
  try { return Number(localStorage.getItem(SEG_PROXY_KEY) || 0) > Date.now() } catch { return false }
}
function enableSegmentProxy() {
  try { localStorage.setItem(SEG_PROXY_KEY, String(Date.now() + SEG_PROXY_DAYS * 86400000)) } catch {}
}
let directRecheckAt = 0
/** Sur le relais : le CDN répond-il de nouveau ? HEAD sur le segment demandé
 *  (requête simple : pas de contrôle préalable CORS, rien de téléchargé). */
function recheckDirect(url) {
  if (Date.now() - directRecheckAt < SEG_RECHECK_MS) return
  directRecheckAt = Date.now()
  fetch(url, { method: 'HEAD', cache: 'no-store' }).then((r) => {
    if (!r.ok) return
    try { localStorage.removeItem(SEG_PROXY_KEY) } catch {}
    console.info('[TwitchUnblock] Le CDN de Twitch répond : segments de nouveau en direct.')
  }).catch(() => {})
}
/** Segment de direct servi en direct par le CDN (pas déjà relayé). */
function isDirectSegment(u) {
  try {
    const h = new URL(u).hostname
    return !WORKER_BASES.some((b) => new URL(b).hostname === h) && /(^|\.)(ttvnw\.net|twitchcdn\.net)$/.test(h) && !/(^|\.)playlist\.ttvnw\.net$/.test(h)
  } catch { return false }
}

/** Segment de direct jamais arrivé du CDN (code 0 : bloqué avant
 *  d'atteindre Twitch), appareil en ligne : au troisième de suite (compté
 *  dans `counter.directFails`, que FRAG_LOADED remet à zéro), les prochains
 *  passent par le relais du Worker. `true` quand la bascule vient de se
 *  faire. Sert aussi aux tuiles du multi-live, qui ne l'activaient jamais :
 *  chez qui le CDN est bloqué, toutes finissaient « Hors ligne ». */
export function noteDirectSegmentError(Hls, data, counter) {
  if (segmentProxyOn() || data.type !== Hls.ErrorTypes.NETWORK_ERROR || !/^frag/i.test(data.details || '')
      || data.response?.code || !isDirectSegment(data.frag?.url || data.url || '') || navigator.onLine === false) return false
  counter.directFails = (counter.directFails || 0) + 1
  if (counter.directFails < SEG_PROXY_FAILS) return false
  counter.directFails = 0
  enableSegmentProxy()
  console.info('[TwitchUnblock] Segments directs bloqués : passage par le relais.')
  return true
}

/** Erreur réseau de hls.js due au relais ou au Worker qui sert la vidéo :
 *  son adresse, sinon null. Worker : seulement une requête restée sans
 *  réponse (code 0 — quota du jour atteint : la page d'erreur de Cloudflare
 *  n'a pas d'en-tête CORS). Relais du VPS : aussi un refus (403, 429 :
 *  Twitch peut limiter son adresse IP) ou une panne (5xx) — mais plus un
 *  segment ou une playlist introuvable (404, 410 : direct fini, segment
 *  purgé), qui l'écartait 30 min pour toutes les vidéos alors qu'un autre
 *  relais ne le trouverait pas davantage. Sert aussi aux tuiles du
 *  multi-live. */
export function failedProxy(data) {
  const base = proxyBaseOf(data?.frag?.url || data?.context?.url || data?.url || '')
  if (!base) return null
  const code = data.response?.code || 0
  if (!code) return base
  return base === RELAY_BASE && (code === 403 || code === 429 || code >= 500) ? base : null
}

/** Adresse à demander pour une requête de lecture : adresses relatives du
 *  proxy corrigées, et segments par le relais si le direct n'aboutit pas.
 *  Sert aussi aux tuiles du multi-live. */
export function liveRequestUrl(reqUrl, playlistUrl) {
  let fixed = fixProxiedUrl(reqUrl, playlistUrl)
  // Le relais qui a servi ces liens : celui du VPS, le Worker principal, ou
  // un secours si le quota du principal est atteint.
  if (segmentProxyOn() && isDirectSegment(fixed)) {
    recheckDirect(fixed)
    fixed = `${proxyBaseOf(playlistUrl) ?? API_URL}/api/proxy?url=${encodeURIComponent(fixed)}&isVod=false`
  }
  return fixed
}

// ── Son des passages coupés ─────────────────────────────────────────────
// Twitch coupe le son des passages avec de la musique protégée : la playlist
// pointe alors vers « N-muted.ts » (« N-muted.mp4 » pour les VODs en fMP4).
// Un jour ou deux après la diffusion, l'original « N.ts », avec le son, est
// pourtant encore servi par le CDN.
// Ce chargeur le demande d'abord et ne retombe sur la version muette que
// s'il est refusé. Après trois refus sans un seul succès dans une qualité
// (VOD trop ancienne : originaux effacés), il n'essaie plus dans celle-là —
// le CDN garde parfois l'original en « source » mais plus en 160p.
function unmuteLoader(Hls, player) {
  const Base = Hls.DefaultConfig.loader
  return class UnmuteLoader extends Base {
    constructor(config) {
      super(config)
      this.hlsConfig = config
    }

    load(context, config, callbacks) {
      const all = player.unmute
      const level = context.frag?.level ?? -1
      const u = all ? (all[level] ??= { ok: 0, fails: 0, off: false }) : null
      if (!u || u.off || !/-muted\.(ts|mp4)/.test(context.url)) return super.load(context, config, callbacks)
      const inner = new Base(this.hlsConfig)
      this.inner = inner
      const fallback = () => {
        inner.destroy()
        this.inner = null
        if (++u.fails >= 3 && !u.ok) u.off = true
        super.load(context, config, callbacks)
      }
      inner.load({ ...context, url: context.url.replace(/-muted\.(ts|mp4)/, '.$1') }, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, details) => {
          // Mesures de débit du segment réellement chargé : hls.js les lit
          // sur ce chargeur-ci.
          Object.assign(this.stats, stats)
          u.ok++
          player.markUnmuted(context.frag)
          callbacks.onSuccess(response, this.stats, context, details)
        },
        onError: () => fallback(),
        onTimeout: () => fallback(),
      })
    }

    abort() { this.inner?.abort(); super.abort() }
    destroy() { this.inner?.destroy(); this.inner = null; super.destroy() }
  }
}

// ── Direct au plus près ─────────────────────────────────────────────────
// Twitch ajoute à chaque playlist de direct les deux prochains segments
// (« EXT-X-TWITCH-PREFETCH ») : celui qui est en train d'être produit et le
// suivant. Son lecteur s'en sert ; hls.js ne les connaît pas, et n'apprenait
// l'existence d'un segment qu'à la relecture suivante de la liste. Changés en
// segments ordinaires, ils sont demandés aussitôt : la réponse arrive dès que
// le segment est fini. On peut alors se tenir juste derrière le dernier
// segment complet (LIVE_BEHIND_COMPLETE) au lieu de 4 s (LIVE_BEHIND_PLAIN).
// Seulement pour une qualité fixe : en « Auto », ces segments arrivent au
// rythme de l'encodeur, et hls.js en concluait que la connexion ne valait
// que le débit de la qualité jouée — il descendait palier par palier jusqu'en
// 360p sans jamais remonter (essai du 14/10, caedrel : 1080p → 360p en 74 s).
// En « Auto », les 4 s ne s'appliquent pas telles quelles : hls.js ne vise
// jamais plus près que bord − durée cible déclarée (6 s chez Twitch, borne de
// liveSyncPosition). Le retard affiché y tourne autour de 6 à 7 s : la marge
// d'un segment, qui évite les calages.
const LIVE_BEHIND_COMPLETE = 2.5
const LIVE_BEHIND_PLAIN = 4
const PREFETCH_TAG = '#EXT-X-TWITCH-PREFETCH:'
// Plancher : le retard affiché (heure − horodatage de l'image, liveDelay) ne
// passe jamais sous 4 s — en dessous, la lecture cale (retour
// d'utilisateurs). Ce retard, c'est notre distance au dernier segment
// complet plus le délai de Twitch avant de publier un segment, qui change
// d'une chaîne à l'autre : la cible de hls.js est relevée d'autant
// (holdLiveFloor), et un passage sous le seuil recule (une fois par minute
// au plus).
const MIN_LIVE_DELAY = 4
// Rattrapage du direct : jamais en changeant la vitesse — hls.js passait à
// ×1,05-×1,1 plusieurs fois par minute, et le son finissait décalé de
// l'image jusqu'au prochain saut (+10 s ou Direct, retours du 14/10). On
// saute à la place : une fois au démarrage s'il a été lent (dans ce qui est
// déjà chargé), puis seulement si le retard dépasse la cible de LIVE_DRIFT
// pendant LIVE_DRIFT_MS, une fois toutes les LIVE_JUMP_GAP_MS au plus, et
// jamais après un recul voulu (−10 s : holdingBehind).
const LIVE_REALIGN = 2
const LIVE_REALIGN_MS = 10_000
const LIVE_DRIFT = 5
const LIVE_DRIFT_MS = 4000
const LIVE_JUMP_GAP_MS = 30_000
const LIVE_FLOOR_SEEK_MS = 60_000

// ── Erreurs réseau fatales ──────────────────────────────────────────────
// hls.js ne réessaie pas un 4xx : relancer aussitôt redemandait la même
// adresse plusieurs fois par seconde, sans fin (direct terminé, segment
// purgé), sur le quota du Worker. Trois relances espacées (2, 4 puis 8 s),
// remises à zéro dès qu'un segment arrive, puis l'erreur. Une VOD saute un
// segment introuvable (404) au lieu de le redemander — au plus
// MAX_SKIPPED_FRAGS de suite — et s'arrête là si ce sont ses derniers
// (quand la lecture y arrive ; un saut dedans retombe sur l'erreur).
const NET_RETRIES = 3
const MAX_SKIPPED_FRAGS = 30

// ── Erreurs fatales et image figée ──────────────────────────────────────
// Erreur média fatale (tampon refusé, image illisible) : réparée d'abord
// sur place (recoverMediaError). Revenue moins de MEDIA_FIX_MS après — la
// réparation tournait alors en boucle, image figée —, ou erreur d'un autre
// type (démultiplexage, exception interne : c'était aussitôt « lecture
// arrêtée »), l'instance de hls.js est détruite et une nouvelle repart de la
// même adresse (rebuild). De même pour un direct calé depuis
// STALL_REBUILD_MS sans aucune erreur alors que sa playlist avance encore
// (sinon, c'est la chaîne qui s'est arrêtée : voir LIVE_HALT_MS). Au plus
// MAX_REBUILDS fois en REBUILD_WINDOW_MS, puis l'erreur.
const MEDIA_FIX_MS = 30_000
const STALL_REBUILD_MS = 30_000
const MAX_REBUILDS = 3
const REBUILD_WINDOW_MS = 5 * 60_000

/** Erreur média fatale : se répare-t-elle encore sur place ? Non si la
 *  dernière réparation de `state` (le lecteur, une tuile du multi-live) a
 *  moins de MEDIA_FIX_MS. L'essai est noté. */
export function mediaFixAllowed(state) {
  const now = Date.now()
  if (now - (state.mediaFixAt || 0) < MEDIA_FIX_MS) return false
  state.mediaFixAt = now
  return true
}

/** Réparation sur place (recoverMediaError) : hls.js détache puis rattache
 *  la vidéo. Elle s'y retrouvait en pause — sans événement « pause », l'image
 *  restait figée — et une VOD repartait de la position de départ de sa
 *  configuration (le début, ou le lien ?t=) : elle reprend à `at` (VOD ;
 *  -1, un direct, repart d'où il en était), et la lecture en cours continue. */
export function recoverMedia(hls, video, at = -1) {
  const playing = !video.paused
  if (at >= 0) hls.config.startPosition = at
  hls.recoverMediaError()
  if (playing) video.play().catch(() => {})
}

// ── Coupure côté chaîne ─────────────────────────────────────────────────
// Encodeur du streamer figé ou en reconnexion : Twitch ne publie plus de
// segments, sans annoncer la fin du direct, et hls.js relit toutes les 3 s
// la même playlist. L'image cale au bout de ce qui est chargé ; une
// nouvelle instance (rebuild) ne faisait que rejouer la même fin — trois
// relances, puis l'erreur au bout de 2 min environ, là où le direct allait
// reprendre. Le guet du calage regarde donc la playlist (noteLivePlaylist) :
// relue il y a moins de LIVE_HALT_MS, mais sans rien de nouveau depuis au
// moins autant, ou terminée (EXT-X-ENDLIST), c'est la chaîne qui s'est
// arrêtée (liveHalted). Le lecteur attend sous la roue : la lecture repart
// d'elle-même avec les prochains segments, et la fin du direct vient de
// Twitch (liveEnded, main.js). Image figée sous une playlist qui avance
// (un segment toutes les 2 s), ou playlist plus relue du tout (hls.js
// bloqué) : c'est le lecteur, il repart.
const LIVE_HALT_MS = 15_000

/** Playlist d'un direct relue par hls.js (LEVEL_UPDATED) : retient dans
 *  `state.livePlaylist` l'heure de cette lecture et celle où elle a avancé
 *  pour la dernière fois — premier segment (EXT-X-MEDIA-SEQUENCE) changé,
 *  segment de plus à la fin, ou autre qualité (« Auto ») —, et la dernière
 *  coupure de la chaîne finie (`halt`, voir liveStallWait). `true` si elle
 *  a avancé. */
export function noteLivePlaylist(state, data, now = Date.now()) {
  const d = data?.details
  if (!d) return false
  const prev = state.livePlaylist
  const moved = !prev || data.level !== prev.level || d.startSN !== prev.startSN || d.endSN > prev.endSN
  state.livePlaylist = {
    level: data.level,
    startSN: d.startSN,
    // Le plus loin vu : des segments annoncés d'avance (withPrefetch) qui
    // disparaissent puis reviennent ne sont pas nouveaux.
    endSN: moved ? d.endSN : Math.max(prev.endSN, d.endSN),
    readAt: now,
    movedAt: moved ? now : prev.movedAt,
    // Avancée qui met fin à une coupure (liveHalted, lu avant cette mise à
    // jour) : la chaîne s'était arrêtée à sa dernière avancée.
    halt: moved && liveHalted(state, now) ? { from: prev.movedAt, to: now } : prev?.halt,
    ended: d.live === false,
  }
  return moved
}

/** Direct calé : la chaîne a-t-elle cessé d'envoyer des segments (voir
 *  LIVE_HALT_MS) ? */
export function liveHalted(state, now = Date.now()) {
  const p = state.livePlaylist
  if (!p) return false
  return p.ended || (now - p.readAt < LIVE_HALT_MS && now - p.movedAt >= LIVE_HALT_MS)
}

/** Direct calé depuis `state.stalledAt` : temps pendant lequel la chaîne,
 *  elle, a continué d'avancer (ms) — l'attente, moins la coupure en cours
 *  (liveHalted, comptée depuis la dernière avancée) et la dernière finie
 *  (`livePlaylist.halt`). Pendant une coupure, plus rien n'est filmé : le
 *  retard sur le direct ne grandit pas (chatDelay). */
export function liveStallWait(state, now = Date.now()) {
  const since = state.stalledAt
  const p = state.livePlaylist
  let wait = now - since
  if (p?.halt) wait -= Math.max(0, p.halt.to - Math.max(since, p.halt.from))
  if (liveHalted(state, now)) wait -= now - Math.max(since, p.movedAt)
  return Math.max(0, wait)
}

// ── Mémoire tampon de hls.js ────────────────────────────────────────────
// Par défaut, hls.js garde derrière la lecture tout ce qu'il a chargé
// (backBufferLength infini) et charge d'avance jusqu'à 60 Mo (maxBufferSize),
// sur 600 s au plus (maxMaxBufferLength). Le lecteur gardait 90 s derrière
// lui, direct compris : sur iPad (Safari 26, ManagedMediaSource), un direct
// en 1080p faisait planter la page toutes les 20 min environ — mémoire
// épuisée, selon toute vraisemblance — et ne repartait qu'après avoir fermé
// Safari (retour du 20/10). En direct, Twitch ne garde que 28 s (14 segments
// de 2 s) : on ne peut pas reculer plus loin, rien ne sert d'en garder plus.
// Sur iPad et iPhone, tout est plus court encore ; les tuiles du multi-live
// (`tile`) ont leurs propres bornes. Les métadonnées des segments et de la
// playlist (ID3, emsg, DATERANGE) ne deviennent plus des repères de piste de
// texte que rien ne lit : les pauses pub sont lues dans la playlist
// (readAdBreaks).
//
// VOD et direct : tampon tenu par hls.js (MediaSource) partout où le
// navigateur l'a, Safari sur Mac et iPad compris, et plus par Safari
// lui-même (ManagedMediaSource, « MMS ») : celui-ci demande d'arrêter de
// charger à 30 s d'avance (« endstreaming ») et de reprendre sous 10 s
// (« startstreaming »), et hls.js 1.5.17 arrêtait alors tout (stopLoad) —
// requête en cours abandonnée, démultiplexeur détruit puis recréé, guet des
// trous et des calages suspendu —, toutes les 20 s environ d'une VOD (une
// longue VOD finissait par saccader dans Safari sur Mac, retour du 22/10).
// Et Safari 27 n'envoie plus « startstreaming » après un saut (WebKit
// 321919) : la VOD restait figée. hls.js préfère d'ailleurs MediaSource
// depuis sa 1.6.19. Les directs y passent aussi : sur iPad, un long direct
// en MMS faisait toujours planter Safari au bout de quelques minutes malgré
// les tampons bornés (retour du 22/10, 2026.10.20d), au point de devoir
// quitter Safari pour qu'il reparte. L'iPhone n'a que ManagedMediaSource
// (garde-fou : guardManagedMediaSource).
const MB = 1000 * 1000
export function bufferConfig(kind, { tile = false, lean = isIOS } = {}) {
  const base = { enableID3MetadataCues: false, enableEmsgMetadataCues: false, enableDateRangeMetadataCues: false,
    preferManagedMediaSource: false }
  if (tile) return { ...base, backBufferLength: 10, maxBufferLength: 12, maxMaxBufferLength: 30, maxBufferSize: (lean ? 10 : 20) * MB }
  if (kind === 'live') {
    return lean
      ? { ...base, backBufferLength: 10, maxBufferLength: 15, maxMaxBufferLength: 30, maxBufferSize: 20 * MB }
      : { ...base, backBufferLength: 30, maxBufferLength: 30, maxMaxBufferLength: 60 }
  }
  return lean
    ? { ...base, backBufferLength: 20, maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 30 * MB }
    : { ...base, backBufferLength: 90, maxBufferLength: 30, maxMaxBufferLength: 120 }
}

/** hls.js (1.5) prend-il ManagedMediaSource avec cette configuration ? Oui
 *  s'il le préfère et que le navigateur l'a, ou s'il n'y a que lui : avec
 *  bufferConfig (qui ne le préfère plus), seulement sur iPhone. */
export function usesManagedMediaSource(config) {
  if (typeof window === 'undefined' || !window.ManagedMediaSource) return false
  return config?.preferManagedMediaSource !== false || !window.MediaSource
}

/** ManagedMediaSource (iPhone) : à chaque « endstreaming », hls.js suspend
 *  le chargement des segments (la 1.5.17 arrêtait tout, voir plus haut) et
 *  ne le reprend qu'au « startstreaming ». Safari 27 ne l'envoie plus quand
 *  on saute hors de ce qui est chargé (WebKit 321919) : l'image restait
 *  figée. Comme hls.js 1.6.19 : pas d'arrêt pendant un saut, et un saut
 *  pendant l'arrêt fait repartir le chargement — après le « seeking » de
 *  hls.js lui-même, qui retient la position. Et comme lui, une reprise sans
 *  arrêt avant ne fait rien (la 1.5.17 relançait tout : startLoad, requête
 *  en cours abandonnée). `note(nom)` compte les arrêts (« mmsPause ») et les
 *  reprises au saut (« mmsSeek ») pour la santé de la lecture. */
export function guardManagedMediaSource(Hls, hls, video, note = () => {}) {
  const pause = hls.pauseBuffering?.bind(hls)
  const resume = hls.resumeBuffering?.bind(hls)
  if (!pause || !resume) return
  let paused = false
  let timer = 0
  hls.pauseBuffering = () => {
    if (video.seeking) return
    paused = true
    note('mmsPause')
    pause()
  }
  hls.resumeBuffering = () => {
    if (!paused) return
    paused = false
    resume()
  }
  // Vidéo rattachée (réparation sur place) : hls.js repart de lui-même
  // (startLoad), mais depuis la 1.5.18 un arrêt en cours y survit (chargement
  // des segments toujours suspendu), et la reprise de la nouvelle source
  // serait ignorée ici : on le lève.
  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    if (!paused) return
    paused = false
    resume()
  })
  const onSeeking = () => {
    if (!paused) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!paused) return
      note('mmsSeek')
      hls.resumeBuffering()
    }, 0)
  }
  video.addEventListener('seeking', onSeeking)
  hls.once(Hls.Events.DESTROYING, () => {
    clearTimeout(timer)
    video.removeEventListener('seeking', onSeeking)
  })
}

// ── Santé de la lecture (diagnostic) ────────────────────────────────────
// « Au bout d'un moment, la VOD saccade » ne laissait aucune trace : le
// journal des erreurs (errlog.js, joint aux signalements) ne gardait que les
// erreurs fatales. Chaque vidéo compte maintenant ses décrochages (lecture
// qui attend des données, hors démarrage et sauts) et leur durée, les images
// perdues (getVideoPlaybackQuality), ce que hls.js règle seul (erreurs non
// fatales : calage, trou sauté, coup de pouce, tampon plein, segment
// réessayé…), les réparations du lecteur et les arrêts de ManagedMediaSource.
// Toutes les minutes de lecture, une minute anormale (HEALTH_BAD) écrit une
// ligne au journal : 5 minutes d'écart au moins, 6 lignes par vidéo au plus,
// plus une à l'ouverture d'un signalement (flushHealth). Rien de personnel :
// ni adresse, ni chaîne, ni identifiant.
const HEALTH_WINDOW_MS = 60_000
const HEALTH_LOG_GAP_MS = 5 * 60_000
const HEALTH_LOG_MAX = 6
// Erreurs non fatales de hls.js comptées, par nom (`details`) ; les autres
// vont dans « autre ». Libellés au singulier et au pluriel.
const HLS_ISSUES = {
  bufferStalledError: ['calage', 'calages'], bufferNudgeOnStall: ['coup de pouce', 'coups de pouce'],
  bufferSeekOverHole: ['trou sauté', 'trous sautés'], bufferFullError: ['tampon plein', 'tampons pleins'],
  bufferAppendError: ['ajout refusé', 'ajouts refusés'], fragLoadError: ['segment réessayé', 'segments réessayés'],
  fragLoadTimeOut: ['segment lent', 'segments lents'], levelLoadError: ['playlist réessayée', 'playlists réessayées'],
  levelLoadTimeOut: ['playlist lente', 'playlists lentes'], otherIssue: ['autre', 'autres'],
}
// Réparations du lecteur : sur place (recoverMediaError), nouvelle instance
// (rebuild), nouvel essai après une erreur réseau (retryLoad), autre relais
// ou Worker (swapLinks), segment introuvable sauté (skipMissingFrag).
const HEALTH_FIXES = {
  recover: ['sur place', 'sur place'], rebuild: ['relance', 'relances'], retry: ['nouvel essai', 'nouveaux essais'],
  swap: ['autre relais', 'autres relais'], missing: ['segment absent', 'segments absents'],
  audio: ['son remis à neuf', 'sons remis à neuf'],
}
/** « 1 coup de pouce », « 3 trous sautés ». */
const counted = (n, [one, many]) => `${n} ${n > 1 ? many : one}`
// Minute anormale : 2 décrochages ou 3 s d'attente, 2 % d'images perdues
// (30 au moins), un trou ou un tampon plein que hls.js a dû régler, ou une
// réparation.
const HEALTH_BAD = { stalls: 2, stallMs: 3000, dropRatio: 0.02, dropMin: 30,
  issues: ['bufferNudgeOnStall', 'bufferSeekOverHole', 'bufferFullError', 'bufferAppendError'] }

/** Compteurs d'une vidéo (voir plus haut), d'une source à l'autre. */
export class PlaybackHealth {
  /** `video` : ses compteurs d'images (vidéo d'avant) servent de départ. */
  constructor(now = Date.now(), video = null) {
    this.c = {}
    this.stallFrom = 0
    // Images : cumulées, et derniers relevés du navigateur (remis à zéro à
    // chaque nouvelle source).
    const q = video?.getVideoPlaybackQuality?.()
    this.frames = { total: 0, dropped: 0, seenTotal: q?.totalVideoFrames || 0, seenDropped: q?.droppedVideoFrames || 0 }
    const start = { at: now, c: {}, total: 0, dropped: 0 }
    this.mark = start     // dernière ligne écrite (ou début)
    this.minute = start   // début de la minute examinée
    this.bad = false      // minute anormale pas encore écrite
    this.logged = 0
    this.loggedAt = 0
  }

  add(name, n = 1) { this.c[name] = (this.c[name] || 0) + n }

  /** Erreur non fatale de hls.js. */
  hlsIssue(details) { this.add(details in HLS_ISSUES ? details : 'otherIssue') }

  stallStart(now = Date.now()) {
    if (this.stallFrom) return
    this.stallFrom = now
    this.add('stalls')
  }

  stallEnd(now = Date.now()) {
    if (!this.stallFrom) return
    this.add('stallMs', Math.max(0, now - this.stallFrom))
    this.stallFrom = 0
  }

  /** Relevé des images de la vidéo. Les compteurs du navigateur repartent
   *  de zéro avec chaque source : un relevé plus bas qu'avant en est une. */
  readFrames(video) {
    const q = video?.getVideoPlaybackQuality?.()
    if (!q) return
    const f = this.frames
    const total = q.totalVideoFrames || 0
    const dropped = q.droppedVideoFrames || 0
    if (total < f.seenTotal || dropped < f.seenDropped) f.seenTotal = f.seenDropped = 0
    f.total += total - f.seenTotal
    f.dropped += dropped - f.seenDropped
    f.seenTotal = total
    f.seenDropped = dropped
  }

  /** Nouvelle source (attach) : dernier relevé de l'ancienne, puis les
   *  compteurs du navigateur repartent de zéro. */
  newSource(video, now = Date.now()) {
    this.readFrames(video)
    this.frames.seenTotal = this.frames.seenDropped = 0
    this.stallEnd(now)
  }

  /** État cumulé à `now`, décrochage en cours compris. */
  snapshot(now) {
    const c = { ...this.c }
    if (this.stallFrom) c.stallMs = (c.stallMs || 0) + Math.max(0, now - this.stallFrom)
    return { at: now, c, total: this.frames.total, dropped: this.frames.dropped }
  }

  /** Écart entre deux états. */
  static diff(from, to) {
    const c = {}
    for (const k of Object.keys(to.c)) {
      const d = to.c[k] - (from.c[k] || 0)
      if (d > 0) c[k] = d
    }
    return { ms: to.at - from.at, c, total: to.total - from.total, dropped: to.dropped - from.dropped }
  }

  static isBad(d) {
    const c = d.c
    return (c.stalls || 0) >= HEALTH_BAD.stalls || (c.stallMs || 0) >= HEALTH_BAD.stallMs
      || (d.dropped >= HEALTH_BAD.dropMin && d.dropped >= HEALTH_BAD.dropRatio * d.total)
      || HEALTH_BAD.issues.some((k) => c[k] > 0) || Object.keys(HEALTH_FIXES).some((k) => c[k] > 0)
  }

  /** Appelé pendant la lecture (timeupdate) : examine chaque minute, et rend
   *  l'écart depuis la dernière ligne quand une ligne est à écrire (sinon
   *  null). `force` (signalement) : l'écart tout de suite, sans compter
   *  parmi les lignes ni changer l'examen des minutes. */
  check(now, video, { force = false } = {}) {
    if (!force && now - this.minute.at < HEALTH_WINDOW_MS) return null
    this.readFrames(video)
    const snap = this.snapshot(now)
    if (!force) {
      if (PlaybackHealth.isBad(PlaybackHealth.diff(this.minute, snap))) this.bad = true
      this.minute = snap
      if (!this.bad || this.logged >= HEALTH_LOG_MAX || (this.loggedAt && now - this.loggedAt < HEALTH_LOG_GAP_MS)) return null
      this.logged++
      this.loggedAt = now
    }
    const d = PlaybackHealth.diff(this.mark, snap)
    this.mark = snap
    this.bad = false
    return d
  }
}

// ── Pauses pub de la chaîne ─────────────────────────────────────────────
// Pendant une pause pub (lancée par le streamer, ou pré-roll à l'ouverture),
// Twitch remplace le direct par une pub ou par son écran violet
// « Commercial break in progress », sur toutes les sources, proxys compris
// (sondes du 14/10). La playlist l'annonce par une DATERANGE de classe
// « twitch-stitched-ad » (début + durée). « twitch-maf-ad », présente dans
// toutes les séances quelques minutes après l'ouverture, est une pub dessinée
// par le lecteur de Twitch : rien ne change à l'image, elle est ignorée.
// Lue par hls.js (LEVEL_UPDATED), en qualité fixe comme en « Auto », et
// comparée à l'heure de l'image affichée (hls.playingDate) : la playlist a
// jusqu'à ~20 s d'avance sur ce qu'on voit.
const AD_CLASS = 'twitch-stitched-ad'
const AD_KEEP = 20

/** Fin (ms) de la pause pub en cours à l'instant `at` (heure de l'image), pubs
 *  enchaînées comprises (écart d'une seconde au plus) ; 0 hors pause. */
export function adBreakEnd(breaks, at) {
  const list = [...breaks]
  let end = 0
  for (const b of list) if (b.start <= at && at < b.end) end = Math.max(end, b.end)
  if (!end) return 0
  for (let grown = true; grown;) {
    grown = false
    for (const b of list) if (b.start <= end + 1000 && b.end > end) { end = b.end; grown = true }
  }
  return end
}

// ── Format du son (direct) ──────────────────────────────────────────────
// L'écran « Commercial break in progress » de Twitch n'a pas forcément le
// son de la chaîne (48 kHz contre 44,1 kHz, par exemple) : la vidéo garde le
// même tampon d'un format à l'autre, et Chrome rejouait ensuite la voix du
// streamer à la mauvaise vitesse, comme passée dans un « voice changer »
// (signalement du 25/10 sur Tumblurr, une seule chaîne). Le format de chaque
// init segment est noté (audioFormatOf) par rupture du flux (`cc` :
// EXT-X-DISCONTINUITY, autour des pauses pub ; le même d'une qualité à
// l'autre) — en TS, hls.js en fabrique un par rupture, en fMP4 c'est celui de
// l'EXT-X-MAP (sn « initSegment », vu sur mortenroyale le 26/10). Quand
// l'image passe à une autre rupture dont le son n'a pas le même format, la
// vidéo est rattachée à neuf (recoverMediaError), au plus une fois par
// AUDIO_RESET_MS. Un autre format sans rupture, c'est une autre qualité en
// « Auto » : rien, la remise à neuf ferait caler à chaque changement de débit.
const AUDIO_RESET_MS = 8_000
// Image figée juste avant une rupture dont le son a un autre format (fin de
// l'écran de pub ; signalement du 26/10 sur Tamblr : « le direct ne reprend
// pas après le compte à rebours ») : nouvelle instance au bout de
// FORMAT_STALL_MS, au lieu des STALL_REBUILD_MS d'un calage ordinaire. Elle
// repart au bord du direct, après la rupture.
const FORMAT_STALL_MS = 3_000

/** Format du son d'un init segment fMP4 (boîte « mp4a » : canaux, fréquence,
 *  et toute la boîte comme clé, configuration AAC comprise) ; null sans elle. */
export function audioFormatOf(init) {
  if (!(init instanceof Uint8Array)) return null
  for (let i = 4; i + 32 <= init.length; i++) {
    // « mp4a », précédé de la taille de la boîte.
    if (init[i] !== 0x6d || init[i + 1] !== 0x70 || init[i + 2] !== 0x34 || init[i + 3] !== 0x61) continue
    const at = i - 4
    const size = ((init[at] << 24) | (init[at + 1] << 16) | (init[at + 2] << 8) | init[at + 3]) >>> 0
    if (size < 36 || at + size > init.length) continue
    const box = init.subarray(at, at + size)
    return {
      key: Array.from(box, (b) => b.toString(16).padStart(2, '0')).join(''),
      channels: (box[24] << 8) | box[25],
      rate: (box[32] << 8) | box[33],
    }
  }
  return null
}

/** « 44,1 kHz stéréo », pour le journal. */
const audioLabel = (f) => `${(f.rate / 1000).toLocaleString('fr-FR')} kHz ${f.channels === 1 ? 'mono' : f.channels === 2 ? 'stéréo' : `${f.channels} canaux`}`

/** Passages d'une VOD en fMP4 listés « N-unmuted.mp4 » : contrairement à
 *  « N-unmuted.ts » (refusé par le CDN), ce fichier a le son d'origine
 *  (sondé sur 19 VODs). Twitch les compte pourtant parmi les passages coupés
 *  (muteInfo) : on ne les annonce pas comme muets. */
export function soundSpansOf(fragments) {
  const spans = []
  for (const f of fragments ?? []) {
    if (!/-unmuted\.mp4/.test(f?.relurl || f?.url || '') || !Number.isFinite(f.start)) continue
    const end = f.start + (f.duration || 0)
    const last = spans[spans.length - 1]
    if (last && f.start <= last.end + 0.1) last.end = Math.max(last.end, end)
    else spans.push({ start: f.start, end })
  }
  return spans
}

function prefetchPlaylistLoader(Hls, player) {
  const Base = Hls.DefaultConfig.loader
  return class PrefetchLoader extends Base {
    load(context, config, callbacks) {
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, details) => {
          if (typeof response?.data === 'string' && response.data.includes(PREFETCH_TAG)) {
            response.data = player.withPrefetch(response.data)
          }
          callbacks.onSuccess(response, stats, ctx, details)
        },
      })
    }
  }
}

// ── Qualités supérieures : playlists du flux du compte ───────────────────
// Adresses « tuhq:// » (hq.js) : la playlist vient de l'extension
// TwitchUnblock Connect (hq.master, hq.playlist), jamais du réseau — Twitch
// refuse ses playlists à une page d'une autre origine. Les segments partent
// en direct vers le CDN, comme pour les autres sources. `prefetch` (qualité
// fixe) : segments annoncés d'avance, comme prefetchPlaylistLoader.
function hqPlaylistLoader(Hls, player, prefetch) {
  const Base = Hls.DefaultConfig.loader
  return class HqLoader extends Base {
    load(context, config, callbacks) {
      if (!isHqUrl(context.url)) {
        if (!prefetch) return super.load(context, config, callbacks)
        return super.load(context, config, {
          ...callbacks,
          onSuccess: (response, stats, ctx, details) => {
            if (typeof response?.data === 'string' && response.data.includes(PREFETCH_TAG)) response.data = player.withPrefetch(response.data)
            callbacks.onSuccess(response, stats, ctx, details)
          },
        })
      }
      const stats = this.stats
      stats.loading.start = performance.now()
      const job = { context, callbacks, done: false, timer: 0 }
      this.hqJob = job
      const finish = (fn) => {
        if (job.done || this.hqJob !== job) return
        job.done = true
        clearTimeout(job.timer)
        fn()
      }
      job.timer = setTimeout(() => finish(() => callbacks.onTimeout(stats, context, null)), config.timeout || 20_000)
      Promise.resolve().then(() => player.o.hqText(context.url)).then((text) => finish(() => {
        let data = String(text)
        if (prefetch && data.includes(PREFETCH_TAG)) data = player.withPrefetch(data)
        const now = performance.now()
        stats.loading.first = Math.max(now, stats.loading.start)
        stats.loading.end = stats.loading.first
        stats.loaded = stats.total = data.length
        callbacks.onSuccess({ url: context.url, data, code: 200 }, stats, context, null)
      }), (err) => finish(() => {
        stats.loading.end = performance.now()
        // Direct fini (offline) : un 404, comme Twitch ; sinon une erreur réseau.
        callbacks.onError({ code: err?.code === 'offline' ? 404 : 0, text: String(err?.code || err?.message || 'hq') }, context, null, stats)
      }))
    }

    abort() {
      const job = this.hqJob
      if (!job) return super.abort()
      if (job.done) return
      job.done = true
      clearTimeout(job.timer)
      this.stats.aborted = true
      job.callbacks.onAbort?.(this.stats, job.context, null)
    }

    destroy() {
      const job = this.hqJob
      if (job) {
        job.done = true
        clearTimeout(job.timer)
      }
      this.hqJob = null
      super.destroy()
    }
  }
}

let hlsPromise = null
/** Charge hls.js, avec un second CDN si le premier ne répond pas : sans lui,
 *  rien ne se lit hors de Safari. Appelé au démarrage pour être prêt au
 *  premier clic. Si les deux échouent (réseau coupé au chargement), le
 *  prochain appel réessaie — l'échec restait toute la séance, plus aucune
 *  vidéo jusqu'au rechargement de la page. */
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls)
  hlsPromise ??= new Promise((resolve) => {
    const done = (Hls) => {
      if (!Hls) hlsPromise = null
      resolve(Hls)
    }
    const next = (i) => {
      if (window.Hls) return done(window.Hls)
      if (i >= HLS_SOURCES.length) return done(null)
      const s = document.createElement('script')
      s.src = HLS_SOURCES[i]
      s.integrity = HLS_INTEGRITY
      s.crossOrigin = 'anonymous'
      s.async = true
      s.onload = () => done(window.Hls ?? null)
      s.onerror = () => { s.remove(); next(i + 1) }
      document.head.appendChild(s)
    }
    next(0)
  })
  return hlsPromise
}

// ── Qualités ─────────────────────────────────────────────────────────────
const isAutoKey = (k) => String(k).toLowerCase() === 'auto'
const isSourceKey = (k) => /source|chunked/i.test(k)
const isAudioKey = (k) => /audio/i.test(k)
// Paliers standards, pour deviner la hauteur d'une « Source » sans info.
const HEIGHTS = [160, 360, 480, 720, 1080, 1440, 2160]

/** Hauteur d'une qualité : celle que donne le Worker (`variants`, worker.js
 *  variantInfo), sinon celle du nom (« 720p60 », « 1920x1080 »). « Source »
 *  ne dit pas la sienne (1080p60, 720p60, 936p…) : sans info, le palier
 *  standard au-dessus de la meilleure qualité transcodée (1080 s'il y a une
 *  720p, 720 si la meilleure est en 480p), 1080 s'il n'y en a aucune.
 *  Audio seul : 0. */
export function heightOf(key, variants, keys = []) {
  const known = variants?.[key]?.h
  if (known > 0) return known
  const s = String(key)
  if (isAudioKey(s) || isAutoKey(s)) return 0
  const m = s.match(/(\d+)p/i) || s.match(/\d+x(\d+)/)
  if (m) return Number(m[1])
  if (!isSourceKey(s)) return 0
  const best = Math.max(0, ...keys.filter((k) => !isSourceKey(k)).map((k) => heightOf(k, variants)))
  return best ? (HEIGHTS.find((h) => h > best) ?? best) : 1080
}

/** Cadence (i/s) : celle du Worker, sinon celle du nom (« 720p60 »),
 *  30 pour un nom sans cadence ; 0 si rien ne la dit (Source). */
function fpsOf(key, variants) {
  const known = variants?.[key]?.fps
  if (known > 0) return known
  const m = String(key).match(/\d+p(\d+)?/i)
  return m ? Number(m[1] || 30) : 0
}

/** Auto d'abord, puis de la plus haute à la plus basse (la plus fluide
 *  d'abord à hauteur égale, Source en tête d'une égalité), l'audio seul en
 *  dernier. Sans `variants`, Source reste en tête des vidéos. */
export function sortQualities(keys, variants) {
  const score = (k) => {
    if (isAutoKey(k)) return 1e9
    if (isAudioKey(k)) return -1
    return heightOf(k, variants, keys) * 1000 + fpsOf(k, variants) * 2 + (isSourceKey(k) ? 1 : 0)
  }
  return [...keys].sort((a, b) => score(b) - score(a))
}

/** Valeurs du réglage « Qualité préférée » (prefs.qualityPref), les mêmes
 *  que dans la sauvegarde de l'app iOS. Une autre hauteur (« 1440 », prise
 *  dans le lecteur) reste valable. */
export const QUALITY_PREFS = ['auto', 'source', '1080', '720', '480', '360', '160', 'audio']
export const validQualityPref = (v) => typeof v === 'string' && (QUALITY_PREFS.includes(v) || /^[1-9]\d{1,3}$/.test(v))

/** Qualité à lancer selon la préférence. Une valeur inconnue vaut « auto ».
 *  auto : « Auto » s'il existe, sinon comme source. source : Source, sinon
 *  la vidéo la plus haute. audio : l'audio seul, sinon la vidéo la plus
 *  basse. Une hauteur : la même (la plus fluide), sinon la plus proche en
 *  dessous, sinon la plus basse au-dessus. */
export function pickQuality(keys, pref, variants) {
  if (!keys.length) return null
  const p = validQualityPref(pref) ? pref : 'auto'
  const video = sortQualities(keys, variants).filter((k) => !isAutoKey(k) && !isAudioKey(k))
  const auto = keys.find(isAutoKey)
  const fallback = auto ?? keys[0]
  if (p === 'auto' && auto) return auto
  if (p === 'auto' || p === 'source') return keys.find(isSourceKey) ?? video[0] ?? fallback
  if (p === 'audio') return keys.find(isAudioKey) ?? video[video.length - 1] ?? fallback
  const want = Number(p)
  const h = (k) => heightOf(k, variants, keys)
  return video.find((k) => h(k) === want) ?? video.find((k) => h(k) < want) ?? video[video.length - 1] ?? fallback
}

/** Préférence que retient un choix fait dans le lecteur : « 720p60 » → '720'. */
export function prefFromKey(key, variants, keys) {
  if (isAutoKey(key)) return 'auto'
  if (isSourceKey(key)) return 'source'
  if (isAudioKey(key)) return 'audio'
  const h = heightOf(key, variants, keys)
  return h > 0 ? String(h) : 'auto'
}

/** Nom brut d'une qualité. Il sert aussi aux noms des fichiers téléchargés
 *  (download.js) : jamais traduit — le nettoyage du nom efface le cyrillique. */
export function qualityLabel(k) {
  const s = String(k)
  if (s.toLowerCase() === 'chunked') return 'Source'
  if (s.toLowerCase() === 'audio_only') return 'Audio'
  return s.replace(/^(\d+p)30$/, '$1')
}

/** Libellé affiché (menu, bouton, feuilles) : « Audio seul » traduit. */
export function qualityText(k) {
  if (isAudioKey(k)) return t('q_audio')
  if (isAutoKey(k)) return t('auto')
  return qualityLabel(k)
}

// ── Vitesse ──────────────────────────────────────────────────────────────
/** Vitesse retenue pour les VODs (prefs.vodSpeed, même nom que dans la
 *  sauvegarde iOS) ; 1 si elle n'est pas dans la liste (sauvegarde importée,
 *  qui ne contrôle que le type). */
export const validSpeed = (v) => (SPEEDS.includes(Number(v)) ? Number(v) : 1)

/** Vitesse écrite dans la langue du site : « 1,5× » en français, « 1.5× » en anglais. */
const speedText = (s) => `${s.toLocaleString(lang())}×`

export class Player {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {HTMLElement} o.fullscreenTarget  élément mis en plein écran (vidéo + chat)
   * @param {(t: number, duration: number) => void} o.onTime
   * @param {() => void} o.onToggleChat
   * @param {() => boolean} o.isChatOpen
   * @param {object} o.prefs
   * @param {() => void} o.savePrefs
   * Qualités supérieures (hq.js, par main.js) :
   * @param {(url: string) => Promise<string>} [o.hqText]  playlist d'une adresse tuhq://
   * @param {(left: number) => void} [o.onAdState]  bandeau de pause pub ouvert (secondes restantes) ou fermé (0)
   * @param {() => boolean} [o.onFatal]  erreur fatale du flux du compte : true si la source habituelle reprend
   */
  constructor(root, o) {
    this.root = root
    this.o = o
    this.hls = null
    this.links = {}
    this.kind = 'vod'
    this.quality = null
    // Hauteur, cadence et débit de chaque qualité (Worker), si connus.
    this.variants = {}
    // La vitesse choisie est retenue d'une VOD à l'autre (pas pour un clip).
    this.keepSpeed = false
    this.speedNotice = false
    // Source qui sert le direct en cours (« as », « al », « eu », « twitch »).
    this.liveSource = null
    // Pauses pub annoncées par la playlist du direct (id → { start, end },
    // en ms), celle qu'on affiche, celles déjà comptées, et le son coupé
    // par nous (rétabli à la fin).
    this.adBreaks = new Map()
    this.adBreak = null
    this.adSeen = []
    this.adMuted = false
    this.adKeepSound = false
    this.adTimer = null
    // Format du son du direct : par rupture du flux (cc → format), celui qui
    // joue, dernière remise à neuf (voir AUDIO_RESET_MS).
    this.audioFormats = new Map()
    this.audioPlaying = null
    this.audioResetAt = 0
    // Passages « -unmuted.mp4 » de la VOD : le son y est (soundSpansOf).
    this.soundSpans = []
    // Santé de la lecture de la vidéo en cours (PlaybackHealth).
    this.health = null
    this.hideTimer = null
    this.lastTap = 0
    this.tapTimer = null
    this.dragging = false
    this.build()
  }

  build() {
    this.root.classList.add('player')
    this.root.tabIndex = 0
    this.root.innerHTML = `
      <video playsinline webkit-playsinline preload="auto"></video>
      <div class="p-spinner" hidden><span></span></div>
      <div class="p-flash" aria-hidden="true"></div>
      <button class="p-unmute" type="button" hidden>${icon('mute', 16)}<span></span></button>
      <div class="p-mutednote" hidden>${icon('mute', 15)}<span class="p-mutednote-text"></span><button type="button" class="p-mutednote-skip">${icon('skipForward', 13)}<span></span></button></div>
      <div class="p-adbreak" hidden role="status"><b class="p-adbreak-title"></b><span class="p-adbreak-sub" aria-live="off"></span><span class="p-adbreak-hint"></span></div>
      <div class="p-ui">
        <div class="p-shade"></div>
        <button class="p-big" type="button" aria-label="play">${icon('play', 30)}</button>
        <div class="p-bottom">
          <div class="p-progress" hidden>
            <div class="p-track"><div class="p-buffer"></div><div class="p-played"></div></div>
            <div class="p-knob"></div>
            <div class="p-tip" hidden></div>
          </div>
          <div class="p-bar">
            <button class="p-btn p-play" type="button">${icon('play', 22)}</button>
            <button class="p-btn p-back" type="button" data-i18n-title="back10">${icon('back10', 20)}<b>10</b></button>
            <button class="p-btn p-fwd" type="button" data-i18n-title="fwd10">${icon('fwd10', 20)}<b>10</b></button>
            <div class="p-volume">
              <button class="p-btn p-mute" type="button">${icon('volume', 21)}</button>
              <input class="p-vol" type="range" min="0" max="1" step="0.05" aria-label="volume">
            </div>
            <span class="p-time vod-only"></span>
            <button class="p-live live-only" type="button"><span class="dot"></span><span class="p-live-text"></span></button>
            <button class="p-latency live-only" type="button" data-i18n-title="go_live"></button>
            <button class="p-btn p-chapters vod-only" type="button" hidden data-i18n-title="chapters">${icon('list', 18)}<span class="p-chap-label"></span>${icon('chevronUp', 14)}</button>
            <span class="p-spacer"></span>
            <button class="p-btn p-quality" type="button" data-i18n-title="quality">${icon('settings', 20)}<span class="p-q-label"></span><span class="p-q-speed"></span></button>
            <button class="p-btn p-chat" type="button" data-i18n-title="chat">${icon('chat', 20)}</button>
            <button class="p-btn p-pip" type="button" data-i18n-title="pip">${icon('pip', 20)}</button>
            <button class="p-btn p-theatre" type="button" data-i18n-title="theatre">${icon('theatre', 20)}</button>
            <button class="p-btn p-fs" type="button" data-i18n-title="fullscreen">${icon('maximize', 20)}</button>
          </div>
        </div>
      </div>
      <div class="p-menu" hidden role="menu"></div>`

    const q = (s) => $(s, this.root)
    this.video = q('video')
    this.el = {
      spinner: q('.p-spinner'), flash: q('.p-flash'), unmute: q('.p-unmute'),
      ui: q('.p-ui'), big: q('.p-big'), progress: q('.p-progress'), buffer: q('.p-buffer'),
      played: q('.p-played'), knob: q('.p-knob'), tip: q('.p-tip'),
      play: q('.p-play'), back: q('.p-back'), fwd: q('.p-fwd'), mute: q('.p-mute'), vol: q('.p-vol'),
      time: q('.p-time'), live: q('.p-live'), liveText: q('.p-live-text'), latency: q('.p-latency'),
      quality: q('.p-quality'), qLabel: q('.p-q-label'), qSpeed: q('.p-q-speed'), chat: q('.p-chat'), pip: q('.p-pip'), fs: q('.p-fs'), theatre: q('.p-theatre'), chapBtn: q('.p-chapters'), chapLabel: q('.p-chap-label'),
      menu: q('.p-menu'), mutedNote: q('.p-mutednote'), mutedText: q('.p-mutednote-text'), mutedSkip: q('.p-mutednote-skip'),
      ad: q('.p-adbreak'), adTitle: q('.p-adbreak-title'), adSub: q('.p-adbreak-sub'), adHint: q('.p-adbreak-hint'),
    }

    const v = this.video
    const p = this.o.prefs
    v.volume = p.volume ?? 1
    v.muted = Boolean(p.muted)
    this.el.vol.value = String(v.muted ? 0 : v.volume)

    // ── Vidéo ────────────────────────────────────────────────────────────
    v.addEventListener('play', () => this.syncPlay())
    v.addEventListener('pause', () => { this.stalledAt = 0; this.health?.stallEnd(); this.syncPlay(); this.showUI(); this.o.onPause?.() })
    v.addEventListener('waiting', () => {
      this.el.spinner.hidden = false
      this.passHole()
      // Direct qui cale : l'image s'arrête, pas le direct (voir chatDelay).
      if (this.kind === 'live' && !v.paused && !v.seeking && !this.stalledAt) {
        this.stalledAt = Date.now()
        this.stallPos = v.currentTime
        if (this.hls) { this.watchStall(); this.watchFormatStall() }
      }
      this.noteStall()
    })
    // Premier placement (départ demandé, ou saut fait pendant le chargement)
    // ou lecture partie : la position de la vidéo fait foi dès lors (resumeAt).
    v.addEventListener('seeking', () => { this.startPos = 0; this.passHole() })
    v.addEventListener('seeked', () => { this.seekedAt = Date.now() })
    v.addEventListener('playing', () => {
      this.startPos = 0
      this.el.spinner.hidden = true
      this.scheduleHide()
      // Fin d'un décrochage, ou première image de la source (santé).
      this.playedSinceAttach = true
      this.health?.stallEnd()
    })
    v.addEventListener('canplay', () => { this.el.spinner.hidden = true })
    v.addEventListener('timeupdate', () => this.onTime())
    v.addEventListener('progress', () => this.drawBuffer())
    v.addEventListener('durationchange', () => this.onTime())
    v.addEventListener('volumechange', () => this.syncVolume())
    v.addEventListener('ratechange', () => this.onRateChange())
    v.addEventListener('error', () => this.onMediaError())
    // Vitesse retenue annoncée au démarrage d'une VOD : sinon une vitesse
    // choisie une fois s'appliquait aux VODs suivantes sans aucun signe.
    v.addEventListener('playing', () => {
      if (!this.speedNotice) return
      this.speedNotice = false
      if (this.kind === 'vod' && v.playbackRate !== 1) this.flash(speedText(v.playbackRate))
    })
    v.addEventListener('enterpictureinpicture', () => this.root.classList.add('in-pip'))
    v.addEventListener('leavepictureinpicture', () => this.root.classList.remove('in-pip'))
    v.addEventListener('webkitpresentationmodechanged', () => {
      this.root.classList.toggle('in-pip', v.webkitPresentationMode === 'picture-in-picture')
    })

    // ── Commandes ────────────────────────────────────────────────────────
    const on = (el, fn) => el.addEventListener('click', (e) => { e.stopPropagation(); fn(e); this.showUI() })
    on(this.el.big, () => this.togglePlay())
    on(this.el.play, () => this.togglePlay())
    on(this.el.back, () => this.seekBy(-10))
    on(this.el.fwd, () => this.seekBy(10))
    on(this.el.mute, () => this.toggleMute())
    on(this.el.live, () => this.goLive())
    // La latence aussi : un clic ramène au bord du direct, sans recharger.
    on(this.el.latency, () => this.goLive())
    on(this.el.quality, () => this.toggleMenu())
    on(this.el.chapBtn, () => this.toggleChapters())
    this.video.addEventListener('timeupdate', () => this.updateChapterLabel())
    on(this.el.chat, () => this.o.onToggleChat())
    on(this.el.pip, () => this.togglePiP())
    on(this.el.fs, () => this.toggleFullscreen())
    on(this.el.theatre, () => this.o.onTheatre?.())
    on(this.el.unmute, () => { this.video.muted = false; this.el.unmute.hidden = true })
    on(this.el.mutedSkip, () => {
      const r = this.mutedAt(this.video.currentTime)
      if (r) this.video.currentTime = Math.min(r.end + 0.5, Number.isFinite(this.video.duration) ? this.video.duration - 1 : r.end + 0.5)
    })
    this.el.mutedNote.addEventListener('click', (e) => e.stopPropagation())
    this.el.vol.addEventListener('input', (e) => {
      e.stopPropagation()
      v.volume = Number(this.el.vol.value)
      v.muted = v.volume === 0
    })
    this.el.vol.addEventListener('click', (e) => e.stopPropagation())
    this.el.menu.addEventListener('click', (e) => this.onMenuClick(e))

    if (!document.pictureInPictureEnabled && !v.webkitSupportsPresentationMode) this.el.pip.hidden = true

    // ── Barre de progression ─────────────────────────────────────────────
    const prog = this.el.progress
    prog.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      this.dragging = true
      this.root.classList.add('scrubbing')
      prog.setPointerCapture(e.pointerId)
      this.scrubTo(e)
    })
    prog.addEventListener('pointermove', (e) => {
      this.hoverTip(e)
      if (this.dragging) this.scrubTo(e)
    })
    prog.addEventListener('pointerleave', () => { if (!this.dragging) this.el.tip.hidden = true })
    const end = (e) => {
      if (!this.dragging) return
      this.dragging = false
      this.root.classList.remove('scrubbing')
      this.el.tip.hidden = true
      const target = this.positionFrom(e)
      if (target !== null) this.video.currentTime = target
    }
    prog.addEventListener('pointerup', end)
    prog.addEventListener('pointercancel', end)
    prog.addEventListener('click', (e) => e.stopPropagation())

    // ── Affichage des commandes, gestes ──────────────────────────────────
    this.root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.showUI() })
    this.root.addEventListener('mouseleave', () => this.scheduleHide(600))
    this.root.addEventListener('click', (e) => this.onSurfaceClick(e))
    this.root.addEventListener('dblclick', (e) => {
      if (e.target.closest('.p-bottom, .p-menu, .p-big')) return
      if (matchMedia('(pointer: fine)').matches) this.toggleFullscreen()
    })
    // Raccourcis sur toute la page (plus seulement lecteur sélectionné), tant
    // que le lecteur est affiché en grand et qu'on n'écrit pas.
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (this.o.keysActive ? this.o.keysActive() : this.root.contains(document.activeElement)) this.onKey(e)
    })

    document.addEventListener('fullscreenchange', () => this.syncFullscreen())
    document.addEventListener('webkitfullscreenchange', () => this.syncFullscreen())

    this.syncVolume()
    this.syncPlay()
  }

  // ── Chargement ─────────────────────────────────────────────────────────
  /**
   * @param {object} o
   * @param {Record<string,string>} o.links  qualité → URL
   * @param {Record<string,{h:number,fps:number,bw:number}>} [o.variants]  qualité → infos (Worker)
   * @param {'live'|'vod'} o.kind
   * @param {number} [o.startAt]
   * @param {boolean} [o.clip]  clip : 1× au départ, vitesse non retenue
   */
  load({ links, variants, kind, startAt = 0, clip = false }) {
    this.links = links
    this.variants = variants && typeof variants === 'object' ? variants : {}
    this.kind = kind
    this.keepSpeed = kind === 'vod' && !clip
    this.liveSource = null
    this.root.dataset.kind = kind
    this.el.progress.hidden = kind !== 'vod'
    this.setChapters([])
    this.soundSpans = []
    // Passages rétablis (unmuteLoader) : ceux de la vidéo d'avant oubliés
    // ici, plus dans setMuted — appelé après load(), quand la liste des
    // passages coupés arrive, il effaçait ceux déjà rétablis entre-temps
    // (barre orange et avis « son coupé » à tort).
    this.unmutedSpans = []
    this.unmutedToldAt = 0
    this.setMuted([])
    // Nouvelle vidéo : pauses pub de la précédente oubliées, son rétabli.
    this.endAdBreak()
    this.adBreaks.clear()
    this.adSeen = []
    // Relances après une erreur fatale (rebuild) : comptées par vidéo.
    this.rebuilds = []
    this.mediaFixAt = 0
    // Santé de la lecture : par vidéo, d'une source à l'autre.
    this.health = new PlaybackHealth(Date.now(), this.video)
    // Rempli tout de suite : sinon la pastille du direct restait vide tant
    // que la vidéo n'avait pas démarré.
    this.el.liveText.textContent = t('live_now')
    this.el.live.classList.remove('behind')
    this.el.latency.textContent = ''
    // Vitesse retenue pour une VOD, 1× en direct et pour un clip. Réglée
    // aussi en defaultPlaybackRate : chaque nouvelle source (qualité, autre
    // Worker) remet playbackRate à cette valeur — la vitesse retombait à 1×,
    // et une VOD accélérée débordait sur le direct suivant.
    const rate = this.keepSpeed ? validSpeed(this.o.prefs.vodSpeed) : 1
    this.video.defaultPlaybackRate = rate
    this.video.playbackRate = rate
    this.speedNotice = this.keepSpeed && rate !== 1
    // Qualité préférée (réglages), ou la plus proche qui existe.
    this.quality = pickQuality(Object.keys(links), this.o.prefs.qualityPref, this.variants)
    this.updateQualityLabel()
    this.attach(links[this.quality], startAt)
    this.showUI()
  }

  async attach(url, startAt = 0) {
    const v = this.video
    // Avant tout : un attach() précédent encore en attente n'ira pas plus loin.
    const token = (this.attachToken = (this.attachToken ?? 0) + 1)
    // Santé : images de l'ancienne source relevées avant qu'elle parte ; le
    // démarrage de la nouvelle n'est pas un décrochage.
    this.health?.newSource(v)
    this.playedSinceAttach = false
    this.destroyHls()
    this.el.spinner.hidden = false
    if (!url) return
    // Erreurs réseau de suite (relances), segments introuvables sautés et
    // trous qu'ils laissent (skipMissingFrag).
    this.netFails = 0
    this.skippedFrags = 0
    this.holes = []
    this.pendingHole = null
    // Départ demandé (lien ?t=, reprise), gardé jusqu'à ce que la vidéo s'y
    // place : rien n'étant chargé, elle reste à 0 jusque-là (resumeAt).
    this.startPos = this.kind === 'vod' && startAt > 1 ? startAt : 0
    // Essais de son d'origine sur les passages coupés : remis à zéro à chaque
    // source (une VOD récente peut suivre une ancienne).
    this.unmute = this.kind === 'vod' ? {} : null
    // Durée des segments annoncés d'avance dans la dernière playlist lue.
    this.prefetchAhead = 0
    // État du direct remis à zéro à chaque source (qualité, chaîne, Worker) :
    // la cible d'une chaîne débordait sur la suivante, et n'était pas
    // réappliquée au nouvel objet hls.
    this.behindTarget = undefined
    this.stalledAt = 0
    // Avancée de la playlist (noteLivePlaylist) : propre à chaque instance.
    this.livePlaylist = null
    this.floorCheckAt = 0
    this.floorSeekAt = 0
    this.holdingBehind = false
    this.aligned = false
    this.alignFrom = 0
    this.driftSince = 0
    this.lastRealign = 0

    const start = () => {
      if (token !== this.attachToken) return   // vidéo remplacée entre-temps
      if (startAt > 1 && this.kind === 'vod') {
        try { v.currentTime = startAt } catch {}
      }
      this.tryPlay()
    }

    // Clip : un simple MP4, lu tel quel.
    if (/\.mp4(\?|$)/i.test(url)) {
      v.src = url
      v.addEventListener('loadedmetadata', start, { once: true })
      v.load()
      return
    }

    // hls.js dès qu'il est utilisable — iPhone compris depuis iOS 17.1 —,
    // comme l'ancienne version du site : lui seul permet de corriger à la
    // volée les adresses que le Worker ne réécrit pas (voir fixProxiedUrl).
    // Le HLS natif ne sert qu'en dernier recours.
    const native = Boolean(v.canPlayType('application/vnd.apple.mpegurl'))
    const Hls = await loadHls()
    if (token !== this.attachToken) return

    // Flux du compte en qualités supérieures (hq.js) : ses playlists par
    // l'extension, ses segments jamais par nos relais.
    const hqSource = isHqUrl(url)
    if (Hls?.isSupported()) {
      // « Auto » : la liste maîtresse, hls.js choisit le débit (worker.js).
      const master = String(this.quality).toLowerCase() === 'auto'
      const hls = new Hls({
        // Rouvrir la requête avec l'adresse corrigée : c'est le point
        // d'accroche que hls.js offre pour réécrire une URL avant envoi.
        // Pas pour le flux du compte : ses adresses de segments sont
        // absolues, et ne partent pas au relais même si le CDN y est passé.
        ...(hqSource ? {} : {
          xhrSetup: (xhr, reqUrl) => {
            const fixed = liveRequestUrl(reqUrl, url)
            if (fixed !== reqUrl) xhr.open('GET', fixed, true)
          },
        }),
        // Tampons bornés, en direct surtout (voir bufferConfig).
        ...bufferConfig(this.kind),
        // Distance au bord du direct, en secondes. Twitch déclare des
        // segments de 6 s (EXT-X-TARGETDURATION) qui en durent 2 : compté en
        // segments (liveSyncDurationCount: 3), le lecteur se tenait à 18 s du
        // bord — environ 20 s de retard, contre 3 à 4 s une fois avancé à la
        // main. 4 s, c'est deux vrais segments d'avance : bas sans caler.
        // Quand Twitch annonce ses prochains segments (fast_bread) et que la
        // qualité est fixe, la cible passe à LIVE_BEHIND_COMPLETE derrière le
        // dernier segment complet (withPrefetch).
        liveSyncDuration: LIVE_BEHIND_PLAIN,
        // Une VOD part du début (ou de la reprise) même si sa playlist n'a
        // pas de fin déclarée : sinon hls.js la prend pour un direct et part
        // du bord (VOD reconstruite encore en cours d'écriture, par exemple).
        startPosition: this.kind === 'vod' ? (startAt > 1 ? startAt : 0) : -1,
        // VOD : passages coupés rétablis quand le CDN a encore l'original.
        ...(this.kind === 'vod' ? { fLoader: unmuteLoader(Hls, this) } : {}),
        // Direct en qualité fixe : segments annoncés d'avance par Twitch
        // (voir plus haut). Pas de maxLiveSyncPlaybackRate : à 1 (valeur par
        // défaut), hls.js ne touche plus à la vitesse ; le retard se rattrape
        // par des sauts (holdLiveFloor, alignLive). Flux du compte : ses
        // playlists, « Auto » compris, par l'extension (hqPlaylistLoader).
        ...(hqSource ? { pLoader: hqPlaylistLoader(Hls, this, this.kind === 'live' && !master) }
          : this.kind === 'live' && !master ? { pLoader: prefetchPlaylistLoader(Hls, this) } : {}),
      })
      this.hls = hls
      this.directFails = 0
      // Nouvelle instance, nouveau tampon : le format du son repart de zéro.
      this.audioFormats = new Map()
      this.audioPlaying = null
      // iPhone (il n'a que ManagedMediaSource) : arrêts de Safari tenus en bride.
      if (usesManagedMediaSource(hls.config)) guardManagedMediaSource(Hls, hls, v, (name) => this.health?.add(name))
      hls.loadSource(url)
      hls.attachMedia(v)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // « Auto » démarrait toujours en 480p30 ou en dessous (hls.js écarte
        // les niveaux à 60 i/s au premier choix) : départ au plus haut niveau
        // jusqu'à 720p. L'adaptation au débit reste active ensuite. hls.js ne
        // monte jamais vers une cadence plus basse : pas de départ en 720p60
        // quand la Source est en 1080p50 ou 1080p30, elle deviendrait
        // inaccessible (essai sur nico_la).
        if (master) {
          const lv = hls.levels || []
          const fps = (l) => l.frameRate || 0
          let best = -1
          lv.forEach((l, i) => {
            if (!(l.height > 0) || l.height > 720) return
            if (lv.some((o) => o.height > l.height && fps(o) > 0 && fps(o) < fps(l))) return
            if (best < 0 || l.height > lv[best].height || (l.height === lv[best].height && l.bitrate > lv[best].bitrate)) best = i
          })
          if (best >= 0) hls.startLevel = best
        }
        this.tryPlay()
      })
      hls.on(Hls.Events.FRAG_LOADED, () => {
        this.directFails = 0
        this.netFails = 0
        this.skippedFrags = 0
      })
      // Chaque playlist lue (niveau joué, « Auto » compris) : pauses pub
      // annoncées et avancée d'un direct, passages « -unmuted.mp4 » d'une VOD.
      hls.on(Hls.Events.LEVEL_UPDATED, (_e, d) => {
        if (token !== this.attachToken) return
        if (this.kind !== 'live') { this.readSoundSpans(d.details); return }
        this.readAdBreaks(d.details)
        // Nouveaux segments après une coupure de la chaîne : le guet reprend,
        // l'image a STALL_REBUILD_MS pour repartir avec eux (voir
        // LIVE_HALT_MS).
        if (noteLivePlaylist(this, d) && this.streamWait) {
          console.info('[TwitchUnblock] Direct : la chaîne envoie de nouveau des segments.')
          this.streamWait = false
          if (this.stalledAt) this.watchStall()
        }
      })
      // En « Auto » (playlist maître), hls.js choisit le débit : on affiche
      // lequel, sinon on ne sait jamais ce qu'on regarde vraiment.
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
        const h = hls.levels?.[d.level]?.height
        this.autoLevel = h ? `${h}p` : ''
        this.updateQualityLabel()
      })
      // Format du son d'un direct : noté à chaque init segment, comparé quand
      // l'image change de segment (voir AUDIO_RESET_MS).
      hls.on(Hls.Events.FRAG_PARSING_INIT_SEGMENT, (_e, d) => {
        if (token === this.attachToken && this.kind === 'live') this.noteAudioFormat(d)
      })
      hls.on(Hls.Events.FRAG_CHANGED, (_e, d) => {
        if (token === this.attachToken && this.kind === 'live') this.checkAudioFormat(hls, d?.frag)
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        // Segments jamais arrivés (code 0 : bloqués avant d'atteindre
        // Twitch), trois de suite et appareil en ligne : les prochaines
        // tentatives passent par le relais du Worker. Pas ceux du flux du
        // compte, qui ne passent jamais par nos relais.
        if (!hqSource && noteDirectSegmentError(Hls, data, this) && data.fatal) { hls.startLoad(); return }
        if (token !== this.attachToken) return
        // Réglée par hls.js lui-même : comptée (santé de la lecture), rien d'autre.
        if (!data.fatal) { this.health?.hlsIssue(data.details); return }
        logError('lecteur', `hls.js ${data.type} · ${data.details}${data.response?.code ? ` · HTTP ${data.response.code}` : ''}`)
        // Flux du compte : la source habituelle reprend aussitôt (main.js,
        // hq.js), hors de l'événement de hls.js, sans relances sur ce flux.
        if (hqSource && this.o.onFatal) {
          hls.stopLoad()
          setTimeout(() => { if (token === this.attachToken && !this.o.onFatal()) this.rebuild(token) }, 0)
          return
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Worker hors service en pleine lecture (quota du jour atteint), ou
          // relais du VPS en panne (failedProxy) : plutôt que de relancer
          // sans fin le même, main.js passe à un autre.
          const down = navigator.onLine !== false ? failedProxy(data) : null
          if (down && this.o.onWorkerDown?.(down)) return
          if (this.skipMissingFrag(hls, data)) return
          return this.retryLoad(hls, token)
        }
        // Réparée sur place une fois ; revenue aussitôt, ou d'un autre type :
        // nouvelle instance (voir MEDIA_FIX_MS).
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaFixAllowed(this)) {
          this.health?.add('recover')
          // Tampon neuf : il prend le format du son qui arrive.
          this.audioPlaying = null
          recoverMedia(hls, v, this.kind === 'vod' ? this.resumeAt() : -1)
        } else this.rebuild(token)
      })
    } else if (hqSource && this.o.onFatal) {
      // Flux du compte sans hls.js : rien pour le lire, la source habituelle reprend.
      setTimeout(() => { if (token === this.attachToken && !this.o.onFatal()) this.o.onError?.() }, 0)
    } else if (native && !hqSource) {
      // Safari (iPhone surtout) : HLS natif.
      v.src = url
      v.addEventListener('loadedmetadata', start, { once: true })
      v.load()
    } else {
      this.el.spinner.hidden = true
      this.o.onError?.()
    }
  }

  /** Lecture automatique : avec le son si le navigateur l'accepte, sinon en
   *  muet avec une pastille pour le remettre — comme sur Twitch. Ce muet-là
   *  n'est pas un choix : il n'est pas retenu (autoMuted, syncVolume) — les
   *  visites suivantes démarraient en muet, sans pastille. */
  async tryPlay() {
    try {
      await this.video.play()
    } catch (err) {
      if (err?.name !== 'NotAllowedError') return
      if (!this.video.muted) { this.autoMuted = true; this.video.muted = true }
      try {
        await this.video.play()
        $('span', this.el.unmute).textContent = t('unmute')
        this.el.unmute.hidden = false
      } catch { this.syncPlay() }
    }
  }

  /** Erreur réseau fatale (voir NET_RETRIES) : relance espacée, puis
   *  l'erreur. Appareil hors ligne : on attend le retour du réseau, sans
   *  compter d'essai. */
  retryLoad(hls, token) {
    this.clearRetry()
    const again = () => {
      this.clearRetry()
      if (token !== this.attachToken || this.hls !== hls) return
      // Playlist jamais lue (le relais ou le Worker ne répondait pas dès le
      // départ) : startLoad n'y fait rien — ni requête ni nouvelle erreur, la
      // roue tournait sans fin. On la redemande.
      if (!hls.levels?.length && hls.url) hls.loadSource(hls.url)
      else hls.startLoad()
    }
    if (navigator.onLine === false) {
      this.onlineWait = again
      window.addEventListener('online', again, { once: true })
      return
    }
    if (++this.netFails > NET_RETRIES) {
      console.info('[TwitchUnblock] Lecture : erreur réseau persistante, abandon.')
      this.stop()
      this.el.spinner.hidden = true
      this.o.onError?.()
      return
    }
    this.health?.add('retry')
    this.retryTimer = setTimeout(again, 1000 * 2 ** this.netFails)
  }

  clearRetry() {
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.onlineWait) { window.removeEventListener('online', this.onlineWait); this.onlineWait = null }
  }

  /** Erreur fatale que hls.js ne répare pas, ou direct figé (watchStall) :
   *  l'instance est détruite et une nouvelle repart de la même adresse — à
   *  la même position pour une VOD, au bord pour un direct. Au-delà de
   *  MAX_REBUILDS en REBUILD_WINDOW_MS, l'erreur. */
  rebuild(token) {
    // Relance déjà prévue : elle ne compte qu'une fois. L'ancienne instance
    // signale parfois d'autres erreurs fatales d'ici là ; trois d'un coup
    // affichaient l'erreur, et la relance repartait derrière.
    if (token !== this.attachToken || this.rebuildTimer) return
    const now = Date.now()
    this.rebuilds = (this.rebuilds ?? []).filter((at) => now - at < REBUILD_WINDOW_MS)
    if (this.rebuilds.length >= MAX_REBUILDS) {
      this.stop()
      this.el.spinner.hidden = true
      this.o.onError?.()
      return
    }
    this.rebuilds.push(now)
    this.health?.add('rebuild')
    console.info('[TwitchUnblock] Lecture bloquée : nouvelle instance de hls.js.')
    this.el.spinner.hidden = false
    // Hors de l'événement d'erreur : hls.js n'est pas détruit pendant qu'il
    // le diffuse encore à ses propres contrôleurs.
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      if (token === this.attachToken) this.attach(this.links[this.quality], this.kind === 'vod' ? this.resumeAt() : 0)
    }, 1000)
  }

  /** Direct calé (« waiting ») : toujours au même point STALL_REBUILD_MS
   *  plus tard, page affichée et appareil en ligne, il repart sur une
   *  nouvelle instance (rebuild) — sans erreur de hls.js, l'image restait
   *  figée jusqu'au rechargement. Sauf si la playlist n'avance plus : la
   *  chaîne ne publie plus rien, le lecteur attend ses prochains segments,
   *  sans minuteur (streamWait, voir LIVE_HALT_MS). */
  watchStall() {
    clearTimeout(this.stallTimer)
    this.streamWait = false
    const token = this.attachToken
    this.stallTimer = setTimeout(() => {
      const v = this.video
      if (token !== this.attachToken || !this.hls || !this.stalledAt || v.paused || v.currentTime !== this.stallPos) return
      if (document.hidden || navigator.onLine === false) { this.watchStall(); return }
      if (liveHalted(this)) {
        console.info('[TwitchUnblock] Direct : plus aucun segment nouveau (coupure de la chaîne), attente.')
        this.streamWait = true
        return
      }
      this.rebuild(token)
    }, STALL_REBUILD_MS)
  }

  /** VOD : segment introuvable (404, 410 — purgé, VOD reconstruite). Plutôt
   *  que de le redemander, hls.js repart après lui quand la lecture y arrive
   *  (passHole) : ce qui est déjà chargé avant lui se lit. `false` si ce
   *  n'est pas le cas, ou après MAX_SKIPPED_FRAGS trous de suite. */
  skipMissingFrag(hls, data) {
    const f = data.frag
    const code = data.response?.code
    if (this.kind !== 'vod' || !f || !/^frag/i.test(data.details || '') || (code !== 404 && code !== 410)) return false
    if (!Number.isFinite(f.start) || !(f.duration > 0) || ++this.skippedFrags > MAX_SKIPPED_FRAGS) return false
    const hole = { start: f.start, end: f.start + f.duration + 0.05 }
    const d = this.video.duration
    if (Number.isFinite(d) && hole.end >= d - 0.5) {
      // Fin de la VOD introuvable (derniers segments purgés) : elle s'arrête
      // là. Le navigateur apprend que rien ne viendra après ce qui est
      // chargé (fin de flux, comme après le dernier segment d'une VOD
      // entière) : la lecture va jusqu'au trou, puis la vidéo se termine et
      // « Tout lire » passe à la suivante. Avant : trois relances, puis
      // « VOD indisponible » avant même d'arriver au trou, et jamais de fin.
      const eos = window.Hls?.Events?.BUFFER_EOS
      if (!eos) return false
      // Début de la partie manquante : les trous déjà sautés qui mènent à
      // ce dernier segment en font partie.
      let gap = f.start
      for (let moved = true; moved;) {
        moved = false
        for (const x of this.holes) if (x.start < gap && Math.abs(x.end - gap) < 0.5) { gap = x.start; moved = true }
      }
      // Seulement si la lecture y arrive par ce qui est chargé : la fin de
      // flux fixe la durée à la fin de ce qui est chargé. Arrivé dans la
      // partie manquante par un saut (barre, +10 s, lien ?t=), la VOD se
      // terminait à 1:36 au lieu de 4:10:42 (longueur sauvegardée fausse),
      // ou, rien n'étant chargé, la roue tournait sans fin. Là : l'ancien
      // chemin, relances puis « VOD indisponible ».
      if (!this.loadedUpTo(gap)) return false
      console.info(`[TwitchUnblock] VOD : fin introuvable à partir de ${formatClock(gap)}, la vidéo s'arrête là.`)
      this.pendingHole = { start: gap, end: hole.end, final: true }
      this.health?.add('missing')
      hls.trigger(eos, {})
      return true
    }
    console.info(`[TwitchUnblock] VOD : segment introuvable à ${formatClock(f.start)}, sauté.`)
    this.health?.add('missing')
    if (!this.holes.some((x) => x.start === hole.start)) this.holes.push(hole)
    this.pendingHole = hole
    this.passHole()
    return true
  }

  /** Ce qui est chargé mène-t-il sans coupure (moins d'une demi-seconde) de
   *  la position de lecture jusqu'à `to` ? Une position déjà au-delà compte
   *  si la lecture y est arrivée par là (passée d'un trou au suivant). */
  loadedUpTo(to) {
    const b = this.video.buffered
    const t = this.resumeAt()
    let end = null
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) - 0.5 <= t || (end !== null && b.start(i) - end < 0.5)) end = b.end(i)
      else break
    }
    return end !== null && Math.abs(end - to) < 0.5
  }

  /** Après un segment introuvable (hls.js arrêté) : dès que la lecture
   *  arrive au trou — ou va ailleurs que dans ce qui est chargé —, elle
   *  passe au-delà des trous connus et le chargement reprend de là (hls.js
   *  repart toujours de la position de la vidéo). */
  passHole() {
    const h = this.pendingHole
    if (!h || !this.hls) return
    const v = this.video
    const t0 = v.currentTime
    const b = v.buffered
    let buffered = false
    for (let i = 0; i < b.length; i++) if (b.start(i) - 0.1 <= t0 && t0 < b.end(i) - 0.1) buffered = true
    if (t0 < h.start - 0.5 && buffered) return
    // Fin introuvable atteinte : la vidéo se termine d'elle-même (fin de
    // flux). Seul un retour hors de ce qui est chargé relance le chargement.
    if (h.final && t0 >= h.start - 0.5) return
    this.pendingHole = null
    let to = t0
    for (let moved = true; moved;) {
      moved = false
      for (const x of this.holes) if (to >= x.start - 0.5 && to < x.end) { to = x.end; moved = true }
    }
    if (to !== t0) v.currentTime = to
    this.hls.startLoad(to)
  }

  /** Clip MP4 et HLS natif (Safari sans MSE) : un 403, un 404 ou un relais
   *  en panne laissaient la roue tourner sans fin — hls.js, lui, a ses
   *  propres erreurs (Hls.Events.ERROR). En HLS natif, un échec réseau peut
   *  venir du relais ou du Worker qui sert la vidéo : on passe à un autre,
   *  comme avec hls.js. */
  onMediaError() {
    const v = this.video
    if (this.hls || !v.currentSrc || v.currentSrc.startsWith('blob:')) return
    logError('lecteur', `vidéo : erreur ${v.error?.code ?? '?'} ${v.error?.message || ''}`)
    this.el.spinner.hidden = true
    const down = v.error?.code === 2 /* MEDIA_ERR_NETWORK */ && navigator.onLine !== false ? proxyBaseOf(v.currentSrc) : null
    if (down && this.o.onWorkerDown?.(down)) return
    this.o.onError?.()
  }

  /** Plus rien à charger (direct terminé) : hls.js arrête ses requêtes — il
   *  relisait sans fin la playlist d'un direct fini. L'image reste, en
   *  pause. */
  stop() {
    this.clearRetry()
    // Relance prévue (rebuild) et guet d'un calage annulés : le lecteur ne
    // repart pas derrière l'écran d'erreur ou de fin du direct.
    this.clearRebuild()
    this.hls?.stopLoad()
    this.video.pause()
  }

  clearRebuild() {
    clearTimeout(this.stallTimer)
    clearTimeout(this.formatStallTimer)
    clearTimeout(this.rebuildTimer)
    this.rebuildTimer = null
    // Attente d'une coupure de la chaîne abandonnée aussi : les prochains
    // segments ne relancent plus le guet.
    this.streamWait = false
  }

  destroyHls() {
    this.clearRetry()
    this.clearRebuild()
    if (this.hls) { this.hls.destroy(); this.hls = null }
    // Niveau d'Auto inconnu jusqu'au prochain LEVEL_SWITCHED : le bouton
    // ne garde pas celui de la source précédente.
    if (this.autoLevel) { this.autoLevel = ''; this.updateQualityLabel() }
  }

  destroy() {
    // Un attach() encore en attente (chargement de hls.js) ne démarre plus :
    // la vidéo pouvait partir après la fermeture, son en arrière-plan.
    this.attachToken = (this.attachToken ?? 0) + 1
    this.destroyHls()
    this.health = null
    this.endAdBreak()
    this.adBreaks.clear()
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    this.closeMenu()
    if (document.pictureInPictureElement === this.video) document.exitPictureInPicture().catch(() => {})
  }

  /** Mêmes vidéos, servies par un autre Worker (quota du premier atteint) :
   *  on garde la qualité, la position et les chapitres — `load` repartait
   *  de zéro. */
  swapLinks(links, variants = this.variants) {
    this.links = links
    this.variants = variants && typeof variants === 'object' ? variants : {}
    if (!links[this.quality]) this.quality = pickQuality(Object.keys(links), this.o.prefs.qualityPref, this.variants)
    this.health?.add('swap')
    this.updateQualityLabel()
    this.attach(links[this.quality], this.kind === 'vod' ? this.resumeAt() : 0)
  }

  /** Position à reprendre sur une autre source (relais, Worker, qualité) :
   *  celle de la vidéo, ou le départ demandé (lien ?t=, reprise) tant
   *  qu'elle ne s'y est pas encore placée — un relais qui lâchait au
   *  démarrage faisait repartir du début. */
  resumeAt() {
    return this.startPos || this.video.currentTime
  }

  /** Qualité choisie dans le menu : elle devient la qualité préférée
   *  (en hauteur : « 720p60 » → 720p, valable sur toutes les chaînes). */
  setQuality(key) {
    if (!this.links[key] || key === this.quality) return
    const at = this.resumeAt()
    const wasPaused = this.video.paused
    this.quality = key
    this.o.prefs.qualityPref = prefFromKey(key, this.variants, Object.keys(this.links))
    this.o.savePrefs()
    this.updateQualityLabel()
    this.attach(this.links[key], this.kind === 'vod' ? at : 0)
    if (wasPaused && this.kind === 'vod') this.video.addEventListener('playing', () => this.video.pause(), { once: true })
  }

  /** Bouton ⚙ : la qualité (« Auto · 360p » : ce que joue Auto), et la
   *  vitesse d'une VOD quand elle n'est pas normale (« 720p · 1,5× »). La
   *  vitesse a sa propre case : sur téléphone, la qualité est masquée faute
   *  de place, mais la vitesse reste visible (styles.css). */
  updateQualityLabel() {
    const r = this.video.playbackRate
    this.el.qLabel.textContent = this.quality ? this.menuLabel(this.quality) : ''
    this.el.qSpeed.textContent = this.kind === 'vod' && r !== 1 ? speedText(r) : ''
  }

  // ── Vitesse (VODs et clips ; jamais en direct) ─────────────────────────
  setSpeed(s) {
    if (this.kind !== 'vod' || !SPEEDS.includes(s)) return
    const v = this.video
    v.defaultPlaybackRate = s
    v.playbackRate = s
    if (this.keepSpeed && this.o.prefs.vodSpeed !== s) { this.o.prefs.vodSpeed = s; this.o.savePrefs() }
    this.updateQualityLabel()
    this.flash(speedText(s))
  }

  /** Raccourcis < et > : vitesse précédente ou suivante. */
  stepSpeed(d) {
    const i = SPEEDS.indexOf(validSpeed(this.video.playbackRate))
    this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + d))])
  }

  /** Vitesse changée hors de notre menu — plein écran natif de l'iPhone, qui
   *  a le sien : gardée au changement de qualité et retenue comme si elle
   *  venait du menu. En direct, rien (la vitesse y reste à 1×). */
  onRateChange() {
    if (this.kind !== 'vod') return
    const v = this.video
    const r = v.playbackRate
    if (SPEEDS.includes(r)) {
      if (v.defaultPlaybackRate !== r) v.defaultPlaybackRate = r
      if (this.keepSpeed && this.o.prefs.vodSpeed !== r) { this.o.prefs.vodSpeed = r; this.o.savePrefs() }
    }
    this.updateQualityLabel()
  }

  /** Source qui sert le direct, affichée dans le menu ⚙. */
  setLiveSource(id) { this.liveSource = id || null }

  /** Résumé technique joint aux signalements (main.js, feedbackInfo) :
   *  moteur (celui que hls.js utilise vraiment), qualité, source du direct,
   *  vitesse, retard, et la santé de la lecture de cette vidéo (healthBrief). */
  debugInfo() {
    const v = this.video
    const engine = this.hls ? `hls.js ${window.Hls?.version ?? '?'} ${this.engineName()}` : this.engineName()
    const q = this.quality ? `${this.quality}${this.autoLevel ? `/${this.autoLevel}` : ''}` : null
    const lat = this.kind === 'live' ? this.liveDelay() : 0
    return [engine, q, this.kind === 'live' && this.liveSource ? `src ${this.liveSource}` : null,
      `rate ${v.playbackRate}`, lat > 0 ? `delay ${lat.toFixed(1)}s` : null,
      this.adBreak ? 'ad break' : null, this.healthBrief()].filter(Boolean).join(' · ')
  }

  // ── Santé de la lecture (voir PlaybackHealth) ─────────────────────────
  /** Moteur de lecture : ManagedMediaSource ou MediaSource sous hls.js,
   *  sinon le fichier MP4 d'un clip ou le HLS natif. */
  engineName() {
    if (this.hls) return usesManagedMediaSource(this.hls.config) ? 'MMS' : 'MSE'
    return /\.mp4(\?|$)/i.test(this.video.currentSrc || '') ? 'mp4' : 'native'
  }

  /** Qui relaie la vidéo : le relais du VPS ou un Worker (rien de plus). */
  proxyName() {
    const base = proxyBaseOf(this.links?.[this.quality] || '')
    if (!base) return null
    return base === RELAY_BASE ? 'relais' : base === API_URL ? 'Worker' : 'autre Worker'
  }

  /** Tampon autour de la lecture : avance et retard (s) dans la plage où
   *  elle se trouve, et nombre de plages. */
  bufferState() {
    const v = this.video
    const b = v.buffered
    const t = v.currentTime
    let ahead = 0
    let behind = 0
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) - 0.1 <= t && t <= b.end(i) + 0.1) {
        ahead = Math.max(0, b.end(i) - t)
        behind = Math.max(0, t - b.start(i))
      }
    }
    return { ahead, behind, ranges: b.length }
  }

  /** « waiting » pendant la lecture : un décrochage — sauf au démarrage
   *  d'une source, pendant un saut ou dans la seconde qui suit, et en fin de
   *  vidéo. Fini à « playing » ou à la pause. */
  noteStall() {
    const v = this.video
    if (!this.health || !this.playedSinceAttach || v.paused || v.seeking || v.ended) return
    if (Date.now() - (this.seekedAt || 0) < 1000) return
    this.health.stallStart()
  }

  /** Pendant la lecture (timeupdate) : une minute anormale écrit une ligne
   *  au journal des erreurs (PlaybackHealth.check). */
  watchHealth() {
    const d = this.health?.check(Date.now(), this.video)
    if (d) logError('lecteur', this.healthLine(d))
  }

  /** Signalement en cours : l'état depuis la dernière ligne, écrit au
   *  journal quoi qu'il en soit (main.js, openFeedback). */
  flushHealth() {
    if (!this.health || (!this.hls && !this.video.currentSrc)) return
    logError('lecteur', this.healthLine(this.health.check(Date.now(), this.video, { force: true }), true))
  }

  /** Ligne du journal : où (direct ou VOD, moteur, qualité, relais,
   *  position, durée couverte), puis les décrochages, les images perdues,
   *  le tampon, le débit mesuré face à celui de la qualité, les arrêts de
   *  ManagedMediaSource, les réparations et ce que hls.js a réglé seul. Le
   *  journal coupe à 300 caractères : les listes, de longueur variable,
   *  passent en dernier (placés après elles, les arrêts MMS — ce que la
   *  ligne doit dire sur iPhone — tombaient d'une minute chargée). */
  healthLine(d, forced = false) {
    const c = d.c
    const b = this.bufferState()
    const mbps = (bps) => (bps / 1e6).toFixed(1)
    const level = this.hls?.levels?.[this.hls.currentLevel]
    const rate = level?.realBitrate || level?.bitrate || this.variants?.[this.quality]?.bw || 0
    const bw = this.hls?.bandwidthEstimate
    const list = (labels) => Object.entries(labels).filter(([k]) => c[k] > 0).map(([k, label]) => counted(c[k], label)).join(', ')
    const fixes = list(HEALTH_FIXES)
    const issues = list(HLS_ISSUES)
    const where = [this.kind, this.engineName(), this.quality ? qualityLabel(this.quality) : null, this.proxyName()].filter(Boolean).join(' ')
    const head = `santé${forced ? ' (signalement)' : ''} ${where} à ${formatClock(this.video.currentTime || 0)}, ${Math.max(1, Math.round(d.ms / 60_000))} min`
    const parts = [
      `${c.stalls || 0} décrochage${c.stalls > 1 ? 's' : ''}${c.stalls ? ` (${((c.stallMs || 0) / 1000).toFixed(1)} s)` : ''}`,
      d.total > 0 ? `${((100 * d.dropped) / d.total).toFixed(1)} % d'images perdues (${d.dropped}/${d.total})` : null,
      `tampon +${b.ahead.toFixed(0)}/-${b.behind.toFixed(0)} s${b.ranges > 1 ? ` (${b.ranges} plages)` : ''}`,
      bw > 0 ? `débit ${mbps(bw)}${rate > 0 ? ` pour ${mbps(rate)}` : ''} Mb/s` : null,
      c.mmsPause || c.mmsSeek
        ? `MMS : ${counted(c.mmsPause || 0, ['arrêt', 'arrêts'])}${c.mmsSeek ? `, ${counted(c.mmsSeek, ['reprise au saut', 'reprises au saut'])}` : ''}` : null,
      fixes ? `réparations : ${fixes}` : null,
      issues ? `hls.js : ${issues}` : null,
    ]
    return `${head} : ${parts.filter(Boolean).join(' · ')}`
  }

  /** Santé de la vidéo, cumulée, pour debugInfo : décrochages, images
   *  perdues, tampon, réparations, arrêts de ManagedMediaSource. */
  healthBrief() {
    const h = this.health
    if (!h) return null
    h.readFrames(this.video)
    const s = h.snapshot(Date.now())
    const c = s.c
    const b = this.bufferState()
    const fixes = Object.keys(HEALTH_FIXES).reduce((n, k) => n + (c[k] || 0), 0)
    return [`stalls ${c.stalls || 0}${c.stalls ? ` (${Math.round((c.stallMs || 0) / 1000)}s)` : ''}`,
      s.total > 0 ? `drops ${((100 * s.dropped) / s.total).toFixed(1)}%` : null,
      `buf +${Math.round(b.ahead)}/-${Math.round(b.behind)}s`, fixes ? `fixes ${fixes}` : null,
      c.mmsPause ? `mms ${c.mmsPause}` : null].filter(Boolean).join(' · ')
  }

  /** Libellé dans le menu et sur le bouton : « Auto · 720p » une fois le
   *  débit connu. */
  menuLabel(k) {
    const base = qualityText(k)
    return k.toLowerCase() === 'auto' && k === this.quality && this.autoLevel ? `${base} · ${this.autoLevel}` : base
  }

  // ── Lecture ────────────────────────────────────────────────────────────
  togglePlay() {
    if (this.video.paused) this.tryPlay()
    else this.video.pause()
  }

  seekBy(delta) {
    const v = this.video
    if (this.kind === 'live') {
      // Direct : dans la fenêtre que garde Twitch (~30 s), comme dans le
      // lecteur incrusté (PiP) — avancer rapproche du direct.
      if (!v.seekable.length) return
      const start = v.seekable.start(0)
      // Bord sans les segments annoncés d'avance : ils ne sont pas encore là.
      // Avancer s'arrête au plancher du retard (MIN_LIVE_DELAY).
      const end = v.seekable.end(v.seekable.length - 1) - (this.prefetchAhead || 0)
      const ceiling = end - Math.max(1.5, this.behindTarget ?? this.minBehind())
      const to = Math.max(start, Math.min(ceiling, v.currentTime + delta))
      v.currentTime = to
      // Recul voulu : plus aucun saut automatique vers le direct (il annulait
      // le −10 s). Revenu près du bord en avançant : on suit de nouveau.
      this.aligned = true
      if (delta < 0) this.holdingBehind = true
      else if (ceiling - to <= 3) this.holdingBehind = false
    } else {
      const d = Number.isFinite(v.duration) ? v.duration : Infinity
      v.currentTime = Math.max(0, Math.min(d - 1, v.currentTime + delta))
    }
    this.flash(delta > 0 ? `+${delta} s` : `${delta} s`)
  }

  /**
   * Retard réel de l'image sur le direct, en secondes : l'heure à laquelle
   * l'image affichée a été filmée (EXT-X-PROGRAM-DATE-TIME, inscrite par
   * Twitch à la réception) comparée à maintenant. C'est ce qui sépare le
   * chat — en temps réel — de ce qu'on voit, encodage compris ; la seule
   * distance au bord de la playlist (`hls.latency`) en oubliait une part.
   */
  liveDelay() {
    if (this.kind !== 'live') return 0
    let playing = null
    const pd = this.hls?.playingDate
    if (pd instanceof Date && Number.isFinite(pd.getTime())) playing = pd.getTime()
    else if (typeof this.video.getStartDate === 'function') {
      // HLS natif (Safari) : date de début du flux + position.
      const start = this.video.getStartDate()?.getTime()
      if (Number.isFinite(start) && start > 0) playing = start + this.video.currentTime * 1000
    }
    let delay = playing ? (Date.now() - playing) / 1000 : this.hls?.latency
    if (!Number.isFinite(delay) || delay < 0) return 0
    return Math.min(delay, 90)
  }

  /**
   * Retard à appliquer au chat : notre distance au bord du direct. Les
   * messages viennent de spectateurs qui regardent eux-mêmes près de ce
   * bord. La latence totale (liveDelay) compte en plus leur propre retard
   * et, surtout, le délai que certaines chaînes ajoutent à leur diffusion —
   * que ces spectateurs subissent aussi : le chat arrivait alors 10 s trop
   * tard, ou plus.
   */
  chatDelay() {
    if (this.kind !== 'live') return 0
    const v = this.video
    // Distance au bord de la playlist, sans les segments annoncés d'avance
    // (pas encore finis : les autres spectateurs ne les voient pas encore).
    let behind = this.hls ? this.hls.latency - (this.prefetchAhead || 0) : NaN
    // Calage en cours : l'image est figée, le direct avance. hls.js ne refait
    // sa mesure qu'à la reprise de la lecture : le temps d'attente s'y ajoute
    // d'ici là (le chat synchronisé suit ainsi le calage). Sauf pendant une
    // coupure de la chaîne (liveStallWait) : le direct n'avance pas non plus,
    // le retard reste celui d'avant. Les messages, qui arrivent toujours,
    // s'empilaient jusqu'au plafond de 60 s et sortaient d'un coup à la reprise.
    if (behind > 0 && this.stalledAt) behind += liveStallWait(this) / 1000
    // Position encore à 0 : le premier saut vers le direct n'a pas eu lieu,
    // pas de mesure (le chat aurait attendu 60 s).
    if (!(behind > 0) && v.seekable.length && v.currentTime > 0) behind = v.seekable.end(v.seekable.length - 1) - (this.prefetchAhead || 0) - v.currentTime
    if (!Number.isFinite(behind) || behind < 0) return 0
    return Math.min(behind, 60)
  }

  goLive() {
    const v = this.video
    // liveSyncPosition suit la cible relevée par holdLiveFloor.
    if (this.hls?.liveSyncPosition) v.currentTime = this.hls.liveSyncPosition
    else if (v.seekable.length) v.currentTime = Math.max(0, v.seekable.end(v.seekable.length - 1) - MIN_LIVE_DELAY - 2)
    this.holdingBehind = false
    this.aligned = true
    this.driftSince = 0
    this.lastRealign = Date.now()
    if (v.paused) this.tryPlay()
  }

  /** Distance minimale au dernier segment complet : plus courte quand les
   *  segments annoncés d'avance sont demandés (qualité fixe). En « Auto »,
   *  hls.js vise de toute façon bord − 6 s au plus près (voir plus haut) :
   *  les 4 s ne bornent alors que l'avance à la main (+10 s). */
  minBehind() {
    return this.prefetchAhead ? LIVE_BEHIND_COMPLETE : LIVE_BEHIND_PLAIN
  }

  /** Retard sur la position visée par hls.js (cible relevée comprise), en
   *  secondes ; NaN tant qu'elle n'est pas connue. */
  liveLag() {
    const sync = this.hls?.liveSyncPosition
    return Number.isFinite(sync) ? sync - this.video.currentTime : NaN
  }

  /** Recalage unique au démarrage d'un direct : s'il a été lent, un saut vers
   *  la cible dans ce qui est déjà chargé (sans nouveau téléchargement, donc
   *  sans calage). Rien après LIVE_REALIGN_MS : la dérive prend le relais. */
  alignLive() {
    const v = this.video
    if (this.aligned || !this.hls || v.paused) return
    const now = Date.now()
    this.alignFrom ||= now
    const sync = this.hls.liveSyncPosition
    // Plage chargée où se trouve la lecture : avant le premier saut de
    // hls.js vers le direct, la position vaut encore 0, hors de tout tampon.
    const b = v.buffered
    let range = -1
    for (let i = 0; i < b.length; i++) if (b.start(i) - 0.1 <= v.currentTime && v.currentTime < b.end(i)) range = i
    if (range >= 0 && this.liveLag() > LIVE_REALIGN && b.end(range) - 0.5 > sync) {
      console.info(`[TwitchUnblock] Direct : recalage de ${this.liveLag().toFixed(1)} s au démarrage.`)
      v.currentTime = sync
      this.aligned = true
      this.lastRealign = now
    } else if (now - this.alignFrom > LIVE_REALIGN_MS) this.aligned = true
  }

  /** Tient le retard affiché au-dessus de MIN_LIVE_DELAY (voir plus haut) et
   *  rattrape une dérive par un saut, toutes les 2 s pendant la lecture d'un
   *  direct. */
  holdLiveFloor() {
    const v = this.video
    if (this.kind !== 'live' || !this.hls || v.paused) return
    const now = Date.now()
    if (now - (this.floorCheckAt || 0) < 2000) return
    // Pas de contrôle depuis un moment (pause, onglet en veille) : la dérive
    // se compte de nouveau depuis la reprise.
    if (now - (this.floorCheckAt || 0) > 4000) this.driftSince = 0
    this.floorCheckAt = now

    // Dérive : trop loin de la cible pendant LIVE_DRIFT_MS → retour au
    // direct, sauf après un recul voulu. Une pause longue y revient aussi.
    const lag = this.liveLag()
    // Revenu près de la cible sans Direct ni +10 s (hls.js recale lui-même
    // une lecture sortie de la fenêtre du direct) : le recul voulu est fini,
    // sinon plus aucune dérive n'était rattrapée de la séance.
    if (this.holdingBehind && lag < 3) this.holdingBehind = false
    if (this.holdingBehind || !(lag > LIVE_DRIFT)) this.driftSince = 0
    else {
      this.driftSince ||= now
      if (now - this.driftSince >= LIVE_DRIFT_MS && now - (this.lastRealign || 0) > LIVE_JUMP_GAP_MS) {
        console.info(`[TwitchUnblock] Direct : dérive de ${lag.toFixed(1)} s, retour au direct.`)
        this.goLive()
        return
      }
    }

    const total = this.liveDelay()
    const behind = this.chatDelay()
    if (!(total > 0) || !(behind > 0)) return
    // Retard total plus court que la distance au bord : impossible, c'est
    // l'horloge de l'appareil qui retarde. Plancher sans objet (il reculait
    // l'image en boucle toutes les 8 à 15 s).
    if (total < behind - 0.5) return
    // Délai de publication de Twitch = retard total − distance au bord.
    const publish = Math.max(0, total - behind)
    const min = this.minBehind()
    const want = Math.min(8, Math.max(min, MIN_LIVE_DELAY + 0.5 - publish))
    if (Math.abs(want - (this.behindTarget ?? min)) > 0.4) {
      this.behindTarget = want
      this.hls.config.liveSyncDuration = (this.prefetchAhead || 0) + want
    }
    // Déjà sous le seuil : on recule tout de suite (une fois par minute).
    if (total < MIN_LIVE_DELAY - 0.2 && now - (this.floorSeekAt || 0) > LIVE_FLOOR_SEEK_MS) {
      this.floorSeekAt = now
      v.currentTime = Math.max(0, v.currentTime - (MIN_LIVE_DELAY + 0.5 - total))
    }
  }

  toggleMute() {
    const v = this.video
    if (v.muted || v.volume === 0) {
      v.muted = false
      if (v.volume === 0) v.volume = 0.5
    } else v.muted = true
    this.el.unmute.hidden = true
  }

  flash(text) {
    const f = this.el.flash
    f.textContent = text
    f.classList.remove('show')
    void f.offsetWidth
    f.classList.add('show')
  }

  // ── Synchronisation de l'affichage ─────────────────────────────────────
  syncPlay() {
    const paused = this.video.paused
    this.root.classList.toggle('paused', paused)
    const ic = icon(paused ? 'play' : 'pause', 22)
    this.el.play.innerHTML = ic
    this.el.play.title = t(paused ? 'play' : 'pause')
    this.el.big.innerHTML = icon(paused ? 'play' : 'pause', 30)
  }

  syncVolume() {
    const v = this.video
    const muted = v.muted || v.volume === 0
    this.el.mute.innerHTML = icon(muted ? 'mute' : 'volume', 21)
    this.el.mute.title = t(muted ? 'unmute' : 'mute')
    if (document.activeElement !== this.el.vol) this.el.vol.value = String(muted ? 0 : v.volume)
    this.el.vol.style.setProperty('--fill', `${(muted ? 0 : v.volume) * 100}%`)
    // Son remis pendant une pause pub : choix respecté jusqu'à sa fin.
    if (this.adMuted && !v.muted) { this.adMuted = false; this.adKeepSound = true }
    // Son remis, d'où que ce soit (pastille, curseur, flèche Haut, M) : le
    // muet de la lecture automatique est fini, la pastille s'en va — elle
    // restait affichée.
    if (!v.muted) this.autoMuted = false
    if (!muted) this.el.unmute.hidden = true
    this.o.prefs.volume = v.volume
    // Le son coupé par une pause pub ou par le refus de la lecture
    // automatique n'est pas un choix : pas retenu.
    this.o.prefs.muted = this.adMuted || this.autoMuted ? false : v.muted
    this.o.savePrefs()
  }

  onTime() {
    const v = this.video
    const cur = v.currentTime
    // La lecture a repris après un calage : la mesure de hls.js le compte.
    if (this.stalledAt && cur !== this.stallPos) this.stalledAt = 0
    if (this.kind === 'vod') {
      const d = v.duration
      // Pendant un glissement, la barre et le compteur suivent le doigt
      // (scrubTo) : les réécrire ici avec la position courante effaçait
      // aussitôt l'instant visé.
      if (!this.dragging) {
        if (Number.isFinite(d) && d > 0) {
          this.el.time.textContent = `${formatClock(cur)} / ${formatClock(d)}`
          this.drawPosition(cur / d)
        } else this.el.time.textContent = formatClock(cur)
      }
    } else {
      // Direct : à quelle distance du bord est-on ?
      let behind = 0
      if (this.hls?.liveSyncPosition) behind = this.hls.liveSyncPosition - cur
      else if (v.seekable.length) behind = v.seekable.end(v.seekable.length - 1) - cur - 6
      const atEdge = behind < 8
      this.el.live.classList.toggle('behind', !atEdge)
      this.el.liveText.textContent = atEdge ? t('live_now') : `${t('live_now')} −${formatClock(behind)}`
      this.el.live.title = atEdge ? '' : t('go_live')
      const lat = this.liveDelay()
      this.el.latency.textContent = lat > 0 ? `${lat.toFixed(1)} s` : ''
      this.alignLive()
      this.holdLiveFloor()
      this.checkAdBreak()
    }
    if (this.kind === 'vod') {
      this.updateMutedNote(cur)
      if (this.pendingHole) this.passHole()
    }
    this.watchHealth()
    this.o.onTime?.(cur, v.duration)
  }

  /** Playlist de direct : segments annoncés d'avance changés en segments
   *  ordinaires, et cible de retard ajustée à ce qu'ils ajoutent au bord. */
  withPrefetch(text) {
    const lines = text.split('\n')
    const durs = lines.filter((l) => l.startsWith('#EXTINF:')).map((l) => parseFloat(l.slice(8))).filter((d) => d > 0)
    const dur = durs.length ? durs[durs.length - 1] : 2
    let added = 0
    const out = lines.map((l) => {
      if (!l.startsWith(PREFETCH_TAG)) return l
      added++
      return `#EXTINF:${dur.toFixed(3)},live\n${l.slice(PREFETCH_TAG.length).trim()}`
    })
    const ahead = added * dur
    if (ahead !== this.prefetchAhead && this.hls) {
      this.prefetchAhead = ahead
      // Cible comptée depuis le bord annoncé, segments d'avance compris
      // (relevée par holdLiveFloor si le retard affiché passait sous 4 s).
      this.hls.config.liveSyncDuration = ahead + (this.behindTarget ?? LIVE_BEHIND_COMPLETE)
    }
    return out.join('\n')
  }

  // ── Pauses pub (direct) ────────────────────────────────────────────────
  /** Pauses pub annoncées par la playlist (voir AD_CLASS) : les AD_KEEP plus
   *  récentes gardées, sans dépendre de l'horloge de l'appareil. */
  readAdBreaks(details) {
    for (const r of Object.values(details?.dateRanges ?? {})) {
      if (r?.class !== AD_CLASS) continue
      const start = r.startDate?.getTime()
      const end = r.endDate?.getTime()
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      this.adBreaks.delete(r.id)
      this.adBreaks.set(r.id, { start, end })
    }
    while (this.adBreaks.size > AD_KEEP) this.adBreaks.delete(this.adBreaks.keys().next().value)
    this.checkAdBreak()
  }

  /** Bandeau et son selon l'heure de l'image affichée. Appelé à chaque
   *  timeupdate d'un direct et à chaque playlist lue. */
  checkAdBreak() {
    if (this.kind !== 'live') { this.endAdBreak(); return }
    if (!this.adBreaks.size && !this.adBreak) return
    const pd = this.hls?.playingDate
    const at = pd instanceof Date ? pd.getTime() : NaN
    // Heure de l'image inconnue (nouvelle source en cours de chargement) :
    // rien ne change, le minuteur de secours referme le bandeau.
    if (!Number.isFinite(at)) return
    // Pendant une pause : un trou de moins d'une seconde entre deux pubs ne
    // la referme pas (le son revenait un instant).
    const end = adBreakEnd(this.adBreaks.values(), at) || (this.adBreak ? adBreakEnd(this.adBreaks.values(), at + 1000) : 0)
    if (!end) { this.endAdBreak(); return }
    const v = this.video
    if (!this.adBreak) {
      // Comptée une fois (/stats), même si le bandeau se rouvre (pause,
      // autre qualité, autre Worker) pendant la même pause pub.
      let seen = this.adSeen.find((s) => s.start <= end && at <= s.end + 1000)
      if (!seen) {
        seen = { start: at, end }
        this.adSeen.push(seen)
        if (this.adSeen.length > AD_KEEP) this.adSeen.shift()
        this.o.onAdBreak?.()
      }
      this.adBreak = { end, seen }
      console.info(`[TwitchUnblock] Direct : pause pub de la chaîne, ${Math.round((end - at) / 1000)} s.`)
      this.el.adTitle.textContent = t('ad_break_title')
      this.el.adHint.textContent = t('ad_break_site_hint')
      this.el.ad.hidden = false
      // Son coupé seulement s'il ne l'était pas déjà ; rétabli à la fin.
      if (!this.adKeepSound && !v.muted) { this.adMuted = true; v.muted = true }
      // Qualités supérieures (hq.js) : une pause sur le flux du compte fait
      // passer sur la source sans pub. Hors de l'événement de hls.js (qui
      // appelle ici), et si le bandeau est toujours là.
      setTimeout(() => { if (this.adBreak) this.o.onAdState?.(this.adBreakLeft()) }, 0)
    }
    // Une pub de plus enchaînée : fin repoussée, y compris pour le compte
    // (un bandeau rouvert dans la partie ajoutée n'est pas recompté).
    this.adBreak.end = end
    this.adBreak.seen.end = Math.max(this.adBreak.seen.end, end)
    const sub = t('ad_break_sub', { n: Math.max(1, Math.ceil((end - at) / 1000)) })
    if (this.el.adSub.textContent !== sub) this.el.adSub.textContent = sub
    // Secours : plus rien n'arrive (ni image ni playlist : flux arrêté,
    // onglet en veille) → bandeau fermé et son rétabli 5 s après la fin
    // prévue ; s'il reste de la pause à la reprise, il se rouvre. En pause,
    // la playlist continue d'arriver : l'image reste sur la pub, le bandeau
    // aussi.
    clearTimeout(this.adTimer)
    this.adTimer = setTimeout(() => this.endAdBreak(), end - at + 5000)
  }

  endAdBreak() {
    clearTimeout(this.adTimer)
    this.adTimer = null
    if (!this.adBreak) return
    this.adBreak = null
    this.adKeepSound = false
    this.el.ad.hidden = true
    if (this.adMuted) {
      this.adMuted = false
      this.video.muted = false
    }
    this.o.onAdState?.(0)
  }

  /** Secondes qui restent à la pause pub affichée (0 hors pause). */
  adBreakLeft() {
    if (!this.adBreak) return 0
    const pd = this.hls?.playingDate
    const at = pd instanceof Date ? pd.getTime() : NaN
    return Number.isFinite(at) ? Math.max(1, Math.ceil((this.adBreak.end - at) / 1000)) : 1
  }

  /** Autre flux du même direct (qualités supérieures ↔ source habituelle,
   *  hq.js) : ses pauses pub ne sont pas forcément celles-ci. Bandeau fermé,
   *  son rétabli ; celles déjà comptées le restent (adSeen). */
  forgetAdBreaks() {
    this.endAdBreak()
    this.adBreaks.clear()
  }

  // ── Format du son (direct) ─────────────────────────────────────────────
  /** Init segment produit par hls.js : son format, noté pour sa rupture du
   *  flux (voir AUDIO_RESET_MS). */
  noteAudioFormat(d) {
    const tracks = d?.tracks || {}
    const fmt = audioFormatOf(tracks.audio?.initSegment || tracks.audiovideo?.initSegment)
    const cc = d?.frag?.cc
    if (!fmt || !Number.isFinite(cc)) return
    this.audioFormats.set(cc, { cc, ...fmt })
    // Les ruptures passées depuis longtemps ne servent plus.
    while (this.audioFormats.size > 8) this.audioFormats.delete(this.audioFormats.keys().next().value)
  }

  /** L'image passe au segment `frag` : d'une autre rupture du flux, avec un
   *  autre format de son que celui qui jouait, la vidéo est rattachée à neuf
   *  un peu après le début du segment (le lecteur repart bien dans celui-ci,
   *  pas dans le précédent). */
  checkAudioFormat(hls, frag) {
    if (!Number.isFinite(frag?.cc)) return
    const fmt = this.audioFormats.get(frag.cc)
    if (!fmt) return
    const was = this.audioPlaying
    this.audioPlaying = fmt
    if (!was || was.cc === fmt.cc || was.key === fmt.key) return
    const now = Date.now()
    if (now - this.audioResetAt < AUDIO_RESET_MS) return
    this.audioResetAt = now
    this.health?.add('audio')
    logError('lecteur', `son du direct : ${audioLabel(was)} → ${audioLabel(fmt)}, lecteur remis à neuf`)
    setTimeout(() => { if (this.hls === hls) recoverMedia(hls, this.video, -1) }, 400)
  }

  /** Format du son qui attend après la rupture en cours, s'il diffère de
   *  celui qui joue (fin d'un écran de pub) ; null sinon. */
  audioFormatAhead() {
    const now = this.audioPlaying
    if (!now) return null
    for (const f of this.audioFormats.values()) if (f.cc > now.cc && f.key !== now.key) return f
    return null
  }

  /** Direct calé (« waiting ») avant une rupture dont le son change de
   *  format : nouvelle instance au bout de FORMAT_STALL_MS si l'image n'a pas
   *  bougé (le cas général : watchStall). */
  watchFormatStall() {
    const ahead = this.audioFormatAhead()
    if (!ahead) return
    clearTimeout(this.formatStallTimer)
    const token = this.attachToken
    const was = this.audioPlaying
    this.formatStallTimer = setTimeout(() => {
      const v = this.video
      if (token !== this.attachToken || !this.hls || !this.stalledAt || v.paused || v.currentTime !== this.stallPos) return
      if (document.hidden || navigator.onLine === false) return
      this.health?.add('audio')
      logError('lecteur', `son du direct : image figée avant ${audioLabel(ahead)} (après ${audioLabel(was)}), relance`)
      this.rebuild(token)
    }, FORMAT_STALL_MS)
  }

  // ── Passages coupés ────────────────────────────────────────────────────
  /** Playlist de VOD lue : passages « -unmuted.mp4 », qui ont le son. */
  readSoundSpans(details) {
    const spans = soundSpansOf(details?.fragments)
    if (JSON.stringify(spans) === JSON.stringify(this.soundSpans)) return
    this.soundSpans = spans
    this.drawMuted()
    this.updateMutedNote(this.video.currentTime)
  }

  /** Passages au son coupé par Twitch : en orange sur la barre, et un avis
   *  (avec « Passer ») pendant qu'on les regarde. Ceux dont le son a pu être
   *  rétabli (unmuteLoader) sont retirés. */
  setMuted(list) {
    this.muted = (list ?? []).map((r) => ({ start: r.start, end: r.end }))
    this.drawMuted()
    this.updateMutedNote(this.video.currentTime)
    if (!this.mutedDurHooked) {
      this.mutedDurHooked = true
      this.video.addEventListener('durationchange', () => this.drawMuted())
    }
  }

  /** Passages encore muets : les coupés, moins ce qui a été rétabli et ce
   *  qui a le son d'origine (« -unmuted.mp4 »). */
  remainingMuted() {
    let out = this.muted ?? []
    for (const s of [...(this.unmutedSpans ?? []), ...(this.soundSpans ?? [])]) {
      out = out.flatMap((r) => {
        if (s.end <= r.start || s.start >= r.end) return [r]
        const parts = []
        if (s.start > r.start + 0.5) parts.push({ start: r.start, end: s.start })
        if (s.end < r.end - 0.5) parts.push({ start: s.end, end: r.end })
        return parts
      })
    }
    return out
  }

  mutedAt(t0) {
    return this.remainingMuted().find((r) => t0 >= r.start && t0 < r.end) ?? null
  }

  /** Segment au son rétabli : fusionné avec les passages rétablis qu'il
   *  touche. Une entrée par segment s'ajoutait sans fin (des milliers sur
   *  une longue VOD), et chaque timeupdate les reparcourait toutes
   *  (updateMutedNote → remainingMuted). */
  markUnmuted(frag) {
    if (!frag || !Number.isFinite(frag.start)) return
    const span = { start: frag.start, end: frag.start + (frag.duration || 0) }
    this.unmutedSpans = (this.unmutedSpans ?? []).filter((s) => {
      if (s.end < span.start - 0.1 || s.start > span.end + 0.1) return true
      span.start = Math.min(span.start, s.start)
      span.end = Math.max(span.end, s.end)
      return false
    })
    this.unmutedSpans.push(span)
    this.drawMuted()
    // Dit une fois (par minute au plus) que le son est revenu.
    if (Date.now() - (this.unmutedToldAt || 0) > 60000) {
      this.unmutedToldAt = Date.now()
      this.flash(t('vod_unmuted'))
    }
  }

  drawMuted() {
    const track = this.el.progress.querySelector('.p-track')
    for (const n of track.querySelectorAll('.p-mutedseg')) n.remove()
    const d = this.video.duration
    if (!Number.isFinite(d) || d <= 0) return
    for (const r of this.remainingMuted()) {
      const seg = document.createElement('i')
      seg.className = 'p-mutedseg'
      seg.style.left = `${(r.start / d) * 100}%`
      seg.style.width = `${Math.max(0.2, ((Math.min(r.end, d) - r.start) / d) * 100)}%`
      track.appendChild(seg)
    }
  }

  updateMutedNote(cur) {
    const r = this.kind === 'vod' ? this.mutedAt(cur) : null
    const note = this.el.mutedNote
    if (!r) { note.hidden = true; return }
    if (note.hidden) {
      this.el.mutedText.textContent = t('vod_muted_here')
      $('span', this.el.mutedSkip).textContent = t('vod_muted_skip')
      note.hidden = false
    }
  }

  drawPosition(ratio) {
    const r = Math.max(0, Math.min(1, ratio))
    this.el.played.style.width = `${r * 100}%`
    this.el.knob.style.left = `${r * 100}%`
  }

  drawBuffer() {
    const v = this.video
    if (this.kind !== 'vod' || !v.buffered.length || !Number.isFinite(v.duration)) return
    let end = 0
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 1) end = Math.max(end, v.buffered.end(i))
    }
    this.el.buffer.style.width = `${(end / v.duration) * 100}%`
  }

  positionFrom(e) {
    const d = this.video.duration
    if (!Number.isFinite(d) || d <= 0) return null
    const rect = this.el.progress.getBoundingClientRect()
    const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return r * d
  }

  /** Glissement sur la barre : curseur, infobulle ET compteur suivent le
   *  doigt. Avant, le compteur gardait la position courante : sur téléphone,
   *  où le pouce cache l'infobulle, on visait à l'aveugle. */
  scrubTo(e) {
    const target = this.positionFrom(e)
    if (target === null) return
    this.drawPosition(target / this.video.duration)
    this.el.time.textContent = `${formatClock(target)} / ${formatClock(this.video.duration)}`
    this.hoverTip(e)
  }

  /** Chapitres de la VOD (changements de jeu) : repères sur la barre, et
   *  nom du chapitre dans l'infobulle. */
  setChapters(list) {
    this.chapters = list ?? []
    for (const n of this.el.progress.querySelectorAll('.p-chap')) n.remove()
    this.el.chapBtn.hidden = this.chapters.length < 2
    this.el.chapLabel.textContent = ''
    this.updateChapterLabel()
    // Durée réelle de la vidéo dès qu'elle est connue : le dernier chapitre
    // d'une VOD encore en cours d'enregistrement a une durée nulle.
    const d = this.video.duration
    const total = Math.max(Number.isFinite(d) ? d : 0, ...this.chapters.map((c) => c.start + c.duration))
    if (this.chapters.length < 2 || !total) return
    if (!this.chapDurHooked) {
      this.chapDurHooked = true
      this.video.addEventListener('durationchange', () => { if (this.chapters?.length > 1) this.setChapters(this.chapters) })
    }
    for (const c of this.chapters.slice(1)) {
      if (c.start >= total - 1) continue
      const mark = document.createElement('i')
      mark.className = 'p-chap'
      mark.style.left = `${(c.start / total) * 100}%`
      this.el.progress.appendChild(mark)
    }
  }

  hoverTip(e) {
    const target = this.positionFrom(e)
    if (target === null) return
    const rect = this.el.progress.getBoundingClientRect()
    const chap = this.chapters?.length > 1 ? this.chapters.findLast((c) => c.start <= target) : null
    this.el.tip.textContent = chap ? `${formatClock(target)} · ${chap.title}` : formatClock(target)
    this.el.tip.hidden = false
    // Bornée par sa propre largeur, mesurée une fois le texte posé : avec un
    // nom de chapitre, l'infobulle centrée sur le curseur sortait du lecteur
    // près des bords.
    const half = Math.min(this.el.tip.offsetWidth / 2, rect.width / 2)
    const x = Math.max(half, Math.min(rect.width - half, e.clientX - rect.left))
    this.el.tip.style.left = `${x}px`
  }

  // ── Commandes visibles / masquées ──────────────────────────────────────
  showUI() {
    this.root.classList.add('ui')
    this.scheduleHide()
  }

  scheduleHide(delay = HIDE_AFTER) {
    clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      if (this.video.paused || this.dragging || !this.el.menu.hidden) return
      // Souris sur les commandes : elles restent. Pas sur un écran tactile,
      // où le survol « colle » au dernier bouton touché (iPhone, iPad) : les
      // commandes ne se masquaient plus.
      if (matchMedia('(hover: hover)').matches && this.root.matches(':hover') && this.root.querySelector('.p-bottom:hover')) return
      this.root.classList.remove('ui')
    }, delay)
  }

  /** Toucher : un tap montre ou cache les commandes, un double-tap sur un
   *  côté avance ou recule de 10 s. Souris : un clic met en pause. */
  onSurfaceClick(e) {
    if (e.target.closest('.p-bottom, .p-menu, .p-big, .p-unmute')) return
    if (!this.el.menu.hidden) { this.closeMenu(); return }
    const touch = !matchMedia('(pointer: fine)').matches
    // Le clic sur l'image peut être désactivé dans les réglages (« clickPause »).
    if (!touch) { if (this.o.prefs.clickPause !== false) this.togglePlay(); this.showUI(); return }

    const now = Date.now()
    const rect = this.root.getBoundingClientRect()
    const side = e.clientX - rect.left < rect.width / 2 ? -10 : 10
    if (now - this.lastTap < 300 && this.kind === 'vod') {
      clearTimeout(this.tapTimer)
      this.seekBy(side)
      this.lastTap = 0
      return
    }
    this.lastTap = now
    clearTimeout(this.tapTimer)
    this.tapTimer = setTimeout(() => {
      if (this.root.classList.contains('ui') && !this.video.paused) this.root.classList.remove('ui')
      else this.showUI()
    }, this.kind === 'vod' ? 260 : 0)
  }

  onKey(e) {
    if (e.target.closest('input, textarea, [contenteditable]')) return
    if (e.key === 'Escape' && !this.el.menu.hidden) { this.closeMenu(); return }
    const k = e.key.toLowerCase()
    const handled = {
      ' ': () => this.togglePlay(),
      k: () => this.togglePlay(),
      f: () => this.toggleFullscreen(),
      m: () => this.toggleMute(),
      c: () => this.o.onToggleChat(),
      t: () => this.o.onTheatre?.(),
      '?': () => this.o.onHelp?.(),
      '0': () => { if (this.kind === 'vod') this.video.currentTime = 0 },
      arrowleft: () => this.seekBy(-10),
      arrowright: () => this.seekBy(10),
      j: () => this.seekBy(-10),
      l: () => this.seekBy(10),
      // Arrondi au centième : 1 − 10 × 0,1 donnait 1,4e-16, jamais 0 (l'icône
      // restait sur « son »).
      arrowup: () => { this.video.muted = false; this.video.volume = Math.min(1, Math.round((this.video.volume + 0.1) * 100) / 100) },
      arrowdown: () => { this.video.volume = Math.max(0, Math.round((this.video.volume - 0.1) * 100) / 100) },
      // Vitesse (VOD, clip) : e.key vaut « < » et « > », AZERTY compris.
      '<': this.kind === 'vod' ? () => this.stepSpeed(-1) : null,
      '>': this.kind === 'vod' ? () => this.stepSpeed(1) : null,
    }[k]
    if (!handled) return
    e.preventDefault()
    handled()
    this.showUI()
  }

  // ── Menu qualité / vitesse ─────────────────────────────────────────────
  toggleMenu() {
    if (!this.el.menu.hidden) return this.closeMenu()
    const keys = sortQualities(Object.keys(this.links), this.variants)
    const rate = this.video.playbackRate
    let html = `<div class="p-menu-title">${esc(t('quality'))}</div>`
    html += keys.map((k) => `<button type="button" data-q="${esc(k)}" class="${k === this.quality ? 'on' : ''}">
      <span>${esc(this.menuLabel(k))}</span>${k === this.quality ? icon('check', 16) : ''}</button>`).join('')
    // Direct : la source (proxy) qui sert le flux, et de quoi en changer.
    if (this.kind === 'live' && this.o.onSource) {
      // Dans l'ordre des réglages ; en choisir une la met en tête. Cochée :
      // celle qui sert le direct (la première de l'ordre si on l'ignore) —
      // pas toujours la première, quand un secours a pris le relais.
      const order = liveSourceOrder(this.o.prefs)
      const current = this.liveSource ?? order[0]
      html += `<div class="p-menu-title">${esc(t('live_source'))}${this.liveSource ? ` · ${esc(t(`src_${this.liveSource}`))}` : ''}</div>`
      html += order.map((id) => `<button type="button" data-src="${id}" class="${id === current ? 'on' : ''}">
        <span>${esc(t(`src_${id}`))}</span>${id === current ? icon('check', 16) : ''}</button>`).join('')
    }
    if (this.kind === 'vod') {
      html += `<div class="p-menu-title">${esc(t('speed'))}</div><div class="p-speeds">`
      // Quatre par ligne : « 1× » plutôt que « Normale », trop large ici.
      html += SPEEDS.map((s) => `<button type="button" data-s="${s}" class="${s === rate ? 'on' : ''}"${s === 1 ? ` title="${esc(t('normal'))}"` : ''}>${speedText(s)}</button>`).join('')
      html += '</div>'
    }
    // Un souci pendant la lecture : le signaler d'ici, avec ce qui se lit.
    html += `<button type="button" class="p-menu-report" data-report="1">${icon('bug', 15)}<span>${esc(t('report_problem'))}</span></button>`
    this.el.menu.innerHTML = html
    this.el.menu.hidden = false
    this.showUI()
  }

  /** Liste des chapitres : reste ouverte jusqu'au choix (ou un clic ailleurs). */
  toggleChapters() {
    if (!this.el.menu.hidden && this.el.menu.dataset.kind === 'chapters') return this.closeMenu()
    const cur = this.currentChapter()
    let html = `<div class="p-menu-title">${esc(t('chapters'))}</div>`
    html += this.chapters.map((c) => `<button type="button" data-c="${c.start}" class="${c === cur ? 'on' : ''}">
      <span class="p-chap-row"><b>${esc(formatClock(c.start))}</b> ${esc(c.title)}</span>${c === cur ? icon('check', 16) : ''}</button>`).join('')
    this.el.menu.innerHTML = html
    this.el.menu.dataset.kind = 'chapters'
    this.el.menu.hidden = false
    this.el.menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
    this.showUI()
  }

  currentChapter() {
    const t0 = this.video.currentTime
    let cur = null
    for (const c of this.chapters ?? []) if (c.start <= t0 + 0.5) cur = c
    return cur
  }

  updateChapterLabel() {
    if (!(this.chapters?.length > 1)) return
    const cur = this.currentChapter()
    const label = cur?.title ?? ''
    if (this.el.chapLabel.textContent !== label) this.el.chapLabel.textContent = label
  }

  closeMenu() { this.el.menu.hidden = true; delete this.el.menu.dataset.kind; this.scheduleHide() }

  onMenuClick(e) {
    e.stopPropagation()
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.report) { this.closeMenu(); this.o.onReport?.(); return }
    if (b.dataset.src) {
      this.closeMenu()
      // Rien à faire seulement pour celle qui sert le direct et qui est déjà
      // en tête : la préférée, choisie pendant qu'un secours la remplace, est
      // retentée (le clic était ignoré).
      const id = b.dataset.src
      if (id !== this.liveSource || id !== liveSourceOrder(this.o.prefs)[0]) this.o.onSource?.(id)
      return
    }
    if (b.dataset.q) this.setQuality(b.dataset.q)
    if (b.dataset.s) this.setSpeed(Number(b.dataset.s))
    if (b.dataset.c) { this.video.currentTime = Number(b.dataset.c); this.updateChapterLabel() }
    this.closeMenu()
  }

  // ── Image dans l'image, plein écran ────────────────────────────────────
  async togglePiP() {
    const v = this.video
    try {
      if (v.webkitSupportsPresentationMode && typeof v.webkitSetPresentationMode === 'function') {
        v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture')
      } else if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch { /* refusé par le navigateur : rien à faire */ }
  }

  get isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement)
  }

  async toggleFullscreen() {
    const target = this.o.fullscreenTarget
    try {
      if (this.isFullscreen) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.())
      } else if (target.requestFullscreen) {
        await target.requestFullscreen({ navigationUI: 'hide' })
        // En paysage sur mobile, on verrouille l'orientation si on peut.
        screen.orientation?.lock?.('landscape').catch(() => {})
      } else if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen()
      } else if (isIOS && this.video.webkitEnterFullscreen) {
        // iPhone : seul le plein écran natif de la vidéo existe — sans le chat.
        this.video.webkitEnterFullscreen()
      }
    } catch { /* refusé : on reste en fenêtre */ }
  }

  syncFullscreen() {
    const fs = this.isFullscreen
    this.el.fs.innerHTML = icon(fs ? 'minimize' : 'maximize', 20)
    this.el.fs.title = t(fs ? 'exit_fullscreen' : 'fullscreen')
    if (!fs) screen.orientation?.unlock?.()
  }

  setChatOpen(open) {
    this.el.chat.classList.toggle('on', open)
  }
}
