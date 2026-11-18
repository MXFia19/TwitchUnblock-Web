// ═══════════════════════════════════════════════════════════════════════════
//  Fabrique l'app TV LG (webOS) dans build/webos/ (ignoré par git) :
//    build/webos/app/        l'app : index.html, app.js, app.css, config.js,
//                            vendor/hls.min.js, appinfo.json, icônes
//    build/webos/*.ipk       le paquet (avec --package)
//    build/webos/com.mxfia19.twitchunblock.manifest.json, apps.json
//                            manifeste et dépôt de la Homebrew Channel
//
//  app.js : webos/src/main.js et les modules du site qu'il importe
//  (public/assets/js : api, player, chat, i18n, store, util…), réunis par
//  esbuild en un seul script classique — une app installée tourne depuis
//  file://, où webOS refuse les modules ES — et réécrits pour Chromium 79
//  (webOS 6). hls.js est la version du site (player.js : adresse et
//  empreinte SRI), téléchargée une fois puis gardée dans build/cache/.
//
//  node tools/build-webos.mjs [--package] [options]
//    --package              crée aussi l'IPK (ares-package) et les manifestes
//    --esbuild <dossier>    paquet esbuild (sinon $ESBUILD_DIR, puis celui
//                           de npm install -g esbuild@0.28.2)
//    --ares <fichier>       ares-package.js de @webos-tools/cli (sinon
//                           $ARES_PACKAGE, puis npm install -g @webos-tools/cli@3.2.6)
//    --release-base <url>   adresse des fichiers de la release
//                           (…/releases/download/webos-v<version>)
//    --no-minify            app.js lisible (débogage avec ares-inspect)
//  Node 22 ou plus.
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WEBOS = join(ROOT, 'webos')
const SRC = join(WEBOS, 'src')
const OUT = join(ROOT, 'build', 'webos')
const APP = join(OUT, 'app')
const CACHE = join(ROOT, 'build', 'cache')
const REPO = process.env.GITHUB_REPOSITORY || 'MXFia19/TwitchUnblock-Web'
const MANIFEST = 'com.mxfia19.twitchunblock.manifest.json'
/** Nom fixe du paquet dans la release (liens du README). */
const RELEASE_IPK = 'twitchunblock-webos.ipk'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

function fail(msg) {
  console.error(`✗ ${msg}`)
  if (process.env.GITHUB_ACTIONS) console.log(`::error::${msg}`)
  process.exit(1)
}
const step = (msg) => console.log(`• ${msg}`)

// ── appinfo.json et icônes ─────────────────────────────────────────────────
// Champs obligatoires, version x.y.z (sans zéro devant), page de départ,
// icônes PNG de 80 × 80 et 130 × 130.
function readAppInfo() {
  const info = JSON.parse(readFileSync(join(WEBOS, 'appinfo.json'), 'utf8'))
  for (const k of ['id', 'version', 'type', 'main', 'title', 'icon', 'largeIcon']) if (!info[k]) fail(`appinfo.json : champ ${k} manquant`)
  if (info.type !== 'web') fail('appinfo.json : type doit valoir web')
  if (!/^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){2}$/.test(info.version)) fail(`appinfo.json : version ${info.version}, trois nombres sans zéro devant`)
  if (info.main !== 'index.html') fail('appinfo.json : main doit valoir index.html (page de webos/src)')
  for (const [k, size] of [['icon', 80], ['largeIcon', 130]]) {
    const png = readFileSync(join(WEBOS, info[k]))
    const w = png.readUInt32BE(16)
    const h = png.readUInt32BE(20)
    if (png.toString('latin1', 1, 4) !== 'PNG' || w !== size || h !== size) fail(`${info[k]} : PNG de ${size} × ${size} attendu (${w} × ${h})`)
  }
  return info
}

// ── hls.js : la version et l'empreinte du site ─────────────────────────────
async function vendorHls() {
  const player = readFileSync(join(ROOT, 'public/assets/js/player.js'), 'utf8')
  const integrity = /HLS_INTEGRITY = '(sha384-[A-Za-z0-9+/=]+)'/.exec(player)?.[1]
  const url = /'(https:\/\/cdn\.jsdelivr\.net\/npm\/hls\.js@([\d.]+)\/dist\/hls\.min\.js)'/.exec(player)
  if (!integrity || !url) fail('player.js : adresse ou empreinte de hls.js introuvable')
  const [, src, version] = url
  const sri = (buf) => `sha384-${createHash('sha384').update(buf).digest('base64')}`
  mkdirSync(CACHE, { recursive: true })
  const cached = join(CACHE, `hls.js@${version}.min.js`)
  let code = existsSync(cached) ? readFileSync(cached) : null
  if (!code || sri(code) !== integrity) {
    step(`hls.js ${version} : téléchargement (${src})`)
    const res = await fetch(src)
    if (!res.ok) fail(`hls.js : HTTP ${res.status}`)
    code = Buffer.from(await res.arrayBuffer())
    if (sri(code) !== integrity) fail(`hls.js : empreinte inattendue (${sri(code)}, ${integrity} attendue)`)
    writeFileSync(cached, code)
  }
  mkdirSync(join(APP, 'vendor'), { recursive: true })
  writeFileSync(join(APP, 'vendor/hls.min.js'), code)
  // Licence Apache 2.0 de hls.js, jointe au paquet.
  const license = join(CACHE, `hls.js@${version}.LICENSE`)
  if (!existsSync(license)) {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/hls.js@${version}/LICENSE`).catch(() => null)
    if (res?.ok) writeFileSync(license, Buffer.from(await res.arrayBuffer()))
  }
  writeFileSync(join(APP, 'vendor/hls.js-LICENSE.txt'), existsSync(license) ? readFileSync(license)
    : `hls.js ${version} — Apache License 2.0 — https://github.com/video-dev/hls.js/blob/v${version}/LICENSE\n`)
  return version
}

// ── esbuild ────────────────────────────────────────────────────────────────
let globalRoot
/** Dossier des paquets installés avec npm install --global. */
function npmRoot() {
  if (globalRoot === undefined) {
    const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' })
    globalRoot = r.status === 0 ? r.stdout.trim() : null
  }
  return globalRoot
}

async function loadEsbuild() {
  const explicit = [option('--esbuild'), process.env.ESBUILD_DIR].filter(Boolean).map((d) => resolve(d))
  for (const dir of [...explicit, () => npmRoot() && join(npmRoot(), 'esbuild')]) {
    const d = typeof dir === 'function' ? dir() : dir
    if (!d) continue
    const pkg = existsSync(join(d, 'package.json')) ? d : join(d, 'node_modules', 'esbuild')
    if (!existsSync(join(pkg, 'package.json'))) continue
    return import(pathToFileURL(createRequire(join(pkg, 'package.json')).resolve('esbuild')).href)
  }
  fail('esbuild introuvable : npm install --global esbuild@0.28.2, ou --esbuild <dossier>')
}

function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

async function bundle(info) {
  const esbuild = await loadEsbuild()
  const minify = !flag('--no-minify')
  const common = { bundle: true, target: 'chrome79', charset: 'utf8', legalComments: 'none', logLevel: 'silent', minify }
  const js = await esbuild.build({
    ...common,
    entryPoints: [join(SRC, 'main.js')],
    outfile: join(APP, 'app.js'),
    format: 'iife',
    define: { TU_TV_VERSION: JSON.stringify(info.version), TU_TV_BUILD: JSON.stringify(gitSha()) },
  }).catch((e) => fail(`esbuild (app.js) : ${e.message}`))
  const css = await esbuild.build({ ...common, entryPoints: [join(SRC, 'app.css')], outfile: join(APP, 'app.css') })
    .catch((e) => fail(`esbuild (app.css) : ${e.message}`))
  const warnings = [...js.warnings, ...css.warnings]
  if (warnings.length) {
    for (const w of warnings) console.error(`  ${w.location?.file ?? ''}:${w.location?.line ?? ''} ${w.text}`)
    fail(`esbuild : ${warnings.length} avertissement(s)`)
  }
  // Un script classique, lisible tel quel par un moteur de TV.
  const code = readFileSync(join(APP, 'app.js'), 'utf8')
  try { new vm.Script(code, { filename: 'app.js' }) } catch (e) { fail(`app.js illisible : ${e.message}`) }
  if (/\bimport\s*\(|\bimport\.meta\b|^\s*(import|export)\s/m.test(code)) fail('app.js contient encore un import ou un export')
  return { js: statSync(join(APP, 'app.js')).size, css: statSync(join(APP, 'app.css')).size }
}

// ── ares-package ───────────────────────────────────────────────────────────
function aresCommand() {
  const explicit = [option('--ares'), process.env.ARES_PACKAGE].filter(Boolean).map((p) => resolve(p))
  for (const item of [...explicit, () => npmRoot() && join(npmRoot(), '@webos-tools', 'cli', 'bin', 'ares-package.js')]) {
    const p = typeof item === 'function' ? item() : item
    if (!p) continue
    const file = existsSync(p) && statSync(p).isDirectory() ? join(p, 'bin', 'ares-package.js') : p
    if (existsSync(file)) return file
  }
  fail('ares-package introuvable : npm install --global @webos-tools/cli@3.2.6, ou --ares <ares-package.js>')
}

function ares(file, params) {
  const r = spawnSync(process.execPath, [file, ...params], { stdio: 'inherit' })
  if (r.status !== 0) fail(`ares-package ${params.join(' ')} : échec (${r.status})`)
}

function packageApp(info) {
  const file = aresCommand()
  ares(file, ['--check', APP])
  for (const f of readdirSync(OUT)) if (f.endsWith('.ipk')) rmSync(join(OUT, f))
  ares(file, [APP, '--outdir', OUT])
  const made = readdirSync(OUT).find((f) => f.endsWith('.ipk'))
  if (!made) fail('ares-package : aucun .ipk produit')
  const ipk = join(OUT, `twitchunblock-webos-${info.version}.ipk`)
  renameSync(join(OUT, made), ipk)
  return ipk
}

/** Manifeste de la Homebrew Channel (même forme que ceux de
 *  repo.webosbrew.org) et dépôt à une seule app : la Homebrew Channel lit
 *  `packages`, prend le manifeste en ligne (`manifest`), télécharge
 *  `ipkUrl` et vérifie `ipkHash.sha256` avant d'installer. */
function homebrew(info, ipk) {
  const data = readFileSync(ipk)
  const base = (option('--release-base') || `https://github.com/${REPO}/releases/download/webos-v${info.version}`).replace(/\/+$/, '')
  const iconUri = `https://raw.githubusercontent.com/${REPO}/main/webos/${info.largeIcon}`
  const description = 'Twitch lives and VODs on LG TVs, with the chat, made for the remote. Unofficial, by one person.'
  const manifest = {
    id: info.id,
    version: info.version,
    type: info.type,
    title: info.title,
    appDescription: info.appDescription || description,
    iconUri,
    sourceUrl: `https://github.com/${REPO}`,
    rootRequired: false,
    ipkUrl: `${base}/${RELEASE_IPK}`,
    ipkHash: { sha256: createHash('sha256').update(data).digest('hex') },
    ipkSize: data.length,
  }
  const repo = {
    paging: { page: 1, count: 1, maxPage: 1, itemsTotal: 1, prevUrl: null, nextUrl: null },
    packages: [{
      id: info.id,
      title: info.title,
      iconUri,
      manifestUrl: `${base}/${MANIFEST}`,
      manifest,
      pool: 'main',
      requirements: { webosRelease: '>=6.0' },
      shortDescription: description,
    }],
  }
  writeFileSync(join(OUT, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(OUT, 'apps.json'), `${JSON.stringify(repo, null, 2)}\n`)
  return manifest
}

// ── Fabrication ────────────────────────────────────────────────────────────
const info = readAppInfo()
step(`${info.id} ${info.version}`)
rmSync(APP, { recursive: true, force: true })
mkdirSync(APP, { recursive: true })
for (const f of ['appinfo.json', info.icon, info.largeIcon]) copyFileSync(join(WEBOS, f), join(APP, f))
for (const f of ['index.html', 'config.js']) copyFileSync(join(SRC, f), join(APP, f))
const hls = await vendorHls()
step(`hls.js ${hls} : vendor/hls.min.js (empreinte vérifiée)`)
const size = await bundle(info)
step(`app.js ${(size.js / 1024).toFixed(0)} Ko, app.css ${(size.css / 1024).toFixed(0)} Ko (esbuild, chrome79)`)
if (flag('--package')) {
  const ipk = packageApp(info)
  const m = homebrew(info, ipk)
  step(`${ipk.slice(ROOT.length + 1)} : ${(m.ipkSize / 1024).toFixed(0)} Ko, sha256 ${m.ipkHash.sha256}`)
  step(`Homebrew Channel : build/webos/${MANIFEST}, build/webos/apps.json`)
} else step(`App prête dans build/webos/app (--package pour l'IPK)`)
