# TwitchUnblock Connect — site ↔ extension protocol (v1)

Reference document shared by the extension (`extension/` folder of the web repository)
and the site (`public/assets/js`). Both sides MUST follow it to the letter. A copy lives
in `extension/PROTOCOL.md`.

The protocol stays at version 1: extension 0.2.0 adds two operations to it
(`hq.master`, `hq.playlist`, higher qualities). The site only asks for them from an
extension that announces 0.2.0 or later (`version` of `hello`); 0.1.0 would answer
`unknown_op`.

## Security principles

- The Twitch session (`auth-token` cookie) and the `Client-Integrity` token NEVER leave
  the extension's background: not to the page, not to the content script, not in a log,
  not on disk. `auth-token` is read again from the cookies on every use; the integrity
  token lives in `storage.session` (memory only, not readable by content scripts).
- The account's playback token (`streamPlaybackAccessToken` obtained with the session),
  the usher address that carries it and the addresses of the live's playlists don't
  leave the background either. Since 0.2.0, one thing more goes to the page: for higher
  qualities (1440p and above), **the content of the account's live playlists,
  rewritten** (`hq.playlist`), that is the addresses of the video segments (and of the
  initialization file) on Twitch's CDN, with the playback tags (durations, sequence
  numbers, dates, ad breaks). Why: Twitch only serves 1440p to an account's playback
  token, and the page can read neither usher (no CORS header for its origin) nor the
  playlists (refused, 403, as soon as a foreign Origin header is present) itself; the
  segments, it can (CDN open to any origin, no cookie). A segment address gives at most
  a few seconds of that live, nothing about the account; a variant's opaque id is only
  good for asking the extension for its playlist, as long as the same session is logged
  in (6 h at most). The rest of the playlists (`X-TV-TWITCH-*` attributes of ad breaks:
  ad tracking and signed addresses; triggers, playback session, IP address of the master
  playlist; unknown tags) stays in the extension. No `declarativeNetRequest`: the page
  gets no right to read Twitch by itself.
- The site can only ask for a CLOSED LIST of operations (below). No free GQL request,
  no generic relay.
- The content script is only injected on the allowed origins, top frame only
  (`all_frames: false`):
  - `https://twitchunblock.vercel.app/*` (production)
  - `https://test2-git-test-17d298-mxfia19s-projects.vercel.app/*` (Vercel preview of
    the test branch, protected by Vercel login)
  Nothing else: no `*.vercel.app`, no localhost.
- The background checks everything again: `sender.id === runtime.id`, origin of
  `sender.url` in the list above, `sender.frameId === 0`, types and bounds of every
  argument.
- Operations that spend points (`predictions.bet`, `polls.vote`, `rewards.redeem`):
  refused if the “Bets, votes and rewards from the site” setting is off, or if
  `navigator.userActivation.isActive` is false when the content script receives the
  request (it must follow a real click by the user). The site also shows its own
  confirmation (amount, choice) before sending. A spend is never sent to Twitch more
  than 30 s after the request (beyond that: `timeout`), so that the answer arrives
  before the site's 45 s.
- Settings are only changed in the extension's window, never by the page.

## Transport

Page ↔ content script: `window.postMessage(msg, location.origin)`. Each side ignores any
message where `event.source !== window`, `event.origin !== location.origin`, or
`msg.tuConnect !== 1`. Content script ↔ background: `runtime.sendMessage`.

- Request (page → extension):
  `{ tuConnect: 1, dir: "req", id: "<string ≤ 64 chars>", op: "<op>", args: { … } }`
- Response (extension → page):
  `{ tuConnect: 1, dir: "res", id, ok: true, data: { … } }`
  or `{ tuConnect: 1, dir: "res", id, ok: false, error: { code: "<code>", message: "<short text, optional>" } }`
- Announcement (extension → page), sent by the content script when it loads, and again
  when a setting changes in the extension's window:
  `{ tuConnect: 1, dir: "hello", protocol: 1, version: "<extension version>", enabled: <bool> }`

Detection on the site's side: listen for announcements, and send `hello` at 0 s, 0.5 s,
1.5 s and 3 s as long as no answer has arrived. Timeout per request: 15 s (45 s for an
operation that may have to get an integrity token: `points.claim`, `watch.beat`,
`predictions.bet`, `polls.vote`, `raid.join`, `drops.claim`, `drops.pulse`,
`rewards.redeem`, `hq.master`).

After an install or an update of the extension, the content script is injected again
into the site's tabs that are already open; the old one (orphaned under Chrome) no
longer answers.

## Operations (closed list)

`channel` = the channel's Twitch login, `^[a-z0-9_]{1,25}$` (the site lowercases it).

1. `hello` `{}` → `{ protocol: 1, version, enabled, browser: "chrome" | "firefox" }`
2. `status` `{}` → `{ enabled, session: { login, userId } | null, settings: { autoClaim, allowSpend } }`
3. `points.get` `{ channel }` →
   `{ channelId, balance, claimAvailable, pointsName: string | null, pointsIconUrl: string | null, watchStreak: number | null }`
   (`watchStreak`: watch streak on this channel, same request as iOS
   `BatchGetWatchStreaks` in `LiveEventsService.swift`; `null` if unknown)
4. `points.claim` `{ channel }` → `{ claimed: <points earned or null>, balance }`
   (the background re-reads the available chest itself; error `no_claim` if there is none)
5. `watch.beat` `{ channel }` → `{ live: bool, balance: number | null, claimed: number | null }`
   Sends the “minute-watched” event like the iOS app (`ChannelPointsService.startWatchPresence`).
   The site calls it every 60 s while a live plays (main player only, not paused, not
   for a VOD). At most one beat counted per 50 s per channel. If the “Claim
   automatically” setting is on and a chest is there, it is claimed and `claimed` gives
   the gain.
6. `predictions.get` `{ channel }` →
   `{ balance, event: null | { id, title, status: "ACTIVE" | "LOCKED" | "RESOLVE_PENDING" | "RESOLVED" | "CANCELED", createdAt, windowSeconds, winningOutcomeId: string | null, outcomes: [ { id, title, color: "BLUE" | "PINK", totalPoints, totalUsers } ], self: null | { outcomeId, points } } }`
7. `predictions.bet` `{ channel, eventId, outcomeId, points }` (spend) →
   `{ balance, self: { outcomeId, points } }`
   Checks: integer 1 … 250,000, ≤ balance, event ACTIVE, outcome of this event, no bet
   already placed on ANOTHER outcome.
8. `polls.get` `{ channel }` →
   `{ poll: null | { id, title, status: "ACTIVE" | "COMPLETED" | "TERMINATED" | "ARCHIVED", startedAt, durationSeconds, totalVotes, choices: [ { id, title, votes } ], pointsVoting: { enabled, cost }, self: null | { choiceIds: [ … ], votes } } }`
9. `polls.vote` `{ channel, pollId, choiceId, withPoints: bool }` (spend if `withPoints`, and
   always subject to the real click and the setting) → `{ poll: <same shape as polls.get> }`

10. `raid.join` `{ channel, raidId }` → `{ joined: bool }`
   Joins the raid that the watched channel launches (`JoinRaid` mutation, `input: { raidID }`),
   which gives the raid points bonus, as on twitch.tv. Not a spend: no real click
   required, but subject to the “Connection to the site” setting. `raidId`:
   `^[A-Za-z0-9-]{1,64}$`. At most once per raid (same `raidId` → cached answer), and 1
   per 30 s per channel. The site calls it as soon as it gets the raid announcement
   (`raid_update_v2`, `raid.id` field) on the watched channel, before following the raid.

11. `drops.get` `{ channel }` →
   `{ channelHasDrops: bool, campaigns: [ { id, name, gameName: string | null, endsAt: string | null, drops: [ { id, name, imageUrl: string | null, requiredMinutes, currentMinutes, claimed: bool, dropInstanceId: string | null } ] } ] }`
   Active drops campaigns on this channel with the account's progress (taken from iOS
   `Sources/Services/Drops.swift`: `refresh`, `refreshAvailable`, `refreshSession`,
   `campaign(_:)`). Non-null `dropInstanceId` = claimable drop.
12. `drops.claim` `{ dropInstanceId }` → `{ claimed: bool }`
   `DropsPage_ClaimDropRewards` mutation (`claimHash` hash from Drops.swift), with the
   integrity token. Not a spend: no real click required. `dropInstanceId`:
   `^[A-Za-z0-9#._:-]{1,200}$`. 1 per 5 s.
13. `drops.pulse` `{ channel }` → `{ active: bool, claimed: [ <names of the claimed drops> ] }`
   Moves drops forward like the iOS “pulse” (Drops.swift: `start`, `run`, `poll`,
   `lowestVariant`, `playbackToken`): playlist of the lowest quality obtained WITH the
   account's session, then a HEAD request for each new segment (nothing is downloaded
   or played). The site calls it every 10 s while a live plays whose channel has drops
   (`channelHasDrops`), main player only, not paused. At most 1 per 8 s per channel. If
   “Claim automatically” is on and a drop becomes claimable, it is claimed and its name
   is in `claimed`. The playlist's signed address stays in the background
   (`storage.session`).
14. `rewards.get` `{ channel }` →
   `{ balance, rewards: [ { id, title, cost, prompt: string | null, requiresInput: bool, enabled: bool, paused: bool, inStock: bool, cooldownEndsAt: string | null, color: string | null, imageUrl: string | null } ] }`
   The channel's custom rewards (iOS: `ChannelPointsService.fetchRewards`).
15. `rewards.redeem` `{ channel, rewardId, cost, title, prompt: string | null, input: string | null }`
   (SPEND: real click + “Bets, votes and rewards” setting) → `{ balance }`
   Same mutation and same fields as iOS (`ChannelPointsService.redeem`), with the
   integrity token. Checks: reward read again and existing, enabled, not paused, in
   stock, not on cooldown, cost identical to the one read again, ≤ balance; `input`
   required if `requiresInput` (1 to 200 characters) and forbidden otherwise. Twitch
   error → `twitch` with its code.
16. `hq.master` `{ channel, codecs }` (0.2.0) →
   `{ variants: [ { id, name, source: bool, width, height, fps, bandwidth, codecs } ] }`
   The live's list ON BEHALF OF THE ACCOUNT with the higher qualities (Enhanced
   Broadcasting: 1440p and above, sometimes in HEVC or AV1), like the iOS app
   (`TwitchAPI.swift`: `HigherQualities`, `usherLiveLinks`): the account's playback
   token (with the integrity token if Twitch asks for one), then usher with
   `supported_codecs`. `codecs`: 1 to 3 values from the closed list `av1`, `h265`,
   `h264`, no duplicates, `h264` included (what the browser decodes, chosen by the
   site); sent to Twitch in that order. One entry per variant (20 at most), in the
   list's order: `id` (22 random letters and digits), `name` (“1440p60”, “1080p60”,
   “audio_only”: VIDEO, STABLE-VARIANT-ID or IVS-NAME, otherwise size and frame rate),
   `source` (the original), `width` and `height` (0 for audio only), `fps` (0 if
   unknown), `bandwidth` (bits/s), `codecs` (CODECS attribute). No address. A variant
   whose playlist isn't on `*.playlist.ttvnw.net` or `*.hls.ttvnw.net`, or without
   CODECS, is dropped. Anonymous or refused token → `twitch` `playback_token` (nothing
   is asked from usher); playback refused to the account → `twitch` `forbidden`; usher
   404 → `offline`.
17. `hq.playlist` `{ id }` (0.2.0) → `{ playlist }`
   Playlist of the variant `id`, read by the extension (the page can't) and rewritten
   tag by tag; nothing else gets through:
   `#EXTM3U`, `#EXT-X-VERSION`, `#EXT-X-TARGETDURATION`, `#EXT-X-MEDIA-SEQUENCE`,
   `#EXT-X-DISCONTINUITY-SEQUENCE`, `#EXT-X-PLAYLIST-TYPE`,
   `#EXT-X-INDEPENDENT-SEGMENTS`, `#EXT-X-DISCONTINUITY`, `#EXT-X-GAP`,
   `#EXT-X-ENDLIST`, `#EXT-X-PROGRAM-DATE-TIME`, `#EXTINF` (duration, title of at most
   64 safe characters), `#EXT-X-BYTERANGE`, `#EXT-X-MAP` (URI, BYTERANGE),
   `#EXT-X-TWITCH-PREFETCH`, `#EXT-X-DATERANGE` of class `twitch-stitched-ad` (ID,
   CLASS, START-DATE, END-DATE, DURATION, PLANNED-DURATION only), and the segment
   addresses. Every address must be written out in full in the playlist (a relative
   address is never resolved against the variant's signed one), in https, on
   `*.ttvnw.net`, `*.twitchcdn.net`, `*.jtvnw.net` or `*.twitchsvc.net`, without being
   usher, `*.playlist.ttvnw.net`, a `/playlist/`, `/trigger/` or `/api/` path, a
   `.m3u8`, nor carrying `sig`, `token`, `nauth` or `nauthsig`: otherwise a segment
   becomes a gap (`#EXT-X-GAP` and a dummy address `https://gap.invalid/<n>.ts`, never
   requested), a prefetch announcement is dropped, and an unreadable initialization
   file gets the whole playlist refused (`twitch` `bad_response`). Unknown id, older
   than 6 h, or given for another session → `bad_args` `expired`; playlist 404 →
   `offline`; other status → `twitch` `http_<status>`.

Unknown Twitch fields: `null`, never made up.

## Error codes

`disabled` (connection to the site turned off in the extension), `no_session` (not
logged in to twitch.tv in this browser), `needs_activation` (spend without a real
click), `spend_disabled`, `bad_args`, `unknown_op`, `rate_limited`, `integrity`
(integrity token can't be obtained), `twitch` (`message` = Twitch's error code),
`offline` (channel not live), `no_claim`, `timeout`, `internal`.

`message` of `bad_args` (stable values, which the site can translate):

- shape of the request, refused by the content script or the background: `id`, `args`
  (not an object, or more than 8 fields), or the name of the unknown or malformed field
  (`channel`, `eventId`, `outcomeId`, `points`, `pollId`, `choiceId`, `withPoints`,
  `raidId`, `dropInstanceId`, `rewardId`, `cost`, `title`, `prompt`, `input`,
  `codecs`, and `id` for the variant id of `hq.playlist`);
- `hq.playlist`: `expired` (unknown id, older than 6 h, or from another session: ask
  for `hq.master` again);
- `predictions.bet`: `eventId` (not the current prediction), `not_active` (not
  ACTIVE), `outcomeId` (unknown outcome), `points` (more than the balance),
  `other_outcome` (bet already placed on another outcome);
- `polls.vote`: `pollId` (not the current poll), `not_active`, `choiceId` (unknown
  choice), `withPoints` (voting with points not open on this poll), `points` (cost
  greater than the balance);
- `rewards.redeem`: `points_disabled` (points turned off on the channel), `rewardId`
  (unknown reward), `not_enabled`, `paused`, `out_of_stock`, `cooldown`, `cost`
  (cost different from the one read again), `title` (different title), `points` (cost
  greater than the balance), `input` (input missing, empty, or given without being
  asked for).

`message` of `twitch`: Twitch's code (`NOT_ENOUGH_POINTS`…, `UNKNOWN` if it can't be
read), otherwise `channel_not_found`, `network`, `bad_response`, `http_<status>`,
`validate`, `validate_<status>`, `playback_token` and `forbidden` (`hq.master`), or a
cleaned-up Twitch message (80 characters at most).

## Rate limits (background)

Reads (`*.get`, `status`): at most one Twitch request per 3 s per channel (otherwise a
cached answer); `points.claim`: 1 per 10 s; `watch.beat`: 1 per 50 s per channel;
`raid.join`: 1 per 30 s per channel; `drops.claim`: 1 per 5 s; `drops.pulse`: 1 per
8 s per channel; spends: 1 per 3 s; `hq.master`: one list asked from Twitch per 10 s,
per channel and per choice of codecs (otherwise the same answer, same ids); all
together: 60 requests a minute, beyond that `rate_limited`.

`hq.playlist` has its own budget, outside the 60: the player re-reads the live's
playlist every 2 to 6 s during playback, and must not starve the site of its other
operations. At most one read from Twitch per second per variant (otherwise the same
playlist), and 240 requests a minute, beyond that `rate_limited`.

## Settings (extension's window, local storage, no secret)

- “Connection to the TwitchUnblock site” (on by default)
- “Claim automatically (chests and drops)” (on by default; key `autoClaim`)
- “Bets, votes and rewards from the site” (on by default, always subject to the real
  click; key `allowSpend`)

Spends subject to the real click: `predictions.bet`, `polls.vote`, `rewards.redeem`.
Timeouts on the site's side (see Transport): 45 s also for `raid.join`, `drops.claim`,
`drops.pulse` and `hq.master` (which may get an integrity token for the account's
playback token) and `rewards.redeem`. Yet the site only waits a few seconds for
`hq.master` when a live starts: beyond that, it plays the usual source, and the
integrity token obtained in the meantime serves the next live.

## Higher qualities on the site's side (0.2.0)

The site's “Higher qualities (1440p and above)” setting, off by default, offered only
with an extension 0.2.0 or later, turned on and with a session. The account's list is
asked for at the same time as the usual source, with H.264, and HEVC or AV1 only if the
browser decodes them in hardware (`navigator.mediaCapabilities`); it is only kept if it
goes above 1080p. The player then reads the playlists through `hq.playlist` and the
segments directly. During a Twitch ad break on the account's stream (account without a
sub or Turbo), it switches to the usual source without ads, then comes back (like the
app). Never for multi-live, downloads or “Open in…”.
