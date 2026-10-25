// Le site connaît la dernière version de l'extension : CONNECT_LATEST, dans
// public/assets/js/connect.js. Une extension plus ancienne y affiche le
// bandeau « TwitchUnblock Connect x.y.z est disponible », qui renvoie vers la
// dernière release (faite depuis extension/manifest.json). Les deux doivent
// donc valoir la même chose : site en avance, le bandeau annonce une version
// qui n'est pas encore publiée ; site en retard, il ne prévient de rien.
//
//   node extension/dev/check-site-version.mjs
//
// Échoue (code 1) s'ils diffèrent. Lancé par les workflows « Extension » et
// « Docker image » (.github/workflows/extension.yml et docker.yml).
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const CONNECT_JS = "public/assets/js/connect.js";
const MANIFEST = "extension/manifest.json";

/** Valeur de CONNECT_LATEST dans le texte de connect.js, ou null. */
function siteLatest(source) {
  const m = /^export const CONNECT_LATEST = (['"])([^'"]*)\1/m.exec(source);
  return m ? m[2] : null;
}

const fail = (file, message) => {
  // Annotation GitHub Actions (::error), lisible aussi en local.
  console.error(`::error file=${file}::${message}`);
  process.exit(1);
};

const manifest = JSON.parse(readFileSync(new URL(MANIFEST, ROOT), "utf8"));
const latest = siteLatest(readFileSync(new URL(CONNECT_JS, ROOT), "utf8"));
if (!latest) fail(CONNECT_JS, "CONNECT_LATEST introuvable (export const CONNECT_LATEST = '…').");
if (latest !== manifest.version) {
  fail(CONNECT_JS, `CONNECT_LATEST vaut ${latest}, mais ${MANIFEST} est en ${manifest.version} : `
    + "les deux doivent sortir ensemble (bandeau de mise à jour du site).");
}
console.log(`CONNECT_LATEST = version du manifeste = ${latest}`);
