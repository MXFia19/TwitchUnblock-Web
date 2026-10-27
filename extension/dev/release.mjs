// Manifeste publié (paquets des releases, AMO) : celui du dépôt sans l'aperçu
// Vercel de la branche de test. Le dossier extension/ le garde, pour essayer
// l'extension chargée à la main sur l'aperçu ; les paquets publiés ne
// connaissent que le site (le content script, les accès d'hôte, et donc les
// origines que l'arrière-plan et la fenêtre en lisent).
//
//   node extension/dev/release.mjs <dossier du paquet>
//
// réécrit le manifest.json de ce dossier (workflow « Extension », paquet
// Chrome ; build-firefox.mjs l'applique au paquet Firefox).
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PREVIEW_ORIGIN = "https://test2-git-test-17d298-mxfia19s-projects.vercel.app";

/** Manifeste du dépôt → manifeste publié : rien de l'aperçu. */
export function publishedManifest(m) {
  const keep = (p) => typeof p === "string" && p !== PREVIEW_ORIGIN + "/*" && !p.startsWith(PREVIEW_ORIGIN + "/");
  return {
    ...m,
    content_scripts: (m.content_scripts || []).map((c) => ({ ...c, matches: (c.matches || []).filter(keep) })),
    host_permissions: (m.host_permissions || []).filter(keep)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage : node extension/dev/release.mjs <dossier du paquet>");
    process.exit(2);
  }
  const path = join(resolve(dir), "manifest.json");
  const manifest = publishedManifest(JSON.parse(readFileSync(path, "utf8")));
  if (JSON.stringify(manifest).includes(new URL(PREVIEW_ORIGIN).host)) {
    console.error("::error::l'aperçu Vercel est encore dans le manifeste publié");
    process.exit(1);
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Manifeste publié écrit dans " + path);
}
