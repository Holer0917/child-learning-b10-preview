# Explicit profile entry (preview only)

2026-10-31: a newly opened tab must select an existing profile or create one before entering Home. No automatic default profile is created during boot. Valid routes show the entry screen until confirmation. The current tab remembers the confirmed profile ID in path-scoped sessionStorage; refreshing an ongoing practice retains the existing recovery flow. If sessionStorage is unavailable, confirmation lasts for the current document only. Switching/deleting/importing profiles cannot bypass an ID mismatch.

The main navigation now has five entries: practice, history, mistakes, stats, and data management. Profile management is accessed using the personal-information chip at the top. The entry screen hides feature navigation. Selecting a different profile preserves the existing unfinished-session confirmation; choosing the current profile does not discard its session. Creating from the entry screen selects the new profile and enters Home.

Readable entry/profile UI sources live under authoring; generated runtime files remain at their existing URLs. Build instructions are in authoring/README.md. Browser code has no new dependency. The original 300000-byte non-PNG runtime budget remains unchanged.

Validation: tests/profile-entry.cjs covers 360/390/1440px creation, explicit selection in new tabs, refresh, blocked sessionStorage, switching cancellation, draft preservation, deleting the final profile, navigation and offline entry. tests/profiles-backup.test.mjs covers 21 domain/backup/isolation/failure cases. All browser data is synthetic and isolated; no physical-device acceptance is claimed.
