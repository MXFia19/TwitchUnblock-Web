// ═══════════════════════════════════════════════════════════════════════════
//  Chat d'une rediffusion, rejoué au rythme de la lecture.
//
//  Port de Sources/Chat/VodChatService.swift, avec une différence imposée :
//  la pagination par curseur (`comments(after:)`) est refusée par Twitch
//  (« failed integrity check »), en requête brute comme en requête
//  persistée. Seule la recherche par position passe. On avance donc par
//  positions : chaque page couvre un tronçon, la suivante repart du dernier
//  instant reçu, et les doublons du recouvrement sont écartés par identifiant.
// ═══════════════════════════════════════════════════════════════════════════

import { gqlRaw } from '../api.js'
import { fromVodComment } from './message.js'
import { loadChannelBadges, loadGlobalBadges } from './badges.js'
import { loadChannelEmotes, loadGlobalEmotes } from './emotes.js'

const QUERY = `query($id: ID!, $o: Int!) {
  video(id: $id) {
    comments(contentOffsetSeconds: $o) {
      edges { node {
        id contentOffsetSeconds createdAt
        commenter { login displayName }
        message { fragments { text emote { emoteID } } userColor userBadges { setID version } }
      } }
      pageInfo { hasNextPage }
    }
  }
}`

/** Avance d'avance : on charge la suite tant qu'il reste moins que ça. */
const LOOKAHEAD = 25
/** Au-delà de cet écart entre deux instants, c'est un saut, pas la lecture. */
const SEEK_THRESHOLD = 12
/** Après un saut, combien de messages antérieurs garder pour le contexte… */
const CONTEXT = 40
/** … cherchés au plus tant de secondes avant la position. */
const CONTEXT_SECONDS = 30
/** Attente maximale des badges et des emotes avant le premier chargement
 *  (ms), comme le chat du direct. */
const START_WAIT = 3500

export class VodChat {
  /**
   * @param {object} o
   * @param {string} o.videoId
   * @param {string|null} o.channelId
   * @param {string|null} o.channelLogin
   * @param {(type: string, payload?: any) => void} o.onEvent
   */
  constructor(o) {
    this.o = o
    this.buffer = []          // commentaires reçus, triés par position
    this.known = new Set()    // identifiants déjà reçus
    this.shownUntil = -1      // position du dernier message affiché
    this.cursor = 0           // index du prochain message à afficher
    this.fetchedUntil = -1
    this.hasMore = true
    this.fetching = false
    this.lastT = null
    this.generation = 0
    this.closed = false
    /** Après un saut : on remonte le fil avant d'afficher (voir fetch). */
    this.catchUp = null
    /** Délai avant de retenter une page en échec (recul progressif). */
    this.retryDelay = 0
  }

  async start(startAt = 0) {
    const gen = ++this.generation
    // En reprise, la vidéo signale souvent 0 s avant de sauter à la position
    // enregistrée : sans ce garde-fou, le chat repartait du début puis
    // rechargeait aussitôt — deux requêtes et un clignotement.
    this.awaitingStart = startAt > 1
    // Badges et emotes d'abord, mais pas plus de START_WAIT : une source
    // lente (réseau filtré, VPN) laissait le chat vide jusqu'à son délai, ou
    // sans fin pour les badges (GQL sans délai). Ce qui arrive ensuite sert
    // aux pages suivantes.
    let waited
    await Promise.race([
      Promise.all([
        loadGlobalBadges(),
        loadChannelBadges(this.o.channelLogin),
        loadGlobalEmotes(),
        loadChannelEmotes(this.o.channelId, this.o.channelLogin),
      ]),
      new Promise((resolve) => { waited = setTimeout(resolve, START_WAIT) }),
    ])
    clearTimeout(waited)
    if (gen !== this.generation || this.closed) return
    this.ready = true
    this.emit('status', 'connected')
    // La lecture a pu avancer pendant le chargement des emotes.
    this.reset(this.lastT ?? startAt)
  }

  stop() {
    this.closed = true
    this.generation += 1
  }

  /** Appelé à chaque mise à jour du temps de lecture. */
  tick(t) {
    if (this.closed || !Number.isFinite(t)) return
    if (this.awaitingStart) {
      if (t < 1) return
      this.awaitingStart = false
    }
    // Emotes et badges pas encore là : on retient juste la position.
    if (!this.ready) { this.lastT = t; return }
    if (this.lastT !== null && (t < this.lastT - 2 || t - this.lastT > SEEK_THRESHOLD)) {
      this.reset(t)
      return
    }
    this.lastT = t
    // Après un saut, rien ne s'affiche avant d'avoir de quoi remonter le fil.
    if (!this.catchUp) this.flush(t)
    if (this.hasMore && !this.fetching && t + LOOKAHEAD > this.fetchedUntil) {
      // Rien encore reçu depuis le dernier saut (première page en échec) :
      // on repart de la position de lecture, pas du début de la vidéo.
      this.fetch(Math.floor(this.fetchedUntil < 0 ? t : this.fetchedUntil))
    }
  }

  /** Saut dans la vidéo : on repart d'une liste vide à cet endroit. */
  reset(t) {
    this.generation += 1
    this.buffer = []
    this.known.clear()
    this.cursor = 0
    this.shownUntil = -1
    this.fetchedUntil = -1
    this.hasMore = true
    this.fetching = false
    this.lastT = t
    // Les messages juste avant la position donnent le fil de la
    // conversation : rien ne s'affiche avant d'en avoir (voir fetch).
    this.catchUp = { back: false }
    this.emit('clear')
    this.fetch(Math.max(0, Math.floor(t)))
  }

  /** `back` : page d'avant la position, pour le contexte après un saut —
   *  elle n'avance pas la lecture des pages suivantes. */
  async fetch(offset, back = false) {
    const gen = this.generation
    this.fetching = true
    let comments
    try {
      const res = await gqlRaw(QUERY, { id: this.o.videoId, o: offset })
      // Vidéo inconnue de Twitch (supprimée), sans erreur signalée : pas de
      // chat. Mais une erreur de Twitch (réponse 200 avec `errors`, champs
      // nuls) n'est pas la fin du chat : elle passait pour une page vide, et
      // le chat s'arrêtait pour de bon (« aucun message » après un saut).
      const video = res?.data?.video
      comments = video === null && !res?.errors?.length ? { edges: [] } : video?.comments
      if (!Array.isArray(comments?.edges)) throw new Error('Commentaires absents')
    } catch {
      if (gen !== this.generation || this.closed) return
      // Page de contexte en échec : on affiche ce qu'on a, sans elle.
      if (back) { this.fetching = false; this.endCatchUp(); return }
      // Réseau ou erreur de Twitch : rien ne bouge, un prochain tick
      // retentera la même position — 3 s, puis de plus en plus espacé.
      this.retryDelay = Math.min(Math.max(this.retryDelay * 2, 3000), 60_000)
      setTimeout(() => { if (gen === this.generation) this.fetching = false }, this.retryDelay)
      return
    }
    if (gen !== this.generation || this.closed) return
    this.fetching = false
    this.retryDelay = 0

    let added = 0
    let maxOffset = this.fetchedUntil
    let pageStart = Infinity
    for (const e of comments.edges) {
      const node = e?.node
      if (!node?.id) continue
      pageStart = Math.min(pageStart, Number(node.contentOffsetSeconds) || 0)
      if (this.known.has(node.id)) continue
      this.known.add(node.id)
      const msg = fromVodComment(node)
      maxOffset = Math.max(maxOffset, msg.offset)
      this.buffer.push(msg)
      added++
    }
    if (added) this.buffer.sort((a, b) => a.offset - b.offset)

    if (!back) {
      // Une page sans rien de neuf ferait reboucler sur la même position :
      // on avance d'une seconde. Pas plus : Twitch renvoie une fenêtre de
      // messages autour de la position demandée, et un saut de 5 s en
      // perdait dans un chat dense.
      this.fetchedUntil = added ? maxOffset : Math.max(this.fetchedUntil, offset) + 1
      this.hasMore = Boolean(comments.pageInfo?.hasNextPage) || added > 0
    }

    if (this.catchUp) {
      const t = this.lastT ?? 0
      // Après un saut, la page de la position déborde un peu avant elle (de
      // 1 s dans un chat dense à quelques minutes dans un chat calme). Moins
      // de CONTEXT messages d'avant, et elle commence moins de
      // CONTEXT_SECONDS avant : la page juste avant la sienne s'y ajoute,
      // demandée tout de suite (en pause, aucun tick ne le ferait).
      const before = this.buffer.filter((m) => m.offset <= t).length
      if (!this.catchUp.back && before < CONTEXT && Number.isFinite(pageStart) && pageStart > 0
        && pageStart > Math.floor(t) - CONTEXT_SECONDS) {
        this.catchUp.back = true
        this.fetch(pageStart - 1, true)
        return
      }
      this.endCatchUp()
      return
    }
    this.flush(this.lastT ?? 0)
  }

  /** Fin de la remontée après un saut : on garde les CONTEXT derniers
   *  messages d'avant la position, puis l'affichage reprend. */
  endCatchUp() {
    const t = this.lastT ?? 0
    this.catchUp = null
    this.cursor = Math.max(0, this.buffer.filter((m) => m.offset <= t).length - CONTEXT)
    if (!this.buffer.length) this.emit('empty')
    this.flush(t)
  }

  flush(t) {
    const batch = []
    while (this.cursor < this.buffer.length && this.buffer[this.cursor].offset <= t) {
      batch.push(this.buffer[this.cursor])
      this.cursor++
    }
    if (batch.length) this.emit('batch', batch)
    // Les commentaires déjà affichés ne servent plus : sur une longue VOD,
    // le tampon gardait toute la discussion en mémoire.
    if (this.cursor > 1000) {
      this.buffer.splice(0, this.cursor - 200)
      this.cursor = 200
    }
    // Mémoire des ids : rebâtie sur le tampon plutôt que vidée — la page
    // suivante recouvre la précédente, dont les messages revenaient en double.
    if (this.known.size > 20000) this.known = new Set(this.buffer.map((m) => m.id))
  }

  emit(type, payload) {
    this.o.onEvent(type, payload)
  }
}
