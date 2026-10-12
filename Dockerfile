# TwitchUnblock (site + Worker) en un seul conteneur.
#
# Le Worker tourne dans workerd, le moteur des Cloudflare Workers, via
# `wrangler dev` en mode local : aucun compte Cloudflare n'est nécessaire.
# Les données (sauvegardes, comptage, annonces) vont dans une base D1 locale
# (SQLite) rangée dans le volume /data.
FROM node:22-slim

ENV NODE_ENV=production \
    WRANGLER_SEND_METRICS=false \
    PORT=8787

WORKDIR /app
# workerd vérifie le TLS avec le magasin de certificats système, absent de l'image slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g wrangler@4 && npm cache clean --force

COPY worker.js ./
# Relais vidéo pour un VPS (relay/docker-compose.yml) : même proxy que le Worker.
COPY worker.js ./worker.mjs
COPY docker/relay.mjs ./relay.mjs
COPY docker/discord-bot.mjs ./discord-bot.mjs
COPY public ./public
COPY docker/wrangler.docker.toml ./wrangler.docker.toml
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R node:node /app /data

USER node
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["/entrypoint.sh"]
