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

# wrangler n'écoute que dans le conteneur (127.0.0.1:INNER_PORT) ; le port
# publié est celui du frontal (docker/front.mjs), qui ne relaie que le site et
# /api. Ouvert à tous, wrangler dev livrait ses outils locaux à qui envoyait
# « Host: localhost » : la tâche planifiée (/cdn-cgi/local/scheduled) et
# l'explorateur de la base D1, en lecture et en écriture.
PORT=${PORT:-8787}
INNER_PORT=${INNER_PORT:-8786}
[ "$INNER_PORT" = "$PORT" ] && INNER_PORT=$((PORT + 1))
export PORT INNER_PORT

set -- --config /app/wrangler.docker.toml --ip 127.0.0.1 --port "$INNER_PORT" \
  --persist-to /data --show-interactive-dev-session=false --log-level "${LOG_LEVEL:-warn}"
[ -n "$ADMIN_TWITCH_IDS" ] && set -- "$@" --var "ADMIN_TWITCH_IDS:$ADMIN_TWITCH_IDS"
# Les outils d'administration n'acceptent que les jetons des applications
# Twitch connues : celle de ce site en fait partie.
[ -n "$TWITCH_CLIENT_ID" ] && set -- "$@" --var "TWITCH_CLIENT_ID:$TWITCH_CLIENT_ID"
[ -n "$PUBLIC_URL" ] && set -- "$@" --var "SITE_ORIGINS:$(echo "$PUBLIC_URL" | sed 's#/*$##')"

# Notifications de live : la tâche planifiée de Cloudflare n'existe pas en
# local. Une boucle la lance chaque minute par POST /api/cron, avec un secret
# tiré au hasard à chaque démarrage, connu de ce conteneur seul. Avant,
# wrangler l'exposait sur /__scheduled (--test-scheduled), ouvert à tous sur
# le port publié : n'importe qui la déclenchait à volonté. (Avec ce secret,
# scheduled() du Worker ne fait plus rien : seule cette route la lance.)
CRON_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')
export CRON_SECRET
set -- "$@" --var "CRON_SECRET:$CRON_SECRET"
( while sleep 60; do
    node -e 'fetch("http://127.0.0.1:" + process.env.INNER_PORT + "/api/cron", { method: "POST", headers: { Authorization: "Bearer " + process.env.CRON_SECRET }, signal: AbortSignal.timeout(300000) }).catch(() => {})'
  done ) &

echo "TwitchUnblock : http://localhost:${PORT} (données dans /data)"
exec node /app/front.mjs wrangler dev "$@"
