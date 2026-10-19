# FreeTube / PipePipe personal media sync (#4)

The maintainer approved platform PR #28 and proceeding with actual app integration on 2026-10-19. Platform main contains `a032d084b23aacdf5a503e343e034ea8acade6b2`; this branch starts from desktop main `89ea7a21dcc42068279cd5c2a033eaeca59bf0cf`. This accepts the local integration direction, not an independent security audit or hosted-production readiness. Android application work is player #17; service/contract work stays on platform #27 and parent drivedeckg#244.

## Behavior

Settings → Personal media sync is optional and manual. Import a protected per-device enrollment file, then choose **Sync now** on each device. The shared records are canonical YouTube channel IDs and integer-millisecond resume positions. FreeTube's allChannels library and history.watchProgress seconds retain their existing storage/UI and player; no new media engine or extraction service is involved. Subscribe/unsubscribe and saved progress changes are captured from the real main-process datastore paths, including bulk/import paths. Unsupported identities remain local. Other profiles are not independently synchronized; a channel removal also removes it from their subsets, matching FreeTube's library invariant.

Both directions support deletions and a deliberate lower resume position. A conflict retains the local version until the user explicitly chooses this device's or the service's versions for **all** current conflicts. No clock/max-position merge or automatic rebase picks a winner. Sync does not command playback; the existing player reads stored resume on a later normal open. FreeTube's history-saving preferences still govern whether it uses progress. The player reads startTime only on load; this adapter does not change that code.

Titles, thumbnails, provider cookies/credentials, stream URLs, local stream UIDs, device paths/volume/output settings and queues never enter portable records. A previously unknown subscription initially shows its channel ID; a new resume row is labeled `Synced resume: <ID>` with a zero history timestamp, not a claim of a new local watch. Existing metadata stays intact; ordinary client-side channel/video loading can fill details. Deleting a synced resume unsets progress without deleting unrelated history metadata. Full watch-history sync is outside this slice.

## Enrollment and recovery

Library keys stay on owner/client machines, separate from per-device bearer credentials. The offline tool creates one protected recovery file for an owner, then creates a separately credentialed bundle for each device from that recovery. Do not generate multiple unrelated key sets for the same existing library. Key compromise uses a new owner/library namespace and fresh recovery keys; migrate verified local data and retire the old namespace. Revoking a token alone cannot revoke an offline copy of shared keys.

Protected bundles use the interoperability format documented in [platform enrollment design](https://github.com/jimbobsmith/drivedeck-platform/blob/main/docs/media-sync/APP_INTEGRATION.md): PBKDF2-HMAC-SHA256 (600,000 iterations, random 16-byte salt, 256-bit key), AES-256-GCM (random 12-byte nonce, appended 16-byte tag), canonical unpadded base64url and schema-string AAD. Passphrases are 12..128 printable ASCII characters so Android/Node encodings agree; choose a strong private passphrase. The iteration count is a pinned format parameter, not an audited password-strength claim. Wrong password, tampering, altered KDF parameters and malformed bundles fail closed. No passphrase or library key is sent to the server.

Using the platform CLI, first initialize an owner and enroll two separate device credentials into new private files. On your owner-controlled machine, create a private passphrase file through your editor (avoid console arguments/history), then run from this desktop repository:

```text
node tools/fork/media-sync-enrollment.mjs create-recovery OWNER_JSON NEW_RECOVERY_JSON PRIVATE_PASSPHRASE_FILE
node tools/fork/media-sync-enrollment.mjs enroll RECOVERY_JSON DESKTOP_CREDENTIAL_JSON https://your-reviewed-host.example NEW_DESKTOP_BUNDLE_JSON PRIVATE_PASSPHRASE_FILE
node tools/fork/media-sync-enrollment.mjs enroll RECOVERY_JSON ANDROID_CREDENTIAL_JSON https://your-reviewed-host.example NEW_ANDROID_BUNDLE_JSON PRIVATE_PASSPHRASE_FILE
```

The service is still loopback-only; the HTTPS hostname above is a placeholder for a separately approved deployment, not a live host. For local validation both bundles use `http://127.0.0.1:8789`, and an explicitly selected emulator uses `adb reverse`. Trailing newlines in the passphrase file are trimmed; do not rely on trailing whitespace. Files are never overwritten. Keep protected recovery offline, keep passphrase/credential files private and remove disposable plaintext copies when no longer needed. A lost recovery file plus lost client keys cannot be recovered by the server. Restoring an old server backup rotates its generation and pauses uploads; automatic resnapshot/reconciliation remains a later gate. Do not erase a pending outbox merely to bypass that pause.

The desktop importer opens a native file chooser and accepts the passphrase in a masked field. Main-process code decrypts/validates the bundle and stores secrets with Electron safeStorage; keys/tokens never reach the renderer or ordinary settings export. Linux `basic_text`/unavailable secret stores fail closed. Windows DPAPI protects against other OS users, not other processes running as the same user. These OS-provider limits follow [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). No portable secret file is silently imported on startup. Disconnect explicitly forgets local enrollment/sync state while retaining the normal FreeTube library. Server revocation is a separate operator action.

## Durability and compatibility

The vendored protocol/client code is fork-owned AGPL code derived from the owner's platform issue #27; no runtime checkout/service package is imported. A follow-up reference-client fix freezes causal base revisions at edit time and chains later local edits only to acknowledgements of their predecessor. Pulling before upload cannot silently rebase an offline rewind. Network timeouts preserve the exact wire request. The server wire protocol remains v1, compatible with integrated PR #28; the follow-up platform PR changes reference-client behavior, not deployed endpoints.

FreeTube uses separate NeDB files, so this is **not** a cross-file atomic transaction claim. A SQLite write-ahead projection journal commits remote state/cursor first, then idempotently applies NeDB writes under the same local-write gate. Pending projections replay on subsequent app reads/writes/sync. If a crash is followed by a different local edit, recovery preserves it as an intent with the old causal base rather than overwriting or falsely acknowledging a remote change. Snapshot/baseline and outbox batches commit together. Local source files remain durable if optional capture fails; a later scan retries, and no background network loop runs. Room on Android uses one transaction instead.

Existing service bounds remain: 1,000 pending intents, 5,000 server records, 10,000 changes, 20,000 receipts, 100/page and 16 enrolled devices per owner. There is no pruning/compaction scheduler. A large initial library can hit the outbox/storage limit and must fail visibly; this first slice does not silently truncate. Prototype fixture state is not a promised production migration path; normal app NeDB files are preserved, and sync metadata uses its own new files. Personal installs still need the separate identity/upgrade/distribution review; validation uses isolated profiles, never an existing upstream FreeTube profile.

## Repeat validation

Use the unchanged Node 24 / pnpm 10 frozen baseline toolchain. `pnpm run lint`, `pnpm run lint:media-sync`, `pnpm run test:media-sync` and `pnpm run pack` cover the product source. To create an unsigned unpacked Windows artifact with the existing upstream packaging configuration:

```text
pnpm exec electron-builder --config _scripts/ebuilder.config.mjs --dir --win --x64 --publish never
```

Do not invoke electron-builder without that configuration: its default excludes the expected application entry and fails. No installer or release is run/published.

For the original emulator cross-client evidence, build/install only the Test APK and instrumentation APK on a named `DD_Player_Foundation_API36` emulator. By default the harness rejects physical devices and any other AVD; the separately authorized fresh-phone entry point is documented below. It touches the Test app's sync state and only its synthetic channel/checkpoint rows; never run it on a personal profile. From this repository, after explicitly installing the matching Android Test builds:

```text
node tools/fork/setup-media-sync-validation.mjs PLATFORM_CHECKOUT D:/tmp/dd/NEW_ENROLLMENT_DIRECTORY
node tools/fork/validate-media-sync.cjs build/win-unpacked/FreeTube.exe D:/tmp/dd/NEW_EVIDENCE_DIRECTORY D:/tmp/dd/NEW_ENROLLMENT_DIRECTORY PLATFORM_CHECKOUT ADB_EXECUTABLE emulator-5580
```

The harness uses the actual packaged executable, native protected import/OS vault, production renderer IPC and real Android default Room database/Keystore. The only desktop UI stub selects the synthetic enrollment file in the native chooser; sandbox flags are untouched, and OS protocol registration is suppressed for this test process as in baseline validation. The actual UI import and Sync now controls are exercised. It tests bidirectional subscription/resume, removal/rewind, both clients offline, Android process-stop retry, explicit concurrent-resume resolution, real 901→902 Room migration and Android settings in portrait/landscape. Raw profiles/DBs/credentials/logs/screenshots stay in private scratch; portable allowlisted evidence is recorded separately. This is app metadata evidence, not a new A/V, speaker or provider playback qualification.


## Physical-phone follow-up

Approved PR #5 is integrated into main at c3892fc0bb1fd8231b734a85be710660b34154b0;
player #18 and platform #29 are also merged. The authorized fresh-phone Test
install now passes actual cross-client subscription/resume, remove/re-add,
rewind, offline/process-stop recovery, explicit conflict, native enrollment/
Sync now and disconnect checks. See [PHONE_VALIDATION.md](PHONE_VALIDATION.md)
and [phone-evidence.json](phone-evidence.json) for the guarded helper, exact
scope and remaining provider/hosting gates. The Test app is left disconnected;
the normal synthetic library remains local. An existing personal app/profile
is never reset by the fresh-phone helper.

For an explicitly approved fresh physical tablet, use the same guarded helper
with --approved-fresh-tablet, a separate enrollment/evidence directory and the
matching ARM64 Test APKs. Both approval flags preserve existing-package refusal;
the raw report identifies phone versus tablet. Obtain a device handoff from any
other active device-testing chat before installing/launching. The historical
MediaSyncPhoneValidationTest class supports physical ARM64 tablets on API29+;
the product's sync minimum remains Android26. The Fire API30 import compatibility
fix and pending display proof are tracked in player #17 / PR #19.