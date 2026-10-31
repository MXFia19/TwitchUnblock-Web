# Publishing on addons.mozilla.org (AMO)

TwitchUnblock Connect is listed on addons.mozilla.org:
<https://addons.mozilla.org/firefox/addon/twitchunblock-connect/>. Firefox installs it
permanently from there and updates it automatically.

**New versions are submitted by the CI.** On every push to `main` that touches
`extension/`, the *Extension* workflow's **Publish on AMO** job (`dev/amo-publish.mjs`)
sends the version of `manifest.json` to AMO if it isn't there yet (awaiting review
included): the Firefox package, the source code zip, the version's
[release notes](#release-notes) and the [notes for reviewers](#notes-for-reviewers). Mozilla
then reviews it, and Firefox offers it to users by itself once approved. The job needs the
repository secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (Developer Hub → **Tools → Manage
API Keys**). Add a version's release notes below before it reaches `main`: without them,
the job stops before sending anything (`node extension/dev/amo-publish.mjs --check` tells,
and the workflow runs it on every push).

The rest of this page is the manual way (first submission, or when the job can't run). It
follows Mozilla's
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
> chests, drops, predictions, polls, raids, rewards, follows, clips and lives in 1440p+.
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
> • follow channels and clip the live with your account (a real click each time);
> • show all your drops campaigns on one page, and your points, chests, predictions and
> drops live;
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
> script (top frame only, on the website's origin). The background checks the sender,
> origin, frame and arguments, and only performs a closed list of operations
> (PROTOCOL.md: points, predictions, polls, raids, drops, rewards, 1440p playlists, follow,
> clips, account events). No generic request relay, no externally_connectable, no
> web_accessible_resources, no remote code, no analytics.
>
> Account events: while a website tab asks for them, the background keeps one WebSocket to
> wss://hermes.twitch.tv (Twitch's own, as on twitch.tv), subscribed only to the account's
> points, predictions and drops topics; the page gets reduced events (numbers and ids).
> Closed 90 s after the last request.
>
> Data: requests go only to Twitch, with the user's existing session (the auth-token
> cookie, read on each use, never copied, never given to the page). Nothing is sent to the
> developer. Declared data collection: authenticationInfo and websiteActivity, both only
> sent to Twitch. Privacy policy: PRIVACY.md.
>
> Permissions:
> - cookies: read the Twitch session;
> - storage: settings (local) and session state (storage.session);
> - scripting: Twitch requires a Client-Integrity token for mutations; a www.twitch.tv tab
>   (an open one, or an inactive, muted tab opened and closed for it) makes Twitch's own
>   POST https://gql.twitch.tv/integrity via scripting.executeScript (world MAIN, a function
>   bundled in background.js). Tabs are found through the host permissions: no "tabs";
> - hosts: *.twitch.tv; static.twitchcdn.net (settings file with the watch statistics
>   address); usher.ttvnw.net and *.playlist.ttvnw.net (live playlists: drops, 1440p);
>   *.hls.ttvnw.net (HEAD on segments, drops); the website's origin (content script).
>
> Spending points (bets, votes, rewards), following and creating a clip need a real click
> on the website (navigator.userActivation is checked); spending also needs the website's
> confirmation and can be turned off in the extension's window.
>
> How to test: log in on https://www.twitch.tv in Firefox, then open
> https://twitchunblock.vercel.app and a live channel: the channel points button shows the
> balance read by the extension. Settings → Player → "Higher qualities" uses the playlists.
> Any free Twitch account works; the extension only uses this browser's session.
>
> Source code: the Firefox package is built from the Chrome folder by
> extension/dev/build-firefox.mjs (only manifest.json is rewritten, other files copied
> unchanged, without dev/ and tests/). The source package (BUILD.md at its root) is
> attached. Build: Node.js 22+, no npm dependencies: node extension/dev/build-firefox.mjs.
> Tests: node extension/tests/run.mjs.

Never put the developer's own Twitch login in these notes. If reviewers ask for an account,
create a dedicated test account for them.

## After submitting

After **Submit Version**: Developer Hub → **My Add-ons** → TwitchUnblock Connect →
**Manage Status & Versions** → open the version. Fill in **Release notes** and, if the source
code was not given during the submission, add it at the bottom (next to **Source code**,
**Browse**), then **Save changes**.

**Next versions by hand** (when the CI job can't run): Developer Hub → TwitchUnblock
Connect → **Upload New Version** (the Firefox zip of the release), then the source zip, the
version's release notes and the notes for reviewers.

## Release notes

One per version, under a `### <version>` heading, as a quote. The CI sends the one that
matches `manifest.json` (paragraphs joined, in English).

### 0.3.0

> Follow or unfollow a channel and clip the live from the TwitchUnblock website, a Drops
> page with all your campaigns, your points, chests, predictions and drops live, ad-free
> lives through your account when you're subscribed (or have Turbo), and your account's
> stream as a last resort when no other source answers. Drops whose game account isn't
> linked now show a link instead of Claim. Spending points now takes one real click per
> spend. One permission less: "tabs" is no longer requested, and the package no longer
> includes the website's test preview.

### 0.2.0

> First version on addons.mozilla.org: channel points and bonus chests, watch streaks,
> drops, predictions, polls, raids and channel rewards for the TwitchUnblock website, plus
> higher qualities (1440p and above).
