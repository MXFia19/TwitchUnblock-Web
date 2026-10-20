"use strict";

// ---------------------------------------------------------------------------
// TwitchUnblock Connect — arrière-plan (étape 1)
//
// Un seul fichier, chargé comme script classique : service worker sous
// Chrome / Edge / Brave, page d'événements sous Firefox. Il peut être arrêté
// à tout moment (environ 30 s sans événement) : aucune minuterie longue, et
// ce qui doit survivre à un arrêt (limites de débit, jeton d'intégrité,
// dernière prédiction vue) vit dans storage.session (mémoire du navigateur,
// jamais sur disque, fermé aux content scripts).
//
// Le site ne peut demander que la LISTE FERMÉE de PROTOCOL.md. La session
// Twitch (cookie auth-token, relu à chaque usage) et le jeton Client-Integrity
// ne sortent jamais d'ici : ni vers la page, ni vers le content script, ni
// dans un journal, ni dans un message d'erreur.
//
// Requêtes GQL reprises de l'app iOS (ChannelPointsService.swift,
// LiveEventsService.swift, TwitchGQL.swift, TwitchWebGQL.swift) : mêmes
// persisted queries (hashes), mêmes variables, mêmes en-têtes.
// ---------------------------------------------------------------------------

const api = globalThis.browser || globalThis.chrome;

const PROTOCOL = 1;
const VERSION = api.runtime.getManifest().version;
const EXTENSION_BASE = api.runtime.getURL("");
const BROWSER = EXTENSION_BASE.startsWith("moz-extension:") ? "firefox" : "chrome";

// Origines du site autorisées (PROTOCOL.md) : rien d'autre.
const SITE_ORIGINS = [
  "https://twitchunblock.vercel.app",
  "https://test2-git-test-17d298-mxfia19s-projects.vercel.app"
];

const TWITCH_WWW = "https://www.twitch.tv";
const GQL_URL = "https://gql.twitch.tv/gql";
const VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
// Client-ID public du site twitch.tv (dans son JS, pas un secret), le même que les apps.
const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

// Persisted queries de l'app iOS, à l'identique. Seule exception : JoinRaid,
// absente de l'app (hash du projet libre TwitchChannelPointsMiner, NON vérifié).
const HASH = {
  claim: "46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0",             // ClaimCommunityPoints
  streaks: "7d04fbaa5bb32d193c742caa2c855dfde371a2a8cb25afed5b5c3d45f5ee9278",           // BatchGetWatchStreaks
  predictionContext: "beb846598256b75bd7c1fe54a80431335996153e358ca9c7837ce7bb83d7d383", // ChannelPointsPredictionContext
  makePrediction: "b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8",    // MakePrediction
  viewablePoll: "e83188a3836c636393df3191665e543a03733d7c51d3ade3d85e42aa46c2bf55",      // ChannelPollContext_GetViewablePoll
  voteInPoll: "1280e27b0f3c7ae60b5714bd569771ea50635778473182e6e959e2dcfcc16e3c",        // ChannelPollContext_VoteInPoll
  dropsClaim: "a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930",        // DropsPage_ClaimDropRewards (Drops.swift)
  joinRaid: "c6a332a86d1087fbbb1a8623aa01bd1313d2386e7c63be60fdb2d1901f01a4ae"           // JoinRaid (non vérifié)
};

// Requêtes GQL en clair. Celles de l'app iOS, avec le login en variable au
// lieu d'être recopié dans le texte (même requête pour Twitch). N'existent
// pas côté iOS : `pointsLook` (nom et icône des points), `rewardCooldowns`
// (fin de recharge des récompenses) et `joinRaid` (repli si Twitch ne
// connaît pas le hash de JoinRaid).
const DROP_CAMPAIGN_FIELDS =
  "id name status startAt endAt accountLinkURL self { isAccountConnected } " +
  "game { displayName boxArtURL(width: 144, height: 192) }";
const Q = {
  points: "query($l: String!) { channel(name: $l) { id self { communityPoints { balance availableClaim { id } } } } }",
  pointsLook: "query($l: String!) { channel(name: $l) { communityPointsSettings { name image { url2x } } } }",
  stream: "query($l: String!) { user(login: $l) { stream { id } } }",
  predictionSelf: "query($l: String!) { channel(name: $l) { activePredictionEvents { id self { prediction { points outcome { id } } } } lockedPredictionEvents { id self { prediction { points outcome { id } } } } } }",
  predictionResolved: "query($l: String!) { channel(name: $l) { resolvedPredictionEvents(first: 3) { edges { node { id winningOutcome { id } } } } } }",
  joinRaid: "mutation JoinRaid($input: JoinRaidInput!) { joinRaid(input: $input) { raidID } }",
  // Drops.swift : dropsChannelId, refresh (inventaire), refreshAvailable
  // (tableau de bord), refreshSession ; TwitchAPI.swift : accountPlaybackToken.
  dropsChannel: "query($l: String!) { user(login: $l) { id channel { viewerDropCampaigns { id } } } }",
  dropsInventory: "query { currentUser { inventory { dropCampaignsInProgress { " + DROP_CAMPAIGN_FIELDS +
    " timeBasedDrops { id name requiredMinutesWatched benefitEdges { benefit { name imageAssetURL } }" +
    " self { hasPreconditionsMet currentMinutesWatched isClaimed dropInstanceID } } } } } }",
  dropsDashboard: "query { currentUser { dropCampaigns { " + DROP_CAMPAIGN_FIELDS +
    " timeBasedDrops { id name requiredMinutesWatched benefitEdges { benefit { name imageAssetURL } } } } } }",
  dropsSession: "query($c: ID!) { currentUser { dropCurrentSession(channelID: $c) { channel { displayName } currentMinutesWatched requiredMinutesWatched dropID } } }",
  playbackToken: "query($l: String!) { streamPlaybackAccessToken(channelName: $l, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: \"site\"}) { value signature } }",
  // ChannelPointsService.fetchRewards.
  rewards: "query($l: String!) { channel(name: $l) { communityPointsSettings { isEnabled customRewards { " +
    "id title cost isEnabled isPaused isInStock isUserInputRequired prompt backgroundColor " +
    "image { url2x } defaultImage { url2x } } } } }",
  rewardCooldowns: "query($l: String!) { channel(name: $l) { communityPointsSettings { customRewards { id cooldownExpiresAt } } } }"
};

const LIMIT = {
  readMs: 3000,              // lectures : une requête Twitch par 3 s, par chaîne et par sorte
  claimMs: 10000,            // points.claim et coffre automatique : 1 par 10 s
  beatMs: 50000,             // watch.beat : 1 par 50 s et par chaîne
  spendMs: 3000,             // paris et votes : 1 par 3 s
  spendSendMs: 30000,        // dépense envoyée à Twitch au plus 30 s après la demande : avec sa
                             // requête (12 s au plus), la réponse arrive avant les 45 s du site
  raidMs: 30000,             // raid.join : 1 par 30 s et par chaîne
  raidKeepMs: 3600000,       // réponse gardée par raid : 1 h
  dropsClaimMs: 5000,        // drops.claim : 1 par 5 s
  pulseMs: 8000,             // drops.pulse : 1 par 8 s et par chaîne
  inventoryMs: 10000,        // inventaire des drops (un pour toutes les chaînes)
  dropsChannelMs: 600000,    // campagnes de la chaîne relues toutes les 10 min, comme l'app
  pulseInventoryMs: 300000,  // drops réclamables cherchés toutes les 5 min, comme l'app
  pulseRetryMs: 60000,       // jeton de lecture refusé plusieurs fois : une minute d'attente
  pulseClaimWaitMs: 6000,    // réclamation attendue au plus 6 s, sinon donnée au battement suivant
  perMinute: 60,             // tout confondu
  streakMs: 60000,           // séries de visionnage (une requête pour toutes les chaînes) : 1 min
  lookMs: 600000,            // nom et icône des points : 10 min
  userMs: 900000,            // validation de la session : 15 min
  spadeMs: 1800000,          // adresse du spade : 30 min
  resolvedKeepMs: 180000,    // prédiction terminée encore donnée 3 min
  fetchMs: 12000,            // délai d'une requête
  mintBudgetMs: 38000,       // obtention du jeton d'intégrité, en tout
  tabLoadMs: 15000,          // chargement de l'onglet temporaire
  warmMs: 3000,              // temps laissé au script anti-robots de Twitch (comme les apps)
  mintBackoffMs: 30000,      // après un échec : pas de nouvel essai avant 30 s (demande du site)
  mintBackoffAutoMs: 300000  // ... ni avant 5 min pour le coffre automatique
};

const ERROR_CODES = [
  "disabled", "no_session", "needs_activation", "spend_disabled", "bad_args", "unknown_op",
  "rate_limited", "integrity", "twitch", "offline", "no_claim", "timeout", "internal"
];

const DEFAULT_SETTINGS = { siteEnabled: true, autoClaim: true, allowSpend: true };

const CHANNEL_RE = /^[a-z0-9_]{1,25}$/;
const TWITCH_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const RAID_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DROP_INSTANCE_RE = /^[A-Za-z0-9#._:-]{1,200}$/;
const NUMERIC_ID_RE = /^[0-9]{1,20}$/;
const AUTH_TOKEN_RE = /^[A-Za-z0-9._~-]{8,256}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const INTEGRITY_RE = /^[\x21-\x7e]{16,8192}$/;

// Hôtes acceptés pour le spade (statistiques de Twitch) et pour son fichier de réglages.
const SPADE_HOST_SUFFIXES = ["twitch.tv", "ttvnw.net", "twitchcdn.net", "twitchsvc.net", "jtvnw.net"];

// --- Validation des demandes du site (même code dans content.js) ------------

const OP_ARGS = {
  "hello": {},
  "status": {},
  "points.get": { channel: "channel" },
  "points.claim": { channel: "channel" },
  "watch.beat": { channel: "channel" },
  "predictions.get": { channel: "channel" },
  "predictions.bet": { channel: "channel", eventId: "id", outcomeId: "id", points: "points" },
  "polls.get": { channel: "channel" },
  "polls.vote": { channel: "channel", pollId: "id", choiceId: "id", withPoints: "bool" },
  "raid.join": { channel: "channel", raidId: "raid" },
  "drops.get": { channel: "channel" },
  "drops.claim": { dropInstanceId: "dropInstance" },
  "drops.pulse": { channel: "channel" },
  "rewards.get": { channel: "channel" },
  "rewards.redeem": { channel: "channel", rewardId: "id", cost: "cost", title: "title", prompt: "prompt", input: "input" }
};
const SPEND_OPS = ["predictions.bet", "polls.vote", "rewards.redeem"];

// Longueur en caractères (points de code), pas en unités UTF-16.
function charCount(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

// Rend { args } (copie des seuls champs attendus) ou { bad: "<champ fautif>" }.
function checkArgs(op, raw) {
  const spec = OP_ARGS[op];
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { bad: "args" };
  const keys = Object.keys(raw);
  if (keys.length > 8) return { bad: "args" };
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(spec, k)) return { bad: /^[A-Za-z0-9_]{1,24}$/.test(k) ? k : "args" };
  }
  const args = {};
  for (const k of Object.keys(spec)) {
    const v = raw[k];
    const kind = spec[k];
    const good =
      kind === "channel" ? typeof v === "string" && CHANNEL_RE.test(v) :
      kind === "id" ? typeof v === "string" && TWITCH_ID_RE.test(v) :
      kind === "raid" ? typeof v === "string" && RAID_ID_RE.test(v) :
      kind === "dropInstance" ? typeof v === "string" && DROP_INSTANCE_RE.test(v) :
      kind === "points" ? typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 250000 :
      kind === "cost" ? typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 2147483647 :
      kind === "title" ? typeof v === "string" && v.length >= 1 && v.length <= 200 :
      kind === "prompt" ? v === null || (typeof v === "string" && v.length <= 1000) :
      kind === "input" ? v === null || (typeof v === "string" && v.length <= 800 && charCount(v) >= 1 && charCount(v) <= 200) :
      kind === "bool" ? typeof v === "boolean" :
      false;
    if (!good) return { bad: k };
    args[k] = v;
  }
  return { args };
}

// --- Petits outils ----------------------------------------------------------

class TuError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = ERROR_CODES.includes(code) ? code : "internal";
    this.detail = detail || "";
  }
}

function ok(data) {
  return { ok: true, data };
}

function fail(code, detail) {
  const error = { code: ERROR_CODES.includes(code) ? code : "internal" };
  const message = safeDetail(detail);
  if (message) error.message = message;
  return { ok: false, error };
}

// Texte court et sans secret : tout mot de 25 caractères ou plus (un jeton,
// un identifiant d'appareil) est retiré, puis les caractères inattendus.
function safeDetail(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/[^\s]{25,}/g, "…")
    .replace(/[^A-Za-z0-9 _.:…-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// Code d'erreur renvoyé par Twitch dans une réponse (NOT_ENOUGH_POINTS…).
function safeCode(code) {
  return typeof code === "string" && /^[A-Z0-9_]{1,48}$/.test(code) ? code : "UNKNOWN";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function str(v, max) {
  return typeof v === "string" ? v.slice(0, max) : null;
}

function int(v) {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

function has(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function randomId(length) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (const b of crypto.getRandomValues(new Uint8Array(length))) out += chars[b % chars.length];
  return out;
}

// 32 caractères hexadécimaux (transactionID, voteID), comme l'app iOS.
function hex32() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Utf8(text) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Empreinte courte d'un jeton (lier un cache à une session sans garder le jeton).
async function fingerprint(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Masque pour la fenêtre de l'extension : 4 premiers caractères et longueur.
function mask(token) {
  const s = String(token || "");
  return { head: s.slice(0, 4), len: s.length };
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    return null;
  }
}

function isTwitchPage(url) {
  return typeof url === "string" && url.startsWith(TWITCH_WWW + "/");
}

// --- État de session (storage.session) --------------------------------------

const mem = {
  rl: { global: [], slots: {} }, // limites de débit
  integrity: null,               // { token, deviceId, expiresAt, fp, via }
  mintFail: null,                // { at } dernier échec d'obtention
  mintTab: null,                 // { id, at } onglet temporaire ouvert
  user: null,                    // { fp, login, userId, clientId, at }
  spade: null,                   // { url, at }
  predSeen: {},                  // chaîne → { event, at } dernière prédiction en cours vue
  predBets: {},                  // id de prédiction → { outcomeId, points, at } paris faits d'ici
  pollVotes: {},                 // id de sondage → { choiceIds, votes, at } votes faits d'ici
  claimFails: {},                // id de coffre → { n, at } échecs du coffre automatique
  raidJoins: {},                 // id de raid → { res, at } réponse donnée pour ce raid
  dropPulse: {}                  // chaîne → état de la pulsation des drops (adresse signée,
                                 // segments vus…) : ne sort jamais vers la page
};
const MEM_KEYS = Object.keys(mem);
let loading = null;

function loadState() {
  if (!loading) {
    loading = (async () => {
      try {
        const got = await api.storage.session.get(MEM_KEYS);
        for (const k of MEM_KEYS) {
          if (got && got[k] !== undefined && got[k] !== null) mem[k] = got[k];
        }
      } catch (e) {
        // storage.session indisponible : mémoire seule
      }
      if (!mem.rl || typeof mem.rl !== "object") mem.rl = { global: [], slots: {} };
      if (!Array.isArray(mem.rl.global)) mem.rl.global = [];
      if (!mem.rl.slots || typeof mem.rl.slots !== "object") mem.rl.slots = {};
      for (const k of ["predSeen", "predBets", "pollVotes", "claimFails", "raidJoins", "dropPulse"]) {
        if (!mem[k] || typeof mem[k] !== "object" || Array.isArray(mem[k])) mem[k] = {};
      }
    })();
  }
  return loading;
}

function save(key) {
  try {
    const value = mem[key];
    const p = value === null || value === undefined
      ? api.storage.session.remove(key)
      : api.storage.session.set({ [key]: value });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    // rien : l'état reste en mémoire
  }
}

function pruneMap(map, max) {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys.sort((a, b) => ((map[a] && map[a].at) || 0) - ((map[b] && map[b].at) || 0));
  for (const k of keys.slice(0, keys.length - max)) delete map[k];
}

// --- Réglages (storage.local, sans secret) -----------------------------------

async function getSettings() {
  let stored = {};
  try {
    const got = await api.storage.local.get("settings");
    if (got && got.settings && typeof got.settings === "object") stored = got.settings;
  } catch (e) {
    // valeurs par défaut
  }
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    out[k] = typeof stored[k] === "boolean" ? stored[k] : DEFAULT_SETTINGS[k];
  }
  return out;
}

// --- Limites de débit ----------------------------------------------------------

function takeGlobal() {
  const now = Date.now();
  const recent = mem.rl.global.filter((t) => typeof t === "number" && t <= now && now - t < 60000);
  if (recent.length >= LIMIT.perMinute) {
    mem.rl.global = recent;
    return false;
  }
  recent.push(now);
  mem.rl.global = recent;
  save("rl");
  return true;
}

function takeSlot(key, ms) {
  const now = Date.now();
  const slots = mem.rl.slots;
  const last = slots[key];
  if (typeof last === "number" && last <= now && now - last < ms) return false;
  slots[key] = now;
  for (const k of Object.keys(slots)) {
    if (typeof slots[k] !== "number" || now - slots[k] > 3600000) delete slots[k];
  }
  save("rl");
  return true;
}

// --- Cache des lectures (une requête Twitch par 3 s, sinon la réponse en cache) ----

const readCache = new Map();

function cachedRead(key, ttl, load, fresh) {
  const now = Date.now();
  const hit = readCache.get(key);
  if (!fresh && hit && now >= hit.at && now - hit.at < ttl) return hit.promise;
  const promise = Promise.resolve().then(load);
  readCache.set(key, { at: now, promise });
  promise.catch(() => {
    const cur = readCache.get(key);
    if (cur && cur.promise === promise) readCache.delete(key);
  });
  if (readCache.size > 300) {
    for (const [k, v] of readCache) if (now - v.at > LIMIT.lookMs) readCache.delete(k);
  }
  return promise;
}

function invalidate(session, channel, kinds) {
  for (const kind of kinds) readCache.delete(session.fp + ":" + kind + ":" + channel);
}

// --- Session Twitch -------------------------------------------------------------

async function readCookie(name) {
  const query = { url: TWITCH_WWW + "/", name };
  let cookie = null;
  try {
    cookie = await api.cookies.get(query);
  } catch (e) {
    // Firefox avec l'isolation par premier site : le domaine est exigé.
    try {
      cookie = await api.cookies.get(Object.assign({ firstPartyDomain: "twitch.tv" }, query));
    } catch (e2) {
      cookie = null;
    }
  }
  return cookie && typeof cookie.value === "string" ? cookie.value : "";
}

// Session relue dans le cookie à chaque usage. null : pas connecté à twitch.tv.
async function readSession() {
  const token = await readCookie("auth-token");
  if (!AUTH_TOKEN_RE.test(token)) return null;
  return { token, fp: await fingerprint(token) };
}

// X-Device-Id : cookie unique_id de twitch.tv ; à défaut, un identifiant tiré une fois.
async function deviceId() {
  const fromCookie = await readCookie("unique_id");
  if (DEVICE_ID_RE.test(fromCookie)) return fromCookie;
  try {
    const got = await api.storage.local.get("deviceId");
    if (got && typeof got.deviceId === "string" && DEVICE_ID_RE.test(got.deviceId)) return got.deviceId;
  } catch (e) {
    // on en tire un
  }
  const fresh = randomId(32);
  try {
    await api.storage.local.set({ deviceId: fresh });
  } catch (e) {
    // gardé pour cette requête seulement
  }
  return fresh;
}

let userLoading = null;

function forgetUser() {
  mem.user = null;
  save("user");
}

// Pseudo et id du compte (validation de la session, gardée 15 min).
async function sessionUser(session, fresh) {
  await loadState();
  const u = mem.user;
  const now = Date.now();
  if (!fresh && u && u.fp === session.fp && now >= u.at && now - u.at < LIMIT.userMs) return u;
  if (!fresh && userLoading && userLoading.fp === session.fp) return userLoading.promise;
  const promise = validateSession(session);
  userLoading = { fp: session.fp, promise };
  try {
    return await promise;
  } finally {
    if (userLoading && userLoading.promise === promise) userLoading = null;
  }
}

async function validateSession(session) {
  const { status, json } = await fetchJson(VALIDATE_URL, {
    method: "GET",
    headers: { "Authorization": "OAuth " + session.token },
    redirect: "error"
  });
  if (status === 401) {
    forgetUser();
    throw new TuError("no_session");
  }
  if (status < 200 || status >= 300 || !json) throw new TuError("twitch", "validate_" + status);
  const login = typeof json.login === "string" ? json.login.toLowerCase() : "";
  const userId = typeof json.user_id === "string" ? json.user_id : "";
  if (!CHANNEL_RE.test(login) || !NUMERIC_ID_RE.test(userId)) throw new TuError("twitch", "validate");
  mem.user = {
    fp: session.fp,
    login,
    userId,
    clientId: typeof json.client_id === "string" ? json.client_id.slice(0, 64) : "",
    at: Date.now()
  };
  save("user");
  return mem.user;
}

// --- Requêtes vers Twitch ----------------------------------------------------------

async function fetchWith(url, init, read) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIMIT.fetchMs);
  try {
    const res = await fetch(url, Object.assign({ credentials: "omit", cache: "no-store" }, init, { signal: ctrl.signal }));
    let body = null;
    try {
      body = await read(res);
    } catch (e) {
      if (ctrl.signal.aborted) throw new TuError("timeout");
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof TuError) throw e;
    if (ctrl.signal.aborted) throw new TuError("timeout");
    throw new TuError("twitch", "network");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, init) {
  const { status, body } = await fetchWith(url, init, (res) => res.json());
  return { status, json: body && typeof body === "object" ? body : null };
}

async function fetchText(url) {
  const { status, body } = await fetchWith(url, { method: "GET", redirect: "follow" }, (res) => res.text());
  if (status < 200 || status >= 300 || typeof body !== "string") return "";
  return body.slice(0, 4000000);
}

// Une requête GQL. `opts.auth === false` : sans la session (lecture publique,
// comme gqlPublic de l'app). `opts.integrity` : mutation signée.
async function gql(body, session, opts) {
  const o = opts || {};
  const headers = {
    "Client-ID": CLIENT_ID,
    "Content-Type": "text/plain;charset=UTF-8"
  };
  if (o.integrity) {
    headers["Client-Integrity"] = o.integrity.token;
    headers["X-Device-Id"] = o.integrity.deviceId;
  } else {
    headers["X-Device-Id"] = await deviceId();
  }
  if (o.auth !== false) headers["Authorization"] = "OAuth " + session.token;
  const { status, json } = await fetchJson(GQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error"
  });
  if (status === 401 && o.auth !== false) {
    forgetUser();
    throw new TuError("no_session");
  }
  if (status < 200 || status >= 300) throw new TuError("twitch", "http_" + status);
  if (!json) throw new TuError("twitch", "bad_response");
  return json;
}

function gqlErrors(obj) {
  return arr(obj && obj.errors)
    .map((e) => (e && typeof e.message === "string" ? e.message : ""))
    .filter(Boolean);
}

// Erreurs GQL → code du protocole (les messages de Twitch sont nettoyés).
function throwGqlErrors(obj) {
  const msgs = gqlErrors(obj);
  if (!msgs.length) return;
  const all = msgs.join(" ").toLowerCase();
  if (all.includes("integrity")) throw new TuError("integrity");
  if (all.includes("unauthenticated") || all.includes("unauthorized")) throw new TuError("no_session");
  throw new TuError("twitch", msgs[0]);
}

function persisted(operationName, variables, sha256Hash) {
  return [{ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash } } }];
}

// Mutation signée du jeton d'intégrité. Refusée pour l'intégrité : jeton
// oublié, nouvelle obtention, un seul nouvel essai (mêmes variables, donc
// même transaction), comme TwitchGQL.send de l'app. `opts.sendBy` (dépenses) :
// rien ne part après cette heure. Le site aurait déjà abandonné la demande et
// laisserait recommencer : deux paris ou deux rachats.
async function mutation(body, session, opts) {
  const o = opts || {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const integrity = await getIntegrity(session, { force: attempt > 0, auto: !!o.auto });
    if (o.sendBy && Date.now() > o.sendBy) throw new TuError("timeout");
    const json = await gql(body, session, { integrity });
    const first = Array.isArray(json) ? json[0] : json;
    if (!first || typeof first !== "object") throw new TuError("twitch", "bad_response");
    if (gqlErrors(first).some((m) => /integrity/i.test(m))) {
      forgetIntegrity(integrity.token);
      continue;
    }
    return first;
  }
  throw new TuError("integrity");
}

// --- Jeton d'intégrité --------------------------------------------------------------

let minting = null;
let lastMintFail = "";

function forgetIntegrity(usedToken) {
  if (mem.integrity && (!usedToken || mem.integrity.token === usedToken)) {
    mem.integrity = null;
    save("integrity");
  }
}

// Jeton valable pour cette session, obtenu au besoin (une seule obtention à la fois).
async function getIntegrity(session, opts) {
  const o = opts || {};
  await loadState();
  const cur = mem.integrity;
  if (!o.force && cur && cur.fp === session.fp && cur.expiresAt - Date.now() > 60000) return cur;
  if (!minting) {
    const failAt = mem.mintFail && typeof mem.mintFail.at === "number" ? mem.mintFail.at : 0;
    const backoff = o.manual ? 0 : o.auto ? LIMIT.mintBackoffAutoMs : LIMIT.mintBackoffMs;
    const now = Date.now();
    if (failAt && failAt <= now && now - failAt < backoff) throw new TuError("integrity");
    startMint(session);
  }
  let got = await minting;
  if (got && got.fp !== session.fp) {
    // Obtenu pour un autre compte pendant l'attente : une fois de plus pour celui-ci.
    if (!minting) startMint(session);
    got = await minting;
  }
  if (!got || got.fp !== session.fp) throw new TuError("integrity");
  return got;
}

function startMint(session) {
  minting = mintIntegrity(session)
    .catch(() => null)
    .then((r) => {
      mem.mintFail = r ? null : { at: Date.now() };
      save("mintFail");
      return r;
    })
    .finally(() => {
      minting = null;
    });
}

// FONCTION INJECTÉE dans une page www.twitch.tv (monde MAIN). Elle est
// sérialisée : elle ne voit que ses arguments. C'est le `fetch` de la page,
// habillé par le script anti-robots de Twitch, qui signe la requête.
async function pageMintIntegrity(clientId, oauthToken, deviceId) {
  if (location.hostname !== "www.twitch.tv") return { status: -1, token: "" };
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : 0;
  try {
    const r = await fetch("https://gql.twitch.tv/integrity", {
      method: "POST",
      headers: { "Client-ID": clientId, "Authorization": "OAuth " + oauthToken, "X-Device-Id": deviceId },
      signal: ctrl ? ctrl.signal : undefined
    });
    let body = null;
    try {
      body = await r.json();
    } catch (e) {
      body = null;
    }
    return {
      status: r.status,
      token: body && typeof body.token === "string" ? body.token : "",
      expiration: body && typeof body.expiration === "number" ? body.expiration : 0
    };
  } catch (e) {
    return { status: 0, token: "" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runInTab(tabId, token, did) {
  try {
    const results = await api.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pageMintIntegrity,
      args: [CLIENT_ID, token, did]
    });
    const r = results && results[0] ? results[0].result : null;
    if (r && typeof r.token === "string" && INTEGRITY_RE.test(r.token)) {
      return { token: r.token, expiration: typeof r.expiration === "number" ? r.expiration : 0, deviceId: did };
    }
    lastMintFail = r && typeof r.status === "number" ? "http_" + r.status : "empty";
  } catch (e) {
    lastMintFail = "inject";
  }
  return { token: "" };
}

function waitForTab(tabId, ms) {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const ready = (t) => !!t && t.status === "complete" && isTwitchPage(t.url);
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { api.tabs.onUpdated.removeListener(onUpdated); } catch (e) { /* déjà retiré */ }
      try { api.tabs.onRemoved.removeListener(onRemoved); } catch (e) { /* déjà retiré */ }
      resolve(value);
    };
    const onUpdated = (id, info, tab) => {
      if (id === tabId && info && info.status === "complete" && ready(tab)) finish(true);
    };
    const onRemoved = (id) => {
      if (id === tabId) finish(false);
    };
    api.tabs.onUpdated.addListener(onUpdated);
    api.tabs.onRemoved.addListener(onRemoved);
    timer = setTimeout(() => finish(false), Math.max(0, ms));
    api.tabs.get(tabId).then((t) => { if (ready(t)) finish(true); }, () => finish(false));
  });
}

// Fenêtre de l'onglet temporaire : normale, hors navigation privée. Sans
// windowId, il irait dans la dernière fenêtre active, privée comprise quand
// l'extension y est permise, et la session du profil y serait injectée.
// undefined : pas d'API windows (fenêtre par défaut) ; null : aucune fenêtre sûre.
async function mintWindowId() {
  if (!api.windows || typeof api.windows.getAll !== "function") return undefined;
  try {
    const wins = arr(await api.windows.getAll({ windowTypes: ["normal"] }))
      .filter((w) => w && typeof w.id === "number" && !w.incognito);
    const w = wins.find((x) => x.focused) || wins[0];
    return w ? w.id : null;
  } catch (e) {
    return null;
  }
}

// Onglet temporaire : inactif, coupé, refermé après coup.
async function mintInTempTab(url, token, did, deadline) {
  let tab = null;
  try {
    const windowId = await mintWindowId();
    if (windowId === null) throw new Error("no window");
    tab = await api.tabs.create(windowId === undefined ? { url, active: false } : { url, active: false, windowId });
  } catch (e) {
    lastMintFail = "tab";
    return { token: "" };
  }
  if (!tab || typeof tab.id !== "number") return { token: "" };
  mem.mintTab = { id: tab.id, at: Date.now() };
  save("mintTab");
  try {
    try {
      await api.tabs.update(tab.id, { muted: true });
    } catch (e) {
      // pas de son sur /directory de toute façon
    }
    const loaded = await waitForTab(tab.id, Math.min(LIMIT.tabLoadMs, deadline - Date.now() - LIMIT.warmMs));
    if (!loaded) {
      lastMintFail = "load";
      return { token: "" };
    }
    await sleep(LIMIT.warmMs);
    let r = await runInTab(tab.id, token, did);
    if (!r.token && deadline - Date.now() > 4000) {
      await sleep(2000);
      r = await runInTab(tab.id, token, did);
    }
    return r;
  } finally {
    try {
      await api.tabs.remove(tab.id);
    } catch (e) {
      // déjà fermé
    }
    if (mem.mintTab && mem.mintTab.id === tab.id) {
      mem.mintTab = null;
      save("mintTab");
    }
  }
}

async function mintIntegrity(session) {
  const deadline = Date.now() + LIMIT.mintBudgetMs;
  const did = await deviceId();
  lastMintFail = "";

  // 1) Un onglet www.twitch.tv déjà ouvert (chargé, pas en navigation privée ;
  //    sous Firefox, du conteneur par défaut, celui du cookie lu : la session
  //    n'est pas injectée dans la page d'un autre conteneur).
  let tabs = [];
  try {
    tabs = await api.tabs.query({ url: TWITCH_WWW + "/*" });
  } catch (e) {
    tabs = [];
  }
  const open = arr(tabs).filter((t) => t && typeof t.id === "number" && t.status === "complete" &&
    !t.discarded && !t.incognito && (t.cookieStoreId === undefined || t.cookieStoreId === "firefox-default") &&
    isTwitchPage(t.url));
  for (const t of open.slice(0, 2)) {
    const r = await runInTab(t.id, session.token, did);
    if (r.token) return keepIntegrity(r, session, "tab");
  }

  // 2) Sinon un onglet temporaire : /directory (pas de vidéo), puis l'accueil.
  for (const url of [TWITCH_WWW + "/directory", TWITCH_WWW + "/"]) {
    if (deadline - Date.now() < LIMIT.warmMs + 5000) break;
    const r = await mintInTempTab(url, session.token, did, deadline);
    if (r.token) return keepIntegrity(r, session, "temp");
  }
  return null;
}

function keepIntegrity(r, session, via) {
  const now = Date.now();
  let expiresAt = typeof r.expiration === "number" ? r.expiration : 0;
  if (!(expiresAt > now + 120000)) expiresAt = now + 50 * 60000;
  expiresAt = Math.min(expiresAt, now + 48 * 3600000);
  mem.integrity = { token: r.token, deviceId: r.deviceId, expiresAt, fp: session.fp, via };
  save("integrity");
  return mem.integrity;
}

// Onglet temporaire resté ouvert (arrière-plan arrêté pendant l'obtention).
async function cleanupMintTab() {
  await loadState();
  if (minting) return;
  const t = mem.mintTab;
  if (!t || typeof t.id !== "number") return;
  try {
    const tab = await api.tabs.get(t.id);
    if (tab && !tab.active && isTwitchPage(tab.url)) await api.tabs.remove(t.id);
  } catch (e) {
    // déjà fermé
  }
  if (mem.mintTab && mem.mintTab.id === t.id) {
    mem.mintTab = null;
    save("mintTab");
  }
}

// --- Lectures ---------------------------------------------------------------------

// Solde et coffre (requête de fetchBalance de l'app, avec l'id de la chaîne).
function readPoints(session, channel, fresh) {
  return cachedRead(session.fp + ":points:" + channel, LIMIT.readMs, async () => {
    const json = await gql({ query: Q.points, variables: { l: channel } }, session);
    const data = json.data;
    if (data && data.channel === null) throw new TuError("twitch", "channel_not_found");
    const ch = data && data.channel;
    if (!ch || typeof ch !== "object") {
      throwGqlErrors(json);
      throw new TuError("twitch", "bad_response");
    }
    const channelId = typeof ch.id === "string" && NUMERIC_ID_RE.test(ch.id) ? ch.id : null;
    if (!channelId) throw new TuError("twitch", "bad_response");
    if (!ch.self || typeof ch.self !== "object") {
      throwGqlErrors(json);
      throw new TuError("no_session");
    }
    // communityPoints null : jamais regardé cette chaîne → 0, comme l'app.
    const cp = ch.self.communityPoints;
    const balance = cp && typeof cp.balance === "number" && Number.isFinite(cp.balance) ? Math.trunc(cp.balance) : 0;
    const claim = cp && cp.availableClaim;
    const claimId = claim && typeof claim.id === "string" && TWITCH_ID_RE.test(claim.id) ? claim.id : null;
    return { channelId, balance, claimId };
  }, fresh);
}

// Séries de visionnage du compte (fetchStreak de l'app) : id de chaîne → valeur.
// Une seule requête pour toutes les chaînes.
function readStreaks(session) {
  return cachedRead(session.fp + ":streaks", LIMIT.streakMs, async () => {
    const json = await gql(persisted("BatchGetWatchStreaks", {}, HASH.streaks), session);
    const first = Array.isArray(json) ? json[0] : json;
    const list = first && first.data ? first.data.batchGetWatchStreaks : undefined;
    if (!Array.isArray(list)) {
      throwGqlErrors(first);
      throw new TuError("twitch", "bad_response");
    }
    const out = {};
    for (const item of list) {
      const id = item && item.channel && item.channel.id;
      if (typeof id === "string" && typeof item.value === "number" && Number.isFinite(item.value)) {
        out[id] = Math.trunc(item.value);
      }
    }
    return out;
  });
}

// Nom et icône des points de la chaîne (requête brute, pas dans l'app iOS).
// Un échec ne bloque rien : null.
function readPointsLook(session, channel) {
  return cachedRead("look:" + channel, LIMIT.lookMs, async () => {
    try {
      const json = await gql({ query: Q.pointsLook, variables: { l: channel } }, session, { auth: false });
      const s = json.data && json.data.channel && json.data.channel.communityPointsSettings;
      const name = s && typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 64) : null;
      const url = s && s.image && typeof s.image.url2x === "string" ? s.image.url2x : "";
      return { pointsName: name, pointsIconUrl: /^https:\/\/[^\s"'<>\\]{1,500}$/.test(url) ? url : null };
    } catch (e) {
      return { pointsName: null, pointsIconUrl: null };
    }
  });
}

// Id du direct en cours, null hors ligne (fetchBroadcastId de l'app).
function readBroadcastId(session, channel, fresh) {
  return cachedRead("stream:" + channel, LIMIT.readMs, async () => {
    const json = await gql({ query: Q.stream, variables: { l: channel } }, session, { auth: false });
    const data = json.data;
    if (!data || typeof data !== "object" || data.user === undefined) {
      throwGqlErrors(json);
      throw new TuError("twitch", "bad_response");
    }
    if (data.user === null) throw new TuError("twitch", "channel_not_found");
    const stream = data.user.stream;
    return stream && typeof stream.id === "string" && NUMERIC_ID_RE.test(stream.id) ? stream.id : null;
  }, fresh);
}

const PREDICTION_STATUSES = ["ACTIVE", "LOCKED", "RESOLVE_PENDING", "RESOLVED", "CANCELED"];

function normalizeEvent(ev, listStatus) {
  if (!ev || typeof ev.id !== "string" || !TWITCH_ID_RE.test(ev.id)) return null;
  let status = typeof ev.status === "string" ? ev.status.toUpperCase() : "";
  if (status === "CANCEL_PENDING") status = "CANCELED";
  if (!PREDICTION_STATUSES.includes(status)) status = listStatus;
  const outcomes = arr(ev.outcomes)
    .filter((o) => o && typeof o.id === "string" && TWITCH_ID_RE.test(o.id))
    .slice(0, 10)
    .map((o) => ({
      id: o.id,
      title: str(o.title, 200),
      color: o.color === "BLUE" || o.color === "PINK" ? o.color : null,
      totalPoints: int(o.totalPoints),
      totalUsers: int(o.totalUsers)
    }));
  const winner = ev.winningOutcome && typeof ev.winningOutcome.id === "string" ? ev.winningOutcome.id : null;
  return {
    id: ev.id,
    title: str(ev.title, 200),
    status,
    createdAt: str(ev.createdAt, 40),
    windowSeconds: int(ev.predictionWindowSeconds),
    winningOutcomeId: winner,
    outcomes
  };
}

// Prédiction en cours ou verrouillée (fetchPrediction de l'app).
function readPredictionContext(session, channel, fresh) {
  return cachedRead(session.fp + ":pred:" + channel, LIMIT.readMs, async () => {
    const json = await gql(persisted("ChannelPointsPredictionContext", { count: 1, channelLogin: channel }, HASH.predictionContext), session);
    const first = Array.isArray(json) ? json[0] : json;
    const community = first && first.data ? first.data.community : undefined;
    if (community === null) throw new TuError("twitch", "channel_not_found");
    const chan = community && community.channel;
    if (!chan || typeof chan !== "object") {
      throwGqlErrors(first);
      throw new TuError("twitch", "bad_response");
    }
    const active = arr(chan.activePredictionEvents);
    const locked = arr(chan.lockedPredictionEvents);
    if (active[0]) return normalizeEvent(active[0], "ACTIVE");
    if (locked[0]) return normalizeEvent(locked[0], "LOCKED");
    return null;
  }, fresh);
}

// Tes paris connus de Twitch (myPrediction de l'app) : id → { outcomeId, points } | null.
function readPredictionSelf(session, channel, fresh) {
  return cachedRead(session.fp + ":predself:" + channel, LIMIT.readMs, async () => {
    const json = await gql({ query: Q.predictionSelf, variables: { l: channel } }, session);
    const chan = json.data && json.data.channel;
    const out = {};
    if (!chan) return out;
    for (const e of arr(chan.activePredictionEvents).concat(arr(chan.lockedPredictionEvents))) {
      if (!e || typeof e.id !== "string") continue;
      const p = e.self && e.self.prediction;
      out[e.id] = p && typeof p.points === "number" && p.outcome && typeof p.outcome.id === "string"
        ? { outcomeId: p.outcome.id, points: Math.trunc(p.points) }
        : null;
    }
    return out;
  }, fresh);
}

// Issues gagnantes des dernières prédictions terminées (resolvedWinner de l'app).
function readResolved(session, channel) {
  return cachedRead("resolved:" + channel, LIMIT.readMs, async () => {
    const json = await gql({ query: Q.predictionResolved, variables: { l: channel } }, session, { auth: false });
    const conn = json.data && json.data.channel && json.data.channel.resolvedPredictionEvents;
    const out = {};
    for (const edge of arr(conn && conn.edges)) {
      const n = edge && edge.node;
      if (n && typeof n.id === "string") {
        out[n.id] = n.winningOutcome && typeof n.winningOutcome.id === "string" ? n.winningOutcome.id : null;
      }
    }
    return out;
  });
}

// Ton pari : celui que Twitch connaît, sinon celui envoyé d'ici (Twitch peut
// mettre quelques secondes à le renvoyer), comme l'app.
function mergeSelf(eventId, remote) {
  const local = mem.predBets[eventId];
  if (remote && typeof remote === "object" && typeof remote.outcomeId === "string") {
    const points = local && local.outcomeId === remote.outcomeId ? Math.max(remote.points, local.points) : remote.points;
    return { outcomeId: remote.outcomeId, points };
  }
  return local ? { outcomeId: local.outcomeId, points: local.points } : null;
}

function rememberPrediction(channel, event) {
  mem.predSeen[channel] = { event, at: Date.now() };
  pruneMap(mem.predSeen, 20);
  save("predSeen");
}

// Prédiction disparue des listes : terminée. Donnée encore 3 min, avec son
// issue gagnante (sans gagnante dans la liste des terminées : annulée).
async function endedPrediction(session, channel) {
  const seen = mem.predSeen[channel];
  if (!seen || !seen.event || typeof seen.event.id !== "string") return null;
  const now = Date.now();
  if (!(seen.at <= now && now - seen.at < LIMIT.resolvedKeepMs)) {
    delete mem.predSeen[channel];
    save("predSeen");
    return null;
  }
  const winners = await readResolved(session, channel).catch(() => null);
  if (!winners || !has(winners, seen.event.id)) return null;
  const winner = winners[seen.event.id];
  return Object.assign({}, seen.event, {
    status: winner ? "RESOLVED" : "CANCELED",
    winningOutcomeId: winner,
    self: mergeSelf(seen.event.id, seen.event.self)
  });
}

const POLL_STATUSES = ["ACTIVE", "COMPLETED", "TERMINATED", "ARCHIVED"];

function normalizePoll(p) {
  if (!p || typeof p.id !== "string" || !TWITCH_ID_RE.test(p.id)) return null;
  // Sans état : ACTIVE, comme l'app (LiveEventsService.fetchPoll). Le protocole
  // n'admet pas null : le site rejetterait tout le sondage, et la réponse d'un
  // vote pourtant compté passerait pour un échec.
  let status = typeof p.status === "string" ? p.status.toUpperCase() : "ACTIVE";
  // Autre état de Twitch (MODERATED, INVALID…) : sondage fini.
  if (!POLL_STATUSES.includes(status)) status = "TERMINATED";
  const choices = arr(p.choices)
    .filter((c) => c && typeof c.id === "string" && TWITCH_ID_RE.test(c.id))
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      title: str(c.title, 200),
      votes: c.votes && typeof c.votes.total === "number" ? int(c.votes.total) : int(c.totalVoters)
    }));
  let totalVotes = p.votes && typeof p.votes.total === "number" ? int(p.votes.total) : null;
  if (totalVotes === null && choices.length && choices.every((c) => c.votes !== null)) {
    totalVotes = choices.reduce((sum, c) => sum + c.votes, 0);
  }
  const settings = p.settings && typeof p.settings === "object" ? p.settings : {};
  const cpv = settings.communityPointsVotes && typeof settings.communityPointsVotes === "object" ? settings.communityPointsVotes : null;
  const duration = int(p.durationSeconds);
  return {
    id: p.id,
    title: str(p.title, 300),
    status,
    startedAt: str(p.startedAt, 40),
    durationSeconds: duration !== null ? duration : int(p.duration),
    totalVotes,
    choices,
    pointsVoting: {
      enabled: cpv && typeof cpv.isEnabled === "boolean" ? cpv.isEnabled : null,
      cost: cpv ? int(cpv.cost) : null
    }
  };
}

// Sondage en cours (fetchPoll de l'app).
function readPoll(session, channel, fresh) {
  return cachedRead(session.fp + ":poll:" + channel, LIMIT.readMs, async () => {
    const json = await gql(persisted("ChannelPollContext_GetViewablePoll", { login: channel }, HASH.viewablePoll), session);
    const first = Array.isArray(json) ? json[0] : json;
    const data = first && first.data;
    if (!data || typeof data !== "object") {
      throwGqlErrors(first);
      throw new TuError("twitch", "bad_response");
    }
    if (data.channel === null) throw new TuError("twitch", "channel_not_found");
    const p = data.channel && data.channel.viewablePoll;
    return p ? normalizePoll(p) : null;
  }, fresh);
}

// Tes votes : ceux faits depuis cette extension (Twitch ne les renvoie pas ici).
function withPollSelf(poll) {
  const local = mem.pollVotes[poll.id];
  return Object.assign({}, poll, {
    self: local ? { choiceIds: arr(local.choiceIds).slice(0, 10), votes: local.votes } : null
  });
}

// --- Présence « minute-watched » (ChannelPointsService.startWatchPresence) ----------

function findSpade(text) {
  const m = /"spade_url"\s*:\s*"(https:[^"]+)"/.exec(text || "");
  return m ? m[1].replace(/\\\//g, "/") : null;
}

function hostMatches(url, suffixes) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return suffixes.some((s) => u.hostname === s || u.hostname.endsWith("." + s));
  } catch (e) {
    return false;
  }
}

function settingsHostOk(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "static.twitchcdn.net" || u.hostname.endsWith(".twitch.tv"));
  } catch (e) {
    return false;
  }
}

// Adresse du spade : dans la page de la chaîne, sinon dans son fichier settings.<hash>.js.
async function spadeUrl(channel) {
  await loadState();
  const now = Date.now();
  const s = mem.spade;
  if (s && typeof s.url === "string" && s.at <= now && now - s.at < LIMIT.spadeMs) return s.url;
  const page = await fetchText(TWITCH_WWW + "/" + channel);
  let url = findSpade(page);
  if (!url) {
    const m = /(https:\/\/[^"']+?\/config\/settings\.[A-Za-z0-9]+\.js)/.exec(page);
    if (m && settingsHostOk(m[1])) url = findSpade(await fetchText(m[1]));
  }
  if (!url || !hostMatches(url, SPADE_HOST_SUFFIXES)) return null;
  mem.spade = { url, at: now };
  save("spade");
  return url;
}

// Même événement que l'app iOS. La réponse ne sert à rien : « no-cors », sans
// cookie, sans accès d'hôte au spade.
async function sendMinuteWatched(session, channel, channelId, broadcastId) {
  const user = await sessionUser(session);
  const url = await spadeUrl(channel);
  if (!url) return false;
  const payload = [{
    event: "minute-watched",
    properties: {
      channel_id: channelId,
      broadcast_id: broadcastId,
      channel,
      user_id: Number(user.userId),
      player: "site",
      live: true
    }
  }];
  try {
    await fetchWith(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(base64Utf8(JSON.stringify(payload)))
    }, () => null);
    return true;
  } catch (e) {
    mem.spade = null;
    save("spade");
    return false;
  }
}

// --- Opérations du protocole -----------------------------------------------------------

async function opStatus(settings) {
  const key = "status:" + settings.autoClaim + ":" + settings.allowSpend;
  return cachedRead(key, LIMIT.readMs, async () => {
    const s = await readSession();
    let session = null;
    if (s) {
      try {
        const u = await sessionUser(s);
        session = { login: u.login, userId: u.userId };
      } catch (e) {
        if (!(e instanceof TuError) || e.code !== "no_session") throw e;
      }
    }
    return { enabled: true, session, settings: { autoClaim: settings.autoClaim, allowSpend: settings.allowSpend } };
  });
}

async function opPointsGet(args, session) {
  const [pts, look, streaks] = await Promise.all([
    readPoints(session, args.channel),
    readPointsLook(session, args.channel),
    readStreaks(session).catch(() => null)
  ]);
  return {
    channelId: pts.channelId,
    balance: pts.balance,
    claimAvailable: !!pts.claimId,
    pointsName: look.pointsName,
    pointsIconUrl: look.pointsIconUrl,
    // Absente de la liste de Twitch : 0, comme l'app ; lecture ratée : null.
    watchStreak: streaks ? (has(streaks, pts.channelId) ? streaks[pts.channelId] : 0) : null
  };
}

// Réclamation du coffre (claimBonus de l'app). `auto` : coffre automatique.
async function claimChest(session, channel, pts, auto) {
  const body = persisted("ClaimCommunityPoints", { input: { channelID: pts.channelId, claimID: pts.claimId } }, HASH.claim);
  const res = await mutation(body, session, { auto });
  const claim = res.data && res.data.claimCommunityPoints;
  if (!claim || typeof claim !== "object") {
    throwGqlErrors(res);
    throw new TuError("twitch", "bad_response");
  }
  if (claim.error && claim.error.code) throw new TuError("twitch", safeCode(claim.error.code));
  invalidate(session, channel, ["points"]);
  delete mem.claimFails[pts.claimId];
  if (typeof claim.currentPoints === "number" && Number.isFinite(claim.currentPoints)) {
    const gained = claim.currentPoints - pts.balance;
    return { claimed: gained > 0 ? gained : null, balance: Math.trunc(claim.currentPoints) };
  }
  // La réponse ne donne pas toujours currentPoints : solde relu.
  const after = await readPoints(session, channel, true).catch(() => null);
  if (!after) return { claimed: null, balance: pts.balance };
  const gained = after.balance - pts.balance;
  return { claimed: gained > 0 ? gained : null, balance: after.balance };
}

async function opPointsClaim(args, session) {
  const pts = await readPoints(session, args.channel, true);
  if (!pts.claimId) throw new TuError("no_claim");
  return claimChest(session, args.channel, pts, false);
}

async function opWatchBeat(args, session, settings) {
  const channel = args.channel;
  const [pts, broadcastId] = await Promise.all([
    readPoints(session, channel),
    readBroadcastId(session, channel, true)
  ]);
  if (!broadcastId) return { live: false, balance: pts.balance, claimed: null };
  await sendMinuteWatched(session, channel, pts.channelId, broadcastId).catch(() => false);
  let claimed = null;
  let balance = pts.balance;
  const fails = pts.claimId ? mem.claimFails[pts.claimId] : null;
  if (settings.autoClaim && pts.claimId && !(fails && fails.n >= 3) && takeSlot("claim", LIMIT.claimMs)) {
    try {
      const r = await claimChest(session, channel, pts, true);
      claimed = r.claimed;
      balance = r.balance;
    } catch (e) {
      if (e instanceof TuError && e.code === "no_session") throw e;
      // Échec : nouvel essai au battement suivant, abandon au 3e (comme l'app, qui s'arrête au 4e).
      mem.claimFails[pts.claimId] = { n: ((fails && fails.n) || 0) + 1, at: Date.now() };
      pruneMap(mem.claimFails, 20);
    }
    save("claimFails");
  }
  return { live: true, balance, claimed };
}

async function opPredictionsGet(args, session) {
  const channel = args.channel;
  const [pts, ev] = await Promise.all([readPoints(session, channel), readPredictionContext(session, channel)]);
  let event = null;
  if (ev) {
    const selfMap = await readPredictionSelf(session, channel).catch(() => null);
    event = Object.assign({}, ev, { self: mergeSelf(ev.id, selfMap ? selfMap[ev.id] : null) });
    rememberPrediction(channel, event);
  } else {
    event = await endedPrediction(session, channel);
  }
  return { balance: pts.balance, event };
}

async function opPredictionsBet(args, session) {
  const channel = args.channel;
  const sendBy = Date.now() + LIMIT.spendSendMs;
  const [pts, ev, selfMap] = await Promise.all([
    readPoints(session, channel, true),
    readPredictionContext(session, channel, true),
    readPredictionSelf(session, channel, true).catch(() => null)
  ]);
  if (!ev || ev.id !== args.eventId) throw new TuError("bad_args", "eventId");
  if (ev.status !== "ACTIVE") throw new TuError("bad_args", "not_active");
  if (!ev.outcomes.some((o) => o.id === args.outcomeId)) throw new TuError("bad_args", "outcomeId");
  if (args.points > pts.balance) throw new TuError("bad_args", "points");
  const mine = mergeSelf(ev.id, selfMap ? selfMap[ev.id] : null);
  if (mine && mine.outcomeId !== args.outcomeId) throw new TuError("bad_args", "other_outcome");

  const input = { eventID: ev.id, outcomeID: args.outcomeId, points: args.points, transactionID: hex32() };
  const res = await mutation(persisted("MakePrediction", { input }, HASH.makePrediction), session, { sendBy });
  const made = res.data && res.data.makePrediction;
  if (!made || typeof made !== "object") {
    throwGqlErrors(res);
    throw new TuError("twitch", "bad_response");
  }
  if (made.error && made.error.code) throw new TuError("twitch", safeCode(made.error.code));

  // Total misé sur cette issue (on peut y rajouter des points).
  const total = (mine && mine.outcomeId === args.outcomeId ? mine.points : 0) + args.points;
  mem.predBets[ev.id] = { outcomeId: args.outcomeId, points: total, at: Date.now() };
  pruneMap(mem.predBets, 50);
  save("predBets");
  invalidate(session, channel, ["points", "pred", "predself"]);
  // Solde relu seulement s'il reste le temps de répondre avant l'abandon du site.
  const after = Date.now() <= sendBy ? await readPoints(session, channel, true).catch(() => null) : null;
  const expected = pts.balance - args.points;
  const balance = after ? Math.min(after.balance, expected) : expected;
  return { balance: Math.max(0, balance), self: { outcomeId: args.outcomeId, points: total } };
}

async function opPollsGet(args, session) {
  const poll = await readPoll(session, args.channel);
  return { poll: poll ? withPollSelf(poll) : null };
}

async function opPollsVote(args, session) {
  const channel = args.channel;
  const sendBy = Date.now() + LIMIT.spendSendMs;
  const [user, poll] = await Promise.all([sessionUser(session), readPoll(session, channel, true)]);
  if (!poll || poll.id !== args.pollId) throw new TuError("bad_args", "pollId");
  if (poll.status !== "ACTIVE") throw new TuError("bad_args", "not_active");
  if (!poll.choices.some((c) => c.id === args.choiceId)) throw new TuError("bad_args", "choiceId");

  // tokens null = vote gratuit (comme l'app). Vote payé en points : forme
  // { bits, channelPoints } du site de Twitch (pas dans l'app iOS).
  let tokens = null;
  if (args.withPoints) {
    const cost = poll.pointsVoting.cost;
    if (poll.pointsVoting.enabled !== true || !(typeof cost === "number" && cost > 0)) {
      throw new TuError("bad_args", "withPoints");
    }
    const pts = await readPoints(session, channel, true);
    if (cost > pts.balance) throw new TuError("bad_args", "points");
    tokens = { bits: 0, channelPoints: cost };
  }
  const input = { pollID: poll.id, choiceID: args.choiceId, userID: user.userId, voteID: hex32(), tokens };
  const res = await mutation(persisted("ChannelPollContext_VoteInPoll", { input }, HASH.voteInPoll), session, { sendBy });
  const vote = res.data && res.data.voteInPoll;
  if (!vote || gqlErrors(res).length) {
    throwGqlErrors(res);
    throw new TuError("twitch", "bad_response");
  }
  if (typeof vote === "object" && vote.error && vote.error.code) throw new TuError("twitch", safeCode(vote.error.code));

  const rec = mem.pollVotes[poll.id] || { choiceIds: [], votes: 0 };
  rec.choiceIds = arr(rec.choiceIds);
  if (!rec.choiceIds.includes(args.choiceId)) rec.choiceIds.push(args.choiceId);
  rec.votes = (typeof rec.votes === "number" ? rec.votes : 0) + 1;
  rec.at = Date.now();
  mem.pollVotes[poll.id] = rec;
  pruneMap(mem.pollVotes, 50);
  save("pollVotes");
  invalidate(session, channel, args.withPoints ? ["poll", "points"] : ["poll"]);
  const fresh = Date.now() <= sendBy ? await readPoll(session, channel, true).catch(() => null) : null;
  return { poll: withPollSelf(fresh && fresh.id === poll.id ? fresh : poll) };
}

// Rejoindre un raid (mutation JoinRaid, absente de l'app iOS). Hash non
// vérifié : si Twitch ne le connaît pas, même mutation écrite en clair.
async function opRaidJoin(args, session) {
  const input = { raidID: args.raidId };
  let res = await mutation(persisted("JoinRaid", { input }, HASH.joinRaid), session);
  if (gqlErrors(res).some((m) => /PersistedQueryNotFound/i.test(m))) {
    res = await mutation([{ operationName: "JoinRaid", query: Q.joinRaid, variables: { input } }], session);
  }
  if (gqlErrors(res).length) throwGqlErrors(res);
  const data = res.data;
  if (!data || typeof data !== "object" || data.joinRaid === undefined) throw new TuError("twitch", "bad_response");
  const join = data.joinRaid;
  if (join && typeof join === "object" && join.error && join.error.code) throw new TuError("twitch", safeCode(join.error.code));
  return { joined: !!join };
}

// Réponse gardée pour ce raid (au plus une fois par raid), sauf échec passager.
function rememberRaid(raidId, res) {
  const msg = res.ok ? "" : String(res.error.message || "");
  const lasting = res.ok || (res.error.code === "twitch" && msg !== "network" && msg !== "bad_response" && !msg.startsWith("http_"));
  if (lasting) {
    mem.raidJoins[raidId] = { res, at: Date.now() };
    pruneMap(mem.raidJoins, 20);
    save("raidJoins");
  }
  return res;
}

// --- Drops (Drops.swift de l'app iOS) ----------------------------------------------------

function httpsUrl(v) {
  return typeof v === "string" && /^https:\/\/[^\s"'<>\\]{1,800}$/.test(v) ? v : null;
}

// Jeton d'intégrité déjà gardé pour cette session, sans en obtenir un.
function cachedIntegrity(session) {
  const cur = mem.integrity;
  return cur && cur.fp === session.fp && cur.expiresAt - Date.now() > 60000 ? cur : null;
}

// Campagne de Drops.swift `campaign(_:)` : forme du protocole et, à part,
// `needsLink` (compte de jeu à lier : pas de réclamation automatique).
function normalizeCampaign(c) {
  if (!c || typeof c.id !== "string" || !TWITCH_ID_RE.test(c.id)) return null;
  const drops = arr(c.timeBasedDrops)
    .filter((d) => d && typeof d.id === "string" && TWITCH_ID_RE.test(d.id))
    .slice(0, 50)
    .map((d) => {
      const me = d.self && typeof d.self === "object" ? d.self : null;
      const edge = arr(d.benefitEdges)[0];
      const benefit = edge && edge.benefit && typeof edge.benefit === "object" ? edge.benefit : null;
      const required = int(d.requiredMinutesWatched);
      const current = me ? int(me.currentMinutesWatched) : null;
      const claimed = !!me && me.isClaimed === true;
      const instance = me && typeof me.dropInstanceID === "string" && DROP_INSTANCE_RE.test(me.dropInstanceID) ? me.dropInstanceID : null;
      // Réclamable comme `canClaim` de l'app : pas réclamé, instance donnée, minutes atteintes.
      const canClaim = !claimed && instance !== null && (current || 0) >= (required || 0);
      return {
        id: d.id,
        name: str(benefit && benefit.name, 200) || str(d.name, 200),
        imageUrl: httpsUrl(benefit && benefit.imageAssetURL),
        requiredMinutes: required !== null ? required : 0,
        currentMinutes: current !== null ? current : 0,
        claimed,
        dropInstanceId: canClaim ? instance : null
      };
    });
  const link = typeof c.accountLinkURL === "string" ? c.accountLinkURL : "";
  const connected = c.self && typeof c.self.isAccountConnected === "boolean" ? c.self.isAccountConnected : true;
  return {
    campaign: {
      id: c.id,
      name: str(c.name, 200),
      gameName: c.game && typeof c.game === "object" ? str(c.game.displayName, 200) : null,
      endsAt: str(c.endAt, 40),
      drops
    },
    needsLink: !connected && !link.includes("twitch.tv")
  };
}

// Campagnes de drops de la chaîne (dropsChannelId de l'app) : id de la chaîne
// et ids des campagnes, gardés 10 min.
function readDropsChannel(session, channel) {
  return cachedRead("dropsch:" + channel, LIMIT.dropsChannelMs, async () => {
    const json = await gql({ query: Q.dropsChannel, variables: { l: channel } }, session, { auth: false });
    const data = json.data;
    if (!data || typeof data !== "object") {
      throwGqlErrors(json);
      throw new TuError("twitch", "bad_response");
    }
    const user = data.user;
    if (!user || typeof user.id !== "string" || !NUMERIC_ID_RE.test(user.id)) return { channelId: null, campaignIds: [] };
    const list = user.channel && Array.isArray(user.channel.viewerDropCampaigns) ? user.channel.viewerDropCampaigns : [];
    const campaignIds = list.map((c) => c && c.id).filter((id) => typeof id === "string" && TWITCH_ID_RE.test(id));
    return { channelId: user.id, campaignIds };
  });
}

// Inventaire du compte (refresh de l'app) : campagnes commencées, progression comprise.
function readDropsInventory(session, fresh) {
  return cachedRead(session.fp + ":dropsinv", LIMIT.inventoryMs, async () => {
    const json = await gql({ query: Q.dropsInventory }, session);
    const user = json.data && json.data.currentUser;
    const inventory = user && user.inventory;
    if (!user || typeof user !== "object") {
      throwGqlErrors(json);
      throw new TuError(json.data && json.data.currentUser === null ? "no_session" : "twitch", "bad_response");
    }
    return arr(inventory && inventory.dropCampaignsInProgress).map(normalizeCampaign).filter(Boolean);
  }, fresh);
}

// Toutes les campagnes ouvertes (refreshAvailable de l'app), pour celles de la
// chaîne pas encore commencées. Avec un jeton d'intégrité seulement s'il est
// déjà gardé : une lecture n'ouvre jamais d'onglet (l'app, elle, en obtient un).
function readDropsDashboard(session) {
  const it = cachedIntegrity(session);
  // Clé selon qu'un jeton est gardé : sans jeton, la réponse vide est gardée
  // 10 min ; dès qu'un jeton existe, nouvelle lecture.
  return cachedRead(session.fp + ":dropsdash:" + (it ? "it" : "none"), LIMIT.lookMs, async () => {
    const body = { query: Q.dropsDashboard };
    let json = await gql(body, session);
    if (gqlErrors(json).some((m) => /integrity/i.test(m))) {
      if (!it) return [];
      json = await gql(body, session, { integrity: it });
    }
    const user = json.data && json.data.currentUser;
    if (!user || !Array.isArray(user.dropCampaigns)) {
      throwGqlErrors(json);
      throw new TuError("twitch", "bad_response");
    }
    return user.dropCampaigns.map(normalizeCampaign).filter(Boolean);
  });
}

// Drop crédité en ce moment sur la chaîne (refreshSession de l'app).
function readDropSession(session, channelId) {
  return cachedRead(session.fp + ":dropsess:" + channelId, LIMIT.readMs, async () => {
    const json = await gql({ query: Q.dropsSession, variables: { c: channelId } }, session);
    const s = json.data && json.data.currentUser && json.data.currentUser.dropCurrentSession;
    if (!s || typeof s.dropID !== "string") return null;
    return { dropId: s.dropID, currentMinutes: int(s.currentMinutesWatched) };
  });
}

async function opDropsGet(args, session) {
  const ch = await readDropsChannel(session, args.channel);
  if (!ch.campaignIds.length) return { channelHasDrops: false, campaigns: [] };
  const [inventory, current] = await Promise.all([
    readDropsInventory(session),
    ch.channelId ? readDropSession(session, ch.channelId).catch(() => null) : null
  ]);
  const wanted = ch.campaignIds;
  const found = inventory.filter((c) => wanted.includes(c.campaign.id));
  const missing = wanted.filter((id) => !found.some((c) => c.campaign.id === id));
  let extra = [];
  if (missing.length) {
    const dashboard = await readDropsDashboard(session).catch(() => []);
    extra = dashboard.filter((c) => missing.includes(c.campaign.id));
  }
  const campaigns = found.concat(extra).map((c) => {
    const campaign = Object.assign({}, c.campaign);
    // Minutes du drop en cours : celles de la session si l'inventaire est en retard.
    if (current && current.currentMinutes !== null) {
      campaign.drops = campaign.drops.map((d) => (d.id === current.dropId && current.currentMinutes > d.currentMinutes
        ? Object.assign({}, d, { currentMinutes: current.currentMinutes })
        : d));
    }
    return campaign;
  });
  campaigns.sort((a, b) => (Date.parse(a.endsAt || "") || Infinity) - (Date.parse(b.endsAt || "") || Infinity));
  return { channelHasDrops: true, campaigns };
}

// Réclamation d'un drop (claim / sendClaim de l'app). true : accordé ou déjà fait.
async function claimDrop(session, dropInstanceId, auto) {
  const body = persisted("DropsPage_ClaimDropRewards", { input: { dropInstanceID: dropInstanceId } }, HASH.dropsClaim);
  const res = await mutation(body, session, { auto });
  if (gqlErrors(res).length) throwGqlErrors(res);
  readCache.delete(session.fp + ":dropsinv");
  const out = res.data && res.data.claimDropRewards;
  const status = out && typeof out.status === "string" ? out.status : null;
  // ELIGIBLE_FOR_ALL : accordé ; DROP_INSTANCE_ALREADY_CLAIMED : déjà fait.
  if (status === "ELIGIBLE_FOR_ALL" || status === "DROP_INSTANCE_ALREADY_CLAIMED") return true;
  if (status) throw new TuError("twitch", safeCode(status));
  return false;
}

async function opDropsClaim(args, session) {
  return { claimed: await claimDrop(session, args.dropInstanceId, false) };
}

// Jeton de lecture AU NOM DU COMPTE (accountPlaybackToken de l'app) : sans
// jeton d'intégrité d'abord, puis avec si Twitch en demande un (le gardé,
// puis un neuf). null s'il est refusé ou anonyme (il ne ferait rien avancer).
async function accountPlaybackToken(session, channel) {
  const body = { query: Q.playbackToken, variables: { l: channel } };
  let json = await gql(body, session);
  for (let tries = 0; tries < 2 && gqlErrors(json).some((m) => /integrity/i.test(m)); tries++) {
    let it;
    try {
      it = await getIntegrity(session, { force: tries > 0, auto: true });
    } catch (e) {
      return null;
    }
    json = await gql(body, session, { integrity: it });
  }
  const pat = json.data && json.data.streamPlaybackAccessToken;
  if (!pat || typeof pat.value !== "string" || typeof pat.signature !== "string") return null;
  if (!/"user_id":\d/.test(pat.value)) return null;
  return { value: pat.value, signature: pat.signature };
}

function hlsUrl(url) {
  return hostMatches(url, ["hls.ttvnw.net"]);
}

// Plus petite qualité du direct (lowestVariant de l'app) : la dernière
// variante de la liste maîtresse d'usher, lue avec le jeton du compte.
async function lowestVariant(session, channel) {
  const pat = await accountPlaybackToken(session, channel);
  if (!pat) return null;
  const params = new URLSearchParams({ allow_source: "true", allow_audio_only: "true", sig: pat.signature, token: pat.value });
  const master = "https://usher.ttvnw.net/api/channel/hls/" + channel + ".m3u8?" + params.toString();
  const { status, body } = await fetchWith(master, { method: "GET" }, (res) => res.text());
  if (status !== 200 || typeof body !== "string") return null;
  const lines = body.split("\n");
  let last = null;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) last = lines[i + 1].trim();
  }
  if (!last) return null;
  let url;
  try {
    url = new URL(last, master).href;
  } catch (e) {
    return null;
  }
  return hlsUrl(url) ? url : null;
}

// Relit la playlist et demande chaque nouveau segment en HEAD (poll de l'app).
async function pollVariant(st) {
  let res;
  try {
    res = await fetchWith(st.variant, { method: "GET" }, (r) => r.text());
  } catch (e) {
    return "ok"; // pas de réponse : la même playlist au prochain coup, comme l'app
  }
  if (res.status === 404) return "offline";
  if (res.status !== 200 || typeof res.body !== "string") return "expired";
  const lines = res.body.split("\n");
  const fresh = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].startsWith("#EXTINF")) continue;
    const uri = lines[i + 1].trim();
    if (!uri || uri.startsWith("#") || st.seen.includes(uri)) continue;
    st.seen.push(uri);
    let url;
    try {
      url = new URL(uri, st.variant).href;
    } catch (e) {
      continue;
    }
    if (hlsUrl(url)) fresh.push(url);
  }
  if (st.seen.length > 64) st.seen.splice(0, st.seen.length - 64);
  for (const url of fresh) {
    let r;
    try {
      r = await fetchWith(url, { method: "HEAD" }, () => null);
    } catch (e) {
      continue;
    }
    if (r.status === 401 || r.status === 403) return "expired";
  }
  return "ok";
}

let dropsClaiming = null;

// Drops réclamables de l'inventaire, réclamés (comme refresh(autoClaim:) de
// l'app) ; leurs noms vont dans la pulsation de cette chaîne. Une seule à la fois.
function autoClaimDrops(session, channel) {
  if (dropsClaiming) return dropsClaiming;
  dropsClaiming = (async () => {
    const inventory = await readDropsInventory(session, true).catch(() => []);
    const names = [];
    all: for (const c of inventory) {
      if (c.needsLink) continue;
      for (const d of c.campaign.drops) {
        if (!d.dropInstanceId) continue;
        const fails = mem.claimFails[d.dropInstanceId];
        if (fails && fails.n >= 3) continue;
        try {
          if (await claimDrop(session, d.dropInstanceId, true)) names.push(d.name || d.id);
        } catch (e) {
          // Session partie ou jeton d'intégrité impossible : les suivants échoueraient aussi.
          if (e instanceof TuError && (e.code === "no_session" || e.code === "integrity")) break all;
          mem.claimFails[d.dropInstanceId] = { n: ((fails && fails.n) || 0) + 1, at: Date.now() };
          pruneMap(mem.claimFails, 20);
          save("claimFails");
        }
      }
    }
    const st = mem.dropPulse[channel];
    if (names.length && st) {
      st.claimed = arr(st.claimed).concat(names).slice(-20);
      save("dropPulse");
    }
  })().catch(() => {}).finally(() => {
    dropsClaiming = null;
  });
  return dropsClaiming;
}

function pulseState(channel, fp) {
  let st = mem.dropPulse[channel];
  // Autre compte : rien de l'ancien (minutes et réclamations iraient à l'autre).
  if (!st || st.fp !== fp) {
    st = { fp, variant: null, seen: [], offlineHits: 0, failures: 0, refusals: 0, retryAt: 0, inventoryAt: 0, claimed: [] };
    mem.dropPulse[channel] = st;
  }
  st.at = Date.now();
  pruneMap(mem.dropPulse, 6);
  return st;
}

function takeClaimedNames(st) {
  const names = arr(st.claimed).filter((n) => typeof n === "string").map((n) => n.slice(0, 200));
  st.claimed = [];
  return names;
}

// Un battement de la pulsation de l'app (run), rythmé par le site.
async function opDropsPulse(args, session, settings) {
  const channel = args.channel;
  const ch = await readDropsChannel(session, channel);
  if (!ch.campaignIds.length) {
    delete mem.dropPulse[channel];
    save("dropPulse");
    return { active: false, claimed: [] };
  }
  const st = pulseState(channel, session.fp);
  const now = Date.now();
  let active = false;
  if (!st.variant && !(st.retryAt && now < st.retryAt)) {
    const variant = await lowestVariant(session, channel).catch((e) => {
      if (e instanceof TuError && e.code === "no_session") throw e;
      return null;
    });
    if (!variant && st.offlineHits > 0) st.offlineHits++;   // fin du direct qui se confirme
    else st.failures = variant ? 0 : st.failures + 1;
    st.variant = variant;
    st.retryAt = st.failures > 2 || st.refusals > 2 ? now + LIMIT.pulseRetryMs : 0;
  }
  if (st.variant) {
    const r = await pollVariant(st);
    if (r === "ok") {
      st.offlineHits = 0;
      st.refusals = 0;
      active = true;
    } else if (r === "expired") {
      st.variant = null; // jeton de lecture expiré (~20 min) : un neuf au prochain coup
      st.refusals++;
    } else {
      st.variant = null; // 404 : variante changée ou coupure ; trois de suite, direct fini
      st.offlineHits++;
    }
  }
  if (st.offlineHits >= 3) {
    const names = takeClaimedNames(st);
    delete mem.dropPulse[channel];
    save("dropPulse");
    return { active: false, claimed: names };
  }
  let claiming = null;
  if (settings.autoClaim && now - (st.inventoryAt || 0) >= LIMIT.pulseInventoryMs) {
    st.inventoryAt = now;
    claiming = autoClaimDrops(session, channel);
  } else if (dropsClaiming) {
    claiming = dropsClaiming;
  }
  save("dropPulse");
  if (claiming) await Promise.race([claiming, sleep(LIMIT.pulseClaimWaitMs)]);
  const cur = mem.dropPulse[channel] || st;
  const claimed = takeClaimedNames(cur);
  save("dropPulse");
  return { active, claimed };
}

// --- Récompenses de chaîne (ChannelPointsService.swift de l'app) -------------------------

function normalizeReward(r) {
  if (!r || typeof r.id !== "string" || !TWITCH_ID_RE.test(r.id) || typeof r.title !== "string" ||
      typeof r.cost !== "number" || !Number.isInteger(r.cost)) return null;
  const bg = typeof r.backgroundColor === "string" ? r.backgroundColor.replace(/^#/, "") : "";
  return {
    id: r.id,
    title: r.title,
    cost: r.cost,
    prompt: typeof r.prompt === "string" && r.prompt !== "" ? r.prompt : null,
    requiresInput: r.isUserInputRequired === true,
    enabled: r.isEnabled === true,
    paused: r.isPaused === true,
    inStock: typeof r.isInStock === "boolean" ? r.isInStock : true,
    cooldownEndsAt: null,
    color: /^[0-9A-Fa-f]{3,8}$/.test(bg) ? "#" + bg.toUpperCase() : null,
    imageUrl: httpsUrl(r.image && r.image.url2x) || httpsUrl(r.defaultImage && r.defaultImage.url2x)
  };
}

// Récompenses personnalisées (fetchRewards de l'app), lecture publique.
function readRewards(session, channel, fresh) {
  return cachedRead("rewards:" + channel, LIMIT.readMs, async () => {
    const json = await gql({ query: Q.rewards, variables: { l: channel } }, session, { auth: false });
    const data = json.data;
    if (data && data.channel === null) throw new TuError("twitch", "channel_not_found");
    if (!data || !data.channel || typeof data.channel !== "object") {
      throwGqlErrors(json);
      throw new TuError("twitch", "bad_response");
    }
    const s = data.channel.communityPointsSettings;
    if (!s || s.isEnabled !== true) return { enabled: false, rewards: [] };
    return { enabled: true, rewards: arr(s.customRewards).slice(0, 100).map(normalizeReward).filter(Boolean) };
  }, fresh);
}

// Fin de recharge de chaque récompense (requête brute, pas dans l'app iOS).
// Un échec ne bloque rien : null.
function readRewardCooldowns(session, channel, fresh) {
  return cachedRead("cooldowns:" + channel, LIMIT.readMs, async () => {
    try {
      const json = await gql({ query: Q.rewardCooldowns, variables: { l: channel } }, session, { auth: false });
      const s = json.data && json.data.channel && json.data.channel.communityPointsSettings;
      if (!s || !Array.isArray(s.customRewards)) return null;
      const out = {};
      for (const r of s.customRewards) {
        if (r && typeof r.id === "string") out[r.id] = str(r.cooldownExpiresAt, 40);
      }
      return out;
    } catch (e) {
      return null;
    }
  }, fresh);
}

async function opRewardsGet(args, session) {
  const [pts, rw, cooldowns] = await Promise.all([
    readPoints(session, args.channel),
    readRewards(session, args.channel),
    readRewardCooldowns(session, args.channel)
  ]);
  const rewards = rw.rewards
    .map((r) => Object.assign({}, r, { cooldownEndsAt: cooldowns && has(cooldowns, r.id) ? cooldowns[r.id] : null }))
    .sort((a, b) => a.cost - b.cost);
  return { balance: pts.balance, rewards };
}

function gqlString(s) {
  return JSON.stringify(String(s));
}

// Rachat (redeem de l'app) : même mutation écrite en clair, mêmes champs.
// cost + title + prompt doivent être EXACTEMENT ceux de Twitch (sinon
// PROPERTIES_MISMATCH) : ils viennent de la récompense relue.
async function opRewardsRedeem(args, session) {
  const channel = args.channel;
  const sendBy = Date.now() + LIMIT.spendSendMs;
  const [pts, rw, cooldowns] = await Promise.all([
    readPoints(session, channel, true),
    readRewards(session, channel, true),
    readRewardCooldowns(session, channel, true)
  ]);
  if (!rw.enabled) throw new TuError("bad_args", "points_disabled");
  const r = rw.rewards.find((x) => x.id === args.rewardId);
  if (!r) throw new TuError("bad_args", "rewardId");
  if (!r.enabled) throw new TuError("bad_args", "not_enabled");
  if (r.paused) throw new TuError("bad_args", "paused");
  if (!r.inStock) throw new TuError("bad_args", "out_of_stock");
  const cooldown = cooldowns && cooldowns[r.id] ? Date.parse(cooldowns[r.id]) : NaN;
  if (cooldown > Date.now()) throw new TuError("bad_args", "cooldown");
  if (args.cost !== r.cost) throw new TuError("bad_args", "cost");
  if (args.title !== r.title) throw new TuError("bad_args", "title");
  if (r.cost > pts.balance) throw new TuError("bad_args", "points");
  if (r.requiresInput) {
    if (typeof args.input !== "string" || !args.input.trim()) throw new TuError("bad_args", "input");
  } else if (args.input !== null) {
    throw new TuError("bad_args", "input");
  }

  const promptText = r.requiresInput ? args.input : (r.prompt || "");
  const promptField = promptText ? "prompt: " + gqlString(promptText) : "prompt: null";
  const text = "mutation { redeemCommunityPointsCustomReward(input: { " +
    "channelID: " + gqlString(pts.channelId) + ", cost: " + r.cost + ", " + promptField + ", " +
    "rewardID: " + gqlString(r.id) + ", title: " + gqlString(r.title) + ", transactionID: " + gqlString(crypto.randomUUID()) +
    " }) { redemption { id } error { code } } }";
  const res = await mutation({ query: text }, session, { sendBy });
  const result = res.data && res.data.redeemCommunityPointsCustomReward;
  if (!result || typeof result !== "object") {
    throwGqlErrors(res);
    throw new TuError("twitch", "bad_response");
  }
  if (result.error && result.error.code) throw new TuError("twitch", safeCode(result.error.code));
  invalidate(session, channel, ["points"]);
  readCache.delete("rewards:" + channel);
  readCache.delete("cooldowns:" + channel);
  return { balance: Math.max(0, pts.balance - r.cost) };
}

const OPS = {
  "points.get": opPointsGet,
  "points.claim": opPointsClaim,
  "watch.beat": opWatchBeat,
  "predictions.get": opPredictionsGet,
  "predictions.bet": opPredictionsBet,
  "polls.get": opPollsGet,
  "polls.vote": opPollsVote,
  "raid.join": opRaidJoin,
  "drops.get": opDropsGet,
  "drops.claim": opDropsClaim,
  "drops.pulse": opDropsPulse,
  "rewards.get": opRewardsGet,
  "rewards.redeem": opRewardsRedeem
};

function asResponse(promise) {
  return promise.then(ok, (e) => (e instanceof TuError ? fail(e.code, e.detail) : fail("internal")));
}

// --- Aiguillage des demandes du site -----------------------------------------------------

async function handleSiteRequest(msg) {
  await loadState();
  if (!takeGlobal()) return fail("rate_limited");
  if (typeof msg.id !== "string" || msg.id.length < 1 || msg.id.length > 64) return fail("bad_args", "id");
  const op = msg.op;
  if (typeof op !== "string" || !has(OP_ARGS, op)) return fail("unknown_op");
  const checked = checkArgs(op, msg.args);
  if (!checked.args) return fail("bad_args", checked.bad);
  const args = checked.args;
  const settings = await getSettings();

  if (op === "hello") {
    return ok({ protocol: PROTOCOL, version: VERSION, enabled: settings.siteEnabled, browser: BROWSER });
  }
  if (!settings.siteEnabled) {
    // Connexion coupée : le site n'apprend rien d'autre.
    if (op === "status") {
      return ok({ enabled: false, session: null, settings: { autoClaim: settings.autoClaim, allowSpend: settings.allowSpend } });
    }
    return fail("disabled");
  }
  const spend = SPEND_OPS.includes(op);
  if (spend) {
    if (!settings.allowSpend) return fail("spend_disabled");
    if (msg.activation !== true) return fail("needs_activation");
  }
  if (op === "raid.join") {
    const prev = mem.raidJoins[args.raidId];
    const now = Date.now();
    if (prev && prev.res && prev.at <= now && now - prev.at < LIMIT.raidKeepMs) return prev.res;
    if (!takeSlot("raid:" + args.channel, LIMIT.raidMs)) return fail("rate_limited");
  }
  if (op === "points.claim" && !takeSlot("claim", LIMIT.claimMs)) return fail("rate_limited");
  if (op === "watch.beat" && !takeSlot("beat:" + args.channel, LIMIT.beatMs)) return fail("rate_limited");
  if (op === "drops.claim" && !takeSlot("dropsClaim", LIMIT.dropsClaimMs)) return fail("rate_limited");
  if (op === "drops.pulse" && !takeSlot("pulse:" + args.channel, LIMIT.pulseMs)) return fail("rate_limited");
  if (spend && !takeSlot("spend", LIMIT.spendMs)) return fail("rate_limited");

  try {
    if (op === "status") return ok(await opStatus(settings));
    const session = await readSession();
    if (!session) return fail("no_session");
    const res = await asResponse(OPS[op](args, session, settings));
    return op === "raid.join" ? rememberRaid(args.raidId, res) : res;
  } catch (e) {
    return e instanceof TuError ? fail(e.code, e.detail) : fail("internal");
  }
}

// --- Fenêtre de l'extension ------------------------------------------------------------------

async function popupState() {
  const settings = await getSettings();
  const out = { version: VERSION, browser: BROWSER, settings, session: { state: "none" }, integrity: null };
  const s = await readSession();
  if (!s) return out;
  try {
    const u = await sessionUser(s);
    out.session = { state: "ok", login: u.login, userId: u.userId };
  } catch (e) {
    out.session = { state: e instanceof TuError && e.code === "no_session" ? "invalid" : "error" };
  }
  const it = mem.integrity;
  if (it && it.fp === s.fp && it.expiresAt > Date.now()) out.integrity = { until: it.expiresAt };
  return out;
}

// Diagnostic : session revalidée et jeton d'intégrité obtenu à nouveau. Les
// jetons ne sont rendus que masqués (4 premiers caractères et longueur).
async function runDiagnose() {
  const out = { session: null, integrity: null };
  const s = await readSession();
  if (!s) {
    out.session = { ok: false, code: "no_session" };
    return out;
  }
  try {
    const u = await sessionUser(s, true);
    out.session = { ok: true, login: u.login, userId: u.userId, clientId: u.clientId, token: mask(s.token) };
  } catch (e) {
    const code = e instanceof TuError ? e.code : "internal";
    out.session = { ok: false, code: code === "no_session" ? "invalid" : code, detail: e instanceof TuError ? safeDetail(e.detail) : "" };
    return out;
  }
  try {
    const it = await getIntegrity(s, { force: true, manual: true });
    out.integrity = { ok: true, token: mask(it.token), until: it.expiresAt, device: mask(it.deviceId), via: it.via };
  } catch (e) {
    out.integrity = { ok: false, detail: safeDetail(lastMintFail) };
  }
  return out;
}

let diagnosing = null;

async function handlePopup(msg) {
  await loadState();
  if (msg.cmd === "state") return popupState();
  if (msg.cmd === "diagnose") {
    if (!diagnosing) diagnosing = runDiagnose().finally(() => { diagnosing = null; });
    return diagnosing;
  }
  return null;
}

// --- Expéditeurs ------------------------------------------------------------------------------

// Content script de cette extension, cadre principal d'un onglet du site.
function fromSite(sender) {
  if (!sender || sender.id !== api.runtime.id) return false;
  if (sender.frameId !== 0) return false;
  if (!sender.tab || typeof sender.tab.id !== "number" || sender.tab.incognito) return false;
  const origin = originOf(sender.url);
  if (!origin || !SITE_ORIGINS.includes(origin)) return false;
  if (typeof sender.origin === "string" && sender.origin !== origin) return false;
  return true;
}

// Page de l'extension (la fenêtre), jamais un content script.
function fromExtensionPage(sender) {
  return !!sender && sender.id === api.runtime.id && typeof sender.url === "string" &&
    sender.url.startsWith(EXTENSION_BASE);
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;
  if (msg.tuPopup === 1) {
    if (!fromExtensionPage(sender)) return false;
    handlePopup(msg).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.tuConnect === 1 && msg.kind === "op") {
    if (!fromSite(sender)) return false;
    handleSiteRequest(msg).then(sendResponse, () => sendResponse(fail("internal")));
    return true;
  }
  return false;
});

// --- Onglets du site déjà ouverts ----------------------------------------------------------

// Onglets du site, hors navigation privée (refusée par fromSite).
async function siteTabs() {
  let tabs = [];
  try {
    tabs = await api.tabs.query({ url: SITE_ORIGINS.map((o) => o + "/*") });
  } catch (e) {
    tabs = [];
  }
  return arr(tabs).filter((t) => t && typeof t.id === "number" && !t.incognito && !t.discarded &&
    SITE_ORIGINS.includes(originOf(t.url)));
}

// Réglage changé dans la fenêtre : nouvelle annonce `hello` dans les onglets
// du site, qui suit tout de suite (sinon il relit l'état toutes les 5 min).
async function announceToSite() {
  const settings = await getSettings();
  for (const t of await siteTabs()) {
    try {
      const p = api.tabs.sendMessage(t.id, { tuConnect: 1, kind: "announce", enabled: settings.siteEnabled }, { frameId: 0 });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {
      // pas de content script dans cet onglet
    }
  }
}

// Installation ou mise à jour : Chrome n'injecte pas le content script dans
// les onglets déjà ouverts, et l'ancien, orphelin, se tait. content.js ne fait
// rien si un script valide y tourne déjà (Firefox l'injecte lui-même).
async function injectIntoSiteTabs() {
  for (const t of await siteTabs()) {
    try {
      await api.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] });
    } catch (e) {
      // page pas chargée, page d'erreur, accès retiré
    }
  }
}

api.runtime.onInstalled.addListener(() => {
  getSettings()
    .then((s) => api.storage.local.set({ settings: s }))
    .catch(() => {});
  injectIntoSiteTabs().catch(() => {});
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes && changes.settings) announceToSite().catch(() => {});
});

// storage.session reste fermé aux content scripts (valeur par défaut sous
// Chrome, redite ici) ; storage.local aussi quand le navigateur le permet.
for (const area of [api.storage.session, api.storage.local]) {
  try {
    if (area && typeof area.setAccessLevel === "function") {
      const p = area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch (e) {
    // pas pris en charge ici
  }
}

cleanupMintTab().catch(() => {});
