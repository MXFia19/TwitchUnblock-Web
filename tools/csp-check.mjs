// Politique de sécurité du contenu (CSP) du site : balise <meta> de
// public/index.html (elle vaut sur Vercel comme dans l'image Docker). Seuls
// passent les scripts du site, hls.js depuis ses deux CDN (avec son empreinte
// SRI, player.js), et, par leur empreinte (sha256), les scripts en ligne de la
// page et les gestionnaires d'événement en attribut que fabriquent les
// scripts (onerror="this.remove()"…). Changer l'un d'eux sans mettre la
// balise à jour le bloquerait : ce contrôle le voit.
//
//   node tools/csp-check.mjs          vérifie (code 1 si la balise n'est plus juste)
//   node tools/csp-check.mjs --fix    réécrit la politique dans la balise
//
// Lancé par le workflow « Docker image » (.github/workflows/docker.yml).
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const INDEX = 'public/index.html'
const PLAYER = 'public/assets/js/player.js'
const JS_DIRS = ['public/assets/js/', 'public/assets/js/chat/']
const META_RE = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/

const read = (path) => readFileSync(new URL(path, ROOT), 'utf8')
/** Empreinte CSP d'un texte, tel que le navigateur le lit (fins de ligne en LF). */
const hash = (text) => `'sha256-${createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`

/** Scripts en ligne de la page (sans src). */
function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
}

/** Gestionnaires d'événement en attribut, dans la page et dans le HTML que
 *  fabriquent les scripts : ` onerror="…"`, valeurs distinctes. */
function inlineHandlers(html) {
  const found = new Set()
  const scan = (text) => { for (const m of text.matchAll(/ on[a-z]+="([^"]*)"/g)) found.add(m[1]) }
  scan(html)
  for (const dir of JS_DIRS) {
    for (const f of readdirSync(new URL(dir, ROOT))) if (f.endsWith('.js')) scan(read(dir + f))
  }
  return [...found].sort()
}

/** Adresses de hls.js (HLS_SOURCES de player.js). */
function hlsSources() {
  const block = /const HLS_SOURCES = \[([\s\S]*?)\]/.exec(read(PLAYER))
  const list = block ? [...block[1].matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]) : []
  if (!list.length) throw new Error(`${PLAYER} : HLS_SOURCES introuvable`)
  return list
}

export function expectedPolicy(html) {
  const scripts = inlineScripts(html).map(hash)
  const handlers = inlineHandlers(html).map(hash)
  return [
    ["script-src 'self'", ...scripts, ...(handlers.length ? ["'unsafe-hashes'", ...handlers] : []), ...hlsSources()].join(' '),
    // hls.js lit les segments dans un worker fait d'un Blob.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}

const html = read(INDEX)
const meta = META_RE.exec(html)
const fail = (message) => {
  console.error(`::error file=${INDEX}::${message}`)
  process.exit(1)
}
if (!meta) fail('balise <meta http-equiv="Content-Security-Policy"> introuvable')
// Avant tout script : celle d'après ne protégerait pas ceux d'avant.
if (html.indexOf('<script') < meta.index) fail('la balise CSP doit précéder le premier <script>')
const want = expectedPolicy(html)
if (meta[1] === want) {
  console.log(`CSP à jour : ${inlineScripts(html).length} scripts en ligne, ${inlineHandlers(html).length} gestionnaires en attribut`)
} else if (process.argv.includes('--fix')) {
  writeFileSync(new URL(INDEX, ROOT), html.replace(META_RE, `<meta http-equiv="Content-Security-Policy" content="${want}">`))
  console.log('CSP réécrite dans', INDEX)
} else {
  fail('la CSP ne correspond plus aux scripts en ligne ou aux gestionnaires (node tools/csp-check.mjs --fix)')
}
