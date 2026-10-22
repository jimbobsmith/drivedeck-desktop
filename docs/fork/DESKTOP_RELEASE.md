# DD FreeTube Windows and Linux preview

Work item: [desktop #11](https://github.com/jimbobsmith/drivedeck-desktop/issues/11).

The first DD FreeTube preview is **0.1.0-alpha.1**, based on the pinned FreeTube
v0.25.3-beta source plus the integrated DriveDeck library sync adapters. It works
as a standalone player without NAS setup or sync enrollment. This version starts
an independent fork version sequence; it is not an upstream FreeTube update.

## Install and local data

Use `dd-freetube-0.1.0-alpha.1-win-x64.exe` on Windows 10 or later (64 bit). This is
an NSIS installer with a selectable installation directory. Close the application
before manually reinstalling. Installer execution and a real installed-app upgrade
remain user/field gates; automated checks only launch an isolated unpacked app.

Linux x64 packages are `dd-freetube-0.1.0-alpha.1-linux-x64.AppImage` and `.deb`.
An AppImage needs execute permission and a working FUSE setup, or the normal
AppImage extraction mechanism. DEB packages need the GTK/NSS/libsecret runtime
dependencies declared in the package. Native CI build/UI evidence is recorded
separately from an observed installation on a physical Linux desktop.

Download only from the fork's
[releases](https://github.com/jimbobsmith/drivedeck-desktop/releases). Check the
published SHA256SUMS files against the downloaded artifact. Initial builds are
unsigned; Windows may show an unknown-publisher/SmartScreen prompt. No signing
certificate or Authenticode identity is claimed.

The application is named **DD FreeTube**, package `dd-freetube`, app ID
`com.drivedeck.freetube`, with its own `dd-freetube://` URL protocol. Its data lives
in the operating system's application-data directory under `DD FreeTube`.
Existing FreeTube profiles are neither read nor migrated. FreeTube's protocol and
uninstaller identity are not modified. Import/export is available through the
existing Data Settings when a user deliberately wants to copy a library.

## Updates

Settings → General Settings → Check for Updates controls all automatic update
checks. When enabled, a check runs at application startup and every six hours
while the application remains open. Disabling it cancels the scheduled checks.
An already-started HTTP request may complete. Status polling within the UI does
not contact a server. No updater process is started after the application exits.

Settings → DD FreeTube updates also offers an explicit check and release notes.
Checks never download or install an update. A found update offers Download;
download requires native confirmation. A downloaded update offers Restart and
install; a separate confirmation warns that playback and all app windows will
close. Quitting normally does not install a downloaded update.

Installed Windows NSIS packages and Linux AppImage support automatic installation.
An installer-created `resources/dd-package-type` marker distinguishes Windows
installations from unpacked/ZIP/portable copies. Other packages, including DEB,
offer the release-download flow; no package-manager integration is claimed.

The configured feed is only `jimbobsmith/drivedeck-desktop` GitHub Releases.
Preview builds use SemVer `-alpha.N`, GitHub prereleases, `allowPrerelease=true`,
channel `alpha` and generated `alpha.yml` / `alpha-linux.yml` metadata. The
updater's downgrade setting is explicitly disabled after selecting the channel.
No upstream FreeTube release check or download redirect remains active.

The exact added dependency is electron-updater **6.8.9**. All pre-existing lockfile
resolutions are retained; only that updater and its three previously absent
transitive packages are added. Signature verification is not disabled. Unsigned
preview updates rely on GitHub HTTPS and SHA512 artifact verification, without
Authenticode publisher verification. They are not protected by a private update
manifest signing key; release account compromise is outside those guarantees.

## Build, evidence and publication

Use Node 24.18.0, pnpm 10.34.7 and `pnpm install --frozen-lockfile`. Keep caches
and disposable profiles under D:/tmp/dd locally. The baseline source remains
documented in [BASELINE.md](BASELINE.md); do not replace its historical evidence.

```
pnpm run lint
pnpm run lint:desktop-updates
pnpm run test:media-sync
pnpm run test:desktop-updates
pnpm run pack
pnpm exec electron-builder --config _scripts/ebuilder.config.mjs --win nsis --x64 --publish never
# On a native Linux runner:
pnpm exec electron-builder --config _scripts/ebuilder.config.mjs --linux AppImage deb --x64 --publish never
node tools/fork/verify-release.mjs build
node tools/fork/smoke-release.cjs "build/win-unpacked/DD FreeTube.exe"
```

`DD desktop packages` builds on Windows and Ubuntu runners, uploads installers,
channel manifests and checksums, and runs a fresh-profile UI smoke. Linux uses
Xvfb and the bundled Chromium SUID sandbox helper, owned by root with mode 4755
on the disposable runner. AppArmor and Chromium sandbox policy stay enabled.
Smoke redirects only the OS application-data root into a disposable directory,
then verifies the actual default `DD FreeTube` user-data derivation without
overriding it. It suppresses only the process's protocol-registration calls.
It checks UI identity, updater bridge,
disabled automatic checks and normal exit. It does not execute installers or
qualify audible playback, personal-library sync, signed upgrades or physical
Linux integration.

`verify-release.mjs` checks the actual generated metadata against artifact SHA512,
the embedded fork-only feed, and the real updater GitHub provider's alpha-channel
selection. It then writes SHA256SUMS and portable verification evidence.
Controller tests cover download/restart consent, cancellation, offline retry,
parallel actions, package classification, disabled check scheduling and the real
updater digest transform's rejection of corrupt payloads.

The inherited upstream Upload Release and Update Site workflows are restricted
to their original upstream repository. The DD build workflow cannot publish a
release. After explicit merge/release approval, tag the integrated source and
create a **prerelease** in the fork with both platforms' artifacts, `alpha.yml`,
`alpha-linux.yml`, their blockmaps and checksums. Publish all assets together;
never publish manifests that reference absent assets. Retain corresponding source
under that release tag. Until two published versions and a user-approved installed
upgrade exist, end-to-end update replacement remains a field gate.
