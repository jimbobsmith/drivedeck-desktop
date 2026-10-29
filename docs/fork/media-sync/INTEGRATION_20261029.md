# Import and campaign integration, 2026-10-29

Tracked by issues15/17. Import PR16 is merged at `5dbcf0a24bb09018a141f3852bb8152f36385b4e`.
The companion campaign PR contributes test drivers and historical receipts.
Product source remains the reviewed import source; changes needed to combine the
branches preserve both documentation additions. Combined-source validation is
recorded below after its frozen-input checks complete.

The source review was performed independently by DD HQ merge coordinator
`/root/merge_sync_batch` at the recorded PR heads. No blocking product finding was
reported in the inspected archive/projection/journal/Room/IPC/isolation paths.
The one reporting finding (a future runner falsely claiming import exclusion) is
fixed separately in platform48. Formal GitHub approval is not claimed. Required
checks are not bypassed; merge authority was verified from the human in DD HQ.

The original14 runtime scenario rows used their original baseline SHAs and did
not include these import candidates. Prior import UI and3 Room tests have their
own exact inputs. These receipts are reused only for unchanged relevant inputs;
they are not a fresh combined-source runtime campaign. Sync remains manual, with
no general settings kind. Nonempty playlist/Watch Later cross-app roundtrips,
Android import Activity orientation, personal libraries/provider metadata and
NAS/LAN/private-pull/reboot/restore remain field gates. No release, image
publication, NAS action or device installation is part of this integration.

Final merge IDs/authoritative branch heads are recorded on the linked issues;
implementation and test/doc ancestry are verified after GitHub merges.

Combined checked input `b5e9a3944c0f3456341d70005669aeab28ff0970` passes32 actual-store/sync/import tests and scoped ESLint. Full staged ESLint/stylelint merge hooks pass. Production source/static/package/lockfile inputs are identical to the reviewed merged import main. Later evidence commits are docs only; current hosted packaging/sync checks must pass before the final merge. See `integration-evidence-20261029.json`.
