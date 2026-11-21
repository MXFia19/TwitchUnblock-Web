// Vérifications des retours du 21/11, sans réseau ni navigateur :
//  - relais bloqués chez le spectateur (api.js, relaysBlocked) : les deux
//    relais muets alors qu'un Worker répond (listes « DNS dynamique » de
//    uBlock, NextDNS…) → signalé et tous deux écartés ; un seul muet, ou un
//    délai dépassé, n'est pas un blocage ;
//  - segments d'un direct « bg » par le relais quand le CDN est bloqué :
//    par le relais principal, plus par le Worker (player.js) ;
//  - délai ajouté par la chaîne (Player.channelDelay), lu dans la playlist ;
//  - TV LG : plusieurs comptes (webos/src/auth.js) et session web d'un autre
//    compte refusée (webos/src/websession.js), comme l'app iPhone ;
//  - le site, l'app TV et les textes branchés (Source seule, tags masqués,
//    avis), SITE_VERSION, les nouveautés et la version de l'app TV.
// api.js est importé avec un faux navigateur et un faux fetch : aucune
// requête ne part.
// Lancer : node tools/retours-2111-check.mjs (Node 22 ou plus).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8').replace(/\r\n/g, '\n')

const RELAY = 'https://relais.mxfia19.duckdns.org'
const SOFIA = 'https://2-58-32-226.sslip.io'
const tick = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => { for (let i = 0; i < 20; i++) await tick() }

// ── Faux navigateur ───────────────────────────────────────────────────────
const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => { storage.set(k, String(v)) },
  removeItem: (k) => { storage.delete(k) },
  key: (i) => [...storage.keys()][i] ?? null,
  get length() { return storage.size },
}
const events = []
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent(e) { events.push(e.type); return true } }
let reloads = 0
globalThis.location = { reload() { reloads++ } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Comportement du faux réseau : 'ok' (tout répond), 'blocked' (les deux
 *  relais muets), 'sofia-ok' (seul le relais principal muet), 'timeout'
 *  (le relais principal ne répond jamais). */
let net = 'ok'
const sent = []
const accounts = { tokA: { id: '111', login: 'alice', display_name: 'Alice' }, tokB: { id: '222', login: 'bob', display_name: 'Bob' } }
let gqlUser = null
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  sent.push({ url: url.href, init })
  const relayHit = url.origin === RELAY || url.origin === SOFIA
  if (relayHit && (net === 'blocked' || (net === 'sofia-ok' && url.origin === RELAY))) throw new TypeError('Failed to fetch')
  if (relayHit && net === 'timeout' && url.origin === RELAY) {
    // Comme un serveur qui ne répond jamais : coupé par l'AbortController.
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  }
  if (url.pathname === '/health') return json({ relay: 'ok' })
  if (url.hostname === 'id.twitch.tv' && url.pathname === '/oauth2/token') return json({ access_token: 'tokB', refresh_token: 'rB' })
  if (url.hostname === 'id.twitch.tv' && url.pathname === '/oauth2/revoke') return json({})
  if (url.hostname === 'api.twitch.tv' && url.pathname === '/helix/users') {
    const token = String(init.headers?.Authorization || '').replace(/^Bearer /, '')
    return json({ data: accounts[token] ? [accounts[token]] : [] })
  }
  if (url.hostname === 'gql.twitch.tv') return json({ data: { currentUser: gqlUser } })
  return json({})
}

// Instance par défaut d'api.js (celle de player.js), réseau sain.
const api = await import('../public/assets/js/api.js')
const { Player, liveRequestUrl } = await import('../public/assets/js/player.js')
await settle()

/** Une instance neuve d'api.js, chargée avec ce réseau (checkRelay tourne au
 *  chargement). */
let n = 0
async function freshApi(mode) {
  net = mode
  events.length = 0
  storage.delete('tu_worker_down')
  const mod = await import(`../public/assets/js/api.js?n=${++n}`)
  await settle()
  return mod
}

test('relais bloqués : les deux relais muets, un Worker qui répond', async () => {
  const a = await freshApi('blocked')
  assert.equal(a.relaysBlocked(), true)
  assert.deepEqual(events, ['tu-relays-blocked'])
  assert.deepEqual(a.relayHosts(), ['relais.mxfia19.duckdns.org', '2-58-32-226.sslip.io'])
  // Écartés tous les deux : la lecture va droit au Worker, sans essayer Sofia.
  assert.ok(!a.relayFallback().includes('sslip.io'), 'pas le relais de Sofia')
  assert.ok(a.relayFallback().endsWith('.workers.dev'))
  net = 'ok'
})

test('relais bloqués : un seul muet ou un délai dépassé n’en est pas un', { timeout: 20_000 }, async () => {
  const one = await freshApi('sofia-ok')
  assert.equal(one.relaysBlocked(), false, 'Sofia répond : une vraie panne du principal')
  assert.deepEqual(events, [])
  assert.equal(one.relayFallback(), SOFIA, 'Sofia prend la suite, comme avant')
  const slow = await freshApi('timeout')
  await new Promise((r) => setTimeout(r, 8_300))
  await settle()
  assert.equal(slow.relaysBlocked(), false, 'pas de réponse en 8 s : panne, pas blocage')
  net = 'ok'
})

test('CDN bloqué, direct « bg » : segments par le relais principal, plus par le Worker', () => {
  storage.delete('tu_worker_down')
  storage.set('tu_segment_proxy', String(Date.now() + 86_400_000))
  try {
    const seg = 'https://7dba300ff494.j.cloudfront.hls.ttvnw.net/v1/segment/abc.ts'
    const sofiaPlaylist = `${SOFIA}/api/proxy?url=${encodeURIComponent('https://euc13.playlist.ttvnw.net/v1/playlist/x.m3u8')}&isVod=false`
    const u = new URL(liveRequestUrl(seg, sofiaPlaylist))
    assert.equal(u.origin, RELAY)
    assert.equal(u.pathname, '/api/proxy')
    assert.equal(u.searchParams.get('url'), seg)
    // Playlist du relais principal : inchangé.
    const relayPlaylist = sofiaPlaylist.replace(SOFIA, RELAY)
    assert.equal(new URL(liveRequestUrl(seg, relayPlaylist)).origin, RELAY)
  } finally {
    storage.delete('tu_segment_proxy')
  }
  // CDN joignable : le segment reste en direct.
  const seg = 'https://7dba300ff494.j.cloudfront.hls.ttvnw.net/v1/segment/abc.ts'
  assert.equal(liveRequestUrl(seg, `${SOFIA}/api/proxy?url=x&isVod=false`), seg)
})

test('délai de la chaîne : lu dans la playlist, arrondi à 5 s, 10 s au moins', () => {
  const at = Date.parse('2026-11-21T04:30:00Z')
  const frags = (edgeAgeMs, prefetch = false) => {
    const end = at - edgeAgeMs
    const list = [0, 1, 2].map((i) => ({ programDateTime: end - (3 - i) * 2000, duration: 2 }))
    if (prefetch) list.push({ programDateTime: at + 500, duration: 2 })
    return list
  }
  const fake = (fragments, extra = {}) => ({ kind: 'live', hls: { currentLevel: 0, levels: [{ details: { live: true, advancedDateTime: at, fragments, ...extra } }] } })
  const delay = (f) => Player.prototype.channelDelay.call(f)
  assert.equal(delay(fake(frags(300))), 0, 'sans délai : le dernier segment vient de finir')
  assert.equal(delay(fake(frags(31_200))), 30)
  assert.equal(delay(fake(frags(61_000), true)), 60, 'segment annoncé d’avance ignoré')
  assert.equal(delay(fake(frags(8_000))), 0, 'sous 10 s : rien (horloge un peu décalée)')
  assert.equal(delay({ ...fake(frags(31_200)), kind: 'vod' }), 0)
  assert.equal(delay(fake(frags(31_200), { live: false })), 0)
  assert.equal(delay({ kind: 'live', hls: null }), 0)
})

// ── TV LG : comptes et session web ────────────────────────────────────────
const userA = { id: '111', login: 'alice', name: 'Alice', avatar: '' }
const wsA = { token: 'w'.repeat(30), login: 'alice', userId: '111', displayName: 'Alice', sentAt: null, at: 1, checkedAt: Date.now(), expired: false }
storage.set('twitch_token', 'tokA')
storage.set('tu_tv_user', JSON.stringify(userA))
storage.set('tu_tv_refresh', JSON.stringify('rA'))
storage.set('tu_tv_websession', JSON.stringify(wsA))
const auth = await import('../webos/src/auth.js')
const ws = await import('../webos/src/websession.js')

test('TV : session web d’un autre compte refusée à l’arrivée', () => {
  const before = storage.get('tu_tv_websession')
  assert.equal(ws.saveWebSession({ token: 'x'.repeat(30), login: 'Mallory', userId: '999', displayName: 'Mallory' }), false)
  assert.deepEqual(ws.mismatch, { web: 'Mallory', account: 'Alice' })
  assert.equal(storage.get('tu_tv_websession'), before, 'rien de gardé')
  // Sans identifiant (l'iPhone n'a pas pu le lire) : le pseudo suffit.
  assert.equal(ws.saveWebSession({ token: 'x'.repeat(30), login: 'mallory', userId: '' }), false)
})

test('TV : la bonne session est gardée, puis oubliée si Twitch la dit d’un autre compte', async () => {
  gqlUser = { id: '111', login: 'alice', displayName: 'Alice' }
  assert.equal(ws.saveWebSession({ token: 'y'.repeat(30), login: 'alice', userId: '' }), true)
  assert.equal(ws.mismatch, null)
  await settle()
  assert.equal(ws.webSession?.userId, '111', 'identifiant relu chez Twitch')
  assert.equal(ws.refuseIfOtherAccount(), false)
  // Relue plus tard : c'était un autre compte (cookie changé sur l'iPhone).
  gqlUser = { id: '999', login: 'mallory', displayName: 'Mallory' }
  await ws.checkWebSession({ force: true })
  assert.equal(ws.webSession, null, 'oubliée')
  assert.equal(storage.get('tu_tv_websession'), undefined)
  assert.equal(ws.mismatch?.web, 'Mallory')
  // On remet celle d'Alice pour la suite.
  gqlUser = { id: '111', login: 'alice', displayName: 'Alice' }
  ws.saveWebSession({ token: 'w'.repeat(30), login: 'alice', userId: '111', displayName: 'Alice' })
  await settle()
})

test('TV : se connecter avec un autre compte range l’actif avec sa session', { timeout: 15_000 }, async () => {
  assert.equal(auth.user?.id, '111')
  const code = { deviceCode: 'dc', userCode: 'ABCD', uri: 'https://www.twitch.tv/activate', interval: 1, expiresAt: Date.now() + 60_000 }
  const r = await auth.waitForApproval(code, () => false)
  assert.equal(r, 'switched')
  assert.equal(auth.user?.id, '222')
  assert.equal(storage.get('twitch_token'), 'tokB')
  const saved = auth.savedAccounts()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].user.id, '111')
  assert.equal(saved[0].token, 'tokA')
  assert.equal(saved[0].refresh, 'rA')
  assert.equal(saved[0].ws?.login, 'alice', 'sa session web part avec lui')
  assert.equal(storage.get('tu_tv_websession'), undefined, 'pas celle d’Alice pour Bob')
})

test('TV : passer à un compte rangé, puis en retirer un', () => {
  const before = reloads
  assert.equal(auth.switchAccount('111'), true)
  assert.equal(reloads, before + 1, 'l’app redémarre')
  assert.equal(storage.get('twitch_token'), 'tokA')
  assert.equal(JSON.parse(storage.get('tu_tv_user')).id, '111')
  assert.equal(JSON.parse(storage.get('tu_tv_refresh')), 'rA')
  assert.equal(JSON.parse(storage.get('tu_tv_websession')).login, 'alice', 'sa session revient')
  const saved = auth.savedAccounts()
  assert.deepEqual(saved.map((a) => a.user.id), ['222'], 'Bob rangé à son tour')
  assert.equal(auth.switchAccount('333'), false, 'compte inconnu')
  sent.length = 0
  auth.removeAccount('222')
  assert.deepEqual(auth.savedAccounts(), [])
  assert.ok(sent.some((s) => s.url.endsWith('/oauth2/revoke')), 'jeton révoqué chez Twitch')
})

// ── Branchements ──────────────────────────────────────────────────────────
test('site : Source seule, délai, relais bloqués, tags masqués', () => {
  const main = read('public/assets/js/main.js')
  assert.match(main, /if \(!hq && sourceOnly\(play\.links\)\) player\.setQualityNote\(\{ text: t\('q_source_only'\), action: null \}\)/)
  assert.match(main, /onChannelDelay: \(s\) => noteChannelDelay\(s\)/)
  assert.match(main, /window\.addEventListener\('tu-relays-blocked', tellRelaysBlocked\)/)
  assert.equal((main.match(/tellRelaysBlocked\(\)\n/g) || []).length, 2, 'au direct et à la VOD')
  assert.match(main, /const PREFS_COMMON = \[[^\]]*'hiddenTags'\]/)
  assert.match(main, /const PREFS_COMMON_ADDED = \[[^\]]*'hiddenTags'\]/)
  assert.match(main, /hiddenTags: \(v\) => \(Array\.isArray\(v\) \? cleanTags\(v\) : undefined\)/)
  assert.match(main, /const showsStream = \(s\) => followedOrPinned\(s\.login\) \|\| \(!isChannelHidden\(s\.login\) && !hasHiddenTag\(s\)/)
  assert.match(main, /cat\.streams\.filter\(showsCatStream\)/)
  assert.match(main, /\/\^\[\\p\{L\}\\p\{N\}\]\{1,25\}\$\/u/)
  const player = read('public/assets/js/player.js')
  assert.match(player, /if \(note\.label\) html \+=/)
  assert.match(player, /if \(relaysBlocked\(\)\) html \+=/)
})

test('textes : les cinq langues du site et de la TV', () => {
  const keys = ['q_source_only', 'channel_delay_note', 'channel_delay_toast', 'relays_blocked', 'relays_blocked_menu', 'hidden_tags', 'hidden_tags_sub', 'hide_tag', 'hidden_tag_done']
  const i18n = read('public/assets/js/i18n.js')
  for (const k of keys) assert.equal((i18n.match(new RegExp(`\\b${k}: '`, 'g')) || []).length, 3, `${k} en fr, en, es`)
  for (const f of ['public/assets/js/i18n-ru.js', 'public/assets/js/i18n-zh-Hant.js']) {
    const s = read(f)
    for (const k of keys) assert.match(s, new RegExp(`\\b${k}: '`), `${k} dans ${f}`)
  }
  const tv = read('webos/src/strings.js')
  for (const k of ['tv_add_account', 'tv_other_accounts', 'tv_switch_to', 'tv_remove_account', 'tv_switching', 'tv_account_removed', 'tv_ws_mismatch']) {
    assert.equal((tv.match(new RegExp(`\\b${k}: '`, 'g')) || []).length, 5, `${k} dans les 5 langues de la TV`)
  }
})

test('TV : branchements du lecteur, des réglages et de la connexion', () => {
  const watch = read('webos/src/watch.js')
  assert.match(watch, /onChannelDelay: \(s\) => noteChannelDelay\(s\)/)
  assert.equal((watch.match(/tellRelaysBlocked\(\)\n/g) || []).length, 2)
  assert.match(watch, /function openPanel\(title, items, onPick, note = ''\)/)
  const settings = read('webos/src/screens/settings.js')
  assert.match(settings, /data-act="add-account"/)
  assert.match(settings, /switchAccount\(b\.dataset\.switch\)/)
  const login = read('webos/src/screens/login.js')
  assert.match(login, /result === 'switched'/)
  const pair = read('webos/src/screens/pair.js')
  assert.match(pair, /if \(!saveWebSession\(r\.session\)\)/)
  assert.match(read('webos/src/main.js'), /onAuthChange\(\(\) => \{ refuseIfOtherAccount\(\);/)
})

test('version du site, nouveautés et app TV', () => {
  const usage = read('public/assets/js/usage.js')
  const v = usage.match(/SITE_VERSION = '([\d.]+[a-z])'/)?.[1]
  assert.ok(v && v >= '2026.11.21a', `SITE_VERSION ${v}`)
  assert.match(read('public/assets/js/changelog.js'), /'2026\.11\.21a'/)
  const [maj, min, pat] = JSON.parse(read('webos/appinfo.json')).version.split('.').map(Number)
  assert.ok(maj > 0 || min > 4 || (min === 4 && pat >= 3), 'app TV 0.4.3 ou plus')
})
