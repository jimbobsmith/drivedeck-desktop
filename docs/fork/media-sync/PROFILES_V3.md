# Subscription profiles — integrated native support; browser extension under review

Work items: [platform #43](https://github.com/jimbobsmith/drivedeck-platform/issues/43), [desktop #12](https://github.com/jimbobsmith/drivedeck-desktop/issues/12), [Player #32](https://github.com/jimbobsmith/drivedeck-player/issues/32). Parent: platform #27 / DriveDeck #244.

## Meaning and consent

FreeTube profiles are named, colored subsets of the global **All Channels** subscriptions. They are not separate accounts: watch history, resume positions, playlists and Watch Later remain shared. DD PipePipe reuses its subscription feed groups for this model. Active/default selection and platform-specific group icons/order remain device-local. Same-named profiles have independent random UUID identities; names never merge them. Unsupported non-YouTube membership stays local.

Profile sync has its own per-device confirmation, independent of enrollment and expanded-library v2. Installing an updated app never enables it. Once a profile or membership record has been accepted, incapable v1/v2 clients are rejected before state/changes reads or writes. This remains true after profiles are deleted because tombstones retain the barrier. Pending intent and cursors remain intact. The confirmation discloses this owner-wide compatibility effect.

Native profiles are integrated in platform PR #44, desktop PR #14 and Player PR #33. The [browser editor/import extension](IMPORTS.md) adds profile-capable browser requests; older portals remain blocked for profile-enabled owners. Account/enrollment routes retain their existing behavior. No deployment is claimed.

## Encrypted contract

The authenticated envelope, routing HMAC, enrollment, paths, key epoch and service schema remain v1; existing queued v1/v2 request bytes are not migrated. Profile-capable, opted-in native requests carry **x-dd-sync-profiles: 1**, independently of x-dd-sync-library: 2.

- Metadata: kind=profile, provider=youtube, version=3, id=lowercase UUIDv4, name, bgColor, textColor. Name is nonempty, at most 160 UTF-8 bytes and has no ASCII controls. Colors are #RRGGBB hex strings. Client snapshots normalize colors to uppercase.
- Membership: kind=profile-member, provider=youtube, version=3, id=profileId + colon + channelId, profileId=UUIDv4, channelId=canonical UC followed by 22 valid ID characters.

Both shapes reject unknown fields. One encrypted membership per channel avoids a whole-profile channel cap under the unchanged 4 KiB ciphertext limit. Existing 1,000 pending intents, 5,000 records including tombstones, 10,000 changes and 100/page bounds still apply and fail visibly without truncation. A 250-member profile is covered by actual desktop datastore tests; an initial library can still hit the existing global outbox quota.

Metadata rename/color conflicts use explicit causal revision resolution. Independent membership additions/removals have separate records. Deleting a profile suppresses even concurrent or later-arriving members of that UUID; explicitly creating a new profile uses a fresh UUID. Membership cannot recreate a deleted definition or silently subscribe a channel globally. Clients retain deferred membership when it arrives before its separate global subscription; projection can complete after another page or restart. An explicit global unsubscribe prunes visible and deferred subset membership. Profile membership removal leaves the global subscription intact.

Desktop stores fork-owned identity/deferred fields beside existing NeDB profiles and uses its existing SQLite projection journal, not a cross-file ACID transaction. Android preserves identities/deferred members in fork-owned Room metadata and uses a schema migration for profile colors. Disconnect keeps library/profile mappings but forgets enrollment-specific sync state. No provider credentials, channel titles/thumbnails, resolved URLs, local paths, playback actions or OS settings are added to shared records.

## Compatible rollout and evidence

Native source is integrated through platform PR #44, desktop PR #14 and Player PR #33. Integration is not publication: the last verified private image remains 9bae1c9, predating profiles. Record compatible service/client release versions before enabling profiles. Browser/import issues #45/#15/#38 remain review candidates.

1. Review/merge the compatible service and both client adapters, then publish the client builds with exact versions and service image digest recorded.
2. Back up the operator-owned service with its existing consistent-backup procedure. Deploy the compatible service first, then update every native client that must retain access. Hosting/NAS installation needs its separate authority/evidence.
3. Only after those versions are confirmed, enable profiles separately on each native device and use manual Sync now. Use a released compatible browser editor; older portals retain the profile barrier.

Actual dedicated synthetic Android runtime evidence now passes 11 profile Room/UI cases plus the 901→903 migration on implementation 4c63f85a0dcc3df7223f046ded6b4e76c028c1cc. It covers more than 100 members, deferred/restart projection, unsubscribe/tombstones, unsupported local membership, active-profile actions/reactive feeds, selected-profile fallback and portrait/landscape editor/consent. Production desktop-generated AES-GCM/HMAC vectors decrypt on Android; Android-produced public synthetic metadata/member vectors decrypt and route in the production desktop/native/WebCrypto implementations. This is dedicated virtual-runtime evidence, not personal-library or physical-device qualification. The public vectors contain intentionally published synthetic keys and must never be used for real enrollment.

Service tests cover native/WebCrypto profile interoperability, strict shapes/UTF-8 limits, independent opt-in, rename conflicts, member removals, retry/idempotency, v1/v2 cursor/pending preservation and native/portal tombstone barriers. Desktop tests exercise actual NeDB handlers, 250 memberships, same-name/copied identities, rename/colors, local-only membership preservation, deferred page/restart behavior, global unsubscribe, orphan suppression, local edits after interrupted projection and active-selection fallback.

Physical phone/Fire/TV profile UI, personal-library migration/upgrade, hosted HTTPS/NAS deployment, restore reconciliation and retention remain open field gates. These tests do not qualify provider playback. No personal device, production service or existing user profile is modified.
