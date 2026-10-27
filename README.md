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
- **Pinned streamers**: the pin on a followed channel's card (or at the end of its offline row) keeps it at the top of Following; their lives are sorted among themselves by viewers (Settings → **Pinned sorted by viewers**, on by default, kept on the device and not synced; off, the order you pinned them in)
- **Continue watching**: VODs you started, with their progress bar
- Live durations and viewer counts kept up to date (channels followed on this device too, without an account)
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
- **Schedule** tab, only on channels that have one: the next four weeks of planned streams in your device's day and time (12 or 24 h like the chat), with length, title, category, weekly or canceled slots and vacations; an offline channel also shows “Next stream: Tuesday · 8:00 PM” (or its vacation), which opens the tab. Read straight from the browser: Helix `schedule` when logged in, otherwise Twitch's public GQL (one request per week, as Twitch answers only one week per request and channel; the next three only when something is planned), then Helix's public iCalendar export as a last resort (all three allow browser calls, so no Worker route). Kept 10 minutes per channel
- Recent streamers

### Player
- Custom controls built around the chat: fullscreen keeps both the video **and** the chat, laid over it
- Quality picker, including “Auto”, which shows the quality actually in use on the player button (“Auto · 720p”); Auto usually starts higher than before (up to 720p, lives and VODs) and, on lives, climbs back up when the connection allows
- **Preferred quality** (Settings → Player): Auto, Source, 1080p, 720p, 480p, 360p, 160p or audio only, used whenever a live or VOD starts; when a channel doesn't have it, the closest one below is used (the Worker gives each quality's real height, so a 720p60 “Source” counts as 720p). Picking a quality in the player replaces it. Audio only is available for VODs too
- **Higher qualities (1440p and above)**, with the [TwitchUnblock Connect](#twitchunblock-connect-browser-extension) extension 0.2.0 or later (Settings → Player, off by default; without the extension, a line says what's needed). Twitch only serves 1440p and 4K (Enhanced Broadcasting) to logged-in viewers: the playback token every source asks for has no account behind it and says `maximum_resolution: FULL_HD` (`QUAD_HD: AUTHZ_NOT_LOGGED_IN`), and asking for HEVC/AV1 without it brings nothing more (checked on 2026-10-20). The site's own Twitch login (Helix) can't ask for a logged-in playback token, only the twitch.tv session can — which the extension has. So, like the iPhone app's “Higher qualities”, the account's list (`supported_codecs`: H.264, plus HEVC or AV1 only when the browser decodes them in hardware, per `navigator.mediaCapabilities`) is asked for at the same time as the usual source, at most 6 s, and kept only when it goes above 1080p; the quality menu then lists its variants (“1440p60 (Source)”…, `hq.js`). The page can't read Twitch's playlists itself (usher only allows `www.twitch.tv`, the playlists answer 403 to any other `Origin`), so the extension reads them and hands the page a rewritten copy; the video segments come straight from Twitch's CDN, never through the Worker or the relay. Without a sub or Turbo, during a Twitch ad break on the account's stream (pre-rolls included), playback switches to the usual source (1080p at most) without ads, with a notice, then comes back when the account's stream is ad-free again; after two ads in a row, 20 checks, or an error on the account's stream, the usual source stays for that live. Not used for multi-live, downloads or “Open in…”, nor on a device where live segments go through the relay. Twitch serves HEVC and AV1 as fMP4, which hls.js 1.5.20 plays
- Playback speed for VODs and clips (0.25× to 2×, `<` / `>` keys), remembered from one VOD to the next, shown on the ⚙ button (as a badge on phones) and recalled when a VOD starts; lives always play at 1×
- ±10 s, double-tap on mobile, keyboard shortcuts
- Picture in picture, “back to live” button, live latency — never under 4 seconds behind the edge (closer, playback freezes): the target follows how long Twitch takes to publish each segment, and skipping ahead or “back to live” stop there too; clicking the latency also brings you back to live, without reloading. Lives never change playback speed to catch up (the sound drifted away from the picture): the player makes a small jump instead, and never after you rewound on purpose
- **Live sources, in the order you pick**: Luminous Asia, an Albania proxy (TTV.LOL), Luminous Europe and official Twitch (with ads), tried one after the other until one answers — each proxy source with a backup server of its own (Asia: Luminous, then PerfProd Asia; Albania: nadeko's two servers; Europe: Luminous Europe, then Europe 2). The proxies avoid most ads, but not the channel's own ad breaks: Twitch puts its “Commercial break in progress” screen (or an ad) into every source at the same time, mostly for 15–30 s when a stream opens. Reorder them in Settings → Player; picking a source from the player's ⚙ menu (which ticks the one in use) moves it to the top and switches the live to it — your preferred source too, when another one had taken over. When no source answers while the channel is live, the player says so (an offline channel is shown as offline), and it counts as a failure on `/stats`. Channels that stream with multiple encodes (Enhanced Broadcasting) keep each quality's own name on every source
- **Channel ad breaks explained**: when Twitch replaces the live with an ad break, a banner says so with a countdown to the stream's return, and the sound is muted until then (unless you turn it back on). Detected from the live playlist, in Auto as in a fixed quality, and timed on the picture actually shown. The website can't use a Twitch sub to skip them (the iPhone app can, with its web session)
- **Sound after an ad break**: Twitch's “Commercial break in progress” screen doesn't always have the channel's sound format (48 kHz against 44.1 kHz, for example), and the browser could then play the streamer's voice at the wrong speed once the live came back, as if through a voice changer. The player notes the sound format of each new init segment (the `mp4a` box: sample rate, channels, AAC setup) and, when the picture reaches a different format after a break in the stream (`EXT-X-DISCONTINUITY`, around ad breaks — not a quality change in Auto), reattaches the video afresh (`recoverMediaError`), at most once every 8 s; the error log attached to reports says “son du direct : 44,1 kHz stéréo → 48 kHz stéréo”. When the picture freezes right before such a break instead (the live didn't come back after the countdown), the player starts a new hls.js instance after 3 s rather than the usual 30 s; it starts again at the live edge, past the break
- **Lives kept to some countries**: when Twitch keeps a live to a few countries (broadcast rights; the Twitch app says “premium content … geo_blocked”) and no source can reach it, the player says so instead of “no source is answering”. The Worker reads it from its playback token (`geoblock_reason`) or from usher's refusal (`content_geoblocked`) and answers `404` with `code: "geo_blocked"`
- **Theatre mode** (T), keyboard shortcuts anywhere on the page (? lists them)
- **Low latency** (Settings → Player, on by default): the live as close as the player can hold it (about 4 s behind). Off, it stays about 10 s behind, without stutters on a slow connection. On, the margin still grows by itself when the live's playlists go through the video relay or a Worker (+2 s: each refresh is one more round trip, and the buffer used to fall to 1 s) and again when its segments do (+2 s)
- **Sleep timer** in the player's menu (15, 30, 60 or 90 min): playback stops and the player closes, so nothing more is loaded, through the relay either; it carries on from one video to the next
- **Lock screen and media keys** (Media Session): title, channel and picture on a phone's lock screen and in the computer's media controls, with play, pause, ±10 s and, for a VOD or a clip, the position
- **Real time in stream archives**: next to the timer and in the progress bar's tooltip, the time of day each moment was streamed (“1:02:03 · 22:15”); the player's menu has **Go to a time of day** (a time picker, the next day when the stream ran past midnight). Archives only: highlights and uploads don't have the stream's start
- **Clips**: **Full VOD** opens the original VOD at the moment you're watching in the clip, and **Download** saves the clip's MP4 in the quality being played (Twitch's clip CDN allows it)
- **VOD chapters**: game changes marked on the progress bar
- **Muted parts**: passages Twitch muted for copyrighted music show in orange on the progress bar, with a notice and a **Skip** button. For a day or two after a stream, Twitch's CDN still serves the original sound: the site loads it instead, automatically. On VODs stored as fMP4, the parts Twitch lists as `-unmuted.mp4` already have their sound: they're not shown as muted
- **Live ended** screen, and **raids followed** automatically to the target channel (can be turned off)
- Playback errors are retried a few times, spaced out (2, 4, then 8 s), before an error screen with a Refresh button — never an endless stream of requests; while the device is offline, the player waits for the connection to come back. A VOD plays on past a segment Twitch's CDN no longer has (rebuilt or very old VODs) instead of stopping; when its last segments are gone, it plays to that point and ends there (“Play all” moves on to the next video), while a jump or a `?t=` link into the missing part gets the error screen. A `?t=` link or a resumed VOD keeps its starting point when the video relay fails right at the start
- Errors hls.js can't fix itself — a media error back within 30 s of being repaired (repairing it again and again left the picture frozen), a demuxer or internal error — and a live stuck for 30 s without any error (page shown, device online) while its playlist keeps moving get a fresh hls.js instance on the same address, at the same position for a VOD: at most 3 times in 5 minutes, then the error screen. When the playlist itself stops moving — re-read by hls.js, but no new segment for 15 s (the streamer's encoder froze or is reconnecting), or an `EXT-X-ENDLIST` — the player just waits under the spinner, with no timer running, and plays on as soon as new segments show up; the end of the live still comes from Twitch (live-ended screen). Multi-live tiles repair a media error once, then restart; they have no stall watch, so they already wait through a streamer's outage
- **Memory kept in check on long lives**: hls.js keeps at most 30 s behind the playing position on a live (Twitch's live window is 28 s; it used to keep 90 s) and a bounded amount ahead (`bufferConfig` in `player.js`); on iPad and iPhone even less — 10 s behind and 15 s ahead on a live, 20 s behind and 30 to 60 s ahead on a VOD — since a long 1080p live crashed Safari on iPad every 20 minutes or so. Multi-live tiles: 10 s behind, 12 to 30 s ahead. Segment and playlist metadata (ID3, emsg, DATERANGE) are no longer turned into text-track cues nobody reads
- **VODs and lives on Safari for Mac and iPad**: hls.js keeps the video buffer itself (`MediaSource`), no longer Safari's `ManagedMediaSource`. That one asks to stop loading 30 s ahead (`endstreaming`) and to resume under 10 s (`startstreaming`), and hls.js 1.5.17 then stopped everything — request in progress dropped, demuxer torn down and rebuilt, stall and gap watch off — every 20 seconds or so of a VOD: a long VOD ended up stuttering in Safari on a Mac. Safari 27 also stopped sending `startstreaming` after a jump ([WebKit bug 321919](https://bugs.webkit.org/show_bug.cgi?id=321919)), which left the VOD frozen; hls.js itself prefers `MediaSource` since 1.6.19. Lives followed, as a long live on iPad still crashed Safari every few minutes with `ManagedMediaSource`, bounded buffers or not. The iPhone only has `ManagedMediaSource`: there, like hls.js 1.6.19, a stop asked during a jump is ignored, a jump while loading is stopped starts it again, and a resume without a stop before it does nothing (1.5.17 restarted everything)
- **hls.js 1.5.20**, the last of the 1.5 series (same API as the 1.5.17 it replaces), loaded from jsDelivr or cdnjs with its SRI hash (`HLS_INTEGRITY` in `player.js`, the same file on both). Since 1.5.18, a `ManagedMediaSource` stop only suspends segment loading instead of tearing everything down
- **Playback health** in the site's error log (Settings → About, attached to bug reports): each video counts its stalls (playback waiting for data, outside start-up and jumps) and their length, dropped frames, what hls.js fixed on its own (stalls, gaps skipped, nudges, full buffer, segments retried), the player's repairs (in place, new instance, retries, another relay or Worker, missing segments) and `ManagedMediaSource` stops. A bad minute (2 stalls or 3 s waiting, 2% of frames dropped, a gap or full buffer, a repair) writes one line — position, period, those numbers, the buffer ahead and behind, the measured bandwidth against the quality's bitrate, engine and relay —, 5 minutes apart at least and 6 per video at most, plus one when the bug-report sheet opens. The player's line in a report (`player`) adds the totals. Nothing personal: no address, channel or ID
- VODs resume where you left off
- **Two tabs open**: settings and history written in one are read back in place by the other (`storage` event), which used to overwrite them whole with its old values on the next change — the volume was enough — and send the loss to the server and the iPhone
- **Switching accounts in the same browser**: the previous account's synced settings (pins, hidden channels and categories, muted words and people, hidden emotes) are put aside under its name and come back at its next login, instead of being merged into the new account's and sent to it; only a browser never logged in still merges what was set without an account
- **Download a VOD** or just a part of it (from one time to another, from where you are, the next 10 minutes) in the quality you pick: one `.ts` (or `.mp4`) file that plays in VLC, mpv or the Windows player. Parts muted for copyrighted music keep their original sound while Twitch still has it (and always on fMP4 VODs' `-unmuted.mp4` parts). Chrome and Edge write the file straight to disk; other browsers build it in memory (up to about 1.5 GB on a computer, 800 MB on a phone — a download that outgrows its estimate stops with a message instead of crashing the tab). Deleted VODs rebuilt from the CDN can be downloaded too
  A segment Twitch has already deleted (404, 410) is skipped and counted at the end (“… already deleted by Twitch”) instead of losing the whole file, sometimes after gigabytes; when the video relay stops answering, the playlist and the segments go through the Worker
- Mini player: playback keeps going while you browse
- “Open in…” VLC, Outplayer, Infuse, or copy the stream link
- **Share** (under the player): copies the Twitch link of what's playing — a VOD at the current moment (`/videos/<id>?t=1h2m3s`), a live (`/<channel>`), a clip — or the site's own link to the same thing, which the site's router opens at that moment too; a message confirms the copy. On phones, the system share sheet opens instead (`navigator.share`). Not offered for rebuilt (deleted) VODs, which have no address

### Multi-live
- Up to **four videos side by side, lives and VODs mixed**: the “+” on a live or VOD card (or “Multi-live” on a channel page and under the player) adds one, and a bar at the bottom shows your picks
- A live tile picks its quality from its size; a VOD tile plays 1080p alone, 720p with two tiles, 480p beyond — never above your preferred quality. Click a tile to hear it (or 1–4 on the keyboard, M to mute), double-click for fullscreen; the arrow on a tile moves it one place earlier (with three, the first one is the big one)
- **VOD tiles** resume where you left off and save their progress (the VOD joins your history); the tile you hear has its controls: play/pause, ±10 s, time and a seek bar (Space or K, ← →). Others show a thin progress line, and “Watch again” at the end
- On large screens, the chat of the video you hear shows on the right — replayed for a VOD (button in the mosaic, or Settings → Chat → Chat in multi-live)
- Add a channel by name, or a VOD by its link or ID, from the mosaic; open a tile with its chat in the regular player (a VOD at the tile's moment), and **share the mosaic's link** (`/?multi=xqc,v:2345678901`; “Copy” adds each VOD's moment, `v:<id>~<seconds>`; where the browser can't copy, as in Discord's or Instagram's in-app browser, the share sheet opens or the link is shown)
- Live tiles get the same rescue as the player: segments through the relay when Twitch's CDN is blocked, and another relay or Worker when the one serving them stops answering

### Chat
- Connected straight to Twitch IRC — no iframe
- Twitch, **BTTV**, **FFZ** and **7TV** emotes, badges, username colours readable on a dark background. BetterTTV's live connection adds the personal emotes of BTTV Pro users (once BTTV announces them) and the emotes added to the channel during the stream. **GIFs** sent with Twitch's GIF keyboard show in the chat on their own line
- **Click an emote or a badge** (in the chat, the pinned message or someone's card; right-click in the emote picker): a sharp, larger image, its exact name and source, copy it, add it to your message or hide it (see below). Twitch emotes show their type (global, tier 1–3 sub emote, channel points) and the channel they belong to — live or not, one click opens its page — with that tier's other sub emotes; BTTV, FFZ and 7TV emotes show whether they're global or the channel's, who made them, their original name, zero-width (7TV) and modifier emotes, and a link to their page. Badges show their title (“3-Month Subscriber”…), also as a tooltip. Animated FFZ emotes now move, in the chat too
- Recent messages loaded on arrival: you never land in an empty chat
- The chat connects within a few seconds even when an emote or badge source is slow (filtered network, VPN): emotes that arrive later show up in the next messages and in the pinned message. A source that failed (network, server error) is asked again the next time a chat opens
- **Pinned message**: compact banner with badges, emotes, who pinned it and a countdown — collapse it to a chip in the chat's header
- **Drops card**: when the channel runs a drops campaign, a card under the pinned message shows the reward, the watch time, the end date and a link to the details; dismissed, it stays away for that campaign. With the [TwitchUnblock Connect](#twitchunblock-connect-browser-extension) extension, it also shows your progress for each drop and a **Claim** button (0.3.0: and **All my drops**, the Drops page)
- **Predictions** live (read-only — bets with the [TwitchUnblock Connect](#twitchunblock-connect-browser-extension) extension), incoming **raids** and **announcements** highlighted
- **Hype train**, without an account: the “Incoming” card when a channel is one or two supports away from a Hype Train (dots and countdown), the departure, the current level with its real progress bar and time left, a line when a level is completed, and the end of a completed train — in real time in the main chat, every few seconds in the multi-live chat
- Your name and **chosen words highlighted**; **filters**: hide bots, `!commands`, muted words, hide someone
- **Hide an emote**: click it in the chat (or right-click, or long-press — Safari's image menu is turned off there), then “Hide this emote” in its card: it shows as its word from then on, whatever its source (Twitch, BTTV, FFZ, 7TV), in lives and in the VOD chat, the pinned message and people's cards included; it also leaves the emote picker and the autocomplete. Settings → Chat → **Hidden emotes** lists them (latest first), each with its ✕, and “Show all again”. Kept by exact code (case included) in `hiddenEmotes`, 200 at most, the same key as the iPhone app: in the backup and the synced settings
- Chat once logged in: emote and username autocomplete (Tab or a click picks the suggestion — Tab only takes an emote whose name starts with what you typed —, the arrows move through them and Enter then takes the one picked; otherwise Enter sends), emote picker, replies. Your messages show as others see them (display name, badges, `/me`, the Twitch emotes your account can use) and can be replied to once Twitch has accepted them
- **Emote picker tabs**: **Mine**, **This channel** (its BTTV, FFZ and 7TV emotes) and **Global** — only the open tab is drawn; the channel's tab still opens first, and search covers all three without tabs (an emote found higher up isn't repeated). **Mine** comes first once you're logged in to the chat and your account's emote sets are known (the chat's `emote-sets` tag): every Twitch emote your account can use in any chat — the emotes of the channels you're subscribed to, Prime, Turbo and Twitch's global emotes —, one heading per channel with its avatar: the channel you're watching first if you have its emotes, then the others alphabetically, then “Twitch” (sets without a channel, and Prime, Turbo, 2FA, Hype Train… — the 2FA set belongs to an internal Twitch account). Its content comes from the same public GQL requests that already recognised the Twitch emotes of your own messages (`emoteSet(id:)`, 15 sets per request, once per session; `loadOwnEmotes` in `chat/emotes.js`), now with each set's owner and emote type: nothing more is asked, nothing at all without an account, and when Twitch doesn't answer the tab simply doesn't show (asked again after your next message). Smileys (`:)`, `<3`… and their variants, typed as they are) and other channels' follower emotes (usable in their own chat only) are left out; an emote that's also in the channel's tab shows in both
- **Chat restrictions said upfront**: the room's modes above the message box (followers only and for how long, subscribers only, emotes only, slow mode, verified account…), the channel's chat rules to accept before your first message, and a message Twitch refuses removed with the reason, instead of looking sent
- **Banned from a channel's chat**: when Twitch refuses your account in that chat, the chat keeps going read-only without your account (like a logged-out viewer), with a banner in place of the message box and a “Retry with my account” button for when you're unbanned — remembered for that channel until the page is reloaded. A timeout shows a line with its duration
- Click someone to see their latest messages, mention them or reply
- Moderation honoured: deleted messages struck through or removed; a moderator's `/clear` says so in the chat
- Message times (Settings → Chat) in 12 h or 24 h: Auto follows the device's language, or pick one
- Scrolling pauses when you scroll up, with a “new messages” button
- **Chat synced with the video** (Settings → Chat, on by default, like the iPhone app): during a live, a message shows once its arrival time plus the player's delay behind the live edge has passed — that delay minus a 2 s margin (`SYNC_MARGIN` in `chat/view.js`: Twitch viewers who write are a little behind the edge themselves), 60 s at most. The delay is smoothed but follows a stall within half a second (the time spent waiting is added to hls.js's measure until playback resumes); when it drops (Live, +10 s, sync turned off), waiting messages come out in order within a few seconds. Your own messages, notices (server, site) and banners (pinned message, hype train, prediction, raid) never wait; subs, raids and announcements in the chat do, as in the app. Moderation applies to waiting messages; no timer runs while none are waiting. “⏱ −6 s” in the chat's header shows the delay — click it to turn syncing off (struck through) or back on. Both queues are capped (`QUEUE_MAX`, `DELAYED_MAX`): on a hidden page (another tab or app, picture in picture) no frame comes to draw them, and a very busy chat used to pile up thousands of messages there, drawn all at once on return; after a long absence, only the latest 300 are drawn (150 on iPad and iPhone). The Twitch emotes remembered for autocomplete (1,000 most recent) and the names of chatters present (5,000) are capped too
- **Chat memory on long lives**: the list keeps 300 messages (`MAX_NODES` in `chat/view.js`; five times as many while scrolled up) — 150 on iPad and iPhone, like Twitch, since Safari can keep every frame of each animated emote still in the page decoded, and a long live crashed the tab after a few minutes. Only the latest 20 Giphy GIFs stay images (6 on iPad and iPhone; older ones turn back into their text, while you follow the chat), the emote picker draws only its open tab and is emptied when closed (up to 800 emotes, animated ones included, stayed in the page), and the Twitch info of emote cards is kept for the last 100 emotes. The pinned message is measured on the next frame rather than inside its `ResizeObserver` (Safari logged a “ResizeObserver loop”), and the live uptimes of the page under the player are no longer rewritten every second while the player covers it
- **VOD chat**, replayed in sync with the video: after a jump it opens on the messages just before that point (up to 40), and an error from Twitch is retried instead of ending the replay
- **Bot commands** (Nightbot, StreamElements, Fossabot, Moobot) without typing `!commands`: searchable, a click puts one in your message (or copies it when you can't write). A bot that doesn't answer is named (“No answer from …”) and asked again next time, instead of showing “no commands”
- **Bot commands of an offline channel** (the bots' APIs don't depend on the live): a “Bot commands” button on the channel's page, under “Offline”, opens the same searchable list in a sheet, where a click copies the command; the player's chat opened on an offline channel says so and offers them too (header button, or the one in the empty chat)

### Everything else
- **Themes** (Settings → Appearance): light, dark, OLED black or slate background — or your device's — and the app's seven accent colors, applied before the page shows
- French, English, Spanish, Russian and Traditional Chinese (繁體中文, Taiwan wording, contributed by [trend0522](https://github.com/trend0522)) — follows your device language by default; any Chinese browser (zh-TW, zh-HK, zh-CN…) gets Traditional Chinese, the only Chinese the site has. The Russian and Chinese translations were made with AI: the settings say so, with a button to report a mistake. Live notifications come in the site's language, Chinese included, and the usage count keeps the script (`zh-Hant`, like the apps) instead of only two letters
- **Twitch-style links**: replace `twitch.tv` with the site's address — `/xqc`, `/xqc/clips`, `/xqc/about`, `/videos/123?t=1h2m3s`, `/directory/category/just-chatting` — and the browser's back/forward buttons move between pages
- Streams, VODs, clips, categories and channels are real links: middle-click or Ctrl/Cmd + click opens them in a new tab
- **Bug reports & ideas** from the top bar, the settings or the player, screenshots included (pick them or paste with Ctrl+V). **My reports** shows where each one stands (received, seen, accepted, in progress, done, declined) and the developer's reply, and lets you answer back — updated on its own; a banner tells you when the developer replies. A report that's done or declined, with the developer having the last word, is no longer checked (opening it still looks once); answering it brings it back
- **Switch account** in the settings; after logging out, Twitch asks which account to use instead of signing the old one back in
- Logging in without a popup (phones, blocked popups) brings you back to the page you were on, live or VOD included; declining on Twitch's page says so. When Twitch can't be reached as the site opens, you stay logged in with the account last checked on this device, and the login is checked again once the connection is back
- History and progress synced across devices when logged in, merged by date (the most recent first); each Twitch account keeps its own history on a shared device (set aside at logout, back at the next login), and nothing is sent before the backup was read
- **Continue watching can be turned off** (Settings → Continue watching, next to Recent streamers; on by default): this browser then neither saves nor reads where you stopped in a VOD (VODs start from the beginning, or from a link's `?t=`), adds no VOD to its history, and hides the home row and the purple bar on thumbnails. What was already kept stays (it comes back when you turn it on again), and the account's history on other devices isn't touched
- **Synced settings** (Settings → Account → **Sync my settings**, on by default, logged in only): the chat settings (time, deleted messages, bots, commands, hidden words, people and emotes, highlighted words), the top streams language, the VOD speed, pinned channels and hidden channels and categories follow your Twitch account on the website and the iPhone app. One document per account on the Worker (`GET`/`POST /api/sync/prefs`, same Twitch-token check as the backup, 64 KB per send), apart from the history backup — `/api/sync/post`, which the 1.5.0 iPhone app and the Android app keep using, never touches it. It has four parts, each with its own modification date, and the latest one wins part by part: `common` (the settings both have under the same backup name), `pinned`, `hidden` and `ios` (the app's own customisation, kept for its other devices, never read by the site). Not synced, because they depend on the device: the site language, the preferred quality, the usage-count consent, the home list layout, notifications, theme, volume, chat size, live sources and your own Worker. Changes leave a few seconds after the last one, after a read of the server; what comes from the server is applied without being sent back. A device that never changed anything for the account takes what the account has first (its own pinned/hidden lists and hidden chat words or people added, nothing lost); one still on default values never sends them. When both sides changed since the last exchange, pinned and hidden lists are merged against the list of that exchange (something removed on one side stays removed), and settings follow the latest date. A setting added to `common` later (`PREFS_COMMON_ADDED` in `main.js`, so far `hiddenEmotes`) doesn't count as a change on a device that still has its default value: otherwise the first visit with the new version dated that device's `common` from now and overwrote what the app had put there. Turning the switch off sends and applies nothing on that device
- **Live notifications**: a notification when a channel you follow goes live, even with the site closed — on a computer, as long as the browser is running (Settings → Notifications, with a test button). The settings say whether they're on for this device, and for how many channels (the number the Worker actually keeps) — up to 500: pinned channels and the ones followed on this device come first, then the account's; logging out stops them for the account's channels right away. **Notified channels** (same place) lists the followed channels with a switch each: the ones turned off are never sent to the Worker, and a channel followed later is on by default. A lost or replaced browser subscription is picked up again on the next visit (if the browser refuses, the settings say to turn the switch off and on again), and changing the site's language changes the notifications' language. On iPhone and iPad, install the site first (iOS 16.4 or later, see below)
- Anonymous usage count, shown in the settings (see below)
- Mobile-first layout: bottom tab bar, settings sheet, landscape view; clicking the tab you're already on (or the logo, from Discover) smoothly scrolls back to the top
- **Installable as an app** (PWA): an icon on the home screen or desktop, the site in its own window without the browser bar, and live notifications even when it's closed (on a computer, as long as the browser is running). **Settings → Install the app** shows the steps for your device, with an Install button when Chrome or Edge offer it (hidden once installed, and on plain-HTTP self-hosting, where browsers allow neither installing nor notifications). The title bar follows the chosen background
  - **iPhone / iPad**: in Safari, Share (or the ⋯ menu) → Add to Home Screen, keep “web app” on if offered, then open it from the icon and turn notifications on (iOS 16.4 or later)
  - **Android**: browser menu ⋮ → Install app / Add to Home screen
  - **Chrome / Edge on a computer**: the install icon in the address bar, or the browser menu → Install
  - **Safari on Mac** (macOS Sonoma or later): File → Add to Dock
  - **Firefox**: use Chrome or Edge to install it; notifications still work while Firefox is open

---

## TwitchUnblock Connect (browser extension)

The website can't use your Twitch web session: twitch.tv's login cookie is out of any other site's reach, and the site never asks for it. **TwitchUnblock Connect** is a small extension for desktop browsers (Chrome and other Chromium browsers, Firefox) that keeps that session on its side and does a short, closed list of things for the site — mostly in the main player, during a live (not the multi-live tiles, not VODs):

- **Channel points while you watch**: a “minute watched” every 60 s while the live plays (a hidden tab counts, a paused player doesn't), like the iPhone app. Your balance — with the channel's own points name and icon — and your watch streak show at the top of the chat
- **Bonus chests**: claimed on their own (“+50” in place of the balance for a moment), or with a click on the gift when *Claim automatically* is off in the extension
- **Channel rewards**: a click on the balance lists the channel's custom rewards (cost, color or image), greyed out when you're short on points or when one is paused, out of stock or on cooldown (with the time left). Picking one asks for a confirmation (title, cost, the streamer's prompt, and your message when the reward needs one, 200 characters at most) before anything is spent
- **Drops**: the drops card shows your progress for each drop of the campaign (bar, minutes watched), what's claimed and a **Claim** button. While a live with drops plays, the extension moves them forward every 10 s the way the iPhone app does (reading the stream's playlist, without downloading the video), claims them itself when *Claim automatically* is on, and the site says “Drop claimed: …”
- **Predictions**: the prediction card gets an amount box with quick amounts (10, 100, 1,000, max), the outcome buttons, then a confirmation (amount and outcome) before anything is sent; your bet shows on the card, then whether it won. One outcome per prediction, as on Twitch
- **Twitch polls**: a card with the choices, their share and a vote button; extra votes paid with channel points (cost shown, confirmed first) when the channel allows them
- **Raids**: joined as soon as the channel announces one, for the raid bonus (“Raid bonus” in the raid banner); following the raid works as before, and an error never stops it
- **Higher qualities (1440p and above)**, from version 0.2.0: Settings → Player → *Higher qualities*, off by default. On channels streaming above 1080p (Enhanced Broadcasting), the live goes through your account, with a switch to the usual source during Twitch's ad breaks if you have neither a sub nor Turbo (see [Player](#player))
- **Ad-free with your sub** (0.3.0): Settings → Player → *Ad-free with my subscription*, on by default. When Twitch serves no ads to your account on that channel (you're subscribed, or have Turbo and the channel accepts it: `hide_ads`, or `show_ads` false, in the account's playback token — never Turbo alone), the whole live goes through your account, in the usual qualities (1440p and above only with *Higher qualities* on), with no ad break at all. A notice says so the first time
- **Last resort** (0.3.0, works with 0.2.0 too): when no live source answers while the channel is live (or the Worker can't be reached), the live plays through your account by the extension, with its ads unless you're subscribed
- **Follow / unfollow** (0.3.0): a **Follow** button next to the live's title follows the channel with your twitch.tv account (Twitch removed following from its public API); **Following** unfollows it after a confirmation. The site's followed list follows
- **Drops to link** (0.3.0): a campaign whose game account isn't linked gets a link to link it instead of **Claim** (claiming it could lose the reward)
- **Clip** (0.3.0): a **Clip** button next to the live's title clips the live with your account, at the moment the player shows (the live is a few seconds behind Twitch), like the iPhone app; a sheet then gives the clip's link (copy, open on Twitch, where its title and length are set). One clip per 10 s; a channel that doesn't allow clips says so
- **Drops page** (0.3.0): Settings → TwitchUnblock Connect → **My drops**, or **All my drops** in the chat's drops card: every campaign of your account — the started ones with your progress, then those not started yet (once the extension holds a Twitch integrity token) —, with the game's box art, the dates, **Claim**, and the link when a game account must be linked
- **Account events live** (0.3.0): while a tab of the site is visible or a live plays, the extension keeps Twitch's own event connection for your account (Hermes, as twitch.tv does): points earned (“+10” in place of the balance), chests (claimed right away with *Claim automatically*), prediction results (“Bet won: +2,500 points”) and drops (progress, claimed, ready, to link) arrive as they happen, and the player re-reads points and drops only every 5 min. Settings → TwitchUnblock Connect says whether they're live; if Twitch refuses that connection to the extension, everything is re-read every minute as before
- **Same account on both sides**: when the extension's twitch.tv account isn't the one logged in on the site, bets, votes, rewards, follows and clips are refused by the site (they would go to another account than its follows and chat), and the extension's section in Settings says so

Without the extension, with its connection to the site turned off, or on a phone, the player shows nothing more. When it's installed but the browser isn't logged in to twitch.tv, a line in the chat says so.

**Install**: download `twitchunblock-connect-chrome.zip` (Chrome, Edge, Brave) or `twitchunblock-connect-firefox.zip` from the [latest release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest), then follow the [install steps](extension/INSTALL.md) (the developer notes are in [`extension/README.md`](extension/README.md)). The website's **Settings → TwitchUnblock Connect (extension)** says whether it's installed (and which version), connected (`@login`), missing a Twitch session or turned off, with the link to install it.

**Updates**: installed by hand, the extension never updates itself. The site knows the latest published version (`CONNECT_LATEST` in `public/assets/js/connect.js`): when the extension it detects — connected, or with its connection to the site turned off — is older, a discreet line at the top of every page says “TwitchUnblock Connect 0.2.0 is available (you have 0.1.0)”, with the download link and, under *How to update?*, the steps of the [install guide](extension/INSTALL.md) for that browser (Chrome, Edge, Brave: replace the folder's content, then reload the extension; Firefox: load the new zip again). Once closed, it stays away until the next version (remembered in the browser); nothing shows without the extension or once it's up to date. `CONNECT_LATEST` must equal the version in `extension/manifest.json`: `node extension/dev/check-site-version.mjs` fails otherwise. It runs in the *Extension* workflow, before the release, and in the *Docker image* workflow, as a job of its own that doesn't hold the image back — so a new version of the extension and the site's line ship together.

**Security**
- The Twitch session cookie and the integrity token never leave the extension's background: not to the page, not to its content script, not to TwitchUnblock's servers. The site sends nothing about it to the Worker or the relay; the usage count only gets the extension's version and browser, or that it's missing (see [Usage count](#usage-count)).
- The page and the extension only talk through `window.postMessage` to the page's own origin; each side drops anything from another window, another origin or another protocol. The content script only runs on the official website, top frame only (the repository's `extension/` folder, loaded by hand for tests, also has the test branch's preview; the published packages don't, nor the `tabs` permission since 0.3.0).
- A closed list of operations, every argument checked on both sides (channel login, amounts from 1 to 250,000…): no free GQL request, no generic relay. Every answer is checked again by the site before use; a malformed one is an error, never a guess.
- Spending points (bets, paid poll votes, rewards) and voting need a real click: the site sends the request inside the click on **Confirm**, **Vote** or **Redeem**, and the extension refuses it otherwise, or when *Bets, votes and rewards from the site* is off. Its settings are only changed in its own window, never by the page.
- Since 0.3.0, **one real click per spend**: the content script keeps the page's trusted clicks (`isTrusted`, which no page script can fake); a spend, a follow or a clip needs one less than 5 s old and not already used — the browser's activation, true for a few seconds after any click, used to let several through
- **Content-Security-Policy** (a `<meta>` tag in `public/index.html`, so it holds on Vercel and in Docker): only the site's own scripts, hls.js from its two CDNs, and, by their SHA-256, the page's two inline scripts and the three `onerror` handlers the scripts write into the HTML; no plugins (`object-src 'none'`), no `<base>` (`base-uri 'none'`). `node tools/csp-check.mjs` checks it (`--fix` rewrites it), and the *Docker image* workflow runs it
- The extension limits the pace itself (reads at most once per 3 s per channel, one minute watched per 50 s, one drops pulse per 8 s, one clip per 10 s, 60 requests a minute in all; the higher-qualities playlists on their own budget, 240 a minute, read from Twitch at most once a second each).
- The account's events (0.3.0) come from Twitch's Hermes, to which only the extension connects, with the session; the page gets a closed list of numbers and ids (balance, gain, chest claimed, prediction result, drop progress), checked by the content script and again by the site.
- Higher qualities (0.2.0) are the one thing more that reaches the page: the account's live playlists, **rewritten** by the extension — playback tags, ad breaks without Twitch's tracking attributes, and the addresses of the video segments on Twitch's CDN. The playback token, the usher address and the playlists' own addresses stay in the extension; the page only gets a random id per quality, valid for that Twitch session (6 h at most). A segment address gives a few seconds of that live and nothing about the account. No `declarativeNetRequest`: the page gets no right to read Twitch by itself.

Messages, operations, error codes and limits: [`extension/PROTOCOL.md`](extension/PROTOCOL.md). On the site's side, `public/assets/js/connect.js` is the bridge (detection, requests, time limits, answers checked), `public/assets/js/chat/connect-live.js` the player and chat part, `public/assets/js/hq.js` the higher qualities and `public/assets/js/connect-update.js` the update line; `node tools/connect-check.mjs` checks the bridge — the update line and what the usage count gets included — and `node tools/hq-check.mjs` the higher qualities, with a fake window, a fake extension and a fake player (no browser, no network).

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
      i18n.js        Translations (Russian in i18n-ru.js, Traditional Chinese in i18n-zh-Hant.js)
      store.js       History, progress, preferences (localStorage)
      util.js        Escaping, formatting, icons
      connect.js     TwitchUnblock Connect: bridge to the browser extension
      hq.js          Higher qualities (1440p+) through the extension, ad-break fallback
      connect-update.js  Its “new version available” line
      chat/          Chat: IRC, emotes, badges, pinned message, hype train, VOD replay,
                     the extension's points, rewards, bets, polls, raids and drops (connect-live.js)
extension/           TwitchUnblock Connect, the browser extension (README.md, PROTOCOL.md)
worker.js            Backend: Cloudflare Worker
wrangler.toml        Worker configuration
docker/relay.mjs     Video relay for your own server (same proxy as the Worker)
docker/discord-bot.mjs  Discord bot (feedback, alerts, releases), run by the relay
docker/healthcheck.mjs  Container health check (site or relay)
relay/               Its docker-compose.yml and Caddyfile (HTTPS)
tools/reports.mjs    Reads bug reports (and their screenshots), suggestions and the bot's to-do list from the owner's computer, and marks them done (reports key)
tools/connect-check.mjs  Checks of the extension bridge (Node, no browser or network)
.github/workflows/   Docker image (docker.yml), extension packages and release (extension.yml), daily database backup (d1-backup.yml)
vercel.json          Website configuration on Vercel
```

The website is plain JavaScript (ES modules) — no framework, no build step.

---

## How it works

```
Browser ──► Cloudflare Worker ──► Twitch (playlists, video segments), proxy sources (Luminous, TTV.LOL)
    │
    ├──► Twitch GQL     public data: streams, channels, VODs, VOD chat, schedules
    ├──► Twitch Helix   logged-in account: followed channels, schedules (public iCalendar export as a fallback)
    ├──► Twitch IRC     live chat (WebSocket)
    ├──► Twitch Hermes  real time: raids, predictions, hype train, viewers, stream end
    └──► BTTV / FFZ / 7TV / recent-messages   emotes and chat history
```

Video always goes through the Worker — or through your own [video relay](#video-relay-on-your-own-server-vps): Twitch's VOD CDN only accepts requests coming from `twitch.tv`, so a direct link would be blocked by the browser. The Worker also stores history backups, the usage count and announcements (Cloudflare D1).

The iOS app uses the same Worker.

**Live notifications** (Web Push): the browser subscribes with its push service (Apple, Google, Mozilla, Microsoft) and hands the Worker its delivery address, its keys and the followed channels. Every 2 minutes (Cron Trigger, every minute with the check every other one), the Worker asks Twitch which of them are live — 100 channels per GQL request, 1,200 per check; beyond that, the checks take turns, each one reading the next 1,200 channels from where the previous one stopped (a cursor kept in D1, back to the start at the end of the list), so up to 2,400 every channel is read at least every other check (about 4 minutes) — and a channel that just went live queues a notification for each of its followers, sent encrypted (RFC 8291) and signed (VAPID, keys created on first use and kept in D1). The number of runs doesn't depend on the number of subscribers. On the free plan a run gets about 10 ms of CPU and a notification costs about 0.7 ms, so they leave from a queue, about 480 an hour; the $5 plan lifts that. Web and ntfy notifications each read their own part of the queue through an index. Expired subscriptions are forgotten; every 6 hours the Worker also forgets ntfy topics the app hasn't heard from in 60 days and channels nobody follows any more.

The iOS app can't use Apple's push service (it needs a paid developer account), so it goes through [ntfy](https://ntfy.sh): the app creates a secret topic, the user subscribes to it in the free ntfy app, and the same scheduled check publishes a message there, in the subscription's language, with the live's thumbnail (attachment), the channel's picture (icon, shown by ntfy's Android app) and a **Watch** button (`twitchunblock://live/<channel>` opens the stream in the app, like a tap on the notification). Topics the app hasn't refreshed for 60 days are dropped.

ntfy.sh's free tier counts messages per IP address (250 a day). Every Cloudflare Worker sends from the same shared addresses, so ntfy.sh answers them `429 Too Many Requests`. The Worker therefore hands its ntfy messages to the [video relay](#video-relay-on-your-own-server-vps) (`NTFY_RELAY` in `wrangler.toml`), which publishes them from its own address. Messages leave in one batch per run (12 at most, ntfy.sh's pace of one request every 5 seconds), signed with the Worker's VAPID key: the relay checks the signature against the Worker's public key (`/api/push/key`) and refuses anything else, so no secret needs to be shared. After a `429` the Worker stops sending to ntfy for 5 minutes, or until midnight UTC (when ntfy.sh resets its counters) once the daily quota is reached; the app's **Test** button says so. That quota is shared by every user of the app, so daily caps kept in D1 protect it: the **Test** button only works for a topic the app has already subscribed (5 tests a day per topic, 40 in all), new topics are capped (5 a day per IP address, 10 per network — a `/48` in IPv6 —, 40 in all), each topic gets at most 30 live notifications a day, and all topics together at most 200 (below ntfy.sh's 250 with the tests), of which topics younger than 3 days get 100 at most — so new topics can't use up the day for everyone and trigger the pause (without `NTFY_TOKEN` only). Web notifications and ntfy messages are read from the queue separately, so neither can hold up the other. While the relay is down, messages wait in the queue (30 minutes at most): there is no fallback to sending directly, which ntfy.sh would refuse anyway. The relay logs one line per batch (`docker compose logs relay`). With `NTFY_TOKEN` (a paid ntfy account, counted per account rather than per address) the Worker publishes directly, like the Docker image does from your own server.

**Channel points relay** (apps): every minute, the app sends Twitch a *minute-watched* event — what credits channel points — at the analytics address read in the channel's page (`spade_url`, today `https://spade.twitch.tv/track`). Ad blockers and filtering DNS often cut that address, and then nothing is credited; the app can then send it through the Worker:

```
POST /api/spade
Content-Type: application/json
{ "url": "<spade_url>", "data": "<base64 of the JSON events>" }
```

The Worker sends it again the way the app does — `POST url`, body `data=<base64>` as `application/x-www-form-urlencoded`, an iPhone Safari User-Agent, redirects not followed — and answers `200 { "ok": true, "status": <Twitch's HTTP code> }`, `400` when the address is refused or the data is invalid, `429` for too many sends, `502` when Twitch can't be reached. It is not an open proxy (see [Security](#security)) and costs no D1 read or write. The [Docker image](#self-hosting-with-docker) has it too.

### Security
- **History backups and synced settings are private**: every read or write must carry the owner's Twitch token. The Worker has Twitch confirm it and checks it belongs to that account — knowing someone's (public) Twitch ID is no longer enough.
- **The proxy only relays Twitch and the proxy sources** (`ttvnw.net`, `jtvnw.net`, `twitch.tv`, `twitchcdn.net`, `luminous.dev`, exactly `twitch-al.nadeko.net`, `twitch.nadeko.net` and `lb-as.cdn-perfprod.com`, and on `cloudfront.net` only Twitch's own VOD distributions — a new one is accepted once Twitch itself points to it), over HTTPS — it is not an open proxy. Redirects are followed one by one (4 at most), each new address checked the same way. What comes back is served as media with only the headers a player needs, never as a web page (`nosniff`, sandboxing CSP).
- **The channel points relay** (`POST /api/spade`) only sends to Twitch's analytics addresses — over HTTPS, host `spade.twitch.tv` or `video-edge-<…>.<…>.abs.hls.ttvnw.net`, no credentials, no port, a path (query included) of 2,000 characters at most — and only what the apps send there: base64 (8 KB at most) of a JSON list of 1 to 5 `minute-watched` events. Anything else gets `400` before any request; redirects aren't followed. 20 sends a minute per address (a `/64` in IPv6), counted in the instance's memory: no D1 read or write (one write a minute per viewer would eat the free quota), and nothing about the user is logged, errors included. CORS headers like the other `/api` routes: a browser can post to Twitch's address directly anyway.
- Usage pings only accept random UUIDs and store no IP address.
- Rate limits (feedback, replies, pings, notifications) count an IPv6 address by its `/64` block. Screenshots attached to feedback have a daily share per person (address or Discord account, counted in one of 65,536 anonymous buckets: no address is stored), per network (`/48`) and a daily cap for the whole Worker, and stop before the D1 database fills up; the message itself still goes through, and the website says the screenshots weren't kept.
- Per-address limits only hold in one Worker instance's memory, and a free IPv6 `/48` holds 65,536 `/64`s, so whatever writes to D1 also has daily caps kept in D1, for the whole Worker and per network: feedback (300 new reports a day, 30 per network; 1,000 replies a day; no new report or reply once the database passes 400 MB), Discord suggestions (one every 10 minutes per person, 5 a day per person, 50 a day in all, within the 300 reports) and their votes (5,000 a day, 60 an hour per member), new anonymous installs counted (1,000 a day, 100 per network), votes and reactions (2,000 a day per poll or announcement, 40 new devices per network), followed channels for live notifications (only the difference is written: 2,000 changes a day per subscription, 3,000 per network, 10,000 in all, and 1,000 channels new to the server a day). Over a cap the answer is `429` (an install is just not counted), and a cap already reached refuses without writing anything.
- The Discord bot's actions on the Worker all carry the shared secret (`FEEDBACK_BOT_SECRET`); `/live` and `/top` go through at most 120 Twitch lookups a minute, `/my-reports` and `/suggestions` 30 a minute per member — and as each of those two reads every report in D1, the bot keeps their answers 60 seconds (`/suggestions top` the same for everyone, `/my-reports` per member; read again once that member sends something or votes). `/api/open/live` (the **Open in the app** button) only takes a valid Twitch name and only redirects to `twitchunblock://live/<name>`.
- The developer tools only accept Twitch tokens issued to the official website and apps (or to `TWITCH_CLIENT_ID`): a token of the owner's account issued to another Twitch app doesn't open them.
- **Admin log**: every admin action — from `/stats`, the apps or Discord: deleting, closing or merging a report, replies and statuses, announcements, polls, erasing someone's data… — and everything done with the reports key (reading the reports or the bot's to-do list, a report's new status, to-do cards marked done or reopened) is kept 90 days (who, what, when, from where) and listed at the bottom of the developer tools on `/stats`.
- **Reports on the developer's computer** (`/api/admin/reports`, `tools/reports.mjs`): opened only by the `REPORTS_KEY` secret (constant-time check, 10 wrong keys an hour per address); it reads, and makes two changes only — a report's status (exactly as in `/stats`) and marking the Discord bot's to-do cards done or open again —: no reply, no deletion, no merge (a new status reaches the person just as after `/stats`). It never returns contacts, install IDs, addresses or tokens, and screenshots only one at a time, as a download checked to be a JPEG, PNG or WebP image; the same route and key (and nothing else but the bot's own secret) read the Discord bot's copy of its to-do list, with the Discord links of its cards' attachments (the files themselves never go through the Worker) — see [Reading reports from your computer](#reading-reports-from-your-computer).
- **Erasing someone's data** (`/stats` → developer tools, or `/forget-user` on Discord): shows what will go first — with the Twitch account found, ID and current username —, then erases exactly that; the admin log only notes what kind of data went and how much, nothing that identifies the person — see [Discord bot](#discord-bot-feedback-alerts-releases), *Operations*.

---

## Usage count

To know whether people actually use the website and the apps, each browser (and each iPhone or Apple TV app install) sends a small signal to the Worker at most once an hour. Numbers are public at **[/stats](https://twitchunblock.vercel.app/stats)**: unique people today, over 7 and 30 days (each one counted once per period), iOS app vs Apple TV app vs website (someone seen on several counts once: the iPhone first, then the Apple TV), logged-in accounts vs anonymous, new vs returning people, active people per day, retention (back after 1, 7 and 14 days), live health (which source served each live, failures, channel ad breaks seen), devices and languages, the TwitchUnblock Connect extension (people who have it, by version and by browser), and live notifications.

| Sent | Never sent |
|---|---|
| Logged out: a random ID generated in the browser | Channels watched, history |
| Logged in: your Twitch token, so the Worker counts your **account** once across all your devices (its Twitch ID and username are kept, visible to the site owner only) | IP address (not stored by the Worker) |
| The website version, `web` or `ios` | |
| The interface language, the device type (phone or computer; iPhone or iPad) and, from the app, the iOS major version | Titles, searches |
| How many lives and VODs were started since the last signal: which source served each live, how many failed, how many channel ad breaks were shown — counters only | |
| From the website: whether the [TwitchUnblock Connect](#twitchunblock-connect-browser-extension) extension is there — its version and its browser (Chrome, Firefox, other) —, or that it's missing | The extension's settings, your Twitch session |

**The extension on `/stats`**: someone counts once per period (today, 7 and 30 days) by the last day the website saw the extension — kept apart from their last visit, so an account that has it on a computer but not on its phone stays counted, and the phone's signals rewrite nothing —, then by version and by browser (the last ones seen). The Worker only keeps a version of the form `0.1.0` and a browser among `chrome`, `firefox` and `other`; when the extension has never been seen, it notes that the website looked for it, which gives how many people active over 30 days report it at all (website 2026.10.25c and later). No extra D1 read or write per signal: the extension rides along in the person's usage entry, which is still only written when something in it changes — once a day as before, plus the first time that day the website sees the extension when the person's first signal of the day came from elsewhere (an app, another browser), and when its version or browser changes.

Not counted: automated browsers and bots, copies of the site outside the official domain, private windows that can't keep the ID, visits shorter than 15 s. Keys expire on their own after 35 days. Anyone can turn it off in the settings, which also deletes their entry from the server.

**Live notifications** on `/stats` come from the Worker's own tables, not from the signal above: subscribers (website by push service — Apple, Google, Mozilla, Microsoft — and iOS app through ntfy), new ones today and over 7 days, channels watched and how many are live right now, notifications waiting, the ntfy route (relay or direct) with today's messages against ntfy.sh's 250 a day and any pause, and notifications sent per day with the last 7 days' totals (lives detected, tests, failures, refusals, expired subscriptions). Counts only: no channel name, nothing per subscriber. Channels watched and live ones come from the latest checks (at most one round of checks old), the average number of channels per subscriber from the last 6-hourly cleanup.

The Twitch accounts in `ADMIN_TWITCH_IDS` (the site owner's) get developer tools on `/stats` (delete entries, reset, erase someone's backup and synced settings); the Worker checks the token on every admin request.

**Announcements** (developer tools on `/stats`): one at a time, for everyone, the iPhone app only, the website only, or **outdated iPhone apps** — those before a build number you give (1.6.0 = 352, see the releases on GitHub), read from the app's own request (`TwitchUnblock/<build> CFNetwork/…`, its default User-Agent, which even old versions send: no app update needed). A link to `https://twitchunblock.vercel.app/?update=ios` opens the website's **Update the iPhone app** window, which says what to do for each installer (AltStore, SideStore, Feather, LiveContainer, StikStore and TrollApps through altdirect; ESign, GBox, Scarlet, KSign with the source address or the IPA; TrollStore, Sideloadly with the IPA) — the app opens it too when it finds neither Feather, SideStore nor AltStore.

Raw numbers: `GET https://test2.kurzmathis4.workers.dev/api/stats`. They are computed at most once every 10 minutes for everyone (the page shows when): each computation reads every usage entry, and D1's free plan allows 5 million rows read a day. **Refresh** on `/stats` with the owner's account recomputes them at once (`?fresh=1` with the admin token).

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
The `DB` D1 database (history backups, synced settings, usage count, announcements, feedback) is declared in `wrangler.toml`; the Worker creates its table on first use.

Optional settings, in the Cloudflare dashboard under *Workers & Pages → your Worker → Settings → **Variables and Secrets*** — the block near the top of Settings, **not** the one inside the *Build* section (build variables are never visible to the running Worker):

| Name | Type | What it does |
|---|---|---|
| `FEEDBACK_WEBHOOK` | Secret | Discord webhook address: each bug report, idea and reply is posted there, screenshots attached. In a **forum** channel, each report gets its own post, where its replies land too. `/stats` shows whether the last delivery worked and has a **Test Discord delivery** button. |
| `FEEDBACK_BOT_SECRET` | Secret | Optional. Shared secret (32+ random characters) of the [Discord bot](#discord-bot-feedback-alerts-releases): the same value goes in the relay's `.env`. Without it, the bot's route is off. |
| `REPORTS_KEY` | Secret | Optional. Key (32+ characters: `openssl rand -hex 32`) for [reading reports from your computer](#reading-reports-from-your-computer) with `tools/reports.mjs` — and marking them done: a report's status, the bot's to-do cards; nothing else. Without it, `/api/admin/reports` doesn't exist (404). |
| `ALERT_WEBHOOK` | Secret | Optional. Webhook of a private Discord channel: every 5 minutes the Worker checks the [video relay](#video-relay-on-your-own-server-vps) (`NTFY_RELAY`) and the Discord bot, and posts there when one goes down or comes back. |
| `ADMIN_TWITCH_IDS` | Text | Twitch user ID(s) of the site owner, comma-separated, for the developer tools on `/stats`. Optional: without it, the Worker uses `OFFICIAL_ADMIN_TWITCH_IDS` from `wrangler.toml` (the official Worker's owner; a different name, so a dashboard variable or secret never clashes with it on deploy). For your own Worker, set this or change `OFFICIAL_ADMIN_TWITCH_IDS`. With neither, nobody gets the tools. |
| `SITE_ORIGINS` | Text | Website address(es) whose usage pings are counted, comma-separated. |
| `TWITCH_CLIENT_ID` | Text | Optional. Client ID of your own website's Twitch app (its `twitchClientId`). The developer tools only accept Twitch tokens issued to the official website and apps; set this so tokens from your own site's login work too. |
| `NTFY_TOKEN` | Secret | Optional. Access token of a **paid** [ntfy](https://ntfy.sh) account, for the iOS app's live notifications: ntfy.sh counts free use per IP address (250 messages a day), which the Worker's shared Cloudflare addresses don't get — hence the relay below. A paid account is counted per account (2,500 a day for $6/month) and lets the Worker publish directly. A free account changes nothing. |
| `NTFY_RELAY` | Text | Set in `wrangler.toml`: the [video relay](#video-relay-on-your-own-server-vps) that publishes the iOS app's ntfy messages (see [How it works](#how-it-works)). For your own Worker, point it to your own relay (with `NTFY_WORKER` set there) or remove it. |

`wrangler.toml` sets `keep_vars = true`, so deploying again doesn't wipe the ones set in the dashboard. It also declares the Cron Trigger (every minute) behind the live notifications, and binds the deployed version (`version_metadata`), which the [Discord bot](#discord-bot-feedback-alerts-releases) compares with GitHub — nothing to set up.

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

### Database backup (daily)

[`.github/workflows/d1-backup.yml`](.github/workflows/d1-backup.yml) exports
the Worker's D1 database every night (03:23 UTC, `wrangler d1 export
--remote`), encrypts it (`gpg --symmetric`, AES-256) and keeps it 14 days as
an artifact of the workflow run. Artifacts of a public repository can be
downloaded by anyone signed in to GitHub: only the passphrase protects them.
During the export (a few seconds for a small database), D1 doesn't serve other
queries. Each secret only reaches the step that uses it: the Cloudflare token
the export (wrangler and its npm dependencies), the passphrase the encryption
(gpg alone, through its standard input); the plain dump is then erased, and
only the encrypted file is uploaded.

Repository secrets (*Settings → Secrets and variables → Actions*):

| Name | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token (*My Profile → API Tokens → Create Token → Custom*) with **Account → D1 → Edit** on the Worker's account only (exporting needs write access). Its own token, not the Discord bot's. |
| `CLOUDFLARE_ACCOUNT_ID` | That account's ID (*Workers & Pages*, right-hand column). |
| `BACKUP_PASSPHRASE` | A long random passphrase (`openssl rand -base64 32`). Keep a copy outside GitHub (a password manager): without it, the backups can't be read. |

Without them, the workflow stops with a notice instead of failing. Run it once
by hand (*Actions → D1 backup → Run workflow*) to check it.

**Restoring**

1. Download the artifact (*Actions → D1 backup →* the run *→ Artifacts*) and
   unzip it.
2. Decrypt it (asks for the passphrase):
   ```bash
   gpg --output backup.sql --decrypt d1-twitchunblock-YYYY-MM-DD.sql.gpg
   ```
3. Import it into a **new, empty** database (the dump creates its own tables),
   from a clone of the repository:
   ```bash
   npx wrangler d1 create twitchunblock-restored
   npx wrangler d1 execute twitchunblock-restored --remote --file backup.sql
   ```
   Then put the new `database_id` in `wrangler.toml` (`[[d1_databases]]`) and
   push it to `main`: the Worker deploys with the restored database. The old
   one stays untouched until you delete it.

**Or, without a backup — D1 Time Travel**: D1 can bring the database back to
any minute of the last 7 days (30 on the paid plan), in place:

```bash
npx wrangler d1 time-travel info twitchunblock --timestamp=2026-10-20T03:00:00Z
npx wrangler d1 time-travel restore twitchunblock --timestamp=2026-10-20T03:00:00Z
```

`restore` prints a bookmark of the state it replaced: `npx wrangler d1
time-travel restore twitchunblock --bookmark=<it>` undoes it.

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
you host yourself. The website reloads when the Worker changes. The personal
Worker is only set here: a backup file never exports or imports it (an
imported file only brings back a fixed list of settings, each one checked).

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
3. Check that `https://myrelay.duckdns.org/health` answers
   `{"ok":true,"relay":"ok",…}` — with the image's commit (`version`) and,
   once the [Discord bot](#discord-bot-feedback-alerts-releases) is set up,
   its connection (`discord`). It answers 200 as long as the relay runs;
   `ok` turns `false` when the bot is stopped or disconnected for more than
   5 minutes, and `docker ps` then shows the container as `unhealthy`
   (the video relay keeps working).
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
private networks, the Docker network, the cloud metadata service, also when
written as IPv6 (mapped, NAT64, 6to4, Teredo) — even if a name or a redirect
points there. Failed requests are logged (`docker compose logs relay`).

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
  Done —, "Already fixed", "Can't reproduce"). The server owner is pinged
  for a new report, once every 10 minutes at most. Links in reports show no
  preview.
- The post's **status tag** — New, Seen, Accepted, In progress, Done,
  Declined — sets the report's status (the bot creates missing tags and
  renames older ones). Replying to a "New" report marks it "Seen". What you do
  from `/stats` or the app is copied into the post.
- **"It's live"**: when a report becomes Done, the bot asks where the fix
  ships (app, website, both, Apple TV app, Android app); when that version is
  out, the person is told in **My reports** ("Good news: the fix is out…").
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
  says so, and its `/live`, `/top`, `/my-reports` and `/suggest` answer with
  an error until the Worker is updated.
- Reports from before the bridge (or whose delivery failed) get their post
  too, oldest first: the original message with its screenshots, then the rest
  of the conversation in one message. A report is never kept longer because
  of it.
- Suggestions sent with `/suggest` (see *For everyone*) are ideas with a
  title: they get their post too, named "💡 Suggestion · title", tagged
  **Suggestion** (the bot creates that tag if it can, next to the status
  tags), with a link to their public card. Replies, statuses, quick replies,
  `/merge`, `/delete` and `/stats` work as for any report; the card follows
  the status. Deleting the suggestion (`/delete`, `/stats` — one report or
  *Erase all* —, `/forget-user`) deletes its card too, with the author's
  name, avatar and text: like the posts deleted in `/stats`, it goes through
  the bot's trash, and the bot first checks the message is one of its
  suggestion cards (that suggestion's, or one already without buttons).

**Alerts and daily summary** (a private channel, picked with `/setup`): main
or fallback Worker failing (daily request quota), ntfy notifications paused,
Discord webhook refused, iOS or website CI failing — once when it breaks, once
when it's back; and, at start, a reports forum that looks visible to everyone.
Every morning (9:00 Europe/Paris): reports awaiting your reply, yesterday's
users (iOS, web, Apple TV, Android) and notifications, current versions.
`/summary` posts it now.
The relay itself can't report its own outage: set the Worker's `ALERT_WEBHOOK`
secret to a webhook of that channel, and the Worker checks the relay and the
bot every 5 minutes.

**Operations** (same private channel; each alert once a day at most, or once
per version):

- **Daily caps at 80%**: new reports, replies, new installs counted, ntfy
  topics and tests, ntfy live notifications, followed-channel changes, poll
  votes and announcement reactions, report screenshots — the Worker's own
  limits (see [Security](#security)): past them, more are refused until
  midnight UTC.
- **Database at 70%** of D1's 500 MB (free plan); reports stop at 400 MB.
- **Scheduled task silent for 5 minutes** (live notifications, relay watch),
  then back.
- **Cloudflare free quotas at 70%** — Worker requests (100,000 a day), D1 rows
  read (5 million) and written (100,000), for the main Worker's account — when
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are in the relay's `.env`
  (below). Without them, this check is off.
- **"VPS not up to date"** when the relay's image is behind GitHub for its own
  files (`worker.js`, `docker/`, `Dockerfile`), **"Worker not up to date"**
  when `worker.js` changed on `main` after the deployed version — checked
  every 30 minutes with GitHub's public API, said 30 minutes after the delay
  is first seen (the time to build and deploy).
- `/status` (developer only): main and fallback Workers, database size, ntfy
  messages sent today against ntfy.sh's 250 and any pause, notification queue,
  the scheduled task's last run, relay and Worker versions, how long the bot
  has been connected, and the Cloudflare quotas when set — in one message,
  ending with the 5 D1 queries that read the most rows today (UTC): the start of
  each query, rows read and calls (D1 query insights, same token; if Cloudflare
  refuses, one short line says so).
- `/forget-user who:` (developer only) erases a person's data, after showing
  what will go: for a **Twitch account** (`@name` or numeric ID) its backup,
  synced settings and usage entry; for an **install ID** (random ID of an app
  install or a browser) its usage entry, poll votes and announcement
  reactions; **reports** (their `fb_…` key, or the link or ID of their
  Discord post; or a `@Discord user`, for what they sent with `/bug`, `/idea`
  or `/suggest`, and their suggestion votes) with their screenshots,
  conversation, Discord post, public card (a suggestion's) and the votes
  they got; **notification
  subscriptions** (the iOS app's ntfy topic, `tu-…`). Reports and
  subscriptions aren't tied to an account or an install, so name them too.
  Up to 10 at once, separated by spaces. The preview shows the Twitch account
  it found — numeric ID and current username — and confirming erases that
  very account, by its ID: the username isn't looked up again, so it can't
  have moved to someone else in between (erasing without a preview takes IDs
  only). Same tool on `/stats`. Both go to the admin log with only what kind
  of data was erased and how much (and who erased it, from where, when) —
  never whose it was; same for erasing a backup and synced settings.
- What the bot does for the developer (replies, statuses, deletions, merges,
  announcements, polls, `/setup`, published release notes) goes to the
  [admin log](#security) with the member's name.

**Community**: `/announce` shows the developer banner in the app and on the
website (`/announce-clear` removes it). `/app-announce post text: [duration]
[link] [title]` does the same from the command line, with the same fields,
limits and durations as `/stats` (title 80 characters, message 500, `https://`
link, 1 minute to 30 days — `30m`, `6h`, `3d`…, 24 hours by default): it
first shows a preview only you see — with the announcement it would replace —
and nothing goes out before **Publish** (**Cancel** drops it; a preview lasts
15 minutes). `/app-announce clear` removes it. Publishing and removing go to
the admin log, as from `/stats`. When a new app or website version is
out, a draft of its release notes appears in the private channel — **Publish**
posts it in the announcements channel, mentioning the release role if you
picked one. Members take or drop that role with `/release-pings` or the
**🔔 Release pings** button the bot posts there — so anyone can get it: the
bot refuses a role managed by an integration, with permissions, or allowed
into a channel. New test builds are posted in the test builds channel,
mentioning its role.

**For everyone** (answers only the person sees, in their Discord language
when it's French, Spanish or Russian, English otherwise; what the bot posts
in a channel stays in English):

- `/roles`: a menu of the roles on offer, the person's own ticked; ticking or
  unticking, then closing the menu, adds and removes them one by one (only
  those that changed; the person's other roles are never sent back), and the
  bot says what worked ("+A −B") and what didn't. One change every 5 seconds
  per person. The
  developer picks the roles with `/roles-config add role: [description]
  [emoji]` (again to change them), `remove` and `list`; the release pings
  role is always in the list. Only safe roles are taken, and they're checked
  again each time one is given: not managed by an integration, without
  permissions, not named in any channel's permissions, below the bot's own
  role. A role that stops being safe is no longer shown nor given, and the
  alerts channel is told (once a day). `/roles public:True` (developer only)
  posts a permanent message in the channel — the list with its descriptions
  and the same menu, where nothing is ticked: picking a role there gets it,
  or drops it if you had it, with an answer only you see. Posting it again
  replaces the previous one; it follows `/roles-config` and `/setup` changes.
- `/download`: every way to install — iPhone and iPad (the source for
  AltStore, SideStore or Feather, which also lists TU Test; the latest IPA),
  Apple TV (ATVLoadly sources: test builds, and stable releases once their
  source exists), Android (the APK releases, saying when there are only test
  builds so far), the website. `public:True` (developer only) posts it in the
  channel.
- `/version`: latest versions — iPhone app and TU Test, Apple TV (test, and
  stable once its source exists), Android, website — read from the raw
  source files and the public releases API on GitHub (no token) and from the
  website, kept 10 minutes; one that can't be read shows as unknown.
- `/help`: the commands useful to the person (the developer's too, for the
  developer).
- `/live channel:` (a name, `@name` or a twitch.tv link): if the channel is
  live, its title, category, viewers, uptime and thumbnail; otherwise
  "offline" with when its last live started. `/top [category] [language]`:
  the 10 biggest lives right now, of a category (found by its name, like the
  website's search) and a language if given, with a menu that opens one of
  them like `/live`. Both have buttons to the channel's page on the website
  and **Open in the app** — Discord only takes http(s) links, so it points to
  the Worker's `/api/open/live?channel=<name>`, which checks the name and
  redirects (302) to `twitchunblock://live/<name>` (no button when
  `FEEDBACK_WORKER` isn't an `https://` address). The data comes from the
  Worker (Twitch's public GQL, like the website), kept 60 seconds per channel
  or search; one new lookup every 5 seconds per person.
- `/suggest`: a form (title, description). The suggestion becomes a report
  (in the forum, `/stats` and `/my-reports`; the developer's replies come in
  a direct message, as for `/bug`) and a public card in the suggestions
  channel (`/setup`; without one, the channel where `/suggest` was used, if
  the person can write there — no card in a read-only channel):
  **👍 N** to vote — one vote per member, tapping again takes it back, counted
  by the Worker — and **Planned**, **Done**, **Declined** for the developer
  (the report's status — Accepted, Done, Declined —, so the post's tag, the
  card and a direct message to the author). One suggestion every 10 minutes
  per person, 5 a day per person, 50 a day in all. `/suggestions top`: the 10
  most voted open suggestions, with a link to their card — the same answer
  for everyone for 60 seconds, read again sooner after a vote, a new
  suggestion, a status change or a deletion.
- `/my-reports`: what the person sent with `/bug`, `/idea` and `/suggest`
  (only theirs: the bot takes their Discord ID from the command, never from
  an option) — short title, date, status, votes, a link to the card and, for
  those who can open the private forum, to the post. Kept 60 seconds per
  member (votes others give may show up to a minute late), read again once
  they send something or vote.

**Welcome messages** (`/setup use: Welcome messages for new members` in the
channel; *Stop the welcome messages* to turn them off): each newcomer gets a
message in English that mentions only them, with **Download** (the `/download`
answer), **Pick roles** (the `/roles` menu, when roles are offered) and
**Help** (`/help`) — answers only they see, in their language. No message for
bots; members who join within a few seconds of each other share one message;
more than 10 arrivals in a minute (a raid) means no message at all until 10
minutes after the last one, and the alerts channel is told once. This needs
the privileged **Server Members Intent** (step 2 below): the bot only asks for
it while a welcome channel is set. If it isn't enabled, Discord refuses the
connection (code 4014): the bot reconnects without it, turns the welcome off
and says so once in the alerts channel — enable the intent, then run `/setup`
again in the welcome channel.

**To-do**: right-click a message (long-press on mobile) → *Apps* → **Add to
to-do** sends a good suggestion to the to-do channel — author, text, a link to
the message, with a **Done** / **Reopen** button — and adds 📝 to the original
message. For several messages at once (a conversation), use **Add
conversation to to-do** on its *first* message: the bot answers (for you only)
with a menu of the next 24 messages; pick the *last* one, and a single
**Conversation** card holds them all — who said what, one line per message
(texts shortened together to fit the card, bots' messages left out), the
number of attachments, and links to the first and last messages. `/todo
text:` adds an item by hand. Developer only. The bot keeps a copy of the list
in the Worker, read from the owner's computer with
[`tools/reports.mjs --todo`](#reading-reports-from-your-computer); cards can
also be marked done or reopened from there (`--done`, `--reopen`): the
Worker keeps each request in the bot's memory (`todo_actions`), and every 2
minutes — and before each read of the channel — the bot updates those cards
exactly like their **Done** / **Reopen** button (a card it can't find in the
to-do channel is dropped and noted once in its log).

Setting it up:

1. **Forum channel**: create a private Forum channel, then *Edit channel →
   Integrations → Webhooks → New webhook*. Put its URL in the Worker's
   `FEEDBACK_WEBHOOK` secret. (A webhook in a text channel still works: one
   message per report, without the bridge.)
2. **Bot**: in the [Discord developer portal](https://discord.com/developers/applications),
   *New Application → Bot*: *Reset Token* (keep it secret) and turn on
   **Message Content Intent** — and, for welcome messages only, **Server
   Members Intent** (same page, *Privileged Gateway Intents*; past 100
   servers it needs Discord's approval, not a concern for one server). Invite it with
   `https://discord.com/oauth2/authorize?client_id=<application ID>&scope=bot%20applications.commands&permissions=292326280272`
   (view channels, send messages, send messages in threads, read message
   history, add reactions, manage threads — to set the tags — manage
   channels — to create them — and manage roles — to give the release role
   and those of `/roles`; the bot's role must sit above them), then allow it
   in your private channels (*Edit channel → Permissions*). Already invited without
   `applications.commands`? Open the link again: the slash commands need it.
3. **Shared secret**: a random string (`openssl rand -hex 32`), in the
   Worker's `FEEDBACK_BOT_SECRET` secret **and** in the relay's `.env`.
4. **Relay**: in its `.env`, `DISCORD_BOT_TOKEN=…` and `FEEDBACK_BOT_SECRET=…`
   (for your own Worker, `FEEDBACK_WORKER=https://…`; for other people allowed
   to answer, `DISCORD_ADMIN_IDS=<Discord IDs, comma-separated>`; optional:
   `FALLBACK_WORKERS`, `SUMMARY_TZ`, `SUMMARY_HOUR`, and the two below), then
   `docker compose pull && docker compose up -d`. `docker compose logs relay`
   (in the relay's folder) shows `Discord bridge: connected` and `following forum
   “…”`, and `/stats` shows the bot as running.
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (optional, Cloudflare
     quota alerts): a token made in *My Profile → API Tokens → Create Token →
     Custom* with only **Account → Account Analytics → Read**, limited to the
     main Worker's account, and that account's ID (*Workers & Pages*,
     right-hand column). Read-only: it can't change anything. Not the same
     token as the database backup's.
5. **Channels**: run `/setup` in the private channel (*Alerts, daily summary
   and release drafts*), in the announcements channel (*Release
   announcements*, optionally with the role to mention at each release), in
   the test builds channel (*Test builds*, with the role to mention) and in
   the to-do channel (*To-do list*). Make the roles mentionable. Optionally:
   the public suggestions channel (*Suggestions*), the welcome channel
   (*Welcome messages for new members*, once the Server Members Intent is on),
   and a webhook of the private channel in the Worker's `ALERT_WEBHOOK`
   secret. The bot must be able to send messages with embeds in the
   suggestions and welcome channels.

Without *manage channels*, create the status tags by hand with those names
(Discord allows 20 tags per forum and 5 per post). The bot keeps its settings
and memory in the Worker's database, nothing on the server's disk, and takes
no new dependency: Discord's gateway over Node's built-in WebSocket, its REST
API, GitHub and the website over `fetch`.

### Reading reports from your computer

`tools/reports.mjs` lists the bug reports and suggestions on the owner's
computer — and, with `--todo`, the Discord bot's to-do list; with `--photos`,
it downloads a report's screenshots, and with `--files`, the attachments of a
to-do card's original message —, so the coding assistant reads (and sees)
them directly instead of having them copied by hand, and marks what it fixed
as done itself. It calls `/api/admin/reports` on the Worker with a dedicated
key, `REPORTS_KEY`, which reads them and makes two changes only: a report's
status, and to-do cards marked done or open again.

Setup, once:

1. Create a key, straight into its file so it never shows on screen (Git Bash
   on Windows has `openssl`):
   `mkdir -p ~/.twitchunblock && openssl rand -hex 32 > ~/.twitchunblock/reports-key`
   — that is `%USERPROFILE%\.twitchunblock\reports-key`, one line. (Or run
   `openssl rand -hex 32` and paste the result alone in that file, or in the
   `TU_REPORTS_KEY` environment variable.)
2. Cloudflare dashboard → *Workers & Pages* → the Worker → *Settings* →
   *Variables and Secrets* → *Add* → type **Secret**, name `REPORTS_KEY`,
   value: the same key (the content of that file).
3. Run `node tools/reports.mjs`.

The route only exists once the Worker is deployed from `main` with it; until
then, or without the secret, it answers `404` like an unknown address (the
Docker image doesn't set the secret: the route stays off there).

```bash
node tools/reports.mjs                 # open bug reports (newest first), then suggestions by votes
node tools/reports.mjs --all           # finished ones too (done, declined, merged)
node tools/reports.mjs --since=7d      # active in the last 7 days (30m, 24h, 2w, or a date: 2026-10-13)
node tools/reports.mjs --kind=bug      # bug | idea | suggestion | other | all
node tools/reports.mjs --platform=ios  # ios | web | tvos | android | discord
node tools/reports.mjs --id fb_…       # one report with its whole conversation
node tools/reports.mjs --json          # the Worker's answer as it is (JSON)
node tools/reports.mjs --todo          # the Discord bot's to-do list: open items, newest first
node tools/reports.mjs --todo --all    # … then the 50 latest done ones (--json: the answer as it is)
node tools/reports.mjs --photos fb_…   # the screenshots of a report and of its replies, saved to report-photos/fb_…/ in this repository
node tools/reports.mjs --files <id>    # the attachments of a to-do card's original message (id shown by --todo; "all": every open card), saved to report-photos/todo-<id>/
node tools/reports.mjs --done fb_…,<id>  # marks done: reports (fb_…, status “Done”) and to-do cards (ids shown by --todo), mixed, comma-separated
node tools/reports.mjs --reopen <id>   # to-do cards open again
node tools/reports.mjs --status fb_… --to progress  # another status: seen | accepted | progress | done | refused
```

Also `--limit=N` (200 at most) and `--url=<Worker>` (or `TU_WORKER_URL`;
default `https://test2.kurzmathis4.workers.dev`). Node 18 or later, no
dependency. The key is never printed, not even partly (errors included), and
only travels over HTTPS (plain `http://` only to this computer, for tests).

**Screenshots** (`--photos fb_…`): the tool reads the report's conversation
(`id`), then asks for each picture by its number (`view=photo`) and saves it
to `report-photos/fb_…/` at the root of this repository, wherever the tool
is run from (ignored by git; `--out=<folder>` for another one), named after
the message and the number (`msg00-user-photo0.jpg`: the report itself,
`msg03-dev-photo5.png`: the developer's reply #3), then prints
the paths it wrote. Only JPEG, PNG and WebP images are written, checked from
their first bytes on both sides: the Worker refuses anything else (`415`) and
the tool checks again; a picture that's missing or refused is listed, the
others are still saved (exit code 2). One D1 read per picture.

**The to-do list** (`--todo`): the Discord bot keeps a copy of its to-do
channel in the Worker (its memory, key `todo_mirror`) — only the cards it
posted there (*Add to to-do*, *Add conversation to to-do*, `/todo`), open and done. It reads the channel
again (its last 500 messages) a few seconds after an add, a **Done** or a
**Reopen** (once for a burst of clicks), when it connects and every 15
minutes — so cards deleted or edited by hand follow —, and only writes the
copy when something changed (and once after a restart): one D1 write per
change, no read. `--todo` reads it through the same route and key
(`?view=todo`): for each item its type (to-do, suggestion or conversation),
open or done, date (for a suggestion, the quoted message's; for a conversation,
its first message's), author (for a conversation, everyone in it), who added
it, text (a conversation's transcript), number of attachments, the card's
Discord link and the original message's (for a conversation, its first and
last messages', and how many messages). All open items (300 at most) and the
50 latest done ones, texts cut at 1,500 characters (4,000 for a conversation);
but the copy holds 400,000 characters at
most (20,000 for the rest of the bot's memory), so a long list first gets
shorter texts (down to 80 characters), then leaves its oldest items out, done
ones first — counted in `omitted`, and the tool says so (`partial`: more than
500 messages in the channel). The date at the top is the copy's last change. A
card deleted in Discord leaves the copy at the next read.

**To-do attachments** (`--files <id>`, or `--files all`): the files stay on
Discord. For the 40 latest open cards that have some, the bot reads the
original message (a conversation's messages, in one request) and copies each
attachment's name, size, type, picture size and link (`cdn.discordapp.com` or
`media.discordapp.net`). Discord signs those
links for about 24 hours, so the bot reads the message again when less than 6
hours are left (15 messages at most per read of the channel; a message it
can't read — deleted, or in a channel the bot can't see — is retried every 30
minutes and noted once in its log). The Worker only passes links of that form,
30 per card at most. `--todo` shows each card's id and its attachments; the
tool then downloads them straight from Discord, without the key, to
`report-photos/todo-<id>/` (`--out=<folder>` for another one), named `file1.png`,
`file2.mov`… (extension from a closed list, `.bin` otherwise: nothing the user
wrote becomes a file name), 25 MB per file and 200 MB per run at most. An
expired link is refused before any request.

**Marking things done** (`--done`, `--reopen`, `--status … --to …`, which
can go together): every key or id is checked before any request (unknown
formats are refused, and so is the same card in both `--done` and
`--reopen`), then the tool prints what changed, report by report and card by
card.
- A **report** (`fb_…`) changes status at once, exactly as from `/stats`:
  the person sees it in the app or on the website, duplicates merged into it
  follow, and its Discord post gets `📌 Status: … (from the developer's
  tool)` — the bot sets the post's tag and, for *Done*, asks where the fix
  will ship (the person is told when it's live) — like after `/stats`.
  Already in that status: nothing changes. The tool shows the status before
  and after.
- A **to-do card** (an id from `--todo`): the Worker doesn't talk to
  Discord. It keeps the request in the bot's memory (`todo_actions`: one per
  card — the latest wins —, the 100 latest), and the bot applies it within 2
  minutes exactly like the card's **Done** / **Reopen** button, then the
  `--todo` copy follows. The tool says what the copy knows of each card
  (text, open or done) and how many requests are waiting — and warns when
  one has been waiting for more than 10 minutes (bot stopped or not up to
  date?). A card the bot can't find in the to-do channel is dropped, noted
  once in its log.

The tool can't reply to anyone, delete or merge anything: the route doesn't
take it. With a Worker from before this (no `POST`), it says so plainly.

The route itself, `GET /api/admin/reports` with `Authorization: Bearer <key>`:

| Parameter | Values |
|---|---|
| `id` | One report (`fb_…`) with its whole conversation; the other parameters are ignored |
| `kind` | `bug`, `idea` (Discord suggestions included), `suggestion`, `other`, `all` (default) |
| `status` | `open` (default: not done, declined or merged), `all`, or one status: `new`, `seen`, `accepted`, `progress`, `done`, `refused` |
| `platform` | `ios`, `web`, `tvos`, `android`, `discord`, `all` (default) |
| `since` | ISO date or duration (`30m`, `24h`, `7d`, `2w`): reports created, answered or changed since then |
| `limit` | 50 by default, 200 at most: newest reports first, `more: true` when others are left |
| `view` | `reports` (default), `todo`: the bot's to-do list instead — `{ at, items, omitted?, partial? }`, the other parameters are ignored —, or `photo` with `id` and `n` |
| `n` | With `view=photo`: the number of a screenshot (`photoNumbers` of a message, 0 to 999). The picture itself, as a download (`Content-Disposition: attachment`, `Cache-Control: no-store`, `nosniff`, a CSP that runs nothing), only if its bytes are a JPEG, PNG or WebP image — the type noted when it was sent isn't trusted (`415` otherwise); `404` when there's no such picture. One D1 read |

Each report comes with its key, kind, platform, app version and build,
creation and last-activity dates, status, title, message, conversation (who —
user or developer —, text, date; in a list the last 5 messages, cut at 600
characters, all of them with `id`), votes for a suggestion, the number of
screenshots and, for each message, their numbers (`photoNumbers`; the
pictures themselves only one at a time with `view=photo`), the technical info shown before sending
(device, system, browser, page without its query string…) and the attached
error log. Never: the contact (e-mail, Discord account), install ID, IP
address, token or its hash, Discord links (only the to-do list has some: its
cards and the messages they quote, which open only for the server's members).

`POST /api/admin/reports`, same key, JSON body — the only two changes:

| Body | What it does |
|---|---|
| `{ "action": "status", "key": "fb_…", "status": "done" }` | `done`, `refused`, `accepted`, `progress` or `seen` (not `new`): the status change of `/stats` (above). Answers `{ ok, key, status, previous, unchanged, kind, suggestion, title, dups }`; `404` for an unknown report. One D1 read before the change |
| `{ "action": "todo", "ids": ["<card id>", …], "done": true }` | 1 to 100 card ids (digits), `done: false` to reopen: queued for the bot (one D1 write, in place: a request arriving meanwhile, or one the bot is removing, is never lost). Answers `{ ok, done, cards: [{ id, known, wasDone, type, text }], mirrorAt, pending, oldest }` — what the bot's copy says of each card (one D1 read) and how many requests are waiting |

Any other action (reply, delete, merge…) gets `400`.

The key is checked in constant time; a wrong one gets `401`, and after 10
wrong keys within an hour from one address (a `/64` in IPv6), that address
gets `429` until the hour is over. Besides those two changes it opens
nothing — no reply, deletion or merge, not the `/stats` tools — and neither
a Twitch token nor the bot's secret opens this route. Everything goes to the
admin log, from *feedback key* (in `/stats`): `reports.read` (filters and number of
reports, nothing personal), `todo.read` for the to-do list (number of
items), `reports.photo` for a screenshot (the report and the number),
`report.status` for a status (the report and its new status), `todo.done` /
`todo.reopen` for cards (their ids). One D1 query per read, stopped at
`limit`; votes are only counted for the suggestions returned. Outside this
route, only the bot reads its copy of the to-do list and its requests (with
its own secret, `FEEDBACK_BOT_SECRET`). To revoke the key, delete or change
the secret.

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
| `TWITCH_CLIENT_ID` | Optional. To log in with Twitch, create an app on [dev.twitch.tv/console](https://dev.twitch.tv/console) with `PUBLIC_URL/` as the redirect URL, and paste its Client ID. Its tokens are also the ones the developer tools accept. |
| `ADMIN_TWITCH_IDS` | Optional. Your Twitch user ID(s), comma-separated, for the developer tools on `/stats`. Empty: nobody gets them (`/stats` says so once you're logged in). |
| `TRUST_PROXY` | Optional. Set it to `1` only if the container sits behind your own reverse proxy (Caddy, nginx…) that appends the visitor's address to `X-Forwarded-For`: rate limits then count the last address of that header. Default (empty): the address of the connection itself, and any address a client claims (`X-Forwarded-For`, `CF-Connecting-IP`) is ignored — behind a proxy without this setting, all visitors share the proxy's limits. |
| `ALLOWED_ORIGINS` | Optional. Websites allowed to play video through your instance from a browser (`/api/proxy`), comma-separated; `*` inside a name stands for any part of it (`https://preview-*.example.com`). Empty: your own site (`PUBLIC_URL`, or whatever address you open it with) and the official website, which can use your instance as its *Personal Worker*; `*`: anyone. Other websites get a `403`, as on the [video relay](#video-relay-on-your-own-server-vps); apps and players that send no `Origin` (iOS, Android, VLC) aren't affected. |
| `SITE_DEFAULTS` | Optional. Default settings for your visitors, as a JSON object with the same names as the site's backup file (Settings → Backup), for example `{"lang":"en","homeList":true,"vodProgress":false,"qualityPref":"1080","shareUsage":false}`. Each value is checked like an imported backup (a wrong name or value is ignored), and applies to the settings a browser has never saved: the site saves them on the first visit, so a visitor keeps those values afterwards, and can still change them in Settings. Not valid JSON, or not an object: ignored, with a line in the container's log. |

Live notifications work too: the container runs the scheduled check itself,
every minute, through an internal route guarded by a random secret drawn at
each start (nobody else can trigger it). The front server fires it (no extra
process), and while no channel is followed for notifications the check is a
single database read: no write, no outside request.

Only the website and `/api` are reachable on the published port: `wrangler dev`
listens inside the container, behind a small front server
(`docker/front.mjs`), so its local tools under `/cdn-cgi/` — the scheduled
trigger, the D1 database explorer — can't be reached from outside. The
wrangler version is pinned in the `Dockerfile`.

The [channel points relay](#how-it-works) (`POST /api/spade`) is there too,
the same `worker.js` behind the same front server: *minute-watched* events
sent to your instance leave from your server's address. Its limit (20 a
minute) counts each address like the other limits: behind your own reverse
proxy, set `TRUST_PROXY`, or every viewer shares the proxy's.

The image has a health check (`docker ps` shows `healthy`): `/api/ping` for
the website, `/health` for the relay. Both `docker-compose.yml` files set
`init: true`, so a small init process forwards `docker stop` and cleans up
finished processes.

**Security.** The image is based on Debian 13 (`node:22-trixie-slim`) and only
runs Node: npm, corepack and yarn are removed once wrangler is installed, so
image scanners (Trivy, Grype) no longer report their dependencies. Both
`docker-compose.yml` files also set `no-new-privileges` and drop every Linux
capability (`cap_drop: ALL`); nothing in the container needs one (it runs as
the unprivileged `node` user, on ports above 1024). With an older compose
file, download the new one once to get these two settings. Every new image is
started by GitHub Actions with these settings, and the build fails if the
website, `/api/ping` or the relay's `/health` doesn't answer.

**Resource use.** With nobody watching, the container makes no outside
requests (with live notifications on: one Twitch request every 2 minutes per
100 followed channels). Memory sits around half a gigabyte, mostly
`wrangler dev` (Node) and its two `workerd` processes — the Worker, and
wrangler's own proxy in front of it. Video goes through the container: a VOD
costs about 1.5–3.5 GB per hour, received and sent again; a live stream only
its playlists, unless the browser can't reach Twitch's CDN (see
[Video relay](#video-relay-on-your-own-server-vps)). `docker stats` shows
network totals since the container started, not a rate: compare two readings
a few minutes apart. Once an hour, if anything was served, the log sums it up —
requests, video, MB sent, and how many addresses on the local network and on
the Internet, none written down (`docker logs twitchunblock | grep trafic`;
behind your own reverse proxy, only with `TRUST_PROXY`). Logs are capped at
3 × 10 MB (`logging` in `docker-compose.yml`).

Data lives in the `twitchunblock-data` volume. Watching lives, VODs and clips,
the chat (read-only without login), categories and device follows all work
out of the box; logging in needs your own Twitch app (see above). The iOS app
keeps using the official backend.

---

## Credits

Made by [MXFia19](https://github.com/MXFia19).

Thanks to [hls.js](https://github.com/video-dev/hls.js), [BetterTTV](https://betterttv.com), [FrankerFaceZ](https://www.frankerfacez.com), [7TV](https://7tv.app), [recent-messages](https://recent-messages.robotty.de), [Lucide](https://lucide.dev) for the icons and [Inter](https://rsms.me/inter/) for the font.

Traditional Chinese translation by [trend0522](https://github.com/trend0522).

Independent project, not affiliated with Twitch.
