# Keeping up with upstream FreeTube

`main` is the integrated fork line and `upstream/development` is a reference, so nothing here merges
by itself. The `Upstream sync` workflow (`.github/workflows/upstream-sync.yml`) checks every Monday
06:17 UTC, and on demand from the Actions tab, for a newer upstream **release** (FreeTube betas count,
as the baseline is a beta) than the pin in `tools/upstream-sync/upstream.json`.

When there is one it:

1. merges the release commit into `upstream-sync/<tag>`. Conflicts in the paths listed in `keepOurs`
   (upstream workflows we removed, replaced icons, README) keep the fork's version, and a conflicting
   `pnpm-lock.yaml` is regenerated from the merged `package.json` with the pinned pnpm;
2. records the new pin in `upstream.json`;
3. opens a **draft** PR with the upstream change list and a merge checklist. The existing
   `DD Desktop` checks (lint, tests, packaging, isolated UI smoke) run on it.

If any other file conflicts (for example `package.json`, `src/main/index.js`) it opens an
`upstream-sync` issue listing them instead. A person (or a Claude thread) resolves those on the branch
from the reproduce command in the issue.

Run it by hand from Actions with an optional target: a tag, an upstream `development` commit for an
urgent YouTube fix, or empty for the newest release.

Merging the PR still needs maintainer authority and a real playback check: CI cannot prove that YouTube
plays. Keep the updated pin file in the merge so the next run knows where it stands.

One-time setup: add a fine-grained token (this repository, Contents, Pull requests and Issues
read/write) as the repository secret `UPSTREAM_SYNC_TOKEN`, enable Actions to create pull requests
(Settings -> Actions -> General), and if the repository is a GitHub fork enable scheduled workflows in
the Actions tab.
