// ═══════════════════════════════════════════════════════════════════════════
//  TwitchUnblock Connect dans le chat du lecteur principal, pendant un
//  direct : minutes regardées (points de chaîne et coffres), solde et série
//  de visionnage, récompenses de la chaîne (en touchant le solde), mises
//  sur les prédictions (carte existante de view.js, complétée), votes aux
//  sondages Twitch, bonus de raid (bandeau existant du raid) et drops
//  (carte existante : progression, réclamation, et la « pulsation » qui les
//  fait avancer). Tout passe par l'extension (connect.js). Sans elle, ou
//  connexion coupée dans l'extension, rien de plus dans le lecteur ; sans
//  session Twitch, une ligne dit de se connecter à twitch.tv. Le chat du
//  multi-live et les VODs ne s'en servent pas (seul le chat principal reçoit
//  `connect`, et openLive est réservé aux directs). Extension 0.3.0 : les
//  événements du compte (main.js, accountEvent) mettent solde, coffre, gains
//  et drops à jour en direct, et les relectures s'espacent.
// ═══════════════════════════════════════════════════════════════════════════
import { MAX_BET, MAX_REWARD_INPUT, canAccount } from '../connect.js'
import { lang, t } from '../i18n.js'
import { $, esc, formatClock, icon, toast } from '../util.js'

const TICK = 5000               // une boucle : ce qui est « dû » part
const BEAT_EVERY = 60_000       // watch.beat, pendant la lecture seulement
const PULSE_EVERY = 10_000      // drops.pulse, pendant la lecture d'une chaîne à drops
const DROPS_EVERY = 60_000      // drops.get : campagnes et progression
const POINTS_EVERY = 60_000     // points.get : solde, coffre disponible
const EVENTS_READ_EVERY = 5 * 60_000 // … les deux, avec les événements du compte en direct
const GAIN_SAME = 10_000        // le même gain dit deux fois (réponse, puis événement) : une fois
const READ_VISIBLE = 15_000     // prédictions et sondages, onglet visible
const READ_HIDDEN = 60_000      // … onglet caché
const STATUS_EVERY = 5 * 60_000 // session et réglages de l'extension
const STATUS_ON_RETURN = 30_000 // relue au retour sur l'onglet, pas plus souvent
const POLL_END_SHOWN = 60_000   // résultat d'un sondage fini, puis la carte part
const GAIN_SHOWN = 2500         // « +50 » à la place du solde
const NOTE_SHOWN = 4000         // « Mise enregistrée », « A voté »
const QUICK = [10, 100, 1000]
const TWITCH_LOGIN = 'https://www.twitch.tv/login'
const ERR_KEYS = ['disabled', 'no_session', 'needs_activation', 'spend_disabled', 'rate_limited', 'integrity', 'offline', 'no_claim', 'timeout', 'account_mismatch']

/** « Connecte-toi à twitch.tv » fermé : plus montré jusqu'au rechargement. */
let loginNoteClosed = false

/** Drops déjà annoncés (nom, ou id faute de nom) : la pulsation, « Réclamer »
 *  et les événements du compte peuvent dire le même. Une fois par minute ;
 *  faux si déjà dit. */
const dropsSaid = new Map()
export function freshDrop(key) {
  const now = Date.now()
  for (const [k, at] of dropsSaid) if (now - at > 60_000) dropsSaid.delete(k)
  if (!key || dropsSaid.has(key)) return false
  dropsSaid.set(key, now)
  return true
}

const fmt = (n) => Number(n).toLocaleString(lang())
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : fmt(n))
/** « 1 000 », « 1.000 », « 1,000 » → 1000 ; autre chose → NaN. */
const parseAmount = (s) => {
  const v = String(s ?? '').replace(/[\s  .,']/g, '')
  return /^\d{1,9}$/.test(v) ? Number(v) : NaN
}

/** Deuxième clic (ou plus) d'un double-clic : `detail` compte les clics
 *  rapprochés, quel que soit l'élément visé ; 0 au clavier. Une dépense ne
 *  part pas sur lui. */
export const isRepeatClick = (e) => (e?.detail ?? 0) > 1

/** Espace ou Entrée sur un bouton d'une carte : le clic, pas la lecture /
 *  pause du lecteur (ses raccourcis écoutent tout le document). */
function keepKeys(e) {
  if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button')) e.stopPropagation()
}

/** Erreur d'une demande → phrase pour l'utilisateur. Pour `twitch`, le
 *  code de Twitch est lu au mieux (il n'est pas documenté) ; `ctx` :
 *  « reward » pour l'échange d'une récompense, dont les refus sont à part.
 *  `spend` : pari, vote ou échange — un délai dépassé ne dit pas que rien
 *  n'est parti (l'extension envoie jusqu'à 30 s après la demande), donc
 *  pas de « recommence » qui pourrait payer deux fois. */
export function errorText(e, ctx = '', spend = false) {
  const code = e?.code || 'internal'
  if (spend && code === 'timeout') return t('connect_err_maybe')
  if (code === 'bad_args') {
    // Refus de l'extension après relecture chez Twitch (background.js) : le
    // détail dit lequel — prédiction fermée, points qui manquent, récompense
    // en recharge… — au lieu d'un « Échec (bad_args) ».
    const d = String(e.detail || '')
    if (d === 'points') return t('connect_err_points')
    if (ctx === 'reward') {
      if (['cost', 'title', 'rewardId'].includes(d)) return t('reward_err_changed')
      if (['paused', 'out_of_stock', 'cooldown', 'not_enabled', 'points_disabled'].includes(d)) return t('reward_err_unavailable')
      if (d === 'input') return t('reward_input_needed')
    }
    if (['not_active', 'eventId', 'pollId'].includes(d)) return t('connect_err_closed')
    if (d === 'other_outcome') return t('pred_one_outcome')
  }
  if (code === 'twitch') {
    const c = String(e.detail || '').toUpperCase()
    if (/NOT_ENOUGH|INSUFFICIENT/.test(c)) return t('connect_err_points')
    if (ctx === 'reward') {
      if (/MISMATCH/.test(c)) return t('reward_err_changed')
      if (/NOT_LIVE|OFFLINE/.test(c)) return t('connect_err_offline')
      if (/COOLDOWN|STOCK|MAX|LIMIT|DISABLED|PAUSED|NOT_FOUND|ALREADY/.test(c)) return t('reward_err_unavailable')
    }
    if (/MULTI|OTHER_OUTCOME|DIFFERENT_OUTCOME/.test(c)) return t('pred_one_outcome')
    if (/MAX|PER_EVENT/.test(c)) return t('connect_err_max')
    if (/NOT_ACTIVE|INACTIVE|LOCKED|CLOSED|ENDED|EXPIRED|NOT_FOUND/.test(c)) return t('connect_err_closed')
    if (/BANNED|RESTRICT|SUSPEND|FORBIDDEN/.test(c)) return t('connect_err_restricted')
    if (/RATE|THROTTL|TOO_MANY/.test(c)) return t('connect_err_rate_limited')
    return t('connect_err_twitch', { c: c.slice(0, 40) || '?' })
  }
  return ERR_KEYS.includes(code) ? t(`connect_err_${code}`) : t('connect_err_other', { c: code })
}

/** Prédiction lue par l'extension → forme de la carte (view.js). Les
 *  inconnus de Twitch (null) le restent : la carte ne les invente pas. */
function predFromConnect(e) {
  return {
    id: e.id,
    title: e.title,
    status: e.status,
    endsAt: e.createdAt && e.windowSeconds ? e.createdAt + e.windowSeconds * 1000 : null,
    winnerId: e.winningOutcomeId,
    outcomes: e.outcomes.map((o) => ({ id: o.id, title: o.title, color: o.color, points: o.totalPoints ?? 0, users: o.totalUsers })),
  }
}

const freshBet = (id = null) => ({ id, self: null, amount: '', amountN: 0, pick: null, step: 'idle', error: '', note: '' })
const freshPollUi = (open = false) => ({ pick: null, step: 'idle', error: '', note: '', open })
/** Panneau des récompenses : liste, puis confirmation et envoi. */
const freshRw = () => ({ step: 'list', pick: null, input: '', error: '', loading: false })

export class ConnectLive {
  /**
   * @param {object} view  le ChatView du lecteur principal
   * @param {{ connect: object, isPlaying?: () => boolean }} o
   */
  constructor(view, o) {
    this.view = view
    this.connect = o.connect
    this.isPlaying = o.isPlaying ?? (() => false)
    this.channel = null
    this.gen = 0
    this.timer = null
    this.unsub = null
    /** Raids déjà demandés : une seule demande par raid, même en revenant
     *  sur la chaîne pendant le compte à rebours. */
    this.raidTried = new Set()
    this.reset()
    this.onVisible = () => {
      if (document.hidden || !this.channel) return
      if (this.installed() && Date.now() - this.at.status >= STATUS_ON_RETURN) this.refreshStatus()
      this.tick()
    }
    view.el.points.addEventListener('click', (e) => {
      if (e.target.closest('[data-cx-claim]')) this.claim()
      else if (e.target.closest('[data-cx-rewards]')) this.toggleRewards()
    })
    // Carte drops (view.js) : « Réclamer » sur un drop terminé.
    view.el.drops.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cx-drop]')
      if (b) this.claimDrop(b.dataset.cxDrop)
    })
    const rw = view.el.rewards
    rw.addEventListener('click', (e) => this.onRewardsClick(e))
    rw.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.closeRewards(); return }
      keepKeys(e)
    })
    rw.addEventListener('input', (e) => {
      if (!e.target.matches('[data-cx-input]')) return
      this.rw.input = e.target.value
      const n = $('.cx-rw-count', rw)
      if (n) n.textContent = `${e.target.value.length}/${MAX_REWARD_INPUT}`
      if (this.rw.error) { this.rw.error = ''; $('.cx-err', rw)?.remove() }
    })
  }

  reset() {
    this.at = { beat: 0, pulse: 0, drops: 0, points: 0, pred: 0, poll: 0, status: 0 }
    // Un objet par chaîne : la demande en cours d'une chaîne quittée ne
    // bloque pas la suivante.
    this.busy = {}
    this.points = null       // { channelId, balance, claimAvailable, name, icon, streak }
    this.raidJoined = null   // raid rejoint : « Bonus de raid » dans son bandeau
    this.drops = null        // drops.get : { channelHasDrops, campaigns }
    this.rewards = null      // rewards.get : récompenses de la chaîne
    this.rw = freshRw()
    this.bet = freshBet()
    this.seenPred = null     // dernier événement lu par l'extension
    this.gonePreds = new Set()
    this.tpoll = null        // sondage affiché
    this.pollUi = freshPollUi()
    this.gonePolls = new Set()
  }

  // ── Cycle de vie ────────────────────────────────────────────────────────
  start(channel) {
    this.stop()
    this.channel = channel
    const gen = this.gen
    this.unsub = this.connect.onChange(() => this.onState(gen))
    document.addEventListener('visibilitychange', this.onVisible)
    this.timer = setInterval(() => this.tick(), TICK)
    this.render()
    // Session et réglages relus à chaque direct : ils ont pu changer dans
    // l'extension (ou sur twitch.tv) depuis le précédent — connexion au
    // site rallumée comprise.
    if (this.installed()) this.refreshStatus().then(() => { if (gen === this.gen) this.tick() })
  }

  stop() {
    this.gen++
    clearInterval(this.timer)
    this.timer = null
    clearInterval(this.pollTimer)
    clearTimeout(this.pollHide)
    clearTimeout(this.gainTimer)
    this.pollTimer = this.pollHide = null
    this.unsub?.()
    this.unsub = null
    document.removeEventListener('visibilitychange', this.onVisible)
    this.closeRewards()
    this.channel = null
    this.reset()
    this.gain = null
    const el = this.view.el.points
    el.hidden = true
    el.innerHTML = ''
    $('.cx-note', this.view.el.events)?.remove()
    $('.chat-tpoll', this.view.el.events)?.remove()
    this.dropsChanged()
    // La carte de prédiction (si elle reste, fin du direct) redevient
    // en lecture seule.
    this.renderAct()
    this.view.paintPredHead()
  }

  /** Extension branchée, avec une session Twitch : les opérations partent. */
  ready() {
    const s = this.connect.state()
    return Boolean(this.channel) && s.availability === 'on' && Boolean(s.session)
  }

  canSpend() {
    return this.ready() && this.connect.state().settings?.allowSpend !== false
  }

  /** Extension là, branchée ou coupée : son état (`status`) se relit. Absente,
   *  rien ne part. */
  installed() {
    const a = this.connect.state().availability
    return Boolean(this.channel) && (a === 'on' || a === 'off')
  }

  onState(gen) {
    if (gen !== this.gen) return
    const s = this.connect.state()
    // Extension arrivée (ou rebranchée) : sa session d'abord.
    if (s.availability === 'on' && s.session === undefined) this.refreshStatus()
    this.render()
    this.tick()
  }

  /** Tout ce qui dépend de l'état de l'extension. */
  render() {
    if (!this.channel) return
    this.renderNote()
    this.renderPoints()
    this.renderAct()
    this.view.paintPredHead()
    this.dropsChanged()
    this.renderPoll()
    if (!this.ready()) this.closeRewards()
    else this.renderRewards()
  }

  // ── Boucle ──────────────────────────────────────────────────────────────
  tick() {
    if (!this.installed()) return
    const now = Date.now()
    // Session et réglages relus de temps en temps, connexion coupée ou sans
    // session comprises : l'extension ne prévient pas la page quand on les
    // change dans sa fenêtre.
    if (now - this.at.status >= STATUS_EVERY) this.refreshStatus()
    if (!this.ready()) return
    const every = document.hidden ? READ_HIDDEN : READ_VISIBLE
    // Présence et drops : seulement pendant la lecture (onglet caché compris).
    const playing = this.isPlaying()
    if (playing && now - this.at.beat >= BEAT_EVERY - 1000) this.beat()
    if (playing && this.drops?.channelHasDrops && now - this.at.pulse >= PULSE_EVERY - 1000) this.pulse()
    // Événements du compte en direct : solde et drops arrivent d'eux-mêmes.
    const events = this.connect.state().events
    if (now - this.at.drops >= (events ? EVENTS_READ_EVERY : DROPS_EVERY)) this.readDrops()
    if (now - this.at.points >= (events ? EVENTS_READ_EVERY : POINTS_EVERY)) this.readPoints()
    if (now - this.at.pred >= every) this.readPred()
    if (now - this.at.poll >= every) this.readPoll()
  }

  /** Une opération à la fois par sorte ; la réponse d'une chaîne quittée
   *  entre-temps est ignorée. Lectures : échecs silencieux. */
  async run(key, op) {
    const busy = this.busy
    if (busy[key]) return null
    busy[key] = true
    this.at[key] = Date.now()
    const gen = this.gen
    try {
      const data = await this.connect.request(op, { channel: this.channel })
      return gen === this.gen ? data : null
    } catch {
      return null
    } finally {
      busy[key] = false
    }
  }

  async refreshStatus() {
    const busy = this.busy
    if (busy.status) return
    busy.status = true
    this.at.status = Date.now()
    try { await this.connect.refreshStatus() } finally { busy.status = false }
  }

  async beat() {
    const d = await this.run('beat', 'watch.beat')
    if (!d) return
    if (d.balance != null) this.setBalance(d.balance)
    // Coffre réclamé par l'extension (« Coffres automatiques »).
    if (d.claimed) this.gained(d.claimed)
  }

  // ── Points ──────────────────────────────────────────────────────────────
  async readPoints() {
    const d = await this.run('points', 'points.get')
    if (!d) return
    this.points = { channelId: d.channelId, balance: d.balance, claimAvailable: d.claimAvailable, name: d.pointsName, icon: d.pointsIconUrl, streak: d.watchStreak }
    this.renderPoints()
  }

  setBalance(n) {
    if (this.points) this.points.balance = n
    else this.points = { channelId: null, balance: n, claimAvailable: false, name: null, icon: null, streak: null }
    this.renderPoints()
    this.updateActBalance()
    const rwBal = $('.cx-rw-bal span', this.view.el.rewards)
    if (rwBal) rwBal.textContent = fmt(n)
  }

  /** « +N » quelques secondes à la place du solde (et dit au lecteur
   *  d'écran). */
  gained(n) {
    // Coffre dit par watch.beat puis par l'événement du compte (ou
    // l'inverse) : un seul « +50 ».
    const now = Date.now()
    if (this.lastGain?.n === n && now - this.lastGain.at < GAIN_SAME) return
    this.lastGain = { n, at: now }
    if (this.points) this.points.claimAvailable = false
    this.gain = n
    clearTimeout(this.gainTimer)
    this.gainTimer = setTimeout(() => { this.gain = null; this.renderPoints() }, GAIN_SHOWN)
    this.renderPoints()
    const live = $('.cx-live', this.view.el.points)
    if (live) live.textContent = t('pts_gain', { n: fmt(n) })
  }

  /** Solde dans l'en-tête du chat (avec la série de visionnage quand
   *  Twitch la donne), et le coffre à réclamer à la main quand « Coffres
   *  automatiques » est coupé dans l'extension. */
  renderPoints() {
    const el = this.view.el.points
    const p = this.points
    if (!this.ready() || !p) { el.hidden = true; return }
    if (!el.firstChild) {
      // Le solde est un bouton : il ouvre les récompenses de la chaîne.
      el.innerHTML = `<button class="cx-bal" type="button" data-cx-rewards aria-haspopup="dialog"><span class="cx-bal-ic"></span><span class="cx-bal-n"></span></button>
        <span class="cx-streak" hidden>${icon('flame', 11)}<span></span></span>
        <button class="cx-claim" type="button" data-cx-claim hidden>${icon('gift', 14)}</button>
        <span class="cx-live" aria-live="polite"></span>`
    }
    const streak = $('.cx-streak', el)
    streak.hidden = !(p.streak > 0)
    if (p.streak > 0) {
      $('span', streak).textContent = fmt(p.streak)
      streak.title = t('pts_streak', { n: fmt(p.streak) })
      streak.setAttribute('aria-label', streak.title)
    }
    const label = `${p.name ? t('pts_named', { name: p.name, n: fmt(p.balance) }) : t('pts_default', { n: fmt(p.balance) })} · ${t('rewards_show')}`
    const bal = $('.cx-bal', el)
    bal.title = label
    bal.setAttribute('aria-label', label)
    bal.classList.toggle('gain', Boolean(this.gain))
    const ic = $('.cx-bal-ic', el)
    const icKey = p.icon || 'default'
    if (ic.dataset.k !== icKey) {
      ic.dataset.k = icKey
      ic.innerHTML = p.icon ? `<img src="${esc(p.icon)}" alt="" width="14" height="14">` : icon('points', 13)
    }
    $('.cx-bal-n', el).textContent = this.gain ? `+${fmt(this.gain)}` : compact(p.balance)
    const claim = $('.cx-claim', el)
    claim.hidden = !(p.claimAvailable && this.connect.state().settings?.autoClaim === false)
    claim.disabled = Boolean(this.busy.claim)
    claim.title = t('pts_claim')
    claim.setAttribute('aria-label', t('pts_claim'))
    el.hidden = false
  }

  claim() {
    if (!this.ready() || this.busy.claim) return
    const busy = this.busy
    const gen = this.gen
    busy.claim = true
    this.renderPoints()
    this.connect.request('points.claim', { channel: this.channel }).then((d) => {
      if (gen !== this.gen) return
      if (this.points) this.points.claimAvailable = false
      if (d.balance != null) this.setBalance(d.balance)
      if (d.claimed) this.gained(d.claimed)
    }, (e) => {
      if (gen !== this.gen) return
      if (e?.code === 'no_claim' && this.points) this.points.claimAvailable = false
      toast(errorText(e), e?.code === 'no_claim' ? 'info' : 'error')
    }).finally(() => {
      busy.claim = false
      if (gen === this.gen) this.renderPoints()
    })
  }

  /** Extension là, mais sans session Twitch dans ce navigateur. */
  renderNote() {
    const events = this.view.el.events
    const s = this.connect.state()
    let note = $('.cx-note', events)
    if (!(this.channel && s.availability === 'on' && s.session === null && !loginNoteClosed)) { note?.remove(); return }
    if (note) return
    note = document.createElement('div')
    note.className = 'cx-note'
    note.innerHTML = `${icon('twitch', 14)}<a href="${TWITCH_LOGIN}" target="_blank" rel="noopener noreferrer">${esc(t('connect_login_twitch'))}</a>
      <button class="icon-btn xs" type="button" aria-label="${esc(t('close'))}" title="${esc(t('close'))}">${icon('x', 14)}</button>`
    $('button', note).addEventListener('click', () => { loginNoteClosed = true; note.remove() })
    events.prepend(note)
  }

  // ── Récompenses de la chaîne ────────────────────────────────────────────
  /** Le solde touché : la liste des récompenses, sous l'en-tête du chat
   *  (même panneau que les commandes des bots). */
  toggleRewards() {
    const box = this.view.el.rewards
    if (!box.hidden) { this.closeRewards(); return }
    if (!this.ready()) return
    // Un panneau à la fois.
    const bots = $('.bot-cmds:not(.cx-rewards)', this.view.root)
    if (bots) bots.hidden = true
    this.rw = freshRw()
    box.hidden = false
    this.loadRewards()
    $('[data-cx-close]', box)?.focus()
  }

  closeRewards() {
    const box = this.view.el.rewards
    clearInterval(this.rwTimer)
    this.rwTimer = null
    this.rw = freshRw()
    if (box.hidden) return
    box.hidden = true
    box.innerHTML = ''
  }

  async loadRewards() {
    const rw = this.rw
    const gen = this.gen
    rw.loading = true
    this.renderRewards()
    try {
      const d = await this.connect.request('rewards.get', { channel: this.channel })
      if (gen !== this.gen || this.rw !== rw) return
      this.rewards = d.rewards
      if (d.balance != null) this.setBalance(d.balance)
      rw.error = ''
    } catch (e) {
      if (gen !== this.gen || this.rw !== rw) return
      rw.error = errorText(e, 'reward')
    }
    rw.loading = false
    this.renderRewards()
  }

  rewardPick() {
    return (this.rewards ?? []).find((r) => r.id === this.rw.pick) ?? null
  }

  /** Pourquoi une récompense est grisée (en pause, épuisée, en recharge avec
   *  le temps restant, points qui manquent), ou '' si elle est échangeable. */
  rewardBlock(r, now = Date.now()) {
    const bal = this.points?.balance
    if (r.paused) return t('reward_paused')
    if (!r.inStock) return t('reward_out')
    if (r.cooldownEndsAt && r.cooldownEndsAt > now) return t('reward_cooldown', { t: formatClock((r.cooldownEndsAt - now) / 1000) })
    if (bal != null && bal < r.cost) return t('reward_need', { n: fmt(r.cost - bal) })
    return ''
  }

  rewardIcon(r) {
    return `<span class="cx-reward-ic"${r.color ? ` style="--rc:${r.color}"` : ''}>${r.imageUrl
      ? `<img src="${esc(r.imageUrl)}" alt="" width="28" height="28" loading="lazy">`
      : icon('gift', 16)}</span>`
  }

  renderRewards() {
    const box = this.view.el.rewards
    if (box.hidden) return
    const rw = this.rw
    const r = rw.step !== 'list' ? this.rewardPick() : null
    const bal = this.points?.balance
    let body
    if (r) {
      // Confirmation : récompense, coût, consigne, texte demandé, puis envoi.
      const sending = rw.step === 'sending'
      body = `<div class="cx-rw-confirm">
        <div class="cx-reward static">${this.rewardIcon(r)}<span class="cx-reward-text"><b>${esc(r.title)}</b></span>
          <span class="cx-reward-cost">${icon('points', 12)}${esc(fmt(r.cost))}</span></div>
        ${r.prompt ? `<p class="cx-line">${esc(r.prompt)}</p>` : ''}
        ${r.requiresInput ? `<textarea class="text-input cx-rw-input" data-cx-input rows="3" maxlength="${MAX_REWARD_INPUT}"
          placeholder="${esc(t('reward_input_ph'))}" aria-label="${esc(t('reward_input_ph'))}"${sending ? ' disabled' : ''}>${esc(rw.input)}</textarea>
          <small class="muted cx-rw-count">${rw.input.length}/${MAX_REWARD_INPUT}</small>` : ''}
        <div class="cx-confirm">
          <span>${esc(t('reward_confirm', { r: r.title, n: fmt(r.cost) }))}</span>
          <button class="btn ghost sm" type="button" data-cx-cancel${sending ? ' disabled' : ''}>${esc(t('cancel'))}</button>
          <button class="btn primary sm" type="button" data-cx-confirm${sending ? ' disabled' : ''}>${esc(t(sending ? 'connect_sending' : 'reward_redeem'))}</button>
        </div>
        ${rw.error ? `<p class="cx-err" role="alert">${esc(rw.error)}</p>` : ''}
      </div>`
    } else if (!this.rewards) {
      body = rw.error ? `<p class="cx-err" role="alert">${esc(rw.error)}</p>` : `<p class="muted small">${esc(t('loading'))}</p>`
    } else {
      const list = this.rewards.filter((x) => x.enabled).sort((a, b) => a.cost - b.cost)
      const spendOff = !this.canSpend()
      const now = Date.now()
      body = (spendOff ? `<p class="cx-line muted">${esc(t('connect_err_spend_disabled'))}</p>` : '')
        + (rw.error ? `<p class="cx-err" role="alert">${esc(rw.error)}</p>` : '')
        + (list.length ? list.map((x) => {
          const why = this.rewardBlock(x, now)
          // En recharge : seul ce texte suit la seconde (rewardTick).
          const cd = !x.paused && x.inStock && x.cooldownEndsAt > now ? ` data-cx-cd="${x.cooldownEndsAt}"` : ''
          return `<button class="cx-reward" type="button" data-cx-reward="${esc(x.id)}"${why || spendOff ? ' disabled' : ''}>
            ${this.rewardIcon(x)}
            <span class="cx-reward-text"><b>${esc(x.title)}</b>${why ? `<small${cd}>${esc(why)}</small>` : x.prompt ? `<small>${esc(x.prompt)}</small>` : ''}</span>
            <span class="cx-reward-cost">${icon('points', 12)}${esc(compact(x.cost))}</span>
          </button>`
        }).join('') : `<p class="muted small">${esc(t('rewards_empty'))}</p>`)
    }
    box.innerHTML = `<div class="bot-cmds-head">${icon('gift', 16)}<b>${esc(t('rewards_title'))}</b>
        ${bal != null ? `<span class="cx-rw-bal">${icon('points', 12)}<span>${esc(fmt(bal))}</span></span>` : ''}
        <button class="icon-btn xs" type="button" data-cx-close aria-label="${esc(t('close'))}" title="${esc(t('close'))}">${icon('x', 16)}</button></div>
      <div class="bot-cmds-list cx-rw-list">${body}</div>`
    // Recharges : le temps restant suit, tant que la liste est affichée.
    clearInterval(this.rwTimer)
    this.rwTimer = null
    if (!r && this.rewards?.some((x) => x.cooldownEndsAt > Date.now())) this.rwTimer = setInterval(() => this.rewardTick(), 1000)
  }

  /** Chaque seconde : le texte des recharges seulement — refaire la liste
   *  avalerait un clic en cours et le focus du clavier. Une recharge finie
   *  la refait une fois (bouton réactivé). */
  rewardTick() {
    if (this.rw.step !== 'list') return
    const now = Date.now()
    let ended = false
    for (const el of this.view.el.rewards.querySelectorAll('[data-cx-cd]')) {
      const end = Number(el.dataset.cxCd)
      if (end <= now) ended = true
      else el.textContent = t('reward_cooldown', { t: formatClock((end - now) / 1000) })
    }
    if (ended) this.renderRewards()
  }

  onRewardsClick(e) {
    const box = this.view.el.rewards
    if (e.target.closest('[data-cx-close]')) { this.closeRewards(); return }
    const rw = this.rw
    const pick = e.target.closest('[data-cx-reward]')
    if (pick && rw.step === 'list') {
      Object.assign(rw, { step: 'confirm', pick: pick.dataset.cxReward, input: '', error: '' })
      this.renderRewards()
      ;($('[data-cx-input]', box) ?? $('[data-cx-confirm]', box))?.focus()
      return
    }
    if (e.target.closest('[data-cx-cancel]')) {
      Object.assign(rw, { step: 'list', pick: null, error: '' })
      this.renderRewards()
      return
    }
    // Pas le second clic d'un double-clic sur la liste : refaite, elle met
    // « Échanger » sous le curseur (même rangée que le coût).
    if (e.target.closest('[data-cx-confirm]') && !isRepeatClick(e)) this.redeem()
  }

  /** Clic sur « Échanger » : la demande part dans ce clic même — l'extension
   *  refuse une dépense sans geste réel de l'utilisateur. */
  redeem() {
    const rw = this.rw
    const r = this.rewardPick()
    if (!r || rw.step !== 'confirm' || !this.ready()) return
    let input = null
    if (r.requiresInput) {
      // Une ligne, comme sur Twitch : 1 à 200 caractères.
      // Coupé par caractères, pas par unités UTF-16 : un emoji n'est
      // jamais coupé en deux (moitié seule que Twitch refuserait).
      input = Array.from(rw.input.replace(/\s+/g, ' ').trim()).slice(0, MAX_REWARD_INPUT).join('')
      if (!input) {
        rw.error = t('reward_input_needed')
        this.renderRewards()
        $('[data-cx-input]', this.view.el.rewards)?.focus()
        return
      }
    }
    const gen = this.gen
    const req = this.connect.request('rewards.redeem', {
      channel: this.channel, rewardId: r.id, cost: r.cost, title: r.title, prompt: r.prompt, input,
    })
    Object.assign(rw, { step: 'sending', error: '' })
    this.renderRewards()
    // Panneau fermé pendant l'envoi (croix, Échap, solde touché : jusqu'à
    // 45 s avec le jeton d'intégrité) : l'échange part quand même, son
    // résultat est donc toujours dit — sinon on le croirait annulé.
    req.then((d) => {
      if (gen !== this.gen) return
      if (d.balance != null) this.setBalance(d.balance)
      this.at.points = 0
      if (this.rw === rw) this.closeRewards()
      toast(t('reward_done', { r: r.title }), 'success')
    }, (e) => {
      if (gen !== this.gen) return
      this.at.points = 0   // échange peut-être passé : solde relu
      if (this.rw !== rw) { toast(errorText(e, 'reward', true), 'error'); return }
      Object.assign(rw, { step: 'confirm', error: errorText(e, 'reward', true) })
      this.renderRewards()
    })
  }

  // ── Drops ───────────────────────────────────────────────────────────────
  async readDrops() {
    const d = await this.run('drops', 'drops.get')
    if (!d) return
    this.drops = d
    this.view.connectDrops()
  }

  /** Fait avancer les drops (toutes les 10 s pendant la lecture) ; un drop
   *  réclamé par l'extension (« Réclamer automatiquement ») est annoncé. */
  async pulse() {
    const d = await this.run('pulse', 'drops.pulse')
    if (!d?.claimed.length) return
    const names = d.claimed.filter((n) => freshDrop(n))
    if (names.length) toast(names.map((n) => t('drops_claimed_toast', { n })).join(' · '), 'success')
    this.at.drops = 0   // progression relue au prochain tour
  }

  /** Drops à relire au prochain tour (réclamé ailleurs : page Drops). */
  dropsStale() {
    this.at.drops = 0
  }

  /** Événement du compte (Hermes, par l'extension 0.3.0) : solde, coffre et
   *  gains en direct pour la chaîne regardée ; progression des drops ; carte
   *  de la prédiction relue. Les annonces (drops, paris) : main.js. */
  accountEvent(ev) {
    if (!this.ready()) return
    const p = this.points
    const here = Boolean(p?.channelId) && ev.channelId === p.channelId
    if (ev.type === 'points' && here) {
      this.setBalance(ev.balance)
      if (ev.gain > 0) this.gained(ev.gain)
    } else if (ev.type === 'chest' && here) {
      // Réclamé par l'extension (le gain arrive à part), ou à réclamer ici.
      p.claimAvailable = !ev.claimed
      if (ev.balance != null) this.setBalance(ev.balance)
      else this.renderPoints()
    } else if (ev.type === 'prediction' && here) {
      this.at.pred = 0
    } else if (ev.type === 'drop') {
      const x = this.drops?.campaigns.flatMap((c) => c.drops).find((d) => d.id === ev.dropId)
      if (x && ev.current != null && ev.current > x.currentMinutes) {
        x.currentMinutes = ev.current
        this.dropsChanged()
      }
      if (ev.claimed || ev.ready) this.at.drops = 0
    }
  }

  /** Campagne de l'extension pour la carte, quand le GQL public n'en montre
   *  pas : la première en cours, pas fermée par l'utilisateur (`gone`). */
  dropsFallback(gone) {
    if (!this.ready() || !this.drops) return null
    for (const c of this.drops.campaigns) {
      if (gone.has(c.id) || !c.drops.length || (c.endsAt && c.endsAt < Date.now())) continue
      const drops = c.drops.slice().sort((a, b) => a.requiredMinutes - b.requiredMinutes)
      // En titre, le prochain drop à obtenir (le premier s'ils le sont tous).
      const next = drops.find((x) => !x.claimed) ?? drops[0]
      return {
        id: c.id, name: c.name, game: c.gameName ?? '', endsAt: c.endsAt, details: '',
        reward: next.name, image: next.imageUrl ?? '', minutes: next.requiredMinutes, more: drops.length - 1,
      }
    }
    return null
  }

  /** Progression du compte dans la carte drops (view.js) : une ligne par
   *  drop (barre, minutes), réclamé, ou « Réclamer ». */
  dropsChanged() {
    const slot = $('.drops-cx', this.view.el.drops)
    if (!slot) return
    const card = this.view.dropsCard
    const list = this.ready() && card && this.drops ? this.drops.campaigns : []
    const camp = list.find((c) => c.id === card.id)
      ?? list.find((c) => c.name && card.name && c.name.toLowerCase() === card.name.toLowerCase())
    if (!camp?.drops.length) { slot.hidden = true; slot.innerHTML = ''; return }
    // Compte de jeu à lier (extension 0.3.0) : rien de réclamable d'ici, le
    // lien pour le faire (adresse https relue par connect.js).
    const link = camp.needsLink
      ? `<p class="drop-link">${icon('link', 12)} ${camp.linkUrl
        ? `<a href="${esc(camp.linkUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('drops_link_account'))}</a>`
        : esc(t('drops_link_account'))}</p>`
      : ''
    // Extension 0.3.0 : toutes les campagnes du compte (page Drops, main.js).
    const all = canAccount(this.connect.state())
      ? `<button class="drop-all" type="button" data-action="drops-page">${esc(t('dp_all'))}${icon('chevronRight', 12)}</button>`
      : ''
    slot.innerHTML = link + camp.drops.slice().sort((a, b) => a.requiredMinutes - b.requiredMinutes).map((x) => {
      const cur = Math.min(x.currentMinutes, x.requiredMinutes)
      const pct = x.claimed || !x.requiredMinutes ? 100 : Math.round((cur / x.requiredMinutes) * 100)
      const state = x.claimed
        ? `<span class="drop-ok">${icon('check', 11)}${esc(t('drops_claimed_state'))}</span>`
        : x.dropInstanceId
          ? `<button class="cx-chip drop-claim" type="button" data-cx-drop="${esc(x.dropInstanceId)}"${this.busy.dropClaim ? ' disabled' : ''}>${esc(t('drops_claim'))}</button>`
          : `<span class="drop-min">${esc(t('drops_progress', { c: fmt(cur), r: fmt(x.requiredMinutes) }))}</span>`
      return `<div class="drop-row">
        <div class="drop-line"><span class="drop-name">${esc(x.name)}</span>${state}</div>
        <div class="pred-bar"><i style="width:${pct}%;background:var(--purple)"></i></div>
      </div>`
    }).join('') + all
    slot.hidden = false
  }

  /** « Réclamer » sur un drop terminé (pas une dépense : pas de confirmation). */
  claimDrop(id) {
    if (!this.ready() || this.busy.dropClaim || !id) return
    const busy = this.busy
    const gen = this.gen
    const drop = this.drops?.campaigns.flatMap((c) => c.drops).find((x) => x.dropInstanceId === id)
    busy.dropClaim = true
    this.dropsChanged()
    this.connect.request('drops.claim', { dropInstanceId: id }).then((d) => {
      if (gen !== this.gen) return
      if (d.claimed) {
        if (drop) Object.assign(drop, { claimed: true, dropInstanceId: null })
        freshDrop(drop?.name)
        toast(t('drops_claimed_toast', { n: drop?.name || '?' }), 'success')
      } else toast(t('drops_not_claimed'))
      this.at.drops = 0
    }, (e) => {
      if (gen === this.gen) toast(errorText(e), 'error')
    }).finally(() => {
      busy.dropClaim = false
      if (gen === this.gen) this.dropsChanged()
    })
  }

  // ── Raid ────────────────────────────────────────────────────────────────
  /** Annonce d'un raid sur la chaîne regardée (Hermes) : le rejoindre donne
   *  le bonus de points de raid, comme sur twitch.tv. Une demande par raid,
   *  sans clic (ce n'est pas une dépense). Jamais bloquant : le bandeau et
   *  le suivi du raid ne l'attendent pas, et un échec ne change rien. */
  joinRaid(raidId) {
    if (!raidId || !this.ready() || this.raidTried.has(raidId)) return
    this.raidTried.add(raidId)
    if (this.raidTried.size > 50) this.raidTried.delete(this.raidTried.values().next().value)
    const gen = this.gen
    this.connect.request('raid.join', { channel: this.channel, raidId }).then((d) => {
      if (gen !== this.gen || !d.joined) return
      this.raidJoined = raidId
      const sub = $('.chat-raid .raid-sub', this.view.el.events)
      if (sub && !$('.raid-bonus', sub)) sub.insertAdjacentHTML('beforeend', this.raidBonusHtml({ id: raidId }))
    }, () => {})
  }

  /** Mention « Bonus de raid » du bandeau (view.js showRaid). */
  raidBonusHtml(raid) {
    // Séparateur dans la mention : à la ligne, elle part en entier.
    return raid?.id && raid.id === this.raidJoined && this.channel
      ? ` <span class="raid-bonus">· ${icon('points', 11)}${esc(t('raid_bonus'))}</span>`
      : ''
  }

  // ── Prédictions ─────────────────────────────────────────────────────────
  async readPred() {
    const d = await this.run('pred', 'predictions.get')
    if (!d) return
    if (d.balance != null) this.setBalance(d.balance)
    const e = d.event
    const view = this.view
    if (!e) {
      // Plus rien chez Twitch : la carte d'un événement que l'extension
      // avait vu ouvert (annulé, ou fini sans signal d'Hermes) part.
      if (this.seenPred && view.pred?.id === this.seenPred && view.pred.status !== 'RESOLVED') view.showPrediction(null)
      this.seenPred = null
      return
    }
    // Carte déjà partie, ou événement fini avant qu'on le voie : rien.
    if (this.gonePreds.has(e.id)) return
    if ((e.status === 'RESOLVED' || e.status === 'CANCELED') && view.pred?.id !== e.id) return
    this.seenPred = e.id
    if (this.bet.id !== e.id) this.bet = freshBet(e.id)
    this.bet.self = e.self
    // Résultat déjà affiché : sa minute d'affichage ne repart pas à
    // chaque relecture.
    if (e.status === 'RESOLVED' && view.pred?.status === 'RESOLVED') {
      view.paintPredHead()
      this.renderAct()
      return
    }
    view.showPrediction(predFromConnect(e))
  }

  /** Appelé par la carte (view.js) après chaque mise à jour ; `box` null :
   *  la carte est partie (résolue depuis une minute, ou annulée). */
  predChanged(box, p) {
    if (!box) {
      if (!p?.id) return
      this.gonePreds.add(p.id)
      const self = this.bet.id === p.id ? this.bet.self : null
      if (self && (p.status === 'CANCELED' || p.status === 'CANCEL_PENDING')) toast(t('pred_refunded', { n: fmt(self.points) }))
      if (this.bet.id === p.id) this.bet = freshBet()
      return
    }
    if (this.bet.id !== p.id) this.bet = freshBet(p.id)
    // Résultat d'une mise : la carte s'ouvre pour le montrer.
    if (p.status === 'RESOLVED' && this.bet.self && this.ready()) box.classList.add('open')
    this.renderAct(box, p)
  }

  /** Pastille de l'en-tête de la carte : « Miser », ou la mise faite. */
  predTag(p) {
    if (!this.ready()) return ''
    const self = this.bet.id === p.id ? this.bet.self : null
    if (self) {
      const o = p.outcomes.find((x) => x.id === self.outcomeId)
      const label = t('pred_my_bet', { n: fmt(self.points), o: o?.title ?? '' })
      return `<span class="cx-tag" title="${esc(label)}" aria-label="${esc(label)}">${icon('points', 11)}${esc(compact(self.points))}</span>`
    }
    return p.status === 'ACTIVE' && this.canSpend() ? `<span class="cx-tag">${esc(t('pred_bet_tag'))}</span>` : ''
  }

  maxBet() {
    const b = this.points?.balance
    return Math.min(MAX_BET, b == null ? MAX_BET : b)
  }

  /** Bloc de mise sous les issues : montant, boutons rapides, issue, puis
   *  confirmation (montant + issue) ; refait seulement quand il change. */
  renderAct(box = $('.chat-pred', this.view.el.events), p = this.view.pred) {
    const act = box && $('.pred-act', box)
    if (!act) return
    if (!this.ready() || !p) { act.innerHTML = ''; act.dataset.sig = ''; return }
    const b = this.bet.id === p.id ? this.bet : freshBet(p.id)
    const self = b.self
    const spendOff = !this.canSpend()
    const sig = JSON.stringify([p.id, p.status, p.winnerId, self, b.step, b.pick, b.error, b.note, spendOff,
      p.outcomes.map((o) => [o.id, o.title, o.color])])
    if (act.dataset.sig === sig) { this.updateActBalance(); return }
    act.dataset.sig = sig
    if (!act.dataset.wired) {
      act.dataset.wired = '1'
      act.addEventListener('click', (e) => this.onActClick(e))
      act.addEventListener('keydown', keepKeys)
      act.addEventListener('input', (e) => {
        if (!e.target.matches('[data-cx-amount]')) return
        this.bet.amount = e.target.value
        if (this.bet.error) { this.bet.error = ''; $('.cx-err', act)?.remove() }
      })
    }
    const title = (id) => p.outcomes.find((o) => o.id === id)?.title ?? ''
    const parts = []
    if (self) parts.push(`<p class="cx-line">${esc(t('pred_my_bet', { n: fmt(self.points), o: title(self.outcomeId) }))}</p>`)
    if (self && p.status === 'RESOLVED' && p.winnerId) {
      const won = p.winnerId === self.outcomeId
      parts.push(`<p class="cx-line ${won ? 'ok' : 'lost'}">${esc(t(won ? 'pred_won' : 'pred_lost'))}</p>`)
    }
    if (p.status === 'ACTIVE') {
      if (spendOff) parts.push(`<p class="cx-line muted">${esc(t('connect_err_spend_disabled'))}</p>`)
      else if (b.step !== 'idle') {
        const sending = b.step === 'sending'
        parts.push(`<div class="cx-confirm">
          <span>${esc(t('pred_confirm', { n: fmt(b.amountN), o: title(b.pick) }))}</span>
          <button class="btn ghost sm" type="button" data-cx-cancel${sending ? ' disabled' : ''}>${esc(t('cancel'))}</button>
          <button class="btn primary sm" type="button" data-cx-confirm${sending ? ' disabled' : ''}>${esc(t(sending ? 'connect_sending' : 'connect_confirm'))}</button>
        </div>`)
      } else {
        parts.push(`<div class="cx-amount">
          <input class="text-input" type="text" inputmode="numeric" autocomplete="off" maxlength="9" data-cx-amount
            value="${esc(b.amount)}" placeholder="${esc(t('pred_amount'))}" aria-label="${esc(t('pred_amount'))}">
          ${QUICK.map((n) => `<button class="cx-chip" type="button" data-cx-quick="${n}">${esc(fmt(n))}</button>`).join('')}
          <button class="cx-chip" type="button" data-cx-quick="max">${esc(t('pred_max'))}</button>
        </div>
        <div class="cx-picks">${p.outcomes.map((o) => {
          const other = self && self.outcomeId !== o.id
          const tip = other ? t('pred_one_outcome') : t('pred_bet_on', { o: o.title })
          return `<button class="cx-pick ${o.color === 'PINK' ? 'pink' : 'blue'}" type="button" data-cx-pick="${esc(o.id)}"
            title="${esc(tip)}"${other ? ' disabled' : ''}>${esc(o.title)}</button>`
        }).join('')}</div>
        <p class="cx-line muted cx-act-bal"></p>`)
      }
    }
    if (b.error) parts.push(`<p class="cx-err" role="alert">${esc(b.error)}</p>`)
    if (b.note) parts.push(`<p class="cx-line ok" role="status">${esc(b.note)}</p>`)
    act.innerHTML = parts.join('')
    this.updateActBalance()
  }

  updateActBalance() {
    const el = $('.chat-pred .cx-act-bal', this.view.el.events)
    if (!el) return
    const n = this.points?.balance
    el.textContent = n == null ? '' : t('pred_balance', { n: fmt(n) })
  }

  onActClick(e) {
    const p = this.view.pred
    const b = this.bet
    if (!p || b.id !== p.id || !this.ready()) return
    const act = e.currentTarget
    const quick = e.target.closest('[data-cx-quick]')
    if (quick) {
      const max = this.maxBet()
      if (quick.dataset.cxQuick === 'max' && max < 1) { b.error = t('connect_err_points'); this.renderAct(); return }
      b.amount = String(quick.dataset.cxQuick === 'max' ? max : Math.min(Number(quick.dataset.cxQuick), MAX_BET))
      const input = $('[data-cx-amount]', act)
      if (input) input.value = fmt(Number(b.amount))
      if (b.error) { b.error = ''; this.renderAct() }
      return
    }
    const pick = e.target.closest('[data-cx-pick]')
    if (pick) { this.pickOutcome(pick.dataset.cxPick); return }
    if (e.target.closest('[data-cx-cancel]')) {
      b.step = 'idle'
      b.pick = null
      this.renderAct()
      $('[data-cx-amount]', act)?.focus()
      return
    }
    // Pas le second clic d'un double-clic sur une issue : la confirmation,
    // repliée sur deux lignes, peut arriver sous le curseur.
    if (e.target.closest('[data-cx-confirm]') && !isRepeatClick(e)) this.placeBet()
  }

  /** Issue choisie : le montant est vérifié, puis la confirmation montre
   *  montant et issue avant tout envoi. */
  pickOutcome(id) {
    const p = this.view.pred
    const b = this.bet
    const max = this.maxBet()
    const n = parseAmount(b.amount)
    b.note = ''
    if (p.status !== 'ACTIVE' || (p.endsAt && Date.now() >= p.endsAt)) b.error = t('connect_err_closed')
    else if (b.self && b.self.outcomeId !== id) b.error = t('pred_one_outcome')
    else if (max < 1) b.error = t('connect_err_points')
    else if (!(n >= 1 && n <= max)) b.error = t('pred_bad_amount', { max: fmt(max) })
    else {
      b.error = ''
      b.pick = id
      b.amountN = n
      b.step = 'confirm'
    }
    this.renderAct()
    if (b.step === 'confirm') $('.chat-pred [data-cx-confirm]', this.view.el.events)?.focus()
  }

  /** Clic sur « Confirmer » : la demande part dans ce clic même —
   *  l'extension refuse une dépense sans geste réel de l'utilisateur. */
  placeBet() {
    const p = this.view.pred
    const b = this.bet
    if (b.step !== 'confirm' || !p || p.id !== b.id || p.status !== 'ACTIVE') return
    const gen = this.gen
    const req = this.connect.request('predictions.bet', { channel: this.channel, eventId: p.id, outcomeId: b.pick, points: b.amountN })
    b.step = 'sending'
    this.renderAct()
    req.then((d) => {
      if (gen !== this.gen || this.bet !== b) return
      Object.assign(b, { self: d.self, step: 'idle', pick: null, amount: '', error: '', note: t('pred_done') })
      if (d.balance != null) this.setBalance(d.balance)
      this.at.pred = 0   // totaux relus au prochain tour
      this.view.paintPredHead()
      this.renderAct()
      setTimeout(() => { if (this.bet === b && b.note) { b.note = ''; this.renderAct() } }, NOTE_SHOWN)
    }, (e) => {
      if (gen !== this.gen || this.bet !== b) return
      // Mise peut-être passée : prédiction et solde relus au prochain tour.
      this.at.pred = 0
      this.at.points = 0
      Object.assign(b, { step: 'idle', pick: null, error: errorText(e, '', true) })
      this.renderAct()
    })
  }

  // ── Sondages Twitch ─────────────────────────────────────────────────────
  async readPoll() {
    const d = await this.run('poll', 'polls.get')
    if (d) this.applyPoll(d.poll)
  }

  applyPoll(poll) {
    const cur = this.tpoll
    if (!poll) {
      // Plus de sondage chez Twitch : celui qui était ouvert part.
      if (cur && cur.status === 'ACTIVE') this.removePoll(false)
      return
    }
    if (this.gonePolls.has(poll.id)) return
    const ended = poll.status !== 'ACTIVE'
    if (cur?.id !== poll.id) {
      // Fini avant qu'on le voie : rien.
      if (ended) return
      // Un nouveau sondage remplace l'ancien (carte et minuteurs compris).
      if (cur) this.removePoll(true)
      this.pollUi = freshPollUi(!poll.self)
    }
    this.tpoll = poll
    // Fini : le résultat reste une minute, puis la carte part.
    if (ended && !this.pollHide) this.pollHide = setTimeout(() => this.removePoll(true), POLL_END_SHOWN)
    this.renderPoll()
  }

  removePoll(gone) {
    clearTimeout(this.pollHide)
    clearInterval(this.pollTimer)
    this.pollHide = this.pollTimer = null
    if (gone && this.tpoll) this.gonePolls.add(this.tpoll.id)
    this.tpoll = null
    this.pollUi = freshPollUi()
    $('.chat-tpoll', this.view.el.events)?.remove()
  }

  /** Carte du sondage, sous la prédiction : choix, %, votes, et le vote
   *  (gratuit, puis votes en plus contre des points si la chaîne l'a
   *  activé). Même allure que la carte de prédiction. */
  renderPoll() {
    const poll = this.tpoll
    const events = this.view.el.events
    let box = $('.chat-tpoll', events)
    if (!poll || !this.ready()) {
      // Carte retirée (extension coupée, session partie) : son compte à
      // rebours aussi, il tournait sur un élément détaché.
      clearInterval(this.pollTimer)
      this.pollTimer = null
      box?.remove()
      return
    }
    if (!box) {
      box = document.createElement('div')
      box.className = `chat-tpoll${this.pollUi.open ? ' open' : ''}`
      box.innerHTML = '<div class="pred-head"></div><div class="pred-body"></div>'
      events.append(box)
      box.addEventListener('click', (e) => this.onPollClick(e, box))
      box.addEventListener('keydown', keepKeys)
    }
    const ui = this.pollUi
    const active = poll.status === 'ACTIVE'
    const spendOff = !this.canSpend()
    const voted = Boolean(poll.self)
    const cost = poll.pointsVoting.enabled ? poll.pointsVoting.cost : null
    const balance = this.points?.balance
    const sending = ui.step === 'sending'
    const sig = JSON.stringify([poll, ui.step, ui.pick, ui.error, ui.note, spendOff, balance != null && cost != null && balance < cost])
    if (box.dataset.sig === sig) return
    box.dataset.sig = sig
    const total = Math.max(1, poll.totalVotes ?? poll.choices.reduce((n, c) => n + (c.votes ?? 0), 0))
    const mine = new Set(poll.self?.choiceIds ?? [])
    const choice = (id) => poll.choices.find((c) => c.id === id)?.title ?? ''
    const head = `${icon('poll', 14)}<b>${esc(poll.title || t('tpoll_title'))}</b>${voted ? `<span class="cx-tag" title="${esc(t('tpoll_mine'))}">${icon('check', 11)}</span>` : ''}<span class="pred-state">${active ? '' : esc(t('tpoll_ended'))}</span>`
    $('.pred-head', box).innerHTML = head
    const rows = poll.choices.map((c) => {
      const pct = Math.round(((c.votes ?? 0) / total) * 100)
      let btn = ''
      if (active && !spendOff && !voted) {
        btn = `<button class="cx-chip" type="button" data-cx-vote="${esc(c.id)}" aria-label="${esc(t('tpoll_vote_for', { c: c.title }))}"${sending ? ' disabled' : ''}>${esc(t('tpoll_vote'))}</button>`
      } else if (active && !spendOff && voted && cost != null) {
        const tip = t('tpoll_extra', { n: fmt(cost) })
        btn = `<button class="cx-chip" type="button" data-cx-extra="${esc(c.id)}" title="${esc(tip)}" aria-label="${esc(`${tip} · ${c.title}`)}"${sending || ui.step === 'confirm' || (balance != null && balance < cost) ? ' disabled' : ''}>+1 · ${esc(compact(cost))}</button>`
      }
      const votes = c.votes == null ? '' : ` · ${esc(t('tpoll_votes', { n: fmt(c.votes) }))}`
      return `<div class="pred-row tpoll-row${mine.has(c.id) ? ' win' : ''}">
        <div class="tpoll-main">
          <div class="pred-label"><span>${mine.has(c.id) ? `${icon('check', 11)} ` : ''}${esc(c.title)}</span><span>${pct}%${votes}</span></div>
          <div class="pred-bar"><i style="width:${pct}%;background:var(--purple)"></i></div>
        </div>${btn}
      </div>`
    }).join('')
    const parts = [rows]
    if (active && spendOff) parts.push(`<p class="cx-line muted">${esc(t('connect_err_spend_disabled'))}</p>`)
    if (active && (ui.step === 'confirm' || (sending && ui.withPoints))) {
      parts.push(`<div class="cx-confirm">
        <span>${esc(t('tpoll_confirm', { c: choice(ui.pick), n: fmt(cost ?? 0) }))}</span>
        <button class="btn ghost sm" type="button" data-cx-cancel${sending ? ' disabled' : ''}>${esc(t('cancel'))}</button>
        <button class="btn primary sm" type="button" data-cx-confirm${sending ? ' disabled' : ''}>${esc(t(sending ? 'connect_sending' : 'connect_confirm'))}</button>
      </div>`)
    }
    if (ui.error) parts.push(`<p class="cx-err" role="alert">${esc(ui.error)}</p>`)
    if (ui.note) parts.push(`<p class="cx-line ok" role="status">${esc(ui.note)}</p>`)
    $('.pred-body', box).innerHTML = parts.join('')
    // Temps restant, à la seconde, tant que le sondage est ouvert.
    clearInterval(this.pollTimer)
    this.pollTimer = null
    const ends = active && poll.startedAt && poll.durationSeconds ? poll.startedAt + poll.durationSeconds * 1000 : 0
    if (ends) {
      const el = $('.pred-state', box)
      const tickPoll = () => {
        const s = Math.max(0, Math.round((ends - Date.now()) / 1000))
        el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      }
      tickPoll()
      this.pollTimer = setInterval(tickPoll, 1000)
    }
  }

  onPollClick(e, box) {
    const ui = this.pollUi
    const vote = e.target.closest('[data-cx-vote]')
    if (vote) { this.vote(vote.dataset.cxVote, false); return }
    const extra = e.target.closest('[data-cx-extra]')
    if (extra) {
      // Vote en plus : il coûte des points, confirmé d'abord (choix + coût).
      Object.assign(ui, { step: 'confirm', pick: extra.dataset.cxExtra, error: '', note: '' })
      this.renderPoll()
      $('[data-cx-confirm]', box)?.focus()
      return
    }
    if (e.target.closest('[data-cx-cancel]')) { Object.assign(ui, { step: 'idle', pick: null }); this.renderPoll(); return }
    if (e.target.closest('[data-cx-confirm]')) { this.vote(ui.pick, true); return }
    if (e.target.closest('button, a')) return
    ui.open = box.classList.toggle('open')
  }

  /** Vote : la demande part dans le clic même (l'extension exige un geste
   *  réel de l'utilisateur, même pour le vote gratuit). */
  vote(choiceId, withPoints) {
    const poll = this.tpoll
    const ui = this.pollUi
    if (!poll || poll.status !== 'ACTIVE' || !choiceId || ui.step === 'sending' || !this.ready()) return
    const gen = this.gen
    const req = this.connect.request('polls.vote', { channel: this.channel, pollId: poll.id, choiceId, withPoints })
    Object.assign(ui, { step: 'sending', pick: choiceId, withPoints, error: '', note: '' })
    this.renderPoll()
    req.then((d) => {
      if (gen !== this.gen || this.pollUi !== ui) return
      Object.assign(ui, { step: 'idle', pick: null, note: t('tpoll_done') })
      // Solde relu au prochain tour (vote payé en points).
      if (withPoints) this.at.points = 0
      this.applyPoll(d.poll)
      setTimeout(() => { if (this.pollUi === ui && ui.note) { ui.note = ''; this.renderPoll() } }, NOTE_SHOWN)
    }, (e) => {
      if (gen !== this.gen || this.pollUi !== ui) return
      // Vote peut-être passé : sondage (et solde s'il était payant) relus.
      this.at.poll = 0
      if (withPoints) this.at.points = 0
      Object.assign(ui, { step: 'idle', pick: null, error: errorText(e, '', withPoints) })
      this.renderPoll()
    })
  }
}
