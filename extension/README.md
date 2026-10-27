# TwitchUnblock Connect

> **Summary.** A small Manifest V3 browser extension (one code base for Chrome,
> Edge, Brave and Firefox 140+) that lets the TwitchUnblock site use the Twitch session of
> *this* browser — channel points, bonus chests, watch presence, drops, channel rewards,
> predictions, polls, raids, since 0.2.0 lives in 1440p and above (Enhanced
> Broadcasting, served by Twitch to logged-in accounts only), and since 0.3.0 following
> channels, clips, a full Drops page, the account's events live and ad-free lives for
> subscribers — without the session ever leaving the extension. The site can only ask for a closed list of actions (see
> [PROTOCOL.md](PROTOCOL.md)); spending points needs a real click; for 1440p the page only
> gets the account's live playlists rewritten by the extension (segment addresses, no
> token, no playlist address); nothing is sent anywhere but Twitch.
> **Install**: download `twitchunblock-connect-chrome.zip` or
> `twitchunblock-connect-firefox.zip` from the
> [latest release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest) and follow
> [INSTALL.md](INSTALL.md) — unpacked in Chrome, Edge and Brave, as a temporary add-on in
> Firefox (until it is signed on AMO).

Browser extension that links the TwitchUnblock site to the Twitch session of this
browser. The site can then show the points balance, claim chests, get watch time counted
(passive points), move drops forward and claim them, redeem channel rewards, bet on
predictions, vote in polls and join raids, as on twitch.tv, and, since 0.2.0, play lives
in 1440p and above (see “Higher qualities”). Since 0.3.0: follow or unfollow the channel
(button next to the live's title), play the whole live through your account when you're
subscribed (or have Turbo) — no ads at all —, and, when no source answers, the live
through your account as a last resort, clip the live (Clip button: the clip is made on
your account, at the moment the player shows), a Drops page with all your campaigns
(Settings → TwitchUnblock Connect, or “All my drops” in the chat's drops card), and the
account's events live — points earned, chests, predictions won or lost, finished drops —
instead of re-reading them every minute. Drops whose game account isn't linked show a link
instead of “Claim”. Spending points takes one real click per spend. The Twitch session
never leaves the extension.

Updating an existing install (0.1.0 → 0.2.0): new zip in place of the old files, then ↻
on the extension's card (Chrome, Edge, Brave), or a new temporary add-on (Firefox, which
asks for one more access, `*.playlist.ttvnw.net`: “Allow access” in the extension's
window). Details: [INSTALL.md](INSTALL.md).

The contract between the site and the extension is in [PROTOCOL.md](PROTOCOL.md) (a copy
of the document shared by both sides).

## Installation

### Chrome, Edge, Brave (unpacked extension)

1. Download `twitchunblock-connect-chrome.zip` from the
   [latest release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest)
   (published by the *Extension* workflow on every push to `main`) and unzip it, or
   take the `extension/` folder of a cloned repository. Steps for users, in English:
   [INSTALL.md](INSTALL.md).
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the folder (the one that contains
   `manifest.json`).

### Firefox 140 and later (temporary add-on)

The `extension/` folder is the Chrome version (Chrome, Edge and Brave refuse a background
given as a script, which Firefox requires). The Firefox version is built separately:
`twitchunblock-connect-firefox.zip` from the
[latest release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest) (to pick
as is, without unzipping it), or `node extension/dev/build-firefox.mjs` from the cloned
repository, which writes it to `extension-firefox/`.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick the release's Firefox zip (or the
   `manifest.json` in `extension-firefox/`).
3. Open the extension's window: if an orange box reports missing access, click
   **Allow access** (or `about:addons` → TwitchUnblock Connect → Permissions → allow
   twitch.tv and the site's two addresses).

A temporary add-on goes away when Firefox closes. A lasting install needs a signature
from Mozilla (AMO): the extension is being submitted there (ID
`twitchunblock-connect@mxfia19.github.io`; checklist and texts in
[dev/AMO.md](dev/AMO.md)).

### Then

- Log in to **twitch.tv** in this browser (the session is twitch.tv's `auth-token`
  cookie; the extension reads it again on every use).
- Open the site (`https://twitchunblock.vercel.app`, or the test branch's Vercel
  preview with the repository's `extension/` folder: the published packages only know the
  production site): it detects the extension on its own.

## The extension's window

- **Status**: connected as @login, or “log in to twitch.tv”; expiry of the integrity
  token if there is one.
- **Settings** (stored in the browser, no secret), all on by default:
  - *Connection to the TwitchUnblock site*: when off, the site gets nothing more (it
    only sees that the extension is there and turned off).
  - *Claim automatically (chests and drops)*: the bonus chest and finished drops are
    claimed while a live is watched on the site.
  - *Bets, votes and rewards from the site*: always after a real click on the site and
    its confirmation.
- **Diagnostic**: checks the session again and gets a new integrity token. Tokens only
  show masked (first 4 characters and length).

## Security and privacy

- The Twitch session (`auth-token`) and the `Client-Integrity` token stay in the
  extension's background: never sent to the page, to the content script, to a log or in
  an error message. The session is read again from the cookies on every use, never
  copied; the integrity token lives in `storage.session` (browser memory, erased when the
  browser closes, closed to content scripts).
- The content script only runs on the site, top frame only (the published packages: the
  production address only; the repository's folder also has the test branch's preview,
  removed by `dev/release.mjs` when packaging). It checks the origin and the shape of
  every request, doesn't touch the page and sees no token. The background checks
  everything again (sender, origin, frame, arguments), with the origins read from its own
  manifest.
- Closed list of operations, no free GQL request, no generic relay; no
  `externally_connectable` and no `web_accessible_resources`.
- Spending points (bets, votes, rewards): dedicated setting + real click
  (`navigator.userActivation`) + confirmation shown by the site. Before a redemption, the
  reward is read again from Twitch (enabled, not paused, in stock, not on cooldown, same
  cost, same title, enough balance).
- Drops: the playlist's signed address (the account's playback token) and the segments
  already seen stay in `storage.session`; the page only gets “active or not” and the
  names of the claimed drops.
- Account's events (0.3.0): while a tab of the site asks for them (`events.keep`, every
  25 s), the background keeps one WebSocket to `wss://hermes.twitch.tv` — Twitch's own,
  the one twitch.tv uses — authenticated with the session, subscribed to the account's
  points, predictions and drops topics only, and closed 90 s after the last request, when
  the session changes or when the connection to the site is turned off. The page only
  gets reduced events (numbers and ids, closed list checked again by the content script).
  Chests and drops announced there are claimed right away with “Claim automatically”.
- Clips (0.3.0): a real click per clip, 1 per 10 s; made on the account, never twice
  for one request.
- Higher qualities (0.2.0): the account's playback token, the usher address and the
  addresses of the variants' playlists stay in the background (`storage.session`); the
  page gets a random id per variant, then each playlist rewritten against an allowlist
  (playback tags, ad breaks without their `X-TV-TWITCH-*` attributes, addresses of the
  segments on Twitch's CDN). It's the one thing more that goes to the page: without it,
  no 1440p (see PROTOCOL.md, “Security principles”). No `declarativeNetRequest`: the
  page gets no right to read Twitch by itself.
- Rate limits in the background (60 requests a minute in all, reads cached for 3 s;
  `hq.playlist` on a separate budget of 240 a minute, etc.: see PROTOCOL.md).
- Nothing is sent anywhere but Twitch: no server of ours, no statistics. Firefox (140 and
  later) shows it at install with its built-in data consent: the Firefox version declares
  `authenticationInfo` (the Twitch session sent to Twitch with each request) and
  `websiteActivity` (the actions taken through the site and the watch presence, sent to
  Twitch), as Mozilla counts anything handled outside the browser — Twitch included. Full
  policy: [PRIVACY.md](PRIVACY.md); license: [MIT](LICENSE).
- Permissions: `cookies` (read the session), `scripting` (get the integrity token in a
  twitch.tv page), `storage` (settings and session state). No `tabs` since 0.3.0: the
  host accesses below are enough to find the twitch.tv and site tabs by their address.
  Hosts:
  `*.twitch.tv`, `static.twitchcdn.net` (twitch.tv's settings file, which holds the
  address of the watch statistics), `usher.ttvnw.net` (a live's list of qualities),
  `*.hls.ttvnw.net` (segments, requested with HEAD for drops), `*.playlist.ttvnw.net`
  (0.2.0: the lives' playlists, for drops and 1440p; without this access, Twitch refuses
  them to the extension, because of the Origin header — checked in Chrome 155) and the
  site's address (content script, injected again into tabs already open after an
  install or an update: under Chrome, the old one is left orphaned and goes silent). A
  setting changed in the window is announced right away to these tabs.

## Development notes

### Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3, Chrome version (`service_worker`); `dev/build-firefox.mjs` derives the Firefox version from it (`scripts`, gecko ID) |
| `background.js` | protocol operations, session, integrity token, limits, cache |
| `content.js` | page ↔ background bridge, nothing else |
| `popup.html`, `popup.js` | window: status, settings, diagnostic |
| `_locales/*/messages.json` | texts in en, fr, es, ru, it, ja |
| `icons/` | PNG icons, rebuilt by `node dev/make-icons.mjs` |
| `tests/run.mjs` | Node test suite (not in the zip) |
| `dev/release.mjs` | published manifest: the repository's one without the test branch's preview (not in the zip) |
| `PROTOCOL.md` | site ↔ extension contract |

Plain JavaScript, no dependency and no build step.

### Integrity token

Twitch's mutations (chest, bet, vote, raid, drop, reward) require a `Client-Integrity`
header produced by twitch.tv's anti-bot script. Like the apps, the extension has a real
www.twitch.tv page make the `POST https://gql.twitch.tv/integrity`
(`scripting.executeScript`, `world: "MAIN"`), then sends the mutations itself with that
token (valid for several hours) and `X-Device-Id` = the `unique_id` cookie. It uses a
www.twitch.tv tab that is already open; otherwise it opens
`https://www.twitch.tv/directory` in an inactive, muted tab (no video), then the home
page as a fallback, and closes the tab. Only one fetch at a time; a mutation refused for
integrity: token forgotten, new fetch, a single retry. After a failure, no new tab
before 30 s (5 min for the automatic chest).

### Twitch requests

Taken from the iOS app (`Sources/Chat/ChannelPointsService.swift`,
`LiveEventsService.swift`, `TwitchGQL.swift`, `TwitchWebGQL.swift`,
`Sources/Services/Drops.swift`, `TwitchAPI.swift`): same persisted queries, same
variables, same headers.

| Operation | Request | Source |
| --- | --- | --- |
| balance, chest | `channel { id self { communityPoints { balance availableClaim { id } } } }` | iOS `fetchBalance` (+ `id`, as in the trial) |
| points name and icon | `communityPointsSettings { name image { url2x } }` | raw request, **not in the iOS app** |
| watch streak | `BatchGetWatchStreaks` | iOS `fetchStreak` |
| claim the chest | `ClaimCommunityPoints` | iOS `claimBonus` |
| current live | `user { stream { id } }` | iOS `fetchBroadcastId` |
| presence | `minute-watched` to spade (address read from the channel's page) | iOS `sendMinuteWatched` |
| prediction | `ChannelPointsPredictionContext`, `self { prediction … }`, `resolvedPredictionEvents` | iOS `fetchPrediction`, `myPrediction`, `resolvedWinner` |
| bet | `MakePrediction` | iOS `predict` |
| poll, vote | `ChannelPollContext_GetViewablePoll`, `ChannelPollContext_VoteInPoll` | iOS `fetchPoll`, `vote` |
| vote with points | same mutation, `tokens: { bits: 0, channelPoints: <cost> }` | **not in the iOS app** (free vote only) |
| raid | `JoinRaid` (hash not checked), fallback to a raw mutation | **not in the iOS app** |
| the channel's drops | `user { id channel { viewerDropCampaigns { id } } }` | iOS `dropsChannelId` |
| progress | `currentUser { inventory { dropCampaignsInProgress … } }` | iOS `refresh` |
| campaigns not started | `currentUser { dropCampaigns … }` (only with an integrity token already kept) | iOS `refreshAvailable` |
| current drop | `dropCurrentSession(channelID:)` | iOS `refreshSession` |
| claim a drop | `DropsPage_ClaimDropRewards` | iOS `claim` |
| pulse | `streamPlaybackAccessToken` on behalf of the account, usher, last variant, HEAD of the new segments | iOS `accountPlaybackToken`, `lowestVariant`, `poll` |
| rewards | `communityPointsSettings { isEnabled customRewards … }` | iOS `fetchRewards` |
| end of cooldown | `customRewards { id cooldownExpiresAt }` | raw request, **not in the iOS app** |
| redemption | `redeemCommunityPointsCustomReward` (mutation written out in plain text) | iOS `redeem` |
| higher qualities | `streamPlaybackAccessToken` on behalf of the account, usher with `supported_codecs`, then each variant's playlist | iOS `accountPlaybackToken`, `HigherQualities`, `usherLiveLinks` |
| follow | `user(login) { id self { follower { followedAt } } }`, `FollowButton_FollowUser`, `FollowButton_UnfollowUser` | iOS `FollowButton` |
| clip | `user(login) { id stream { id createdAt } }`, then `CreateClip` (plain text; without `broadcastID` and `error` if Twitch's schema refuses them) | iOS `ClipCreator` |
| account's events | Hermes WebSocket: `authenticate`, then `pubsub` subscriptions to `community-points-user-v1`, `predictions-user-v1`, `user-drop-events` | twitch.tv's Hermes client, like the site's chat for the channel's events |
| Drops page | inventory and dashboard (above), started campaigns first | iOS `DropsView` |

### Drops

Since October 2026, Twitch only counts drop minutes when the account's session loads the
stream itself. Like the app (`DropsHeartbeat`), each `drops.pulse` (every 10 s, paced by
the site) re-reads the playlist of the lowest quality, obtained with the account's
playback token, and requests each new segment with HEAD: nothing is downloaded or
played. Token refused: a new one at the next beat (a one-minute wait after several
refusals); three 404s in a row: live over, state forgotten. Every 5 min, if the setting
is on, the inventory's finished drops are claimed (not those of a campaign whose game
account isn't linked); a claim that takes longer than 6 s is reported at the next beat.

`drops.get` never gets an integrity token: if Twitch asks for one for the dashboard
(campaigns not started yet) and none is kept, those campaigns are missing until the next
token (the app, for its part, gets one).

Up to 0.1.0, the pulse no longer found any variant: Twitch now serves its playlists from
`*.playlist.ttvnw.net` (only `*.hls.ttvnw.net` was accepted), and refuses them (403) to
an extension without access to that host (request with a `chrome-extension://…` Origin
header). 0.2.0 accepts that host and asks for access to it.

### Higher qualities

Twitch only serves the variants above 1080p (Enhanced Broadcasting: 1440p, 4K, sometimes
in HEVC or AV1) to an account's playback token; an anonymous token says
`maximum_resolution: FULL_HD` (`QUAD_HD: AUTHZ_NOT_LOGGED_IN`). `hq.master` gets the
account's token (like the drops pulse), asks usher for the list with `supported_codecs`
(chosen by the site: `h264`, and `h265` or `av1` if the browser decodes them in hardware)
and returns each variant under a random id; `hq.playlist` reads a variant's playlist and
rewrites it (PROTOCOL.md, operation 17).

Why the extension re-reads each playlist instead of letting the page do it (tests of
2026-10-25 with an anonymous token, without an account): usher only sends
`Access-Control-Allow-Origin` for `https://www.twitch.tv`, and the variants' playlists,
open to everyone (`*`), answer 403 as soon as a foreign Origin header is there (the
site's, `null`, or `chrome-extension://…`). A `declarativeNetRequest` rule rewriting the
Origin for the page would have worked, but needed one more permission and gave the page
the playlists' addresses (valid for the whole viewing session); here it only has the
segments' addresses (a few seconds of video each), which their CDN serves to any origin.

### Background lifetime

Chrome stops the service worker after ~30 s without an event (Firefox does the same with
its event page). No long timer: the site paces the beats, and what must survive (rate
limits, integrity token, last prediction seen, votes cast from here, drops pulse state,
temporary tab to close) is in `storage.session`. The Hermes connection (0.3.0) lives in
memory only: Hermes' keepalives and the site's `events.keep` every 25 s keep the
background awake; if the browser stops it anyway (Firefox can suspend its event page),
the next `events.keep` opens the connection again, and the site goes on re-reading points
and drops in the meantime.

### Tests

```sh
node extension/tests/run.mjs
```

Fake `chrome` APIs, fake Twitch, no network request. Among other things, the suite
checks that unknown operations and wrong origins or frames are refused, the bounds of the
arguments (same table for the content script and the background), that a spend without a
real click or with the setting off is refused, the rate limits (including after a restart
of the background), getting the integrity token (open tab, temporary tab, fallback, a
single extra try), drops (pulse, segments with HEAD, claiming), the checks before a
redemption, higher qualities (the account's token, `supported_codecs`, variants without
addresses, playlist rewritten byte for byte, ids tied to the session, separate budget),
clips (offset from the start of the live, fallback form, Twitch's refusals), the Drops
page, the account's events (a fake Hermes: the session only in `authenticate`, the three
topics, reduced events to the site's tab only, automatic claims, refused session,
reconnection, session changed), the published manifest (no preview, no `tabs`) and the
absence of any piece of a token or signed address in answers, logs and `storage.local`
(only the answers of `hq.playlist` carry segment addresses, never usher, a playlist, a
trigger or the playback token).

### Package

The `.github/workflows/extension.yml` workflow (push to `test-17d298` or `main` touching
`extension/`, or manual run) checks the JSON files and the JS syntax, runs the test suite
and produces the Chrome and Firefox packages (without `tests/` or `dev/`) as artifacts.
On `main`, they get the published manifest (`dev/release.mjs`: without the test branch's
preview; the step fails if it is still there); on the test branch, the artifacts keep the
preview, to try the extension there.
On `main`, it also publishes them in the `connect-v<version>` release (the manifest's
version: `connect-v0.2.0`), marked as the latest, with `INSTALL.md` as its text: that is
the one the site's link opens (…/releases/latest).

The site (Vercel only serves `public/`) and the Docker image (the `Dockerfile` only
copies specific paths) don't ship this folder.
