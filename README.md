# TwitchUnblock — Web

Watch Twitch lives and VODs in your browser, no subscription needed, with the real chat.

**Website: https://twitchunblock.vercel.app**

> 🤖 **Vibe-coded project.** Built with AI coding assistants (prompted, reviewed and tested by a human). Expect rough edges: bug reports on [Discord](https://discord.gg/cEsMRdxsVq) help a lot.

> 📱 **Also on iPhone and iPad** — [TwitchUnblock for iOS](https://github.com/MXFia19/TwitchUnblock) is the native app this website comes from: same backend, plus channel points, drops, an immersive landscape player, a sleep timer and more. Install it through AltStore, SideStore or Feather.

---

## Features

### Home
- **Top streams**, France or worldwide — no login required, with “Load more” (30 at a time; the extra cards stay put during the background refresh)
- **Followed channels** once logged in with Twitch, with profile pictures
- **Pinned streamers**: the pin on a followed channel's card (or at the end of its offline row) keeps it at the top of Following
- **Continue watching**: VODs you started, with their progress bar
- Live durations and viewer counts kept up to date
- **Stream tags** under every live (language, DropsEnabled…), like on Twitch
- **Categories**: every game and the ones you follow, then the lives in each — filterable by language (all, or a single one), a choice kept for every category
- **Hide channels and categories**: the crossed-out eye on a Top or category card hides that channel (or its category) from Top, the category grid and a category's lives, with “Undo”. Top tops itself up from the next page of Twitch's top so it doesn't get shorter, and a “N hidden here · Manage” line leads to the list in Settings. What you follow or pin, and the categories you follow, are never hidden; search, a channel's page and a category opened directly still show everything (“Hidden · Show again”). Stored on this device and included in the backup export/import, in the same format as the iOS app
- **Past the first 100 without an account**: “Load more” keeps going for categories, a category's lives, a channel's clips and its VODs. The first page uses Twitch's web Client-ID as before; the next ones use the public Client-ID of Twitch's Android app, which Twitch doesn't ask an integrity token from (the technique of the Xtra app). If Twitch refuses it, logged-in users carry on through Helix, others see a short message

### Streamer
- Search with suggestions as you type
- Live status (title, game, viewers, uptime), or how long the channel has been offline
- Every past broadcast, filterable by keyword or date — 100 at a time with “Load more”, fetched from the browser (the Worker route is only a fallback for the first page)
- **Unlisted & deleted broadcasts**: streams whose VOD is hidden or was deleted show up among the VODs as “Unlisted VOD”, rebuilt from Twitch's CDN as long as it still has them (stream IDs from `vodvod.top`, third party; when that source is down, the page says so instead of showing nothing). The cards open with Enter or Space too, and the player's Refresh button rebuilds the video again
- **Clips**: the most viewed over 24 h, 7 days, 30 days or all time — played in the site, with the original chat replayed
- **About** tab: description, followers, social links and the streamer's panels
- Recent streamers

### Player
- Custom controls built around the chat: fullscreen keeps both the video **and** the chat, laid over it
- Quality picker, including “Auto”, which shows the quality actually in use on the player button (“Auto · 720p”); Auto usually starts higher than before (up to 720p, lives and VODs) and, on lives, climbs back up when the connection allows
- **Preferred quality** (Settings → Player): Auto, Source, 1080p, 720p, 480p, 360p, 160p or audio only, used whenever a live or VOD starts; when a channel doesn't have it, the closest one below is used (the Worker gives each quality's real height, so a 720p60 “Source” counts as 720p). Picking a quality in the player replaces it. Audio only is available for VODs too
- Playback speed for VODs and clips (0.25× to 2×, `<` / `>` keys), remembered from one VOD to the next, shown on the ⚙ button (as a badge on phones) and recalled when a VOD starts; lives always play at 1×
- ±10 s, double-tap on mobile, keyboard shortcuts
- Picture in picture, “back to live” button, live latency — never under 4 seconds behind the edge (closer, playback freezes): the target follows how long Twitch takes to publish each segment, and skipping ahead or “back to live” stop there too. Lives never change playback speed to catch up (the sound drifted away from the picture): the player makes a small jump instead, and never after you rewound on purpose
- **Live sources, in the order you pick**: Luminous Asia, an Albania proxy (TTV.LOL), Luminous Europe and official Twitch (with ads), tried one after the other until one answers. The proxies avoid most ads, but not the channel's own ad breaks: Twitch puts its “Commercial break in progress” screen (or an ad) into every source at the same time, mostly for 15–30 s when a stream opens. Reorder them in Settings → Player; picking a source from the player's ⚙ menu (which ticks the one in use) moves it to the top and switches the live to it — your preferred source too, when another one had taken over. When no source answers while the channel is live, the player says so (an offline channel is shown as offline), and it counts as a failure on `/stats`. Channels that stream with multiple encodes (Enhanced Broadcasting) keep each quality's own name on every source
- **Channel ad breaks explained**: when Twitch replaces the live with an ad break, a banner says so with a countdown to the stream's return, and the sound is muted until then (unless you turn it back on). Detected from the live playlist, in Auto as in a fixed quality, and timed on the picture actually shown. The website can't use a Twitch sub to skip them (the iPhone app can, with its web session)
- **Theatre mode** (T), keyboard shortcuts anywhere on the page (? lists them)
- **VOD chapters**: game changes marked on the progress bar
- **Muted parts**: passages Twitch muted for copyrighted music show in orange on the progress bar, with a notice and a **Skip** button. For a day or two after a stream, Twitch's CDN still serves the original sound: the site loads it instead, automatically. On VODs stored as fMP4, the parts Twitch lists as `-unmuted.mp4` already have their sound: they're not shown as muted
- **Live ended** screen, and **raids followed** automatically to the target channel (can be turned off)
- Playback errors are retried a few times, spaced out (2, 4, then 8 s), before an error screen with a Refresh button — never an endless stream of requests; while the device is offline, the player waits for the connection to come back. A VOD plays on past a segment Twitch's CDN no longer has (rebuilt or very old VODs) instead of stopping
- VODs resume where you left off
- **Download a VOD** or just a part of it (from one time to another, from where you are, the next 10 minutes) in the quality you pick: one `.ts` (or `.mp4`) file that plays in VLC, mpv or the Windows player. Parts muted for copyrighted music keep their original sound while Twitch still has it (and always on fMP4 VODs' `-unmuted.mp4` parts). Chrome and Edge write the file straight to disk; other browsers build it in memory (up to about 1.5 GB). Deleted VODs rebuilt from the CDN can be downloaded too
- Mini player: playback keeps going while you browse
- “Open in…” VLC, Outplayer, Infuse, or copy the stream link

### Multi-live
- Up to **four videos side by side, lives and VODs mixed**: the “+” on a live or VOD card (or “Multi-live” on a channel page and under the player) adds one, and a bar at the bottom shows your picks
- A live tile picks its quality from its size; a VOD tile plays 1080p alone, 720p with two tiles, 480p beyond — never above your preferred quality. Click a tile to hear it (or 1–4 on the keyboard, M to mute), double-click for fullscreen
- **VOD tiles** resume where you left off and save their progress (the VOD joins your history); the tile you hear has its controls: play/pause, ±10 s, time and a seek bar (Space or K, ← →). Others show a thin progress line, and “Watch again” at the end
- On large screens, the chat of the video you hear shows on the right — replayed for a VOD (button in the mosaic, or Settings → Chat → Chat in multi-live)
- Add a channel by name, or a VOD by its link or ID, from the mosaic; open a tile with its chat in the regular player (a VOD at the tile's moment), and **share the mosaic's link** (`/?multi=xqc,v:2345678901`; “Copy” adds each VOD's moment, `v:<id>~<seconds>`; where the browser can't copy, as in Discord's or Instagram's in-app browser, the share sheet opens or the link is shown)
- Live tiles get the same rescue as the player: segments through the relay when Twitch's CDN is blocked, and another relay or Worker when the one serving them stops answering

### Chat
- Connected straight to Twitch IRC — no iframe
- Twitch, **BTTV**, **FFZ** and **7TV** emotes, badges, username colours readable on a dark background. BetterTTV's live connection adds the personal emotes of BTTV Pro users (once BTTV announces them) and the emotes added to the channel during the stream
- **Click an emote or a badge** (in the chat, the pinned message or someone's card; right-click in the emote picker): a sharp, larger image, its exact name and source, copy it or add it to your message. Twitch emotes show their type (global, tier 1–3 sub emote, channel points) and the channel they belong to — live or not, one click opens its page — with that tier's other sub emotes; BTTV, FFZ and 7TV emotes show whether they're global or the channel's, who made them, their original name, zero-width (7TV) and modifier emotes, and a link to their page. Badges show their title (“3-Month Subscriber”…), also as a tooltip. Animated FFZ emotes now move, in the chat too
- Recent messages loaded on arrival: you never land in an empty chat
- The chat connects within a few seconds even when an emote or badge source is slow (filtered network, VPN): emotes that arrive later show up in the next messages
- **Pinned message**: compact banner with badges, emotes, who pinned it and a countdown — collapse it to a chip
- **Drops card**: when the channel runs a drops campaign, a card under the pinned message shows the reward, the watch time, the end date and a link to the details; dismissed, it stays away for that campaign
- **Predictions** live (read-only), incoming **raids** and **announcements** highlighted
- **Hype train**, without an account: the “Incoming” card when a channel is one or two supports away from a Hype Train (dots and countdown), the departure, the current level with its real progress bar and time left, a line when a level is completed, and the end of a completed train — in real time in the main chat, every few seconds in the multi-live chat
- Your name and **chosen words highlighted**; **filters**: hide bots, `!commands`, muted words, hide someone
- Chat once logged in: emote and username autocomplete, emote picker, replies
- **Chat restrictions said upfront**: the room's modes above the message box (followers only and for how long, subscribers only, emotes only, slow mode, verified account…), the channel's chat rules to accept before your first message, and a message Twitch refuses removed with the reason, instead of looking sent
- **Banned from a channel's chat**: when Twitch refuses your account in that chat, the chat keeps going read-only without your account (like a logged-out viewer), with a banner in place of the message box and a “Retry with my account” button for when you're unbanned — remembered for that channel until the page is reloaded. A timeout shows a line with its duration
- Click someone to see their latest messages, mention them or reply
- Moderation honoured: deleted messages struck through or removed
- Scrolling pauses when you scroll up, with a “new messages” button
- **VOD chat**, replayed in sync with the video

### Everything else
- **Themes** (Settings → Appearance): light, dark, OLED black or slate background — or your device's — and the app's seven accent colors, applied before the page shows
- French, English, Spanish and Russian — follows your device language by default. The Russian translation was made with AI: the settings say so, with a button to report a mistake
- **Twitch-style links**: replace `twitch.tv` with the site's address — `/xqc`, `/xqc/clips`, `/xqc/about`, `/videos/123?t=1h2m3s`, `/directory/category/just-chatting` — and the browser's back/forward buttons move between pages
- Streams, VODs, clips, categories and channels are real links: middle-click or Ctrl/Cmd + click opens them in a new tab
- **Bug reports & ideas** from the top bar, the settings or the player, screenshots included (pick them or paste with Ctrl+V). **My reports** shows where each one stands (received, seen, accepted, in progress, done, declined) and the developer's reply, and lets you answer back — updated on its own; a banner tells you when the developer replies. A report that's done or declined, with the developer having the last word, is no longer checked (opening it still looks once); answering it brings it back
- **Switch account** in the settings; after logging out, Twitch asks which account to use instead of signing the old one back in
- History and progress synced across devices when logged in
- **Live notifications**: a notification when a channel you follow goes live, even with the site closed — on a computer, as long as the browser is running (Settings → Notifications, with a test button). The settings say whether they're on for this device, and for how many channels (the number the Worker actually keeps). A lost or replaced browser subscription is picked up again on the next visit (if the browser refuses, the settings say to turn the switch off and on again), and changing the site's language changes the notifications' language. On iPhone and iPad, install the site first (iOS 16.4 or later, see below)
- Anonymous usage count, shown in the settings (see below)
- Mobile-first layout: bottom tab bar, settings sheet, landscape view
- **Installable as an app** (PWA): an icon on the home screen or desktop, the site in its own window without the browser bar, and live notifications even when it's closed (on a computer, as long as the browser is running). **Settings → Install the app** shows the steps for your device, with an Install button when Chrome or Edge offer it (hidden once installed, and on plain-HTTP self-hosting, where browsers allow neither installing nor notifications). The title bar follows the chosen background
  - **iPhone / iPad**: in Safari, Share (or the ⋯ menu) → Add to Home Screen, keep “web app” on if offered, then open it from the icon and turn notifications on (iOS 16.4 or later)
  - **Android**: browser menu ⋮ → Install app / Add to Home screen
  - **Chrome / Edge on a computer**: the install icon in the address bar, or the browser menu → Install
  - **Safari on Mac** (macOS Sonoma or later): File → Add to Dock
  - **Firefox**: use Chrome or Edge to install it; notifications still work while Firefox is open

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
      multi.js       Multi-live: up to four lives and VODs side by side
      download.js    Download a VOD or a part of it
      api.js         Worker, Helix and GQL access — configuration at the top
      usage.js       Anonymous usage count
      i18n.js        Translations
      store.js       History, progress, preferences (localStorage)
      util.js        Escaping, formatting, icons
      chat/          Chat: IRC, emotes, badges, pinned message, hype train, VOD replay
worker.js            Backend: Cloudflare Worker
wrangler.toml        Worker configuration
docker/relay.mjs     Video relay for your own server (same proxy as the Worker)
docker/discord-bot.mjs  Discord bot (feedback, alerts, releases), run by the relay
relay/               Its docker-compose.yml and Caddyfile (HTTPS)
vercel.json          Website configuration on Vercel
```

The website is plain JavaScript (ES modules) — no framework, no build step.

---

## How it works

```
Browser ──► Cloudflare Worker ──► Twitch (playlists, video segments), proxy sources (Luminous, TTV.LOL)
    │
    ├──► Twitch GQL     public data: streams, channels, VODs, VOD chat
    ├──► Twitch Helix   logged-in account: followed channels
    ├──► Twitch IRC     live chat (WebSocket)
    ├──► Twitch Hermes  real time: raids, predictions, hype train, viewers, stream end
    └──► BTTV / FFZ / 7TV / recent-messages   emotes and chat history
```

Video always goes through the Worker — or through your own [video relay](#video-relay-on-your-own-server-vps): Twitch's VOD CDN only accepts requests coming from `twitch.tv`, so a direct link would be blocked by the browser. The Worker also stores history backups, the usage count and announcements (Cloudflare D1).

The iOS app uses the same Worker.

**Live notifications** (Web Push): the browser subscribes with its push service (Apple, Google, Mozilla, Microsoft) and hands the Worker its delivery address, its keys and the followed channels. Every 2 minutes (Cron Trigger, every minute with the check every other one), the Worker asks Twitch which of them are live — 100 channels per GQL request, 1,200 per check; beyond that, the checks take turns, each one moving on by 1,200 channels, so up to 2,400 every channel is read at least every other check (about 4 minutes) — and a channel that just went live queues a notification for each of its followers, sent encrypted (RFC 8291) and signed (VAPID, keys created on first use and kept in D1). The number of runs doesn't depend on the number of subscribers. On the free plan a run gets about 10 ms of CPU and a notification costs about 0.7 ms, so they leave from a queue, about 480 an hour; the $5 plan lifts that. Expired subscriptions are forgotten.

The iOS app can't use Apple's push service (it needs a paid developer account), so it goes through [ntfy](https://ntfy.sh): the app creates a secret topic, the user subscribes to it in the free ntfy app, and the same scheduled check publishes a plain message there (`twitchunblock://live/<channel>` opens the stream in the app). Topics the app hasn't refreshed for 60 days are dropped.

ntfy.sh's free tier counts messages per IP address (250 a day). Every Cloudflare Worker sends from the same shared addresses, so ntfy.sh answers them `429 Too Many Requests`. The Worker therefore hands its ntfy messages to the [video relay](#video-relay-on-your-own-server-vps) (`NTFY_RELAY` in `wrangler.toml`), which publishes them from its own address. Messages leave in one batch per run (12 at most, ntfy.sh's pace of one request every 5 seconds), signed with the Worker's VAPID key: the relay checks the signature against the Worker's public key (`/api/push/key`) and refuses anything else, so no secret needs to be shared. After a `429` the Worker stops sending to ntfy for 5 minutes, or until midnight UTC (when ntfy.sh resets its counters) once the daily quota is reached; the app's **Test** button says so. While the relay is down, messages wait in the queue (30 minutes at most): there is no fallback to sending directly, which ntfy.sh would refuse anyway. The relay logs one line per batch (`docker compose logs relay`). With `NTFY_TOKEN` (a paid ntfy account, counted per account rather than per address) the Worker publishes directly, like the Docker image does from your own server.

### Security
- **History backups are private**: every read or write must carry the owner's Twitch token. The Worker has Twitch confirm it and checks it belongs to that account — knowing someone's (public) Twitch ID is no longer enough.
- **The proxy only relays Twitch and the proxy sources** (`ttvnw.net`, `jtvnw.net`, `twitch.tv`, `twitchcdn.net`, `luminous.dev`, exactly `twitch-al.nadeko.net`, and on `cloudfront.net` only Twitch's own VOD distributions — a new one is accepted once Twitch itself points to it), over HTTPS — it is not an open proxy. Redirects are followed one by one (4 at most), each new address checked the same way. What comes back is served as media with only the headers a player needs, never as a web page (`nosniff`, sandboxing CSP).
- Usage pings only accept random UUIDs and store no IP address.
- Rate limits (feedback, replies, pings, notifications) count an IPv6 address by its `/64` block. Screenshots attached to feedback have a daily cap for the whole Worker and stop before the D1 database fills up; the message itself still goes through.

---

## Usage count

To know whether people actually use the website and the app, each browser (and each app install) sends a small signal to the Worker at most once an hour. Numbers are public at **[/stats](https://twitchunblock.vercel.app/stats)**: unique people today, over 7 and 30 days (each one counted once per period), website vs iOS app, logged-in accounts vs anonymous, new vs returning people, active people per day, retention (back after 1, 7 and 14 days), live health (which source served each live, failures, channel ad breaks seen), devices and languages, and live notifications.

| Sent | Never sent |
|---|---|
| Logged out: a random ID generated in the browser | Channels watched, history |
| Logged in: your Twitch token, so the Worker counts your **account** once across all your devices (its Twitch ID and username are kept, visible to the site owner only) | IP address (not stored by the Worker) |
| The website version, `web` or `ios` | |
| The interface language, the device type (phone or computer; iPhone or iPad) and, from the app, the iOS major version | Titles, searches |
| How many lives and VODs were started since the last signal: which source served each live, how many failed, how many channel ad breaks were shown — counters only | |

Not counted: automated browsers and bots, copies of the site outside the official domain, private windows that can't keep the ID, visits shorter than 15 s. Keys expire on their own after 35 days. Anyone can turn it off in the settings, which also deletes their entry from the server.

**Live notifications** on `/stats` come from the Worker's own tables, not from the signal above: subscribers (website by push service — Apple, Google, Mozilla, Microsoft — and iOS app through ntfy), new ones today and over 7 days, channels watched and how many are live right now, notifications waiting, the ntfy route (relay or direct) with today's messages against ntfy.sh's 250 a day and any pause, and notifications sent per day with the last 7 days' totals (lives detected, tests, failures, refusals, expired subscriptions). Counts only: no channel name, nothing per subscriber.

The Twitch accounts in `ADMIN_TWITCH_IDS` (the site owner's) get developer tools on `/stats` (delete entries, reset, erase someone's backup); the Worker checks the token on every admin request.

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
| `FEEDBACK_WEBHOOK` | Secret | Discord webhook address: each bug report, idea and reply is posted there, screenshots attached. In a **forum** channel, each report gets its own post, where its replies land too. `/stats` shows whether the last delivery worked and has a **Test Discord delivery** button. |
| `FEEDBACK_BOT_SECRET` | Secret | Optional. Shared secret (32+ random characters) of the [Discord bot](#discord-bot-feedback-alerts-releases): the same value goes in the relay's `.env`. Without it, the bot's route is off. |
| `ALERT_WEBHOOK` | Secret | Optional. Webhook of a private Discord channel: every 5 minutes the Worker checks the [video relay](#video-relay-on-your-own-server-vps) (`NTFY_RELAY`) and the Discord bot, and posts there when one goes down or comes back. |
| `ADMIN_TWITCH_IDS` | Text | Twitch user ID(s) of the site owner, comma-separated, for the developer tools on `/stats`. Set in `wrangler.toml` for the official Worker (it replaces a dashboard value): put your own for your own Worker. Without it, nobody gets the tools. |
| `SITE_ORIGINS` | Text | Website address(es) whose usage pings are counted, comma-separated. |
| `NTFY_TOKEN` | Secret | Optional. Access token of a **paid** [ntfy](https://ntfy.sh) account, for the iOS app's live notifications: ntfy.sh counts free use per IP address (250 messages a day), which the Worker's shared Cloudflare addresses don't get — hence the relay below. A paid account is counted per account (2,500 a day for $6/month) and lets the Worker publish directly. A free account changes nothing. |
| `NTFY_RELAY` | Text | Set in `wrangler.toml`: the [video relay](#video-relay-on-your-own-server-vps) that publishes the iOS app's ntfy messages (see [How it works](#how-it-works)). For your own Worker, point it to your own relay (with `NTFY_WORKER` set there) or remove it. |

`wrangler.toml` sets `keep_vars = true`, so deploying again doesn't wipe the ones set in the dashboard. It also declares the Cron Trigger (every minute) behind the live notifications — nothing to set up.

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

### Your own Worker, from the settings (no rebuild)

If the official Workers go down — or the project disappears — anyone can
deploy this repository's Worker (Cloudflare as above, or the Docker image
below, over HTTPS) and enter its address in **Settings → Expert settings →
Personal Worker**, on the website or in the iOS app. The address is checked
first (a TwitchUnblock Worker answers an empty channel name with a JSON
error). It is then tried **first for playback** — lives, VODs, playlists —
with the official Workers as a fallback; the official video relay is not
used. **Send everything through this Worker** also moves history backups,
feedback, announcements, notifications and the usage count there: your
Twitch token is then sent to it (backups), so only turn it on for a Worker
you host yourself. The website reloads when the Worker changes.

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
doesn't answer — even in the middle of a video, multi-live tiles included.
A relay that fails its `/health` check when the page opens is only set aside
(for 30 minutes) if a Worker answers meanwhile: a slow or offline phone
connection doesn't count against it, and neither does a missing segment or
playlist (404, as when a live ends). The iOS app reads Twitch's CDN directly
and doesn't need it.

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

**ntfy:** the relay also publishes the iOS app's live notifications to
ntfy.sh for the Worker (`POST /ntfy`), since ntfy.sh refuses Cloudflare's
shared addresses. It only accepts batches signed by the Worker whose address
is in `NTFY_WORKER` (default: the official Worker; its public key is read
from `<NTFY_WORKER>/api/push/key`), each signed batch once, and only for the
app's topics with a link back into the app. An empty `NTFY_WORKER=` in `.env`
turns it off. Your server's address gets ntfy.sh's free quota: 250 messages a
day.

`RELAY_DOMAIN` is required: without it, `docker compose` stops with a message,
and the relay itself refuses to start with an invalid `PUBLIC_ORIGIN`.

The relay only relays what the Worker's proxy accepts (see [Security](#security)),
and it never connects to an internal address of your server — loopback,
private networks, the Docker network, the cloud metadata service — even if a
name or a redirect points there. Failed requests are logged
(`docker compose logs relay`).

`ALLOWED_ORIGINS` (in `docker-compose.yml`) lists the websites allowed to use
the relay; other sites get a 403, so they can't use your bandwidth. Bandwidth:
every VOD watched on the website goes through the server (about 1.5–3.5 GB per
hour depending on quality); live video segments don't, only their playlists —
unless a browser can't reach Twitch's CDN (three segments in a row that never
arrive): that device then sends them through the relay for a week, and goes
back to direct as soon as the CDN answers again (checked every 10 minutes at
most).

**Oracle Cloud:** open ports 80 and 443 in two places — in the VCN's security
list (*Networking → Virtual cloud networks → your VCN → Security lists →
Add ingress rules*, source `0.0.0.0/0`, TCP, ports `80` and `443`), and in the
instance's firewall. On Oracle's Ubuntu images:

```bash
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT
sudo netfilter-persistent save
```

(Oracle Linux: `sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`.)

### Discord bot (feedback, alerts, releases)

A small bot runs inside the [video relay](#video-relay-on-your-own-server-vps).
Everything it writes is in English. Only the server owner and
`DISCORD_ADMIN_IDS` act as the developer; the developer commands are also
limited to server admins in Discord.

**Feedback bridge** (a private **forum** channel):

- Each bug report or idea gets its own post, where the person's replies land
  too. Writing in the post sends your reply, screenshots included (JPEG, PNG
  or WebP) — the person reads it in **My reports**, no account needed. The bot
  reacts ✅ once it's sent, ❌ with the reason otherwise; start a message with
  `//` for a private note.
- **Quick replies**: buttons under each new report ("Thanks, noted", "Send a
  screenshot", "More details", "Fixed next version" — which also marks it
  Done —, "Already fixed", "Can't reproduce").
- The post's **status tag** — New, Seen, Accepted, In progress, Done,
  Declined — sets the report's status (the bot creates missing tags and
  renames older ones). Replying to a "New" report marks it "Seen". What you do
  from `/stats` or the app is copied into the post.
- **"It's live"**: when a report becomes Done, the bot asks where the fix
  ships (app, website, both); when that version is out, the person is told
  in **My reports** ("Good news: the fix is out…").
- `/delete` (report and post, after a confirmation), `/block` (the person can
  no longer write in it), `/merge into:<other post>` (a duplicate: the person
  is told and gets the other report's status updates).
- Done or Declined posts are archived after a day without activity; a reply
  from the person brings them back.
- `/bug` and `/idea`: any member can report from Discord, with an optional
  `screenshot`. Replies reach them in a direct message (their DMs from server
  members must be open), your screenshots attached as files — also those sent
  from `/stats` or the app, even without text. If Discord refuses the files,
  the text still goes and the post says so. Under each message, **Reply**
  answers with text and **Send screenshots** with up to 3 pictures (JPEG, PNG
  or WebP, stored downsized), shown in the post, on `/stats` and in the app.
  A message typed straight to the bot gets a pointer to those buttons (once an
  hour); the bot keeps nothing of it. 20 replies per hour per person.
- Update order: the **Worker first**, then the bot (`docker compose pull`). An
  older bot keeps working with a newer Worker (no pictures in DMs, as before);
  a newer bot with an older Worker can't store the person's screenshots and
  says so.
- Reports from before the bridge (or whose delivery failed) get their post
  too, oldest first: the original message with its screenshots, then the rest
  of the conversation in one message. A report is never kept longer because
  of it.

**Alerts and daily summary** (a private channel, picked with `/setup`): main
or fallback Worker failing (daily request quota), ntfy notifications paused,
Discord webhook refused, iOS or website CI failing — once when it breaks, once
when it's back. Every morning (9:00 Europe/Paris): reports awaiting your reply,
yesterday's users and notifications, current versions. `/summary` posts it now.
The relay itself can't report its own outage: set the Worker's `ALERT_WEBHOOK`
secret to a webhook of that channel, and the Worker checks the relay and the
bot every 5 minutes.

**Community**: `/announce` shows the developer banner in the app and on the
website (`/announce-clear` removes it). When a new app or website version is
out, a draft of its release notes appears in the private channel — **Publish**
posts it in the announcements channel. New test builds are posted in the test
builds channel, mentioning its role.

Setting it up:

1. **Forum channel**: create a private Forum channel, then *Edit channel →
   Integrations → Webhooks → New webhook*. Put its URL in the Worker's
   `FEEDBACK_WEBHOOK` secret. (A webhook in a text channel still works: one
   message per report, without the bridge.)
2. **Bot**: in the [Discord developer portal](https://discord.com/developers/applications),
   *New Application → Bot*: *Reset Token* (keep it secret) and turn on
   **Message Content Intent**. Invite it with
   `https://discord.com/oauth2/authorize?client_id=<application ID>&scope=bot%20applications.commands&permissions=292057844816`
   (view channels, send messages, send messages in threads, read message
   history, add reactions, manage threads — to set the tags — and manage
   channels — to create them), then allow it in your private channels
   (*Edit channel → Permissions*). Already invited without
   `applications.commands`? Open the link again: the slash commands need it.
3. **Shared secret**: a random string (`openssl rand -hex 32`), in the
   Worker's `FEEDBACK_BOT_SECRET` secret **and** in the relay's `.env`.
4. **Relay**: in its `.env`, `DISCORD_BOT_TOKEN=…` and `FEEDBACK_BOT_SECRET=…`
   (for your own Worker, `FEEDBACK_WORKER=https://…`; for other people allowed
   to answer, `DISCORD_ADMIN_IDS=<Discord IDs, comma-separated>`; optional:
   `FALLBACK_WORKERS`, `SUMMARY_TZ`, `SUMMARY_HOUR`), then
   `docker compose pull && docker compose up -d`. `docker compose logs relay`
   (in the relay's folder) shows `Discord bridge: connected` and `following forum
   “…”`, and `/stats` shows the bot as running.
5. **Channels**: run `/setup` in the private channel (*Alerts, daily summary
   and release drafts*), in the announcements channel (*Release
   announcements*) and in the test builds channel (*Test builds*, with the
   role to mention — make that role mentionable). Optionally, a webhook of
   the private channel in the Worker's `ALERT_WEBHOOK` secret.

Without *manage channels*, create the status tags by hand with those names
(Discord allows 20 tags per forum and 5 per post). The bot keeps its settings
and memory in the Worker's database, nothing on the server's disk, and takes
no new dependency: Discord's gateway over Node's built-in WebSocket, its REST
API, GitHub and the website over `fetch`.

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
| `ADMIN_TWITCH_IDS` | Optional. Your Twitch user ID(s), comma-separated, for the developer tools on `/stats`. Empty: nobody gets them (`/stats` says so once you're logged in). |

Live notifications work too: the container runs the scheduled check itself,
every minute, through an internal route guarded by a random secret drawn at
each start (nobody else can trigger it).

Only the website and `/api` are reachable on the published port: `wrangler dev`
listens inside the container, behind a small front server
(`docker/front.mjs`), so its local tools under `/cdn-cgi/` — the scheduled
trigger, the D1 database explorer — can't be reached from outside. The
wrangler version is pinned in the `Dockerfile`.

Data lives in the `twitchunblock-data` volume. Watching lives, VODs and clips,
the chat (read-only without login), categories and device follows all work
out of the box; logging in needs your own Twitch app (see above). The iOS app
keeps using the official backend.

---

## Credits

Made by [MXFia19](https://github.com/MXFia19).

Thanks to [hls.js](https://github.com/video-dev/hls.js), [BetterTTV](https://betterttv.com), [FrankerFaceZ](https://www.frankerfacez.com), [7TV](https://7tv.app), [recent-messages](https://recent-messages.robotty.de), [Lucide](https://lucide.dev) for the icons and [Inter](https://rsms.me/inter/) for the font.

Independent project, not affiliated with Twitch.
