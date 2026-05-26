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

### Scope Tiers
**Decision:** Three predefined scope tiers for incremental authorization

**Tiers:**
- `readonly`: gmail.readonly + userinfo.email (default)
- `compose`: gmail.compose + readonly scopes (send/draft)
- `full`: gmail.modify + userinfo.email (labels, archive, etc.)

**Rationale:**
- Least privilege by default
- Clear upgrade path as needed
- Maps to common use cases

### Caching Strategy
Decision: [TBD during Phase 2]

### Shared Drive Support
**Decision:** Always pass `supportsAllDrives: true` (and `includeItemsFromAllDrives: true` + `corpora: 'allDrives'` for list/search) on every Drive API call — no opt-in flag.

**Rationale:**
- Google Drive v3 defaults both flags to `false`, so any call against a Shared Drive item returns "File not found" or empty results. Making this opt-in just gave users a new way to fail silently.
- Personal-Drive users see no behavioral change — the flags are no-ops when no Shared Drives are involved.
- An optional `driveId` arg on `drive_search_files` narrows to a single Shared Drive (`corpora: 'drive'`); omitting it searches My Drive + all Shared Drives the user is a member of.
- `drive_list_shared_drives` (wrapping `drives.list`) exists so agents can discover Shared Drive IDs to pass as `folderId` (browse top level) or `driveId` (scoped search).
- The existing `drive_readonly` / `drive_full` OAuth scopes already cover Shared Drive access; no new consent step needed.
