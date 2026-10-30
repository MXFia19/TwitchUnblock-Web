// Publication de la version du manifeste sur addons.mozilla.org (AMO), par
// l'API v5 de Mozilla (workflow « Extension », job « Publish on AMO », sur
// main) :
//
//   node extension/dev/amo-publish.mjs <paquet Firefox .zip> <code source .zip>
//   node extension/dev/amo-publish.mjs --check
//
// Clés : AMO_JWT_ISSUER et AMO_JWT_SECRET (secrets GitHub ; Developer Hub →
// Manage API Keys). Rien n'est envoyé si la version est déjà sur AMO, en
// relecture comprise : un numéro envoyé ne se réutilise jamais.
// Étapes : envoi du paquet (canal « listed ») → validation de Mozilla →
// version créée avec son code source → notes de version et notes aux
// relecteurs (dev/AMO.md ; l'API refuse ces deux champs dans la requête
// multipart du code source). Mozilla relit ensuite la version, et Firefox
// l'installe de lui-même chez ceux qui ont l'extension d'AMO.
// --check : les notes de la version du manifeste sont-elles dans AMO.md ?
import { createHmac, randomUUID } from "node:crypto";
import { appendFileSync, openAsBlob, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { firefoxManifest } from "./build-firefox.mjs";

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = (process.env.AMO_API || "https://addons.mozilla.org/api/v5").replace(/\/+$/, "");
// Validation d'un envoi : quelques secondes à quelques minutes chez Mozilla.
const POLL_MS = Number(process.env.AMO_POLL_MS) || 5000;
const POLL_MAX_MS = 15 * 60 * 1000;

/** Lignes de la citation Markdown (« > ») qui suit la ligne `heading` ; null
 *  sans ligne ou sans citation. */
function quoteAfter(md, heading) {
  const lines = md.split(/\r?\n/);
  let i = lines.findIndex((l) => l.trim() === heading);
  if (i < 0) return null;
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const out = [];
  for (; i < lines.length && lines[i].startsWith(">"); i++) out.push(lines[i].replace(/^> ?/, ""));
  return out.length ? out : null;
}

/** Notes de version (AMO.md, « ## Release notes » → « ### <version> ») :
 *  les lignes d'un paragraphe réunies, les paragraphes séparés d'une ligne
 *  vide ; null si la version n'en a pas. */
export function releaseNotes(md, version) {
  const quote = quoteAfter(md, `### ${version}`);
  if (!quote) return null;
  return quote.join("\n").split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trim()).join(" ")).join("\n\n").trim() || null;
}

/** Notes aux relecteurs (AMO.md, « ## Notes for Reviewers »), lignes gardées
 *  telles quelles (listes comprises) ; null si absentes. */
export function reviewerNotes(md) {
  const quote = quoteAfter(md, "## Notes for Reviewers");
  return quote ? quote.join("\n").trim() || null : null;
}

/** Jeton d'une requête : JWT HS256 signé avec le secret, valable 60 s
 *  (AMO : 5 min au plus), identifiant unique par requête. */
export function amoJwt(issuer, secret, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = part({ alg: "HS256", typ: "JWT" });
  const body = part({ iss: issuer, jti: randomUUID(), iat, exp: iat + 60 });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

/** Ce qui cloche dans les clés quand AMO les refuse, sans jamais les
 *  afficher : AMO_JWT_ISSUER est le « JWT issuer » de la page Manage API Keys
 *  (user:123456:78), AMO_JWT_SECRET le « JWT secret » (64 caractères
 *  hexadécimaux). */
export function keyHint(issuer, secret) {
  const isIssuer = (v) => /^user:\d+:\d+$/.test(v);
  const isSecret = (v) => /^[0-9a-f]{64}$/i.test(v);
  if (isSecret(issuer) && isIssuer(secret)) return "AMO_JWT_ISSUER et AMO_JWT_SECRET sont inversés";
  if (!isIssuer(issuer)) return "AMO_JWT_ISSUER n'a pas la forme du « JWT issuer » d'AMO (user:123456:78)";
  if (!isSecret(secret)) return "AMO_JWT_SECRET n'a pas la forme du « JWT secret » d'AMO (64 caractères hexadécimaux)";
  return "clés bien formées : régénérées depuis (l'ancienne paire est alors révoquée), ou d'un autre compte que celui de l'extension ?";
}

/** Arrêt avec une erreur lisible dans le journal du workflow. Une exception,
 *  pas process.exit : sous Windows, quitter pendant que fetch ferme ses
 *  connexions fait planter Node (0xC0000409). */
class AmoError extends Error {}
function fail(message) {
  throw new AmoError(message);
}

/** Ligne du journal, reprise dans le résumé du job (onglet Summary). */
function summary(line) {
  console.log(line);
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); } catch {}
}

async function publish(pkg, source, version, notes, approval) {
  // Espaces et retours à la ligne collés avec la valeur du secret : retirés
  // (AMO ne reconnaissait plus la clé : « Unknown JWT iss »).
  const issuer = (process.env.AMO_JWT_ISSUER || "").trim();
  const secret = (process.env.AMO_JWT_SECRET || "").trim();
  if (!issuer || !secret) fail("AMO_JWT_ISSUER et AMO_JWT_SECRET manquent (secrets du dépôt)");
  const id = encodeURIComponent(firefoxManifest(JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"))).browser_specific_settings.gecko.id);

  async function call(method, path, { json, form } = {}) {
    const headers = { Authorization: `JWT ${amoJwt(issuer, secret)}` };
    let body;
    if (json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) body = form;
    const r = await fetch(API + path, { method, headers, body, signal: AbortSignal.timeout(120_000) });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return { status: r.status, ok: r.ok, data, text: text.slice(0, 500) };
  }

  // 1. Déjà sur AMO (publique, en relecture ou refusée) : rien à faire.
  const list = await call("GET", `/addons/addon/${id}/versions/?filter=all_without_unlisted&page_size=50`);
  if (list.status === 401 || list.status === 403) {
    fail(`clés refusées (HTTP ${list.status}, ${list.data?.detail || "sans détail"}) : ${keyHint(issuer, secret)}. `
      + "À reprendre sur https://addons.mozilla.org/developers/addon/api/key/");
  }
  if (!list.ok || !Array.isArray(list.data?.results)) fail(`liste des versions illisible (HTTP ${list.status}) ${list.text}`);
  if (list.data.results.some((v) => v.version === version)) {
    summary(`TwitchUnblock Connect ${version} est déjà sur AMO : rien d'envoyé.`);
    return;
  }

  // 2. Envoi du paquet, puis validation par Mozilla.
  const up = new FormData();
  up.append("upload", await openAsBlob(pkg), basename(pkg));
  up.append("channel", "listed");
  const sent = await call("POST", "/addons/upload/", { form: up });
  if (!sent.ok || !sent.data?.uuid) fail(`envoi du paquet refusé (HTTP ${sent.status}) ${sent.text}`);
  let upload = sent.data;
  const until = Date.now() + POLL_MAX_MS;
  while (!upload.processed) {
    if (Date.now() > until) fail("validation du paquet toujours en cours après 15 min");
    await new Promise((ok) => setTimeout(ok, POLL_MS));
    const r = await call("GET", `/addons/upload/${encodeURIComponent(upload.uuid)}/`);
    if (!r.ok || !r.data) fail(`suivi de la validation (HTTP ${r.status}) ${r.text}`);
    upload = r.data;
  }
  const messages = Array.isArray(upload.validation?.messages) ? upload.validation.messages : [];
  for (const m of messages.filter((x) => x.type === "warning")) console.log(`::warning::AMO : ${m.message}${m.file ? ` (${m.file})` : ""}`);
  if (!upload.valid) {
    const errors = messages.filter((x) => x.type === "error").map((x) => `${x.message}${x.file ? ` (${x.file})` : ""}`);
    fail(`paquet refusé par la validation : ${errors.join(" ; ") || "sans détail"}`);
  }
  if (upload.version && upload.version !== version) fail(`le paquet annonce ${upload.version}, le manifeste ${version}`);

  // 3. Version créée avec son code source (multipart obligatoire).
  const create = new FormData();
  create.append("upload", upload.uuid);
  create.append("source", await openAsBlob(source), basename(source));
  const made = await call("POST", `/addons/addon/${id}/versions/`, { form: create });
  // 409 : déjà soumise entre la liste et maintenant (autre passage du workflow).
  if (made.status === 409) {
    summary(`TwitchUnblock Connect ${version} est déjà sur AMO (409) : rien d'autre d'envoyé.`);
    return;
  }
  if (!made.ok || !made.data?.id) fail(`création de la version refusée (HTTP ${made.status}) ${made.text}`);

  // 4. Notes de version et notes aux relecteurs (JSON, requête à part).
  const notesSet = await call("PATCH", `/addons/addon/${id}/versions/${made.data.id}/`, {
    json: { release_notes: { "en-US": notes }, approval_notes: approval }
  });
  if (!notesSet.ok) {
    fail(`version ${version} créée (id ${made.data.id}), mais notes refusées (HTTP ${notesSet.status}) ${notesSet.text} : `
      + "les ajouter dans le Developer Hub (Manage Status & Versions)");
  }
  const status = made.data.file?.status || notesSet.data?.file?.status || "?";
  summary(`TwitchUnblock Connect ${version} envoyée à AMO (version ${made.data.id}, état ${status}) : Mozilla la relit, puis Firefox la propose de lui-même.`);
}

async function main(args) {
  const version = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")).version;
  const md = readFileSync(join(EXT, "dev", "AMO.md"), "utf8");
  const notes = releaseNotes(md, version);
  const approval = reviewerNotes(md);
  if (!notes) fail(`pas de notes de version pour ${version} dans extension/dev/AMO.md (« ## Release notes » → « ### ${version} »)`);
  if (!approval) fail("pas de notes aux relecteurs dans extension/dev/AMO.md (« ## Notes for Reviewers »)");
  if (args[0] === "--check") {
    console.log(`Notes de version ${version} pour AMO :\n${notes}`);
    return;
  }
  const [pkg, source] = args;
  if (!pkg || !source) fail("usage : node extension/dev/amo-publish.mjs <paquet Firefox .zip> <code source .zip>");
  await publish(resolve(pkg), resolve(source), version, notes, approval);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof AmoError)) throw e;
    console.error(`::error::AMO : ${e.message}`);
    process.exitCode = 1;
  }
}
