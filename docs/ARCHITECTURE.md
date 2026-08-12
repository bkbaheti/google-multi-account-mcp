# Architecture

## Design Decisions

### Token Storage
**Decision:** Dual-backend with automatic fallback

**Implementation:**
- Primary: OS keychain via `keytar` (Windows Credential Manager / macOS Keychain / libsecret)
- Fallback: AES-256-GCM encrypted files with PBKDF2-derived keys

**Details:**
- `TokenStorage` interface abstracts both backends
- `createTokenStorage()` tries keychain first, falls back to encrypted file
- Encrypted file backend requires `MCP_GOOGLE_PASSPHRASE` env var
- Tokens stored at `~/.config/mcp-google/tokens/`
- Each account's token in separate encrypted file (filename is sha256 hash of accountId)
- PBKDF2 with 100,000 iterations for key derivation

**Rationale:**
- Keychain provides OS-level security and cross-application protection
- Encrypted file fallback enables use in containers/headless environments
- Per-account isolation prevents cross-account data leakage

### OAuth Flow
**Decision:** Local HTTP server callback (port 8089)

**Implementation:**
- Spin up temporary HTTP server on localhost:8089
- Generate state parameter for CSRF protection
- Open browser to Google OAuth consent screen
- Receive callback with authorization code
- Exchange code for tokens
- 5-minute timeout for user authorization

**Rationale:**
- More reliable than device flow for desktop use
- Works in standard development environments
- State parameter prevents CSRF attacks

### Scope Tiers (superseded, see Capabilities below)
**Decision:** Three predefined scope tiers for incremental authorization

**Tiers:**
- `readonly`: gmail.readonly + userinfo.email (default)
- `compose`: gmail.compose + readonly scopes (send/draft)
- `full`: gmail.modify + userinfo.email (labels, archive, etc.)

**Rationale:**
- Least privilege by default
- Clear upgrade path as needed
- Maps to common use cases

### Capabilities (v0.5.0, replaces Scope Tiers)
**Decision:** Replace the tier model (`mail_readonly`, `drive_full`, `calendar_full`, ...) with eight independent per-service capabilities (`mail:read`, `mail:compose`, `mail:modify`, `mail:settings`, `drive:read`, `drive:appfiles`, `calendar:read`, `calendar:write`). Operation gates check required capabilities directly; there is no tier-to-scope lookup table.

**Why:** The tier model as it grew past Gmail encoded a tier-to-scope-set table with an implication list (`SCOPE_IMPLIES`) that turned out to assert two false things about Google's OAuth scopes:
- `drive.file` implies `drive.readonly`. It does not — `drive.file` grants per-file access to files the app itself created, `drive.readonly` reads everything in the account, and neither is a subset of the other. This silently defeated the scope gate protecting `drive_get_comments`, the exact tool it was meant to guard, and made `drive_search_files` return an empty result set instead of a scope error.
- `calendar.events` implies `calendar.readonly`. It does not — Google's method-level scope list shows `calendar.events` authorizes neither `calendarList.list` nor `freebusy.query`. Accounts holding only `calendar.events` passed the old gate for `calendar_list_calendars` and `calendar_freebusy` and then failed at the Google API instead.

Both were live bugs, not just an awkward abstraction. A tier system that infers coverage from tier names is only as correct as its implication table, and Google's scopes don't compose the way tier names suggest.

**Design choice — derive, don't store:** `capabilitiesOf(scopes)` (`src/auth/capabilities.ts`) computes an account's capabilities from its already-persisted OAuth scopes on every check, rather than storing a capability set in the account record. This means no config migration was needed when this shipped — every existing account's capabilities are correct the moment the new code runs.

**Correction (v0.5.1) — the `drive.file` lockout was a bug, not the fix taking effect:** the paragraph above previously claimed an account holding only `drive.file` "never should have had" the Drive read tools and had "no way to pass" a correct gate. Both claims were false, and verifying them against Google's per-method scope reference (not the scope *description* page) is what this project got wrong three times on this branch — see `docs/superpowers/HANDOFF-2026-08-11.md`. `drive.file` genuinely authorizes `files.get`, `files.export`, `files.list`, `comments.list`, and `replies.list` — only `drives.list` rejects it. So eight of the nine Drive read tools (`drive_get_file`, `drive_get_file_content`, `drive_get_full_file_content`, `drive_download_file`, `drive_get_comments`, `drive_get_comment_replies`, `drive_search_files`, `drive_list_files`) now accept `drive:appfiles` as an alternative to `drive:read`; only `drive_list_shared_drives` still requires `drive:read`. See `docs/superpowers/specs/2026-08-11-capability-correctness-and-ux-design.md` (the verified scope matrix) and `CHANGELOG.md` (v0.5.1) for the full gate-by-gate correction.

**Implication policy:** `CAPABILITY_IMPLIES` holds exactly one entry, `mail:modify` ⇒ [`mail:read`, `mail:compose`], because Google documents `gmail.modify` as including both read and send/draft access (`users.drafts.create` and `users.messages.send` both accept `gmail.modify`). No other implication exists — deliberately not for Drive or Calendar — and none should be added without checking Google's method-level scope reference first; a false entry here silently disables a gate, which is exactly how the pre-v0.5.1 gates failed.

### Caching Strategy
Decision: [TBD during Phase 2]

### Shared Drive Support
**Decision:** Always pass `supportsAllDrives: true` (and `includeItemsFromAllDrives: true` + `corpora: 'allDrives'` for list/search) on every Drive API call — no opt-in flag.

**Rationale:**
- Google Drive v3 defaults both flags to `false`, so any call against a Shared Drive item returns "File not found" or empty results. Making this opt-in just gave users a new way to fail silently.
- Personal-Drive users see no behavioral change — the flags are no-ops when no Shared Drives are involved.
- An optional `driveId` arg on `drive_search_files` narrows to a single Shared Drive (`corpora: 'drive'`); omitting it searches My Drive + all Shared Drives the user is a member of.
- `drive_list_shared_drives` (wrapping `drives.list`) exists so agents can discover Shared Drive IDs to pass as `folderId` (browse top level) or `driveId` (scoped search).
- The existing `drive:read` (reading Shared Drive content) and `drive:appfiles` (writing to it) capabilities already cover Shared Drive access; no new consent step needed.
