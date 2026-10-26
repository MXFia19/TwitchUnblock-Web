"use strict";

// ---------------------------------------------------------------------------
// TwitchUnblock Connect — pont entre le site et l'extension (PROTOCOL.md)
//
// Injecté seulement sur les deux origines du site, cadre principal, au tout
// début du chargement (et réinjecté par l'arrière-plan dans les onglets déjà
// ouverts après une installation ou une mise à jour). Il ne fait QUE relayer :
// il filtre les messages de la page, vérifie la forme et la taille des
// arguments, exige un vrai clic pour les dépenses, transmet à l'arrière-plan
// et renvoie sa réponse, et redonne l'annonce quand l'extension la renvoie. Il
// ne touche pas au DOM, ne lit aucun stockage et ne voit jamais la session Twitch.
// ---------------------------------------------------------------------------

(() => {
  const api = globalThis.browser || globalThis.chrome;
  if (!api || !api.runtime || typeof api.runtime.sendMessage !== "function") return;

  // Script encore relié à l'extension ? Après une mise à jour ou un
  // rechargement sous Chrome, l'ancien reste dans la page, orphelin :
  // runtime.id devient indéfini.
  const alive = () => {
    try {
      return !!api.runtime.id;
    } catch (e) {
      return false;
    }
  };
  // L'arrière-plan réinjecte ce script dans les onglets déjà ouverts
  // (runtime.onInstalled) : rien si un script valide tourne déjà ici, sinon
  // chaque demande partirait deux fois. (Monde isolé : la page n'y voit rien.)
  const running = globalThis.__tuConnectAlive;
  if (typeof running === "function" && running() === true) return;
  globalThis.__tuConnectAlive = alive;

  const ORIGIN = location.origin;
  const PROTOCOL = 1;
  const MAX_IN_FLIGHT = 16;

  const ERROR_CODES = [
    "disabled", "no_session", "needs_activation", "spend_disabled", "bad_args", "unknown_op",
    "rate_limited", "integrity", "twitch", "offline", "no_claim", "timeout", "internal"
  ];

  // --- Validation des demandes (même code que background.js) ----------------

  const CHANNEL_RE = /^[a-z0-9_]{1,25}$/;
  const TWITCH_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
  const RAID_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
  const DROP_INSTANCE_RE = /^[A-Za-z0-9#._:-]{1,200}$/;
  const HQ_ID_RE = /^[A-Za-z0-9]{22}$/;
  const HQ_CODECS = ["av1", "h265", "h264"];

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
    "rewards.redeem": { channel: "channel", rewardId: "id", cost: "cost", title: "title", prompt: "prompt", input: "input" },
    "hq.master": { channel: "channel", codecs: "codecs" },
    "hq.playlist": { id: "hqId" },
    "follow.get": { channel: "channel" },
    "follow.set": { channel: "channel", follow: "bool" }
  };
  const SPEND_OPS = ["predictions.bet", "polls.vote", "rewards.redeem"];
  // Action du compte sans dépense : un vrai clic aussi.
  const CLICK_OPS = ["follow.set"];

  // Vrai clic de l'utilisateur sur la page (isTrusted, en capture ; Entrée ou
  // Espace sur un bouton en donnent un aussi) : un seul par dépense ou action
  // du compte. navigator.userActivation reste vrai quelques secondes après
  // n'importe quel clic : assez, avant, pour plusieurs dépenses à la file.
  const CLICK_MS = 5000;
  let clickAt = 0;
  let clickUsed = true;
  window.addEventListener("click", (e) => {
    if (e && e.isTrusted === true) {
      clickAt = Date.now();
      clickUsed = false;
    }
  }, true);

  // Longueur en caractères (points de code), pas en unités UTF-16.
  function charCount(s) {
    let n = 0;
    for (const _ of s) n++;
    return n;
  }

  // Codecs annoncés : 1 à 3 de la liste fermée, sans doublon, H.264 compris.
  function codecsOk(v) {
    return Array.isArray(v) && v.length >= 1 && v.length <= HQ_CODECS.length &&
      v.every((c) => typeof c === "string" && HQ_CODECS.includes(c)) &&
      new Set(v).size === v.length && v.includes("h264");
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
        kind === "codecs" ? codecsOk(v) :
        kind === "hqId" ? typeof v === "string" && HQ_ID_RE.test(v) :
        false;
      if (!good) return { bad: k };
      // Liste recopiée dans l'ordre de HQ_CODECS (pas la référence reçue).
      args[k] = kind === "codecs" ? HQ_CODECS.filter((c) => v.includes(c)) : v;
    }
    return { args };
  }

  // --- Envoi vers la page -----------------------------------------------------

  function post(msg) {
    try {
      window.postMessage(msg, ORIGIN);
    } catch (e) {
      // page en cours de fermeture
    }
  }

  function reply(id, res) {
    if (res && res.ok === true && res.data && typeof res.data === "object") {
      post({ tuConnect: 1, dir: "res", id, ok: true, data: res.data });
      return;
    }
    const err = res && res.ok === false && res.error ? res.error : null;
    const code = err && ERROR_CODES.includes(err.code) ? err.code : "internal";
    const error = { code };
    if (err && typeof err.message === "string" && err.message) error.message = err.message.slice(0, 80);
    post({ tuConnect: 1, dir: "res", id, ok: false, error });
  }

  function failure(code, message) {
    const error = { code };
    if (message) error.message = message;
    return { ok: false, error };
  }

  function toBackground(msg) {
    try {
      return Promise.resolve(api.runtime.sendMessage(msg));
    } catch (e) {
      // extension rechargée ou retirée
      return Promise.reject(e);
    }
  }

  // --- Demandes de la page ----------------------------------------------------

  let inFlight = 0;

  function onPageMessage(event) {
    if (!alive()) {
      // Orphelin : il se tait (il ne répondrait plus que `internal`) et laisse
      // répondre le script réinjecté.
      window.removeEventListener("message", onPageMessage);
      return;
    }
    if (event.source !== window || event.origin !== ORIGIN) return;
    const m = event.data;
    if (!m || typeof m !== "object" || m.tuConnect !== 1 || m.dir !== "req") return;
    const id = m.id;
    if (typeof id !== "string" || id.length < 1 || id.length > 64) return;

    const op = m.op;
    if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(OP_ARGS, op)) {
      reply(id, failure("unknown_op"));
      return;
    }
    const checked = checkArgs(op, m.args);
    if (!checked.args) {
      reply(id, failure("bad_args", checked.bad));
      return;
    }
    // Dépense, action du compte : seulement juste après un vrai clic de
    // l'utilisateur sur la page, et un seul clic par demande.
    const needsClick = SPEND_OPS.includes(op) || CLICK_OPS.includes(op);
    const ua = navigator.userActivation;
    const activation = needsClick && !!ua && ua.isActive === true &&
      !clickUsed && Date.now() - clickAt < CLICK_MS;
    if (needsClick && !activation) {
      reply(id, failure("needs_activation"));
      return;
    }
    if (needsClick) clickUsed = true;
    if (inFlight >= MAX_IN_FLIGHT) {
      reply(id, failure("rate_limited"));
      return;
    }

    inFlight++;
    toBackground({ tuConnect: 1, kind: "op", id, op, args: checked.args, activation })
      .then((res) => reply(id, res), () => reply(id, failure("internal")))
      .finally(() => { inFlight--; });
  }

  window.addEventListener("message", onPageMessage);

  // --- Annonce ------------------------------------------------------------------

  function announce(enabled, version) {
    post({
      tuConnect: 1,
      dir: "hello",
      protocol: PROTOCOL,
      version: String(version || api.runtime.getManifest().version),
      enabled: enabled === true
    });
  }

  // Au chargement.
  toBackground({ tuConnect: 1, kind: "op", id: "announce", op: "hello", args: {}, activation: false })
    .then((res) => {
      if (!res || res.ok !== true || !res.data) return;
      announce(res.data.enabled, res.data.version);
    }, () => {});

  // Réglage changé dans la fenêtre de l'extension : l'arrière-plan redonne
  // l'annonce (tabs.sendMessage), et le site suit tout de suite.
  if (api.runtime.onMessage && typeof api.runtime.onMessage.addListener === "function") {
    api.runtime.onMessage.addListener((msg, sender) => {
      if (!sender || sender.id !== api.runtime.id || sender.tab) return;
      if (!msg || msg.tuConnect !== 1 || msg.kind !== "announce" || typeof msg.enabled !== "boolean") return;
      announce(msg.enabled);
    });
  }
})();
