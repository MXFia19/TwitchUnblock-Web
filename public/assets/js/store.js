// ═══════════════════════════════════════════════════════════════════════════
//  État persistant (localStorage).
//
//  Les clés `twitch_token`, `twitch_vod_history`, `twitch_use_proxy` et
//  `vod_progress_<id>` sont celles de l'ancienne version du site : on les
//  reprend telles quelles, pour que l'historique et la connexion de chacun
//  survivent à la mise à jour — et restent compatibles avec la sauvegarde
//  du Worker, qui stocke exactement ce format.
// ═══════════════════════════════════════════════════════════════════════════

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota, mode privé */ }
}

// Exportées pour la synchro des réglages (main.js) : une section encore aux
// valeurs par défaut ne part pas au serveur.
export const DEFAULT_PREFS = {
  lang: null,
  topLang: null,
  homeList: false,   // accueil en liste (façon Twitch) plutôt qu'en grille
  localFollows: [],  // chaînes suivies sans compte Twitch (sur cet appareil)
  pinned: [],        // streamers épinglés en tête des suivis (logins en minuscules)     // langue du top des lives ; null = celle de l'appareil
  pinnedByViewers: true, // leurs directs triés entre eux par spectateurs (sinon : ordre d'épinglage)
  timestamps: false,
  timeFormat: 'auto', // heure du chat : 'auto' (celle de l'appareil), '12' ou '24'
  keepDeleted: true,
  loadHistory: true,
  chatSize: 14,
  chatOpen: true,
  shareUsage: true,
  chatSync: true,
  multiChat: true,   // multi-live : chat du direct qui a le son (grand écran)
  autoRaid: true,
  clickPause: true,  // un clic sur la vidéo met en pause (ordinateur)
  // Faible latence : le direct au plus près (4 s environ). Coupé, ~10 s de
  // retard, sans saccades sur une connexion lente (Player.extraBehind).
  lowLatency: true,
  showRecent: true,  // raccourcis vers les chaînes ouvertes récemment (onglet Streamer)
  // « Reprendre les VODs » : position retenue dans chaque VOD, rangée
  // « Reprendre » de l'accueil, barre violette des vignettes. Coupé : rien
  // n'est lu ni écrit (ce qui était gardé reste, pour le jour où il revient).
  vodProgress: true,
  highlightWords: [],
  hideBots: false,
  hideCommands: false,
  mutedWords: [],
  blockedUsers: [],
  // Emotes affichées comme leur mot (fiche d'une emote → « Masquer cette
  // emote ») : codes exacts, plus récentes en dernier, 200 au plus. Même
  // nom que dans l'app iPhone (synchro des réglages, sauvegarde).
  hiddenEmotes: [],
  volume: 1,
  muted: false,
  // Qualité préférée : 'auto', 'source', une hauteur ('1080', '720'…) ou
  // 'audio' — mêmes valeurs que l'app iOS dans la sauvegarde.
  qualityPref: 'auto',
  // Qualités supérieures (1440p et plus) par l'extension TwitchUnblock
  // Connect 0.2.0 (hq.js) : coupé par défaut, comme dans l'app.
  higherQualities: false,
  // Sans pub avec mon abonnement (ou Turbo) : tout le direct par le compte
  // de l'extension 0.3.0 quand Twitch ne lui sert pas de pub (hq.js).
  subAdFree: true,
  vodSpeed: 1,       // vitesse des VODs, retenue d'une VOD à l'autre
  // Masqués du top et des catégories, plus récents d'abord ; `at` en
  // millisecondes, comme l'app iOS (sauvegarde : clé racine `hidden`).
  hiddenChannels: [],    // { login (minuscules), name, at }, 500 au plus
  hiddenCategories: [],  // { id, name, box, at }, 200 au plus
  // Synchroniser mes réglages (compte connecté) : voir main.js. Propre à
  // cet appareil, jamais synchronisé lui-même.
  syncSettings: true,
  // Web app sur iPhone et iPad : notification de live touchée ouverte dans
  // l'app ('app' : TwitchUnblock, 'test' : TU Test) ; null = sur le site.
  // Propre à cet appareil (l'app n'est peut-être pas installée ailleurs).
  notifApp: null,
}

/** Réglages enregistrés, avec la qualité d'avant le réglage « Qualité
 *  préférée » (`quality`, le nom exact : « 720p60 ») reprise en préférence,
 *  en hauteur — « 720p60 » vaut alors aussi pour une chaîne en 720p30. */
function readPrefs() {
  const saved = read('tu_prefs', {})
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  if (typeof saved.quality === 'string') {
    if (saved.qualityPref === undefined) saved.qualityPref = qualityPrefOf(saved.quality)
    delete saved.quality
  }
  return saved
}

/** Nom d'une qualité → valeur du réglage (aussi pour une sauvegarde d'avant). */
export function qualityPrefOf(name) {
  const s = String(name).toLowerCase()
  if (s === 'auto') return 'auto'
  if (s.includes('source') || s === 'chunked') return 'source'
  if (s.includes('audio')) return 'audio'
  const m = s.match(/(\d+)p/) || s.match(/\d+x(\d+)/)
  return m && Number(m[1]) > 0 ? String(Number(m[1])) : 'auto'
}

export const store = {
  // ── Session Twitch ──────────────────────────────────────────────────────
  // try/catch : stockage bloqué (navigation privée stricte…) ne doit pas
  // empêcher le site de démarrer.
  get token() { try { return localStorage.getItem('twitch_token') } catch { return null } },
  set token(v) {
    try {
      if (v) localStorage.setItem('twitch_token', v)
      else localStorage.removeItem('twitch_token')
    } catch {}
  },


  // ── Préférences ─────────────────────────────────────────────────────────
  prefs: { ...DEFAULT_PREFS, ...readPrefs() },
  /** Réglages par défaut d'une instance auto-hébergée (SITE_DEFAULTS, voir
   *  applySiteDefaults dans main.js) : pris pour ceux que ce navigateur n'a
   *  jamais enregistrés. `validators` : un contrôle par réglage ; une valeur
   *  refusée (undefined) est ignorée. */
  applyDefaults(defaults, validators) {
    const saved = readPrefs()
    for (const [k, valid] of Object.entries(validators)) {
      if (!Object.hasOwn(defaults, k) || Object.hasOwn(saved, k)) continue
      const v = valid(defaults[k])
      if (v !== undefined) this.prefs[k] = v
    }
  },
  /** Appelé après chaque enregistrement des réglages (synchro, main.js). */
  onPrefsSaved: null,
  savePrefs() {
    write('tu_prefs', this.prefs)
    this.onPrefsSaved?.()
  },

  // ── Historique (VODs + streamers), même forme que l'ancien site ────────
  history: read('twitch_vod_history', []),
  saveHistory() { write('twitch_vod_history', this.history) },

  /** Réglages ou historique réécrits par un autre onglet (événement
   *  `storage`, main.js) : relus en place. L'onglet resté ouvert réécrivait
   *  sinon les réglages entiers au moindre changement (le volume suffit),
   *  avec ses valeurs d'avant, et la perte partait au serveur et à l'iPhone.
   *  @returns {boolean} vrai si quelque chose a été relu. */
  reloadFrom(key) {
    if (key === 'tu_prefs') {
      const fresh = { ...DEFAULT_PREFS, ...readPrefs() }
      for (const k of Object.keys(this.prefs)) if (!Object.hasOwn(fresh, k)) delete this.prefs[k]
      Object.assign(this.prefs, fresh)
      return true
    }
    if (key === 'twitch_vod_history') {
      const h = read('twitch_vod_history', [])
      this.history = Array.isArray(h) ? h : []
      return true
    }
    return false
  },

  addHistory(term, type, display, extra = {}) {
    // « Reprendre les VODs » coupé : aucune VOD dans l'historique.
    if (type === 'vod' && this.prefs.vodProgress === false) return
    const key = String(term).toLowerCase()
    this.history = this.history.filter((h) => String(h.term).toLowerCase() !== key)
    // `addedAt` : l'app iOS l'exige pour relire l'historique ; sans lui, un
    // seul élément venu du site faisait échouer toute la synchronisation.
    this.history.unshift({ term: String(term), type, display: display || String(term), ...extra, addedAt: Date.now() })
    if (this.history.length > 30) this.history.length = 30
    this.saveHistory()
  },

  removeHistory(term) {
    this.history = this.history.filter((h) => h.term !== term)
    this.saveHistory()
  },

  clearHistory(type) {
    this.history = this.history.filter((h) => h.type !== type)
    this.saveHistory()
  },

  /** « Reprendre les VODs » coupé : plus rien sur les VODs dans ce
   *  navigateur — leurs entrées de l'historique (la clé garde les chaînes
   *  récentes), leurs positions et leurs durées. Rend les entrées retirées. */
  forgetVods() {
    const vods = this.history.filter((h) => h.type === 'vod')
    if (vods.length) {
      this.history = this.history.filter((h) => h.type !== 'vod')
      this.saveHistory()
    }
    try {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('vod_progress_')) keys.push(k)
      }
      for (const k of keys) localStorage.removeItem(k)
      localStorage.removeItem('tu_lengths')
    } catch {}
    return vods
  },

  // ── Progression des VODs ────────────────────────────────────────────────
  // Stockage bloqué (cookies refusés) : localStorage lève une erreur, et la
  // grille des VODs comme l'ouverture d'une VOD plantaient.
  // « Reprendre les VODs » coupé : rien n'est lu (les VODs partent du début,
  // ou du ?t= du lien) ni écrit.
  getProgress(vodId) {
    if (this.prefs.vodProgress === false) return 0
    let v = NaN
    try { v = Number.parseFloat(localStorage.getItem(`vod_progress_${vodId}`)) } catch {}
    return Number.isFinite(v) ? v : 0
  },
  setProgress(vodId, seconds) {
    if (this.prefs.vodProgress === false) return
    try { localStorage.setItem(`vod_progress_${vodId}`, String(seconds)) } catch {}
  },
  /** Durées connues, pour dessiner la barre de progression des cartes. */
  getLength(vodId) { return read('tu_lengths', {})[vodId] ?? 0 },
  setLength(vodId, seconds) {
    // Elles ne servent qu'aux barres de progression, cachées sans la reprise.
    if (this.prefs.vodProgress === false) return
    const all = read('tu_lengths', {})
    if (all[vodId] === Math.round(seconds)) return
    all[vodId] = Math.round(seconds)
    write('tu_lengths', all)
  },

  allProgress() {
    const out = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('vod_progress_')) {
          const v = Number.parseFloat(localStorage.getItem(k))
          if (Number.isFinite(v)) out[k.slice('vod_progress_'.length)] = v
        }
      }
    } catch {}
    return out
  },
}
