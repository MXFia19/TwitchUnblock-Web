#!/bin/sh
# Démarrage du conteneur : configuration du site, puis Worker + site.
set -e

# public/config.js : le site parle à ce serveur (« same-origin ») et, si on
# l'a fournie, à sa propre application Twitch pour la connexion. Valeurs
# encodées en JSON par Node : pas d'injection possible dans le script.
node -e '
  const cfg = { apiUrl: "same-origin" };
  if (process.env.TWITCH_CLIENT_ID) cfg.twitchClientId = process.env.TWITCH_CLIENT_ID;
  if (process.env.PUBLIC_URL) cfg.redirectUri = process.env.PUBLIC_URL.replace(/\/?$/, "/");
  require("fs").writeFileSync("/app/public/config.js",
    "// Écrit par docker/entrypoint.sh au démarrage du conteneur.\nwindow.TU_CONFIG = " + JSON.stringify(cfg) + "\n");
'

set -- --config /app/wrangler.docker.toml --ip 0.0.0.0 --port "${PORT:-8787}" \
  --persist-to /data --show-interactive-dev-session=false --log-level "${LOG_LEVEL:-warn}"
[ -n "$ADMIN_TWITCH_IDS" ] && set -- "$@" --var "ADMIN_TWITCH_IDS:$ADMIN_TWITCH_IDS"
[ -n "$PUBLIC_URL" ] && set -- "$@" --var "SITE_ORIGINS:$(echo "$PUBLIC_URL" | sed 's#/*$##')"

# Notifications de live : la tâche planifiée de Cloudflare n'existe pas en
# local. Une boucle la lance chaque minute par POST /api/cron, avec un secret
# tiré au hasard à chaque démarrage, connu de ce conteneur seul. Avant,
# wrangler l'exposait sur /__scheduled (--test-scheduled), ouvert à tous sur
# le port publié : n'importe qui la déclenchait à volonté.
CRON_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')
export CRON_SECRET
set -- "$@" --var "CRON_SECRET:$CRON_SECRET"
( while sleep 60; do
    node -e 'fetch("http://127.0.0.1:" + (process.env.PORT || 8787) + "/api/cron", { method: "POST", headers: { Authorization: "Bearer " + process.env.CRON_SECRET }, signal: AbortSignal.timeout(300000) }).catch(() => {})'
  done ) &

echo "TwitchUnblock : http://localhost:${PORT:-8787} (données dans /data)"
exec wrangler dev "$@"
