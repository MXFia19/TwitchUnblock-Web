// Essais de dev/amo-publish.mjs (envoi d'une version sur addons.mozilla.org),
// sans dépendance ni réseau : node extension/tests/amo.mjs
//
// Un faux AMO tourne sur 127.0.0.1 (API v5 : liste des versions, envoi du
// paquet et sa validation, version créée avec son code source, notes) et
// vérifie le jeton de chaque requête ; le script est lancé comme dans le
// workflow, AMO_API pointé sur lui.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { amoJwt, releaseNotes, reviewerNotes } from "../dev/amo-publish.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(DIR, "dev", "amo-publish.mjs");
const VERSION = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")).version;
const MD = readFileSync(join(DIR, "dev", "AMO.md"), "utf8");
const GUID = "twitchunblock-connect@mxfia19.github.io";
const ISSUER = "user:1234:56";
const SECRET = "secret-du-banc";
const FILES = mkdtempSync(join(tmpdir(), "amo-banc-"));
const PKG = join(FILES, "amo-firefox.zip");
const SRC = join(FILES, "amo-source.zip");
writeFileSync(PKG, "faux paquet Firefox");
writeFileSync(SRC, "faux code source");

/** Faux AMO : `opts` règle ses réponses, `calls` garde chaque requête reçue. */
async function fakeAmo(opts = {}) {
  const o = { versions: [], polls: 2, valid: true, messages: [], uploadVersion: VERSION, create: 201, patch: 200, ...opts };
  const calls = [];
  const uploads = new Map();
  const jtis = new Set();
  const authError = (h) => {
    const m = /^JWT ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(h || "");
    if (!m) return "en-tête";
    if (createHmac("sha256", SECRET).update(`${m[1]}.${m[2]}`).digest("base64url") !== m[3]) return "signature";
    const head = JSON.parse(Buffer.from(m[1], "base64url"));
    const body = JSON.parse(Buffer.from(m[2], "base64url"));
    if (head.alg !== "HS256" || body.iss !== ISSUER || !body.jti || !(body.exp > body.iat) || body.exp - body.iat > 300) return "champs";
    if (jtis.has(body.jti)) return "jti déjà vu";
    jtis.add(body.jti);
    return null;
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, "http://amo");
    const call = { method: req.method, path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams), auth: authError(req.headers.authorization) };
    calls.push(call);
    const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (call.auth) return send(401, { detail: call.auth });
    const form = () => new Response(raw, { headers: { "content-type": req.headers["content-type"] || "" } }).formData();
    const base = `/api/v5/addons/addon/${GUID}/versions/`;
    if (req.method === "GET" && call.path === base) return send(200, { count: o.versions.length, results: o.versions.map((version, i) => ({ id: i + 1, version })) });
    if (req.method === "POST" && call.path === "/api/v5/addons/upload/") {
      const f = await form();
      const file = f.get("upload");
      call.channel = f.get("channel");
      call.file = file && typeof file === "object" ? { name: file.name, size: file.size } : null;
      const uuid = "u" + (uploads.size + 1);
      uploads.set(uuid, { polls: 0 });
      return send(201, { uuid, processed: false, valid: false });
    }
    const up = /^\/api\/v5\/addons\/upload\/([^/]+)\/$/.exec(call.path);
    if (req.method === "GET" && up && uploads.has(up[1])) {
      const u = uploads.get(up[1]);
      u.polls++;
      const processed = u.polls >= o.polls;
      return send(200, { uuid: up[1], processed, valid: processed && o.valid, version: o.uploadVersion, validation: processed ? { messages: o.messages } : null });
    }
    if (req.method === "POST" && call.path === base) {
      const f = await form();
      const source = f.get("source");
      call.upload = f.get("upload");
      call.source = source && typeof source === "object" ? { name: source.name, size: source.size } : null;
      if (o.create !== 201) return send(o.create, { detail: "refusé" });
      return send(201, { id: 4242, version: VERSION, file: { status: "unreviewed" } });
    }
    if (req.method === "PATCH" && call.path === `${base}4242/`) {
      call.json = JSON.parse(raw.toString("utf8"));
      call.contentType = req.headers["content-type"];
      return send(o.patch, o.patch === 200 ? { id: 4242, version: VERSION } : { detail: "refusé" });
    }
    send(404, { detail: "inconnu" });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { calls, api: `http://127.0.0.1:${server.address().port}/api/v5`, close: () => new Promise((ok) => server.close(ok)) };
}

/** Le script, lancé comme dans le workflow. */
function run(api, args = [PKG, SRC], env = {}) {
  return new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, AMO_API: api, AMO_JWT_ISSUER: ISSUER, AMO_JWT_SECRET: SECRET, AMO_POLL_MS: "5", GITHUB_STEP_SUMMARY: "", ...env }
    }, (err, stdout, stderr) => done({ code: err ? err.code : 0, out: stdout + stderr }));
  });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("notes de la version du manifeste et notes aux relecteurs lues dans AMO.md", () => {
  const notes = releaseNotes(MD, VERSION);
  assert.ok(notes && notes.length > 40, "notes de " + VERSION);
  assert.ok(!/^>/m.test(notes) && !notes.includes("\n> "), "sans les « > » de la citation");
  assert.equal(releaseNotes(MD, "99.0.0"), null, "version sans notes");
  const approval = reviewerNotes(MD);
  assert.ok(approval.includes("How to test") && approval.includes("closed"), "notes aux relecteurs");
  assert.ok(!approval.includes("Never put the developer"), "pas le texte hors citation");
  assert.ok(!/^>/m.test(approval));
});

test("jeton : HS256 signé avec le secret, 60 s, identifiant unique", () => {
  const [h, b, s] = amoJwt(ISSUER, SECRET, 1_700_000_000_000).split(".");
  assert.equal(createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url"), s);
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "HS256", typ: "JWT" });
  const body = JSON.parse(Buffer.from(b, "base64url"));
  assert.equal(body.iss, ISSUER);
  assert.equal(body.iat, 1_700_000_000);
  assert.equal(body.exp - body.iat, 60);
  assert.notEqual(body.jti, JSON.parse(Buffer.from(amoJwt(ISSUER, SECRET).split(".")[1], "base64url")).jti);
});

test("version absente : paquet envoyé et validé, version créée avec son code source, puis les notes", async () => {
  const amo = await fakeAmo({ versions: ["0.1.0", "0.2.0"] });
  try {
    const r = await run(amo.api);
    assert.equal(r.code, 0, r.out);
    assert.ok(amo.calls.every((c) => !c.auth), "jeton accepté partout");
    const list = amo.calls[0];
    assert.equal(list.query.filter, "all_without_unlisted", "versions en relecture comprises");
    const upload = amo.calls.find((c) => c.path === "/api/v5/addons/upload/");
    assert.equal(upload.channel, "listed");
    assert.deepEqual(upload.file, { name: "amo-firefox.zip", size: 19 });
    assert.equal(amo.calls.filter((c) => c.path === "/api/v5/addons/upload/u1/").length, 2, "attend la validation");
    const create = amo.calls.find((c) => c.method === "POST" && c.path.endsWith("/versions/"));
    assert.equal(create.upload, "u1");
    assert.deepEqual(create.source, { name: "amo-source.zip", size: 16 });
    const patch = amo.calls.find((c) => c.method === "PATCH");
    assert.match(patch.contentType, /^application\/json/);
    assert.deepEqual(patch.json, { release_notes: { "en-US": releaseNotes(MD, VERSION) }, approval_notes: reviewerNotes(MD) });
    assert.deepEqual(amo.calls.map((c) => c.method), ["GET", "POST", "GET", "GET", "POST", "PATCH"], "rien d'autre");
    assert.match(r.out, new RegExp(`${VERSION.replace(/\./g, "\\.")} envoyée à AMO`));
  } finally { await amo.close(); }
});

test("déjà sur AMO (en relecture comprise) : rien d'envoyé", async () => {
  const amo = await fakeAmo({ versions: ["0.2.0", VERSION] });
  try {
    const r = await run(amo.api);
    assert.equal(r.code, 0, r.out);
    assert.equal(amo.calls.length, 1, "seulement la liste");
    assert.match(r.out, /déjà sur AMO/);
  } finally { await amo.close(); }
});

test("paquet refusé par la validation : échec avec la raison, pas de version créée", async () => {
  const amo = await fakeAmo({ valid: false, messages: [{ type: "error", message: "Manifeste illisible", file: "manifest.json" }, { type: "warning", message: "Avertissement" }] });
  try {
    const r = await run(amo.api);
    assert.equal(r.code, 1);
    assert.match(r.out, /Manifeste illisible \(manifest\.json\)/);
    assert.match(r.out, /::warning::AMO : Avertissement/);
    assert.ok(!amo.calls.some((c) => c.path.endsWith("/versions/") && c.method === "POST"));
  } finally { await amo.close(); }
});

test("paquet d'une autre version que le manifeste : échec avant la création", async () => {
  const amo = await fakeAmo({ uploadVersion: "0.0.1" });
  try {
    const r = await run(amo.api);
    assert.equal(r.code, 1);
    assert.match(r.out, /le paquet annonce 0\.0\.1/);
    assert.ok(!amo.calls.some((c) => c.path.endsWith("/versions/") && c.method === "POST"));
  } finally { await amo.close(); }
});

test("409 à la création (déjà soumise entre-temps) : pas d'échec, pas de notes", async () => {
  const amo = await fakeAmo({ create: 409 });
  try {
    const r = await run(amo.api);
    assert.equal(r.code, 0, r.out);
    assert.ok(!amo.calls.some((c) => c.method === "PATCH"));
  } finally { await amo.close(); }
});

test("notes refusées : échec qui dit que la version existe déjà", async () => {
  const amo = await fakeAmo({ patch: 400 });
  try {
    const r = await run(amo.api);
    assert.equal(r.code, 1);
    assert.match(r.out, /créée \(id 4242\), mais notes refusées/);
  } finally { await amo.close(); }
});

test("clés absentes : arrêt avant toute requête", async () => {
  const amo = await fakeAmo();
  try {
    const r = await run(amo.api, [PKG, SRC], { AMO_JWT_SECRET: "" });
    assert.equal(r.code, 1);
    assert.match(r.out, /AMO_JWT_ISSUER et AMO_JWT_SECRET manquent/);
    assert.equal(amo.calls.length, 0);
  } finally { await amo.close(); }
});

test("--check : notes de la version présentes, aucune requête", async () => {
  const amo = await fakeAmo();
  try {
    const r = await run(amo.api, ["--check"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`Notes de version ${VERSION.replace(/\./g, "\\.")}`));
    assert.equal(amo.calls.length, 0);
  } finally { await amo.close(); }
});

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
