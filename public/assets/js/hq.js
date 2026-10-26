// ═══════════════════════════════════════════════════════════════════════════
//  Qualités supérieures (1440p et plus) par l'extension TwitchUnblock Connect.
//
//  Twitch ne sert le 1440p et plus (Enhanced Broadcasting) qu'au jeton de
//  lecture d'un compte. L'extension 0.2.0, qui a la session twitch.tv,
//  demande la liste du compte (hq.master) et rend chaque playlist réécrite
//  (hq.playlist) : la page ne voit ni la session, ni le jeton de lecture, ni
//  l'adresse d'une playlist, seulement celles des segments, qu'elle lit
//  elle-même (extension/PROTOCOL.md).
//  Comme l'app iPhone (TwitchAPI.swift : HigherQualities ; MainTabView.swift :
//  hqLaunch, switchToAdFree, scheduleHQReturn, returnToAccount,
//  settleOnAdFree) : liste gardée seulement si elle dépasse 1080p, et, pour
//  un compte sans abonnement ni Turbo, la source habituelle sans pub pendant
//  les pauses pub de Twitch, puis le retour.
//  Lecteur principal seulement : ni multi-live, ni téléchargement, ni
//  « Ouvrir dans… » (ils gardent les liens de la source habituelle).
//  N'importe ni api.js ni player.js : chargeable par les vérifications Node.
// ═══════════════════════════════════════════════════════════════════════════

import { HQ_CODECS } from './connect.js'

/** Première version de l'extension qui a hq.master et hq.playlist. */
export const HQ_MIN_VERSION = '0.2.0'

/** Adresses données au lecteur, jamais demandées au réseau : son chargeur de
 *  playlists les reconnaît (player.js). `tuhq://m/<n>` : liste maîtresse
 *  d'« Auto », faite ici ; `tuhq://v/<id>` : playlist d'une variante, par
 *  l'extension. */
const MASTER_PREFIX = 'tuhq://m/'
const VARIANT_PREFIX = 'tuhq://v/'
export const isHqUrl = (u) => typeof u === 'string' && u.startsWith('tuhq://')

/** « 0.2.1 » ≥ « 0.2.0 » ; une version illisible ne passe pas. */
export function versionAtLeast(v, min = HQ_MIN_VERSION) {
  const parts = (s) => (typeof s === 'string' && /^\d{1,4}(\.\d{1,5}){0,3}$/.test(s) ? s.split('.').map(Number) : null)
  const a = parts(v)
  const b = parts(min)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

/** Le réglage peut-il s'afficher : extension 0.2.0 ou plus, connexion au
 *  site active, session twitch.tv connue (état de connect.js). */
export const hqAvailable = (st) => st?.availability === 'on' && Boolean(st.session) && versionAtLeast(st.version)

/** Au lancement d'un direct : la même chose, sauf une session pas encore
 *  relue (`undefined`) — l'extension répond `no_session` s'il n'y en a pas. */
export const hqCanAsk = (st) => st?.availability === 'on' && st.session !== null && versionAtLeast(st.version)

// ── Codecs lus par ce navigateur ──────────────────────────────────────────
// Comme l'app : H.264 toujours ; HEVC et AV1 seulement décodés en matériel
// (`powerEfficient` de mediaCapabilities) et acceptés par MediaSource. En
// 1440p60, un décodage logiciel perd des images ; et hls.js 1.5 ne vérifie
// pas bien le HEVC sous Windows (MediaSource.isTypeSupported seul ment).
const PROBES = { av1: 'av01.0.12M.08', h265: 'hvc1.1.6.L150.90' }
const CODEC_NAMES = { h264: 'H.264', h265: 'HEVC', av1: 'AV1' }

/** Familles de codecs à annoncer à Twitch, dans l'ordre de HQ_CODECS
 *  (av1, h265, h264). `env` : la fenêtre (une fausse dans les vérifications). */
export async function detectCodecs(env = globalThis) {
  const found = new Set(['h264'])
  const MS = env.MediaSource ?? env.ManagedMediaSource
  const mc = env.navigator?.mediaCapabilities
  for (const fam of ['av1', 'h265']) {
    const type = `video/mp4; codecs="${PROBES[fam]}"`
    try {
      if (typeof MS?.isTypeSupported !== 'function' || !MS.isTypeSupported(type) || typeof mc?.decodingInfo !== 'function') continue
      const r = await mc.decodingInfo({
        type: 'media-source',
        video: { contentType: type, width: 2560, height: 1440, bitrate: 9_000_000, framerate: 60 },
      })
      if (r?.supported === true && r.powerEfficient === true) found.add(fam)
    } catch { /* rien de sûr : pas ce codec */ }
  }
  return HQ_CODECS.filter((c) => found.has(c))
}

let codecsOnce = null
/** Codecs de ce navigateur, cherchés une fois par page. */
export const browserCodecs = () => (codecsOnce ??= detectCodecs().catch(() => ['h264']))

/** « H.264 · HEVC · AV1 » (réglages), comme l'app. */
export const codecLabel = (list) => [...list].reverse().map((c) => CODEC_NAMES[c] ?? c).join(' · ')

/** Famille vidéo d'un attribut CODECS : h264, h265 ou av1 ; 'audio' sans
 *  vidéo ; null si inconnue. */
export function videoFamily(codecs) {
  const list = String(codecs || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
  const video = list.find((c) => !/^(mp4a|ac-3|ec-3|opus|flac)/.test(c))
  if (!video) return list.length ? 'audio' : null
  if (/^avc[13]\./.test(video)) return 'h264'
  if (/^(hvc1|hev1)\./.test(video)) return 'h265'
  if (/^av01\./.test(video)) return 'av1'
  return null
}

function defaultCanPlay(type) {
  const MS = globalThis.MediaSource ?? globalThis.ManagedMediaSource
  try { return typeof MS?.isTypeSupported === 'function' && MS.isTypeSupported(type) } catch { return false }
}

let masterSeq = 0

/**
 * Ce que le lecteur reçoit de la liste du compte (réponse de hq.master) :
 * les qualités lisibles ici (codecs annoncés, puis MediaSource), sous les
 * noms du menu — l'original « 1440p60 (Source) », les autres le leur, et
 * « 1080p60 HEVC » quand deux variantes portent le même nom —, avec la liste
 * maîtresse d'« Auto » (vidéo seulement). null si aucune vidéo lisible ici
 * ne dépasse 1080p : la source habituelle suffit, sans pub risquée pour rien.
 * `any` : gardée quelle que soit la hauteur (compte sans pub : tout le
 * direct par lui, extension 0.3.0 ; dernier recours quand aucune source ne
 * répond). `maxHeight` : variantes plus hautes écartées (réglage « Qualités
 * supérieures » coupé) ; 0 : aucune limite.
 * @param {Array<{id:string,name:string,source:boolean,width:number,height:number,fps:number,bandwidth:number,codecs:string}>} variants
 * @param {string[]} codecs  familles annoncées (browserCodecs)
 */
export function buildHq(variants, codecs, { canPlay = defaultCanPlay, any = false, maxHeight = 0 } = {}) {
  const kept = []
  for (const v of variants ?? []) {
    const fam = videoFamily(v?.codecs)
    if (!fam) continue
    if (fam === 'audio' ? !canPlay(`audio/mp4; codecs="${v.codecs}"`)
      : !codecs.includes(fam) || !(v.height > 0) || (maxHeight > 0 && v.height > maxHeight) ||
        !canPlay(`video/mp4; codecs="${v.codecs}"`)) continue
    kept.push({ ...v, fam })
  }
  const video = kept.filter((v) => v.fam !== 'audio').sort((a, b) => b.height - a.height || b.fps - a.fps || b.bandwidth - a.bandwidth)
  if (!video.length || (!any && !(video[0].height > 1080))) return null
  const base = (v) => v.name || (v.fam === 'audio' ? 'audio_only' : `${v.height}p${v.fps >= 1 ? Math.round(v.fps) : ''}`)
  const count = new Map()
  for (const v of kept) count.set(base(v), (count.get(base(v)) ?? 0) + 1)
  const links = { Auto: `${MASTER_PREFIX}${++masterSeq}` }
  const info = {}
  for (const v of kept) {
    let key = base(v)
    if (count.get(key) > 1 && v.fam !== 'h264' && v.fam !== 'audio') key += ` ${CODEC_NAMES[v.fam]}`
    if (v.source && v.fam !== 'audio') key += ' (Source)'
    let k = key
    for (let n = 2; Object.hasOwn(links, k); n++) k = `${key} ${n}`
    links[k] = `${VARIANT_PREFIX}${v.id}`
    info[k] = { h: v.height, fps: Math.round(v.fps) || 0, bw: v.bandwidth }
  }
  const master = ['#EXTM3U', ...video.flatMap((v) => [
    `#EXT-X-STREAM-INF:BANDWIDTH=${Math.max(1, v.bandwidth)},RESOLUTION=${v.width}x${v.height},CODECS="${v.codecs}"${v.fps > 0 ? `,FRAME-RATE=${v.fps.toFixed(3)}` : ''}`,
    `${VARIANT_PREFIX}${v.id}`,
  ]), ''].join('\n')
  return { links, variants: info, master, top: video[0].height, topId: video[0].id }
}

// ── Pause pub au bord du flux du compte ───────────────────────────────────
const AD_CLASS = 'CLASS="twitch-stitched-ad"'
const AD_MAX_MS = 200_000
/** Fin de playlist qui doit être sans pub pour lire le flux du compte : le
 *  lecteur part de quelques secondes avant le bord (4 à 8 s ici). */
export const EDGE_WINDOW = 12

/** Secondes à attendre pour que les `windowSec` dernières secondes de la
 *  playlist de direct `text` soient sans pub cousue (pauses passées ou
 *  annoncées) : 0 si c'est déjà le cas, null si elle est illisible. Même
 *  calcul que l'app (AdBreakMonitor.adWait) : 30 s pour une pause sans
 *  durée, 200 s au plus. */
export function edgeAdWait(text, windowSec = EDGE_WINDOW) {
  if (typeof text !== 'string' || !text.startsWith('#EXTM3U')) return null
  const attr = (line, name) => {
    const m = line.match(new RegExp(`[:,]${name}=("[^"]*"|[^,\\s]*)`))
    return m ? m[1].replace(/^"|"$/g, '') : ''
  }
  let adEnd = 0
  let edge = 0
  let segStart = NaN
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) segStart = Date.parse(line.slice(25))
    else if (line.startsWith('#EXTINF:')) {
      const start = Number.isFinite(segStart) ? segStart : edge || NaN
      if (Number.isFinite(start)) edge = start + (parseFloat(line.slice(8)) || 0) * 1000
      segStart = NaN
    } else if (line.startsWith('#EXT-X-DATERANGE') && line.includes(AD_CLASS)) {
      const start = Date.parse(attr(line, 'START-DATE'))
      if (!Number.isFinite(start)) continue
      const endDate = Date.parse(attr(line, 'END-DATE'))
      const duration = parseFloat(attr(line, 'DURATION'))
      const end = Number.isFinite(endDate) ? endDate : Number.isFinite(duration) ? start + duration * 1000 : start + 30_000
      adEnd = Math.max(adEnd, Math.min(end, start + AD_MAX_MS))
    }
  }
  if (!adEnd || !edge) return 0
  return Math.max(0, Math.ceil((adEnd + windowSec * 1000 - edge) / 1000))
}

// ── Lecture d'un direct par le compte ─────────────────────────────────────
const MAX_CHECKS = 20               // vérifications avant de rester sur la source sans pub
const QUICK_AD_MS = 30_000          // pub revenue moins de 30 s après un retour
const STALE_MS = 10 * 60_000        // liens de la source habituelle relus après 10 min
const REFRESH_RETRY_MS = 60_000     // relecture ratée : pas de nouvel essai avant 1 min
const PREPARE_MS = 2500             // lancement : la playlist du compte attendue 2,5 s au plus
                                    // (moins s'il reste moins du délai de main.js)

/**
 * Un direct lu en qualités supérieures (un objet par lecture, state.watch.hq
 * dans main.js). Il tient la source jouée : le flux du compte, ou la source
 * habituelle (« sans pub ») pendant une pause pub de Twitch, et décide des
 * bascules. Le lecteur l'appelle par main.js (onAdState, onFatal, onPlay,
 * text).
 */
export class HqLive {
  /**
   * @param {object} o
   * @param {ReturnType<typeof buildHq>} o.hq  liste du compte, prête pour le lecteur
   * @param {{links: object, variants?: object, source?: string}} o.adFree  source habituelle
   * @param {object} o.player  swapLinks, forgetAdBreaks, setLiveSource, adBreakLeft, quality, video
   * @param {(id: string) => Promise<string>} o.playlist  hq.playlist d'une variante
   * @param {(text: string) => void} o.notify  avis à l'écran
   * @param {(key: string, params?: object) => string} o.t
   * @param {(key: string) => string} [o.qualityText]  nom affiché d'une qualité
   * @param {() => Promise<{links: object, variants?: object, source?: string}|null>} [o.refreshAdFree]
   * @param {() => void} [o.onSettle]  plus de flux du compte pour cette lecture
   * @param {() => Promise<ReturnType<typeof buildHq>>} [o.renew]  nouvelle
   *   liste du compte (hq.master), quand l'extension ne connaît plus ses
   *   identifiants (6 h passées, autre session, élagués)
   */
  constructor(o) {
    this.o = o
    this.setT = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearT = o.clearTimeout ?? ((id) => clearTimeout(id))
    this.clock = o.now ?? (() => Date.now())
    this.hq = o.hq
    this.adFree = null
    this.setAdFree(o.adFree)
    this.onAdFree = false
    this.settled = false
    this.destroyed = false
    this.adFreeBreakEnd = 0
    this.lastReturn = 0
    this.quickAds = 0
    this.checks = 0
    this.timer = null
    this.waitingPlay = false
    this.refreshing = false
    this.refreshFailedAt = 0
    this.renewing = false
    this.renewedAt = 0
  }

  setAdFree(set) {
    this.adFree = { links: set?.links ?? {}, variants: set?.variants ?? {}, source: set?.source ?? null, at: this.clock() }
    // Twitch officiel sans compte : des pubs aussi, aucune bascule n'y gagne.
    this.canFallback = Object.keys(this.adFree.links).length > 0 && this.adFree.source !== 'twitch'
  }

  /** Ce que le lecteur doit lire maintenant, et la source à afficher. */
  current() { return this.onAdFree || this.settled ? this.adFree : this.hq }
  sourceId() { return this.onAdFree || this.settled ? this.adFree.source : 'account' }
  /** Le flux du compte joue-t-il ? */
  get onHq() { return !this.onAdFree && !this.settled && !this.destroyed }

  /** Playlist d'une adresse tuhq:// (chargeur de playlists du lecteur). */
  text(url) {
    if (this.destroyed) return Promise.reject(new Error('hq: closed'))
    if (url === this.hq.links.Auto) return Promise.resolve(this.hq.master)
    if (typeof url === 'string' && url.startsWith(VARIANT_PREFIX)) {
      return this.o.playlist(url.slice(VARIANT_PREFIX.length)).catch((e) => {
        // Identifiant que l'extension ne connaît plus : une nouvelle liste.
        if (e?.code === 'bad_args' && e?.detail === 'expired') this.renew()
        throw e
      })
    }
    return Promise.reject(new Error('hq: unknown'))
  }

  /** Nouvelle liste du compte (o.renew), lue à la place de l'ancienne si le
   *  flux du compte joue. Une fois par minute au plus. */
  renew() {
    if (this.renewing || this.destroyed || typeof this.o.renew !== 'function') return
    if (this.renewedAt && this.clock() - this.renewedAt < 60_000) return
    this.renewing = true
    Promise.resolve().then(() => this.o.renew()).then((hq) => {
      this.renewing = false
      this.renewedAt = this.clock()
      if (!hq || this.destroyed) return
      this.hq = hq
      if (this.onHq) this.play(this.hq, { keepAds: true })
    }, () => {
      this.renewing = false
      this.renewedAt = this.clock()
    })
  }

  /** Playlist de la meilleure variante (pubs au bord), `timeoutMs` au plus
   *  (0 : sans limite). null : injoignable. */
  async edgeText(timeoutMs = 0) {
    let timer = null
    const late = timeoutMs > 0 ? new Promise((resolve) => { timer = this.setT(() => resolve(null), timeoutMs) }) : null
    try {
      const ask = this.o.playlist(this.hq.topId).catch(() => null)
      return await (late ? Promise.race([ask, late]) : ask)
    } finally {
      if (timer !== null) this.clearT(timer)
    }
  }

  /** Lancement : flux du compte injoignable → false (la source habituelle,
   *  comme sans le réglage). Pub cousue à son bord (pré-roll) → la source
   *  sans pub d'abord, le compte à la fin de la pub. `timeoutMs` : attente
   *  de sa playlist, PREPARE_MS au plus. */
  async prepare({ timeoutMs = PREPARE_MS } = {}) {
    if (!this.canFallback) return true
    const wait = edgeAdWait(await this.edgeText(Math.max(500, Math.min(PREPARE_MS, timeoutMs))))
    if (this.destroyed || wait === null) return false
    if (wait > 0) {
      this.onAdFree = true
      this.schedule((wait + 2) * 1000)
    }
    return true
  }

  /** Bandeau de pause pub du lecteur ouvert (`left` : secondes restantes) ou
   *  refermé (0). */
  onAdState(left) {
    if (this.settled || this.destroyed) return
    if (this.onAdFree) {
      // Pause de la chaîne sur la source sans pub : le retour l'attend.
      this.adFreeBreakEnd = left > 0 ? this.clock() + left * 1000 : 0
      return
    }
    if (left > 0) this.switchToAdFree(left)
  }

  /** Lecture reprise : vérifications du retour, ou bascule restée en attente
   *  d'une pause pub arrivée pendant la pause. */
  onPlay() {
    if (this.settled || this.destroyed) return
    if (this.onAdFree) {
      if (this.waitingPlay) {
        this.waitingPlay = false
        this.schedule(1000)
      }
      return
    }
    const left = this.o.player.adBreakLeft?.() ?? 0
    if (left > 0) this.switchToAdFree(left)
  }

  /** Erreur fatale du lecteur. Sur le flux du compte : la source habituelle,
   *  pour de bon (true : réglé ici). Sur la source sans pub : ses relances
   *  et secours habituels (false). */
  onFatal() {
    // Sans source habituelle où aller (flux du compte en dernier recours) :
    // les relances et la carte « Réessayer » du lecteur, comme ailleurs.
    if (!this.onHq || !this.canFallback) return false
    this.settle()
    return true
  }

  /** Pause pub de Twitch sur le flux du compte : la source sans pub, comme
   *  un changement de qualité. Retour prévu `left` s et une marge plus tard. */
  switchToAdFree(left) {
    if (!this.onHq || !this.canFallback) return
    // En pause : la bascule relancerait la lecture ; la reprise s'en charge.
    if (this.o.player.video?.paused) return
    const now = this.clock()
    // Liens lus il y a plus de 10 min : relus d'abord (leurs adresses ont pu
    // expirer), la bascule attend ; ratée, la pub reste sur le compte, coupée
    // et annoncée comme ailleurs.
    if (now - this.adFree.at > STALE_MS) {
      if (this.refreshing || (this.refreshFailedAt && now - this.refreshFailedAt < REFRESH_RETRY_MS)) return
      this.refreshAdFree(() => {
        const l = this.o.player.adBreakLeft?.() ?? 0
        if (l > 0) this.switchToAdFree(l)
      })
      return
    }
    // Pub revenue moins de 30 s après un retour : deux fois de suite, plus de retour.
    this.quickAds = this.lastReturn && now - this.lastReturn < QUICK_AD_MS ? this.quickAds + 1 : 0
    this.onAdFree = true
    this.adFreeBreakEnd = 0
    this.checks = 0
    this.play(this.adFree)
    this.o.notify?.(this.o.t('hq_ad_fallback', { q: this.label() }), 'hq_ad_fallback')
    if (this.quickAds >= 2) this.settle()
    else this.schedule((left + 2) * 1000)
  }

  schedule(ms) {
    this.clearTimer()
    this.timer = this.setT(() => {
      this.timer = null
      this.checkReturn()
    }, Math.max(0, ms))
  }

  clearTimer() {
    if (this.timer !== null) this.clearT(this.timer)
    this.timer = null
  }

  /** Retour au flux du compte ? Pas tant que la source sans pub montre sa
   *  propre pause, ni que le bord du flux du compte est en pub ; vingt
   *  vérifications au plus, puis la source sans pub reste. En pause : plus
   *  de vérification, elles reprennent avec la lecture. */
  async checkReturn() {
    if (!this.onAdFree || this.settled || this.destroyed) return
    const p = this.o.player
    if (p.video?.paused) {
      this.waitingPlay = true
      return
    }
    if (++this.checks > MAX_CHECKS) return this.settle()
    if (this.adFreeBreakEnd > this.clock()) return this.schedule(this.adFreeBreakEnd - this.clock() + 2000)
    const text = await this.edgeText()
    if (!this.onAdFree || this.settled || this.destroyed) return
    if (p.video?.paused) {
      this.waitingPlay = true
      return
    }
    if (this.adFreeBreakEnd > this.clock()) return this.schedule(this.adFreeBreakEnd - this.clock() + 2000)
    const wait = edgeAdWait(text)
    if (wait === null) return this.settle()
    if (wait > 0) return this.schedule(Math.min(wait + 1, 30) * 1000)
    this.returnToHq()
  }

  /** Fin de la pause pub : retour au flux du compte, dans la qualité choisie
   *  (la préférence du lecteur), avec un avis. */
  returnToHq() {
    this.clearTimer()
    this.onAdFree = false
    this.waitingPlay = false
    this.adFreeBreakEnd = 0
    this.lastReturn = this.clock()
    this.play(this.hq)
    this.o.notify?.(this.o.t('hq_ad_back', { q: this.label() }), 'hq_ad_back')
  }

  /** Plus de flux du compte pour cette lecture (pubs répétées, flux du
   *  compte injoignable ou en échec) : la source habituelle reste. */
  settle() {
    if (this.settled || this.destroyed) return
    const wasHq = !this.onAdFree
    this.clearTimer()
    this.settled = true
    this.waitingPlay = false
    if (wasHq && Object.keys(this.adFree.links).length) this.play(this.adFree)
    this.o.onSettle?.()
  }

  /** Source habituelle relue ailleurs (autre Worker, relais en panne) :
   *  gardée pour les pauses, et lue tout de suite si c'est elle qui joue. */
  updateAdFree(set) {
    if (this.destroyed) return
    this.setAdFree(set)
    if (this.onAdFree || this.settled) this.play(this.adFree, { keepAds: true })
  }

  refreshAdFree(then) {
    if (this.refreshing || typeof this.o.refreshAdFree !== 'function') return
    this.refreshing = true
    Promise.resolve().then(() => this.o.refreshAdFree()).then((set) => {
      this.refreshing = false
      if (this.destroyed || this.settled) return
      if (!set?.links || !Object.keys(set.links).length || set.source === 'twitch') {
        this.refreshFailedAt = this.clock()
        return
      }
      this.setAdFree(set)
      this.refreshFailedAt = 0
      then?.()
    }, () => {
      this.refreshing = false
      this.refreshFailedAt = this.clock()
    })
  }

  /** Le lecteur passe sur `set`. Pauses pub de l'autre flux oubliées (celles
   *  du compte ne sont pas forcément celles de la source habituelle), sauf
   *  d'une source habituelle à l'autre. */
  play(set, { keepAds = false } = {}) {
    const p = this.o.player
    if (!keepAds) p.forgetAdBreaks?.()
    p.swapLinks(set.links, set.variants)
    p.setLiveSource?.(set === this.hq ? 'account' : set.source)
  }

  /** Qualité jouée, pour les avis : « 1440p » pour un original de hauteur
   *  connue, sinon son nom (« 1080p60 », « Auto »). */
  label() {
    const key = this.o.player.quality
    const h = this.current().variants?.[key]?.h
    if (/source|chunked/i.test(String(key ?? '')) && h > 0) return `${h}p`
    return this.o.qualityText ? this.o.qualityText(key) : String(key ?? '')
  }

  /** Autre lecture, ou fermeture : plus de bascule ni de retour prévu. */
  destroy() {
    this.destroyed = true
    this.clearTimer()
  }
}
