// Version Firefox de l'extension : même code, manifeste adapté.
//
// Chrome, Edge et Brave refusent `background.scripts` en MV3 (« requires
// manifest version of 2 or lower ») et ne connaissent pas
// `browser_specific_settings` ; Firefox n'a pas de service worker
// d'arrière-plan et demande un identifiant. Le dossier `extension/` reste donc
// la version Chrome, chargeable telle quelle, et ce script écrit la version
// Firefox à côté, dans `extension-firefox/` (à la racine du dépôt, recréé à
// chaque fois, ignoré par git) :
//
//   node extension/dev/build-firefox.mjs
//
// puis about:debugging → « Charger un module complémentaire temporaire… » →
// extension-firefox/manifest.json.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(SRC, "..", "extension-firefox");

/** Manifeste Chrome → manifeste Firefox. */
export function firefoxManifest(m) {
  const { service_worker: worker, ...background } = m.background || {};
  return {
    ...m,
    background: { ...background, scripts: [worker || "background.js"] },
    browser_specific_settings: {
      gecko: {
        id: "connect@twitchunblock.app",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] }
      }
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  // Ni le banc d'essai ni les outils de dev dans le paquet.
  cpSync(SRC, OUT, {
    recursive: true,
    filter: (p) => !/^[\\/](tests|dev)([\\/]|$)/.test(p.slice(SRC.length))
  });
  const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(firefoxManifest(manifest), null, 2) + "\n");
  console.log("Version Firefox écrite dans " + OUT);
}
