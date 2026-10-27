# Building the Firefox package

For reviewers on addons.mozilla.org: how to rebuild the submitted Firefox package from this
source.

## Requirements

Any operating system with **Node.js 22 or later** (Node 24 works too). No npm packages, no
network access, no other tool.

## Steps

1. Unzip the source package. You get the `extension/` folder (and this file).
2. From the folder that contains `extension/`, run:

   ```bash
   node extension/dev/build-firefox.mjs
   ```

3. The Firefox version is written to `extension-firefox/`, next to `extension/`. Its contents
   are exactly the submitted package (`manifest.json` at the root of the zip).

To compare with the submitted package: unzip it into a folder, then
`diff -r extension-firefox <that folder>` — no difference expected.

## What the build does

- It copies every file of `extension/` except the `dev/` and `tests/` folders.
- It rewrites `manifest.json` only: the background is given as `scripts` instead of a
  `service_worker` (Firefox has no background service worker), it adds
  `browser_specific_settings.gecko` (add-on id, minimum Firefox version 140, data collection
  permissions), and it removes the test branch's preview address
  (`test2-git-test-17d298-mxfia19s-projects.vercel.app`) from the content script and the
  host permissions (`dev/release.mjs`): the repository's folder keeps it for manual tests,
  the published package only knows https://twitchunblock.vercel.app. `--dev` keeps it.

No minification, bundling, transpiling or code generation: every JavaScript file is the
hand-written source, copied as is.

## Tests (optional)

```bash
node extension/tests/run.mjs
```

They run in Node with a fake browser API and a fake Twitch, without network.
