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

// Mêmes vitesses que dans l'app. Pas au-delà de 2× : Twitch ne publie pas
// de playlist I-frame, et le débit double déjà à 2×.
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const HIDE_AFTER = 2800
// Empreinte du fichier attendu (identique sur les deux CDN) : un CDN
// compromis ne peut pas substituer son propre script.
const HLS_INTEGRITY = 'sha384-9v3HcdYrO3D+OPDTjZ40RXocgE4GtXVCd3/mCS62JsM93JXgI1afJVuwjFvsu6ni'
const HLS_SOURCES = [
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js',
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
function segmentProxyOn() {
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

let hlsPromise = null
/** Charge hls.js, avec un second CDN si le premier ne répond pas : sans lui,
 *  rien ne se lit hors de Safari. Appelé au démarrage pour être prêt au
 *  premier clic. */
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls)
  hlsPromise ??= new Promise((resolve) => {
    const next = (i) => {
      if (window.Hls) return resolve(window.Hls)
      if (i >= HLS_SOURCES.length) return resolve(null)
      const s = document.createElement('script')
      s.src = HLS_SOURCES[i]
      s.integrity = HLS_INTEGRITY
      s.crossOrigin = 'anonymous'
      s.async = true
      s.onload = () => resolve(window.Hls ?? null)
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
            <span class="p-latency live-only"></span>
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
    }

    const v = this.video
    const p = this.o.prefs
    v.volume = p.volume ?? 1
    v.muted = Boolean(p.muted)
    this.el.vol.value = String(v.muted ? 0 : v.volume)

    // ── Vidéo ────────────────────────────────────────────────────────────
    v.addEventListener('play', () => this.syncPlay())
    v.addEventListener('pause', () => { this.syncPlay(); this.showUI(); this.o.onPause?.() })
    v.addEventListener('waiting', () => { this.el.spinner.hidden = false })
    v.addEventListener('playing', () => { this.el.spinner.hidden = true; this.scheduleHide() })
    v.addEventListener('canplay', () => { this.el.spinner.hidden = true })
    v.addEventListener('timeupdate', () => this.onTime())
    v.addEventListener('progress', () => this.drawBuffer())
    v.addEventListener('durationchange', () => this.onTime())
    v.addEventListener('volumechange', () => this.syncVolume())
    v.addEventListener('ratechange', () => this.onRateChange())
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
    this.setMuted([])
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
    this.destroyHls()
    this.el.spinner.hidden = false
    if (!url) return
    const token = (this.attachToken = (this.attachToken ?? 0) + 1)
    // Essais de son d'origine sur les passages coupés : remis à zéro à chaque
    // source (une VOD récente peut suivre une ancienne).
    this.unmute = this.kind === 'vod' ? {} : null
    // Durée des segments annoncés d'avance dans la dernière playlist lue.
    this.prefetchAhead = 0
    // État du direct remis à zéro à chaque source (qualité, chaîne, Worker) :
    // la cible d'une chaîne débordait sur la suivante, et n'était pas
    // réappliquée au nouvel objet hls.
    this.behindTarget = undefined
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

    if (Hls?.isSupported()) {
      // « Auto » : la liste maîtresse, hls.js choisit le débit (worker.js).
      const master = String(this.quality).toLowerCase() === 'auto'
      const hls = new Hls({
        // Rouvrir la requête avec l'adresse corrigée : c'est le point
        // d'accroche que hls.js offre pour réécrire une URL avant envoi.
        xhrSetup: (xhr, reqUrl) => {
          const fixed = liveRequestUrl(reqUrl, url)
          if (fixed !== reqUrl) xhr.open('GET', fixed, true)
        },
        backBufferLength: 90,
        maxBufferLength: 30,
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
        // par des sauts (holdLiveFloor, alignLive).
        ...(this.kind === 'live' && !master ? { pLoader: prefetchPlaylistLoader(Hls, this) } : {}),
      })
      this.hls = hls
      this.directFails = 0
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
      hls.on(Hls.Events.FRAG_LOADED, () => { this.directFails = 0 })
      // En « Auto » (playlist maître), hls.js choisit le débit : on affiche
      // lequel, sinon on ne sait jamais ce qu'on regarde vraiment.
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
        const h = hls.levels?.[d.level]?.height
        this.autoLevel = h ? `${h}p` : ''
        this.updateQualityLabel()
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        // Segments jamais arrivés (code 0 : bloqués avant d'atteindre
        // Twitch), trois de suite et appareil en ligne : les prochaines
        // tentatives passent par le relais du Worker.
        if (!segmentProxyOn() && data.type === Hls.ErrorTypes.NETWORK_ERROR
            && /^frag/i.test(data.details || '') && !data.response?.code && isDirectSegment(data.frag?.url || data.url || '')
            && navigator.onLine !== false && ++this.directFails >= SEG_PROXY_FAILS) {
          this.directFails = 0
          enableSegmentProxy()
          console.info('[TwitchUnblock] Segments directs bloqués : passage par le relais.')
          if (data.fatal) { hls.startLoad(); return }
        }
        if (!data.fatal) return
        // Worker hors service en pleine lecture (quota du jour atteint) : ses
        // requêtes n'aboutissent plus du tout — code 0, la page d'erreur de
        // Cloudflare n'ayant pas d'en-tête CORS. Plutôt que de relancer sans
        // fin le même Worker, main.js redemande les liens à un autre.
        // Relais du VPS : même une réponse d'erreur (Twitch peut limiter son
        // adresse IP) renvoie au Worker.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          const down = proxyBaseOf(data.frag?.url || data.context?.url || data.url || '')
          const failed = !data.response?.code || (down === RELAY_BASE && data.response.code >= 400)
          if (down && failed && this.o.onWorkerDown?.(down)) return
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
        else this.o.onError?.()
      })
    } else if (native) {
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
   *  muet avec une pastille pour le remettre — comme sur Twitch. */
  async tryPlay() {
    try {
      await this.video.play()
    } catch (err) {
      if (err?.name !== 'NotAllowedError') return
      this.video.muted = true
      try {
        await this.video.play()
        $('span', this.el.unmute).textContent = t('unmute')
        this.el.unmute.hidden = false
      } catch { this.syncPlay() }
    }
  }

  destroyHls() {
    if (this.hls) { this.hls.destroy(); this.hls = null }
    // Niveau d'Auto inconnu jusqu'au prochain LEVEL_SWITCHED : le bouton
    // ne garde pas celui de la source précédente.
    if (this.autoLevel) { this.autoLevel = ''; this.updateQualityLabel() }
  }

  destroy() {
    this.destroyHls()
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
    this.updateQualityLabel()
    this.attach(links[this.quality], this.kind === 'vod' ? this.video.currentTime : 0)
  }

  /** Qualité choisie dans le menu : elle devient la qualité préférée
   *  (en hauteur : « 720p60 » → 720p, valable sur toutes les chaînes). */
  setQuality(key) {
    if (!this.links[key] || key === this.quality) return
    const at = this.video.currentTime
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
   *  moteur, qualité, source du direct, vitesse et retard. */
  debugInfo() {
    const v = this.video
    const engine = this.hls
      ? `hls.js ${window.Hls?.version ?? '?'} ${window.ManagedMediaSource ? 'MMS' : 'MSE'}`
      : /\.mp4(\?|$)/i.test(v.currentSrc || '') ? 'mp4' : 'native'
    const q = this.quality ? `${this.quality}${this.autoLevel ? `/${this.autoLevel}` : ''}` : null
    const lat = this.kind === 'live' ? this.liveDelay() : 0
    return [engine, q, this.kind === 'live' && this.liveSource ? `src ${this.liveSource}` : null,
      `rate ${v.playbackRate}`, lat > 0 ? `delay ${lat.toFixed(1)}s` : null].filter(Boolean).join(' · ')
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
    if (!(behind > 0) && v.seekable.length) behind = v.seekable.end(v.seekable.length - 1) - (this.prefetchAhead || 0) - v.currentTime
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
    this.o.prefs.volume = v.volume
    this.o.prefs.muted = v.muted
    this.o.savePrefs()
  }

  onTime() {
    const v = this.video
    const cur = v.currentTime
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
    }
    if (this.kind === 'vod') this.updateMutedNote(cur)
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

  // ── Passages coupés ────────────────────────────────────────────────────
  /** Passages au son coupé par Twitch : en orange sur la barre, et un avis
   *  (avec « Passer ») pendant qu'on les regarde. Ceux dont le son a pu être
   *  rétabli (unmuteLoader) sont retirés. */
  setMuted(list) {
    this.muted = (list ?? []).map((r) => ({ start: r.start, end: r.end }))
    this.unmutedSpans = []
    this.unmutedToldAt = 0
    this.drawMuted()
    this.updateMutedNote(this.video.currentTime)
    if (!this.mutedDurHooked) {
      this.mutedDurHooked = true
      this.video.addEventListener('durationchange', () => this.drawMuted())
    }
  }

  /** Passages encore muets : les coupés, moins ce qui a été rétabli. */
  remainingMuted() {
    let out = this.muted ?? []
    for (const s of this.unmutedSpans ?? []) {
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

  markUnmuted(frag) {
    if (!frag || !Number.isFinite(frag.start)) return
    this.unmutedSpans ??= []
    this.unmutedSpans.push({ start: frag.start, end: frag.start + (frag.duration || 0) })
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
      if (this.root.matches(':hover') && this.root.querySelector('.p-bottom:hover')) return
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
      arrowup: () => { this.video.muted = false; this.video.volume = Math.min(1, this.video.volume + 0.1) },
      arrowdown: () => { this.video.volume = Math.max(0, this.video.volume - 0.1) },
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
      // Dans l'ordre des réglages ; en choisir une la met en tête.
      const order = liveSourceOrder(this.o.prefs)
      html += `<div class="p-menu-title">${esc(t('live_source'))}${this.liveSource ? ` · ${esc(t(`src_${this.liveSource}`))}` : ''}</div>`
      html += order.map((id, i) => `<button type="button" data-src="${id}" class="${i === 0 ? 'on' : ''}">
        <span>${esc(t(`src_${id}`))}</span>${i === 0 ? icon('check', 16) : ''}</button>`).join('')
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
      if (b.dataset.src !== liveSourceOrder(this.o.prefs)[0]) this.o.onSource?.(b.dataset.src)
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
