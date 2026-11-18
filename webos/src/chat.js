// ═══════════════════════════════════════════════════════════════════════════
//  Chat du lecteur TV : le client IRC du direct (chat/live.js) et le rejeu
//  d'une VOD (chat/vod.js) du site, dessinés ici en lecture à 3 mètres.
//  - Direct synchronisé avec l'image (réglage du site « chatSync ») : chaque
//    message attend le retard de la vidéo sur le direct (Player.chatDelay).
//  - Peint par lots (toutes les 300 ms) : une grosse chaîne envoie des
//    dizaines de messages par seconde, trop pour un processeur de TV un
//    par un. 150 lignes au plus.
//  - Mêmes filtres que le site : bots connus, pseudos bloqués, mots masqués,
//    commandes, subs offerts, emotes masquées.
// ═══════════════════════════════════════════════════════════════════════════

import { LiveChat } from '../../public/assets/js/chat/live.js'
import { VodChat } from '../../public/assets/js/chat/vod.js'
import { parseBadgeTag } from '../../public/assets/js/chat/badges.js'
import { systemMessage } from '../../public/assets/js/chat/message.js'
import { lang, t } from '../../public/assets/js/i18n.js'
import { esc, formatClock } from '../../public/assets/js/util.js'
import { store } from '../../public/assets/js/store.js'
import { canChat, renew, user } from './auth.js'

const MAX_LINES = 150
const FLUSH_MS = 300
// Liste du site (chat/view.js, KNOWN_BOTS).
const KNOWN_BOTS = new Set(['nightbot', 'streamelements', 'moobot', 'fossabot', 'streamlabs', 'wizebot', 'soundalerts',
  'sery_bot', 'botisimo', 'own3d', 'kofistreambot', 'pokemoncommunitygame', 'deepbot', 'coebot', 'phantombot', 'creatisbot', 'blerp'])

export class TvChat {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {() => number} o.getDelay  retard de l'image sur le direct (s)
   */
  constructor(root, o) {
    this.root = root
    this.o = o
    this.client = null
    this.mode = null
    this.waiting = []      // direct : { at, msg }, affichés à `at`
    this.pending = []      // à peindre au prochain lot
    this.timer = null
    this.renewed = false
    root.innerHTML = `<div class="chat-head"><b class="chat-title"></b><span class="chat-status"></span></div>
      <div class="chat-list"></div><div class="chat-empty" hidden></div>`
    this.el = {
      title: root.querySelector('.chat-title'),
      status: root.querySelector('.chat-status'),
      list: root.querySelector('.chat-list'),
      empty: root.querySelector('.chat-empty'),
    }
  }

  openLive({ channel, channelId }) {
    this.close()
    this.mode = 'live'
    this.args = { channel, channelId }
    this.el.title.textContent = t('chat')
    this.start()
  }

  start() {
    const { channel, channelId } = this.args
    const withAccount = canChat()
    this.client = new LiveChat({
      channel,
      channelId,
      token: withAccount ? store.token : null,
      login: withAccount ? user.login : null,
      loadRecent: store.prefs.loadHistory !== false,
      onEvent: (type, payload) => this.onEvent(type, payload),
    })
    this.client.start()
    this.run()
  }

  openVod({ videoId, channelId, channelLogin, startAt }) {
    this.close()
    this.mode = 'vod'
    this.el.title.textContent = t('chat_vod')
    this.client = new VodChat({ videoId, channelId, channelLogin, onEvent: (type, payload) => this.onEvent(type, payload) })
    this.client.start(startAt || 0)
    this.run()
  }

  /** Temps de lecture (VOD) : le rejeu le suit. */
  tick(time) {
    if (this.mode === 'vod') this.client?.tick(time)
  }

  get canSend() {
    return this.mode === 'live' && Boolean(this.client?.canSend)
  }

  send(text) {
    return this.mode === 'live' && Boolean(this.client?.send(text))
  }

  close() {
    this.client?.stop()
    this.client = null
    this.mode = null
    this.waiting = []
    this.pending = []
    clearInterval(this.timer)
    this.timer = null
    this.renewed = false
    this.el.list.textContent = ''
    this.el.empty.hidden = true
    this.setStatus('')
  }

  run() {
    clearInterval(this.timer)
    this.timer = setInterval(() => this.flush(), FLUSH_MS)
  }

  setStatus(s) {
    const text = s === 'connecting' ? t('chat_connecting') : s === 'disconnected' ? t('chat_connecting') : ''
    this.el.status.textContent = text
  }

  filtered(m) {
    const p = store.prefs
    if (m.gift && p.hideGiftSubs) return true
    if (m.isSelf || (m.userId === 'system' && !m.userName)) return false
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

  /** Un message reçu : en direct synchronisé, il attend le retard de l'image. */
  receive(m) {
    if (this.filtered(m)) return
    const delay = this.mode === 'live' && store.prefs.chatSync !== false && !m.isSelf ? this.o.getDelay() : 0
    if (delay > 0.5) this.waiting.push({ at: Date.now() + delay * 1000, msg: m })
    else this.pending.push(m)
  }

  onEvent(type, payload) {
    switch (type) {
      case 'status':
        this.setStatus(payload)
        if (payload === 'auth-failed' && !this.renewed) {
          // Jeton expiré : renouvelé une fois, puis le chat repart avec lui.
          this.renewed = true
          renew().then((ok) => {
            if (!ok || this.mode !== 'live') return
            this.client?.stop()
            this.start()
          })
        }
        break
      case 'add':
        this.el.empty.hidden = true
        this.receive(payload)
        break
      case 'batch':
        this.el.empty.hidden = true
        for (const m of payload) if (!this.filtered(m)) this.pending.push(m)
        break
      case 'prepend': {
        // Historique du direct : avant tout le reste, sans attendre.
        const old = payload.filter((m) => !m.isDeleted && !this.filtered(m) && m.notice !== 'clear')
        this.pending.unshift(...old.slice(-60))
        break
      }
      case 'moderate': {
        const hit = (m) => (payload.id ? m.id === payload.id : m.userName === payload.user)
        this.waiting = this.waiting.filter((w) => !hit(w.msg))
        this.pending = this.pending.filter((m) => !hit(m))
        const sel = payload.id ? `.msg[data-id="${CSS.escape(payload.id)}"]` : `.msg[data-user="${CSS.escape(payload.user)}"]`
        for (const n of this.el.list.querySelectorAll(sel)) n.remove()
        break
      }
      case 'clear':
      case 'modclear':
        this.waiting = []
        this.pending = []
        this.el.list.textContent = ''
        if (type === 'modclear') this.pending.push(systemMessage(t('chat_cleared')))
        break
      case 'empty':
        if (!this.el.list.childElementCount) {
          this.el.empty.textContent = t('chat_vod_empty')
          this.el.empty.hidden = false
        }
        break
      case 'rejected':
        this.pending.push(systemMessage(t(payload.key, { d: '', t: payload.text })))
        break
      case 'readonly':
        this.pending.push(systemMessage(t('chat_ban_switched')))
        break
      case 'timeout':
        this.pending.push(systemMessage(t('chat_timed_out', { d: `${payload.seconds} s` })))
        break
    }
  }

  flush() {
    const now = Date.now()
    if (this.waiting.length) {
      let i = 0
      while (i < this.waiting.length && this.waiting[i].at <= now) i++
      // Le retard a diminué (retour au direct) : ce qui attend encore sort
      // dans l'ordre d'arrivée, pas avant les précédents.
      if (i) for (const w of this.waiting.splice(0, i)) this.pending.push(w.msg)
    }
    if (!this.pending.length) return
    const batch = this.pending.splice(0).slice(-MAX_LINES)
    const frag = document.createDocumentFragment()
    for (const m of batch) frag.appendChild(this.render(m))
    const list = this.el.list
    list.appendChild(frag)
    let extra = list.childElementCount - MAX_LINES
    while (extra-- > 0) list.firstElementChild.remove()
    list.scrollTop = list.scrollHeight
  }

  render(m) {
    const div = document.createElement('div')
    if (m.systemMsg != null || m.notice === 'raid') {
      div.className = 'msg sys'
      div.textContent = m.systemMsg || t('raid_incoming', { u: m.raiderName, n: m.viewers })
      return div
    }
    div.className = `msg${m.isHighlight ? ' hl' : ''}${m.isSelf ? ' self' : ''}`
    div.dataset.id = m.id
    div.dataset.user = m.userName
    const p = store.prefs
    let html = ''
    if (p.timestamps) {
      const time = this.mode === 'vod' && m.offset != null ? formatClock(m.offset)
        : new Date(m.timestamp).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' })
      html += `<span class="time">${esc(time)}</span>`
    }
    m.badgeList ??= parseBadgeTag(m.badgeTag)
    for (const b of m.badgeList.slice(0, 3)) html += `<img class="cbadge" src="${esc(b.url)}" alt="" onerror="this.remove()">`
    html += `<b class="nick" style="color:${esc(m.color)}">${esc(m.displayName)}</b>${m.isAction ? ' ' : '<span class="colon">: </span>'}`
    const hidden = new Set(p.hiddenEmotes ?? [])
    const body = m.tokens.map((tk) => {
      if (tk.kind === 'emote') {
        return hidden.has(tk.emote.name) ? esc(tk.emote.name)
          : `<img class="emote" src="${esc(tk.emote.url)}" alt="${esc(tk.emote.name)}" decoding="async" onerror="this.replaceWith(this.alt)">`
      }
      if (tk.kind === 'mention') return `<span class="mention">@${esc(tk.value)}</span>`
      return esc(tk.value)
    }).join(' ')
    html += `<span class="body"${m.isAction ? ` style="color:${esc(m.color)}"` : ''}>${body}</span>`
    div.innerHTML = html
    return div
  }
}
