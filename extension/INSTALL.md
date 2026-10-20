# Install TwitchUnblock Connect

TwitchUnblock Connect is a small extension for desktop browsers. It lets the
[TwitchUnblock website](https://twitchunblock.vercel.app) use the Twitch session of your
browser, so that while you watch a live on the site you can:

- earn channel points (balance and watch streak above the chat),
- claim bonus chests automatically,
- get the raid bonus,
- bet on predictions and vote in polls,
- redeem channel rewards,
- move your drops forward and claim them.

Your Twitch session never leaves the extension: nothing goes through TwitchUnblock's servers,
and spending points always needs a click from you.

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

**Updating**: download the new zip, replace the folder's content with it, then click the
reload arrow (↻) on the extension's card in the extensions page.

## Firefox (version 128 or later)

Until the extension is signed by Mozilla, Firefox can only load it as a temporary add-on,
which goes away when Firefox closes (load it again the next time).

1. Download **`twitchunblock-connect-firefox.zip`** (no need to unzip).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the zip file.
4. Open the extension from the Extensions menu (puzzle icon). If it asks for access to
   twitch.tv and the TwitchUnblock site, allow it (or `about:addons` → TwitchUnblock
   Connect → Permissions).

## Use it

1. Log in to [twitch.tv](https://www.twitch.tv) in the same browser.
2. Open [twitchunblock.vercel.app](https://twitchunblock.vercel.app) → **Settings →
   TwitchUnblock Connect**: it should show the extension as installed, with your account.
3. Watch a live: your points balance shows above the chat, chests are claimed for you, and
   predictions, polls, rewards and drops get their buttons.

The extension's window has three switches: the connection to the site, automatic claiming
(chests and drops), and bets, votes and rewards from the site. Turn any of them off at any
time.
