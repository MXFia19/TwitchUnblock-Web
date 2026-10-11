# TwitchUnblock — Web

Watch Twitch lives and VODs in your browser, no subscription needed, with the real chat.

**Website: https://twitchunblock.vercel.app**

> 🤖 **Vibe-coded project.** Built with AI coding assistants (prompted, reviewed and tested by a human). Expect rough edges: bug reports on [Discord](https://discord.gg/cEsMRdxsVq) help a lot.

> 📱 **Also on iPhone and iPad** — [TwitchUnblock for iOS](https://github.com/MXFia19/TwitchUnblock) is the native app this website comes from: same backend, plus channel points, drops, an immersive landscape player, a sleep timer and more. Install it through AltStore, SideStore or Feather.

---

## Features

### Home
- **Top streams**, France or worldwide — no login required
- **Followed channels** once logged in with Twitch, with profile pictures
- **Continue watching**: VODs you started, with their progress bar
- Live durations and viewer counts kept up to date
- **Stream tags** under every live (language, DropsEnabled…), like on Twitch

### Streamer
- Search with suggestions as you type
- Live status (title, game, viewers, uptime), or how long the channel has been offline
- Every past broadcast, filterable by keyword or date
- **Unlisted & deleted broadcasts**: streams whose VOD is hidden or was deleted show up among the VODs as “Unlisted VOD”, rebuilt from Twitch's CDN as long as it still has them (stream IDs from `vodvod.top`, third party)
- **Clips**: the most viewed over 24 h, 7 days, 30 days or all time — played in the site, with the original chat replayed
- **About** tab: description, followers, social links and the streamer's panels
- Recent streamers

### Player
- Custom controls built around the chat: fullscreen keeps both the video **and** the chat, laid over it
- Quality picker, including “Auto”, which shows the bitrate actually in use
- Playback speed, ±10 s, double-tap on mobile, keyboard shortcuts
- Picture in picture, “back to live” button, live latency
- **Ad-free lives, from the source you pick**: Luminous Asia, an Albania proxy (TTV.LOL) and Luminous Europe, tried in that order — or official Twitch, with ads. Change it in the settings or right from the ⚙ menu, which shows the one in use; if it doesn't answer, the others take over
- **Theatre mode** (T), keyboard shortcuts anywhere on the page (? lists them)
- **VOD chapters**: game changes marked on the progress bar
- **Muted parts**: passages Twitch muted for copyrighted music show in orange on the progress bar, with a notice and a **Skip** button. For a day or two after a stream, Twitch's CDN still serves the original sound: the site loads it instead, automatically
- **Live ended** screen, and **raids followed** automatically to the target channel (can be turned off)
- VODs resume where you left off
- Mini player: playback keeps going while you browse
- “Open in…” VLC, Outplayer, Infuse, or copy the stream link

### Chat
- Connected straight to Twitch IRC — no iframe
- Twitch, **BTTV**, **FFZ** and **7TV** emotes, badges, username colours readable on a dark background
- Recent messages loaded on arrival: you never land in an empty chat
- **Pinned message**: compact banner with badges, emotes, who pinned it and a countdown — collapse it to a chip
- **Predictions** live (read-only), incoming **raids** and **announcements** highlighted
- Your name and **chosen words highlighted**; **filters**: hide bots, `!commands`, muted words, hide someone
- Chat once logged in: emote and username autocomplete, emote picker, replies
- Click someone to see their latest messages, mention them or reply
- Moderation honoured: deleted messages struck through or removed
- Scrolling pauses when you scroll up, with a “new messages” button
- **VOD chat**, replayed in sync with the video

### Everything else
- French, English, Spanish and Russian — follows your device language by default. The Russian translation was made with AI: the settings say so, with a button to report a mistake
- **Twitch-style links**: replace `twitch.tv` with the site's address — `/xqc`, `/xqc/clips`, `/xqc/about`, `/videos/123?t=1h2m3s`, `/directory/category/just-chatting` — and the browser's back/forward buttons move between pages
- Streams, VODs, clips, categories and channels are real links: middle-click or Ctrl/Cmd + click opens them in a new tab
- **Bug reports & ideas** from the top bar, the settings or the player, screenshots included (pick them or paste with Ctrl+V). **My reports** shows where each one stands (received, accepted, in progress, done, declined) and the developer's reply, and lets you answer back — updated on its own
- **Switch account** in the settings; after logging out, Twitch asks which account to use instead of signing the old one back in
- History and progress synced across devices when logged in
- Anonymous usage count, shown in the settings (see below)
- Mobile-first layout: bottom tab bar, settings sheet, landscape view
- **Installable** as an app (PWA)

---

## Community

Questions, bugs, ideas: **[join the Discord](https://discord.gg/cEsMRdxsVq)**.

---

## Repository layout

```
public/              The website, served as-is by Vercel (no build step)
  index.html
  assets/
    styles.css
    js/
      main.js        Navigation, home, streamer page, settings
      player.js      Video player (hls.js)
      api.js         Worker, Helix and GQL access — configuration at the top
      usage.js       Anonymous usage count
      i18n.js        Translations
      store.js       History, progress, preferences (localStorage)
      util.js        Escaping, formatting, icons
      chat/          Chat: IRC, emotes, badges, pinned message, VOD replay
worker.js            Backend: Cloudflare Worker
wrangler.toml        Worker configuration
docker/relay.mjs     Video relay for your own server (same proxy as the Worker)
relay/               Its docker-compose.yml and Caddyfile (HTTPS)
vercel.json          Website configuration on Vercel
```

The website is plain JavaScript (ES modules) — no framework, no build step.

---

## How it works

```
Browser ──► Cloudflare Worker ──► Twitch (playlists, video segments), ad-free sources (Luminous, TTV.LOL)
    │
    ├──► Twitch GQL     public data: streams, channels, VODs, VOD chat
    ├──► Twitch Helix   logged-in account: followed channels
    ├──► Twitch IRC     live chat (WebSocket)
    ├──► Twitch Hermes  real time: raids, predictions, viewers, stream end
    └──► BTTV / FFZ / 7TV / recent-messages   emotes and chat history
```

Video always goes through the Worker — or through your own [video relay](#video-relay-on-your-own-server-vps): Twitch's VOD CDN only accepts requests coming from `twitch.tv`, so a direct link would be blocked by the browser. The Worker also stores history backups, the usage count and announcements (Cloudflare D1).

The iOS app uses the same Worker.

### Security
- **History backups are private**: every read or write must carry the owner's Twitch token. The Worker has Twitch confirm it and checks it belongs to that account — knowing someone's (public) Twitch ID is no longer enough.
- **The proxy only relays Twitch and the ad-free sources** (`ttvnw.net`, `jtvnw.net`, `twitch.tv`, `cloudfront.net`, `luminous.dev`, and exactly `twitch-al.nadeko.net`), over HTTPS — it is not an open proxy.
- Usage pings only accept random UUIDs and store no IP address.

---

## Usage count

To know whether people actually use the website and the app, each browser (and each app install) sends a small signal to the Worker at most once an hour. Numbers are public at **[/stats](https://twitchunblock.vercel.app/stats)**: distinct people today, over 7 and 30 days, website vs iOS app, logged-in accounts vs anonymous, new people per day and how many came back.

| Sent | Never sent |
|---|---|
| Logged out: a random ID generated in the browser | Channels watched, history |
| Logged in: your Twitch token, so the Worker counts your **account** once across all your devices (its Twitch ID and username are kept, visible to the site owner only) | IP address (not stored by the Worker) |
| The website version, `web` or `ios` | |

Not counted: automated browsers and bots, copies of the site outside the official domain, private windows that can't keep the ID, visits shorter than 15 s. Keys expire on their own after 35 days. Anyone can turn it off in the settings, which also deletes their entry from the server.

The site owner's Twitch account gets developer tools on `/stats` (delete entries, reset, erase someone's backup); the Worker checks the token on every admin request.

Raw numbers: `GET https://test2.kurzmathis4.workers.dev/api/stats`

---

## Configuration

Everything lives at the top of `public/assets/js/api.js`:

| Constant | Purpose |
|---|---|
| `API_URL` | Worker address |
| `DEFAULT_FALLBACK_URLS` | Fallback Workers used when the main one hits its daily limit (see [Fallback Worker](#fallback-worker-daily-limit)) |
| `DEFAULT_RELAY_URL` | Video relay on your own server, used for playback instead of the Worker (see [Video relay](#video-relay-on-your-own-server-vps)). Empty: the Worker relays video |
| `HELIX_CLIENT_ID` | Twitch application ID (login) |
| `REDIRECT_URI` | Where Twitch sends you back after login — must be registered exactly as-is in the Twitch developer console |
| `EXTERNAL_LINKS_VIA_PROXY` | Links handed to VLC / Outplayer / Infuse: through the Worker (`true`) or straight from Twitch (`false`) |

---

## Deployment

### Website (Vercel)
Every push to `main` is deployed automatically. `vercel.json` serves the `public/` folder with no build step.

### Worker (Cloudflare)
```bash
npx wrangler deploy
```
The `DB` D1 database (history backups, usage count, announcements, feedback) is declared in `wrangler.toml`; the Worker creates its table on first use.

Optional settings, in the Cloudflare dashboard under *Workers & Pages → your Worker → Settings → **Variables and Secrets*** — the block near the top of Settings, **not** the one inside the *Build* section (build variables are never visible to the running Worker):

| Name | Type | What it does |
|---|---|---|
| `FEEDBACK_WEBHOOK` | Secret | Discord webhook address: each bug report, idea and reply is posted there, screenshots attached. `/stats` shows whether the last delivery worked and has a **Test Discord delivery** button. |
| `ADMIN_TWITCH_IDS` | Text | Twitch user ID(s) of the site owner, comma-separated, for the developer tools on `/stats`. |
| `SITE_ORIGINS` | Text | Website address(es) whose usage pings are counted, comma-separated. |

`wrangler.toml` sets `keep_vars = true`, so deploying again doesn't wipe the ones set in the dashboard.

### Fallback Worker (daily limit)

The free Workers plan allows 100,000 requests per day **per Cloudflare
account**. Past that, the Worker answers `error code: 1027` (HTTP 429) until
midnight UTC. The website and the iOS app then switch to a second Worker,
deployed on **another** Cloudflare account, for everything that doesn't need
the D1 database: lives, VODs, the video relay and Moobot commands. Backups,
the usage count and announcements stay on the main Worker. A video that is
already playing switches over by itself and resumes where it was.

1. On the other Cloudflare account: *Workers & Pages → Create → Import a
   repository*, pick this repository and the `main` branch.
2. Name the Worker `test2-fallback` and set the deploy command to
   `npx wrangler deploy --env fallback`. The `fallback` environment in
   `wrangler.toml` has no D1 binding.
3. Add its address (`https://test2-fallback.<subdomain>.workers.dev`) to
   `DEFAULT_FALLBACK_URLS` in `public/assets/js/api.js`, and to
   `kAPIFallbackURLs` in the iOS app.

A copy of the site with its own Worker lists its fallbacks in
`public/config.js`: `window.TU_CONFIG = { apiUrl: '…', fallbackApiUrls: ['…'] }`.

### Video relay on your own server (VPS)

Almost all of the Worker's requests come from video playback on the website:
every VOD segment goes through `/api/proxy`, and a live stream's playlist is
reloaded every ~2 s — roughly 360 requests per hour of VOD and 1,800 per hour
of live, per viewer. The video relay runs the same proxy (`worker.js`) on a
server of yours, with no request limit. The Worker keeps everything else
(backups, usage count, announcements, stream and VOD lookups).

The website sends playback through the relay when one is set
(`DEFAULT_RELAY_URL` in `public/assets/js/api.js`, or `relayUrl` in
`public/config.js`), and falls back to the Worker on its own when the relay
doesn't answer — even in the middle of a video. The iOS app reads Twitch's CDN
directly and doesn't need it.

You need a server with Docker and a domain name pointing to it (a free
subdomain from [duckdns.org](https://www.duckdns.org) works — DuckDNS also
answers for any name under yours, like `relay.yourname.duckdns.org`).

1. In a folder on the server, put [`relay/docker-compose.yml`](relay/docker-compose.yml)
   and [`relay/Caddyfile`](relay/Caddyfile), and a `.env` file:
   ```
   RELAY_DOMAIN=myrelay.duckdns.org
   ```
2. Start it:
   - **A web server already uses ports 80/443** (Caddy, nginx…): run
     `docker compose up -d`, then have that server forward `RELAY_DOMAIN` to
     `127.0.0.1:8788`. With Caddy, add to its Caddyfile and reload it
     (`sudo systemctl reload caddy`):
     ```
     myrelay.duckdns.org {
         reverse_proxy 127.0.0.1:8788 {
             flush_interval -1
         }
     }
     ```
   - **That web server is itself a Docker container** (a Caddy from another
     project, say): put the relay on that container's network with a
     `docker-compose.override.yml` next to `docker-compose.yml`, then forward
     to `twitchunblock-relay:8788` instead of `127.0.0.1:8788`
     (`docker inspect <container>` shows its network):
     ```yaml
     services:
       relay:
         container_name: twitchunblock-relay
         networks: [default, proxy]
     networks:
       proxy:
         external: true
         name: theirproject_default
     ```
   - **Ports 80/443 are free**: `docker compose --profile caddy up -d` — the
     bundled Caddy gets and renews the HTTPS certificate by itself (open ports
     80 and 443, see below).
3. Check that `https://myrelay.duckdns.org/health` answers `ok`.
4. Set `DEFAULT_RELAY_URL` (or `relayUrl`) to `https://myrelay.duckdns.org`.

To update: `docker compose pull && docker compose up -d` (add `--profile caddy`
if you use the bundled Caddy). The relay runs from
the website's image (`ghcr.io/mxfia19/twitchunblock-web`), started with
`node /app/relay.mjs`.

`ALLOWED_ORIGINS` (in `docker-compose.yml`) lists the websites allowed to use
the relay; other sites get a 403, so they can't use your bandwidth. Bandwidth:
every VOD watched on the website goes through the server (about 1.5–3.5 GB per
hour depending on quality); live video segments don't, only their playlists.

**Oracle Cloud:** open ports 80 and 443 in two places — in the VCN's security
list (*Networking → Virtual cloud networks → your VCN → Security lists →
Add ingress rules*, source `0.0.0.0/0`, TCP, ports `80` and `443`), and in the
instance's firewall. On Oracle's Ubuntu images:

```bash
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT
sudo netfilter-persistent save
```

(Oracle Linux: `sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`.)

### Locally
```bash
cd public
python3 -m http.server 8080
# then open http://localhost:8080
```
Twitch login only works at the address set in `REDIRECT_URI`.

### Self-hosting with Docker

The website and the Worker run together in one container, with a local D1
database (SQLite) for backups, usage count and announcements. No Cloudflare
account needed.

Only [`docker-compose.yml`](docker-compose.yml) is needed, no clone: put it in
a folder and run

```bash
docker compose up -d
# then open http://localhost:8787
```

To update:

```bash
docker compose pull && docker compose up -d
```

The image (`ghcr.io/mxfia19/twitchunblock-web`, amd64 and arm64) is built by
GitHub Actions on every update of `main`: nothing to compile on your side.
From a clone, you can build it yourself with `build: .` instead of `image:`.

Older `docker-compose.yml` files built the image locally: download the new one
once, then update as above.

Settings (in `docker-compose.yml`):

| Variable | What it does |
|---|---|
| `PUBLIC_URL` | Public address of your instance, without a trailing `/` (default `http://localhost:8787`). |
| `TWITCH_CLIENT_ID` | Optional. To log in with Twitch, create an app on [dev.twitch.tv/console](https://dev.twitch.tv/console) with `PUBLIC_URL/` as the redirect URL, and paste its Client ID. |
| `ADMIN_TWITCH_IDS` | Optional. Your Twitch user ID(s), comma-separated, for the developer tools on `/stats`. |

Data lives in the `twitchunblock-data` volume. Watching lives, VODs and clips,
the chat (read-only without login), categories and device follows all work
out of the box; logging in needs your own Twitch app (see above). The iOS app
keeps using the official backend.

---

## Credits

Made by [MXFia19](https://github.com/MXFia19).

Thanks to [hls.js](https://github.com/video-dev/hls.js), [BetterTTV](https://betterttv.com), [FrankerFaceZ](https://www.frankerfacez.com), [7TV](https://7tv.app), [recent-messages](https://recent-messages.robotty.de), [Lucide](https://lucide.dev) for the icons and [Inter](https://rsms.me/inter/) for the font.

Independent project, not affiliated with Twitch.
