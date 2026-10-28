# FreeTube desktop baseline

Work item: [desktop #1](https://github.com/jimbobsmith/drivedeck-desktop/issues/1).
Parent: [DriveDeck #244](https://github.com/jimbobsmith/drivedeckg/issues/244).
Shared metadata service: [platform #27](https://github.com/jimbobsmith/drivedeck-platform/issues/27), not implemented by this milestone.

## Direction and source

FreeTube is the desktop application base; retain its UI, extractor and playback. PipePipe remains the Android/DD base. Its separate VLC desktop feasibility harness is parked, with its results preserved after player PR #16 merged at `27e5c39dd75bf962a26bdde190e577d127913d47`. This is not a plan to rewrite FreeTube's player or port the PipePipe Android UI to desktop.

The fork's initial `main` is byte-identical to upstream FreeTube [v0.25.3-beta](https://github.com/FreeTubeApp/FreeTube/releases/tag/v0.25.3-beta), commit `ff510f8f6c4a0da2602f90336c555f75c75bfa47`. It is the latest published beta selected for this milestone, not a stable-release claim. `origin` is jimbobsmith/drivedeck-desktop; `upstream` is FreeTubeApp/FreeTube. Preserve upstream LICENSE, authorship, README, application identity, source and packaging scripts. Fork-specific additions live in AGENTS.md, this directory and tools/fork; no upstream contribution is submitted.

## Build recipe

Use Windows x64, Node `24.18.0`, npm `11.16.0` for the disposable tooling bootstrap and pnpm `10.34.7`. The upstream workflow chooses Node 24 / pnpm 10; this evidence records exact versions. Put a matching pnpm installation first on the command PATH so scripts do not invoke a different global version.

```powershell
# Repository checkout at the pinned release, with a fresh disposable tool/cache directory.
npm.cmd install --prefix D:\tmp\dd\freetube-baseline\tools pnpm@10.34.7 --ignore-scripts --no-audit --no-fund --cache D:\tmp\dd\freetube-baseline\npm-cache
$env:Path='D:\tmp\dd\freetube-baseline\tools\node_modules\.bin;'+$env:Path
$env:LEFTHOOK='0' # Skip local Git hook installation in this controlled build.
$env:npm_config_cache='D:\tmp\dd\freetube-baseline\npm-cache'
$env:ELECTRON_CACHE='D:\tmp\dd\freetube-baseline\electron-cache'
$env:ELECTRON_BUILDER_CACHE='D:\tmp\dd\freetube-baseline\builder-cache'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
$env:CSC_LINK=$null; $env:CSC_KEY_PASSWORD=$null
$env:WIN_CSC_LINK=$null; $env:WIN_CSC_KEY_PASSWORD=$null
# Create a disposable TEMP/TMP directory and set both variables to it in this shell.
pnpm.cmd install --frozen-lockfile --store-dir D:\tmp\dd\freetube-baseline\pnpm-store --reporter append-only
pnpm.cmd run lint
pnpm.cmd run build
```

`build` uses the unchanged upstream production webpack, allowlisted-renderer-path injection and electron-builder configuration. It builds Windows x64 unpacked, ZIP, 7z, NSIS and portable targets with publishing set to `never`. Creating an installer does not run/install it. Keep all generated artifacts/logs outside Git. The upstream build prints generic signing stages; check the resulting artifact's actual Authenticode status rather than inferring a signature from a log label.

The bundled Chromium/Node/Electron runtime and native packaging tools are dependencies of the existing app. This milestone neither replaces them with VLC nor introduces an alternate player. Preserve the existing dependency and licence boundaries.

## Validation evidence

The frozen install, upstream ESLint/stylelint, production build and all Windows packaging targets complete successfully. The renderer emits three existing webpack bundle-size/performance warnings; no application changes are made to silence them. The unpacked executable, portable executable and NSIS installer report `NotSigned`. No installer was executed and no release was published. [baseline-evidence.json](baseline-evidence.json) records exact tools, source/lockfile hashes, artifact sizes/hashes, all runtime outcomes and the 178-file production-resource comparison against app.asar. Every compared resource matches.

The final opt-in helper runs the actual unpacked `FreeTube.exe`, rather than a replacement player or modified application bundle:

```powershell
node --check tools/fork/smoke-packaged.cjs
node tools/fork/smoke-packaged.cjs build/win-unpacked/FreeTube.exe D:\tmp\dd\freetube-baseline\<fresh-smoke-directory>
```

It pauses the packaged main process using its loopback Node inspector before application startup, sets fresh user/session/log/crash paths, and suppresses the two external protocol-registration methods for this process. It then resumes the unchanged app. This is test isolation, not a production startup change: no provider/player function, browser sandbox flag or application asset is patched. The guard and exact suppressed-call counts are recorded. Normal protocol/OS integration is deliberately not qualified by this check.

The disposable profile uses ordinary preferences: 35% app volume, local API, fallback off and update checks off. It contains no existing subscriptions, credentials or personal history. The helper opens public test item `aqz-KE-bpKQ` through FreeTube's normal command-line URL handling, captures the app UI, samples HTML video clock/frame/audio-decode counters, exercises pause/resume and a forward seek, then asks the app to quit. All profile data, screenshots and raw diagnostics remain disposable; only sanitized numeric/allowlisted results and hashes are committed. Output outside D:/tmp/dd and reuse of an existing evidence directory are rejected before launching the app.

Two visible-window trials pass the basic playback/transport check at the inherited 720p default: 1280x720 video, advancing media clock and decoded video/audio counters, stable pause, advancing resume, seek with subsequent frames/clock advancement, and process exit 0. The final helper trial records Electron 42.5.2 / Chromium 148.0.7778.271 / embedded Node 24.17.0. The external build/validation Node is 24.18.0. Both visible trials record no renderer-process exit and exactly one suppressed remove/set protocol-registration call each. These results do not establish independent speaker output, source A/V alignment, smooth frame presentation or recovery under interruptions.

| Runtime trial | Result | Seek observation |
| --- | --- | --- |
| First hidden-window trial, five-second seek cutoff | Failed; retained unchanged | Target assigned, but media still buffering at cutoff |
| First visible-window trial, up to 30 one-second polls plus inspection overhead | Passed | Playback confirmed after 30390ms |
| Final parameterized helper, visible window | Passed | Playback confirmed after 15133ms |

The failed trial is not rewritten as success. Its private Chromium log also contains an origin-check diagnostic; this check did not have the later renderer-exit observer, and its relation to seeking is unproved. The later trials change visibility and observation timing, so they do not isolate a cause of the delay. Reported dropped-frame counters are retained without claiming smooth presentation; foreground/occlusion conditions need a separate observed check. The baseline demonstrates an unchanged build and basic actual-provider operation, not release readiness or universal playback reliability. No custom-engine workaround is added.

## Follow-up boundary

Assess the variable 15..30-second seek delay and presentation in an observed foreground session before making responsiveness claims. Independent audible/source timing, wider providers/network/hardware, normal OS integration, identity/upgrade handling and distribution gates remain separate. The prior PipePipe/VLC provider 403 is neither reproduced nor explained by FreeTube's success.

The next cross-client milestone belongs to the optional shared metadata contract and its Android/FreeTube adapters: subscriptions and a resume checkpoint first. This baseline adds no shared service, sync client, provider proxy or server deployment. No Android or TV client changes are included.

## Subsequent app integration

The unchanged baseline remains recorded above. Desktop issue #4 now adds optional
manual subscription/resume sync on a separate branch, retaining FreeTube playback.
See [media-sync/README.md](media-sync/README.md) for the actual app adapters,
protected enrollment, OS storage, evidence and remaining field/hosting gates.

## Fork artwork

The approved provisional DD desktop icons and their build/field evidence are documented in [branding](branding/README.md) (issue #7). The unchanged baseline evidence above remains historical.


## Real-app convergence campaign, 2026-10-28

The [repeatable local campaign](media-sync/REAL_APP_E2E.md) records actual Electron/Android/service
checks for subscriptions/categories, offline/restart/conflict recovery and
history/resume. All14 scenario rows passed; owned guest/privateADB/test service
are stopped, independently reconciled READY at24/30 instrumentation attempts.
These are test branches awaiting review, separate from import candidates.
Sync is manual; no general settings propagation is implemented. Nonempty
playlist/Watch Later item roundtrips and NAS/personal-library field gates remain.
