"use strict";

// ---------------------------------------------------------------------------
// Fenêtre de TwitchUnblock Connect.
//
// Elle ne voit jamais les jetons : l'arrière-plan lui donne un état nettoyé
// (pseudo, échéance du jeton d'intégrité) et, pour le diagnostic, des jetons
// masqués (4 premiers caractères et longueur). Les réglages ne se changent
// qu'ici, dans storage.local ; la page du site ne peut pas les toucher.
// ---------------------------------------------------------------------------

const api = globalThis.browser || globalThis.chrome;

// Accès d'hôte du manifeste (accordables et retirables un à un sous Firefox,
// dans about:addons, ou sous Chrome par « Accès au site »). Les deux origines
// du site servent au content script et à sa réinjection après une mise à jour.
const HOST_ORIGINS = [
  "https://*.twitch.tv/*",
  "https://static.twitchcdn.net/*",
  "https://usher.ttvnw.net/*",
  "https://*.hls.ttvnw.net/*"
];
const SITE_ORIGINS = [
  "https://twitchunblock.vercel.app/*",
  "https://test2-git-test-17d298-mxfia19s-projects.vercel.app/*"
];
const NEEDED_ORIGINS = HOST_ORIGINS.concat(SITE_ORIGINS);
const DEFAULT_SETTINGS = { siteEnabled: true, autoClaim: true, allowSpend: true };

const $ = (id) => document.getElementById(id);

const LANG = (() => {
  try {
    return api.i18n.getUILanguage() || "en";
  } catch (e) {
    return "en";
  }
})();

function t(key, subs) {
  try {
    return api.i18n.getMessage(key, subs) || key;
  } catch (e) {
    return key;
  }
}

function fmtDate(ms) {
  try {
    return new Date(ms).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" });
  } catch (e) {
    return new Date(ms).toLocaleString();
  }
}

function fmtMask(m) {
  return m && typeof m.head === "string" ? t("maskFormat", [m.head, String(m.len)]) : "—";
}

function setDot(el, kind) {
  el.className = "dot" + (kind ? " " + kind : "");
}

function localize() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const text = t(el.dataset.i18n);
    if (text) el.textContent = text;
  }
  $("version").textContent = t("versionLabel", [api.runtime.getManifest().version]);
}

function ask(cmd) {
  try {
    return Promise.resolve(api.runtime.sendMessage({ tuPopup: 1, cmd }));
  } catch (e) {
    return Promise.reject(e);
  }
}

// --- État -----------------------------------------------------------------

async function showState() {
  let st = null;
  try {
    st = await ask("state");
  } catch (e) {
    st = null;
  }
  const sDot = $("session-dot");
  const sText = $("session-text");
  const iDot = $("integrity-dot");
  const iText = $("integrity-text");
  if (!st) {
    setDot(sDot, "err");
    sText.textContent = t("sessionError");
    setDot(iDot, "");
    iText.textContent = "";
    return;
  }
  const s = st.session || {};
  $("open-twitch").hidden = s.state === "ok";
  if (s.state === "ok") {
    setDot(sDot, "ok");
    sText.textContent = t("sessionConnected", [s.login]);
  } else if (s.state === "invalid") {
    setDot(sDot, "err");
    sText.textContent = t("sessionInvalid");
  } else if (s.state === "error") {
    setDot(sDot, "warn");
    sText.textContent = t("sessionError");
  } else {
    setDot(sDot, "err");
    sText.textContent = t("sessionNone");
  }
  if (st.integrity && st.integrity.until) {
    setDot(iDot, "ok");
    iText.textContent = t("integrityUntil", [fmtDate(st.integrity.until)]);
  } else {
    setDot(iDot, "");
    iText.textContent = t("integrityNone");
  }
}

// --- Réglages ---------------------------------------------------------------

async function readSettings() {
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

function updateDependents() {
  const on = $("set-siteEnabled").checked;
  $("set-autoClaim").disabled = !on;
  $("set-allowSpend").disabled = !on;
}

async function saveSetting(key, value) {
  const next = await readSettings();
  next[key] = value;
  try {
    await api.storage.local.set({ settings: next });
  } catch (e) {
    // la case reviendra à l'état enregistré à la prochaine ouverture
  }
  updateDependents();
}

async function loadSettings() {
  const s = await readSettings();
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const box = $("set-" + k);
    box.checked = s[k];
    box.addEventListener("change", () => saveSetting(k, box.checked));
  }
  updateDependents();
}

// --- Autorisations (surtout Firefox, où l'utilisateur peut les retirer) --------

async function checkPermissions() {
  let granted = true;
  try {
    granted = await api.permissions.contains({ origins: NEEDED_ORIGINS });
  } catch (e) {
    granted = true;
  }
  $("perms").hidden = granted;
}

function grant() {
  // Appelé directement dans le clic : Firefox exige le geste de l'utilisateur.
  let p;
  try {
    p = api.permissions.request({ origins: NEEDED_ORIGINS });
  } catch (e) {
    p = Promise.reject(e);
  }
  Promise.resolve(p).then((ok) => {
    if (ok) {
      checkPermissions();
      showState();
    } else {
      $("perms-hint").hidden = false;
    }
  }, () => {
    $("perms-hint").hidden = false;
  });
}

// --- Diagnostic ------------------------------------------------------------------

async function diagnose() {
  const btn = $("diag");
  const outS = $("diag-session");
  const outI = $("diag-integrity");
  btn.disabled = true;
  outS.className = "result";
  outS.textContent = t("diagRunning");
  outI.className = "result";
  outI.textContent = "";
  let r = null;
  try {
    r = await ask("diagnose");
  } catch (e) {
    r = null;
  }
  btn.disabled = false;
  if (!r || !r.session) {
    outS.className = "result err";
    outS.textContent = t("diagFailed");
    return;
  }
  const s = r.session;
  if (s.ok) {
    outS.className = "result ok";
    outS.textContent = [
      t("diagSessionOk", [s.login, s.userId]),
      t("diagClientId", [s.clientId || "—"]),
      t("diagAuthToken", [fmtMask(s.token)])
    ].join("\n");
  } else {
    outS.className = "result err";
    outS.textContent =
      s.code === "no_session" ? t("diagSessionNone") :
      s.code === "invalid" ? t("diagSessionInvalid") :
      t("diagSessionError", [s.code + (s.detail ? " · " + s.detail : "")]);
  }
  const i = r.integrity;
  if (i && i.ok) {
    outI.className = "result ok";
    outI.textContent = [
      t("diagIntegrityOk", [fmtMask(i.token)]),
      t("diagIntegrityUntil", [fmtDate(i.until)]),
      t("diagDevice", [fmtMask(i.device)]),
      t("diagVia", [t(i.via === "tab" ? "viaTab" : "viaTemp")])
    ].join("\n");
  } else if (i) {
    outI.className = "result err";
    outI.textContent = t("diagIntegrityFail", [i.detail || "—"]);
  }
  showState();
}

// --- Démarrage ---------------------------------------------------------------------

localize();
$("session-text").textContent = t("sessionChecking");
$("diag").addEventListener("click", diagnose);
$("grant").addEventListener("click", grant);
$("open-twitch").addEventListener("click", () => {
  Promise.resolve(api.tabs.create({ url: "https://www.twitch.tv/login" })).catch(() => {});
  window.close();
});
loadSettings();
checkPermissions();
showState();
