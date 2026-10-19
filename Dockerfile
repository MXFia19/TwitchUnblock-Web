# TwitchUnblock (site + Worker) en un seul conteneur.
#
# Le Worker tourne dans workerd, le moteur des Cloudflare Workers, via
# `wrangler dev` en mode local : aucun compte Cloudflare n'est nécessaire.
# wrangler n'écoute que dans le conteneur ; le port publié est celui d'un
# petit frontal (docker/front.mjs) qui ne relaie que le site et /api.
# Les données (sauvegardes, comptage, annonces) vont dans une base D1 locale
# (SQLite) rangée dans le volume /data.
FROM node:22-slim

# X_LOCAL_EXPLORER=false : pas d'explorateur de la base D1 dans wrangler dev
# (actif par défaut depuis wrangler 4.80). Le frontal (docker/front.mjs) ne
# laisse de toute façon rien passer de /cdn-cgi/ ; ceci en plus.
ENV NODE_ENV=production \
    WRANGLER_SEND_METRICS=false \
    X_LOCAL_EXPLORER=false \
    PORT=8787

WORKDIR /app
# workerd vérifie le TLS avec le magasin de certificats système, absent de l'image slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Version exacte : « wrangler@4 » montait seul à chaque construction, et c'est
# ainsi que sont arrivés sans bruit des outils locaux ouverts à tous (tâche
# planifiée en 4.30, explorateur de la base en 4.80). À monter à la main,
# après lecture des notes de version (routes /cdn-cgi/…, option --ip).
RUN npm install -g wrangler@4.151.0 && npm cache clean --force

COPY docker/front.mjs ./front.mjs
COPY worker.js ./
# Relais vidéo pour un VPS (relay/docker-compose.yml) : même proxy que le Worker.
COPY worker.js ./worker.mjs
COPY docker/relay.mjs ./relay.mjs
COPY docker/discord-bot.mjs ./discord-bot.mjs
COPY docker/healthcheck.mjs ./healthcheck.mjs
COPY public ./public
COPY docker/wrangler.docker.toml ./wrangler.docker.toml
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R node:node /app /data

USER node
VOLUME /data
EXPOSE 8787

# Santé du conteneur, site ou relais (docker/healthcheck.mjs) : « docker ps »
# l'affiche ; pour le relais, elle tient compte du bot Discord.
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 CMD ["node", "/app/healthcheck.mjs"]

# Commit et branche de la construction (.github/workflows/docker.yml) : le
# relais les donne sur /health et son bot prévient quand GitHub a plus
# récent ; le Worker de l'image s'en sert comme version. En dernier : ils
# changent à chaque construction, les couches d'avant restent en cache.
ARG GIT_SHA=""
ARG GIT_BRANCH=""
ENV GIT_SHA=$GIT_SHA \
    GIT_BRANCH=$GIT_BRANCH

ENTRYPOINT ["/entrypoint.sh"]
