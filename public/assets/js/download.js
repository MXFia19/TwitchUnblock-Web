// ═══════════════════════════════════════════════════════════════════════════
//  Télécharger une VOD, ou un passage (de tel instant à tel autre) : les
//  segments qui couvrent le passage, mis bout à bout dans un seul fichier
//  (.ts, ou .mp4 pour les VODs en fMP4) — VLC, mpv, le lecteur de Windows…
//
//  Passages coupés pour musique protégée : un jour ou deux après le live, le
//  CDN de Twitch sert encore le son d'origine (« N.ts » au lieu de
//  « N-muted.ts ») ; c'est lui qui est pris tant qu'il existe.
//
//  Chrome et Edge écrivent au fil de l'eau dans le fichier choisi (File
//  System Access) ; ailleurs, le fichier est assemblé en mémoire, d'où une
//  taille limite.
// ═══════════════════════════════════════════════════════════════════════════

import { RELAY_BASE, fixProxiedUrl, proxyBaseOf, withoutRelay } from './api.js'
import { lang, t } from './i18n.js'
import { qualityLabel, qualityText, sortQualities } from './player.js'
import { $, esc, formatClock, icon, isMobile, toast } from './util.js'

const CONCURRENCY = 4
/** Sans écriture sur le disque, tout tient en mémoire : pas au-delà. Un
 *  téléphone en supporte bien moins qu'un ordinateur — Safari rechargeait
 *  l'onglet en cours de route, et tout était perdu : 800 Mo, 400 Mo s'il dit
 *  n'avoir que 2 Go de mémoire (navigator.deviceMemory, Chrome). */
const MEMORY_LIMIT = !isMobile ? 1.5e9 : (navigator.deviceMemory ?? 4) <= 2 ? 4e8 : 8e8
/** La limite porte sur une estimation (débit moyen de la qualité) : un débit
 *  plus fort la dépasse. Passé cette marge, le téléchargement s'arrête avec
 *  un message au lieu de faire planter l'onglet. */
const MEMORY_HARD_LIMIT = MEMORY_LIMIT * 1.3
const canStream = typeof window.showSaveFilePicker === 'function'

let hooks = {}
let ctx = null          // VOD proposée : { id, title, streamer, links, position, quality }
let setup = null        // choix en cours : { quality, start, end, restore, plans: Map }
let job = null          // téléchargement en cours (un seul à la fois)

/** @param {{ openSheet: (html: string) => void, closeSheet: () => void }} o */
export function init(o) {
  hooks = o
  // Quitter la page couperait le téléchargement : on prévient.
  window.addEventListener('beforeunload', (e) => {
    if (job?.state === 'running') { e.preventDefault(); e.returnValue = '' }
  })
}

// ── Feuille ──────────────────────────────────────────────────────────────
/** Ouvre la feuille : le choix du passage, ou le téléchargement en cours. */
export function open(vod) {
  if (job?.state === 'running') return renderProgress(true)
  ctx = vod
  const qualities = qualitiesOf(vod.links)
  const quality = qualities.find((q) => /^720p/i.test(q)) ?? qualities.find((q) => !/audio/i.test(q)) ?? qualities[0]
  setup = { quality, start: 0, end: 0, duration: 0, restore: true, plans: new Map(), first: true }
  renderSetup()
  loadPlan()
}

function renderSetup() {
  const qualities = qualitiesOf(ctx.links)
  hooks.openSheet(`
    <div class="sheet-head"><h2>${esc(t('dl_title'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
    <p class="muted sheet-sub dl-vod">${esc(ctx.title)}</p>
    <div class="dl-block">
      <span class="dl-label">${esc(t('quality'))}</span>
      <div class="segmented dl-q">${qualities.map((q) => `<button type="button" data-q="${esc(q)}" class="${q === setup.quality ? 'active' : ''}">${esc(qualityText(q))}</button>`).join('')}</div>
    </div>
    <div id="dl-range"><div class="dl-wait"><span class="spinner"></span></div></div>
    <label class="setting">
      <span class="setting-text"><span>${esc(t('dl_restore'))}</span><small>${esc(t('dl_restore_sub'))}</small></span>
      <input type="checkbox" class="switch" id="dl-restore" ${setup.restore ? 'checked' : ''}>
    </label>
    <p class="dl-warn" id="dl-warn" hidden></p>
    <button class="btn primary full" type="button" id="dl-go" disabled>${icon('download', 17)}<span>${esc(t('dl_download'))}</span></button>
    <p class="muted small dl-note">${esc(t(canStream ? 'dl_note_stream' : 'dl_note_memory'))}</p>`)
  const sheet = $('#sheet')
  sheet.onclick = (e) => {
    if (e.target.closest('[data-sheet-close]')) return hooks.closeSheet()
    const q = e.target.closest('[data-q]')?.dataset.q
    if (q && q !== setup.quality) {
      setup.quality = q
      for (const b of sheet.querySelectorAll('[data-q]')) b.classList.toggle('active', b.dataset.q === q)
      return loadPlan()
    }
    const step = e.target.closest('[data-step]')
    if (step) {
      const [which, delta] = step.dataset.step.split(':')
      return setRange(which, setup[which] + Number(delta))
    }
    const preset = e.target.closest('[data-preset]')?.dataset.preset
    if (preset) return applyPreset(preset)
    if (e.target.closest('#dl-go')) return start()
  }
  sheet.oninput = (e) => {
    if (e.target.id === 'dl-start') setRange('start', Number(e.target.value))
    if (e.target.id === 'dl-end') setRange('end', Number(e.target.value))
    if (e.target.id === 'dl-restore') setup.restore = e.target.checked
  }
}

/** Playlist de la qualité choisie : la durée, et ce qu'il faudra télécharger. */
async function loadPlan() {
  const quality = setup.quality
  const wanted = setup
  let box = $('#dl-range')
  if (box) box.innerHTML = '<div class="dl-wait"><span class="spinner"></span></div>'
  if ($('#dl-go')) $('#dl-go').disabled = true
  let plan = setup.plans.get(quality)
  if (!plan) {
    plan = await fetchPlan(ctx.links[quality]).catch(() => null)
    // Relais vidéo en panne : la même playlist par le Worker.
    const alt = plan ? null : offRelay(ctx.links[quality])
    if (alt) plan = await fetchPlan(alt).catch(() => null)
    if (plan) setup.plans.set(quality, plan)
  }
  // Feuille fermée, autre qualité ou autre VOD entre-temps : rien à afficher.
  box = $('#dl-range')
  if (!box || setup !== wanted || setup.quality !== quality) return
  if (!plan || plan.duration < 20) {
    box.innerHTML = `<p class="dl-warn">${esc(t('dl_error'))}</p>`
    return
  }
  setup.duration = plan.duration
  if (setup.first) {
    // Par défaut : de là où l'on en est jusqu'à la fin.
    setup.first = false
    setup.start = ctx.position >= 10 ? Math.min(Math.floor(ctx.position), plan.duration - 10) : 0
    setup.end = plan.duration
  } else {
    setup.end = Math.min(Math.max(setup.end, setup.start + 10), plan.duration)
  }
  const max = Math.ceil(plan.duration)
  $('#dl-range').innerHTML = `
    ${timeRow('start', t('dl_start'), max)}
    ${timeRow('end', t('dl_end'), max)}
    <div class="dl-presets">
      <button class="btn ghost sm" type="button" data-preset="all">${esc(t('dl_all'))}</button>
      <button class="btn ghost sm" type="button" data-preset="here">${esc(t('dl_from_here'))}</button>
      <button class="btn ghost sm" type="button" data-preset="ten">${esc(t('dl_ten_min'))}</button>
    </div>
    <p class="dl-summary" id="dl-summary"></p>`
  refreshRange()
}

function timeRow(which, label, max) {
  return `
    <div class="dl-time">
      <div class="dl-time-head">
        <span class="dl-label">${esc(label)}</span>
        <button type="button" data-step="${which}:-60">−1 min</button>
        <b id="dl-${which}-text"></b>
        <button type="button" data-step="${which}:60">+1 min</button>
      </div>
      <input type="range" id="dl-${which}" min="0" max="${max}" step="1">
    </div>`
}

/** Au moins 10 s entre le début et la fin : déplacer l'un pousse l'autre. */
function setRange(which, value) {
  const d = setup.duration
  if (!d) return
  if (which === 'start') {
    setup.start = Math.max(0, Math.min(value, d - 10))
    if (setup.end < setup.start + 10) setup.end = Math.min(d, setup.start + 10)
  } else {
    setup.end = Math.max(10, Math.min(value, d))
    if (setup.start > setup.end - 10) setup.start = Math.max(0, setup.end - 10)
  }
  refreshRange()
}

function applyPreset(p) {
  const d = setup.duration
  const here = Math.min(Math.floor(ctx.position), d - 10)
  if (p === 'all') { setup.start = 0; setup.end = d }
  if (p === 'here') { setup.start = Math.max(0, here); setup.end = d }
  if (p === 'ten') { setup.start = Math.max(0, here); setup.end = Math.min(d, setup.start + 600) }
  refreshRange()
}

function refreshRange() {
  for (const which of ['start', 'end']) {
    const input = $(`#dl-${which}`)
    if (!input) return
    if (Number(input.value) !== Math.round(setup[which])) input.value = String(Math.round(setup[which]))
    $(`#dl-${which}-text`).textContent = formatClock(setup[which])
  }
  const length = Math.max(0, setup.end - setup.start)
  const size = estimateBytes(setup.quality) * length
  $('#dl-summary').textContent = t('dl_summary', { d: formatClock(length), s: formatBytes(size) })
  const tooBig = !canStream && size > MEMORY_LIMIT
  const warn = $('#dl-warn')
  warn.hidden = !tooBig
  warn.textContent = tooBig ? t('dl_too_big') : ''
  $('#dl-go').disabled = tooBig || length < 10
}

// ── Téléchargement ───────────────────────────────────────────────────────
async function start() {
  const plan = setup.plans.get(setup.quality)
  if (!plan || job?.state === 'running') return
  const from = Math.floor(setup.start)
  const to = Math.ceil(setup.end)
  const segs = plan.segments.filter((s) => s.end > from && s.start < to)
  if (!segs.length) return
  const ext = plan.map ? 'mp4' : 'ts'
  const mime = plan.map ? 'video/mp4' : 'video/mp2t'
  const name = fileName(ext, from, to)

  // Le choix du fichier d'abord : il doit suivre le clic.
  let writer
  try {
    writer = await makeWriter(name, mime, ext)
  } catch (e) {
    if (e?.name !== 'AbortError') toast(t('dl_failed_msg'), 'error')
    return
  }

  const controller = new AbortController()
  job = {
    name, total: segs.length + (plan.map ? 1 : 0), done: 0, bytes: 0, restored: 0, muted: 0,
    skipped: 0, skippedCount: 0, offRelay: false,
    state: 'running', controller, error: null,
  }
  renderProgress(true)
  try {
    if (plan.map) await writer.write(await fetchPart(plan.map, controller.signal))
    if (plan.map) job.done++
    await fetchAll(segs, setup.restore, writer, controller.signal)
    // Rien de la VOD n'existe plus sur le CDN : pas de fichier vide.
    if (job.skippedCount === segs.length) throw new Error('segments absents')
    await writer.close()
    job.state = 'done'
    toast(t(job.skipped > 0 ? 'dl_done_gaps' : 'dl_done_notif', { d: formatClock(job.skipped) }), 'success')
  } catch (e) {
    job.state = controller.signal.aborted ? 'cancelled' : 'failed'
    job.error = e?.tooBig ? 'too-big' : null
    // Les segments encore en route s'arrêtent avec lui.
    controller.abort()
    try { await writer.abort() } catch {}
    if (job.state === 'failed') toast(t(job.error === 'too-big' ? 'dl_too_big' : 'dl_failed_msg'), 'error')
  }
  renderProgress()
}

/** Quatre segments à la fois, écrits dans l'ordre. Son d'origine des
 *  passages coupés essayé d'abord ; après trois refus sans un succès (VOD
 *  trop ancienne : originaux effacés), on n'essaie plus. */
async function fetchAll(segs, restore, writer, signal) {
  const ready = new Map()
  const tries = { ok: 0, fails: 0, off: !restore }
  let next = 0
  let written = 0
  let failure = null

  const one = async (i) => {
    const s = segs[i]
    if (s.original && !tries.off) {
      try {
        const part = await fetchPart(s.original, signal, { retries: 0 })
        tries.ok++
        job.restored += s.duration
        return part
      } catch (e) {
        if (signal.aborted) throw e
        if (++tries.fails >= 3 && !tries.ok) tries.off = true
      }
    }
    if (s.original) job.muted += s.duration
    try {
      return await fetchPart(s.url, signal)
    } catch (e) {
      // Segment purgé du CDN (404, 410) : sauté, et dit à la fin. Tout le
      // fichier était perdu, parfois après des Go.
      if (signal.aborted || (e.status !== 404 && e.status !== 410)) throw e
      job.skipped += s.duration
      job.skippedCount++
      return null
    }
  }

  await new Promise((resolve, reject) => {
    let running = 0
    const flush = async () => {
      while (!failure && ready.has(written)) {
        const part = ready.get(written)
        ready.delete(written)
        written++
        // Segment sauté (null) : rien à écrire.
        if (part) {
          await writer.write(part)
          job.bytes += part.size
        }
        job.done++
        renderProgress()
        // Assemblé en mémoire : arrêté, avec un message, passé la marge.
        if (!canStream && job.bytes > MEMORY_HARD_LIMIT) throw Object.assign(new Error('trop gros'), { tooBig: true })
      }
    }
    let writing = Promise.resolve()
    const pump = () => {
      if (failure) return
      if (written === segs.length && running === 0) return resolve()
      // Pas trop d'avance sur l'écriture : la mémoire reste bornée.
      while (running < CONCURRENCY && next < segs.length && next - written < CONCURRENCY * 3) {
        const i = next++
        running++
        one(i).then((buf) => {
          running--
          ready.set(i, buf)
          writing = writing.then(flush).then(pump, (e) => { failure = e; reject(e) })
        }, (e) => {
          running--
          failure = e
          reject(e)
        })
      }
    }
    pump()
  })
}

/** Un segment, avec trois essais pour une erreur réseau (aucun pour un refus).
 *  En Blob plutôt qu'en ArrayBuffer : le navigateur le garde hors de la
 *  mémoire de la page (sur le disque au besoin pour Chrome), et le fichier
 *  final les réunit sans les recopier — le pic à deux fois la taille de la
 *  vidéo, au moment d'assembler, faisait planter les téléphones. */
async function fetchPart(url, signal, opts = {}) {
  // Relais déjà tombé pendant ce téléchargement : directement par le Worker.
  if (job?.offRelay) url = offRelay(url) ?? url
  try {
    return await fetchTries(url, signal, opts)
  } catch (e) {
    // Relais vidéo injoignable (erreur réseau, pas un refus) : le même
    // segment par le Worker, et les suivants aussi.
    const alt = signal.aborted || e.status !== undefined ? null : offRelay(url)
    if (!alt) throw e
    if (job) job.offRelay = true
    return fetchTries(alt, signal, opts)
  }
}

async function fetchTries(url, signal, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal })
      if (res.ok) return await res.blob()
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    } catch (e) {
      if (signal.aborted || [403, 404, 410].includes(e.status) || attempt >= retries) throw e
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}

/** Adresse passée par le relais vidéo → la même par un Worker ; null sinon. */
function offRelay(url) {
  if (!RELAY_BASE || !url || proxyBaseOf(url) !== RELAY_BASE) return null
  const moved = withoutRelay({ u: url }).u
  return moved !== url ? moved : null
}

async function makeWriter(name, mime, ext) {
  if (canStream) {
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: 'Video', accept: { [mime]: [`.${ext}`] } }],
    })
    const w = await handle.createWritable()
    return { write: (part) => w.write(part), close: () => w.close(), abort: () => w.abort() }
  }
  // Ailleurs, les segments (des Blobs) sont gardés jusqu'à la fin.
  const parts = []
  return {
    write: async (part) => { parts.push(part) },
    close: async () => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob(parts, { type: mime }))
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      parts.length = 0
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
    },
    abort: async () => { parts.length = 0 },
  }
}

/** Progression : la feuille est ouverte si `force` (bouton, départ du
 *  téléchargement), sinon seulement mise à jour si elle est là. */
function renderProgress(force = false) {
  if (!job) return
  const sheet = $('#sheet')
  if (force && (sheet.hidden || !$('#dl-progress'))) {
    hooks.openSheet(`
      <div class="sheet-head"><h2>${esc(t('dl_title'))}</h2><button class="icon-btn" type="button" data-sheet-close>${icon('x', 20)}</button></div>
      <p class="muted sheet-sub dl-vod">${esc(job.name)}</p>
      <div id="dl-progress"></div>`)
    sheet.onclick = (e) => {
      if (e.target.closest('[data-sheet-close]')) return hooks.closeSheet()
      if (e.target.closest('#dl-cancel')) job?.controller.abort()
      if (e.target.closest('#dl-again') && ctx) open(ctx)
    }
  }
  const box = $('#dl-progress')
  if (!box) return
  const ratio = job.total ? job.done / job.total : 0
  const state = job.state === 'running' ? `${Math.round(ratio * 100)} % · ${formatBytes(job.bytes)}`
    : job.state === 'done' ? t('dl_done_notif')
    : job.state === 'cancelled' ? t('dl_cancelled') : t(job.error === 'too-big' ? 'dl_too_big' : 'dl_failed_msg')
  const sound = [
    job.restored > 0 ? t('dl_restored', { d: formatClock(job.restored) }) : '',
    job.muted > 0 ? t('dl_muted', { d: formatClock(job.muted) }) : '',
    job.skipped > 0 ? t('dl_skipped', { d: formatClock(job.skipped) }) : '',
  ].filter(Boolean).join(' · ')
  box.innerHTML = `
    <div class="dl-bar"><span style="width:${(ratio * 100).toFixed(1)}%"></span></div>
    <p class="dl-state">${esc(state)}</p>
    ${sound ? `<p class="muted small">${esc(sound)}</p>` : ''}
    ${job.state === 'running'
      ? `<button class="btn ghost full" type="button" id="dl-cancel">${icon('x', 16)}<span>${esc(t('cancel'))}</span></button>`
      : `<button class="btn ghost full" type="button" id="dl-again">${icon('download', 16)}<span>${esc(t('dl_another'))}</span></button>`}`
}

// ── Outils ───────────────────────────────────────────────────────────────
/** Qualités téléchargeables : « Auto » est une playlist maître, pas une vidéo. */
const qualitiesOf = (links) => sortQualities(Object.keys(links)).filter((q) => q.toLowerCase() !== 'auto')

async function fetchPlan(playlistUrl) {
  const res = await fetch(playlistUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.startsWith('#EXTM3U')) throw new Error('not a playlist')
  return parsePlan(text, playlistUrl)
}

/** Segments d'une playlist de VOD, avec leur instant de début. */
function parsePlan(text, playlistUrl) {
  const abs = (u) => fixProxiedUrl(new URL(u, playlistUrl).href, playlistUrl)
  const segments = []
  let clock = 0
  let pending = 0
  let map = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF:')) { pending = parseFloat(line.slice(8)) || 0; continue }
    if (line.startsWith('#EXT-X-MAP:')) {
      const m = /URI="([^"]+)"/.exec(line)
      if (m) map = abs(m[1])
      continue
    }
    if (!line || line.startsWith('#')) continue
    const url = abs(line)
    // « N-muted.ts », ou « N-muted.mp4 » pour les VODs en fMP4. Mais
    // « N-unmuted.mp4 » a le son d'origine (sondé sur 19 VODs ; « N.mp4 » est
    // refusé) : pris tel quel, il n'était remplacé que par du silence.
    const muted = /-(un)?muted\.(ts|mp4)/.test(url) && !/-unmuted\.mp4/.test(url)
    segments.push({
      // « -unmuted.ts » n'existe pas sur le CDN : la version muette sert de repli.
      url: muted ? url.replace(/-(un)?muted\.(ts|mp4)/, '-muted.$2') : url,
      original: muted ? url.replace(/-(un)?muted\.(ts|mp4)/, '.$2') : null,
      start: clock,
      end: clock + pending,
      duration: pending,
    })
    clock += pending
    pending = 0
  }
  return { segments, map, duration: clock }
}

/** Débit approximatif d'une qualité, en octets par seconde. */
function estimateBytes(q) {
  const s = String(q).toLowerCase()
  if (s.includes('audio')) return 160e3 / 8
  if (s.includes('source') || s === 'chunked') return 7e6 / 8
  const m = /(\d+)p(\d+)?/.exec(s)
  if (!m) return 3e6 / 8
  const h = Number(m[1])
  const base = h >= 1080 ? 6e6 : h >= 720 ? 3e6 : h >= 480 ? 1.4e6 : h >= 360 ? 0.7e6 : 0.3e6
  return (Number(m[2] || 30) >= 50 ? base * 1.35 : base) / 8
}

function formatBytes(n) {
  const [v, unit] = n >= 1e9 ? [n / 1e9, 'gigabyte'] : [n / 1e6, 'megabyte']
  try {
    return new Intl.NumberFormat(lang(), { style: 'unit', unit, maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)
  } catch {
    return `${v.toFixed(1)} ${unit === 'gigabyte' ? 'GB' : 'MB'}`
  }
}

function fileName(ext, from, to) {
  const clean = (s) => String(s || '').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60)
  const hms = (x) => formatClock(x).replace(/:/g, '-')
  return [clean(ctx.streamer), clean(ctx.title), `${hms(from)}_${hms(to)}`, clean(qualityLabel(setup.quality))]
    .filter(Boolean).join('_') + `.${ext}`
}
