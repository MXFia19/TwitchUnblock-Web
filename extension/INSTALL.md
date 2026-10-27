# Install TwitchUnblock Connect

TwitchUnblock Connect is a small extension for desktop browsers. It lets the
[TwitchUnblock website](https://twitchunblock.vercel.app) use the Twitch session of your
browser, so that while you watch a live on the site you can:

- earn channel points (balance and watch streak above the chat),
- claim bonus chests automatically,
- get the raid bonus,
- bet on predictions and vote in polls,
- redeem channel rewards,
- move your drops forward and claim them,
- watch in **1440p and above** on the channels that offer it (new in 0.2.0),
- follow or unfollow channels, and watch **without ads** when you're subscribed or have
  Turbo (new in 0.3.0),
- clip the live with your account, see all your drops campaigns on one page, and get your
  points, chests, predictions and drops live (new in 0.3.0).

Your Twitch session never leaves the extension: nothing goes through TwitchUnblock's servers,
and spending points always needs a click from you. For 1440p, the site only gets the live's
playlists, rewritten by the extension (the addresses of the video pieces), never your session
or your playback token.

Download the zip for your browser from the
[latest release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest):
`twitchunblock-connect-chrome.zip` or `twitchunblock-connect-firefox.zip`.

## Chrome, Edge, Brave (and other Chromium browsers)

1. Download **`twitchunblock-connect-chrome.zip`** and unzip it. Keep the folder somewhere
   it can stay: the browser loads the extension from it.
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
3. Turn on **Developer mode** (top right corner).
4. Click **Load unpacked** and select the unzipped folder (the one with `manifest.json`
   inside).
5. Pin the extension with the puzzle icon, then open it: it should say you're connected
   with your Twitch name. If it doesn't, log in to [twitch.tv](https://www.twitch.tv) in
   this browser.

**Updating** (for example from 0.1.0 to 0.2.0): download the new zip, delete the old files
from the extension's folder and unzip the new ones into it, then click the reload arrow (↻)
on the extension's card in the extensions page. Your settings are kept, and the card now
shows the new version. Tabs of the site that were already open get the new version by
themselves; reload them if the site doesn't see it.

## Firefox (version 140 or later)

Until the extension is signed by Mozilla, Firefox can only load it as a temporary add-on,
which goes away when Firefox closes (load it again the next time).

1. Download **`twitchunblock-connect-firefox.zip`** (no need to unzip).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the zip file.
4. Open the extension from the Extensions menu (puzzle icon). If it asks for access to
   twitch.tv and the TwitchUnblock site, allow it (or `about:addons` → TwitchUnblock
   Connect → Permissions).

**Updating**: remove the old temporary add-on (or restart Firefox), then load the new zip
the same way. Version 0.2.0 needs one more access, to Twitch's live playlists
(`*.playlist.ttvnw.net`): if the extension's window shows an orange box, click **Allow
access**.

## Use it

1. Log in to [twitch.tv](https://www.twitch.tv) in the same browser.
2. Open [twitchunblock.vercel.app](https://twitchunblock.vercel.app) → **Settings →
   TwitchUnblock Connect**: it should show the extension as installed, with your account.
3. Watch a live: your points balance shows above the chat, chests are claimed for you, and
   predictions, polls, rewards and drops get their buttons. With 0.3.0: **Clip** next to
   the live's title, and **Settings → TwitchUnblock Connect → My drops** for all your
   campaigns.
4. For 1440p and above: **Settings → Player → Higher qualities (1440p and above)** (needs
   version 0.2.0). Only channels streaming above 1080p (Enhanced Broadcasting) have them;
   the player's quality menu then lists them (“1440p60 (Source)”…). HEVC and AV1 qualities
   are offered only when your browser decodes them in hardware. Without a sub or Turbo,
   during Twitch's ad breaks, playback switches to the usual source (1080p at most) without
   ads, then comes back. Not used in multi-live.

The extension's window has three switches: the connection to the site, automatic claiming
(chests and drops), and bets, votes and rewards from the site. Turn any of them off at any
time.
