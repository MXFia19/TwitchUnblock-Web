// ═══════════════════════════════════════════════════════════════════════════
//  Panneau de chat : affichage, défilement, saisie, emotes, fiche utilisateur.
//
//  Remplace l'iframe de Twitch. Celle-ci ne savait rien faire de ce que fait
//  l'app — emotes BTTV/FFZ/7TV, historique à l'arrivée, chat des VODs — et
//  exigeait que le domaine soit déclaré comme « parent » chez Twitch.
// ═══════════════════════════════════════════════════════════════════════════

import { LiveChat } from './live.js'
import { fetchPinned } from './pinned.js'
import { fetchHypeTrain, hypeFromGQL, hypeFromHermes, hypeView, mergeHype } from './hype.js'
import { fetchBotCommands } from './botcmds.js'
import { VodChat } from './vod.js'
import { badgeInfo, parseBadgeTag } from './badges.js'
import { emoteCatalog, findEmote, suggestEmotes } from './emotes.js'
import { linkifyHtml, plainText, resolveWords, systemMessage } from './message.js'
import { clipSlugFrom, gql } from '../api.js'
import { lang, t } from '../i18n.js'
import { $, debounce, esc, formatClock, icon, toast } from '../util.js'

// ── Drops de la chaîne ─────────────────────────────────────────────────────
// Campagne active (GQL public, sans compte) : une carte à fermer en haut du
// chat, comme dans l'app Twitch. Fermée, elle ne revient pas pour la même
// campagne.
const DROPS_QUERY = `query($l: String!) { user(login: $l) { channel { viewerDropCampaigns {
  id name endAt detailsURL game { displayName }
  timeBasedDrops { name requiredMinutesWatched benefitEdges { benefit { name imageAssetURL } } }
} } } }`
const DROPS_DISMISSED = 'tu_drops_dismissed'

function dismissedDrops() {
  try { return JSON.parse(localStorage.getItem(DROPS_DISMISSED) || '[]') } catch { return [] }
}

/** Première campagne en cours, pas encore fermée : sa première récompense
 *  et le temps de visionnage qu'elle demande. */
function pickCampaign(list) {
  const gone = new Set(dismissedDrops())
  for (const c of list ?? []) {
    if (!c?.id || gone.has(c.id)) continue
    const end = Date.parse(c.endAt)
    if (Number.isFinite(end) && end < Date.now()) continue
    const drops = (c.timeBasedDrops ?? []).slice()
      .sort((a, b) => (a.requiredMinutesWatched ?? 0) - (b.requiredMinutesWatched ?? 0))
    const first = drops[0]
    const benefit = first?.benefitEdges?.[0]?.benefit
    return {
      id: c.id,
      name: c.name ?? '',
      game: c.game?.displayName ?? '',
      endsAt: Number.isFinite(end) ? end : null,
      details: /^https:\/\//.test(c.detailsURL ?? '') ? c.detailsURL : '',
      reward: benefit?.name ?? first?.name ?? '',
      image: /^https:\/\//.test(benefit?.imageAssetURL ?? '') ? benefit.imageAssetURL : '',
      minutes: first?.requiredMinutesWatched ?? 0,
      more: Math.max(0, drops.length - 1),
    }
  }
  return null
}

/** Image plus grande que celle du chat, quand la source la propose (FFZ :
 *  `large`, lue avec l'emote). */
function largeEmote(url, source) {
  if (source === 'twitch') return url.replace('/2.0', '/3.0')
  if (source === 'bttv') return url.replace(/\/2x$/, '/3x')
  if (source === '7tv') return url.replace('/2x.webp', '/4x.webp')
  return url
}

/** Page de l'emote chez sa source (« Voir sur … »). */
const EMOTE_PAGES = {
  bttv: ['BetterTTV', (id) => `https://betterttv.com/emotes/${id}`],
  ffz: ['FrankerFaceZ', (id) => `https://www.frankerfacez.com/emoticon/${id}`],
  '7tv': ['7TV', (id) => `https://7tv.app/emotes/${id}`],
}

// Fiche d'une emote Twitch : type, chaîne propriétaire (en direct ou non) et
// emotes d'abonné du même niveau, comme sur twitch.tv. GQL public, sans
// compte. Une emote modifiée (_BW, _HF) répond aussi, avec son propre type.
const EMOTE_INFO_QUERY = `query($id: ID!) { emote(id: $id) { id token type subscriptionTier
  owner { id login displayName profileImageURL(width: 70) stream { id } subscriptionProducts { tier emotes { id token } } } } }`
/** Réponses de Twitch (emote: null compris), jamais les erreurs réseau : une
 *  panne passagère ne doit pas priver la fiche de ses infos pour la séance.
 *  { info, at } : au-delà de 5 min, on redemande (la chaîne a pu démarrer ou
 *  finir son direct). */
const emoteInfoCache = new Map()
const EMOTE_INFO_TTL = 5 * 60_000

async function twitchEmoteInfo(id) {
  const hit = emoteInfoCache.get(id)
  if (hit && Date.now() - hit.at < EMOTE_INFO_TTL) return hit.info
  const data = await gql(EMOTE_INFO_QUERY, { id }).catch(() => null)
  if (!data) {
    // Pas de réponse : l'ancienne sert encore, sans la pastille « En direct ».
    const old = hit?.info
    return old?.owner ? { ...old, owner: { ...old.owner, stream: null } } : old ?? null
  }
  const info = data.emote ?? null
  emoteInfoCache.delete(id)
  emoteInfoCache.set(id, { info, at: Date.now() })
  if (emoteInfoCache.size > 300) emoteInfoCache.delete(emoteInfoCache.keys().next().value)
  return info
}

/** « 10 min », « 24 h », « 7 j » dans la langue du site. */
function durationLabel(min) {
  const [n, unit] = min >= 1440 && min % 1440 === 0 ? [min / 1440, 'day']
    : min >= 60 && min % 60 === 0 ? [min / 60, 'hour'] : [min, 'minute']
  try { return new Intl.NumberFormat(lang(), { style: 'unit', unit, unitDisplay: 'short' }).format(n) } catch { return `${min} min` }
}

/** Durée d'une exclusion (secondes, jusqu'à deux semaines) : les deux unités
 *  les plus grandes, « 10 min », « 1 h 30 min », « 13 j 21 h ». */
function secondsLabel(total) {
  const units = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]
  const first = units.findIndex(([, n]) => total >= n)
  const parts = []
  for (const [unit, n] of units.slice(Math.max(0, first), Math.max(0, first) + 2)) {
    const v = Math.floor(total / n) % (unit === 'day' ? Infinity : unit === 'hour' ? 24 : 60)
    if (!v) continue
    try { parts.push(new Intl.NumberFormat(lang(), { style: 'unit', unit, unitDisplay: 'short' }).format(v)) } catch { parts.push(`${v} ${unit[0]}`) }
  }
  return parts.join(' ') || `${Math.round(total)} s`
}

// Règles du chat acceptées, par chaîne (redemandées si elles changent) ;
// en mémoire aussi, quand le navigateur refuse le stockage.
const RULES_KEY = 'tu_chat_rules'
const rulesMem = new Map()
function rulesAccepted(channel, rules) {
  const text = rules.join('\n')
  if (rulesMem.get(channel) === text) return true
  try { return (JSON.parse(localStorage.getItem(RULES_KEY) || '{}') || {})[channel] === text } catch { return false }
}
function acceptRules(channel, rules) {
  const text = rules.join('\n')
  rulesMem.set(channel, text)
  try {
    const all = JSON.parse(localStorage.getItem(RULES_KEY) || '{}') || {}
    all[channel] = text
    localStorage.setItem(RULES_KEY, JSON.stringify(all))
  } catch {}
}

const MAX_NODES = 300

/** Bots courants : masquables d'un réglage. */
const KNOWN_BOTS = new Set(['nightbot', 'streamelements', 'moobot', 'fossabot', 'streamlabs', 'wizebot', 'soundalerts',
  'sery_bot', 'botisimo', 'own3d', 'kofistreambot', 'pokemoncommunitygame', 'deepbot', 'coebot', 'phantombot', 'creatisbot', 'blerp'])

function formatPoints(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)
}

/** L'appareil affiche-t-il l'heure en 12 h (AM/PM) ? Lu une fois, d'après
 *  sa langue (navigateur), pas celle du site. */
const DEVICE_12H = (() => {
  try {
    const o = new Intl.DateTimeFormat(navigator.language, { hour: 'numeric' }).resolvedOptions()
    return o.hour12 ?? (o.hourCycle === 'h11' || o.hourCycle === 'h12')
  } catch { return false }
})()

/** Heure d'un message, dans la langue du site ; 12 h ou 24 h selon le
 *  réglage (`pref` : « auto », celui de l'appareil, « 12 » ou « 24 »). */
function timeLabel(ts, pref = 'auto') {
  const twelve = pref === '12' || (pref !== '24' && DEVICE_12H)
  return new Date(ts).toLocaleTimeString(lang(), { hour: twelve ? 'numeric' : '2-digit', minute: '2-digit', hour12: twelve })
}

/** Nom à écrire après « @ » : Twitch ne notifie que le pseudo, et un nom
 *  affiché localisé (日本語…) ne préviendrait personne. Le nom affiché
 *  reste quand il ne diffère du pseudo que par la casse. */
function mentionName(login, displayName) {
  return displayName && displayName.toLowerCase() === login ? displayName : login
}

/** Mots surveillés (réglages) → une expression qui les trouve en mots
 *  entiers, expressions de plusieurs mots comprises (la comparaison mot par
 *  mot n'en trouvait jamais). Bornes : ni lettre ni chiffre de part et
 *  d'autre, tous alphabets (\b ignore les lettres accentuées). Gardée tant
 *  que la liste ne change pas. */
let watchedKey = null
let watchedRe = null
function watchedWords(words) {
  const key = words.join('\n')
  if (key !== watchedKey) {
    watchedKey = key
    watchedRe = null
    const parts = words.map((w) => w.trim()).filter(Boolean)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    try {
      if (parts.length) watchedRe = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${parts.join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'u')
    } catch { /* navigateur sans \p{…} : pas de surlignage par mot */ }
  }
  return watchedRe
}

/** Texte où chercher les mots surveillés : tout le message, noms d'emotes
 *  et mentions compris, sans les liens. */
function watchText(tokens) {
  return tokens.map((tk) => (tk.kind === 'emote' ? tk.emote.name
    : tk.kind === 'mention' ? `@${tk.value}` : tk.kind === 'link' ? '' : tk.value)).join(' ').toLowerCase()
}

export class ChatView {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {object} o.prefs          préférences (timestamps, keepDeleted, loadHistory, chatSize)
   * @param {() => {token: string|null, login: string|null, canChat: boolean, needRescope: boolean}} o.session
   * @param {() => void} o.onLogin
   * @param {() => void} [o.onHide]
   */
  constructor(root, o) {
    this.root = root
    this.o = o
    this.client = null
    this.mode = null
    this.messages = []         // gardés pour la fiche utilisateur et les mentions
    this.queue = []
    this.frame = 0
    this.stick = true
    this.pending = 0
    this.replyTo = null
    this.suggestIndex = 0
    this.suggestions = []
    /** Suggestion choisie aux flèches : Entrée la prend (onKey). */
    this.suggestPicked = false
    /** Messages du direct mis en attente pour coller à l'image. */
    this.delayed = []
    this.delayTimer = null
    /** Fiche d'emote affichée : protège des réponses tardives. */
    this.infoSeq = 0
    /** Hype train : génération de la boucle de lecture (une par chaîne ouverte). */
    this.hypeGen = 0
    this.build()
  }

  // ── Structure ───────────────────────────────────────────────────────────
  build() {
    this.root.classList.add('chat')
    this.root.innerHTML = `
      <header class="chat-head">
        <span class="chat-title">${icon('chat', 16)}<span class="chat-title-text"></span></span>
        <span class="chat-status"></span>
        <button class="pin-chip" type="button" hidden>${icon('pin', 13)}<span data-i18n="pinned_short">${esc(t('pinned_short'))}</span></button>
        <button class="icon-btn sm chat-cmds-btn" type="button" data-i18n-title="bot_commands" title="${esc(t('bot_commands'))}">${icon('terminal', 17)}</button>
        <button class="icon-btn sm chat-hide" type="button" data-i18n-title="close">${icon('x', 18)}</button>
      </header>
      <div class="bot-cmds" hidden role="dialog"></div>
      <div class="chat-pinned" hidden role="region"></div>
      <div class="chat-drops" hidden role="region"></div>
      <div class="chat-events"></div>
      <div class="chat-list" role="log" aria-live="off" tabindex="0"></div>
      <button class="chat-resume" type="button" hidden>${icon('arrowDown', 14)}<span></span></button>
      <div class="chat-empty" hidden></div>
      <div class="chat-info" hidden role="dialog"></div>
      <footer class="chat-composer" hidden>
        <div class="chat-suggest" role="listbox" hidden></div>
        <div class="emote-picker" hidden>
          <div class="emote-picker-head">
            <input class="emote-search" type="search" autocomplete="off" data-i18n-ph="emote_search_ph">
          </div>
          <div class="emote-grid"></div>
        </div>
        <div class="chat-replying" hidden><span></span><button class="icon-btn xs" type="button">${icon('x', 14)}</button></div>
        <div class="chat-rules" hidden role="dialog"></div>
        <div class="chat-modes" hidden></div>
        <div class="chat-input-row">
          <input class="chat-input" type="text" maxlength="500" autocomplete="off" enterkeyhint="send" spellcheck="true">
          <button class="icon-btn sm chat-emote-btn" type="button" data-i18n-title="emotes">${icon('smile', 20)}</button>
          <button class="icon-btn sm chat-send" type="button" aria-label="send">${icon('send', 18)}</button>
        </div>
        <button class="chat-login" type="button" hidden></button>
        <div class="chat-banned" role="status" hidden><span></span><button class="btn sm ghost" type="button"></button></div>
      </footer>
      <div class="user-card" hidden role="dialog"></div>`

    this.el = {
      title: $('.chat-title-text', this.root),
      status: $('.chat-status', this.root),
      list: $('.chat-list', this.root),
      resume: $('.chat-resume', this.root),
      empty: $('.chat-empty', this.root),
      composer: $('.chat-composer', this.root),
      input: $('.chat-input', this.root),
      send: $('.chat-send', this.root),
      emoteBtn: $('.chat-emote-btn', this.root),
      picker: $('.emote-picker', this.root),
      grid: $('.emote-grid', this.root),
      emoteSearch: $('.emote-search', this.root),
      suggest: $('.chat-suggest', this.root),
      replying: $('.chat-replying', this.root),
      login: $('.chat-login', this.root),
      banned: $('.chat-banned', this.root),
      card: $('.user-card', this.root),
      inputRow: $('.chat-input-row', this.root),
      modes: $('.chat-modes', this.root),
      rules: $('.chat-rules', this.root),
      pinned: $('.chat-pinned', this.root),
      pinBtn: $('.pin-chip', this.root),
      drops: $('.chat-drops', this.root),
      info: $('.chat-info', this.root),
      events: $('.chat-events', this.root),
    }

    this.el.list.addEventListener('scroll', () => this.onScroll(), { passive: true })
    $('.chat-cmds-btn', this.root).addEventListener('click', () => this.toggleBotCommands())
    // La liste change de hauteur (message épinglé déplié, clavier, fenêtre) :
    // on reste calé en bas si on suivait, sinon le suivi semble s'arrêter.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => { if (this.stick) this.scrollToBottom() }).observe(this.el.list)
      // Hauteur de la saisie (modes, réponse, règles…) : le bouton « reprendre »
      // et la fiche d'une emote se posent au-dessus, sans la chevaucher.
      new ResizeObserver(() => {
        this.root.style.setProperty('--composer-h', `${this.el.composer.offsetHeight}px`)
      }).observe(this.el.composer)
    }
    this.el.resume.addEventListener('click', () => this.scrollToBottom(true))
    this.el.list.addEventListener('click', (e) => this.onListClick(e))
    // Fiche d'une emote ou d'un badge : copier, ajouter au message, fermer.
    this.el.info.addEventListener('click', async (e) => {
      if (e.target.closest('[data-ci-close]')) { this.el.info.hidden = true; return }
      // Chaîne propriétaire : la délégation globale de [data-channel]
      // (main.js) ouvre sa page ; la fiche, elle, se referme. Ctrl, Cmd ou
      // Maj + clic ouvrent un autre onglet : on reste ici, la fiche aussi.
      if (e.target.closest('[data-channel]')) {
        if (!(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0)) this.el.info.hidden = true
        return
      }
      const copy = e.target.closest('[data-ci-copy]')
      if (copy) {
        try {
          await navigator.clipboard.writeText(copy.dataset.ciCopy)
          $('span', copy).textContent = t('chat_info_copied')
        } catch { /* presse-papiers refusé : le nom reste sélectionnable */ }
        return
      }
      const ins = e.target.closest('[data-ci-insert]')
      if (ins) { this.insertText(ins.dataset.ciInsert); this.el.info.hidden = true; this.el.input.focus() }
    })
    document.addEventListener('pointerdown', (e) => {
      if (this.el.info.hidden || this.el.info.contains(e.target) || e.target.closest?.('img.emote, img.badge')) return
      this.el.info.hidden = true
    })
    this.el.drops.addEventListener('click', (e) => {
      if (!e.target.closest('[data-drops-close]')) return
      const id = this.el.drops.dataset.id
      try { localStorage.setItem(DROPS_DISMISSED, JSON.stringify([...dismissedDrops().filter((x) => x !== id), id].slice(-100))) } catch {}
      this.renderDrops(null)
    })
    $('.chat-hide', this.root).addEventListener('click', () => this.o.onHide?.())
    // Masqué, le message épinglé reste à portée : une punaise dans l'en-tête.
    this.el.pinBtn.addEventListener('click', () => {
      this.dismissedPin = null
      this.el.pinBtn.hidden = true
      if (this.pin) { this.el.pinned.hidden = true; this.renderPinned(this.pin, true) }
    })
    this.el.pinned.addEventListener('click', (e) => {
      if (e.target.closest('a')) return
      const img = e.target.closest('img.emote, img.badge')
      if (img) { this.showInfo(img); return }
      // Pseudo mentionné dans le message épinglé : même fiche que dans la liste.
      const mention = e.target.closest('[data-user]')
      if (mention) { this.onListClick(e); return }
      if (e.target.closest('[data-pin-close]')) {
        // Réduit en pastille plutôt que de disparaître : un toucher le rouvre.
        this.dismissedPin = this.pin?.id ?? null
        this.el.pinned.hidden = true
        this.el.pinBtn.hidden = false
        return
      }
      // Déplier n'a de sens que si le texte dépasse.
      if (!this.el.pinned.classList.contains('can-open')) return
      // Déplié, le message passe par-dessus le chat : la boîte garde sa
      // hauteur repliée, la liste ne bouge pas et continue de défiler.
      const box = this.el.pinned
      if (!box.classList.contains('open')) box.style.height = `${box.offsetHeight}px`
      const open = box.classList.toggle('open')
      if (!open) box.style.height = ''
      $('[data-pin-toggle]', this.el.pinned)?.setAttribute('aria-expanded', String(open))
    })

    this.el.input.addEventListener('keydown', (e) => this.onKey(e))
    this.el.input.addEventListener('input', () => this.updateSuggestions())
    this.el.input.addEventListener('blur', () => setTimeout(() => this.hideSuggestions(), 150))
    this.el.send.addEventListener('click', () => this.submit())
    this.el.emoteBtn.addEventListener('click', () => this.togglePicker())
    this.el.emoteSearch.addEventListener('input', debounce(() => this.renderPicker(), 120))
    this.el.grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-emote]')
      if (b) this.insertText(b.dataset.emote)
    })
    // Clic droit (appui long sur Android) : la fiche de l'emote ; le clic
    // simple insère toujours.
    this.el.grid.addEventListener('contextmenu', (e) => {
      const b = e.target.closest('[data-emote]')
      if (!b) return
      e.preventDefault()
      this.showInfo(b)
    })
    this.el.suggest.addEventListener('mousedown', (e) => {
      const b = e.target.closest('[data-i]')
      if (b) { e.preventDefault(); this.applySuggestion(Number(b.dataset.i)) }
    })
    $('button', this.el.replying).addEventListener('click', () => this.setReply(null))
    this.el.login.addEventListener('click', () => this.o.onLogin())
    // Banni de ce chat : retente avec le compte (Twitch ne signale aucun déban).
    $('button', this.el.banned).addEventListener('click', () => this.client?.retryWithAccount?.())
    this.el.card.addEventListener('click', (e) => this.onCardClick(e))
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      // La fiche d'une emote d'abord : elle peut couvrir la fiche
      // utilisateur ou le sélecteur, qui restent ouverts dessous.
      if (!this.el.info.hidden) { this.el.info.hidden = true; return }
      this.hideCard()
      this.hidePicker()
    })

    this.applyPrefs()
  }

  applyPrefs() {
    const p = this.o.prefs
    this.root.style.setProperty('--chat-size', `${p.chatSize}px`)
    this.root.classList.toggle('show-time', Boolean(p.timestamps))
  }

  // ── Ouverture / fermeture ──────────────────────────────────────────────
  openLive({ channel, channelId }) {
    this.close()
    this.mode = 'live'
    this.channel = channel
    this.authFailed = false
    this.el.title.textContent = t('chat')
    this.setStatus('connecting')
    const s = this.o.session()
    this.client = new LiveChat({
      channel,
      channelId,
      token: s.canChat ? s.token : null,
      login: s.canChat ? s.login : null,
      loadRecent: this.o.prefs.loadHistory,
      onEvent: (type, payload) => this.onEvent(type, payload),
    })
    // Compte déjà refusé dans ce chat pendant la séance : le bandeau tout de suite.
    this.refreshComposer()
    this.client.start()
    this.startPinned(channel)
    this.startHype(channel)
    this.startDrops(channel)
    this.loadChatSettings(channel)
  }

  // ── Modes du salon et règles ───────────────────────────────────────────
  /** Règles et modes du chat (GQL public) : on sait avant d'écrire qui peut
   *  écrire, et les règles s'acceptent avant le premier message. */
  async loadChatSettings(channel) {
    try {
      const data = await gql(`query($l: String!) { user(login: $l) { chatSettings { rules followersOnlyDurationMinutes
        isSubscribersOnlyModeEnabled isEmoteOnlyModeEnabled slowModeDurationSeconds requireVerifiedAccount isUniqueChatModeEnabled } } }`, { l: channel })
      const cs = data?.user?.chatSettings
      if (!cs || this.channel !== channel || this.mode !== 'live') return
      this.rules = (cs.rules ?? []).map((r) => String(r).trim()).filter(Boolean)
      this.renderModes({
        ...this.modes,
        followers: cs.followersOnlyDurationMinutes ?? null,
        subs: Boolean(cs.isSubscribersOnlyModeEnabled),
        emotes: Boolean(cs.isEmoteOnlyModeEnabled),
        slow: cs.slowModeDurationSeconds || 0,
        unique: Boolean(cs.isUniqueChatModeEnabled),
        verified: Boolean(cs.requireVerifiedAccount),
      })
    } catch {}
  }

  /** Modes qui limitent qui peut écrire, au-dessus du champ. */
  renderModes(m) {
    this.modes = m
    const chips = []
    if (m.followers != null) chips.push(['users', m.followers > 0 ? t('chat_mode_followers_min', { d: durationLabel(m.followers) }) : t('chat_mode_followers')])
    if (m.subs) chips.push(['sparkles', t('chat_mode_subs')])
    if (m.emotes) chips.push(['smile', t('chat_mode_emotes')])
    if (m.slow > 0) chips.push(['clock', t('chat_mode_slow', { s: m.slow })])
    if (m.unique) chips.push(['copy', t('chat_mode_unique')])
    if (m.verified) chips.push(['check', t('chat_mode_verified')])
    this.el.modes.innerHTML = chips.map(([ic, label]) => `<span class="chat-mode">${icon(ic, 12)}<span>${esc(label)}</span></span>`).join('')
    this.el.modes.hidden = !chips.length
  }

  /** Règles de la chaîne, à accepter avant d'écrire (comme sur Twitch) :
   *  acceptées, le message en attente dans le champ part. */
  showRules() {
    const box = this.el.rules
    box.innerHTML = `<b>${esc(t('chat_rules_title', { c: this.channel }))}</b>
      ${this.rules.map((r) => `<p class="rule">${esc(r)}</p>`).join('')}
      <div class="chat-rules-actions">
        <button class="btn ghost sm" type="button" data-rules="no">${esc(t('cancel'))}</button>
        <button class="btn primary sm" type="button" data-rules="yes">${esc(t('chat_rules_accept'))}</button>
      </div>`
    box.hidden = false
    box.onclick = (e) => {
      const b = e.target.closest('[data-rules]')
      if (!b) return
      box.hidden = true
      if (b.dataset.rules === 'yes') {
        acceptRules(this.channel, this.rules)
        this.submit()
      }
    }
  }

  // ── Message épinglé ────────────────────────────────────────────────────
  /** Interrogé à l'ouverture puis toutes les 20 s : un épinglage peut
   *  arriver, changer ou disparaître en cours de live. */
  startPinned(channel) {
    clearInterval(this.pinTimer)
    const load = async () => {
      // Onglet en arrière-plan : inutile d'interroger Twitch.
      if (document.hidden && this.pin !== undefined) return
      let pin = null
      try { pin = await fetchPinned(channel) } catch { return }
      this.applyPin(pin, channel)
    }
    this.pin = undefined
    load()
    this.pinTimer = setInterval(load, 20_000)
  }

  /** Message épinglé relu (relecture régulière ou signal Hermes). Un nouvel
   *  épinglage attend le retard du chat synchronisé : il ne doit pas
   *  apparaître avant l'image qui le montre — le signal Hermes l'affichait
   *  tout de suite. */
  applyPin(pin, channel) {
    if (this.mode !== 'live' || this.channel !== channel) return
    const delay = pin && pin.id !== this.pin?.id && this.pin !== undefined ? this.o.getDelay?.() ?? 0 : 0
    if (delay >= 0.5) setTimeout(() => { if (this.channel === channel && this.mode === 'live') this.renderPinned(pin) }, delay * 1000)
    else this.renderPinned(pin)
  }

  // ── Drops de la chaîne ─────────────────────────────────────────────────
  /** Lue à l'ouverture puis toutes les 10 minutes : une campagne peut
   *  commencer pendant le live. */
  startDrops(channel) {
    clearInterval(this.dropsTimer)
    this.renderDrops(null)
    let first = true
    const load = async () => {
      // Onglet en arrière-plan : inutile de relire (la première lecture a lieu).
      if (document.hidden && !first) return
      first = false
      let list = null
      try { list = (await gql(DROPS_QUERY, { l: channel }))?.user?.channel?.viewerDropCampaigns } catch { return }
      if (this.mode !== 'live' || this.channel !== channel) return
      this.renderDrops(pickCampaign(list))
    }
    load()
    this.dropsTimer = setInterval(load, 600_000)
  }

  renderDrops(c) {
    const box = this.el.drops
    if (!c) { box.hidden = true; box.innerHTML = ''; delete box.dataset.id; return }
    const head = c.reward && c.minutes ? t('drops_notice_title', { m: c.minutes, r: c.reward }) : c.name
    const sub = [c.name, c.game].filter(Boolean).join(' · ') + (c.more ? ` · ${t('drops_notice_more', { n: c.more })}` : '')
    const ends = c.endsAt
      ? new Date(c.endsAt).toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : ''
    box.innerHTML = `${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : `<span class="drops-ic">${icon('sparkles', 18)}</span>`}
      <div class="drops-body">
        <strong>${esc(head)}</strong>
        <span class="muted">${esc(sub)}</span>
        <span class="drops-meta">${ends ? `<span>${esc(t('drops_notice_ends', { d: ends }))}</span>` : ''}${c.details ? `<a href="${esc(c.details)}" target="_blank" rel="noopener noreferrer">${esc(t('drops_notice_details'))}</a>` : ''}</span>
      </div>
      <button class="icon-btn xs" type="button" data-drops-close aria-label="${esc(t('close'))}">${icon('x', 14)}</button>`
    box.dataset.id = c.id
    box.hidden = false
  }

  // ── Fiche d'une emote ou d'un badge ────────────────────────────────────
  /** Image en grand, nom exact (à copier), source et portée, auteur ; pour
   *  une emote Twitch, son type et sa chaîne (lus à part) ; pour un badge,
   *  son titre et sa description. `el` : l'image d'une emote ou d'un badge
   *  (chat, épinglé, fiche utilisateur) ou une case du sélecteur. */
  showInfo(el) {
    // Une réponse lente d'une fiche précédente ne doit pas remplir celle-ci.
    const seq = ++this.infoSeq
    let html
    let small = ''
    let twitchId = null
    if (el.classList.contains('badge')) {
      const [set, version] = String(el.dataset.badge ?? '').split('/')
      const info = set ? badgeInfo(set, version) : null
      const title = info?.title || String(set ?? '').replace(/_/g, ' ')
      small = el.src
      // Taille /3 (72 px) : la /2 du chat (36 px) est floue à 44 px.
      html = `<img class="ci-img ci-badge" src="${esc(small.replace(/\/2$/, '/3'))}" alt="">
        <strong class="ci-title">${esc(title)}</strong>
        ${info?.description && info.description !== info.title ? `<p class="ci-src">${esc(info.description)}</p>` : ''}
        <p class="ci-src">${esc(t('chat_info_badge'))}</p>`
    } else {
      const pic = el.tagName === 'IMG' ? el : $('img', el)
      const name = el.dataset.emote ?? pic?.alt ?? ''
      const source = el.dataset.emoteSrc ?? ''
      const id = el.dataset.emoteId ?? ''
      small = pic?.src ?? ''
      const e = source && source !== 'twitch' ? findEmote(source, id) : null
      const personal = Boolean(el.dataset.personal || e?.personal)
      const brand = { bttv: 'BetterTTV', ffz: 'FrankerFaceZ', '7tv': '7TV' }[source]
      const scope = { global: t('emote_scope_global'), channel: t('emote_scope_channel') }[e?.scope]
      const label = source === 'twitch' ? t('emote_src_twitch')
        : source === 'bttv' && personal ? t('emote_src_bttv_personal')
          : brand ? [brand, scope].filter(Boolean).join(' · ') : ''
      const lines = [
        e?.by && t('emote_by', { u: e.by }),
        e?.orig && t('emote_original', { n: e.orig }),
        e?.zw && t('emote_zero_width'),
        e?.mod && t('emote_modifier'),
      ].filter(Boolean)
      const page = EMOTE_PAGES[source]
      // Hors connexion, le champ est caché : « Ajouter » y écrirait en vain.
      const canInsert = !this.el.composer.hidden && !this.el.inputRow.hidden && !this.el.input.disabled
      if (source === 'twitch' && id) twitchId = id
      html = `<img class="ci-img" src="${esc(e?.large ?? largeEmote(small, source))}" alt="${esc(name)}">
        <strong class="ci-name">${esc(name)}</strong>
        ${label ? `<p class="ci-src ci-type">${esc(label)}</p>` : ''}
        ${lines.map((l) => `<p class="ci-src">${esc(l)}</p>`).join('')}
        ${twitchId ? '<div class="ci-twitch"></div>' : ''}
        ${page && id ? `<a class="ci-link" href="${esc(page[1](encodeURIComponent(id)))}" target="_blank" rel="noopener noreferrer">${esc(t('emote_view_on', { p: page[0] }))}${icon('external', 12)}</a>` : ''}
        <div class="ci-btns">
          <button class="btn sm primary" type="button" data-ci-copy="${esc(name)}">${icon('copy', 15)}<span>${esc(t('chat_info_copy'))}</span></button>
          ${canInsert ? `<button class="btn sm" type="button" data-ci-insert="${esc(name)}"><span>${esc(t('chat_info_insert'))}</span></button>` : ''}
        </div>`
    }
    this.el.info.innerHTML = `<button class="icon-btn xs ci-close" type="button" data-ci-close aria-label="${esc(t('close'))}">${icon('x', 14)}</button>${html}`
    // Grande image absente (FFZ sans taille 4, badge sans /3) : celle du chat.
    const big = $('.ci-img', this.el.info)
    if (big && small) big.addEventListener('error', () => { if (big.src !== small) big.src = small }, { once: true })
    this.el.info.scrollTop = 0
    this.el.info.hidden = false
    if (twitchId) this.fillTwitchInfo(twitchId, seq)
  }

  /** Type, chaîne propriétaire et emotes d'abonné du même niveau d'une emote
   *  Twitch. Sans réponse (Twitch bloqué, schéma changé), la fiche reste
   *  telle quelle, sans message d'erreur. */
  async fillTwitchInfo(id, seq) {
    let info
    try { info = await twitchEmoteInfo(id) } catch { return }
    if (!info || seq !== this.infoSeq || this.el.info.hidden) return
    const box = $('.ci-twitch', this.el.info)
    if (!box) return
    const tier = /^TIER_(\d)$/.exec(info.subscriptionTier ?? '')?.[1]
    // Seuls ces types sont vérifiés : pour un autre, aucune ligne plutôt
    // qu'une valeur brute.
    const type = info.type === 'GLOBALS' || info.type === 'SMILIES' ? t('emote_type_global')
      : info.type === 'SUBSCRIPTIONS' && tier ? `Twitch · ${t('emote_type_sub', { n: tier })}`
        : info.type === 'CHANNEL_POINTS' ? `Twitch · ${t('emote_type_points')}` : ''
    const typeLine = $('.ci-type', this.el.info)
    if (type && typeLine) typeLine.textContent = type
    const o = info.owner
    if (!o?.login) return
    const name = o.displayName || o.login
    const avatar = /^https:\/\//.test(o.profileImageURL ?? '') ? `<img src="${esc(o.profileImageURL)}" alt="" loading="lazy">` : ''
    // Vrai lien vers la page de la chaîne : la délégation de main.js réduit
    // le lecteur (ou ferme le multi-live) et l'ouvre, même hors ligne.
    let html = `<a class="ci-owner" href="/${encodeURIComponent(o.login)}" data-channel="${esc(o.login)}">${avatar}
      <strong>${esc(name)}</strong>${o.stream ? `<span class="pill live sm">${esc(t('live_now'))}</span>` : ''}
      <span class="ci-owner-go">${esc(t('see_channel'))}${icon('chevronRight', 14)}</span></a>`
    if (info.type === 'SUBSCRIPTIONS' && tier) {
      // Comme Twitch : les emotes du même niveau (« 63 autres » = 64 au niveau 1).
      const same = (o.subscriptionProducts ?? []).find((p) => String(p?.tier) === `${tier}000`)?.emotes ?? []
      const others = same.filter((x) => x?.id && x.id !== info.id).slice(0, 8)
      if (same.length) html += `<p class="ci-src">${esc(t('emote_sub_count', { c: name, n: same.length }))}</p>`
      if (others.length) {
        html += `<div class="ci-more">${others.map((x) => `<img src="https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(x.id)}/static/dark/2.0" alt="${esc(x.token ?? '')}" title="${esc(x.token ?? '')}" loading="lazy" onerror="this.remove()">`).join('')}</div>`
      }
    }
    box.innerHTML = html
  }

  renderPinned(pin, force = false) {
    const box = this.el.pinned
    const changed = force || pin?.id !== this.pin?.id
    this.pin = pin
    clearTimeout(this.pinExpiry)
    // La pastille n'a de sens que s'il y a un message épinglé réduit.
    this.el.pinBtn.hidden = !pin || pin.id !== this.dismissedPin
    if (!pin || pin.id === this.dismissedPin) { box.hidden = true; this.pinResize?.disconnect(); return }
    // Fin programmée : masqué à l'échéance, sans attendre la prochaine requête.
    if (pin.endsAt) {
      const left = pin.endsAt - Date.now()
      if (left <= 0) { this.renderPinned(null); return }
      this.pinExpiry = setTimeout(() => { if (this.pin?.id === pin.id) this.renderPinned(null) }, left)
    }
    if (!changed && !box.hidden) { this.updatePinMeta(); return }

    box.classList.remove('open', 'can-open')
    box.style.height = ''
    const badges = pin.badges.map((b) => `<img class="badge" src="${esc(b.url)}" alt="" title="${esc(badgeInfo(b.set, b.version)?.title || b.set)}" data-badge="${esc(b.version ? `${b.set}/${b.version}` : b.set)}">`).join('')
    // Lu en même temps que les emotes de la chaîne : celles arrivées depuis
    // remplacent les mots restés en texte (voir l'évènement « emotes »).
    const tokens = resolveWords(pin.tokens)
    box.innerHTML = `<div class="pin-panel">
      <div class="pin-row">
        <span class="pin-ic">${icon('pin', 14)}</span>
        <div class="pin-body">${badges}<span class="pin-sender" style="color:${esc(pin.color)}">${esc(pin.sender)}</span><span class="pin-colon">:</span> ${this.renderTokens(tokens, this.o.session().login)}</div>
        <button class="icon-btn xs pin-toggle" type="button" data-pin-toggle aria-expanded="false" aria-label="${esc(t('pinned'))}" hidden>${icon('chevronDown', 16)}</button>
        <button class="icon-btn xs" type="button" data-pin-close aria-label="${esc(t('close'))}">${icon('x', 14)}</button>
      </div>
      <div class="pin-meta"></div>
      ${pin.endsAt && pin.startsAt ? '<div class="pin-progress"><i></i></div>' : ''}</div>`
    for (const img of box.querySelectorAll('img.badge')) img.addEventListener('error', () => img.remove(), { once: true })
    box.hidden = false
    this.updatePinMeta()
    this.layoutPin(pin)
  }

  /** Chevron (seulement si le texte est coupé) et barre de durée, refaits
   *  dès que le bandeau a une taille. Rendu pendant que le chat était
   *  masqué, il mesurait 0 : pas de chevron, et une barre déjà vide (une
   *  transition ne court pas sur un élément non affiché). */
  layoutPin(pin) {
    const box = this.el.pinned
    const body = $('.pin-body', box)
    const bar = $('.pin-progress i', box)
    const measure = () => {
      // Déplié, le texte passe à la ligne : la mesure ne dirait plus rien.
      if (box.classList.contains('open')) return
      const cut = body.scrollWidth > body.clientWidth + 1
      box.classList.toggle('can-open', cut)
      $('[data-pin-toggle]', box).hidden = !cut
    }
    // Barre de durée : part de la fraction restante et file jusqu'à zéro.
    const runBar = () => {
      if (!bar) return
      const left = pin.endsAt - Date.now()
      bar.style.transition = 'none'
      bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (pin.endsAt - pin.startsAt)))})`
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bar.style.transition = `transform ${Math.max(0, left)}ms linear`
        bar.style.transform = 'scaleX(0)'
      }))
    }
    this.pinResize?.disconnect()
    if (!('ResizeObserver' in window)) { requestAnimationFrame(measure); runBar(); return }
    // Largeur nulle : chat masqué. La barre repart quand il réapparaît.
    let sized = false
    this.pinResize = new ResizeObserver(() => {
      if (!body.clientWidth) { sized = false; return }
      measure()
      if (!sized) { sized = true; runBar() }
    })
    this.pinResize.observe(body)
  }

  /** Changement signalé en temps réel (Hermes) : relecture immédiate. */
  refreshPinned() {
    if (this.mode !== 'live' || !this.channel) return
    const channel = this.channel
    fetchPinned(channel).then((pin) => this.applyPin(pin, channel)).catch(() => {})
  }

  // ── Raid ───────────────────────────────────────────────────────────────
  /** Bandeau « X part en raid chez Y » avec compte à rebours. */
  showRaid(raid, { onFollow, onCancel, auto }) {
    let box = $('.chat-raid', this.el.events)
    if (!box) {
      box = document.createElement('div')
      box.className = 'chat-raid'
      this.el.events.prepend(box)
    }
    const target = esc(raid.target_display_name || raid.target_login || '')
    const avatar = /^https:\/\//.test(raid.target_profile_image ?? '') ? raid.target_profile_image.replace('%s', '70x70') : ''
    box.innerHTML = `
      ${avatar ? `<img class="raid-avatar" src="${esc(avatar)}" alt="">` : `<span class="raid-avatar">${icon('users', 16)}</span>`}
      <div class="raid-text">
        <b>${esc(t('raid_title', { u: target }))}</b>
        <span class="raid-sub">${esc(t('raid_viewers', { n: raid.viewer_count ?? 0 }))}${auto ? ` · <span class="raid-count"></span>` : ''}</span>
      </div>
      <button class="btn primary sm" type="button" data-raid-follow>${esc(t('raid_follow'))}</button>
      ${auto ? `<button class="icon-btn xs" type="button" data-raid-cancel aria-label="${esc(t('cancel'))}">${icon('x', 14)}</button>` : ''}`
    $('[data-raid-follow]', box).onclick = () => onFollow()
    const cancel = $('[data-raid-cancel]', box)
    if (cancel) cancel.onclick = () => { onCancel(); this.hideRaid() }
    // Compte à rebours jusqu'au départ (le streamer peut le lancer avant).
    clearInterval(this.raidTimer)
    const ends = Date.now() + (raid.force_raid_now_seconds ?? 90) * 1000
    const tickRaid = () => {
      const el = $('.raid-count', box)
      if (el) el.textContent = t('raid_in', { n: Math.max(0, Math.ceil((ends - Date.now()) / 1000)) })
    }
    tickRaid()
    this.raidTimer = setInterval(tickRaid, 1000)
  }

  hideRaid() {
    clearInterval(this.raidTimer)
    $('.chat-raid', this.el.events)?.remove()
  }

  // ── Hype train ─────────────────────────────────────────────────────────
  /** Lu à l'ouverture (GQL public, sans compte), puis toutes les 5 s pendant
   *  une approche — le départ s'y voit vite, même sans Hermes (multi-live) —
   *  et toutes les 20 s sinon ; relu aussi dès l'échéance passée (setHype). */
  startHype(channel) {
    const gen = ++this.hypeGen
    clearTimeout(this.hypePoll)
    this.hype = undefined
    let busy = false
    const load = async () => {
      if (busy || gen !== this.hypeGen) return
      busy = true
      clearTimeout(this.hypePoll)
      // Onglet en arrière-plan : inutile d'interroger Twitch (la première
      // lecture a lieu ; Hermes continue de raconter la suite).
      if (!document.hidden || this.hype === undefined) {
        let ht
        try { ht = await fetchHypeTrain(channel) } catch {}
        if (gen !== this.hypeGen) return
        // Lecture ratée : rien ne change, rien ne se déduit.
        if (ht !== undefined) {
          const now = Date.now()
          this.setHype(mergeHype(this.hype ?? null, hypeFromGQL(ht, now), now, this.hype === undefined))
        }
      }
      busy = false
      this.hypePoll = setTimeout(load, this.hype?.phase === 'approaching' ? 5000 : 20_000)
    }
    this.hypeLoad = load
    load()
  }

  /** Message Hermes du hype train (chat principal) : départ, niveaux et fin
   *  à la seconde. Pas retardé par le chat synchronisé, comme la prédiction. */
  applyHype(msg) {
    if (this.mode !== 'live') return
    const next = hypeFromHermes(msg, this.hype ?? null, Date.now())
    if (next !== undefined) this.setHype(next)
  }

  /** Nouvel état : la carte suit, et l'échéance programme une relecture
   *  plutôt qu'un effacement — une montée de niveau la repousse de 5 min, un
   *  départ remplace l'approche juste avant la sienne. */
  setHype(state) {
    this.hype = state
    clearTimeout(this.hypeDue)
    if (state && state.phase !== 'ended') {
      const gen = this.hypeGen
      // Échéance déjà passée (Hermes vient de parler, GQL en retard) : on
      // relit dans 5 s plutôt qu'à chaque seconde.
      const wait = state.endsAt - Date.now()
      this.hypeDue = setTimeout(() => { if (gen === this.hypeGen) this.hypeLoad?.() }, wait > 0 ? wait + 1000 : 5000)
    }
    this.renderHype()
  }

  /** Carte au-dessus de la prédiction : l'approche (pastilles, soutiens qui
   *  manquent, compte à rebours), le départ, le niveau en cours (barre du
   *  niveau, temps restant), un niveau terminé, la fin. Tenue à jour chaque
   *  seconde tant qu'elle est là ; un clic replie la seconde ligne. */
  renderHype() {
    const now = Date.now()
    const s = this.hype
    const view = hypeView(s, now)
    let box = $('.chat-hype', this.el.events)
    if (!view) {
      box?.remove()
      clearInterval(this.hypeTimer)
      this.hypeTimer = null
      this.hypeSig = ''
      // Fin montée puis écoulée : on repart de zéro.
      if (s?.phase === 'ended') this.hype = null
      return
    }
    if (!box) {
      box = document.createElement('div')
      box.className = 'chat-hype'
      box.setAttribute('role', 'group')
      // Sous le raid, au-dessus de la prédiction.
      this.el.events.insertBefore(box, $('.chat-pred', this.el.events))
      box.addEventListener('click', () => box.classList.toggle('folded'))
    }
    const title = t(s.variant === 'golden' ? 'hype_golden' : s.variant === 'treasure' ? 'hype_treasure' : 'hype_train')
    const pct = Math.round((s.percent ?? 0) * 100)
    // Compte à rebours muet pour les lecteurs d'écran : le libellé de la carte suffit.
    const count = '<span class="hype-count" aria-hidden="true"></span>'
    let head
    let body = ''
    let label
    if (view === 'approaching' || view === 'kickoff') {
      // Comme Twitch : 2 pastilles (3 au-delà de 5 soutiens), les dernières
      // vides tant qu'il manque des soutiens ; au départ, tout se remplit.
      const dots = s.bigGoal ? 3 : 2
      const empty = view === 'kickoff' ? 0 : Math.max(1, Math.min(dots - 1, s.left))
      const pills = Array.from({ length: dots }, (_, i) => {
        const on = i < dots - empty
        return `<i class="hype-dot${on ? ' on' : ''}${view === 'kickoff' && i === dots - 1 ? ' go' : ''}">${on ? icon('check', 10) : ''}</i>`
      }).join('')
      const kick = view === 'approaching' ? t('hype_kickoff', { n: s.left }) : ''
      head = `<b>${esc(title)}</b><span class="hype-tag">${esc(t('hype_incoming'))}</span>${view === 'approaching' ? count : ''}`
      body = `<span class="hype-dots">${pills}</span><span class="hype-sub">${esc(kick)}</span>`
      label = [title, t('hype_incoming'), kick].filter(Boolean).join(' · ')
    } else if (view === 'departed') {
      head = `<b>${esc(t('hype_departed'))}</b>`
      body = `<span class="hype-sub">${esc(t('hype_departed_sub'))}</span>`
      label = `${t('hype_departed')} ${t('hype_departed_sub')}`
    } else if (view === 'ended') {
      head = `<b>${esc(t('hype_ended', { n: s.level, p: pct }))}</b>`
      label = t('hype_ended', { n: s.level, p: pct })
    } else {
      // En route, ou niveau tout juste terminé (le message prend la place du titre).
      const level = `${title} · ${t('hype_level', { n: s.level })}`
      const done = view === 'levelDone' ? t('hype_level_done', { n: s.flash.n }) : ''
      head = `<b>${esc(done || level)}</b>${count}`
      body = `<span class="hype-bar"><i style="width:${pct}%"></i></span><span class="hype-pct">${pct}%</span>`
      label = [done, level, `${pct}%`].filter(Boolean).join(' · ')
    }
    const html = `<div class="hype-head">${icon('train', 14)}${head}</div>${body ? `<div class="hype-body">${body}</div>` : ''}`
    if (html !== this.hypeSig) {
      box.innerHTML = html
      box.dataset.view = view
      box.setAttribute('aria-label', label)
      this.hypeSig = html
    }
    const el = $('.hype-count', box)
    if (el) {
      const sec = Math.ceil((s.endsAt - now) / 1000)
      el.textContent = sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : ''
    }
    this.hypeTimer ??= setInterval(() => this.renderHype(), 1000)
  }

  // ── Prédiction ─────────────────────────────────────────────────────────
  /** Carte de prédiction en lecture seule : issues en %, points, compte à
   *  rebours, puis l'issue gagnante une minute après la résolution. */
  setPrediction(ev) {
    clearInterval(this.predTimer)
    clearTimeout(this.predHide)
    let box = $('.chat-pred', this.el.events)
    const status = ev?.status
    if (!ev || status === 'CANCELED' || status === 'CANCEL_PENDING') { box?.remove(); return }
    if (!box) {
      box = document.createElement('div')
      box.className = 'chat-pred'
      this.el.events.append(box)
      box.addEventListener('click', () => box.classList.toggle('open'))
    }
    const outcomes = ev.outcomes ?? []
    const total = Math.max(1, outcomes.reduce((n, o) => n + (o.total_points ?? 0), 0))
    const winner = ev.winning_outcome_id
    const colors = { BLUE: '#387aff', PINK: '#f5009b' }
    box.innerHTML = `
      <div class="pred-head">
        ${icon('sparkles', 14)}
        <b>${esc(ev.title ?? '')}</b>
        <span class="pred-state">${esc(status === 'RESOLVED' ? t('pred_result') : status === 'LOCKED' ? t('pred_locked') : '')}</span>
      </div>
      <div class="pred-body">
        ${outcomes.map((o) => {
          const pct = Math.round(((o.total_points ?? 0) / total) * 100)
          const color = winner && winner !== o.id ? 'var(--muted)' : colors[o.color] ?? 'var(--purple)'
          return `<div class="pred-row${winner === o.id ? ' win' : ''}">
            <div class="pred-label"><span>${winner === o.id ? '🏆 ' : ''}${esc(o.title ?? '')}</span><span>${pct}% · ${esc(formatPoints(o.total_points ?? 0))} · ${esc(String(o.total_users ?? 0))} 👤</span></div>
            <div class="pred-bar"><i style="width:${pct}%;background:${color}"></i></div>
          </div>`
        }).join('')}
      </div>`
    if (status === 'ACTIVE' && ev.created_at && ev.prediction_window_seconds) {
      const ends = Date.parse(ev.created_at) + ev.prediction_window_seconds * 1000
      const el = $('.pred-state', box)
      const tickPred = () => {
        const s = Math.max(0, Math.round((ends - Date.now()) / 1000))
        el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      }
      tickPred()
      this.predTimer = setInterval(tickPred, 1000)
    }
    if (status === 'RESOLVED') this.predHide = setTimeout(() => box.remove(), 60_000)
  }

  /** « Épinglé par X · il y a 3 min · 12 min restantes » */
  updatePinMeta() {
    const pin = this.pin
    const meta = pin && $('.pin-meta', this.el.pinned)
    if (!meta) return
    const parts = [pin.pinnedBy ? t('pinned_by', { u: pin.pinnedBy }) : t('pinned')]
    const ago = (ms) => {
      const m = Math.floor(ms / 60000)
      return m < 1 ? t('just_now') : m < 60 ? t('minutes_ago', { n: m }) : t('hours_ago', { n: Math.floor(m / 60) })
    }
    if (pin.startsAt) parts.push(ago(Date.now() - pin.startsAt))
    if (pin.endsAt) parts.push(t('pin_left', { n: Math.max(1, Math.ceil((pin.endsAt - Date.now()) / 60000)) }))
    meta.textContent = parts.join(' · ')
  }

  openVod({ videoId, channelId, channelLogin, startAt }) {
    this.close()
    this.mode = 'vod'
    this.channel = channelLogin
    this.el.title.textContent = t('chat_vod')
    this.el.composer.hidden = true
    this.setStatus('connecting')
    this.client = new VodChat({
      videoId, channelId, channelLogin,
      onEvent: (type, payload) => this.onEvent(type, payload),
    })
    this.client.start(startAt || 0)
  }

  /** Temps de lecture, pour le chat des VODs. */
  tick(seconds) {
    if (this.mode === 'vod') this.client?.tick(seconds)
  }

  close() {
    this.rules = []
    this.renderModes({})
    this.el.rules.hidden = true
    // Commandes des bots : celles de la chaîne quittée restaient affichées.
    $('.bot-cmds', this.root).hidden = true
    clearInterval(this.pinTimer)
    clearTimeout(this.pinExpiry)
    this.pinResize?.disconnect()
    clearInterval(this.dropsTimer)
    this.renderDrops(null)
    this.el.info.hidden = true
    clearInterval(this.raidTimer)
    clearInterval(this.predTimer)
    clearTimeout(this.predHide)
    // Hype train : la boucle de lecture s'arrête (génération changée), la
    // carte part avec les autres événements.
    this.hypeGen++
    clearTimeout(this.hypePoll)
    clearTimeout(this.hypeDue)
    clearInterval(this.hypeTimer)
    this.hypeTimer = null
    this.hypeSig = ''
    this.hype = undefined
    this.el.events.innerHTML = ''
    clearInterval(this.delayTimer)
    this.delayTimer = null
    this.delayed = []
    this.pin = null
    this.dismissedPin = null
    this.el.pinned.hidden = true
    this.el.pinBtn.hidden = true
    this.client?.stop()
    this.client = null
    this.mode = null
    cancelAnimationFrame(this.frame)
    this.queue = []
    this.messages = []
    this.el.list.replaceChildren()
    this.el.empty.hidden = true
    this.pending = 0
    this.stick = true
    this.el.resume.hidden = true
    this.setReply(null)
    this.hideCard()
    this.hidePicker()
    this.hideSuggestions()
    // Chat du multi-live replié : une fiche restée ouverte, invisible,
    // retiendrait l'Échap de la mosaïque (multi.js).
    this.el.info.hidden = true
  }

  /** La session a changé (connexion, déconnexion) : on reconnecte le live. */
  sessionChanged() {
    if (this.mode === 'live' && this.channel) {
      this.openLive({ channel: this.channel, channelId: this.client?.o.channelId ?? null })
    }
  }

  // ── Évènements du client ───────────────────────────────────────────────
  onEvent(type, payload) {
    switch (type) {
      case 'status':
        this.setStatus(payload)
        // Rediffusion : rien ne s'affiche avant le premier message de la
        // vidéo. Sans indication, un panneau vide passe pour une panne.
        if (payload === 'connected' && this.mode === 'vod' && !this.el.list.childElementCount) {
          this.el.empty.textContent = t('chat_vod_empty')
          this.el.empty.hidden = false
        }
        if (payload === 'auth-failed') {
          this.enqueue(systemMessage(t('chat_rescope')))
          this.refreshComposer(true)
        }
        if (payload === 'connected') this.refreshComposer()
        break
      case 'add':
        this.el.empty.hidden = true
        if (!this.isFiltered(payload)) this.deliver(payload)
        break
      case 'batch':
        this.el.empty.hidden = true
        for (const m of payload) if (!this.isFiltered(m)) this.enqueue(m)
        break
      case 'prepend':
        this.prepend(payload
          .filter((m) => (this.o.prefs.keepDeleted || !m.isDeleted) && !this.isFiltered(m))
          // Chat vidé par un modérateur dans l'historique : la ligne qui le
          // dit, dans la langue du site.
          .map((m) => (m.notice === 'clear' ? { ...m, systemMsg: t('chat_cleared') } : m)))
        break
      case 'moderate':
        // Les messages encore en attente sont modérés aussi : sinon un
        // message supprimé apparaîtrait quelques secondes après sa suppression.
        for (const d of this.delayed) {
          if (payload.id ? d.msg.id === payload.id : d.msg.userName === payload.user) d.msg.isDeleted = true
        }
        if (!this.o.prefs.keepDeleted) this.delayed = this.delayed.filter((d) => !d.msg.isDeleted)
        this.moderate(payload)
        break
      case 'clear':
        this.clearList()
        break
      case 'modclear':
        // /clear d'un modérateur : une ligne le dit (le panneau se vidait sans
        // explication). Avec « garder les messages supprimés », rien ne
        // disparaît : tout est barré, messages retenus pour la synchro compris,
        // et la ligne vient après eux.
        if (this.o.prefs.keepDeleted) {
          for (const m of [...this.messages, ...this.queue, ...this.delayed.map((d) => d.msg)]) m.isDeleted = true
          for (const n of this.el.list.querySelectorAll('.msg:not(.sys)')) n.classList.add('deleted')
          this.deliver(systemMessage(t('chat_cleared')))
        } else {
          this.clearList()
          this.enqueue(systemMessage(t('chat_cleared')))
        }
        break
      case 'confirmed': {
        // Notre message accepté par Twitch : son vrai id remplace l'id local
        // (réponses, suppression par un modérateur).
        const m = this.messages.find((x) => x.id === payload.local) ?? this.queue.find((x) => x.id === payload.local)
        if (m) { m.id = payload.id; m.confirmed = true }
        for (const n of this.el.list.querySelectorAll(`.msg[data-id="${CSS.escape(payload.local)}"]`)) n.dataset.id = payload.id
        if (this.el.card.dataset.msg === payload.local) this.el.card.dataset.msg = payload.id
        break
      }
      case 'empty':
        this.el.empty.textContent = t('chat_vod_empty')
        this.el.empty.hidden = false
        break
      case 'modes':
        this.renderModes({ ...this.modes, ...payload })
        break
      case 'rejected': {
        // Message refusé par Twitch : retiré du chat, la raison à sa place.
        this.dropOwn(payload.id)
        const f = this.modes.followers
        this.enqueue(systemMessage(t(payload.key, { d: f > 0 ? durationLabel(f) : '', t: payload.text })))
        break
      }
      case 'readonly':
        // Twitch refuse le compte dans ce chat (banni) : le client continue
        // sans lui. Les messages partis juste avant n'ont pas été envoyés.
        for (const id of payload.ids ?? []) this.dropOwn(id)
        this.enqueue(systemMessage(t('chat_ban_switched')))
        this.setReply(null)
        this.hidePicker()
        this.hideSuggestions()
        this.refreshComposer()
        break
      case 'readonly-off':
        this.refreshComposer()
        break
      case 'timeout':
        this.enqueue(systemMessage(t('chat_timed_out', { d: secondsLabel(payload.seconds) })))
        break
      case 'emotes': {
        // Emotes de la chaîne arrivées après le message épinglé : redessiné
        // avec elles s'il en contient (ses emotes BTTV, FFZ ou 7TV restaient
        // en texte jusqu'au prochain épinglage).
        const pin = this.pin
        if (pin && !this.el.pinned.hidden && resolveWords(pin.tokens).some((tk, i) => tk !== pin.tokens[i])) this.renderPinned(pin, true)
        break
      }
    }
  }

  /** Liste vidée (saut dans une VOD, /clear d'un modérateur), messages en
   *  attente compris. Le compteur du bouton « nouveaux messages » aussi :
   *  il annonçait ensuite des messages effacés. */
  clearList() {
    this.delayed = []
    this.messages = []
    this.queue = []
    this.el.list.replaceChildren()
    this.stick = true
    this.pending = 0
    this.el.resume.hidden = true
  }

  /** Retire un message envoyé (affiché d'avance) que Twitch n'a pas pris. */
  dropOwn(id) {
    if (!id) return
    for (const n of this.el.list.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) n.remove()
    this.messages = this.messages.filter((m) => m.id !== id)
    // Pas encore affiché : retiré de la file aussi.
    this.queue = (this.queue ?? []).filter((m) => m.id !== id)
    this.delayed = this.delayed.filter((d) => d.msg.id !== id)
  }

  setStatus(state) {
    const s = this.el.status
    s.dataset.state = state
    s.textContent = state === 'connecting' ? t('chat_connecting')
      : state === 'disconnected' ? t('chat_disconnected') : ''
  }

  // ── Rendu des messages ─────────────────────────────────────────────────
  /**
   * Synchronisation avec l'image. Le chat arrive en temps réel, la vidéo avec
   * plusieurs secondes de retard : sans compensation, on lit la réaction
   * avant de voir ce qui la provoque. Chaque message est retenu le temps du
   * retard mesuré à son arrivée, puis affiché. Nos propres messages, eux,
   * s'affichent tout de suite.
   */
  deliver(msg) {
    const delay = this.mode === 'live' && !msg.isSelf ? (this.o.getDelay?.() ?? 0) : 0
    if (delay < 0.5) { this.enqueue(msg); return }
    this.delayed.push({ msg, at: Date.now() + delay * 1000 })
    if (!this.delayTimer) this.delayTimer = setInterval(() => this.releaseDelayed(), 100)
  }

  releaseDelayed() {
    const now = Date.now()
    let n = 0
    while (n < this.delayed.length && this.delayed[n].at <= now) n++
    if (n) for (const d of this.delayed.splice(0, n)) this.enqueue(d.msg)
    if (!this.delayed.length) { clearInterval(this.delayTimer); this.delayTimer = null }
  }

  /** Les chats très actifs envoient des dizaines de messages par seconde :
   *  on les regroupe par image pour ne recalculer la mise en page qu'une fois. */
  enqueue(msg) {
    this.queue.push(msg)
    if (!this.frame) this.frame = requestAnimationFrame(() => this.flush())
  }

  flush() {
    this.frame = 0
    if (!this.queue.length) return
    const batch = this.queue.splice(0)
    const frag = document.createDocumentFragment()
    for (const m of batch) frag.appendChild(this.renderMessage(m))
    this.messages.push(...batch)
    if (this.messages.length > MAX_NODES * 2) this.messages.splice(0, this.messages.length - MAX_NODES * 2)
    this.el.list.appendChild(frag)

    const extra = this.el.list.childElementCount - MAX_NODES
    // En pause, on ne retire rien : le texte qu'on est en train de lire ne
    // doit pas glisser sous les yeux.
    if (extra > 0 && this.stick) for (let i = 0; i < extra; i++) this.el.list.firstElementChild?.remove()
    // En pause aussi, une limite haute : un chat très actif laissé remonté
    // accumulait des nœuds sans fin.
    else if (extra > MAX_NODES * 4) for (let i = 0; i < extra - MAX_NODES * 4; i++) this.el.list.firstElementChild?.remove()

    if (this.stick) this.scrollToBottom()
    else {
      this.pending += batch.filter((m) => !m.systemMsg).length
      this.showResume()
    }
  }

  prepend(older) {
    // Le direct démarre pendant le chargement de l'historique : un message
    // déjà reçu (affiché, en file, ou retenu pour la synchro avec l'image)
    // n'est pas rejoué une seconde fois.
    const known = new Set([...this.messages, ...this.queue, ...this.delayed.map((d) => d.msg)].map((m) => m.id))
    const fresh = older.filter((m) => !known.has(m.id))
    if (!fresh.length) return
    const frag = document.createDocumentFragment()
    for (const m of fresh) frag.appendChild(this.renderMessage(m))
    const sep = document.createElement('div')
    sep.className = 'msg-sep'
    sep.textContent = t('chat_history')
    frag.appendChild(sep)
    this.el.list.prepend(frag)
    this.messages.unshift(...fresh)
    if (this.stick) this.scrollToBottom()
  }

  renderMessage(m) {
    const div = document.createElement('div')
    if (m.notice === 'raid') {
      // Raid entrant : carte avec un lien vers la chaîne qui arrive.
      div.className = 'msg sys notice-raid'
      div.innerHTML = `${icon('users', 15)}<span>${esc(m.systemMsg || t('raid_incoming', { u: m.raiderName, n: m.viewers }))}</span>`
        + (m.raider ? `<button class="btn ghost xs" type="button" data-open-channel="${esc(m.raider)}">${esc(t('see_channel'))}</button>` : '')
      return div
    }
    if (m.systemMsg) {
      div.className = 'msg sys' + (m.notice === 'sub' ? ' notice-sub' : '')
      div.textContent = m.systemMsg
      return div
    }

    const me = this.o.session().login
    const words = this.o.prefs.highlightWords ?? []
    const watched = !m.isSelf && words.length ? watchedWords(words) : null
    // Mentionné (avec ou sans @) ou mot-clé surveillé : surligné.
    const mentionsMe = !m.isSelf && (m.tokens.some((tk) => {
      const v = String(tk.value ?? '').toLowerCase().replace(/^@/, '').replace(/[.,!?:;]+$/, '')
      return me && (tk.kind === 'mention' || tk.kind === 'text') && v === me
    }) || Boolean(watched?.test(watchText(m.tokens))))
    // « msg-announce », pas « announce » : cette classe-là est celle de la
    // bannière d'annonce du site (mise en page en colonnes, bordure) — le
    // message en héritait et le pseudo s'écrasait sur plusieurs lignes.
    div.className = 'msg'
      + (m.announce ? ' msg-announce' : '')
      + (m.isHighlight ? ' hl' : '')
      + (m.isFirstMessage ? ' first' : '')
      + (mentionsMe ? ' me' : '')
      + (m.isHistorical && this.mode === 'live' ? ' old' : '')
      + (m.isDeleted ? ' deleted' : '')
    div.dataset.id = m.id
    div.dataset.user = m.userName
    if (m.announce) div.style.setProperty('--announce', m.announce)

    let html = ''
    if (m.replyTo) {
      html += `<div class="msg-reply">${icon('reply', 12)}<span>${esc(t('reply_to', { u: m.replyTo }))}${m.replyBody ? ` : ${esc(m.replyBody)}` : ''}</span></div>`
    }
    const time = this.mode === 'vod' && m.offset !== null ? formatClock(m.offset) : timeLabel(m.timestamp, this.o.prefs.timeFormat)
    html += `<span class="msg-time">${esc(time)}</span>`
    m.badgeList ??= parseBadgeTag(m.badgeTag)
    // Une image en échec garderait sa place, vide, et décalerait le pseudo.
    for (const b of m.badgeList) html += `<img class="badge" src="${esc(b.url)}" alt="" title="${esc(b.title || b.set)}" data-badge="${esc(b.id)}" onerror="this.remove()">`
    html += `<button class="msg-name" type="button" style="color:${esc(m.color)}">${esc(m.displayName)}</button>`
    html += m.isAction ? ' ' : '<span class="msg-colon">: </span>'
    html += `<span class="msg-body"${m.isAction ? ` style="color:${esc(m.color)}"` : ''}>${this.renderTokens(m.tokens, me)}</span>`
    div.innerHTML = html
    return div
  }

  renderTokens(tokens, me) {
    return tokens.map((tk) => {
      switch (tk.kind) {
        case 'emote':
          return `<img class="emote" src="${esc(tk.emote.url)}" alt="${esc(tk.emote.name)}" title="${esc(tk.emote.name)}" data-emote-src="${esc(tk.emote.source ?? '')}" data-emote-id="${esc(tk.emote.id ?? '')}"${tk.emote.personal ? ' data-personal="1"' : ''} loading="lazy" decoding="async" onerror="this.replaceWith(this.alt)">`
        case 'mention': {
          // « @pseudo, » : la ponctuation suit la mention sans en faire
          // partie — la fiche visait « pseudo, », et « soi » n'était pas reconnu.
          const who = tk.value.replace(/[.,!?:;]+$/, '')
          if (!who) return esc(`@${tk.value}`)
          const self = me && who.toLowerCase() === me ? ' self' : ''
          return `<span class="mention${self}" data-user="${esc(who.toLowerCase())}">@${esc(who)}</span>${esc(tk.value.slice(who.length))}`
        }
        case 'gif':
          // Clavier GIF de Twitch : l'image, sur sa propre ligne (son texte
          // si elle ne charge pas).
          return `<img class="chat-gif" src="${esc(tk.url)}" alt="${esc(tk.value)}" title="${esc(tk.value)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.replaceWith(this.alt)">`
        case 'link': {
          const href = /^https?:\/\//i.test(tk.value) ? tk.value : `https://${tk.value}`
          // Lien de clip : lu ici plutôt que sur Twitch.
          const clip = clipSlugFrom(tk.value)
          return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow"${clip ? ` data-clip-link="${esc(clip)}"` : ''}>${esc(tk.value)}</a>`
        }
        default:
          return esc(tk.value)
      }
    }).join(' ')
  }

  moderate({ id, user }) {
    // Les lignes de message seulement : `data-user` est aussi posé sur les
    // @mentions, qu'un ban ou une exclusion retirait des messages des autres.
    const nodes = id
      ? this.el.list.querySelectorAll(`.msg[data-id="${CSS.escape(id)}"]`)
      : this.el.list.querySelectorAll(`.msg[data-user="${CSS.escape(user)}"]`)
    for (const n of nodes) {
      if (this.o.prefs.keepDeleted) n.classList.add('deleted')
      else n.remove()
    }
    for (const m of this.messages) if (id ? m.id === id : m.userName === user) m.isDeleted = true
  }

  // ── Défilement ─────────────────────────────────────────────────────────
  onScroll() {
    const l = this.el.list
    const atBottom = l.scrollHeight - l.scrollTop - l.clientHeight < 40
    if (atBottom && !this.stick) {
      this.stick = true
      this.pending = 0
      this.el.resume.hidden = true
    } else if (!atBottom && this.stick && !this.autoScrolling) {
      this.stick = false
      this.showResume()
    }
  }

  scrollToBottom(force = false) {
    const l = this.el.list
    this.autoScrolling = true
    l.scrollTop = l.scrollHeight
    requestAnimationFrame(() => { this.autoScrolling = false })
    if (force) {
      this.stick = true
      this.pending = 0
      this.el.resume.hidden = true
    }
  }

  showResume() {
    const span = $('span', this.el.resume)
    span.textContent = this.pending > 0 ? t('chat_new', { n: this.pending > 99 ? '99+' : this.pending }) : t('chat_paused')
    this.el.resume.hidden = false
  }

  // ── Saisie ─────────────────────────────────────────────────────────────
  refreshComposer(rescope = false) {
    if (this.mode !== 'live') { this.el.composer.hidden = true; return }
    this.el.composer.hidden = false
    this.authFailed ||= rescope
    const s = this.o.session()
    // Banni de ce chat : lu sans le compte, ni champ ni « Connecte-toi ».
    const banned = Boolean(this.client?.readOnly)
    this.el.banned.hidden = !banned
    if (banned) {
      $('span', this.el.banned).textContent = t('chat_ban_banner')
      $('button', this.el.banned).textContent = t('chat_ban_retry')
      this.el.inputRow.hidden = true
      this.el.login.hidden = true
      return
    }
    // Le champ s'affiche dès que le jeton a les droits, sans attendre la
    // fin de la connexion : sinon « Connecte-toi pour écrire » clignotait
    // à chaque ouverture pour quelqu'un de déjà connecté.
    const writable = s.canChat && !this.authFailed
    this.el.inputRow.hidden = !writable
    this.el.login.hidden = writable
    if (writable) {
      const ready = Boolean(this.client?.canSend)
      this.el.input.placeholder = ready ? t('chat_send_ph') : t('chat_connecting')
      this.el.input.disabled = !ready
      this.el.send.disabled = !ready
    } else {
      this.el.login.textContent = (this.authFailed || s.needRescope) ? t('chat_rescope') : t('chat_readonly')
    }
  }

  submit() {
    const text = this.el.input.value.trim()
    if (!text || !this.client?.send) return
    // Règles du chat pas encore acceptées : elles d'abord.
    if (this.mode === 'live' && this.rules?.length && !rulesAccepted(this.channel, this.rules)) {
      this.showRules()
      return
    }
    if (this.client.send(text, this.replyTo?.id)) {
      this.el.input.value = ''
      this.setReply(null)
      this.hideSuggestions()
      this.scrollToBottom(true)
    }
  }

  onKey(e) {
    // Conversion en cours (japonais, chinois, coréen) : Entrée valide le
    // mot choisi, elle n'envoie rien.
    if (e.isComposing || e.keyCode === 229) return
    if (!this.el.suggest.hidden && this.suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = this.suggestions.length
        this.suggestIndex = (this.suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
        this.suggestPicked = true
        this.renderSuggestions()
        return
      }
      // Tab complète avec la suggestion en surbrillance (flèches pour en
      // changer), comme sur Twitch et 7TV. Entrée, elle, envoie — sauf
      // après un choix aux flèches, qu'elle prend (liste de choix, comme
      // partout) : « coucou @al », flèche vers @albert, puis Entrée envoyait
      // « coucou @al ». Sans choix, Entrée envoie toujours : les suggestions
      // s'ouvrent dès deux lettres, y compris au milieu d'un mot d'emote, et
      // Entrée remplaçait un mot ordinaire sans rien envoyer.
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && this.tabTakes()) {
        e.preventDefault()
        this.applySuggestion(this.suggestIndex)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && this.suggestPicked) {
        e.preventDefault()
        this.applySuggestion(this.suggestIndex)
        return
      }
      if (e.key === 'Escape') { this.hideSuggestions(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      this.submit()
    }
  }

  /** Mot en cours de frappe, juste avant le curseur. */
  currentWord() {
    const v = this.el.input.value
    const caret = this.el.input.selectionStart ?? v.length
    const start = v.lastIndexOf(' ', caret - 1) + 1
    return { word: v.slice(start, caret), start, end: caret }
  }

  updateSuggestions() {
    const { word } = this.currentWord()
    if (word.startsWith('@') && word.length >= 2) {
      const kw = word.slice(1).toLowerCase()
      const names = new Map()
      for (let i = this.messages.length - 1; i >= 0 && names.size < 40; i--) {
        const m = this.messages[i]
        if (m.userName && !names.has(m.userName)) names.set(m.userName, m)
      }
      for (const n of this.client?.present ?? []) if (!names.has(n)) names.set(n, null)
      this.suggestions = [...names.keys()]
        .filter((n) => n.startsWith(kw))
        .slice(0, 8)
        .map((n) => {
          const name = names.get(n)?.displayName || n
          const value = mentionName(n, name)
          // Nom localisé : c'est le pseudo qui s'écrit, il se voit aussi.
          return { kind: 'user', value: `@${value}`, label: value === name ? name : `${name} (${n})`, color: names.get(n)?.color }
        })
    } else if (word.length >= 2) {
      this.suggestions = suggestEmotes(word, 8).map((e) => ({ kind: 'emote', value: e.name, label: e.name, url: e.url }))
    } else {
      this.suggestions = []
    }
    this.suggestIndex = 0
    this.suggestPicked = false
    this.renderSuggestions()
  }

  /** Tab prend-il la suggestion en surbrillance ? Oui si elle a été choisie
   *  aux flèches, si c'est un pseudo (cherché par le début), ou une emote
   *  dont le nom commence par le mot tapé. Pas une emote trouvée au milieu
   *  de son nom (« c'est ok » + Tab donnait « c'est FeelsOkayMan », alors
   *  que Tab sert aussi à quitter le champ) : celle-là, au clic ou aux
   *  flèches. */
  tabTakes() {
    const s = this.suggestions[this.suggestIndex]
    if (!s) return false
    if (this.suggestPicked || s.kind !== 'emote') return true
    return s.value.toLowerCase().startsWith(this.currentWord().word.toLowerCase())
  }

  renderSuggestions() {
    if (!this.suggestions.length) return this.hideSuggestions()
    // « Tab » sur la suggestion en surbrillance (au clavier seulement) : la
    // touche qui la prend, puisque Entrée envoie — quand Tab la prend.
    const key = this.tabTakes() ? '<kbd class="suggest-key" aria-hidden="true">Tab</kbd>' : ''
    this.el.suggest.innerHTML = this.suggestions.map((s, i) => `
      <button type="button" class="suggest-item${i === this.suggestIndex ? ' active' : ''}" data-i="${i}" role="option">
        ${s.kind === 'emote' ? `<img src="${esc(s.url)}" alt="">` : `<span class="dot" style="background:${esc(s.color ?? '#bf94ff')}"></span>`}
        <span>${esc(s.label)}</span>${i === this.suggestIndex ? key : ''}
      </button>`).join('')
    this.el.suggest.hidden = false
  }

  hideSuggestions() {
    this.el.suggest.hidden = true
    this.suggestions = []
    this.suggestPicked = false
  }

  applySuggestion(i) {
    const s = this.suggestions[i]
    if (!s) return
    const { start, end } = this.currentWord()
    const v = this.el.input.value
    const next = `${v.slice(0, start)}${s.value} ${v.slice(end)}`
    this.el.input.value = next
    const caret = start + s.value.length + 1
    this.el.input.setSelectionRange(caret, caret)
    this.el.input.focus()
    this.hideSuggestions()
  }

  // ── Commandes des bots ─────────────────────────────────────────────────
  async toggleBotCommands() {
    const box = $('.bot-cmds', this.root)
    if (!box.hidden) { box.hidden = true; return }
    const channel = this.channel
    if (!channel) return
    box.hidden = false
    box.innerHTML = `<div class="bot-cmds-head">${icon('terminal', 16)}<b>${esc(t('bot_commands'))}</b>
        <button class="icon-btn xs" type="button" data-close>${icon('x', 16)}</button></div>
      <input class="bot-cmds-filter" type="search" autocomplete="off" placeholder="${esc(t('bot_commands_filter'))}">
      <div class="bot-cmds-list"><p class="muted small">${esc(t('loading'))}</p></div>`
    box.querySelector('[data-close]').onclick = () => { box.hidden = true }
    const { sets, failed } = await fetchBotCommands(channel)
    if (box.hidden || this.channel !== channel) return
    const list = box.querySelector('.bot-cmds-list')
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
    render()
    box.querySelector('.bot-cmds-filter').oninput = (e) => render(e.target.value)
    // Clavier : Entrée sur une commande comme un clic.
    list.onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('[data-cmd]')) e.target.click() }
    list.onclick = async (e) => {
      // Un lien dans la réponse s'ouvre, sans utiliser la commande.
      if (e.target.closest('a')) return
      const b = e.target.closest('[data-cmd]')
      if (!b) return
      // On peut écrire : la commande va dans le champ ; sinon (pas de compte,
      // lecture seule d'un banni, connexion en cours) elle est copiée.
      if (!this.el.composer.hidden && !this.el.inputRow.hidden && !this.el.input.disabled) {
        box.hidden = true
        this.insertText(b.dataset.cmd)
      } else {
        try { await navigator.clipboard.writeText(b.dataset.cmd); b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 900) } catch {}
      }
    }
  }

  insertText(text) {
    const input = this.el.input
    const v = input.value
    const caret = input.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const pad = before && !before.endsWith(' ') ? ' ' : ''
    input.value = `${before}${pad}${text} ${v.slice(caret)}`
    const pos = caret + pad.length + text.length + 1
    input.setSelectionRange(pos, pos)
    input.focus()
  }

  setReply(msg) {
    this.replyTo = msg
    this.el.replying.hidden = !msg
    if (msg) {
      $('span', this.el.replying).textContent = t('reply_to', { u: msg.displayName })
      this.el.input.focus()
    }
  }

  // ── Sélecteur d'emotes ─────────────────────────────────────────────────
  togglePicker() {
    if (this.el.picker.hidden) {
      this.el.picker.hidden = false
      this.el.emoteSearch.value = ''
      this.renderPicker()
    } else this.hidePicker()
  }

  hidePicker() { this.el.picker.hidden = true }

  renderPicker() {
    const kw = this.el.emoteSearch.value.trim().toLowerCase()
    const { channel, global } = emoteCatalog()
    const filter = (list) => (kw ? list.filter((e) => e.name.toLowerCase().includes(kw)) : list)
    const section = (title, list) => list.length ? `
      <div class="emote-section">${esc(title)}</div>
      <div class="emote-cells">${list.slice(0, 400).map((e) =>
        `<button type="button" data-emote="${esc(e.name)}" data-emote-src="${esc(e.source ?? '')}" data-emote-id="${esc(e.id ?? '')}" title="${esc(e.name)}"><img src="${esc(e.url)}" alt="${esc(e.name)}" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''
    this.el.grid.innerHTML = section(t('emotes_channel'), filter(channel)) + section(t('emotes_global'), filter(global))
  }

  // ── Fiche utilisateur ──────────────────────────────────────────────────
  onListClick(e) {
    // Emote ou badge : sa fiche (nom exact, source, copier).
    const img = e.target.closest('img.emote, img.badge')
    if (img) return this.showInfo(img)
    const clip = e.target.closest('[data-clip-link]')
    if (clip && this.o.onOpenClip) { e.preventDefault(); return this.o.onOpenClip(clip.dataset.clipLink) }
    const open = e.target.closest('[data-open-channel]')
    if (open) return this.o.onOpenChannel?.(open.dataset.openChannel)
    const mention = e.target.closest('.mention')
    if (mention) return this.showCard(mention.dataset.user, null)
    const row = e.target.closest('.msg:not(.sys)')
    if (!row || e.target.closest('a')) return
    const msg = this.messages.find((m) => m.id === row.dataset.id)
    this.showCard(row.dataset.user, msg)
  }

  /** Filtres du chat (réglages) : utilisateurs masqués, bots, commandes,
   *  mots masqués. Nos propres messages et ceux du système passent toujours. */
  isFiltered(m) {
    if (m.isSelf || (m.userId === 'system' && !m.userName)) return false
    const p = this.o.prefs
    const login = String(m.userName || '').toLowerCase()
    if (login && p.blockedUsers?.includes(login)) return true
    if (p.hideBots && KNOWN_BOTS.has(login)) return true
    const text = m.tokens.map((tk) => tk.value ?? tk.emote?.name ?? '').join(' ')
    if (p.hideCommands && text.trimStart().startsWith('!')) return true
    if (p.mutedWords?.length) {
      const low = text.toLowerCase()
      if (p.mutedWords.some((w) => low.includes(w))) return true
    }
    return false
  }

  /** Masquer / réafficher quelqu'un (fiche utilisateur). */
  toggleBlocked(login) {
    const p = this.o.prefs
    const list = new Set(p.blockedUsers ?? [])
    const hide = !list.has(login)
    if (hide) list.add(login); else list.delete(login)
    p.blockedUsers = [...list].slice(-500)
    this.o.onPrefsChange?.()
    if (hide) {
      for (const n of this.el.list.querySelectorAll('.msg[data-user]')) if (n.dataset.user === login) n.remove()
      // Ses messages déjà reçus mais pas encore affichés (retenus pour la
      // synchro avec l'image, ou en file) s'affichaient quand même.
      const theirs = (m) => m.userName === login
      this.delayed = this.delayed.filter((d) => !theirs(d.msg))
      this.queue = this.queue.filter((m) => !theirs(m))
      this.messages = this.messages.filter((m) => !theirs(m))
    }
    return hide
  }

  async showCard(login, msg) {
    if (!login) return
    const theirs = this.messages.filter((m) => m.userName === login).slice(-25)
    const ref = msg ?? theirs[theirs.length - 1]
    const name = ref?.displayName ?? login
    const color = ref?.color ?? '#bf94ff'
    const canReply = this.mode === 'live' && this.client?.canSend
    const card = this.el.card
    card.dataset.login = login
    card.dataset.msg = msg?.id ?? ''
    card.innerHTML = `
      <div class="user-card-head">
        <img class="avatar" alt="" hidden>
        <div class="user-card-id">
          <strong style="color:${esc(color)}">${esc(name)}</strong>
          <span class="muted">@${esc(login)}</span>
        </div>
        <button class="icon-btn sm" type="button" data-act="close">${icon('x', 18)}</button>
      </div>
      <div class="user-card-actions">
        ${canReply ? `<button class="btn sm" type="button" data-act="mention">@ ${esc(t('mention'))}</button>
        ${msg && (!msg.isSelf || msg.confirmed) ? `<button class="btn sm" type="button" data-act="reply">${icon('reply', 14)} ${esc(t('reply'))}</button>` : ''}` : ''}
        <button class="btn sm ghost" type="button" data-act="block">${icon(this.o.prefs.blockedUsers?.includes(login) ? 'eye' : 'eyeOff', 14)} ${esc(t(this.o.prefs.blockedUsers?.includes(login) ? 'unhide_user' : 'hide_user'))}</button>
      </div>
      <div class="user-card-label">${esc(t('user_messages'))}</div>
      <div class="user-card-msgs">${theirs.length
        ? theirs.map((m) => `<div class="uc-msg${m.isDeleted ? ' deleted' : ''}"><span class="msg-time">${esc(this.mode === 'vod' && m.offset !== null ? formatClock(m.offset) : timeLabel(m.timestamp, this.o.prefs.timeFormat))}</span> ${this.renderTokens(m.tokens, null)}</div>`).join('')
        : '<div class="muted">—</div>'}</div>`
    card.hidden = false
    const list = $('.user-card-msgs', card)
    list.scrollTop = list.scrollHeight

    // L'avatar n'est qu'un plus : chargé à part, sans retarder la fiche.
    try {
      const d = await gql('query($l: String!) { user(login: $l) { profileImageURL(width: 70) } }', { l: login })
      const url = d?.user?.profileImageURL
      const img = $('.avatar', card)
      if (url && card.dataset.login === login && img) { img.src = url; img.hidden = false }
    } catch {}
  }

  onCardClick(e) {
    // Emote d'un message de la fiche : sa fiche, par-dessus.
    const img = e.target.closest('img.emote, img.badge')
    if (img) return this.showInfo(img)
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    const card = this.el.card
    if (act === 'close') return this.hideCard()
    if (act === 'block') {
      const hidden = this.toggleBlocked(card.dataset.login)
      toast(t(hidden ? 'user_hidden' : 'user_unhidden', { u: card.dataset.login }))
      return this.hideCard()
    }
    if (act === 'mention') {
      const m = this.messages.find((x) => x.userName === card.dataset.login)
      this.insertText(`@${mentionName(card.dataset.login, m?.displayName)}`)
      this.hideCard()
    }
    if (act === 'reply') {
      const m = this.messages.find((x) => x.id === card.dataset.msg)
      if (m) this.setReply(m)
      this.hideCard()
    }
  }

  hideCard() { this.el.card.hidden = true }
}

export { plainText }
