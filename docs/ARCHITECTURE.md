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
**Decision:** Local HTTP server callback on an ephemeral loopback port, with PKCE

**Implementation:**
- Spin up a temporary HTTP server bound to `127.0.0.1:0` (OS-assigned port)
- Generate state parameter for CSRF protection
- Generate a PKCE code verifier; send only the S256 challenge on the auth URL
- Open browser to Google OAuth consent screen
- Receive callback with authorization code
- Exchange code for tokens, presenting the code verifier
- 5-minute timeout for user authorization

**Rationale:**
- More reliable than device flow for desktop use
- Works in standard development environments
- State parameter prevents CSRF attacks
- PKCE (RFC 7636) is what makes a *public* client safe. Since the shipped
  client secret is published in the npm package (see "Shipped OAuth client"
  below), the secret cannot gate the code exchange — the verifier, which never
  leaves the process, does.
- The ephemeral port (RFC 8252 §7.3) removes the predictable target that made
  the pre-bind squat practical: with a fixed 8089, a local process claiming the
  port first would receive the code and could redeem it with the published
  secret.
- `127.0.0.1` rather than `localhost` (RFC 8252 §8.3), because name resolution
  can be redirected by a tampered hosts file.

**Superseded:** originally a fixed `localhost:8089` with no PKCE. Changed
2026-08 after a responsible-disclosure report about the embedded client secret
surfaced the missing compensating control.

**Consequence:** `startAuthFlowAsync` must await the bind before it can name
the assigned port in `redirect_uri`, so it — and `AccountStore.startAddAccount`
/ `startReauthAccount` — are async.

### Shipped OAuth client
**Decision:** Embed a public Desktop-app client ID *and secret* in the package;
BYO credentials become an override rather than a requirement

**Implementation:**
- Constants in `src/auth/oauth-defaults.ts`
- `resolveOAuthConfig()` resolves env vars → config file → shipped defaults

**Rationale:**
- Requiring a Google Cloud project before first run was the largest install barrier
- Desktop-app clients are public clients (RFC 8252); Google documents their
  secret as not confidential, and `gcloud` / `gh` / VS Code ship one the same way

**Consequences, accepted:**
- The secret is permanently public and rotation is not a remediation — a
  replacement ships in the next tarball. Scanners will keep flagging it;
  `SECURITY.md` exists so those reports are self-service.
- Anyone can build on this client ID and show users our verified consent screen,
  and consume our API quota. PKCE does not prevent either.
- This reverses a decision `docs/SPEC.md` §10 recorded as non-reversible; that
  section now logs the reversal and its costs.

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

### Calendar Conferencing (v0.9.0)
**Decision:** Model conferencing as one `ConferencingRequest` union, translated by a single `buildConferenceData`, and send `conferenceDataVersion: 1` only when conferencing was actually requested.

**Rationale:**
- Google accepts conference data two mutually exclusive ways, and they do different things. `createRequest` mints a **new** conference; its only fields are `requestId` (an idempotency key) and `conferenceSolutionKey`, so **the API offers no way to request a specific meeting code**. `conferenceSolution` + at least one `entryPoint` **attaches an existing** conference — the documented "copy `conferenceData` from one event to another" path, and the API equivalent of the Calendar UI's edit-the-meeting-ID pencil. A union type makes it impossible to send both.
- At `conferenceDataVersion: 0` (Google's default) conference data in the request body is *silently ignored*. Sending version 1 unconditionally would instead make our body authoritative over conference data we do not model, so the parameter is attached only to requests that actually carry a conferencing change.
- Conference creation is asynchronous: an insert can return `status.statusCode === 'pending'` with no entry points. `settleConference` re-reads the event **once** in that case. Once rather than a poll loop — the pending window is short and an MCP tool call is the wrong place to block; a conference still pending after the re-read is reported as pending rather than hidden.
- Reusing an existing meeting code is gated behind `confirm: true` while `addMeet` is not. This is not symmetric caution: Google's guidance is that a reused conference keeps its access bound to the *original* event's guest list, so participants of that event may reach the new meeting's recordings and chat. That is a data-exposure consequence, which is the same bar the send and share gates use. A freshly created conference carries nothing with it and needs no gate.
- Meeting codes are validated against Meet's `xxx-xxxx-xxx` shape before any API call. Passing a typo through produces an event whose join button leads nowhere, which is strictly worse than a rejected call.

### Calendar updates use `events.patch`, not `events.update` (v0.9.0)
**Decision:** `CalendarClient.updateEvent` sends `events.patch` with only the fields the caller changed.

**Rationale:**
- `events.update` is full replacement, so the previous implementation had to `events.get` the whole event and echo every field back. Because the read was immediate, that round-tripped current state rather than clobbering it — but it is a read-modify-write, so a concurrent edit landing between the get and the update is lost. Patch changes only the named fields and cannot lose one.
- This is a genuine trade rather than a clear win, and the original rationale here overstated it. Google's reference explicitly prefers get+update: a patch costs three quota units against two. Google's "may inadvertently remove existing conferences" warning is also narrower than first written — it addresses apps that keep events in local storage and write back stale copies, not `events.update` as such.
- **Patch merges nested objects.** Sending `start: {dateTime}` at an event that currently has `start: {date}` leaves both set, which Google rejects, so converting between all-day and timed events fails. `buildEventDateTimeForPatch` nulls the mutually exclusive sibling explicitly; `timeZone` is nulled only when converting to all-day, so a caller changing just the start time does not silently lose the event's zone. Any nested field added to this body needs the same care.
- `sendUpdates` is `'all'` for every update except a colour-only one (see the colour entry below; it was unconditional until v0.10.0). Google notifies guests, and an event with no guests has nobody to notify, so this needs no attendee lookup — and a time change on a meeting with guests now always reaches them. The tool layer still reads the event when it needs an attendee *count* for the confirm gate, which is a separate concern from what the API call sends.

### Event colours (v0.10.0)
**Decision:** Surface `colorId` on every read path, accept it (by id or Calendar UI name) on create and update, add `resetColor`, and add `calendar_list_colors` — and make a colour-only update the single write on this server that neither notifies attendees nor asks for confirmation.

**Rationale:**
- The read-path gap was the same defect as `Cc` (v0.8.0) and `conferenceData` (v0.9.0): `convertCalendarEvent` hand-whitelists fields, and `colorId` was not among them. Google had been returning it all along. Three instances of one bug in three releases is the argument for the whitelist itself being the problem, not any single missing field.
- **Notifications are suppressed for a colour-only patch, and the confirm gate is skipped with them.** An event's colour is the organiser's view of their own calendar — a guest's copy is coloured by that guest's settings — so a notification would be mail about a change the recipient cannot see. The use case is recolouring a run of existing events; at `sendUpdates: 'all'` that is one email per event per guest, and with the attendee gate in place it is also one `confirm` per event. The gate exists because guests get mailed; when nobody is mailed it has nothing to authorise. Anything a guest *can* see keeps `'all'`.
- The decision is made from the **built patch body** (`isColorOnlyPatch`), not from the caller's arguments, so a field added to the body later cannot inherit the silent path by accident.
- **`colorId: null` is the reset**, verified live against Google: the field clears and the event falls back to its calendar's colour. An empty string is rejected as an invalid colour id, so null is the only expression of "no colour" — which is why updates take `EventUpdate` (`colorId?: string | null`) rather than `Partial<EventInput>`.
- **Colours are validated locally against 1-11.** Google answers anything else with a bare `Invalid color id value.` that names neither the valid range nor the existence of names. Rejecting locally costs no API call.
- **The Calendar UI names are not API data.** `colors.get` returns ids and hex pairs only; "Tomato" and "Basil" exist nowhere in the API, yet they are what a person asking for "the red one" means. The map lives in `src/calendar/colors.ts`, cross-checked against the hex Google returns, and is event-only: the calendar palette has 24 entries and different ids for the same names (Tomato is event 11, calendar 3).
- **`calendar_list_colors` is gated on `calendar:read`, not the read-or-write gate.** Google's per-method scope list for `colors.get` accepts `calendar` and `calendar.readonly` but **not** `calendar.events`, so an account holding only `calendar:write` genuinely cannot make the call. Offering the wider gate would have produced a 403 in place of this server's capability error.
- **`eventLabelVersion` is left at its default of 0.** Version 1 switches Google to `eventLabelId` and makes it ignore `colorId` entirely. Event labels are a separate feature and are not modelled here.
- Verified live against a real account before release, per the standard the last three calendar changes were held to: palette shape and names, create with a colour, colour on `events.get` and `events.list`, recolour, reset to default, and a colour surviving an unrelated patch.
