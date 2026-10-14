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
  msg_timedout: 'chat_rej_timeout',
  msg_rejected: 'chat_rej_automod', msg_rejected_mandatory: 'chat_rej_automod',
  msg_ratelimit: 'chat_rej_ratelimit', msg_channel_suspended: 'chat_rej_suspended', msg_suspended: 'chat_rej_suspended',
}
const CAPS = 'twitch.tv/tags twitch.tv/commands twitch.tv/membership'

/** Couples « compte#chaîne » refusés par Twitch (banni) pendant la séance :
 *  le chat du multi-live, recréé à chaque changement de son, et une
 *  réouverture de la chaîne repartent directement en lecture seule. */
const READ_ONLY = new Set()
const readOnlyKey = (login, channel) => `${String(login).toLowerCase()}#${String(channel).toLowerCase()}`
/** Écart minimal entre deux reconnexions sur un signal de ban ambigu (ms). */
const REJOIN_GAP = 5000

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
    /** Compte banni de ce chat : on le lit sans le compte (justinfan). */
    this.readOnly = Boolean(o.token && o.login) && READ_ONLY.has(readOnlyKey(o.login, o.channel))
    this.lastRejoin = 0
    this.rejoinTimer = null
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
    // « Réessayer avec mon compte » cliqué pendant l'attente (le bandeau
    // s'affiche dès l'ouverture) : la connexion est déjà partie.
    if (!this.ws) this.connect(gen)
  }

  connect(gen = this.generation) {
    if (this.closed || gen !== this.generation) return
    // Une seule socket à la fois : une précédente encore ouverte, ignorée par
    // le garde-fou de trame, ne répondrait plus aux PING ; sa fermeture par
    // Twitch relancerait alors une connexion en double.
    const old = this.ws
    if (old && old.readyState <= WebSocket.OPEN) {
      old.onopen = old.onmessage = old.onclose = null
      try { old.close() } catch { /* déjà fermée */ }
    }
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
      if (token && login && !this.readOnly) {
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
      for (const line of String(ev.data).split('\r\n')) {
        // Bascule (reopen) au milieu de la trame : la fin appartient à la
        // socket fermée. Sans cet arrêt, un CLEARCHAT et un PART reçus
        // ensemble rouvriraient deux fois.
        if (this.ws !== ws) break
        if (line) this.handle(line)
      }
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

  /**
   * Rouvre la connexion dans la même génération : l'historique robotty en
   * cours n'est pas jeté, pas d'éclair « Chat déconnecté », et le recul
   * des tentatives n'est pas touché. L'ancienne socket est détachée avant
   * d'être fermée : rien de ce qu'elle reçoit encore n'est traité.
   */
  reopen() {
    const old = this.ws
    if (old) {
      old.onopen = old.onmessage = old.onclose = null
      try { old.close() } catch { /* déjà fermée */ }
    }
    this.ws = null
    this.connected = false
    this.canSend = false
    clearTimeout(this.retryTimer)
    clearTimeout(this.rejoinTimer)
    this.connect(this.generation)
  }

  /** Twitch refuse le compte dans ce salon (NOTICE msg_banned) : on continue
   *  sans lui, en lecture seule, comme un spectateur déconnecté. */
  enterReadOnly() {
    if (this.readOnly) return
    this.readOnly = true
    READ_ONLY.add(readOnlyKey(this.o.login, this.o.channel))
    this.canSend = false
    clearTimeout(this.rejoinTimer)
    // Message envoyé juste avant (affiché d'avance) : il n'est pas parti.
    const recent = this.lastSelf && Date.now() - this.lastSelf.at < 20_000 ? this.lastSelf.id : null
    this.lastSelf = null
    this.emit('readonly', { id: recent })
    this.reopen()
  }

  /** « Réessayer avec mon compte » : Twitch ne signale aucun déban sur l'IRC,
   *  c'est la réponse au JOIN qui tranche (msg_banned → lecture seule). */
  retryWithAccount() {
    if (!this.readOnly) return
    READ_ONLY.delete(readOnlyKey(this.o.login, this.o.channel))
    this.readOnly = false
    this.emit('readonly-off')
    this.reopen()
  }

  /** PART ou CLEARCHAT sans durée à notre nom : un ban probable, mais pas sûr
   *  (Shared Chat, PART d'une coupure). On se reconnecte avec le compte et la
   *  réponse de Twitch au JOIN décide. Un second signal trop proche du
   *  précédent est reporté, pas jeté : un vrai ban qui suit de près une
   *  reconnexion (Shared Chat) laisserait sinon le chat muet. */
  rejoin() {
    const wait = REJOIN_GAP - (Date.now() - this.lastRejoin)
    if (wait > 0) {
      clearTimeout(this.rejoinTimer)
      this.rejoinTimer = setTimeout(() => this.rejoin(), wait)
      return
    }
    this.lastRejoin = Date.now()
    this.reopen()
  }

  /** Ligne IRC qui vise le compte connecté (jamais en lecture seule : la
   *  connexion anonyme voit les exclusions de tout le monde). */
  isSelf(who) {
    const { token, login } = this.o
    return Boolean(token && login && !this.readOnly && who && who.toLowerCase() === login.toLowerCase())
  }

  stop() {
    this.closed = true
    this.generation += 1
    leaveBttvLive(this.o.channelId)
    clearInterval(this.pingTimer)
    clearTimeout(this.retryTimer)
    clearTimeout(this.rejoinTimer)
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
        // Pas avant : un compte banni reçoit GLOBALUSERSTATE, puis le refus
        // du JOIN, et le champ s'activait le temps de ce refus.
        this.emit('status', 'connected')
        this.applyModes(irc.tags)
        break
      case 'GLOBALUSERSTATE':
        this.myColor = irc.tags.color || null
        this.canSend = Boolean(this.o.token) && !this.readOnly
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
        // Compte banni de la chaîne : Twitch refuse le JOIN (ou un envoi).
        // Pas un simple refus de message : le chat entier serait muet.
        if (msgId === 'msg_banned' && this.o.token && this.o.login && !this.readOnly) {
          this.enterReadOnly()
          break
        }
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
        // Twitch nous sort du salon (ban en plein direct, ou coupure).
        if (this.isSelf(who)) { this.rejoin(); break }
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
        if (target && !target.startsWith('#')) {
          this.emit('moderate', { user: target.toLowerCase() })
          if (this.isSelf(target)) {
            // Exclusion temporaire : on reste dans le salon, une ligne le dit.
            // Sans durée, c'est un ban : la reconnexion le confirme.
            const duration = irc.tags['ban-duration']
            if (duration == null || duration === '') this.rejoin()
            else if (Number(duration) > 0) this.emit('timeout', { seconds: Number(duration) })
          }
        } else this.emit('clear')
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
