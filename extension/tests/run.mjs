// Banc d'essai de TwitchUnblock Connect, sans dépendance : node extension/tests/run.mjs
//
// background.js et content.js tournent dans des contextes `vm` avec des API
// chrome simulées. Twitch est simulé lui aussi : `fetch` ne connaît que les
// adresses prévues et lève une erreur pour toute autre. AUCUNE requête réseau.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { firefoxManifest } from "../dev/build-firefox.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKGROUND = readFileSync(join(DIR, "background.js"), "utf8");
const CONTENT = readFileSync(join(DIR, "content.js"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));

// --- Données simulées ---------------------------------------------------------

const SITE = "https://twitchunblock.vercel.app";
const PREVIEW = "https://test2-git-test-17d298-mxfia19s-projects.vercel.app";
const EXT_ID = "testextensionid";
const EXT_BASE = "chrome-extension://" + EXT_ID + "/";
const AUTH_TOKEN = "zq7secretauthtoken0123456789xy";
const UNIQUE_ID = "UniqDev0123456789abcdefABCDEF0123";
const INTEGRITY_PREFIX = "v4.public.SECRETkasadaTOKENpayload0123456789abcdefghijklmnop";
const CHANNEL = "streamer_one";
const CHANNEL_ID = "123456";
const SPADE = "https://video-edge-abc123.fra05.abs.hls.ttvnw.net/v1/segment/CuYEsecret.ts";
const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const TWITCH_TABS = "https://www.twitch.tv/*";

// Hashes attendus (ceux de l'app iOS ; JoinRaid : celui fourni, non vérifié).
const HASHES = {
  ClaimCommunityPoints: "46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0",
  BatchGetWatchStreaks: "7d04fbaa5bb32d193c742caa2c855dfde371a2a8cb25afed5b5c3d45f5ee9278",
  ChannelPointsPredictionContext: "beb846598256b75bd7c1fe54a80431335996153e358ca9c7837ce7bb83d7d383",
  MakePrediction: "b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8",
  ChannelPollContext_GetViewablePoll: "e83188a3836c636393df3191665e543a03733d7c51d3ade3d85e42aa46c2bf55",
  ChannelPollContext_VoteInPoll: "1280e27b0f3c7ae60b5714bd569771ea50635778473182e6e959e2dcfcc16e3c",
  JoinRaid: "c6a332a86d1087fbbb1a8623aa01bd1313d2386e7c63be60fdb2d1901f01a4ae",
  DropsPage_ClaimDropRewards: "a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930"
};

// Qualités supérieures : liste du compte (usher avec supported_codecs) et
// playlist de sa variante 1440p, avec tout ce qui ne doit pas aller à la page
// (« …secret », adresse IP, déclencheur signé, suivi publicitaire).
const HQ_HOST = "https://euw31.playlist.ttvnw.net/v1/playlist/";
const HQ_MASTER = [
  "#EXTM3U",
  '#EXT-X-TWITCH-INFO:NODE="video-edge-aa11.fra05",USER-IP="203.0.113.7",SERVING-ID="SERVINGsecret",CLUSTER="fra05"',
  '#EXT-X-SESSION-DATA:DATA-ID="com.twitch.session",VALUE="SESSIONsecret"',
  '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1440p60 (source)",AUTOSELECT=YES,DEFAULT=YES',
  '#EXT-X-STREAM-INF:BANDWIDTH=9500000,RESOLUTION=2560x1440,CODECS="hvc1.1.2.L150.90.0.0.0.0.0,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000',
  HQ_HOST + "HQ1440secret.m3u8",
  '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="1080p60",NAME="1080p60",AUTOSELECT=YES,DEFAULT=YES',
  '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="1080p60",FRAME-RATE=60.000',
  HQ_HOST + "HQ1080secret.m3u8",
  '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES',
  '#EXT-X-STREAM-INF:BANDWIDTH=3400000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="720p60",FRAME-RATE=60.000',
  "https://evil.example/HQ720secret.m3u8",
  '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="audio_only",NAME="audio_only",AUTOSELECT=NO,DEFAULT=NO',
  '#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"',
  HQ_HOST + "HQAUDIOsecret.m3u8",
  ""
].join("\n");
// Autre forme possible d'une adresse de variante : la partie signée dans un
// dossier, sur un hôte *.hls.ttvnw.net (accepté pour les variantes).
const HQ_WEAVER = "https://video-weaver.fra05.hls.ttvnw.net/v1/HQDIRsecret/";
const HQ_SEG = "https://video-edge-aa11.fra05.abs.hls.ttvnw.net/v1/segment/";
const HQ_CF = "https://cd1f0315f30a.j.cloudfront.hls.ttvnw.net/v1/segment/";
const HQ_PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-VERSION:6",
  "#EXT-X-TARGETDURATION:6",
  "#EXT-X-MEDIA-SEQUENCE:100",
  "#EXT-X-TWITCH-LIVE-SEQUENCE:100",
  "#EXT-X-TWITCH-ELAPSED-SECS:200.000",
  '#EXT-X-DATERANGE:ID="playlist-session-1",CLASS="twitch-session",START-DATE="2026-10-25T16:42:21.913Z",END-ON-NEXT=YES,X-TV-TWITCH-SESSIONID="SESSIONIDsecret"',
  '#EXT-X-DATERANGE:ID="trigger-1",CLASS="twitch-trigger",START-DATE="2026-10-25T16:41:51.237Z",END-ON-NEXT=YES,X-TV-TWITCH-TRIGGER-URL="https://euw31.playlist.ttvnw.net/trigger/TRIGGERsecret"',
  '#EXT-X-DATERANGE:ID="stitched-ad-1-30",CLASS="twitch-stitched-ad",START-DATE="2026-10-25T16:42:00.000Z",DURATION=30.000,X-TV-TWITCH-AD-ROLL-TYPE="MIDROLL",X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ads.example/c?u=ADTRACKsecret"',
  '#EXT-X-MAP:URI="' + HQ_SEG + 'INIThq.mp4"',
  "#EXT-X-PROGRAM-DATE-TIME:2026-10-25T16:41:51.237Z",
  "#EXTINF:2.000,live",
  HQ_SEG + "SEGhq1.mp4?dna=abc",
  "#EXT-X-DISCONTINUITY",
  "#EXTINF:2.000,Amazon|123",
  "seg2.mp4",
  "#EXTINF:2.000,live",
  "https://ads.example/ad.ts",
  "#EXT-X-SCTE35-OUT:CUE=ADTRACKsecret",
  "#EXTINF:2.000,live",
  HQ_CF + "SEGhq4.mp4",
  "#EXT-X-TWITCH-PREFETCH:" + HQ_CF + "SEGhq5.mp4",
  "#EXT-X-TWITCH-PREFETCH:" + HQ_HOST + "PREFETCHsecret.m3u8",
  ""
].join("\n");
// Ce que la page doit recevoir de HQ_PLAYLIST, à l'octet près.
const HQ_PLAYLIST_CLEAN = [
  "#EXTM3U",
  "#EXT-X-VERSION:6",
  "#EXT-X-TARGETDURATION:6",
  "#EXT-X-MEDIA-SEQUENCE:100",
  '#EXT-X-DATERANGE:ID="stitched-ad-1-30",CLASS="twitch-stitched-ad",START-DATE="2026-10-25T16:42:00.000Z",DURATION=30.000',
  '#EXT-X-MAP:URI="' + HQ_SEG + 'INIThq.mp4"',
  "#EXT-X-PROGRAM-DATE-TIME:2026-10-25T16:41:51.237Z",
  "#EXTINF:2.000,live",
  HQ_SEG + "SEGhq1.mp4?dna=abc",
  "#EXT-X-DISCONTINUITY",
  "#EXTINF:2.000,Amazon|123",
  "#EXT-X-GAP",
  "https://gap.invalid/1.ts",
  "#EXTINF:2.000,live",
  "#EXT-X-GAP",
  "https://gap.invalid/2.ts",
  "#EXTINF:2.000,live",
  HQ_CF + "SEGhq4.mp4",
  "#EXT-X-TWITCH-PREFETCH:" + HQ_CF + "SEGhq5.mp4",
  ""
].join("\n");

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const ticks = async (n = 1) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
// Empreinte d'un jeton, comme fingerprint() de l'arrière-plan.
async function fingerprintOf(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

function makeTwitch() {
  return {
    loggedIn: true,
    balance: 1000,
    claimId: "c1a2b3c4-0000-4000-8000-000000000001",
    live: true,
    streamId: "4242424242",
    login: "viewer_one",
    userId: "99887766",
    look: { name: "Gems", image: { url2x: "https://static-cdn.jtvnw.net/channel-points-icons/123/2x.png" } },
    streaks: [{ channel: { id: CHANNEL_ID }, value: 7 }, { channel: { id: "1" }, value: 2 }],
    prediction: null,       // { id, title, status, createdAt, predictionWindowSeconds, outcomes }
    predictionLocked: false,
    predSelf: null,         // { outcomeId, points }
    resolved: [],           // [{ id, winningOutcome }]
    poll: null,
    raidPQNF: false,
    integrityFailNext: 0,
    gqlErrorText: null,     // message d'erreur GQL forcé sur la lecture du solde
    validIntegrity: new Set(),
    minted: [],
    mintFailNext: 0,
    log: [],                // toutes les requêtes reçues
    spadePosts: [],
    // Drops
    channelCampaigns: ["camp-1", "camp-2"],
    inventory: [
      {
        id: "camp-1", name: "Season drops", status: "ACTIVE", startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-30T00:00:00Z",
        accountLinkURL: "https://www.twitch.tv/", self: { isAccountConnected: true },
        game: { displayName: "Some Game", boxArtURL: "https://static-cdn.jtvnw.net/ttv-boxart/1-144x192.jpg" },
        timeBasedDrops: [
          { id: "drop-1a", name: "Hat", requiredMinutesWatched: 60,
            benefitEdges: [{ benefit: { name: "Cool hat", imageAssetURL: "https://static-cdn.jtvnw.net/drops/hat.png" } }],
            self: { hasPreconditionsMet: true, currentMinutesWatched: 40, isClaimed: false, dropInstanceID: null } },
          { id: "drop-1b", name: "Cape", requiredMinutesWatched: 30,
            benefitEdges: [{ benefit: { name: "Red cape", imageAssetURL: "https://static-cdn.jtvnw.net/drops/cape.png" } }],
            self: { hasPreconditionsMet: true, currentMinutesWatched: 30, isClaimed: false, dropInstanceID: "inst#drop-1b" } }
        ]
      },
      {
        id: "camp-linked", name: "Needs a game account", status: "ACTIVE", endAt: "2026-10-25T00:00:00Z",
        accountLinkURL: "https://game.example/link", self: { isAccountConnected: false }, game: { displayName: "Other Game" },
        timeBasedDrops: [{ id: "drop-l1", name: "Skin", requiredMinutesWatched: 10, benefitEdges: [],
          self: { currentMinutesWatched: 10, isClaimed: false, dropInstanceID: "inst#drop-l1" } }]
      }
    ],
    dashboard: [{
      id: "camp-2", name: "Later drops", status: "ACTIVE", endAt: "2026-11-30T00:00:00Z", game: { displayName: "Some Game" },
      timeBasedDrops: [{ id: "drop-2a", name: "Mount", requiredMinutesWatched: 120,
        benefitEdges: [{ benefit: { name: "Horse", imageAssetURL: "https://static-cdn.jtvnw.net/drops/horse.png" } }] }]
    }],
    dashboardNeedsIntegrity: true,
    dropSession: { channel: { displayName: "Streamer_One" }, currentMinutesWatched: 42, requiredMinutesWatched: 60, dropID: "drop-1a" },
    dropClaims: [],
    dropClaimStatus: "ELIGIBLE_FOR_ALL",
    patValue: '{"adblock":false,"authorization":{"forbidden":false},"channel":"streamer_one","user_id":99887766,"expires":1800000000}',
    patSignature: "sig0123456789abcdefSECRETsignature",
    patNeedsIntegrity: false,
    usherCalls: 0,
    // Plus basse qualité donnée par usher pour les drops (playlist.ttvnw.net aujourd'hui).
    audioVariant: "https://video-weaver.fra05.hls.ttvnw.net/v1/playlist/AUDIOsecret.m3u8",
    segments: [1, 2, 3].map((n) => "https://video-edge-aa11.fra05.abs.hls.ttvnw.net/v1/segment/SEGsecret" + n + ".ts"),
    variantStatus: 200,
    heads: [],
    // Qualités supérieures
    hqUsher: [],            // paramètres des demandes usher avec supported_codecs
    hqMasterStatus: 200,
    hqVariantStatus: 200,
    hqPlaylistCalls: 0,
    hqMaster: HQ_MASTER,    // liste maîtresse du compte servie par usher
    hqPlaylist: HQ_PLAYLIST, // playlist servie pour chaque variante
    // Récompenses
    rewards: [
      { id: "rw-hydrate", title: "Hydrate!", cost: 500, isEnabled: true, isPaused: false, isInStock: true, isUserInputRequired: false,
        prompt: "Drink \"water\"\nnow", backgroundColor: "#9147ff", image: null,
        defaultImage: { url2x: "https://static-cdn.jtvnw.net/custom-reward-images/default-2.png" } },
      { id: "rw-song", title: "Song request", cost: 200, isEnabled: true, isPaused: false, isInStock: true, isUserInputRequired: true,
        prompt: "Name a song", backgroundColor: "00C389", image: { url2x: "https://static-cdn.jtvnw.net/custom-reward-images/song-2.png" } },
      { id: "rw-paused", title: "Paused", cost: 100, isEnabled: true, isPaused: true, isInStock: true, isUserInputRequired: false, prompt: null },
      { id: "rw-off", title: "Off", cost: 50, isEnabled: false, isPaused: false, isInStock: true, isUserInputRequired: false, prompt: "" },
      { id: "rw-stock", title: "Gone", cost: 60, isEnabled: true, isPaused: false, isInStock: false, isUserInputRequired: false, prompt: null },
      { id: "rw-cool", title: "Cooling", cost: 70, isEnabled: true, isPaused: false, isInStock: true, isUserInputRequired: false, prompt: null }
    ],
    cooldowns: {},
    redeemError: null,
    lastRedeem: null
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => (typeof body === "string" ? JSON.parse(body) : clone(body)),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  };
}

function twitchFetch(tw) {
  return async (url, init = {}) => {
    const headers = init.headers || {};
    tw.log.push({ url, init: clone({ ...init, signal: undefined }) });
    assert.equal(init.credentials, "omit", "toute requête part sans cookie : " + url);

    if (url === "https://id.twitch.tv/oauth2/validate") {
      if (headers.Authorization !== "OAuth " + AUTH_TOKEN || !tw.loggedIn) return response(401, { status: 401 });
      return response(200, { client_id: CLIENT_ID, login: tw.login, user_id: tw.userId, scopes: [], expires_in: 5000000 });
    }

    if (url === "https://gql.twitch.tv/gql") {
      assert.equal(headers["Client-ID"], CLIENT_ID);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      if (headers.Authorization !== undefined && (headers.Authorization !== "OAuth " + AUTH_TOKEN || !tw.loggedIn)) {
        return response(401, { error: "Unauthorized" });
      }
      const body = JSON.parse(init.body);
      if (Array.isArray(body)) return response(200, persistedOp(tw, body[0], headers));
      return response(200, rawQuery(tw, body, headers));
    }

    if (url === "https://www.twitch.tv/" + CHANNEL) {
      return response(200, '<html><script>window.__twilightSettings = {"spade_url":"' + SPADE.replace(/\//g, "\\/") + '"}</script></html>');
    }

    if (url === SPADE) {
      assert.equal(init.method, "POST");
      assert.equal(init.mode, "no-cors");
      tw.spadePosts.push(init.body);
      return response(0, "");
    }

    if (url.startsWith("https://usher.ttvnw.net/api/channel/hls/" + CHANNEL + ".m3u8?")) {
      tw.usherCalls++;
      const q = new URL(url).searchParams;
      assert.equal(q.get("allow_source"), "true");
      assert.equal(q.get("allow_audio_only"), "true");
      assert.equal(q.get("sig"), tw.patSignature);
      assert.equal(q.get("token"), tw.patValue);
      if (q.has("supported_codecs")) {
        tw.hqUsher.push(Object.fromEntries(q));
        if (tw.hqMasterStatus !== 200) return response(tw.hqMasterStatus, "");
        return response(200, tw.hqMaster);
      }
      return response(200, [
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080",
        "https://video-weaver.fra05.hls.ttvnw.net/v1/playlist/SOURCEsecret.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS=\"mp4a.40.2\"",
        tw.audioVariant,
        ""
      ].join("\n"));
    }

    if (url === tw.audioVariant) {
      if (tw.variantStatus !== 200) return response(tw.variantStatus, "");
      return response(200, "#EXTM3U\n#EXT-X-TARGETDURATION:2\n" + tw.segments.map((s) => "#EXTINF:2.000,live\n" + s).join("\n") + "\n");
    }

    if (url.startsWith(HQ_HOST) || url.startsWith(HQ_WEAVER)) {
      assert.ok(/\/HQ(1440|1080|AUDIO)secret\.m3u8$/.test(url) || url === HQ_WEAVER + "index.m3u8", "variante de la liste du compte : " + url);
      assert.equal(init.method, "GET");
      tw.hqPlaylistCalls++;
      if (tw.hqVariantStatus !== 200) return response(tw.hqVariantStatus, "");
      return response(200, tw.hqPlaylist);
    }

    if (url.startsWith("https://video-edge-aa11.fra05.abs.hls.ttvnw.net/v1/segment/")) {
      assert.equal(init.method, "HEAD", "segments demandés en HEAD seulement");
      tw.heads.push(url);
      return response(200, "");
    }

    throw new TypeError("adresse inattendue (pas de réseau dans les essais) : " + url);
  };
}

function needIntegrity(tw, headers) {
  const tok = headers["Client-Integrity"];
  assert.ok(tok, "mutation sans Client-Integrity");
  assert.equal(headers.Authorization, "OAuth " + AUTH_TOKEN);
  assert.equal(headers["X-Device-Id"], UNIQUE_ID, "X-Device-Id = cookie unique_id");
  if (tw.integrityFailNext > 0 || !tw.validIntegrity.has(tok)) {
    if (tw.integrityFailNext > 0) tw.integrityFailNext--;
    return [{ errors: [{ message: "failed integrity check" }], data: null }];
  }
  return null;
}

function predictionEvent(tw) {
  return {
    id: tw.prediction.id,
    title: tw.prediction.title,
    status: tw.predictionLocked ? "LOCKED" : "ACTIVE",
    createdAt: "2026-10-20T18:00:00Z",
    predictionWindowSeconds: 120,
    outcomes: tw.prediction.outcomes
  };
}

function persistedOp(tw, op, headers) {
  const name = op.operationName;
  if (op.query) return [rawMutation(tw, op, headers)];
  assert.equal(op.extensions.persistedQuery.sha256Hash, HASHES[name], "hash de " + name);
  assert.equal(op.extensions.persistedQuery.version, 1);
  const v = op.variables;
  switch (name) {
    case "BatchGetWatchStreaks":
      assert.deepEqual(v, {});
      return [{ data: { batchGetWatchStreaks: tw.streaks } }];
    case "ChannelPointsPredictionContext": {
      assert.deepEqual(v, { count: 1, channelLogin: CHANNEL });
      const ev = tw.prediction ? predictionEvent(tw) : null;
      return [{ data: { community: { channel: {
        activePredictionEvents: ev && !tw.predictionLocked ? [ev] : [],
        lockedPredictionEvents: ev && tw.predictionLocked ? [ev] : []
      } } } }];
    }
    case "ChannelPollContext_GetViewablePoll":
      assert.deepEqual(v, { login: CHANNEL });
      return [{ data: { channel: { viewablePoll: tw.poll } } }];
    case "ClaimCommunityPoints": {
      const bad = needIntegrity(tw, headers);
      if (bad) return bad[0];
      assert.equal(v.input.channelID, CHANNEL_ID);
      if (v.input.claimID !== tw.claimId) return { data: { claimCommunityPoints: { error: { code: "NOT_FOUND" } } } };
      tw.claimId = null;
      tw.balance += 50;
      return { data: { claimCommunityPoints: { claim: { id: v.input.claimID }, currentPoints: tw.balance, error: null } } };
    }
    case "MakePrediction": {
      const bad = needIntegrity(tw, headers);
      if (bad) return bad[0];
      assert.match(v.input.transactionID, /^[0-9a-f]{32}$/);
      tw.balance -= v.input.points;
      const prev = tw.predSelf && tw.predSelf.outcomeId === v.input.outcomeID ? tw.predSelf.points : 0;
      tw.predSelf = { outcomeId: v.input.outcomeID, points: prev + v.input.points };
      tw.lastBet = v.input;
      return { data: { makePrediction: { prediction: { id: "p1" }, error: null } } };
    }
    case "ChannelPollContext_VoteInPoll": {
      const bad = needIntegrity(tw, headers);
      if (bad) return bad[0];
      assert.match(v.input.voteID, /^[0-9a-f]{32}$/);
      tw.lastVote = v.input;
      return { data: { voteInPoll: { vote: { id: "v1" } } } };
    }
    case "JoinRaid": {
      const bad = needIntegrity(tw, headers);
      if (bad) return bad[0];
      if (tw.raidPQNF) return { errors: [{ message: "PersistedQueryNotFound" }] };
      tw.lastRaid = { how: "persisted", input: v.input };
      return { data: { joinRaid: { raidID: v.input.raidID } } };
    }
    case "DropsPage_ClaimDropRewards": {
      const bad = needIntegrity(tw, headers);
      if (bad) return bad[0];
      assert.deepEqual(Object.keys(v.input), ["dropInstanceID"]);
      tw.dropClaims.push(v.input.dropInstanceID);
      for (const c of tw.inventory) {
        for (const d of c.timeBasedDrops) {
          if (d.self && d.self.dropInstanceID === v.input.dropInstanceID) d.self.isClaimed = true;
        }
      }
      return { data: { claimDropRewards: { status: tw.dropClaimStatus } } };
    }
    default:
      throw new Error("opération inconnue : " + name);
  }
}

function rawMutation(tw, op, headers) {
  assert.equal(op.operationName, "JoinRaid");
  assert.match(op.query, /^mutation JoinRaid\(\$input: JoinRaidInput!\) \{ joinRaid\(input: \$input\) \{ raidID \} \}$/);
  const bad = needIntegrity(tw, headers);
  if (bad) return bad[0];
  tw.lastRaid = { how: "raw", input: op.variables.input };
  return { data: { joinRaid: { raidID: op.variables.input.raidID } } };
}

function rawQuery(tw, body, headers) {
  const q = body.query;
  // Sans variable de chaîne : inventaire, tableau de bord, drop en cours, rachat.
  if (q.includes("dropCampaignsInProgress")) {
    assert.equal(headers.Authorization, "OAuth " + AUTH_TOKEN, "inventaire lu avec la session");
    assert.equal(headers["Client-Integrity"], undefined);
    return { data: { currentUser: { inventory: { dropCampaignsInProgress: tw.inventory } } } };
  }
  if (q.includes("currentUser { dropCampaigns {")) {
    assert.ok(headers.Authorization);
    if (tw.dashboardNeedsIntegrity && !tw.validIntegrity.has(headers["Client-Integrity"])) {
      return { errors: [{ message: "failed integrity check" }], data: null };
    }
    return { data: { currentUser: { dropCampaigns: tw.dashboard } } };
  }
  if (q.includes("dropCurrentSession")) {
    assert.deepEqual(body.variables, { c: CHANNEL_ID });
    return { data: { currentUser: { dropCurrentSession: tw.dropSession } } };
  }
  if (q.startsWith("mutation { redeemCommunityPointsCustomReward(")) {
    const bad = needIntegrity(tw, headers);
    if (bad) return bad[0];
    tw.lastRedeem = q;
    if (tw.redeemError) return { data: { redeemCommunityPointsCustomReward: { redemption: null, error: { code: tw.redeemError } } } };
    const cost = Number(/cost: (\d+),/.exec(q)[1]);
    tw.balance -= cost;
    return { data: { redeemCommunityPointsCustomReward: { redemption: { id: "rd-1" }, error: null } } };
  }
  if (q.includes("viewerDropCampaigns")) {
    assert.equal(headers.Authorization, undefined, "campagnes de la chaîne : lecture publique");
    const list = body.variables.l === CHANNEL ? tw.channelCampaigns : [];
    return { data: { user: { id: body.variables.l === CHANNEL ? CHANNEL_ID : "777", channel: { viewerDropCampaigns: list.map((id) => ({ id })) } } } };
  }
  assert.equal(body.variables.l, CHANNEL);
  if (q.includes("streamPlaybackAccessToken")) {
    assert.equal(headers.Authorization, "OAuth " + AUTH_TOKEN, "jeton de lecture AU NOM DU COMPTE");
    assert.ok(q.includes('params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}'));
    if (tw.patNeedsIntegrity && !tw.validIntegrity.has(headers["Client-Integrity"])) {
      return { errors: [{ message: "failed integrity check" }], data: null };
    }
    return { data: { streamPlaybackAccessToken: { value: tw.patValue, signature: tw.patSignature } } };
  }
  if (q.includes("cooldownExpiresAt")) {
    return { data: { channel: { communityPointsSettings: { customRewards: tw.rewards.map((r) => ({ id: r.id, cooldownExpiresAt: tw.cooldowns[r.id] || null })) } } } };
  }
  if (q.includes("customRewards { id title cost")) {
    assert.equal(headers.Authorization, undefined, "récompenses : lecture publique, comme l'app");
    return { data: { channel: { communityPointsSettings: { isEnabled: true, customRewards: tw.rewards } } } };
  }
  if (q.includes("communityPoints { balance")) {
    assert.ok(headers.Authorization, "solde lu avec la session");
    if (tw.gqlErrorText) return { errors: [{ message: tw.gqlErrorText }], data: null };
    return { data: { channel: { id: CHANNEL_ID, self: { communityPoints: { balance: tw.balance, availableClaim: tw.claimId ? { id: tw.claimId } : null } } } } };
  }
  if (q.includes("communityPointsSettings")) {
    assert.equal(headers.Authorization, undefined, "nom des points : lecture publique");
    return { data: { channel: { communityPointsSettings: tw.look } } };
  }
  if (q.includes("user(login: $l) { stream { id } }")) {
    assert.equal(headers.Authorization, undefined, "direct : lecture publique");
    return { data: { user: { stream: tw.live ? { id: tw.streamId } : null } } };
  }
  if (q.includes("self { prediction")) {
    const ev = tw.prediction ? { id: tw.prediction.id, self: { prediction: tw.predSelf ? { points: tw.predSelf.points, outcome: { id: tw.predSelf.outcomeId } } : null } } : null;
    return { data: { channel: {
      activePredictionEvents: ev && !tw.predictionLocked ? [ev] : [],
      lockedPredictionEvents: ev && tw.predictionLocked ? [ev] : []
    } } };
  }
  if (q.includes("resolvedPredictionEvents")) {
    return { data: { channel: { resolvedPredictionEvents: { edges: tw.resolved.map((n) => ({ node: n })) } } } };
  }
  throw new Error("requête inattendue : " + q);
}

// --- API chrome simulées ------------------------------------------------------------

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (f) => listeners.push(f),
    removeListener: (f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
    hasListener: (f) => listeners.includes(f)
  };
}

function makeArea(data) {
  return {
    data,
    async get(keys) {
      const out = {};
      const list = keys === null || keys === undefined ? Object.keys(data) : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = clone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
    async setAccessLevel() {}
  };
}

function loadBackground(opts = {}) {
  const tw = opts.tw || makeTwitch();
  const clock = opts.clock || { now: 1_800_000_000_000 };
  const session = opts.session || {};
  const local = opts.local || {};
  const consoleLines = [];
  const tabs = new Map((opts.tabs || []).map((t) => [t.id, { status: "complete", active: false, discarded: false, incognito: false, ...t }]));
  const tabLog = { created: [], updated: [], removed: [], scripts: [], injected: [], messages: [] };
  const windows = opts.windows || [{ id: 1, type: "normal", focused: true, incognito: false }];
  let nextTab = 500;
  const cookies = { "auth-token": AUTH_TOKEN, unique_id: UNIQUE_ID, ...(opts.cookies || {}) };

  const onMessage = makeEvent();
  const onUpdated = makeEvent();
  const onRemoved = makeEvent();

  const chrome = {
    runtime: {
      id: EXT_ID,
      getURL: (p) => EXT_BASE + p,
      getManifest: () => clone(MANIFEST),
      onMessage,
      onInstalled: makeEvent()
    },
    storage: { session: makeArea(session), local: makeArea(local), onChanged: makeEvent() },
    windows: {
      async getAll({ windowTypes }) {
        assert.equal(JSON.stringify(windowTypes), '["normal"]');
        return clone(windows);
      }
    },
    cookies: {
      async get({ url, name }) {
        assert.equal(url, "https://www.twitch.tv/");
        return cookies[name] ? { name, value: cookies[name], domain: ".twitch.tv" } : null;
      }
    },
    tabs: {
      onUpdated,
      onRemoved,
      async query({ url }) {
        const patterns = [].concat(url);
        for (const p of patterns) assert.ok([TWITCH_TABS, SITE + "/*", PREVIEW + "/*"].includes(p), "onglets demandés : " + p);
        return [...tabs.values()].filter((t) => patterns.some((p) => (t.url || "").startsWith(p.slice(0, -1)))).map(clone);
      },
      async sendMessage(tabId, msg, options) {
        tabLog.messages.push({ tabId, msg: clone(msg), options: clone(options) });
        return undefined;
      },
      async create(props) {
        if (tw.tabCreateFails) throw new Error("No current window");
        const tab = { id: nextTab++, url: "", pendingUrl: props.url, status: "loading", active: !!props.active, discarded: false, incognito: false };
        tabs.set(tab.id, tab);
        tabLog.created.push(clone(props));
        setImmediate(() => {
          if (!tabs.has(tab.id)) return;
          tab.url = props.url;
          tab.status = "complete";
          for (const f of [...onUpdated.listeners]) f(tab.id, { status: "complete" }, clone(tab));
        });
        return clone(tab);
      },
      async update(id, props) {
        tabLog.updated.push({ id, ...props });
        Object.assign(tabs.get(id) || {}, props);
        return clone(tabs.get(id));
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error("No tab with id " + id);
        return clone(tabs.get(id));
      },
      async remove(id) {
        tabLog.removed.push(id);
        tabs.delete(id);
        for (const f of [...onRemoved.listeners]) f(id, {});
      }
    },
    scripting: {
      async executeScript({ target, world, func, args, files }) {
        const tab = tabs.get(target.tabId);
        if (files) {
          assert.deepEqual([...files], ["content.js"]);
          assert.equal(world, undefined, "content script dans son monde isolé");
          assert.ok(tab && (tab.url.startsWith(SITE + "/") || tab.url.startsWith(PREVIEW + "/")), "content script seulement dans le site");
          tabLog.injected.push(target.tabId);
          return [{ result: undefined }];
        }
        assert.ok(tab && tab.url.startsWith("https://www.twitch.tv/"), "injection seulement dans www.twitch.tv");
        assert.equal(world, "MAIN");
        assert.equal(func.name, "pageMintIntegrity");
        assert.equal(args.length, 3);
        assert.equal(args[0], CLIENT_ID);
        assert.equal(args[1], AUTH_TOKEN, "la session ne va qu'à la page twitch.tv");
        assert.equal(args[2], UNIQUE_ID);
        tabLog.scripts.push({ tabId: target.tabId, url: tab.url, func });
        if (tw.mintTakesMs) clock.now += tw.mintTakesMs; // obtention lente
        if (tw.mintFailNext > 0) {
          tw.mintFailNext--;
          return [{ result: { status: 403, token: "" } }];
        }
        const token = INTEGRITY_PREFIX + "-" + (tw.minted.length + 1);
        tw.minted.push(token);
        tw.validIntegrity.add(token);
        return [{ result: { status: 200, token, expiration: clock.now + 16 * 3600000 } }];
      }
    }
  };

  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const quietConsole = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    quietConsole[level] = (...a) => consoleLines.push(a.map(String).join(" "));
  }
  const ctx = vm.createContext({
    chrome,
    fetch: twitchFetch(tw),
    crypto: globalThis.crypto,
    TextEncoder,
    btoa,
    URL,
    URLSearchParams,
    AbortController,
    Date: FakeDate,
    console: quietConsole,
    // Attentes courtes immédiates ; délais de garde (10 s et plus) jamais déclenchés.
    setTimeout: (fn, ms) => (ms >= 10000 ? setTimeout(fn, 2 ** 31 - 1).unref() : setTimeout(fn, 0)),
    clearTimeout: (t) => clearTimeout(t)
  });
  vm.runInContext(BACKGROUND, ctx, { filename: "background.js" });

  const responses = [];
  const ops = [];   // opération demandée pour chaque réponse
  async function deliver(msg, sender) {
    let answered = false;
    let value;
    const done = new Promise((resolve) => {
      const keep = onMessage.listeners[0](clone(msg), sender, (v) => { answered = true; value = clone(v); resolve(); });
      if (keep !== true) resolve();
    });
    await done;
    const res = answered ? value : undefined;
    responses.push(res);
    ops.push(msg && typeof msg.op === "string" ? msg.op : null);
    return res;
  }
  const siteSender = (over = {}) => ({ id: EXT_ID, url: SITE + "/live/" + CHANNEL, origin: SITE, frameId: 0, tab: { id: 1, incognito: false }, ...over });
  let n = 0;
  return {
    tw, clock, session, local, tabs, tabLog, consoleLines, responses, ops, chrome,
    deliver,
    op: (op, args, extra = {}) => deliver({ tuConnect: 1, kind: "op", id: "r" + (++n), op, args, activation: false, ...extra }, siteSender()),
    spend: (op, args) => deliver({ tuConnect: 1, kind: "op", id: "r" + (++n), op, args, activation: true }, siteSender()),
    popup: (cmd) => deliver({ tuPopup: 1, cmd }, { id: EXT_ID, url: EXT_BASE + "popup.html" }),
    siteSender,
    gqlCount: (pred) => tw.log.filter((r) => r.url === "https://gql.twitch.tv/gql" && pred(JSON.parse(r.init.body))).length
  };
}

// Fausse page du site, avec le content script dedans.
function loadContent(opts = {}) {
  const origin = opts.origin || SITE;
  const listeners = [];
  const posted = [];
  const sent = [];
  const nav = { userActivation: { isActive: false } };
  const win = {
    addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); },
    removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (type === "message" && i >= 0) listeners.splice(i, 1); },
    postMessage: (msg, targetOrigin) => {
      posted.push({ data: clone(msg), targetOrigin });
      // Comme dans un navigateur : le content script reçoit aussi ses propres messages.
      setImmediate(() => [...listeners].forEach((fn) => fn({ source: win, origin, data: clone(msg) })));
    }
  };
  const documentTrap = new Proxy({}, { get(_, key) { throw new Error("le content script a touché au DOM : " + String(key)); } });
  const makeChrome = () => ({
    runtime: {
      id: EXT_ID,
      getManifest: () => clone(MANIFEST),
      onMessage: makeEvent(),
      sendMessage: (m) => { sent.push(clone(m)); return opts.sendMessage ? opts.sendMessage(clone(m)) : Promise.resolve(undefined); }
    }
  });
  const ctx = vm.createContext({ window: win, navigator: nav, location: { origin }, document: documentTrap, chrome: makeChrome(), console });
  const inject = () => vm.runInContext(CONTENT, ctx, { filename: "content.js" });
  inject();
  let n = 0;
  return {
    posted, sent, nav, win, listeners,
    // Nouvelle injection dans le même monde isolé (runtime.onInstalled).
    inject,
    // Mise à jour sous Chrome : le script en place devient orphelin, le
    // suivant reçoit une API neuve.
    orphan: () => { ctx.chrome.runtime.id = undefined; ctx.chrome = makeChrome(); },
    // Message de l'extension (tabs.sendMessage) aux scripts reliés à l'API actuelle.
    runtimeMessage: (msg, sender) => ctx.chrome.runtime.onMessage.listeners.forEach((fn) => fn(clone(msg), sender, () => {})),
    // La page envoie un message (par défaut : depuis elle-même, sa propre origine).
    dispatch: (data, over = {}) => [...listeners].forEach((fn) => fn({ source: win, origin, data: clone(data), ...over })),
    request(op, args, over = {}) {
      const id = "q" + (++n);
      [...listeners].forEach((fn) => fn({ source: win, origin, data: clone({ tuConnect: 1, dir: "req", id, op, args }), ...over }));
      return id;
    },
    async reply(id, max = 400) {
      for (let i = 0; i < max; i++) {
        const hit = posted.find((p) => p.data.dir === "res" && p.data.id === id);
        if (hit) return hit.data;
        await ticks();
      }
      return undefined;
    }
  };
}

// --- Mini-lanceur ---------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const code = (res) => (res && res.ok === false ? res.error.code : res && res.ok ? "ok" : String(res));

// Aucun jeton (ni un morceau de 8 caractères ou plus) dans une valeur sérialisée.
function assertNoSecret(value, label, tw) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return;
  for (const secret of [AUTH_TOKEN, INTEGRITY_PREFIX, ...(tw ? tw.minted : [])]) {
    for (let i = 0; i + 8 <= secret.length; i++) {
      const piece = secret.slice(i, i + 8);
      assert.ok(!text.includes(piece), label + " contient un morceau de jeton : " + piece);
    }
  }
}

// Ni jeton de lecture, ni adresse signée (usher, playlist, segments, spade).
// `segments` (réponses de hq.playlist seulement) : les adresses des segments
// du CDN y sont permises — c'est ce qu'il faut à la page pour lire le flux du
// compte —, jamais le reste (usher, playlists, déclencheurs, suivi, IP…).
function assertNoSignedUrl(value, label, tw, { segments = false } = {}) {
  const text = JSON.stringify(value) || "";
  const always = [tw.patSignature, "SOURCEsecret", "AUDIOsecret", "HQ1440secret", "HQ1080secret", "HQ720secret",
    "HQAUDIOsecret", "HQDIRsecret", "PREFETCHsecret", "TRIGGERsecret", "SESSIONIDsecret", "SESSIONsecret", "SERVINGsecret",
    "ADTRACKsecret", "203.0.113.7", "usher", "playlist.ttvnw", "/trigger/", "sig=", "token=", '"expires":1800000000',
    '"user_id":99887766'];
  const segmentPieces = ["SEGsecret", "CuYEsecret", "ttvnw", "SEGhq", "INIThq"];
  for (const piece of segments ? always : always.concat(segmentPieces)) {
    assert.ok(!text.includes(piece), label + " contient « " + piece + " »");
  }
}

function assertNoLeaks(h, label) {
  h.responses.forEach((r, i) => {
    assertNoSecret(r, label + " réponse " + i, h.tw);
    assertNoSignedUrl(r, label + " réponse " + i, h.tw, { segments: h.ops[i] === "hq.playlist" });
  });
  assertNoSecret(h.consoleLines.join("\n"), label + " journal", h.tw);
  assertNoSecret(h.local, label + " storage.local", h.tw);
  assertNoSignedUrl(h.local, label + " storage.local", h.tw);
}

function liveTab() {
  return { id: 7, url: "https://www.twitch.tv/" + CHANNEL, status: "complete" };
}

// --- Expéditeurs ------------------------------------------------------------------------

test("hello depuis le site : protocole, version, navigateur", async () => {
  const h = loadBackground();
  const res = await h.op("hello", {});
  assert.deepEqual(res, { ok: true, data: { protocol: 1, version: MANIFEST.version, enabled: true, browser: "chrome" } });
  const res2 = await h.deliver({ tuConnect: 1, kind: "op", id: "x", op: "hello", args: {} }, h.siteSender({ url: PREVIEW + "/", origin: PREVIEW }));
  assert.equal(code(res2), "ok", "aperçu Vercel de la branche de test accepté");
});

test("mauvaises origines, cadres ou expéditeurs : aucune réponse, aucune requête", async () => {
  const h = loadBackground();
  const bad = [
    h.siteSender({ url: "https://evil.example/", origin: "https://evil.example" }),
    h.siteSender({ url: "https://twitchunblock.vercel.app.evil.example/", origin: "https://twitchunblock.vercel.app.evil.example" }),
    h.siteSender({ url: "http://twitchunblock.vercel.app/", origin: "http://twitchunblock.vercel.app" }),
    h.siteSender({ url: "https://other-project.vercel.app/", origin: "https://other-project.vercel.app" }),
    h.siteSender({ url: "http://localhost:8787/", origin: "http://localhost:8787" }),
    h.siteSender({ frameId: 1 }),
    h.siteSender({ frameId: undefined }),
    h.siteSender({ id: "another-extension" }),
    h.siteSender({ tab: undefined }),
    h.siteSender({ tab: { id: 1, incognito: true } }),
    h.siteSender({ origin: "https://evil.example" }),
    { id: EXT_ID, url: EXT_BASE + "popup.html" }
  ];
  for (const sender of bad) {
    const res = await h.deliver({ tuConnect: 1, kind: "op", id: "a", op: "points.get", args: { channel: CHANNEL } }, sender);
    assert.equal(res, undefined, "refusé : " + JSON.stringify(sender));
  }
  // Commande de la fenêtre envoyée par le site : refusée aussi.
  assert.equal(await h.deliver({ tuPopup: 1, cmd: "diagnose" }, h.siteSender()), undefined);
  assert.equal(h.tw.log.length, 0, "aucune requête vers Twitch");
  assert.equal(h.tabLog.scripts.length, 0);
});

test("opération inconnue : unknown_op, sans requête", async () => {
  const h = loadBackground();
  for (const op of ["gql", "points.set", "__proto__", "constructor", "toString", "", 42]) {
    assert.equal(code(await h.op(op, {})), "unknown_op", String(op));
  }
  assert.equal(h.tw.log.length, 0);
});

// Table commune aux deux validations (arrière-plan et content script).
const ARG_CASES = [
  ["points.get", { channel: CHANNEL }, "ok"],
  ["points.get", { channel: "a".repeat(25) }, "ok"],
  ["points.get", { channel: "a".repeat(26) }, "bad_args"],
  ["points.get", { channel: "Streamer" }, "bad_args"],
  ["points.get", { channel: "stream-er" }, "bad_args"],
  ["points.get", { channel: "" }, "bad_args"],
  ["points.get", { channel: 12 }, "bad_args"],
  ["points.get", {}, "bad_args"],
  ["points.get", { channel: CHANNEL, extra: 1 }, "bad_args"],
  ["points.get", [CHANNEL], "bad_args"],
  ["points.get", "streamer_one", "bad_args"],
  ["hello", undefined, "ok"],
  ["hello", { x: 1 }, "bad_args"],
  ["predictions.bet", { channel: CHANNEL, eventId: "e1", outcomeId: "o1", points: 0 }, "bad_args"],
  ["predictions.bet", { channel: CHANNEL, eventId: "e1", outcomeId: "o1", points: 250001 }, "bad_args"],
  ["predictions.bet", { channel: CHANNEL, eventId: "e1", outcomeId: "o1", points: 1.5 }, "bad_args"],
  ["predictions.bet", { channel: CHANNEL, eventId: "e1", outcomeId: "o1", points: "10" }, "bad_args"],
  ["predictions.bet", { channel: CHANNEL, eventId: "e 1", outcomeId: "o1", points: 10 }, "bad_args"],
  ["predictions.bet", { channel: CHANNEL, eventId: "e".repeat(65), outcomeId: "o1", points: 10 }, "bad_args"],
  ["predictions.bet", { channel: CHANNEL, eventId: "e1", points: 10 }, "bad_args"],
  ["polls.vote", { channel: CHANNEL, pollId: "p1", choiceId: "c1", withPoints: "true" }, "bad_args"],
  ["polls.vote", { channel: CHANNEL, pollId: "p1", choiceId: "c1" }, "bad_args"],
  ["raid.join", { channel: CHANNEL, raidId: "raid_1" }, "bad_args"],
  ["raid.join", { channel: CHANNEL, raidId: "r".repeat(65) }, "bad_args"],
  ["raid.join", { channel: CHANNEL }, "bad_args"],
  ["drops.get", { channel: CHANNEL }, "ok"],
  ["drops.claim", { dropInstanceId: "inst#drop-1b.x:y_z-1" }, "ok"],
  ["drops.claim", { dropInstanceId: "inst drop" }, "bad_args"],
  ["drops.claim", { dropInstanceId: "x".repeat(201) }, "bad_args"],
  ["drops.claim", { dropInstanceId: "" }, "bad_args"],
  ["drops.claim", { channel: CHANNEL }, "bad_args"],
  ["drops.pulse", { channel: "Streamer" }, "bad_args"],
  ["rewards.get", { channel: CHANNEL, extra: true }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: 500, title: "Hydrate!", prompt: "Drink \"water\"\nnow", input: null }, "ok"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: 0, title: "Hydrate!", prompt: null, input: null }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: 2.5, title: "Hydrate!", prompt: null, input: null }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: "500", title: "Hydrate!", prompt: null, input: null }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: 500, title: "", prompt: null, input: null }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: 500, title: "t".repeat(201), prompt: null, input: null }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: 500, title: "Hydrate!", prompt: 5, input: null }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-song", cost: 200, title: "Song request", prompt: null, input: "" }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-song", cost: 200, title: "Song request", prompt: null, input: "x".repeat(201) }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-song", cost: 200, title: "Song request", prompt: null, input: "\u{1F600}".repeat(200) }, "ok"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-song", cost: 200, title: "Song request", prompt: null, input: "\u{1F600}".repeat(201) }, "bad_args"],
  ["rewards.redeem", { channel: CHANNEL, rewardId: "rw-hydrate", cost: 500, title: "Hydrate!", prompt: null }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: ["av1", "h265", "h264"] }, "ok"],
  ["hq.master", { channel: CHANNEL, codecs: ["h264", "av1"] }, "ok"],
  ["hq.master", { channel: CHANNEL, codecs: ["h264"] }, "ok"],
  ["hq.master", { channel: CHANNEL, codecs: ["h265"] }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: ["h264", "h264"] }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: ["vp9", "h264"] }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: ["av1", "h265", "h264", "h264"] }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: [] }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: "av1,h265,h264" }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: [{ toString: "h264" }] }, "bad_args"],
  ["hq.master", { channel: CHANNEL }, "bad_args"],
  ["hq.master", { channel: "Streamer", codecs: ["h264"] }, "bad_args"],
  ["hq.master", { channel: CHANNEL, codecs: ["h264"], url: "https://usher.ttvnw.net/" }, "bad_args"],
  ["hq.playlist", { id: "Hq0123456789abcdefghij" }, "ok"],
  ["hq.playlist", { id: "Hq0123456789abcdefghi" }, "bad_args"],
  ["hq.playlist", { id: "Hq0123456789abcdefghi-" }, "bad_args"],
  ["hq.playlist", { id: 12 }, "bad_args"],
  ["hq.playlist", { id: "Hq0123456789abcdefghij", channel: CHANNEL }, "bad_args"],
  ["hq.playlist", { url: HQ_HOST + "HQ1440secret.m3u8" }, "bad_args"]
];
// Variante connue de l'arrière-plan pour les cas « ok » de hq.playlist.
const HQ_TEST_ID = "Hq0123456789abcdefghij";
async function hqKnown(clock) {
  return { hq: { [HQ_TEST_ID]: { url: HQ_HOST + "HQ1440secret.m3u8", fp: await fingerprintOf(AUTH_TOKEN), channel: CHANNEL, at: clock.now } } };
}

const REDEEM = { channel: CHANNEL, rewardId: "rw-hydrate", cost: 500, title: "Hydrate!", prompt: "Drink \"water\"\nnow", input: null };

test("bornes des arguments : bad_args avant toute requête", async () => {
  const h = loadBackground({ local: { settings: { siteEnabled: true, autoClaim: true, allowSpend: true } } });
  for (const [op, args, expected] of ARG_CASES) {
    if (expected !== "bad_args") continue;
    const res = await h.deliver({ tuConnect: 1, kind: "op", id: "b", op, args, activation: true }, h.siteSender());
    assert.equal(code(res), "bad_args", op + " " + JSON.stringify(args));
  }
  for (const id of ["", "x".repeat(65), 12, null]) {
    const res = await h.deliver({ tuConnect: 1, kind: "op", id, op: "hello", args: {} }, h.siteSender());
    assert.equal(code(res), "bad_args", "id " + JSON.stringify(id));
  }
  assert.equal(h.tw.log.length, 0);
});

test("bornes acceptées : 1 et 250 000 points passent la validation", async () => {
  const h = loadBackground();
  h.tw.prediction = { id: "ev-1", title: "Win?", outcomes: [{ id: "o-blue", title: "Yes", color: "BLUE", totalPoints: 0, totalUsers: 0 }, { id: "o-pink", title: "No", color: "PINK", totalPoints: 0, totalUsers: 0 }] };
  const big = await h.spend("predictions.bet", { channel: CHANNEL, eventId: "ev-1", outcomeId: "o-blue", points: 250000 });
  assert.deepEqual(big.error, { code: "bad_args", message: "points" }, "250 000 accepté par la validation, refusé par le solde");
  h.clock.now += 3000;
  const one = await h.spend("predictions.bet", { channel: CHANNEL, eventId: "ev-1", outcomeId: "o-blue", points: 1 });
  assert.equal(code(one), "ok");
});

// --- Réglages et vrai clic ------------------------------------------------------------------

test("connexion au site coupée : hello et status seulement, rien d'autre", async () => {
  const h = loadBackground({ local: { settings: { siteEnabled: false, autoClaim: true, allowSpend: true } } });
  assert.deepEqual((await h.op("hello", {})).data.enabled, false);
  assert.deepEqual(await h.op("status", {}), { ok: true, data: { enabled: false, session: null, settings: { autoClaim: true, allowSpend: true } } });
  for (const [op, args] of [["points.get", { channel: CHANNEL }], ["watch.beat", { channel: CHANNEL }], ["raid.join", { channel: CHANNEL, raidId: "abc-123" }], ["polls.get", { channel: CHANNEL }]]) {
    assert.equal(code(await h.op(op, args)), "disabled", op);
  }
  assert.equal(code(await h.spend("polls.vote", { channel: CHANNEL, pollId: "p1", choiceId: "c1", withPoints: false })), "disabled");
  assert.equal(h.tw.log.length, 0);
});

test("dépense sans vrai clic ou réglage coupé : refusée, sans requête", async () => {
  const h = loadBackground();
  const bet = { channel: CHANNEL, eventId: "ev-1", outcomeId: "o-blue", points: 10 };
  const vote = { channel: CHANNEL, pollId: "p1", choiceId: "c1", withPoints: false };
  assert.equal(code(await h.op("predictions.bet", bet)), "needs_activation");
  assert.equal(code(await h.op("polls.vote", vote)), "needs_activation");
  assert.equal(code(await h.op("polls.vote", vote, { activation: "yes" })), "needs_activation");
  const off = loadBackground({ local: { settings: { siteEnabled: true, autoClaim: true, allowSpend: false } } });
  assert.equal(code(await off.spend("predictions.bet", bet)), "spend_disabled");
  assert.equal(code(await off.spend("polls.vote", { ...vote, withPoints: true })), "spend_disabled");
  assert.equal(h.tw.log.length + off.tw.log.length, 0);
});

// --- Limites de débit -------------------------------------------------------------------------

test("60 demandes par minute, tout confondu", async () => {
  const h = loadBackground();
  for (let i = 0; i < 60; i++) assert.equal(code(await h.op("hello", {})), "ok", "demande " + (i + 1));
  assert.equal(code(await h.op("hello", {})), "rate_limited");
  assert.equal(code(await h.op("nope", {})), "rate_limited", "même une demande invalide compte");
  h.clock.now += 60001;
  assert.equal(code(await h.op("hello", {})), "ok");
});

test("lectures : une requête Twitch par 3 s et par chaîne, sinon le cache", async () => {
  const h = loadBackground();
  const isPoints = (b) => !Array.isArray(b) && b.query.includes("communityPoints { balance");
  assert.equal(code(await h.op("points.get", { channel: CHANNEL })), "ok");
  assert.equal(code(await h.op("points.get", { channel: CHANNEL })), "ok");
  assert.equal(h.gqlCount(isPoints), 1, "deuxième lecture servie par le cache");
  h.clock.now += 3001;
  await h.op("points.get", { channel: CHANNEL });
  assert.equal(h.gqlCount(isPoints), 2);
  const st1 = await h.op("status", {});
  await h.op("status", {});
  assert.equal(h.tw.log.filter((r) => r.url.includes("oauth2/validate")).length, 1);
  assert.deepEqual(st1.data.session, { login: "viewer_one", userId: "99887766" });
});

test("watch.beat : 1 par 50 s et par chaîne, même après un redémarrage de l'arrière-plan", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  assert.equal(code(await h.op("watch.beat", { channel: CHANNEL })), "ok");
  h.clock.now += 49000;
  assert.equal(code(await h.op("watch.beat", { channel: CHANNEL })), "rate_limited");
  // Service worker arrêté puis relancé : storage.session garde la limite.
  const again = loadBackground({ tw: h.tw, clock: h.clock, session: h.session, local: h.local, tabs: [liveTab()] });
  assert.equal(code(await again.op("watch.beat", { channel: CHANNEL })), "rate_limited");
  h.clock.now += 1001;
  assert.equal(code(await again.op("watch.beat", { channel: CHANNEL })), "ok");
});

test("points.claim : 1 par 10 s ; dépenses : 1 par 3 s", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "ok");
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "rate_limited");
  h.clock.now += 10001;
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "no_claim");

  h.tw.prediction = { id: "ev-1", title: "Win?", outcomes: [{ id: "o-blue", title: "Yes", color: "BLUE", totalPoints: 0, totalUsers: 0 }] };
  const bet = { channel: CHANNEL, eventId: "ev-1", outcomeId: "o-blue", points: 10 };
  assert.equal(code(await h.spend("predictions.bet", bet)), "ok");
  assert.equal(code(await h.spend("predictions.bet", bet)), "rate_limited");
  h.clock.now += 3001;
  assert.equal(code(await h.spend("predictions.bet", bet)), "ok");
});

test("raid.join : réponse gardée par raid, 1 par 30 s et par chaîne", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const first = await h.op("raid.join", { channel: CHANNEL, raidId: "1a2b-3c4d" });
  assert.deepEqual(first, { ok: true, data: { joined: true } });
  assert.deepEqual(h.tw.lastRaid, { how: "persisted", input: { raidID: "1a2b-3c4d" } });
  const before = h.tw.log.length;
  h.clock.now += 1000;
  assert.deepEqual(await h.op("raid.join", { channel: CHANNEL, raidId: "1a2b-3c4d" }), first, "même raid : réponse en cache");
  assert.equal(h.tw.log.length, before, "sans nouvelle requête");
  assert.equal(code(await h.op("raid.join", { channel: CHANNEL, raidId: "ffff-0000" })), "rate_limited");
  assert.equal(code(await h.op("raid.join", { channel: "other_channel", raidId: "eeee-1111" })), "ok", "autre chaîne");
  h.clock.now += 30001;
  assert.equal(code(await h.op("raid.join", { channel: CHANNEL, raidId: "ffff-0000" })), "ok");
});

test("raid.join : repli sur la mutation en clair si le hash est inconnu", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.raidPQNF = true;
  assert.deepEqual(await h.op("raid.join", { channel: CHANNEL, raidId: "abcd-1234" }), { ok: true, data: { joined: true } });
  assert.deepEqual(h.tw.lastRaid, { how: "raw", input: { raidID: "abcd-1234" } });
});

// --- Opérations (Twitch simulé) ------------------------------------------------------------------

test("points.get : solde, coffre, nom, icône, série ; en-têtes des requêtes", async () => {
  const h = loadBackground();
  const res = await h.op("points.get", { channel: CHANNEL });
  assert.deepEqual(res, { ok: true, data: {
    channelId: CHANNEL_ID, balance: 1000, claimAvailable: true, pointsName: "Gems",
    pointsIconUrl: "https://static-cdn.jtvnw.net/channel-points-icons/123/2x.png", watchStreak: 7
  } });
  for (const r of h.tw.log.filter((x) => x.url.includes("gql.twitch.tv"))) {
    assert.equal(r.init.headers["X-Device-Id"], UNIQUE_ID);
    assert.equal(r.init.headers["Content-Type"], "text/plain;charset=UTF-8");
    assert.equal(r.init.headers["Client-Integrity"], undefined, "pas de jeton d'intégrité pour une lecture");
  }
  h.tw.streaks = [];
  h.clock.now += 61000;
  assert.equal((await h.op("points.get", { channel: CHANNEL })).data.watchStreak, 0, "absente de la liste : 0, comme l'app");
});

test("points.claim : jeton obtenu dans l'onglet twitch.tv ouvert, puis réutilisé", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  assert.deepEqual(await h.op("points.claim", { channel: CHANNEL }), { ok: true, data: { claimed: 50, balance: 1050 } });
  assert.equal(h.tabLog.scripts.length, 1);
  assert.equal(h.tabLog.scripts[0].tabId, 7, "onglet déjà ouvert");
  assert.equal(h.tabLog.created.length, 0, "aucun onglet ouvert");
  assert.ok(h.session.integrity && h.session.integrity.token === h.tw.minted[0], "jeton gardé dans storage.session");
  h.tw.claimId = "c-second";
  h.clock.now += 10001;
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "ok");
  assert.equal(h.tabLog.scripts.length, 1, "jeton réutilisé, pas de nouvelle obtention");
  assertNoLeaks(h, "claim");
});

test("intégrité refusée : jeton oublié, nouvelle obtention, un seul nouvel essai", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.integrityFailNext = 1;
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "ok");
  assert.equal(h.tabLog.scripts.length, 2, "deux obtentions : la première refusée");
  h.tw.claimId = "c-again";
  h.tw.integrityFailNext = 5;
  h.clock.now += 10001;
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "integrity");
  assert.equal(h.tabLog.scripts.length, 3, "jeton gardé refusé, une nouvelle obtention, un seul nouvel essai");
  const claims = h.gqlCount((b) => Array.isArray(b) && b[0].operationName === "ClaimCommunityPoints");
  assert.equal(claims, 4);
});

test("une seule obtention à la fois", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.prediction = { id: "ev-1", title: "Win?", outcomes: [{ id: "o-blue", title: "Yes", color: "BLUE", totalPoints: 0, totalUsers: 0 }] };
  const [a, b] = await Promise.all([
    h.op("points.claim", { channel: CHANNEL }),
    h.spend("predictions.bet", { channel: CHANNEL, eventId: "ev-1", outcomeId: "o-blue", points: 10 })
  ]);
  assert.equal(code(a), "ok");
  assert.equal(code(b), "ok");
  assert.equal(h.tabLog.scripts.length, 1);
});

test("sans onglet twitch.tv : onglet inactif et coupé sur /directory, refermé", async () => {
  const h = loadBackground();
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "ok");
  assert.deepEqual(h.tabLog.created, [{ url: "https://www.twitch.tv/directory", active: false, windowId: 1 }]);
  assert.ok(h.tabLog.updated.some((u) => u.muted === true), "onglet coupé");
  assert.equal(h.tabLog.removed.length, 1, "onglet refermé");
  assert.equal(h.tabs.size, 0);
  assert.equal(h.session.mintTab, undefined, "plus d'onglet temporaire noté");
});

test("jamais de session injectée en navigation privée ni dans un autre conteneur", async () => {
  // Dernière fenêtre active privée : l'onglet temporaire va dans la fenêtre normale.
  const h = loadBackground({ windows: [
    { id: 3, type: "normal", focused: true, incognito: true },
    { id: 4, type: "normal", focused: false, incognito: false }
  ] });
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "ok");
  assert.deepEqual(h.tabLog.created.map((c) => c.windowId), [4]);
  // Que des fenêtres privées : aucun onglet, integrity.
  const p = loadBackground({ windows: [{ id: 3, type: "normal", focused: true, incognito: true }] });
  assert.equal(code(await p.op("points.claim", { channel: CHANNEL })), "integrity");
  assert.equal(p.tabLog.created.length + p.tabLog.scripts.length, 0);
  // Firefox : onglet twitch.tv d'un autre conteneur ignoré, celui par défaut pris.
  const c = loadBackground({ tabs: [{ ...liveTab(), cookieStoreId: "firefox-container-1" }, { ...liveTab(), id: 8, cookieStoreId: "firefox-default" }] });
  assert.equal(code(await c.op("points.claim", { channel: CHANNEL })), "ok");
  assert.deepEqual(c.tabLog.scripts.map((s) => s.tabId), [8]);
});

test("repli sur l'accueil quand /directory ne donne pas de jeton", async () => {
  const h = loadBackground();
  h.tw.mintFailNext = 2; // deux essais sur /directory
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "ok");
  assert.deepEqual(h.tabLog.created.map((c) => c.url), ["https://www.twitch.tv/directory", "https://www.twitch.tv/"]);
  assert.equal(h.tabs.size, 0, "les deux onglets refermés");
});

test("obtention impossible : integrity, puis pas de nouvel onglet avant 30 s", async () => {
  const h = loadBackground();
  h.tw.mintFailNext = 100;
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "integrity");
  const opened = h.tabLog.created.length;
  h.clock.now += 10001;
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "integrity");
  assert.equal(h.tabLog.created.length, opened, "attente après un échec");
  h.clock.now += 30001;
  h.tw.mintFailNext = 0;
  assert.equal(code(await h.op("points.claim", { channel: CHANNEL })), "ok");
});

test("onglet temporaire laissé ouvert par un arrêt : refermé au redémarrage", async () => {
  const session = { mintTab: { id: 77, at: 1 } };
  const h = loadBackground({ session, tabs: [{ id: 77, url: "https://www.twitch.tv/directory", status: "complete", active: false }] });
  await ticks(5);
  assert.deepEqual(h.tabLog.removed, [77]);
  assert.equal(h.session.mintTab, undefined);
});

test("watch.beat : présence « minute-watched » comme l'app, coffre automatique", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  assert.deepEqual(await h.op("watch.beat", { channel: CHANNEL }), { ok: true, data: { live: true, balance: 1050, claimed: 50 } });
  assert.equal(h.tw.spadePosts.length, 1);
  const body = h.tw.spadePosts[0];
  assert.match(body, /^data=/);
  const payload = JSON.parse(Buffer.from(decodeURIComponent(body.slice(5)), "base64").toString("utf8"));
  assert.deepEqual(payload, [{ event: "minute-watched", properties: {
    channel_id: CHANNEL_ID, broadcast_id: "4242424242", channel: CHANNEL, user_id: 99887766, player: "site", live: true
  } }]);
  const spade = h.tw.log.find((r) => r.url === SPADE);
  assert.equal(spade.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(spade.init.headers.Authorization, undefined, "rien de la session vers le spade");

  // Coffres automatiques coupés : présence, pas de réclamation.
  const off = loadBackground({ tabs: [liveTab()], local: { settings: { siteEnabled: true, autoClaim: false, allowSpend: true } } });
  assert.deepEqual(await off.op("watch.beat", { channel: CHANNEL }), { ok: true, data: { live: true, balance: 1000, claimed: null } });
  assert.equal(off.tabLog.scripts.length, 0);
});

test("watch.beat hors ligne : live false, rien vers le spade", async () => {
  const h = loadBackground();
  h.tw.live = false;
  assert.deepEqual(await h.op("watch.beat", { channel: CHANNEL }), { ok: true, data: { live: false, balance: 1000, claimed: null } });
  assert.equal(h.tw.spadePosts.length, 0);
});

test("prédictions : lecture, pari vérifié, ton pari, issue gagnante", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.prediction = { id: "ev-9", title: "Boss?", outcomes: [
    { id: "o-blue", title: "Yes", color: "BLUE", totalPoints: 500, totalUsers: 3, topPredictors: [] },
    { id: "o-pink", title: "No", color: "PINK", totalPoints: 200, totalUsers: 1 }
  ] };
  const got = await h.op("predictions.get", { channel: CHANNEL });
  assert.deepEqual(got.data, { balance: 1000, event: {
    id: "ev-9", title: "Boss?", status: "ACTIVE", createdAt: "2026-10-20T18:00:00Z", windowSeconds: 120, winningOutcomeId: null,
    outcomes: [
      { id: "o-blue", title: "Yes", color: "BLUE", totalPoints: 500, totalUsers: 3 },
      { id: "o-pink", title: "No", color: "PINK", totalPoints: 200, totalUsers: 1 }
    ],
    self: null
  } });
  const bet = (over) => h.spend("predictions.bet", { channel: CHANNEL, eventId: "ev-9", outcomeId: "o-blue", points: 100, ...over });
  assert.deepEqual((await bet({ eventId: "ev-other" })).error, { code: "bad_args", message: "eventId" });
  h.clock.now += 3001;
  assert.deepEqual((await bet({ outcomeId: "o-green" })).error, { code: "bad_args", message: "outcomeId" });
  h.clock.now += 3001;
  assert.deepEqual((await bet({ points: 1001 })).error, { code: "bad_args", message: "points" });
  h.clock.now += 3001;
  assert.deepEqual(await bet({}), { ok: true, data: { balance: 900, self: { outcomeId: "o-blue", points: 100 } } });
  assert.equal(h.tw.lastBet.points, 100);
  h.clock.now += 3001;
  assert.deepEqual((await bet({ outcomeId: "o-pink" })).error, { code: "bad_args", message: "other_outcome" });
  h.clock.now += 3001;
  assert.deepEqual((await bet({ points: 50 })).data.self, { outcomeId: "o-blue", points: 150 }, "on peut rajouter sur la même issue");
  h.clock.now += 3001;
  assert.deepEqual((await h.op("predictions.get", { channel: CHANNEL })).data.event.self, { outcomeId: "o-blue", points: 150 });

  h.tw.predictionLocked = true;
  h.clock.now += 3001;
  assert.equal((await h.op("predictions.get", { channel: CHANNEL })).data.event.status, "LOCKED");
  assert.deepEqual((await bet({})).error, { code: "bad_args", message: "not_active" });

  // Terminée : sortie des listes, issue gagnante dans les prédictions résolues.
  h.tw.prediction = null;
  h.tw.resolved = [{ id: "ev-9", winningOutcome: { id: "o-blue" } }];
  h.clock.now += 3001;
  const ended = (await h.op("predictions.get", { channel: CHANNEL })).data.event;
  assert.equal(ended.status, "RESOLVED");
  assert.equal(ended.winningOutcomeId, "o-blue");
  assert.deepEqual(ended.self, { outcomeId: "o-blue", points: 150 });
  h.clock.now += 180001;
  assert.equal((await h.op("predictions.get", { channel: CHANNEL })).data.event, null, "plus donnée après 3 min");
  assertNoLeaks(h, "prédictions");
});

test("sondages : lecture, vote gratuit, vote avec des points", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.poll = {
    id: "poll-1", title: "Next game?", status: "ACTIVE", startedAt: "2026-10-20T18:00:00Z", durationSeconds: 120,
    choices: [{ id: "ch-a", title: "A", votes: { total: 3 } }, { id: "ch-b", title: "B", totalVoters: 2 }],
    settings: { communityPointsVotes: { isEnabled: true, cost: 100 }, multichoice: { isEnabled: false } }
  };
  const got = await h.op("polls.get", { channel: CHANNEL });
  assert.deepEqual(got.data.poll, {
    id: "poll-1", title: "Next game?", status: "ACTIVE", startedAt: "2026-10-20T18:00:00Z", durationSeconds: 120, totalVotes: 5,
    choices: [{ id: "ch-a", title: "A", votes: 3 }, { id: "ch-b", title: "B", votes: 2 }],
    pointsVoting: { enabled: true, cost: 100 }, self: null
  });
  assert.deepEqual((await h.spend("polls.vote", { channel: CHANNEL, pollId: "poll-1", choiceId: "ch-z", withPoints: false })).error, { code: "bad_args", message: "choiceId" });
  h.clock.now += 3001;
  const voted = await h.spend("polls.vote", { channel: CHANNEL, pollId: "poll-1", choiceId: "ch-a", withPoints: false });
  assert.equal(code(voted), "ok");
  assert.deepEqual(voted.data.poll.self, { choiceIds: ["ch-a"], votes: 1 });
  assert.deepEqual({ ...h.tw.lastVote, voteID: "x" }, { pollID: "poll-1", choiceID: "ch-a", userID: "99887766", voteID: "x", tokens: null });
  h.clock.now += 3001;
  const paid = await h.spend("polls.vote", { channel: CHANNEL, pollId: "poll-1", choiceId: "ch-a", withPoints: true });
  assert.equal(code(paid), "ok");
  assert.deepEqual(h.tw.lastVote.tokens, { bits: 0, channelPoints: 100 });
  assert.deepEqual(paid.data.poll.self, { choiceIds: ["ch-a"], votes: 2 });
  h.tw.poll.settings = {};
  h.clock.now += 3001;
  assert.deepEqual((await h.spend("polls.vote", { channel: CHANNEL, pollId: "poll-1", choiceId: "ch-a", withPoints: true })).error, { code: "bad_args", message: "withPoints" });
  h.tw.poll.status = "COMPLETED";
  h.clock.now += 3001;
  assert.deepEqual((await h.spend("polls.vote", { channel: CHANNEL, pollId: "poll-1", choiceId: "ch-a", withPoints: false })).error, { code: "bad_args", message: "not_active" });
  // Sans état chez Twitch : ACTIVE comme l'app, jamais null (hors protocole, le site rejetterait le sondage).
  delete h.tw.poll.status;
  h.clock.now += 3001;
  assert.equal((await h.op("polls.get", { channel: CHANNEL })).data.poll.status, "ACTIVE");
  h.tw.poll.status = "moderated";
  h.clock.now += 3001;
  assert.equal((await h.op("polls.get", { channel: CHANNEL })).data.poll.status, "TERMINATED");
});

test("sans session twitch.tv : no_session ; session refusée : no_session", async () => {
  const h = loadBackground({ cookies: { "auth-token": "" } });
  assert.equal(code(await h.op("points.get", { channel: CHANNEL })), "no_session");
  assert.deepEqual((await h.op("status", {})).data.session, null);
  assert.equal(h.tw.log.length, 0);
  const g = loadBackground();
  g.tw.loggedIn = false;
  assert.equal(code(await g.op("points.get", { channel: CHANNEL })), "no_session");
  assert.equal(code(await g.op("raid.join", { channel: CHANNEL, raidId: "aaaa-1" })), "no_session");
});

// --- Aucun jeton qui sort ------------------------------------------------------------------------

test("aucun jeton dans les réponses, les journaux, les erreurs ni storage.local", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.prediction = { id: "ev-1", title: "Win?", outcomes: [{ id: "o-blue", title: "Yes", color: "BLUE", totalPoints: 0, totalUsers: 0 }] };
  h.tw.poll = { id: "poll-1", title: "Q", status: "ACTIVE", choices: [{ id: "ch-a", title: "A", votes: { total: 0 } }], settings: {} };
  const calls = [
    ["hello", {}], ["status", {}], ["points.get", { channel: CHANNEL }], ["points.claim", { channel: CHANNEL }],
    ["watch.beat", { channel: CHANNEL }], ["predictions.get", { channel: CHANNEL }], ["polls.get", { channel: CHANNEL }],
    ["raid.join", { channel: CHANNEL, raidId: "aaaa-1" }]
  ];
  for (const [op, args] of calls) {
    await h.op(op, args);
    h.clock.now += 11000;
  }
  await h.spend("predictions.bet", { channel: CHANNEL, eventId: "ev-1", outcomeId: "o-blue", points: 10 });
  h.clock.now += 3001;
  await h.spend("polls.vote", { channel: CHANNEL, pollId: "poll-1", choiceId: "ch-a", withPoints: false });
  // Twitch qui renverrait la session dans un message d'erreur : nettoyée.
  h.tw.gqlErrorText = "bad token " + AUTH_TOKEN + " for " + h.tw.minted[0];
  h.clock.now += 3001;
  const err = await h.op("points.get", { channel: CHANNEL });
  assert.equal(code(err), "twitch");
  assert.ok(h.tw.minted.length >= 1);
  await h.popup("state");
  await h.popup("diagnose");
  assertNoLeaks(h, "tout");
  assert.equal(h.consoleLines.length, 0, "rien dans le journal");
});

// --- Fenêtre de l'extension ---------------------------------------------------------------------------

test("fenêtre : état et diagnostic masqué", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const before = await h.popup("state");
  assert.deepEqual(before.session, { state: "ok", login: "viewer_one", userId: "99887766" });
  assert.equal(before.integrity, null);
  const diag = await h.popup("diagnose");
  assert.deepEqual(diag.session, { ok: true, login: "viewer_one", userId: "99887766", clientId: CLIENT_ID, token: { head: AUTH_TOKEN.slice(0, 4), len: AUTH_TOKEN.length } });
  assert.equal(diag.integrity.ok, true);
  assert.deepEqual(diag.integrity.token, { head: h.tw.minted[0].slice(0, 4), len: h.tw.minted[0].length });
  assert.deepEqual(diag.integrity.device, { head: UNIQUE_ID.slice(0, 4), len: UNIQUE_ID.length });
  assert.equal(diag.integrity.via, "tab");
  const after = await h.popup("state");
  assert.equal(after.integrity.until, h.clock.now + 16 * 3600000);
  assertNoLeaks(h, "fenêtre");
  const none = loadBackground({ cookies: { "auth-token": "" } });
  assert.deepEqual((await none.popup("diagnose")).session, { ok: false, code: "no_session" });
});

// --- Fonction injectée dans twitch.tv ---------------------------------------------------------------------

test("fonction injectée : POST /integrity avec la session, rien hors de www.twitch.tv", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  await h.op("points.claim", { channel: CHANNEL });
  const func = h.tabLog.scripts[0].func;
  const calls = [];
  const page = (hostname) => vm.createContext({
    location: { hostname },
    AbortController,
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => ({ token: "tok-123", expiration: 99 }) }; }
  });
  const run = (hostname) => vm.runInContext("(" + func.toString() + ")(" + JSON.stringify(CLIENT_ID) + ", 'auth', 'dev')", page(hostname));
  assert.deepEqual(clone(await run("www.twitch.tv")), { status: 200, token: "tok-123", expiration: 99 });
  assert.equal(calls[0].url, "https://gql.twitch.tv/integrity");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(clone(calls[0].init.headers), { "Client-ID": CLIENT_ID, "Authorization": "OAuth auth", "X-Device-Id": "dev" });
  assert.deepEqual(clone(await run("dashboard.twitch.tv")), { status: -1, token: "" });
  assert.equal(calls.length, 1);
});

// --- Drops -------------------------------------------------------------------------------------------------

test("drops.get : campagnes de la chaîne, progression, drop en cours, tableau de bord", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const res = await h.op("drops.get", { channel: CHANNEL });
  assert.equal(code(res), "ok");
  assert.equal(res.data.channelHasDrops, true);
  assert.deepEqual(res.data.campaigns, [{
    id: "camp-1", name: "Season drops", gameName: "Some Game", endsAt: "2026-10-30T00:00:00Z",
    drops: [
      { id: "drop-1a", name: "Cool hat", imageUrl: "https://static-cdn.jtvnw.net/drops/hat.png", requiredMinutes: 60, currentMinutes: 42, claimed: false, dropInstanceId: null },
      { id: "drop-1b", name: "Red cape", imageUrl: "https://static-cdn.jtvnw.net/drops/cape.png", requiredMinutes: 30, currentMinutes: 30, claimed: false, dropInstanceId: "inst#drop-1b" }
    ]
  }], "camp-2 pas commencée : le tableau de bord demande un jeton d'intégrité, aucun n'est gardé");
  assert.equal(h.tabLog.scripts.length + h.tabLog.created.length, 0, "une lecture n'obtient jamais de jeton");

  // Jeton d'intégrité déjà gardé (après un coffre) : le tableau de bord donne camp-2.
  await h.op("points.claim", { channel: CHANNEL });
  h.clock.now += 600001;
  const again = await h.op("drops.get", { channel: CHANNEL });
  assert.deepEqual(again.data.campaigns.map((c) => c.id), ["camp-1", "camp-2"]);
  assert.deepEqual(again.data.campaigns[1].drops, [{
    id: "drop-2a", name: "Horse", imageUrl: "https://static-cdn.jtvnw.net/drops/horse.png", requiredMinutes: 120, currentMinutes: 0, claimed: false, dropInstanceId: null
  }]);

  h.tw.channelCampaigns = [];
  h.clock.now += 600001;
  assert.deepEqual((await h.op("drops.get", { channel: CHANNEL })).data, { channelHasDrops: false, campaigns: [] });
  assertNoLeaks(h, "drops.get");
});

test("drops.claim : jeton d'intégrité, statuts de Twitch", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  assert.deepEqual(await h.op("drops.claim", { dropInstanceId: "inst#drop-1b" }), { ok: true, data: { claimed: true } });
  assert.deepEqual(h.tw.dropClaims, ["inst#drop-1b"]);
  h.tw.dropClaimStatus = "DROP_INSTANCE_ALREADY_CLAIMED";
  h.clock.now += 5001;
  assert.deepEqual((await h.op("drops.claim", { dropInstanceId: "inst#drop-1b" })).data, { claimed: true });
  h.tw.dropClaimStatus = "UNKNOWN_FAILURE";
  h.clock.now += 5001;
  assert.deepEqual((await h.op("drops.claim", { dropInstanceId: "inst#x" })).error, { code: "twitch", message: "UNKNOWN_FAILURE" });
});

test("drops.claim : 1 par 5 s ; drops.pulse : 1 par 8 s et par chaîne", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  assert.equal(code(await h.op("drops.claim", { dropInstanceId: "inst#drop-1b" })), "ok");
  assert.equal(code(await h.op("drops.claim", { dropInstanceId: "inst#drop-1b" })), "rate_limited");
  h.clock.now += 5001;
  assert.equal(code(await h.op("drops.claim", { dropInstanceId: "inst#drop-1b" })), "ok");
  assert.equal(code(await h.op("drops.pulse", { channel: CHANNEL })), "ok");
  assert.equal(code(await h.op("drops.pulse", { channel: CHANNEL })), "rate_limited");
  assert.deepEqual(await h.op("drops.pulse", { channel: "other_channel" }), { ok: true, data: { active: false, claimed: [] } }, "autre chaîne, sans drops");
  h.clock.now += 8001;
  assert.equal(code(await h.op("drops.pulse", { channel: CHANNEL })), "ok");
});

test("drops.pulse : jeton de lecture du compte, plus basse qualité, HEAD des nouveaux segments", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const first = await h.op("drops.pulse", { channel: CHANNEL });
  assert.equal(code(first), "ok");
  assert.equal(first.data.active, true);
  assert.equal(h.tw.usherCalls, 1);
  assert.deepEqual(h.tw.heads, h.tw.segments, "chaque segment demandé une fois, en HEAD");
  assert.ok(!h.tw.log.some((r) => r.url.includes("SOURCEsecret")), "la plus basse qualité seulement");

  h.tw.segments = h.tw.segments.slice(1).concat(["https://video-edge-aa11.fra05.abs.hls.ttvnw.net/v1/segment/SEGsecret4.ts"]);
  h.clock.now += 8001;
  const second = await h.op("drops.pulse", { channel: CHANNEL });
  assert.equal(second.data.active, true);
  assert.equal(h.tw.usherCalls, 1, "playlist gardée d'un battement à l'autre");
  assert.equal(h.tw.heads.length, 4, "seulement le nouveau segment");
  assert.ok(h.tw.heads[3].endsWith("SEGsecret4.ts"));

  // Réclamation automatique : le drop réclamable, pas celui d'un compte de jeu à lier.
  assert.deepEqual(first.data.claimed.concat(second.data.claimed), ["Red cape"]);
  assert.deepEqual(h.tw.dropClaims, ["inst#drop-1b"]);
  assert.ok(h.session.dropPulse[CHANNEL].variant.includes("AUDIOsecret"), "adresse signée gardée dans storage.session");
  assertNoLeaks(h, "pulsation");
});

test("drops.pulse : jeton d'intégrité si Twitch en demande un, jeton anonyme refusé", async () => {
  const h = loadBackground({ tabs: [liveTab()], local: { settings: { siteEnabled: true, autoClaim: false, allowSpend: true } } });
  h.tw.patNeedsIntegrity = true;
  const res = await h.op("drops.pulse", { channel: CHANNEL });
  assert.deepEqual(res.data, { active: true, claimed: [] });
  assert.equal(h.tabLog.scripts.length, 1);
  assert.deepEqual(h.tw.dropClaims, [], "réclamation automatique coupée");

  const anon = loadBackground({ tabs: [liveTab()] });
  anon.tw.patValue = '{"channel":"streamer_one","user_id":null}';
  assert.equal((await anon.op("drops.pulse", { channel: CHANNEL })).data.active, false);
  assert.equal(anon.tw.usherCalls, 0, "jeton anonyme : rien demandé à usher");
});

test("drops.pulse : trois 404 de suite, le direct est fini", async () => {
  const h = loadBackground({ tabs: [liveTab()], local: { settings: { siteEnabled: true, autoClaim: false, allowSpend: true } } });
  assert.equal((await h.op("drops.pulse", { channel: CHANNEL })).data.active, true);
  h.tw.variantStatus = 404;
  for (let i = 0; i < 3; i++) {
    h.clock.now += 8001;
    assert.equal((await h.op("drops.pulse", { channel: CHANNEL })).data.active, false);
  }
  assert.equal(h.session.dropPulse[CHANNEL], undefined, "état de la pulsation oublié");
});

test("drops.pulse : variante sur playlist.ttvnw.net (hôte des playlists aujourd'hui)", async () => {
  const h = loadBackground({ tabs: [liveTab()], local: { settings: { siteEnabled: true, autoClaim: false, allowSpend: true } } });
  h.tw.audioVariant = "https://euw31.playlist.ttvnw.net/v1/playlist/AUDIOsecret.m3u8";
  assert.deepEqual((await h.op("drops.pulse", { channel: CHANNEL })).data, { active: true, claimed: [] });
  assert.deepEqual(h.tw.heads, h.tw.segments);
  assertNoLeaks(h, "pulsation playlist.ttvnw.net");
});

// --- Qualités supérieures (hq.master, hq.playlist) ------------------------------------------------------------

const HQ_ALL = ["av1", "h265", "h264"];

test("hq.master : jeton du compte, supported_codecs, variantes sans aucune adresse", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const res = await h.op("hq.master", { channel: CHANNEL, codecs: ["h264", "h265", "av1"] });
  assert.equal(code(res), "ok");
  // usher : jeton du compte, codecs dans l'ordre de l'app (le plus efficace d'abord).
  assert.equal(h.tw.hqUsher.length, 1);
  assert.equal(h.tw.hqUsher[0].supported_codecs, "av1,h265,h264");
  assert.equal(h.tw.hqUsher[0].fast_bread, "true");
  assert.equal(h.gqlCount((b) => !Array.isArray(b) && b.query.includes("streamPlaybackAccessToken")), 1);
  const ids = res.data.variants.map((v) => v.id);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9]{22}$/);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(res.data.variants.map(({ id, ...v }) => v), [
    { name: "1440p60", source: true, width: 2560, height: 1440, fps: 60, bandwidth: 9500000, codecs: "hvc1.1.2.L150.90.0.0.0.0.0,mp4a.40.2" },
    { name: "1080p60", source: false, width: 1920, height: 1080, fps: 60, bandwidth: 6000000, codecs: "avc1.64002A,mp4a.40.2" },
    { name: "audio_only", source: false, width: 0, height: 0, fps: 0, bandwidth: 160000, codecs: "mp4a.40.2" }
  ], "720p (hôte inconnu) écartée ; ni IP ni données de séance");
  assert.deepEqual(Object.keys(res.data), ["variants"]);
  // Les adresses restent dans storage.session, liées à la session.
  const fp = await fingerprintOf(AUTH_TOKEN);
  assert.equal(h.session.hq[ids[0]].url, HQ_HOST + "HQ1440secret.m3u8");
  assert.equal(h.session.hq[ids[0]].fp, fp);
  assertNoLeaks(h, "hq.master");
});

test("hq.master : même réponse pendant 10 s, puis relue ; jeton anonyme, refus, hors ligne", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const a = await h.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL });
  h.clock.now += 9000;
  const b = await h.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL });
  assert.deepEqual(b, a, "même réponse, mêmes identifiants");
  assert.equal(h.tw.hqUsher.length, 1);
  await h.op("hq.master", { channel: CHANNEL, codecs: ["h264"] });
  assert.equal(h.tw.hqUsher.length, 2, "autres codecs : autre liste");
  assert.equal(h.tw.hqUsher[1].supported_codecs, "h264");
  h.clock.now += 1001;
  const c = await h.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL });
  assert.equal(h.tw.hqUsher.length, 3);
  assert.notEqual(c.data.variants[0].id, a.data.variants[0].id, "nouveaux identifiants");
  assert.ok(h.session.hq[a.data.variants[0].id], "les anciens restent valables (lecture en cours)");

  const anon = loadBackground({ tabs: [liveTab()] });
  anon.tw.patValue = '{"channel":"streamer_one","user_id":null}';
  assert.deepEqual((await anon.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL })).error, { code: "twitch", message: "playback_token" });
  assert.equal(anon.tw.usherCalls, 0, "jeton anonyme : rien demandé à usher (plafonné à 1080p)");

  const geo = loadBackground({ tabs: [liveTab()] });
  geo.tw.patValue = '{"authorization":{"forbidden":true,"reason":"GEOBLOCK"},"channel":"streamer_one","user_id":99887766}';
  assert.deepEqual((await geo.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL })).error, { code: "twitch", message: "forbidden" });
  assert.equal(geo.tw.usherCalls, 0);

  const off = loadBackground({ tabs: [liveTab()] });
  off.tw.hqMasterStatus = 404;
  assert.equal(code(await off.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL })), "offline");
  off.tw.hqMasterStatus = 403;
  off.clock.now += 10001;
  assert.deepEqual((await off.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL })).error, { code: "twitch", message: "http_403" });

  const none = loadBackground({ cookies: { "auth-token": "" } });
  assert.equal(code(await none.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL })), "no_session");
  assert.equal(none.tw.log.length, 0);
  for (const x of [h, anon, geo, off]) assertNoLeaks(x, "hq.master erreurs");
});

test("hq.playlist : playlist réécrite, segments du CDN seulement", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const master = await h.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL });
  const id = master.data.variants[0].id;
  const res = await h.op("hq.playlist", { id });
  assert.equal(code(res), "ok");
  assert.deepEqual(Object.keys(res.data), ["playlist"]);
  assert.equal(res.data.playlist, HQ_PLAYLIST_CLEAN);
  assert.equal(h.tw.hqPlaylistCalls, 1);
  assertNoLeaks(h, "hq.playlist");
  // La page ne peut pas faire lire une autre adresse : seul l'identifiant passe.
  const page = loadContent({ sendMessage: (m) => h.deliver(m, h.siteSender()) });
  await ticks(5);
  const viaPage = await page.reply(page.request("hq.playlist", { id }));
  assert.equal(viaPage.data.playlist, HQ_PLAYLIST_CLEAN);
  for (const p of page.posted) assertNoSecret(p.data, "message posté à la page", h.tw);
});

test("hq.playlist : adresses relatives jamais résolues contre celle de la variante", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  // Variante dont la partie signée est un dossier : résolue contre elle,
  // « seg1.mp4 » aurait donné …/v1/HQDIRsecret/seg1.mp4 à la page.
  h.tw.hqMaster = HQ_MASTER.replace(HQ_HOST + "HQ1440secret.m3u8", HQ_WEAVER + "index.m3u8");
  h.tw.hqPlaylist = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-MEDIA-SEQUENCE:7",
    '#EXT-X-MAP:URI="' + HQ_SEG + 'INIThq.mp4"',
    "#EXTINF:2.000,live",
    "seg1.mp4",
    "#EXTINF:2.000,live",
    "../seg2.mp4",
    "#EXTINF:2.000,live",
    "//video-edge-aa11.fra05.abs.hls.ttvnw.net/v1/segment/SEGhq3.mp4",
    "#EXTINF:2.000,live",
    HQ_SEG + "SEGhq4.mp4",
    "#EXT-X-TWITCH-PREFETCH:seg5.mp4",
    ""
  ].join("\n");
  const master = await h.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL });
  const id = master.data.variants[0].id;
  assert.equal(h.session.hq[id].url, HQ_WEAVER + "index.m3u8");
  const res = await h.op("hq.playlist", { id });
  assert.equal(res.data.playlist, [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-MEDIA-SEQUENCE:7",
    '#EXT-X-MAP:URI="' + HQ_SEG + 'INIThq.mp4"',
    "#EXTINF:2.000,live",
    "#EXT-X-GAP",
    "https://gap.invalid/1.ts",
    "#EXTINF:2.000,live",
    "#EXT-X-GAP",
    "https://gap.invalid/2.ts",
    "#EXTINF:2.000,live",
    "#EXT-X-GAP",
    "https://gap.invalid/3.ts",
    "#EXTINF:2.000,live",
    HQ_SEG + "SEGhq4.mp4",
    ""
  ].join("\n"));
  // Fichier d'initialisation relatif : toute la playlist est refusée.
  h.tw.hqPlaylist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.000,live\n' + HQ_SEG + "SEGhq1.mp4\n";
  h.clock.now += 1001;
  assert.deepEqual((await h.op("hq.playlist", { id })).error, { code: "twitch", message: "bad_response" });
  assertNoLeaks(h, "hq.playlist relatives");
});

test("hq.playlist : identifiant inconnu, ancien ou d'un autre compte ; erreurs de Twitch", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const master = await h.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL });
  const id = master.data.variants[0].id;
  assert.deepEqual((await h.op("hq.playlist", { id: "Zz0123456789abcdefghij" })).error, { code: "bad_args", message: "expired" });
  // Autre compte connecté à twitch.tv : les variantes du premier ne servent plus.
  const other = loadBackground({ tw: h.tw, clock: h.clock, session: h.session, local: h.local, cookies: { "auth-token": "zq7othersession0123456789ab" } });
  assert.deepEqual((await other.op("hq.playlist", { id })).error, { code: "bad_args", message: "expired" });
  // Erreurs de Twitch.
  h.tw.hqVariantStatus = 404;
  h.clock.now += 1001;
  assert.equal(code(await h.op("hq.playlist", { id })), "offline");
  h.tw.hqVariantStatus = 403;
  h.clock.now += 1001;
  assert.deepEqual((await h.op("hq.playlist", { id })).error, { code: "twitch", message: "http_403" });
  h.tw.hqVariantStatus = 200;
  h.clock.now += 1001;
  assert.equal(code(await h.op("hq.playlist", { id })), "ok");
  // Six heures plus tard : l'adresse n'est plus donnée.
  h.clock.now += 6 * 3600000;
  assert.deepEqual((await h.op("hq.playlist", { id })).error, { code: "bad_args", message: "expired" });
  assertNoLeaks(h, "hq.playlist erreurs");
});

test("hq.playlist : une lecture Twitch par seconde, budget de 240 par minute à part", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  const master = await h.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL });
  const id = master.data.variants[0].id;
  assert.equal(code(await h.op("hq.playlist", { id })), "ok");
  assert.equal(code(await h.op("hq.playlist", { id })), "ok");
  assert.equal(h.tw.hqPlaylistCalls, 1, "deuxième demande dans la seconde : la même playlist");
  h.clock.now += 1001;
  await h.op("hq.playlist", { id });
  assert.equal(h.tw.hqPlaylistCalls, 2);
  // Le site a épuisé ses 60 demandes de la minute : la lecture continue.
  h.clock.now += 61000;
  for (let i = 0; i < 60; i++) await h.op("hello", {});
  assert.equal(code(await h.op("hello", {})), "rate_limited");
  assert.equal(code(await h.op("hq.playlist", { id })), "ok", "budget à part");
  // ... mais pas sans limite.
  for (let i = 1; i < 240; i++) assert.equal(code(await h.op("hq.playlist", { id })), "ok", "demande " + (i + 1));
  assert.equal(code(await h.op("hq.playlist", { id })), "rate_limited");
  assert.equal(code(await h.op("points.get", { channel: CHANNEL })), "rate_limited", "le budget du site reste le sien");
  h.clock.now += 60001;
  assert.equal(code(await h.op("hq.playlist", { id })), "ok");
});

test("hq : connexion au site coupée, plus de session", async () => {
  const off = loadBackground({ local: { settings: { siteEnabled: false, autoClaim: true, allowSpend: true } } });
  assert.equal(code(await off.op("hq.master", { channel: CHANNEL, codecs: HQ_ALL })), "disabled");
  assert.equal(code(await off.op("hq.playlist", { id: HQ_TEST_ID })), "disabled");
  assert.equal(off.tw.log.length, 0);
  const none = loadBackground({ cookies: { "auth-token": "" }, session: await hqKnown({ now: 1_800_000_000_000 }) });
  assert.equal(code(await none.op("hq.playlist", { id: HQ_TEST_ID })), "no_session");
  assert.equal(none.tw.log.length, 0, "session partie : plus rien n'est lu");
});

// --- Récompenses de chaîne -------------------------------------------------------------------------------

test("rewards.get : récompenses, recharge, couleur, image, ordre par coût", async () => {
  const h = loadBackground();
  const until = new Date(h.clock.now + 60000).toISOString();
  h.tw.cooldowns = { "rw-cool": until };
  const res = await h.op("rewards.get", { channel: CHANNEL });
  assert.equal(res.data.balance, 1000);
  assert.deepEqual(res.data.rewards.map((r) => r.id), ["rw-off", "rw-stock", "rw-cool", "rw-paused", "rw-song", "rw-hydrate"]);
  const byId = Object.fromEntries(res.data.rewards.map((r) => [r.id, r]));
  assert.deepEqual(byId["rw-hydrate"], {
    id: "rw-hydrate", title: "Hydrate!", cost: 500, prompt: "Drink \"water\"\nnow", requiresInput: false, enabled: true,
    paused: false, inStock: true, cooldownEndsAt: null, color: "#9147FF",
    imageUrl: "https://static-cdn.jtvnw.net/custom-reward-images/default-2.png"
  });
  assert.equal(byId["rw-cool"].cooldownEndsAt, until);
  assert.equal(byId["rw-song"].color, "#00C389");
  assert.equal(byId["rw-song"].requiresInput, true);
  assert.equal(byId["rw-off"].enabled, false);
  assert.equal(byId["rw-off"].prompt, null);
  assert.equal(byId["rw-paused"].color, null);
});

test("rewards.redeem est une dépense : vrai clic et réglage", async () => {
  const h = loadBackground();
  assert.equal(code(await h.op("rewards.redeem", REDEEM)), "needs_activation");
  const off = loadBackground({ local: { settings: { siteEnabled: true, autoClaim: true, allowSpend: false } } });
  assert.equal(code(await off.spend("rewards.redeem", REDEEM)), "spend_disabled");
  assert.equal(h.tw.log.length + off.tw.log.length, 0);
  const page = loadContent({ sendMessage: async () => ({ ok: true, data: { claimed: true } }) });
  await ticks(5);
  const before = page.sent.length;
  assert.equal((await page.reply(page.request("rewards.redeem", REDEEM))).error.code, "needs_activation");
  assert.equal(page.sent.length, before, "rien transmis sans clic");
  // Les drops ne sont pas des dépenses.
  assert.equal((await page.reply(page.request("drops.claim", { dropInstanceId: "inst#1" }))).ok, true);
});

test("rewards.redeem : vérifications, mutation de l'app, solde", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.cooldowns = { "rw-cool": new Date(h.clock.now + 600000).toISOString() };
  const redeem = (over) => {
    h.clock.now += 3001;
    return h.spend("rewards.redeem", { ...REDEEM, ...over });
  };
  const why = (res) => res.error && res.error.code === "bad_args" ? res.error.message : code(res);
  assert.equal(why(await redeem({ rewardId: "rw-nope" })), "rewardId");
  assert.equal(why(await redeem({ rewardId: "rw-off", cost: 50, title: "Off", prompt: null })), "not_enabled");
  assert.equal(why(await redeem({ rewardId: "rw-paused", cost: 100, title: "Paused", prompt: null })), "paused");
  assert.equal(why(await redeem({ rewardId: "rw-stock", cost: 60, title: "Gone", prompt: null })), "out_of_stock");
  assert.equal(why(await redeem({ rewardId: "rw-cool", cost: 70, title: "Cooling", prompt: null })), "cooldown");
  assert.equal(why(await redeem({ cost: 499 })), "cost");
  assert.equal(why(await redeem({ title: "Hydrate" })), "title");
  assert.equal(why(await redeem({ input: "hello" })), "input", "saisie interdite sans requiresInput");
  const song = { rewardId: "rw-song", cost: 200, title: "Song request", prompt: "Name a song" };
  assert.equal(why(await redeem({ ...song, input: null })), "input", "saisie obligatoire");
  assert.equal(why(await redeem({ ...song, input: "   " })), "input");
  h.tw.balance = 400;
  assert.equal(why(await redeem({})), "points");
  h.tw.balance = 1000;
  assert.equal(h.tw.lastRedeem, null, "rien envoyé à Twitch avant ces vérifications");

  assert.deepEqual(await redeem({}), { ok: true, data: { balance: 500 } });
  const expected = "mutation { redeemCommunityPointsCustomReward(input: { channelID: \"123456\", cost: 500, prompt: " +
    JSON.stringify("Drink \"water\"\nnow") + ", rewardID: \"rw-hydrate\", title: \"Hydrate!\", transactionID: \"TX\" }) { redemption { id } error { code } } }";
  assert.equal(h.tw.lastRedeem.replace(/transactionID: "[0-9a-f-]{36}"/, "transactionID: \"TX\""), expected);

  assert.equal(code(await redeem({ ...song, input: "Never \"gonna\"" })), "ok");
  assert.ok(h.tw.lastRedeem.includes("prompt: " + JSON.stringify("Never \"gonna\"")), "saisie du spectateur dans prompt, comme l'app");
  h.tw.balance = 1000;
  h.tw.redeemError = "NOT_ENOUGH_POINTS";
  assert.deepEqual((await redeem({})).error, { code: "twitch", message: "NOT_ENOUGH_POINTS" });
  assertNoLeaks(h, "récompenses");
});

test("dépense : rien n'est envoyé plus de 30 s après la demande (le site abandonne à 45 s)", async () => {
  const h = loadBackground({ tabs: [liveTab()] });
  h.tw.prediction = { id: "ev-5", title: "Win?", outcomes: [{ id: "o-blue", title: "Yes", color: "BLUE", totalPoints: 0, totalUsers: 0 }] };
  const bet = () => h.spend("predictions.bet", { channel: CHANNEL, eventId: "ev-5", outcomeId: "o-blue", points: 100 });
  h.tw.mintTakesMs = 30001;
  assert.equal(code(await bet()), "timeout");
  assert.equal(h.tw.lastBet, undefined, "pari jamais envoyé : le site croirait à un échec et laisserait recommencer");
  assert.equal(h.tw.balance, 1000);
  // Jeton gardé : le pari suivant part tout de suite.
  h.tw.mintTakesMs = 0;
  h.clock.now += 3001;
  assert.equal(code(await bet()), "ok");
  assert.equal(h.tw.lastBet.points, 100);
  // Jeton refusé, nouvelle obtention trop longue : le rachat n'est pas renvoyé.
  h.tw.integrityFailNext = 1;
  h.tw.mintTakesMs = 30001;
  h.clock.now += 3001;
  assert.equal(code(await h.spend("rewards.redeem", REDEEM)), "timeout");
  assert.equal(h.tw.lastRedeem, null);
  assert.equal(h.tw.balance, 900);
});

// --- Content script --------------------------------------------------------------------------------------

test("content script : annonce hello au chargement", async () => {
  const bg = loadBackground();
  const page = loadContent({ sendMessage: (m) => bg.deliver(m, bg.siteSender()) });
  await ticks(20);
  const hello = page.posted.find((p) => p.data.dir === "hello");
  assert.deepEqual(hello, { data: { tuConnect: 1, dir: "hello", protocol: 1, version: MANIFEST.version, enabled: true }, targetOrigin: SITE });
});

test("content script : filtres sur la source, l'origine et tuConnect", async () => {
  const page = loadContent({ sendMessage: async () => ({ ok: true, data: {} }) });
  await ticks(5);
  const before = page.sent.length;
  const req = { tuConnect: 1, dir: "req", id: "z1", op: "hello", args: {} };
  page.dispatch(req, { source: {} });                                // autre fenêtre (cadre, popup)
  page.dispatch(req, { origin: "https://evil.example" });
  page.dispatch({ ...req, tuConnect: 2 });
  page.dispatch({ ...req, tuConnect: "1" });
  page.dispatch({ ...req, dir: "res" });
  page.dispatch({ ...req, id: "" });
  page.dispatch({ ...req, id: "x".repeat(65) });
  page.dispatch("tuConnect");
  page.dispatch(null);
  await ticks(10);
  assert.equal(page.sent.length, before, "rien transmis");
  assert.equal(page.posted.filter((p) => p.data.dir === "res").length, 0, "aucune réponse");
});

test("content script : opération inconnue et arguments refusés sans transmettre", async () => {
  const page = loadContent({ sendMessage: async () => ({ ok: true, data: {} }) });
  await ticks(5);
  const before = page.sent.length;
  assert.deepEqual(await page.reply(page.request("gql.raw", {})), { tuConnect: 1, dir: "res", id: "q1", ok: false, error: { code: "unknown_op" } });
  assert.deepEqual((await page.reply(page.request("points.get", { channel: "Bad" }))).error, { code: "bad_args", message: "channel" });
  assert.equal(page.sent.length, before);
});

test("content script et arrière-plan : même validation", async () => {
  const clock = { now: 1_800_000_000_000 };
  const bg = loadBackground({ clock, session: await hqKnown(clock) });
  const page = loadContent({ sendMessage: async () => ({ ok: true, data: {} }) });
  page.nav.userActivation.isActive = true;
  await ticks(5);
  for (const [op, args, expected] of ARG_CASES) {
    const id = page.request(op, args);
    const res = await page.reply(id);
    const fromPage = res.ok ? "ok" : res.error.code;
    const direct = await bg.deliver({ tuConnect: 1, kind: "op", id: "p", op, args, activation: true }, bg.siteSender());
    const fromBg = direct && direct.ok === false && direct.error.code === "bad_args" ? "bad_args" : "ok";
    assert.equal(fromPage, expected, "content " + op + " " + JSON.stringify(args));
    assert.equal(fromBg, expected, "arrière-plan " + op + " " + JSON.stringify(args));
    bg.clock.now += 61000;
  }
});

test("content script : dépense seulement après un vrai clic", async () => {
  const page = loadContent({ sendMessage: async () => ({ ok: true, data: { balance: 1 } }) });
  await ticks(5);
  const bet = { channel: CHANNEL, eventId: "ev-1", outcomeId: "o-blue", points: 10 };
  const before = page.sent.length;
  assert.equal((await page.reply(page.request("predictions.bet", bet))).error.code, "needs_activation");
  assert.equal((await page.reply(page.request("polls.vote", { channel: CHANNEL, pollId: "p1", choiceId: "c1", withPoints: false }))).error.code, "needs_activation");
  assert.equal(page.sent.length, before, "rien transmis sans clic");
  // raid.join n'est pas une dépense : pas de clic exigé.
  assert.equal((await page.reply(page.request("raid.join", { channel: CHANNEL, raidId: "abcd-1" }))).ok, true);
  page.nav.userActivation.isActive = true;
  assert.equal((await page.reply(page.request("predictions.bet", bet))).ok, true);
  const last = page.sent[page.sent.length - 1];
  assert.deepEqual(last, { tuConnect: 1, kind: "op", id: "q4", op: "predictions.bet", args: bet, activation: true });
});

test("content script : au plus 16 demandes en cours", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const page = loadContent({ sendMessage: (m) => (m.id === "announce" ? Promise.resolve(undefined) : gate.then(() => ({ ok: true, data: {} }))) });
  await ticks(5);
  const ids = [];
  for (let i = 0; i < 17; i++) ids.push(page.request("hello", {}));
  assert.equal((await page.reply(ids[16])).error.code, "rate_limited");
  release();
  assert.equal((await page.reply(ids[0])).ok, true);
});

test("content script + arrière-plan : de bout en bout, sans jeton dans la page", async () => {
  const bg = loadBackground({ tabs: [liveTab()] });
  const page = loadContent({ sendMessage: (m) => bg.deliver(m, bg.siteSender()) });
  await ticks(5);
  const got = await page.reply(page.request("points.get", { channel: CHANNEL }));
  assert.equal(got.ok, true);
  assert.equal(got.data.balance, 1000);
  const claimed = await page.reply(page.request("points.claim", { channel: CHANNEL }));
  assert.deepEqual(claimed.data, { claimed: 50, balance: 1050 });
  const preview = loadContent({ origin: PREVIEW, sendMessage: (m) => bg.deliver(m, bg.siteSender({ url: PREVIEW + "/", origin: PREVIEW })) });
  assert.equal((await preview.reply(preview.request("status", {}))).data.session.login, "viewer_one");
  for (const p of page.posted.concat(preview.posted)) {
    assertNoSecret(p.data, "message posté à la page", bg.tw);
    assert.ok(p.targetOrigin === SITE || p.targetOrigin === PREVIEW, "postMessage vers la seule origine de la page");
  }
});

test("content script : orphelin silencieux, réinjection sans doublon", async () => {
  const hello = { ok: true, data: { protocol: 1, version: MANIFEST.version, enabled: true, browser: "chrome" } };
  const page = loadContent({ sendMessage: async () => hello });
  await ticks(5);
  // Réinjecté alors qu'il est encore valide (Firefox l'injecte déjà, mise à jour du navigateur) : rien de plus.
  page.inject();
  await ticks(5);
  const once = (id) => page.posted.filter((p) => p.data.dir === "res" && p.data.id === id).length;
  const a = page.request("hello", {});
  assert.equal((await page.reply(a)).ok, true);
  await ticks(5);
  assert.equal(once(a), 1, "une seule réponse");
  assert.equal(page.sent.filter((m) => m.id === a).length, 1, "une seule demande transmise");
  // Mise à jour sous Chrome : l'ancien, orphelin, se tait ; le réinjecté répond seul.
  page.orphan();
  page.inject();
  await ticks(5);
  const b = page.request("hello", {});
  assert.equal((await page.reply(b)).ok, true);
  await ticks(5);
  assert.equal(once(b), 1, "pas de réponse `internal` de l'orphelin");
  assert.equal(page.listeners.length, 1, "l'orphelin a retiré son écouteur");
});

test("réglage changé : nouvelle annonce ; installation ou mise à jour : content script réinjecté", async () => {
  const h = loadBackground({ tabs: [
    liveTab(),
    { id: 21, url: SITE + "/live/" + CHANNEL },
    { id: 22, url: PREVIEW + "/", incognito: true },
    { id: 23, url: "https://example.com/" }
  ] });
  h.local.settings = { siteEnabled: false, autoClaim: true, allowSpend: true };
  h.chrome.storage.onChanged.listeners[0]({ settings: { newValue: h.local.settings } }, "local");
  h.chrome.storage.onChanged.listeners[0]({ deviceId: { newValue: "x" } }, "local");
  await ticks(5);
  assert.deepEqual(h.tabLog.messages, [{ tabId: 21, msg: { tuConnect: 1, kind: "announce", enabled: false }, options: { frameId: 0 } }],
    "onglets du site seulement, hors navigation privée, et seulement pour les réglages");
  h.chrome.runtime.onInstalled.listeners[0]({ reason: "update" });
  await ticks(5);
  assert.deepEqual(h.tabLog.injected, [21]);
  // Le content script relaie l'annonce de l'extension à la page, rien d'autre.
  const page = loadContent();
  await ticks(5);
  page.runtimeMessage({ tuConnect: 1, kind: "announce", enabled: false }, { id: EXT_ID });
  page.runtimeMessage({ tuConnect: 1, kind: "announce", enabled: true }, { id: EXT_ID, tab: { id: 5 } });
  page.runtimeMessage({ tuConnect: 1, kind: "announce", enabled: true }, { id: "autre" });
  page.runtimeMessage({ tuConnect: 1, kind: "announce", enabled: "oui" }, { id: EXT_ID });
  assert.deepEqual(page.posted.filter((p) => p.data.dir === "hello").map((p) => p.data),
    [{ tuConnect: 1, dir: "hello", protocol: 1, version: MANIFEST.version, enabled: false }]);
});

// --- Manifeste ---------------------------------------------------------------------------------------------

test("manifeste : origines, permissions et arrière-plan attendus", () => {
  assert.equal(MANIFEST.manifest_version, 3);
  // Version Chrome : rien que Chrome, Edge ou Brave signaleraient en avertissement.
  assert.deepEqual(MANIFEST.background, { service_worker: "background.js" });
  assert.equal(MANIFEST.browser_specific_settings, undefined);
  assert.deepEqual(MANIFEST.content_scripts, [{ matches: [SITE + "/*", PREVIEW + "/*"], js: ["content.js"], run_at: "document_start", all_frames: false }]);
  // 0.2.0 (qualités supérieures) : aucune permission de plus — pas de
  // declarativeNetRequest ni de webRequest : la page ne lit pas les playlists
  // de Twitch elle-même, l'extension les lui rend (hq.playlist).
  assert.equal(MANIFEST.version, "0.2.0");
  assert.deepEqual([...MANIFEST.permissions].sort(), ["cookies", "scripting", "storage", "tabs"]);
  assert.equal(MANIFEST.declarative_net_request, undefined);
  assert.equal(MANIFEST.optional_permissions, undefined);
  assert.equal(MANIFEST.externally_connectable, undefined);
  assert.equal(MANIFEST.web_accessible_resources, undefined);
  // Version Firefox (dev/build-firefox.mjs) : script d'arrière-plan et identifiant.
  const firefox = firefoxManifest(MANIFEST);
  assert.deepEqual(firefox.background, { scripts: ["background.js"] });
  assert.equal(firefox.browser_specific_settings.gecko.id, "connect@twitchunblock.app");
  assert.deepEqual(firefox.content_scripts, MANIFEST.content_scripts);
  assert.deepEqual(firefox.host_permissions, MANIFEST.host_permissions);
  assert.deepEqual(MANIFEST.host_permissions, [
    "https://*.twitch.tv/*", "https://static.twitchcdn.net/*", "https://usher.ttvnw.net/*", "https://*.hls.ttvnw.net/*",
    "https://*.playlist.ttvnw.net/*", SITE + "/*", PREVIEW + "/*"
  ], "Twitch (playlists des directs comprises), et les deux origines du site (réinjection du content script)");
  // La fenêtre de l'extension vérifie les mêmes accès (Firefox : accordables un à un).
  const popup = readFileSync(join(DIR, "popup.js"), "utf8");
  for (const origin of MANIFEST.host_permissions) assert.ok(popup.includes(JSON.stringify(origin)), "popup.js : " + origin);
  const en = JSON.parse(readFileSync(join(DIR, "_locales", "en", "messages.json"), "utf8"));
  for (const lang of ["fr", "es", "ru", "it", "ja"]) {
    const other = JSON.parse(readFileSync(join(DIR, "_locales", lang, "messages.json"), "utf8"));
    assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort(), "mêmes clés en " + lang);
    for (const k of Object.keys(en)) assert.deepEqual(other[k].placeholders, en[k].placeholders, lang + "." + k);
  }
});

// --- Lancement -----------------------------------------------------------------------------------------------

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log("ok   " + t.name);
  } catch (e) {
    failed++;
    console.log("ÉCHEC " + t.name);
    console.log("     " + String(e && e.stack ? e.stack : e).split("\n").slice(0, 6).join("\n     "));
  }
}
console.log("\n" + (tests.length - failed) + "/" + tests.length + " essais réussis");
process.exit(failed ? 1 : 0);
