# Library imports and browser categories (2026-10-27 review candidate)

Tracking: platform #45, desktop #15, Player #38; parent DriveDeck #244.
Native profiles are integrated in platform PR #44, desktop PR #14 and Player PR #33. This extension is under review, not released or deployed. All field-validation issues remain open.

## Categories and appearance

Categories are named, colored subsets of All Channels, separate from video playlists. A channel may belong to several categories. History, progress, playlists and Watch Later remain shared. PipePipe uses feed groups; desktop uses FreeTube profiles. Active selection, icons and ordering remain local.

The signed-in, unlocked portal adds category creation, rename, colors, membership and deletion. Removing categories keeps global subscriptions. Global unsubscribe removes known memberships. Deferred members waiting for a global subscription are shown separately and retained on rename; removing them requires an explicit checkbox.

Portal Appearance offers System, Light and Dark. System has independent light/day (Paper or Warm) and dark/night (GitHub, Midnight or Dimmed) presets, reacts live to OS changes and defaults to GitHub dark. Appearance stays in that browser. Native import screens use the app's existing theme. Installation/import never changes sync enrollment or opt-ins.

## File support

- Current FreeTube v0.25.3 subscription/profile, playlist and history `.db` exports are UTF-8 NDJSON, not SQLite. A trailing newline is optional; equivalent identified JSON objects/arrays work. Empty files/arrays are no-ops. Older playlists lacking `_id` require conversion through current FreeTube; the unified importer rejects them visibly.
- PipePipe/NewPipe subscription JSON imports canonical YouTube subscriptions. That format contains no categories, history or lists.
- PipePipe full ZIP reads only `newpipe.db`, known ordinary tables/columns, schema versions 1-903: subscriptions, groups/memberships, local playlists, latest watched timestamp per video and progress. Missing older color columns receive defaults. Views, generated/virtual tables, malformed/future schemas fail closed.
- FreeTube Watch Later uses `_id: watchLater`. DD PipePipe recognizes only the special-list UID in `dd_media_sync` row 2. A stock playlist merely named Watch Later remains ordinary. Remote bookmarked playlists without local contents are reported omitted.

Only canonical YouTube IDs and recognized HTTPS content URLs are portable. Other providers/unresolved aliases are reported unsupported; no provider lookup occurs. Imported labels use IDs; metadata hydration remains an existing field gate. Credentials, cookies, settings, downloads and search history do not transfer.

## Use and merge rules

Choose Import exports in the portal, Import library exports in desktop Data Settings, or the new library import entry in Android's existing backup/content settings. Select files, review counts/omissions and explicitly confirm. Cancel leaves the source unapplied. Android accepts custom FreeTube file MIME types through content validation.

Existing category/list names and colors win. Existing progress wins. History keeps the latest timestamp. Lists retain current order and append missing occurrences, preserving duplicates. Imports never delete items or replace the live database. Existing mixed-provider/oversized native collections stay untouched during unrelated imports; an import touching such a collection fails for review.

Identities derive from source IDs, never names. Foreign ddSync IDs, enrollment and local-only fields are ignored. Desktop recognizes its own current local export IDs without changing sync identities. PipePipe group/list identity uses the exact database hash plus UID: the same backup repeats idempotently; a different backup creates separate categories/lists, as disclosed in preview. Browser tombstones stay removed.

Bounds: 20 files / 64 MiB aggregate; 5,000 portable records; 200 occurrences per list; 160 UTF-8 bytes per name; 1,000 changes per confirmation. Source array/table and ZIP limits also apply before normalization. Limits reject visibly, without truncation. Browser parsing times out after 30 seconds. Existing server tombstone/record/log quotas remain; smaller selections may be needed.

## Privacy and recovery

Browser files parse in a disposable local worker. Raw backups never upload; only confirmed encrypted mutations go to the service. Java-serialized `newpipe.settings` is never deserialized. Only the special-list mapping row 2 is examined; enrollment row 1 is not read. Native SQLite is read-only in an owned temporary location, cleaned afterward. Android changes and mappings commit in one Room transaction.

Browser pending v1 remains readable. New v2 batches retain exact encrypted wire bytes across reload/offline/rate limits. Continue sends at most 60 changes per action. Key/owner/generation/epoch mismatches block retry. Conflict choices keep browser, keep server for only this item, or separately discard the remaining batch; accepted changes stay. Export the encrypted batch first when recovery is needed.

Desktop NeDB is not cross-file ACID. A private SQLite journal records approved changes, write intents and acknowledgements. Resume skips acknowledged items and recomputes remaining additive work against current data. Intervening renames/progress remain. If an acknowledged item was deleted or an interrupted write cannot be proved satisfied, Resume stops for fresh review: keep the partial result, discard the unfinished journal, and select exports again for a new preview. Discard never undoes applied records. Synthetic close/reopen and deletion cases cover this boundary; personal-library migration remains unqualified.

## Browser SQLite provenance

The ZIP worker lazily loads locally vendored sql.js 1.15.2 (MIT); no CDN or server runtime dependency. Official tarball: https://registry.npmjs.org/sql.js/-/sql.js-1.15.2.tgz ; documentation: https://sql.js.org/documentation/ . License is beside the assets.

Verified npm integrity: `sha512-ZmMYFsZPZWDKIJUh3A5rdnpRV3hB/r7AijwAzSzLnfv/9CSx4obUmDtA8brAjWJWjGtUVh43nIEJ+6nl6HuOUg==`

SHA-256:
- sql-wasm.js: `b46d4bddfdde8a787fc4764bd0a405cdfdf96fbd77e6a4e95446106826ecfa47`
- sql-wasm.wasm: `0dfeecda2070b36da0cd4f6afa250af9453de528a983770f85b13d5d6b667572`

CSP permits same-origin workers and WASM compilation, without general unsafe-eval. Desktop uses Node 24 SQLite; Android uses existing SQLite/Room. org.json 20240303 is JVM-test-only, not a runtime dependency. Provider/source registry is unchanged: these are operator-selected local exports.

## Evidence and rollout gates

See `import-evidence.json`. Tests cover shipped WASM and native SQLite with DEFLATE descriptor ZIPs, explicit Watch Later mapping, 6,001 dated history observations, NDJSON, quotas, deferred members, encrypted batches and actual NeDB recovery. All three new Android Room rollback/reimport/mixed-provider methods subsequently passed on the isolated owned AOSP guest; Player PR39 retains the source/artifact/runtime receipt.

The initial browser attachments timed out; attachment later recovered and the actual FreeTube worker chooser/preview/Cancel/Confirm/reimport, independent themes and phone/landscape browser layouts passed. A real modal close-event race was fixed. Desktop actual import UI subsequently passed five synthetic button/IPC/parser/journal/store checks; only the native chooser selection supplies generated fixture paths. These checkpoints do not qualify PipePipe ZIP browser/desktop UI or Android import Activity portrait/landscape. Personal libraries, provider metadata and NAS/private-pull/reboot/restore gates remain open. No personal device was enumerated or selected.

Last verified private image remains source 9bae1c9, digest `sha256:c1589ea4c6e67c22d571158f533483094a1f61cb636c78f83f078f7dd1ec351f`. It predates profiles/imports. Review and authorized merges, separately approved image/client publication, NAS installation, compatible updates on every client and explicit enrollment/opt-in must precede personal use. No new release/deployment is claimed.


## Real Electron UI evidence, 2026-10-28

The real unsigned unpacked application on production source61c2705 passes five
synthetic UI checks: FreeTube multi-file preview is read-only; Cancel retains the
actual stores; Confirm adds the category/membership separately from playlists,
preserves duplicate list entries and imports Watch Later/history/progress; repeated
import is a no-op; PipePipe subscription JSON previews and commits correctly.
Buttons and status/preview text are exercised in the actual Settings/Data screen,
through production preload IPC, parser, import journal and NeDB stores. No sync
enrollment or provider request is needed. Screenshot capture waits for full paint;
the earlier fade-transition capture is retained and excluded as visual proof.

The native file chooser is the only substituted boundary: it returns generated
synthetic fixture paths. Native chooser interaction and PipePipe ZIP selection in
this desktop UI are not claimed. Parser/archive tests remain separate evidence.
No personal profile/provider content is read or written. The normal Electron
sandbox remains; protocol registration and external network are suppressed only
inside this isolated QA process. App exit0 and owned PID termination were verified.
[Expected/observed receipt](import-ui-validation-20261028.json) includes exact
source/app/driver/fixture/capture hashes and the remaining field gates.

After the normal frozen production pack/unpacked build, run in an English-locale
Windows test environment (Node24; no installer, signing or publication):

```powershell
node tools/fork/import-ui.cjs D:/tmp/dd/library-sync-20261020/drivedeck-desktop D:/tmp/dd/import-ui-NEW
```

The output directory must be new and under D:/tmp/dd. The helper creates its own
fixtures and appData/userData/session/log/crash directories there, drives the real
UI/store checks, records results/screenshots/exit, and closes its owned app. It
never opens an existing FreeTube profile. Source0d761e5 adds this test driver only;
production build inputs remain61c2705. Review/merge/release and personal-library
gates stay open.


Current cross-repository evidence: [portal UI PR46](https://github.com/jimbobsmith/drivedeck-platform/pull/46), [desktop import UI PR16](https://github.com/jimbobsmith/drivedeck-desktop/pull/16), [Room import runtime PR39](https://github.com/jimbobsmith/drivedeck-player/pull/39). The separate [real-app campaign PR48](https://github.com/jimbobsmith/drivedeck-platform/pull/48) uses integrated production baselines plus test-only drivers, not these import candidates:14 synthetic scenario rows passed, manual Sync only, no general settings kind. It records offline/restart/conflict and history/resume checks, with owned resource handback independently reconciled READY at24/30 attempts. Nonempty playlist/Watch Later cross-app item roundtrips and production-library qualification remain open.
