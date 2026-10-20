"use strict";

// ---------------------------------------------------------------------------
// TwitchUnblock Connect — essai (etape 0)
//
// But : verifier, depuis une extension, qu'on peut faire ce que font les apps
// iOS et Android (voir TwitchWebGQL.swift / Integrity.kt) SANS faire sortir la
// session Twitch de l'extension.
//
// Comment le jeton d'integrite est obtenu (le point delicat) :
//   Les mutations « points » de Twitch exigent un en-tete `Client-Integrity`
//   valide, produit par le script anti-robots (Kasada) de twitch.tv. On ne
//   peut pas le fabriquer soi-meme. L'astuce des apps : laisser une vraie page
//   twitch.tv faire la requete `POST /integrity` — son script y ajoute tout
//   seul ses en-tetes de protection — puis reutiliser le jeton obtenu (valable
//   ~1 h) pour des requetes faites directement par l'app.
//   Ici, l'equivalent navigateur : on execute ce `fetch` DANS le contexte de la
//   page (`scripting.executeScript` avec `world: "MAIN"`), dans un onglet
//   twitch.tv deja ouvert si possible, sinon un onglet inactif ouvert le temps
//   de l'essai puis referme.
//
// Securite : aucune communication avec un site tiers, aucun `externally_connectable`.
// Les jetons restent en memoire de cette fenetre, ne sont jamais journalises,
// et ne sont affiches que masques (4 premiers caracteres + longueur).
// ---------------------------------------------------------------------------

// Un seul code pour Chrome/Edge (chrome.*) et Firefox (browser.*). Les deux
// renvoient des promesses sur les API utilisees ici.
const api = globalThis.browser || globalThis.chrome;

// Constantes PUBLIQUES de twitch.tv (presentes dans le JS du site, pas des secrets).
const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
// Hash de la persisted query `ClaimCommunityPoints`, identique aux apps.
const CLAIM_HASH = "46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0";

// Etat partage par les boutons (vit tant que la fenetre est ouverte).
const state = {
  session: null,    // { token, login?, userId? }
  integrity: null,  // { token, expiration, deviceId }
  deviceId: "",     // identifiant d'appareil (cookie unique_id, ou genere)
  channelId: null,  // id numerique de la chaine (pour la reclamation)
  claimId: null     // id du coffre disponible (pour la reclamation)
};

// --- Petits utilitaires -----------------------------------------------------

// Masque un jeton : au plus 4 premiers caracteres + longueur. Jamais en clair.
function mask(tok) {
  if (!tok) return "(vide)";
  return tok.slice(0, 4) + "… (" + tok.length + " car.)";
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Identifiant d'appareil de secours (32 caracteres), si pas de cookie unique_id.
function randomDeviceId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let d = "";
  for (let i = 0; i < 32; i++) d += chars[Math.floor(Math.random() * chars.length)];
  return d;
}

// Nettoie le nom de chaine saisi (minuscules, caracteres Twitch valides).
function cleanChannel(raw) {
  return (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

// Affiche un resultat dans la ligne d'un bouton.
function show(id, kind, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "result " + kind; // "ok" | "err" | "busy" | ""
  el.textContent = msg;
}

// --- Session (cookie auth-token de twitch.tv) -------------------------------

// Lit le cookie de session si on ne l'a pas encore. Ne l'affiche jamais.
async function ensureSession() {
  if (state.session && state.session.token) return state.session;
  const c = await api.cookies.get({ url: "https://www.twitch.tv", name: "auth-token" });
  if (!c || !c.value) {
    throw new Error("Cookie auth-token introuvable. Connecte-toi a twitch.tv dans ce navigateur.");
  }
  state.session = { token: c.value };
  return state.session;
}

// Recupere l'identifiant d'appareil (cookie unique_id), sinon en genere un.
async function ensureDeviceId() {
  if (state.deviceId) return state.deviceId;
  try {
    const c = await api.cookies.get({ url: "https://www.twitch.tv", name: "unique_id" });
    if (c && c.value) { state.deviceId = c.value; return state.deviceId; }
  } catch (e) { /* lecture impossible : on genere */ }
  state.deviceId = randomDeviceId();
  return state.deviceId;
}

// --- Jeton d'integrite ------------------------------------------------------

// FONCTION INJECTEE dans la page twitch.tv (monde MAIN). Elle est serialisee :
// elle ne voit QUE ses arguments, pas les variables de ce fichier. C'est le
// `fetch` de la page (habille par le script de Twitch) qui signe la requete.
async function pageIntegrityFetch(clientId, oauthToken, deviceId) {
  try {
    const did = deviceId || (document.cookie.match(/unique_id=([^;]+)/) || [])[1] || "";
    const r = await fetch("https://gql.twitch.tv/integrity", {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        "Authorization": "OAuth " + oauthToken,
        "X-Device-Id": did
      }
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* reponse non-JSON */ }
    return {
      ok: r.ok,
      status: r.status,
      token: (body && body.token) || "",
      expiration: (body && body.expiration) || 0,
      deviceId: did,
      note: body ? "" : text.slice(0, 160)
    };
  } catch (e) {
    return { ok: false, status: 0, error: String(e), deviceId: deviceId || "" };
  }
}

// Cherche un onglet twitch.tv deja ouvert (de preference charge).
async function findTwitchTab() {
  try {
    const tabs = await api.tabs.query({ url: ["*://*.twitch.tv/*"] });
    if (!tabs || !tabs.length) return null;
    return tabs.find((t) => t.status === "complete") || tabs[0];
  } catch (e) {
    return null;
  }
}

// Attend qu'un onglet ait fini de charger (avec garde-fou).
function waitForComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { api.tabs.onUpdated.removeListener(onUpd); } catch (e) {}
      resolve(ok);
    };
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") finish(true); };
    api.tabs.onUpdated.addListener(onUpd);
    api.tabs.get(tabId).then((t) => { if (t && t.status === "complete") finish(true); }).catch(() => {});
    setTimeout(() => finish(false), timeoutMs);
  });
}

// Execute la requete d'integrite dans le contexte (monde MAIN) d'un onglet.
async function runIntegrityIn(tabId) {
  const results = await api.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: pageIntegrityFetch,
    args: [CLIENT_ID, state.session.token, state.deviceId]
  });
  return results && results[0] ? results[0].result : null;
}

// Obtient un jeton d'integrite : onglet existant si possible, sinon onglet
// inactif ouvert le temps de l'essai puis referme.
async function mintIntegrity() {
  await ensureSession();
  await ensureDeviceId();

  // 1) Onglet twitch.tv deja ouvert.
  const existing = await findTwitchTab();
  if (existing) {
    try {
      const res = await runIntegrityIn(existing.id);
      if (res && res.token) return res;
      // Pas de jeton : on tentera un onglet neuf (la page etait peut-etre pas prete).
    } catch (e) { /* on bascule sur un onglet neuf */ }
  }

  // 2) Onglet neuf, inactif (en arriere-plan).
  const tab = await api.tabs.create({ url: "https://www.twitch.tv/", active: false });
  try {
    await waitForComplete(tab.id, 20000);
    // Laisse ~3 s au script de Twitch pour s'initialiser (comme les apps).
    await wait(3000);
    return await runIntegrityIn(tab.id);
  } finally {
    try { await api.tabs.remove(tab.id); } catch (e) { /* deja ferme */ }
  }
}

// --- GQL (requetes faites directement par la fenetre, comme en natif) --------

// Un `fetch` GQL signe de la session et, si on l'a, du jeton d'integrite.
// NB : le navigateur ignore un en-tete User-Agent impose ; c'est voulu, la
// vraie UA du navigateur est la bonne (coherente avec le jeton d'integrite).
async function gqlFetch(bodyObj, integrity) {
  const headers = {
    "Client-ID": CLIENT_ID,
    "Content-Type": "text/plain;charset=UTF-8",
    "Authorization": "OAuth " + state.session.token,
    "X-Device-Id": (integrity && integrity.deviceId) || state.deviceId || ""
  };
  if (integrity && integrity.token) headers["Client-Integrity"] = integrity.token;
  const r = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers,
    body: JSON.stringify(bodyObj)
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* corps non-JSON */ }
  return { status: r.status, json };
}

// Messages d'erreur GQL en une ligne (vide s'il n'y en a pas).
function gqlErrors(obj) {
  const errs = obj && obj.errors;
  if (!Array.isArray(errs) || !errs.length) return "";
  return errs.map((e) => e && e.message).filter(Boolean).join(" · ");
}

// --- Boutons ----------------------------------------------------------------

// 1 · Session : lit le cookie auth-token et le valide aupres de Twitch.
async function onSession() {
  show("res-session", "busy", "Lecture du cookie et validation…");
  try {
    await ensureSession();
    const r = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { "Authorization": "OAuth " + state.session.token }
    });
    if (!r.ok) {
      const why = r.status === 401 ? "jeton invalide ou expire" : "HTTP " + r.status;
      show("res-session", "err", "Echec : session non valide (" + why + ").");
      return;
    }
    const j = await r.json();
    state.session.login = j.login;
    state.session.userId = j.user_id;
    show("res-session", "ok",
      "OK — @" + j.login + " (id " + j.user_id + ")\n" +
      "Client-ID du jeton : " + j.client_id + "\n" +
      "auth-token : " + mask(state.session.token));
  } catch (e) {
    show("res-session", "err", "Echec : " + e.message);
  }
}

// 2 · Jeton d'integrite : obtenu via une page twitch.tv (monde MAIN).
async function onIntegrity() {
  show("res-integrity", "busy", "Obtention via une page twitch.tv… (quelques secondes)");
  try {
    const res = await mintIntegrity();
    if (!res) {
      show("res-integrity", "err", "Echec : aucune reponse de la page twitch.tv.");
      return;
    }
    if (res.error) {
      show("res-integrity", "err", "Echec dans la page : " + res.error);
      return;
    }
    if (!res.token) {
      const extra = res.note ? ("\nReponse : " + res.note) : "";
      show("res-integrity", "err",
        "Echec : jeton vide (HTTP " + res.status + "). Le script de Twitch n'a pas valide l'environnement." + extra);
      return;
    }
    state.integrity = { token: res.token, expiration: res.expiration, deviceId: res.deviceId || state.deviceId };
    if (res.deviceId) state.deviceId = res.deviceId;
    const exp = res.expiration ? new Date(res.expiration).toLocaleString("fr-FR") : "inconnue";
    show("res-integrity", "ok",
      "OK — jeton d'integrite obtenu : " + mask(res.token) + "\n" +
      "Expiration : " + exp + "\n" +
      "Appareil : " + mask(state.integrity.deviceId));
  } catch (e) {
    show("res-integrity", "err", "Echec : " + e.message);
  }
}

// 3 · Solde des points : lecture GQL pour la chaine saisie.
async function onBalance() {
  const login = cleanChannel(document.getElementById("channel").value);
  if (!login) {
    show("res-balance", "err", "Saisis d'abord une chaine.");
    return;
  }
  show("res-balance", "busy", "Lecture du solde pour « " + login + " »…");
  try {
    await ensureSession();
    await ensureDeviceId();
    const query = "{ channel(name: \"" + login + "\") { id self { communityPoints { balance availableClaim { id } } } } }";
    const { status, json } = await gqlFetch({ query }, state.integrity);
    if (status !== 200 || !json) {
      show("res-balance", "err", "Echec : HTTP " + status + ".");
      return;
    }
    const errs = gqlErrors(json);
    if (errs) { show("res-balance", "err", "Erreurs GQL : " + errs); return; }

    const channel = json.data && json.data.channel;
    if (!channel) { show("res-balance", "err", "Chaine « " + login + " » introuvable."); return; }
    state.channelId = channel.id;

    const cp = channel.self && channel.self.communityPoints;
    if (!cp) {
      show("res-balance", "err",
        "communityPoints null — jamais regarde cette chaine, ou jeton incompatible (pas une session web).");
      return;
    }
    const balance = cp.balance != null ? cp.balance : 0;
    state.claimId = (cp.availableClaim && cp.availableClaim.id) || null;

    const claimBtn = document.getElementById("btn-claim");
    claimBtn.disabled = !state.claimId;

    const signed = state.integrity ? "signe (integrite)" : "non signe (session seule)";
    show("res-balance", "ok",
      "OK — solde : " + balance + " points\n" +
      "Coffre disponible : " + (state.claimId ? "OUI" : "non") + "\n" +
      "Lecture : " + signed);
  } catch (e) {
    show("res-balance", "err", "Echec : " + e.message);
  }
}

// 4 · Reclamer le coffre : mutation ClaimCommunityPoints, si un coffre existe.
async function onClaim() {
  show("res-claim", "busy", "Reclamation du coffre…");
  try {
    await ensureSession();
    if (!state.integrity) {
      show("res-claim", "err", "Execute d'abord « Jeton d'integrite » (bouton 2).");
      return;
    }
    if (!state.claimId || !state.channelId) {
      show("res-claim", "err", "Aucun coffre connu. Clique « Solde des points » (bouton 3).");
      return;
    }
    const body = [{
      operationName: "ClaimCommunityPoints",
      variables: { input: { channelID: state.channelId, claimID: state.claimId } },
      extensions: { persistedQuery: { version: 1, sha256Hash: CLAIM_HASH } }
    }];
    const { status, json } = await gqlFetch(body, state.integrity);
    if (status !== 200) { show("res-claim", "err", "Echec : HTTP " + status + "."); return; }

    const first = Array.isArray(json) ? json[0] : json;
    const errs = gqlErrors(first);
    if (errs) {
      // Jeton d'integrite probablement expire : on l'oublie pour re-generer.
      if (errs.toLowerCase().includes("integrity")) state.integrity = null;
      show("res-claim", "err", "Erreurs GQL : " + errs);
      return;
    }
    const claim = first && first.data && first.data.claimCommunityPoints;
    if (claim && claim.error && claim.error.code) {
      show("res-claim", "err", "Refuse par Twitch — code : " + claim.error.code);
      return;
    }
    // Pas d'erreur : reussite. Le coffre est consomme.
    state.claimId = null;
    document.getElementById("btn-claim").disabled = true;
    const pts = claim && claim.currentPoints != null ? (" — total : " + claim.currentPoints + " points") : "";
    show("res-claim", "ok", "OK — coffre reclame" + pts + ".");
  } catch (e) {
    show("res-claim", "err", "Echec : " + e.message);
  }
}

// --- Branchement des boutons ------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-session").addEventListener("click", onSession);
  document.getElementById("btn-integrity").addEventListener("click", onIntegrity);
  document.getElementById("btn-balance").addEventListener("click", onBalance);
  document.getElementById("btn-claim").addEventListener("click", onClaim);
});
