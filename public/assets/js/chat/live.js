// ═══════════════════════════════════════════════════════════════════════════
//  Chat d'un live, en direct sur l'IRC de Twitch.
//
//  Port de Sources/Chat/ChatService.swift. Le navigateur parle WebSocket
//  nativement : contrairement à la vidéo, le chat n'a besoin d'aucun proxy.
//
//  Le client ne dessine rien : il émet des évènements que la vue applique
//  (`add`, `prepend`, `moderate`, `clear`, `status`).
// ═══════════════════════════════════════════════════════════════════════════

import { parseIRC, prefixNick, ircText, unescapeTag } from './irc.js'
import { fromIRC, noticeMessages, systemMessage, selfMessage } from './message.js'
import { loadChannelBadges, loadGlobalBadges } from './badges.js'
import { joinBttvLive, leaveBttvLive, loadChannelEmotes, loadGlobalEmotes } from './emotes.js'

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'
/** Attente maximale des badges et des emotes avant de se connecter (ms). */
const START_WAIT = 3500

/** Refus de Twitch (msg-id d'un NOTICE) → raison traduite. */
const REJECTIONS = {
  msg_followersonly: 'chat_rej_followers', msg_followersonly_zero: 'chat_rej_followers',
  msg_followersonly_followed: 'chat_rej_followers_time',
  msg_subsonly: 'chat_rej_subs', msg_emoteonly: 'chat_rej_emotes', msg_slowmode: 'chat_rej_slow',
  msg_r9k: 'chat_rej_unique', msg_duplicate: 'chat_rej_duplicate',
  msg_verified_email: 'chat_rej_verified', msg_requires_verified_phone_number: 'chat_rej_verified',
  msg_timedout: 'chat_rej_timeout', msg_banned: 'chat_rej_banned',
  msg_rejected: 'chat_rej_automod', msg_rejected_mandatory: 'chat_rej_automod',
  msg_ratelimit: 'chat_rej_ratelimit', msg_channel_suspended: 'chat_rej_suspended', msg_suspended: 'chat_rej_suspended',
}
const CAPS = 'twitch.tv/tags twitch.tv/commands twitch.tv/membership'

export class LiveChat {
  /**
   * @param {object} o
   * @param {string} o.channel      login de la chaîne
   * @param {string|null} o.channelId
   * @param {string|null} o.token   jeton OAuth, s'il porte `chat:edit`
   * @param {string|null} o.login   pseudo du compte connecté
   * @param {boolean} o.loadRecent
   * @param {(type: string, payload?: any) => void} o.onEvent
   */
  constructor(o) {
    this.o = o
    this.ws = null
    this.pingTimer = null
    this.retryTimer = null
    this.retryDelay = 2000
    /** Incrémenté à chaque connexion : une réponse tardive d'un canal quitté
     *  ne doit pas atterrir dans le suivant. */
    this.generation = 0
    this.closed = false
    this.connected = false
    this.canSend = false
    this.present = new Set()
    this.myColor = null
    /** Modes du salon (ROOMSTATE) : followers, abonnés, emotes, lent, uniques. */
    this.modes = {}
    /** Dernier message envoyé, affiché d'avance : retiré si Twitch le refuse. */
    this.lastSelf = null
  }

  async start() {
    this.closed = false
    const gen = ++this.generation
    // Badges et emotes d'abord : un message arrivé avant eux s'afficherait
    // nu. Les requêtes sont d'ordinaire rapides et faites une fois par
    // chaîne ; mais une source lente (réseau filtré, VPN) laissait le chat
    // sur « Connexion au chat… » sans fin : au plus START_WAIT d'attente,
    // ce qui arrive ensuite sert aux messages suivants.
    let waited
    await Promise.race([
      Promise.all([
        loadGlobalBadges(),
        loadChannelBadges(this.o.channel),
        loadGlobalEmotes(),
        loadChannelEmotes(this.o.channelId, this.o.channel),
      ]),
      new Promise((resolve) => { waited = setTimeout(resolve, START_WAIT) }),
    ])
    clearTimeout(waited)
    if (gen !== this.generation) return
    // BTTV en direct : emotes personnelles (Pro), emotes ajoutées en live.
    joinBttvLive(this.o.channelId)
    if (this.o.loadRecent) this.loadRecent(gen)
    this.connect(gen)
  }

  connect(gen = this.generation) {
    if (this.closed || gen !== this.generation) return
    this.emit('status', 'connecting')
    let ws
    try {
      ws = new WebSocket(IRC_URL)
    } catch {
      this.scheduleRetry(gen)
      return
    }
    this.ws = ws

    ws.onopen = () => {
      if (gen !== this.generation) return ws.close()
      ws.send(`CAP REQ :${CAPS}`)
      const { token, login } = this.o
      if (token && login) {
        ws.send(`PASS oauth:${token}`)
        ws.send(`NICK ${login.toLowerCase()}`)
      } else {
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`)
      }
      ws.send(`JOIN #${this.o.channel}`)
    }

    ws.onmessage = (ev) => {
      if (gen !== this.generation) return
      // Twitch agrège plusieurs commandes dans une même trame.
      ws.lastSeen = Date.now()
      for (const line of String(ev.data).split('\r\n')) if (line) this.handle(line)
    }

    ws.onclose = () => {
      if (gen !== this.generation) return
      this.connected = false
      this.canSend = false
      this.emit('status', 'disconnected')
      this.scheduleRetry(gen)
    }

    clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      // Connexion à moitié morte : rien reçu depuis le dernier PING (Twitch
      // répond PONG) → on ferme, onclose relance la connexion.
      if (ws.pinged && (ws.lastSeen ?? 0) < ws.pinged) return ws.close()
      ws.pinged = Date.now()
      ws.send('PING :tmi.twitch.tv')
    }, 120_000)
  }

  scheduleRetry(gen) {
    if (this.closed) return
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.connect(gen), this.retryDelay)
    // Recul progressif, plafonné : inutile de marteler un serveur absent.
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000)
  }

  stop() {
    this.closed = true
    this.generation += 1
    leaveBttvLive(this.o.channelId)
    clearInterval(this.pingTimer)
    clearTimeout(this.retryTimer)
    this.ws?.close()
    this.ws = null
    this.connected = false
    this.canSend = false
    this.present.clear()
  }

  send(text, replyParentId) {
    const body = String(text).trim()
    if (!body || !this.canSend || this.ws?.readyState !== WebSocket.OPEN) return false
    // Identifiant venu des balises IRC : vérifié, un retour à la ligne y
    // ajouterait une commande IRC.
    if (replyParentId && !/^[0-9a-f-]{36}$/i.test(replyParentId)) replyParentId = null
    const prefix = replyParentId ? `@reply-parent-msg-id=${replyParentId} ` : ''
    this.ws.send(`${prefix}PRIVMSG #${this.o.channel} :${body}`)
    const msg = selfMessage(body, this.o.login ?? '', this.myColor)
    this.lastSelf = { id: msg.id, at: Date.now() }
    this.emit('add', msg)
    return true
  }

  /** ROOMSTATE (complet à l'arrivée, puis ce qui change) → modes du salon. */
  applyModes(tags) {
    const m = this.modes
    if (tags['followers-only'] != null) { const n = Number(tags['followers-only']); m.followers = n < 0 ? null : n }
    if (tags['subs-only'] != null) m.subs = tags['subs-only'] === '1'
    if (tags['emote-only'] != null) m.emotes = tags['emote-only'] === '1'
    if (tags.slow != null) m.slow = Number(tags.slow) || 0
    if (tags.r9k != null) m.unique = tags.r9k === '1'
    this.emit('modes', { ...m })
  }

  handle(line) {
    const irc = parseIRC(line)
    if (!irc) return

    switch (irc.command) {
      case '001':
        this.connected = true
        this.retryDelay = 2000
        break
      case 'ROOMSTATE':
        // Arrive juste après le JOIN : c'est le vrai signal « on est dedans ».
        this.emit('status', 'connected')
        this.applyModes(irc.tags)
        break
      case 'GLOBALUSERSTATE':
        this.myColor = irc.tags.color || null
        this.canSend = Boolean(this.o.token)
        this.emit('status', 'connected')
        break
      case 'PING':
        this.ws?.send('PONG :tmi.twitch.tv')
        break
      case 'RECONNECT':
        // Twitch prévient avant une maintenance : on rouvre tout de suite.
        this.ws?.close()
        break
      case 'PRIVMSG': {
        const msg = fromIRC(irc, false)
        if (msg) this.emit('add', msg)
        break
      }
      case 'USERNOTICE': {
        // Abonnements, raids, annonces : le texte système, puis le message
        // éventuel de l'utilisateur.
        for (const m of noticeMessages(irc, false)) this.emit('add', m)
        break
      }
      case 'NOTICE': {
        const text = ircText(irc)
        if (/authentication failed|improperly formatted auth/i.test(text ?? '')) {
          // Jeton refusé (expiré, ou sans `chat:read`) : on retombe en lecture
          // anonyme plutôt que de laisser un chat muet.
          this.o.token = null
          this.o.login = null
          this.canSend = false
          this.emit('status', 'auth-failed')
          this.ws?.close()
          return
        }
        // Message refusé (mode followers, abonnés, lent…) : il sort du chat,
        // où il était affiché d'avance comme envoyé, et la raison s'affiche
        // dans la langue du site.
        const msgId = irc.tags['msg-id'] || ''
        const key = REJECTIONS[msgId] || (msgId.startsWith('msg_') ? 'chat_rej_generic' : null)
        if (key) {
          const recent = this.lastSelf && Date.now() - this.lastSelf.at < 20_000 ? this.lastSelf.id : null
          this.lastSelf = null
          this.emit('rejected', { key, text: text ?? '', id: recent })
          break
        }
        if (text) this.emit('add', systemMessage(text))
        break
      }
      case '353': {
        // RPL_NAMREPLY : la liste est le dernier paramètre — pas params[1],
        // qui vaut « = ».
        const names = irc.params.length >= 4 ? irc.params[irc.params.length - 1] : null
        if (names) for (const n of names.split(' ')) if (n) this.present.add(n.toLowerCase())
        break
      }
      case 'JOIN': {
        const who = irc.tags.login ?? prefixNick(irc)
        if (who) this.present.add(who)
        break
      }
      case 'PART': {
        const who = irc.tags.login ?? prefixNick(irc)
        if (who) this.present.delete(who)
        break
      }
      case 'CLEARMSG': {
        const target = irc.tags['target-msg-id']
        if (target) this.emit('moderate', { id: target })
        break
      }
      case 'CLEARCHAT': {
        const target = irc.params[irc.params.length - 1]
        if (target && !target.startsWith('#')) this.emit('moderate', { user: target.toLowerCase() })
        else this.emit('clear')
        break
      }
    }
  }

  /**
   * Twitch n'envoie rien d'antérieur au JOIN : on arriverait dans un chat vide
   * en plein débat. recent-messages.robotty.de rejoue les dernières lignes IRC
   * brutes, qu'on fait passer par le même analyseur que le direct.
   */
  async loadRecent(gen) {
    try {
      const res = await fetch(`https://recent-messages.robotty.de/api/v2/recent-messages/${this.o.channel}?limit=80`)
      if (!res.ok) return
      const json = await res.json()
      if (gen !== this.generation || !Array.isArray(json?.messages)) return
      const older = []
      for (const line of json.messages) {
        const irc = typeof line === 'string' ? parseIRC(line) : null
        if (!irc) continue
        if (irc.command === 'PRIVMSG') {
          const msg = fromIRC(irc, true)
          // Supprimé depuis par la modération : signalé par le service.
          if (msg) older.push(irc.tags['rm-deleted'] === '1' ? { ...msg, isDeleted: true } : msg)
        } else if (irc.command === 'USERNOTICE') {
          older.push(...noticeMessages(irc, true))
        } else if (irc.command === 'CLEARCHAT') {
          // Banni ou exclu : ses messages déjà rejoués sont retirés aussi.
          const target = irc.params[irc.params.length - 1]?.toLowerCase()
          if (target && !target.startsWith('#')) for (const m of older) if (m.userName === target) m.isDeleted = true
        } else if (irc.command === 'CLEARMSG') {
          const id = irc.tags['target-msg-id']
          for (const m of older) if (m.id === id) m.isDeleted = true
        }
      }
      if (older.length) this.emit('prepend', older)
    } catch { /* service tiers : le chat démarre simplement vide */ }
  }

  emit(type, payload) {
    this.o.onEvent(type, payload)
  }
}
