# TwitchUnblock Connect — Privacy policy

_Last updated: 2026-10-27_

TwitchUnblock Connect is a browser extension that lets the TwitchUnblock website
(<https://twitchunblock.vercel.app>) use the Twitch session of this browser for a closed list
of actions. This page explains what data the extension handles, where it goes, and what it
never does.

## In short

- The extension sends data **only to Twitch**, and only to provide the features you use.
- It sends **nothing to the developer**: no server of ours, no analytics, no advertising, no
  tracking, no sale of data.
- Your Twitch session and tokens **never leave the extension**: they are not given to the
  TwitchUnblock website, nor to anyone else.

## Data sent to Twitch

To work, the extension calls Twitch (`twitch.tv`, `gql.twitch.tv`, `hermes.twitch.tv`,
`usher.ttvnw.net`, `*.playlist.ttvnw.net`, `*.hls.ttvnw.net`, `static.twitchcdn.net`) with
your existing Twitch session, the same way the twitch.tv website does. Firefox lists these data types when you
install the extension:

- **Authentication information.** Your Twitch session (the `auth-token` cookie that Twitch set
  when you logged in on twitch.tv) and, when Twitch requires one, an integrity token are sent
  to Twitch with each request. The extension reads the session from your cookies each time it
  needs it; it never asks for, sees or stores your password. To get the integrity token, it
  has a www.twitch.tv page make Twitch's own request (using a twitch.tv tab that is already
  open, or opening an inactive, muted one and closing it right after).
- **Website activity.** The actions you take through the TwitchUnblock website — claiming
  bonus chests, betting on predictions, voting in polls, joining raids, redeeming channel
  rewards, claiming drops, following or unfollowing a channel, creating a clip (anything
  that spends points, follows or clips needs a real click) — and, while you watch a live on
  the website, a watch-presence event about once a minute (the channel being watched), so
  that Twitch credits your channel points, watch streak and drops.
- **Account events.** While a TwitchUnblock tab asks for them, the extension keeps a
  connection to Twitch's `hermes.twitch.tv` (the one twitch.tv uses), authenticated with
  your session, to receive your account's events: points earned, bonus chests, prediction
  results and drops progress. The website only gets numbers and identifiers from them.
- **Live playlists.** When you turn on higher qualities (1440p and above) on the website, the
  extension asks Twitch for that live's playlists with your account.

This data goes to Twitch only, is used only for these features, and is handled by Twitch
under its own privacy notice: <https://www.twitch.tv/p/legal/privacy-notice/>.

## Data shared with the TwitchUnblock website, inside your browser

The website can only ask for a closed list of operations (see [PROTOCOL.md](PROTOCOL.md)). It
receives their results — for example your channel points balance, open predictions and
polls, drops progress, channel rewards, the link of a clip you created, your account's
events (numbers and identifiers) and, for higher qualities, the live's playlists
rewritten without any token or playlist address. It never receives your Twitch session,
cookies or tokens. This exchange happens inside your browser.

The TwitchUnblock website itself (not this extension) keeps an anonymous usage count, which
can include whether the extension is installed, its version and the browser; it is described
on the website's statistics page (<https://twitchunblock.vercel.app/stats>).

## Data stored on your device

- The extension's settings (`storage.local`): your choices only, no secret.
- Temporary session data (`storage.session`, kept in the browser's memory and erased when the
  browser closes): the integrity token, signed playlist addresses and random identifiers used
  for drops and higher qualities (valid for 6 hours at most).

## What the extension never does

- Send data to the developer or to any third party other than Twitch.
- Collect analytics, show advertising, track you or sell data.
- Run remote code.
- Access websites other than Twitch and the TwitchUnblock website.

## Your choices

- In the extension's window, you can turn off the connection to the TwitchUnblock website
  altogether, automatic claims (chests and drops), and bets, votes and rewards.
- In Firefox, the data types above are shown before installing; if you don't agree, cancel
  the installation.
- You can uninstall the extension at any time from your browser's add-ons page; this removes
  everything it stored.

## Contact and changes

Questions or concerns: open an issue at
<https://github.com/MXFia19/TwitchUnblock-Web/issues>. Changes to this policy are published
in this file, in the extension's repository.
