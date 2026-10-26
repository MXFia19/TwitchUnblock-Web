# Publishing on addons.mozilla.org (AMO)

What to upload and what to fill in when submitting TwitchUnblock Connect to
addons.mozilla.org, so Firefox users can install it permanently and get updates
automatically. The steps follow Mozilla's
[Submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
guide: Developer Hub → **Submit a New Add-on** → **On this site**.

## Files

- **Add-on:** the Firefox package — the contents of `extension-firefox/` (built by
  `node extension/dev/build-firefox.mjs`), `manifest.json` at the root of the zip. The
  release's `twitchunblock-connect-firefox.zip` is the same package.
- **Source code** (asked on the page after the upload): a zip of the repository's `extension/` folder,
  with [BUILD.md](BUILD.md) at its root. It is needed because `build-firefox.mjs` generates
  the Firefox manifest; every JavaScript file is shipped as written.

Each new version on AMO must have a higher version number than the previous one and comes
with its own source code zip. Upload it from the add-on's page in the Developer Hub
(**Upload New Version**), not as a new add-on.

## Upload

- **Compatible platforms:** Firefox (desktop) only. Firefox for Android has not been tried.
- **Do you need to submit source code?** (the page after the upload, before **Describe
  Add-on**) Yes → the source code zip. If it was skipped, add it after submitting, see
  [After submitting](#after-submitting).

## Describe Add-on

**Name:** TwitchUnblock Connect

**Add-on URL:** `twitchunblock-connect`

**Summary** (250 characters at most):

> Lets the TwitchUnblock website use your Twitch session in this browser: channel points and
> bonus chests, watch streaks, drops, predictions, polls, raids, rewards and lives in 1440p+.
> Your session never leaves the extension.

**Description:**

> TwitchUnblock Connect links the TwitchUnblock website (https://twitchunblock.vercel.app),
> a lightweight way to watch Twitch, with your Twitch account in this browser.
>
> With it, the website can:
> • show your channel points and claim bonus chests automatically (optional);
> • count your watch time for channel points, watch streaks and drops;
> • show your drops and claim them;
> • let you bet on predictions, vote in polls, join raids and redeem channel rewards — always
> with a real click on the website;
> • play lives in higher qualities (1440p and above) when the streamer offers them, with the
> usual ad-free source during Twitch ad breaks.
>
> How it works
> You stay logged in on twitch.tv as usual. The extension uses that session for a closed list
> of actions asked by the website, and talks only to Twitch. Your session, cookies and tokens
> never leave the extension: the website only gets the results, such as your points balance.
>
> Privacy
> • Data goes only to Twitch, the way twitch.tv itself sends it: your session with each
> request, the actions you take, and a watch-presence event while you watch.
> • Nothing is sent to the developer: no server, no analytics, no ads.
> • In the extension's window, you can turn off the connection to the website, automatic
> claims, or bets, votes and rewards at any time.
>
> Open source (MIT): https://github.com/MXFia19/TwitchUnblock-Web/tree/main/extension
>
> TwitchUnblock and this extension are not affiliated with or endorsed by Twitch.

- **This add-on is experimental:** no.
- **Requires payment, non-free services or software, or additional hardware:** no.
- **Firefox categories:** Photos, Music & Videos; Social & Communication.
- **Support email:** the developer's.
- **Support website:** https://github.com/MXFia19/TwitchUnblock-Web/issues
- **License:** MIT License (see [LICENSE](../LICENSE)).
- **This add-on has a privacy policy:** yes → paste [PRIVACY.md](../PRIVACY.md).
- **Homepage** (in the listing's details, once submitted): https://twitchunblock.vercel.app

## Notes for Reviewers

> What it does: a bridge between https://twitchunblock.vercel.app (our website, a Twitch
> viewer) and the user's Twitch session in this browser. The website talks to a content
> script (top frame only, only on the website's two origins: production and its test
> preview, test2-git-test-17d298-mxfia19s-projects.vercel.app). The background checks the
> sender, origin, frame and arguments, and only performs a closed list of operations
> (PROTOCOL.md): hello, status, points.get, points.claim, watch.beat, predictions.get,
> predictions.bet, polls.get, polls.vote, raid.join, drops.get, drops.claim, drops.pulse,
> rewards.get, rewards.redeem, hq.master, hq.playlist. No generic request relay, no
> externally_connectable, no web_accessible_resources, no remote code, no analytics.
>
> Data: requests go only to Twitch, with the user's existing session (the auth-token
> cookie, read on each use, never copied, never given to the page). Nothing is sent to the
> developer. Declared data collection: authenticationInfo (the session sent to Twitch) and
> websiteActivity (actions and watch presence sent to Twitch). Privacy policy: PRIVACY.md.
>
> Permissions:
> - cookies: read the Twitch session;
> - storage: settings (local) and session state (storage.session);
> - scripting + tabs: Twitch requires a Client-Integrity token for mutations. The extension
>   has a www.twitch.tv page make Twitch's own POST https://gql.twitch.tv/integrity with
>   scripting.executeScript (world MAIN, a function bundled in background.js), using a
>   twitch.tv tab that is already open, or an inactive, muted tab it opens and closes;
> - hosts: *.twitch.tv; static.twitchcdn.net (twitch.tv's settings file, which holds the
>   watch statistics address); usher.ttvnw.net and *.playlist.ttvnw.net (live playlists, for
>   drops progress and 1440p); *.hls.ttvnw.net (HEAD requests on segments, for drops); the
>   website's two origins (content script).
>
> Spending points (bets, votes, rewards) needs a real click on the website
> (navigator.userActivation is checked) and the website's confirmation; it can be turned off
> in the extension's window.
>
> How to test: log in on https://www.twitch.tv in Firefox, then open
> https://twitchunblock.vercel.app and a live channel: the channel points button shows the
> balance read by the extension. Settings → Player → "Higher qualities" uses hq.master and
> hq.playlist. A Twitch account is required: any free account works (sign up on
> https://www.twitch.tv); the extension only uses the session of the browser it runs in.
>
> Source code: the Firefox package is generated from the Chrome folder by
> extension/dev/build-firefox.mjs (only manifest.json is rewritten; every other file is
> copied unchanged, without the dev/ and tests/ folders). The source package is attached to
> this version, with BUILD.md at its root. Build: Node.js 22 or later, no npm dependencies,
> then node extension/dev/build-firefox.mjs. Tests: node extension/tests/run.mjs.

Never put the developer's own Twitch login in these notes. If reviewers ask for an account,
create a dedicated test account for them.

## After submitting

After **Submit Version**: Developer Hub → **My Add-ons** → TwitchUnblock Connect →
**Manage Status & Versions** → open the version. Fill in **Release notes** and, if the source
code was not given during the submission, add it at the bottom (next to **Source code**,
**Browse**), then **Save changes**. Release notes for 0.2.0:

> First version on addons.mozilla.org: channel points and bonus chests, watch streaks,
> drops, predictions, polls, raids and channel rewards for the TwitchUnblock website, plus
> higher qualities (1440p and above).

**Next versions**: Developer Hub → TwitchUnblock Connect → **Upload New Version** (the
Firefox zip of the release), then the source zip and these notes. Release notes for 0.3.0:

> Follow or unfollow a channel from the TwitchUnblock website, ad-free lives through your
> account when you're subscribed (or have Turbo), and your account's stream as a last
> resort when no other source answers. Drops whose game account isn't linked now show a
> link instead of Claim. Spending points now takes one real click per spend. No new
> permission.
