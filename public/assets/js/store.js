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

const DEFAULT_PREFS = {
  lang: null,
  topLang: null,
  homeList: false,   // accueil en liste (façon Twitch) plutôt qu'en grille
  localFollows: [],  // chaînes suivies sans compte Twitch (sur cet appareil)
  pinned: [],        // streamers épinglés en tête des suivis (logins en minuscules)     // langue du top des lives ; null = celle de l'appareil
  timestamps: false,
  keepDeleted: true,
  loadHistory: true,
  chatSize: 14,
  chatOpen: true,
  shareUsage: true,
  chatSync: true,
  multiChat: true,   // multi-live : chat du direct qui a le son (grand écran)
  autoRaid: true,
  clickPause: true,  // un clic sur la vidéo met en pause (ordinateur)
  showRecent: true,  // raccourcis vers les chaînes ouvertes récemment (onglet Streamer)
  highlightWords: [],
  hideBots: false,
  hideCommands: false,
  mutedWords: [],
  blockedUsers: [],
  volume: 1,
  muted: false,
  // Qualité préférée : 'auto', 'source', une hauteur ('1080', '720'…) ou
  // 'audio' — mêmes valeurs que l'app iOS dans la sauvegarde.
  qualityPref: 'auto',
  vodSpeed: 1,       // vitesse des VODs, retenue d'une VOD à l'autre
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
  savePrefs() { write('tu_prefs', this.prefs) },

  // ── Historique (VODs + streamers), même forme que l'ancien site ────────
  history: read('twitch_vod_history', []),
  saveHistory() { write('twitch_vod_history', this.history) },

  addHistory(term, type, display, extra = {}) {
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

  // ── Progression des VODs ────────────────────────────────────────────────
  getProgress(vodId) {
    const v = Number.parseFloat(localStorage.getItem(`vod_progress_${vodId}`))
    return Number.isFinite(v) ? v : 0
  },
  setProgress(vodId, seconds) {
    try { localStorage.setItem(`vod_progress_${vodId}`, String(seconds)) } catch {}
  },
  /** Durées connues, pour dessiner la barre de progression des cartes. */
  getLength(vodId) { return read('tu_lengths', {})[vodId] ?? 0 },
  setLength(vodId, seconds) {
    const all = read('tu_lengths', {})
    if (all[vodId] === Math.round(seconds)) return
    all[vodId] = Math.round(seconds)
    write('tu_lengths', all)
  },

  allProgress() {
    const out = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('vod_progress_')) {
        const v = Number.parseFloat(localStorage.getItem(k))
        if (Number.isFinite(v)) out[k.slice('vod_progress_'.length)] = v
      }
    }
    return out
  },
}
