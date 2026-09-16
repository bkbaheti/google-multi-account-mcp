# Tasks

## Event colours (COMPLETED — v0.10.0)

Reported from another session: the connector returned no `colorId`, so a colour set in the
Calendar UI could not be read back, and there was no way to set one. The report also said
there was no update-event tool; `calendar_update_event` has existed since v0.6.0 — the gap
was only the field.

- [DONE] **`colorId` was dropped on every read path.** `convertCalendarEvent` whitelists
  ~15 fields and `colorId` was not one, so Google's colour never reached a caller. The
  third instance of this exact defect in three releases, after `Cc` (v0.8.0) and
  `conferenceData` (v0.9.0) — same converter, same cause, same fix
- [DONE] `colorId` on `calendar_create_event` and `calendar_update_event`, accepting either
  an id (`"11"`) or a Calendar UI colour name (`"Tomato"`), resolved by `resolveEventColorId`
- [DONE] `resetColor: true` on `calendar_update_event` → `colorId: null`, which Google
  treats as "fall back to the calendar's colour". Verified live; an empty string is rejected
  as an invalid colour id, so null is the only expression of it
- [DONE] **A colour-only update notifies nobody and needs no confirm.** `updateEvent` sends
  `sendUpdates: 'none'` when the built patch body contains nothing but `colorId`, and the
  tool skips the attendee confirm gate in the same case. A guest's copy of an event is
  coloured by their own settings, so a notification would be mail about a change they cannot
  see — and the use case is recolouring a run of events, which at `'all'` would be one email
  per event per guest and one confirm per event. Decided from the built body, not the
  caller's args, so a field added later cannot inherit the silent path
- [DONE] Colours validated against 1-11 before any API call. Google's own error is a bare
  `Invalid color id value.` naming neither the range nor the existence of names
- [DONE] `colorId` and `resetColor` are mutually exclusive and error when combined, matching
  how the conferencing options already behave
- [DONE] `calendar_list_colors` wrapping `colors.get`: the 11 event colours with hex and
  Calendar UI names, plus the 24 calendar colours. Gated on `calendar:read` — Google's
  per-method scope list accepts `calendar` and `calendar.readonly` but **not**
  `calendar.events`, so an account holding only `calendar:write` cannot call it
- [DONE] 37 unit tests written failing first across `calendar-colors.test.ts` (read path,
  create, patch, reset, notification suppression, palette, name resolution) and
  `calendar-tools.test.ts` (schema passthrough, the mutual exclusion, the skipped confirm
  gate, `resetColor` coercion, and the capability the palette tool actually requires)

**Verified live against a real account before release**, the standard the last three calendar
changes were held to — mocks establish nothing about what Google accepts: palette shape and
names, create with a colour, `colorId` on `events.get` and `events.list`, recolour, reset to
default, a colour surviving an unrelated patch, and an out-of-range id rejected locally.

**Not offered, deliberately:** calendar-level colour writes (`calendarList.patch` with
`colorRgbFormat`) — a different resource with a different 24-entry palette in which the same
name has a different id. Event labels (`eventLabelVersion: 1`) are also out of scope; at that
version Google ignores `colorId` entirely, so the default of 0 is what keeps this working.

**Identified, not scheduled:** surfacing the calendar's own `colorId`/`foregroundColor` in
`calendar_list_calendars` (only `backgroundColor` is surfaced today), and a bulk recolour tool
that takes a list of event ids — worth doing only if one-call-per-event proves slow in practice.

## Google Meet conferencing + calendar discovery (COMPLETED — v0.9.0)

Requirement doc: `docs/plans/2026-09-05-calendar-conferencing.md`.

Asked as a question — can the API add a Meet link, can we target a specific calendar, does
the calendar list say which ones are writable — and all three turned out to have a gap
behind them.

- [DONE] **Conference data was dropped on every read path.** `convertCalendarEvent`
  whitelisted 15 fields; `hangoutLink` and `conferenceData` were not among them, so an
  event created in the Calendar UI *with* a Meet link came back through this server with no
  join URL. Google had returned it all along. Structurally identical to the v0.8.0 `Cc`
  bug — a hand-maintained field list losing data the API already sent — and fixed the same
  way, in the one converter every read tool funnels through
- [DONE] `addMeet` on `calendar_create_event` / `calendar_update_event` → `createRequest`
  with a `randomUUID()` requestId and `conferenceDataVersion: 1`. No new scope and no
  reauth: `events.insert` accepts `calendar.events`, which `calendar:write` already requests
- [DONE] `pending` conferences re-read once (`settleConference`), so a caller who asked for
  Meet never gets an event without it. Conference creation is asynchronous; returning the
  insert response verbatim would have looked like a broken feature intermittently
- [DONE] `meetingCode` attaches an **existing** conference (code or `meet.google.com` URL),
  the API equivalent of the UI's edit-the-meeting-ID pencil. Behind `confirm: true`: a
  reused conference keeps its access bound to the original event's guest list, so people
  from that event may reach this meeting's recordings and chat. `addMeet` is deliberately
  ungated — a fresh conference carries nothing with it
- [DONE] Codes validated against Meet's `xxx-xxxx-xxx` shape before any API call. A typo
  passed through produces an event whose join button leads nowhere
- [DONE] `addMeet` / `meetingCode` / `removeConferencing` are mutually exclusive and error
  when combined, rather than resolving by silent precedence
- [DONE] `removeConferencing` on `calendar_update_event` (`conferenceData: null`)
- [DONE] **`updateEvent` switched from `events.update` to `events.patch`.** Update is full
  replacement, so every update read the whole event and echoed it back, rewriting fields
  this server does not model. It is also what made `conferenceDataVersion: 1` unsafe here —
  Google warns a full-body modification can wipe conferences the client failed to
  round-trip. `sendUpdates` is now unconditionally `'all'`, which needs no attendee lookup
  (an event with no guests has nobody to notify) and means a time change always reaches
  attendees
- [DONE] `calendar_list_calendars` paginates (`maxResults` clamped to Google's 250,
  `pageToken`, `nextPageToken`) — it previously passed no parameters and dropped the token,
  so an account with more than 100 calendars silently lost the tail. Adds `canEdit` derived
  from `accessRole`, `summaryOverride`, `selected`, `hidden`, `deleted`, and
  `showHidden`/`showDeleted` passthrough
- [DONE] 70 unit tests across three files: `calendar-conferencing.test.ts` (read path,
  create, attach, patch), `calendar-calendars.test.ts` (pagination, `canEdit` per role),
  `calendar-tools.test.ts` (the confirm gates and mutual exclusion, exercised through
  registered tool handlers rather than only the client)

**Not offered, deliberately:** requesting a *specific new* meeting code. `createRequest`
takes only a `requestId` and a solution type; neither the API nor the Calendar UI can
reserve a chosen code. `meetingCode` attaches one that already exists.

**Verified against Google's per-method reference, not memory** — each of these is easy to
get wrong in the opposite direction: `events.insert` accepts `calendar.events`;
`conferenceDataVersion: 0` ignores body conference data entirely; `createRequest` and
`conferenceSolution`+`entryPoints` are mutually exclusive alternatives; only `meetingCode`
of `{meetingCode, accessCode, passcode, password, pin}` applies to Meet.

**Follow-up — not yet done, and required before release.** Live verification against a real
account. The docs mark `conferenceId`, `conferenceSolution` and `signature` read-only while
simultaneously requiring `conferenceSolution` + `entryPoints` when attaching an existing
conference; that contradiction is resolved only by a real call. Mocks establish nothing
about what Google accepts, which is the standard the last three changes here were held to:
1. Create an event with `addMeet` and read the join URL back
2. Attach an existing code to an existing event and confirm Google accepts the copy shape
3. Update an unrelated field on an event with a conference and confirm the conference survives
4. Remove a conference

**Identified, not scheduled:** resolving a calendar *name* to an ID inside the write tools,
and pre-flighting `accessRole` before a write so a read-only calendar returns a clear error
rather than Google's raw 403. Both cost an extra API call per write and want a cache first.

## Message headers dropped from every read path (COMPLETED — v0.8.0)

Reported from another session: `gmail_get_message` and `gmail_get_thread` returned no `cc` at
any format, while `gmail_get_draft` did. Correctly diagnosed there as header extraction, not
OAuth scope.

- [DONE] Reproduced against live Gmail: a message matching `cc:procedure.tech` came back from
  `gmail_get_message` with no `cc` field at `metadata`, and the same at `full`
- [DONE] Root cause: `gmail_get_message`, `gmail_get_messages_batch` and `gmail_get_thread` each
  inlined `From`/`To`/`Subject`/`Date` when building their response. `convertPayload` had
  preserved every header from the API all along — nothing was ever missing from Gmail's
  response, only from ours. `gmail_get_draft` was the fourth copy of the same list and the only
  one that had been extended with `Cc`/`Bcc`, which is why drafts disagreed with received mail
- [DONE] Single `MESSAGE_HEADER_FIELDS` list in `src/server/gmail-tools.ts`, consumed by all
  four handlers, adding `cc`, `bcc`, `replyTo`, `messageId`, `inReplyTo`. Four copies of a
  whitelist is the defect; the missing `Cc` was the symptom
- [DONE] `metadataHeaders` passed through `getMessage`/`getMessagesBatch`/`getThread` to the
  Gmail API, gated to `format: 'metadata'` where Google honours it, and echoed back as raw
  `headers` so arbitrary requested headers are not swallowed by the named-field set
- [DONE] `getHeader` widened to `Pick<Message, 'payload'>` so draft messages share it
- [DONE] 12 unit tests, written failing first: named-field extraction, case-insensitive header
  matching, omission of absent headers, the deliberate `References` exclusion, and
  metadataHeaders forwarding on the message, thread and batch paths (plus empty-array and
  wrong-format cases)
- [DONE] Verified against live Gmail after the fix — mocks prove nothing about what Google
  returns: `cc` present with two recipients at both `metadata` and `full`, thread messages
  carrying `cc`, and a `metadataHeaders` request returning exactly the named headers

`References` deliberately not surfaced as a named field: it repeats every prior `Message-ID`,
so a thread response would grow quadratically. `metadataHeaders` is the escape hatch.

Observed while verifying, unrelated to this bug: the npx-installed server was still reporting
v0.6.0 / `aa5bbb2` two releases later — the npx cache gotcha already documented in `CLAUDE.md`.

## OAuth Public-Client Hardening (COMPLETED)

Trigger: responsible-disclosure email from Francesco Martignoni (Politecnico di Milano,
2026-08-13), reporting a hardcoded credential at `src/auth/oauth-defaults.ts:10` as part of
an academic study of 69,104 public MCP servers.

**Triage: the reported finding is by design and was NOT remediated.** The value is a Google
"Desktop app" OAuth client secret. Desktop-app clients are public clients under RFC 8252 —
Google documents the secret as not confidential — and the package publishes it deliberately
for zero-config install. Rotation is not a remediation: a replacement ships in the next
tarball. Client type confirmed as Desktop app in the Cloud console (project
`double-hold-485609-h9`), which is the fact the whole assessment rests on; had it been a Web
application client the secret *would* be confidential and this would have been a real finding.

What the report did surface is that the trade-off had been taken without the control that
makes it safe (commit b51aad9):
- [DONE] PKCE (RFC 7636, S256) on both auth flows. Without it, a local process that binds the
  fixed port 8089 first receives the authorization code and can redeem it with the npm-published
  secret — full Gmail/Drive/Calendar access from an unprivileged local process
- [DONE] Verifier held in the flow closure, not on `PendingAuthSession`, which is serialized
  into MCP tool responses
- [DONE] Ephemeral OS-assigned callback port (RFC 8252 §7.3) instead of fixed 8089
- [DONE] Literal `127.0.0.1` instead of `localhost` (RFC 8252 §8.3)
- [DONE] Extracted shared `buildAuthUrl` — the two flows duplicated param assembly, which is
  how one would end up with PKCE and the other without
- [DONE] 12 tests: RFC 7636 Appendix B known-answer vector, verifier absent from the auth URL,
  redeemed verifier matches the advertised challenge, per-session verifier independence,
  ephemeral bind args, and the blocking flow covered separately from the async one

Documentation, which contradicted the code and would have led the next person to "fix" the
credential by rotating it:
- [DONE] `CLAUDE.md` listed "BYO OAuth credentials (no shared client)" as a non-negotiable
  constraint; a shared client has shipped since a976d7b
- [DONE] `docs/SPEC.md` §2 called BYO "the default"; it is the override
- [DONE] `docs/SPEC.md` §10 recorded "will not ship with a shared OAuth client" under
  *non-reversible* decisions. Reversal now logged in place, with the costs the original
  rationale correctly identified (consent-screen impersonation, quota exposure)
- [DONE] `docs/ARCHITECTURE.md` — OAuth Flow decision updated; new "Shipped OAuth client" entry
- [DONE] New `SECURITY.md` with a private reporting channel and an explicit "the embedded
  secret is intentional, rotation is not a remediation" section, so the next scanner-driven
  report is self-service

Verified already correct, so not changed: `state` is generated per flow and compared on
callback in both paths; tokens at rest use the OS keychain with an AES-256-GCM encrypted-file
fallback.

Verified against the live Google endpoint before release, since the unit tests mock `node:http`
and `googleapis` and therefore prove nothing about what Google accepts:
- [DONE] Google issued a consent screen for an ephemeral loopback redirect (`127.0.0.1:60772`) —
  confirming Desktop-app clients have no redirect-URI allowlist, which is what made the ephemeral
  port safe to adopt
- [DONE] The S256 challenge/verifier round-tripped through Google's token endpoint successfully
- Note: Google returns `openid` alongside `userinfo.email` whether or not it was requested. Harmless
  — `capabilitiesOf` tests known capabilities against the granted set, so unrecognised scopes are
  ignored. Pre-existing behaviour, not introduced here.

**Released as v0.6.0** (commit a38331e). Minor rather than patch: `AccountStore.startAddAccount` and
`startReauthAccount` became async, and `AccountStore` is exported from the library entrypoint.
Verified post-publish that the tarball's `dist/build-info.json` commit matched the tagged commit, and
that the shipped `dist/auth/oauth.js` actually contains the PKCE code and no longer references 8089 —
a green workflow alone does not establish either.

**The `beta` dist-tag was retired** as part of this release rather than moved forward. Keeping it
current was a manual, un-automatable step (OIDC authorizes only `npm publish`), and it had already
drifted four months behind `latest` once. `latest` is now the only channel. See `docs/DEPLOYMENT.md`.

**Reply sent** to Francesco Martignoni on 2026-08-18 (cc: M. Carminati, S. Longari, and internal),
threaded onto the original disclosure. States that the credential is intentional and was not rotated,
that his report nonetheless surfaced the missing PKCE, and what shipped in v0.6.0. Also passes back
the methodological point that Desktop-app vs Web-application client type is what separates a false
positive from a real finding here, and that "public client without PKCE" is the statically-detectable
class that actually discriminates.

Verified end-to-end on both paths: the standalone script (isolated, in-memory token store) and the
real MCP tool path via `google_reauth_account`, whose auth URL carried an ephemeral
`127.0.0.1` redirect and `code_challenge_method=S256`.

**Follow-up:** none outstanding for this work.

---

## Drive Comments & Export Format (COMPLETED)

Requirement doc: `docs/plans/2026-06-08-drive-comments-and-export-format.md`.
Two complementary capabilities; shipped together.

Motivation: a client left review comments on a shared contract Doc (SOW) and there was
**no way** to read Google Doc comments through this MCP. Workspace Docs exported to
`text/plain` only, which strips all comments and formatting, and there was no comments
tool at all.

(A) Read Google Doc comments
- [DONE] New `drive_get_comments` tool wrapping Drive `comments.list` (explicit `fields` mask, `includeDeleted: false`)
- [DONE] Output per comment: author, quoted/anchored text (`quotedFileContent.value`), content, created/modified time, `resolved` flag, inline replies
- [DONE] Optional `includeResolved` (default true, filtered client-side), pagination via `pageToken`/`pageSize` (clamped to max 100)
- [DONE] `drive_get_comment_replies` wrapping `drive.replies.list` for separately-paginated replies
- [DONE] Gate on `drive_readonly` tier — `drive.file` (`drive_full`) is insufficient for client-shared Docs; added `driveGetComments` / `driveGetCommentReplies` to the tier map
- [DONE] Unit tests asserting fields mask, `includeDeleted: false`, page-size clamping, resolved filtering, and pagination

Deviation from the requirement doc: `supportsAllDrives` is **not** forwarded. Drive's
`comments.list` / `replies.list` do not accept that parameter (only `fileId`,
`includeDeleted`, `pageSize`, `pageToken`, `startModifiedTime`) — unlike `files.*`. The
tests assert the fields mask and `includeDeleted: false` instead. Reading comments on a
Shared Drive file has not been exercised against a live account.

(B) Choose export format on download/export
- [DONE] Added optional `exportMimeType` to `drive_download_file` and `downloadFileToLocal` so Workspace files export as e.g. `.docx`, preserving comments + formatting
- [DONE] Default export table still applies when `exportMimeType` is omitted (non-breaking; Doc still defaults to `.txt`)
- [DONE] Output extension derived from the chosen export MIME type (lookup table, then MIME subtype, then `.bin`)
- [DONE] `exportMimeType` on a non-Workspace file raises a clear error instead of being silently ignored, with a dedicated message for folders
- [DONE] Unit tests asserting forwarding, extension derivation, byte-exact binary output, and unchanged default behaviour (Doc → `.txt`, Sheet → `.csv`, Drawing → `.png`)

(C) Fix binary Workspace exports being corrupted — **pre-existing bug, not introduced here**
- [DONE] Both export call sites now request `responseType: 'arraybuffer'`; the previous `String(response.data)` decoded binary as UTF-8, replacing every invalid sequence with U+FFFD
- [DONE] `downloadFileToLocal` — a Google Drawing (default export `image/png`) was being written to disk as a corrupt PNG. Shipped broken since Drive support landed; would also have mangled every new `.docx`/`.pdf` export
- [DONE] `getFileContent` — the same path returned mojibake stamped `encoding: 'utf-8'` through `drive_get_file_content` / `drive_get_full_file_content`. Binary exports now return base64 with `encoding: 'base64'`, matching how the non-Workspace binary branch already behaved
- [DONE] Text/binary split extracted to a shared `isTextMimeType` predicate so both branches agree
- [DONE] Regression tests pinning byte-exact PNG output on disk and base64 output from `getFileContent`

---

## v0.4.3 - Shared Drive Support (COMPLETED)

- [DONE] Pass `supportsAllDrives: true` on every Drive `files.*` / `permissions.*` call so reads, writes, and sharing work on Shared Drive items
- [DONE] Pass `includeItemsFromAllDrives: true` and `corpora: 'allDrives'` on `files.list` so `drive_search_files` finds Shared Drive content by default
- [DONE] New `drive_list_shared_drives` MCP tool wraps `drives.list` so agents can discover Shared Drive IDs
- [DONE] New optional `driveId` arg on `drive_search_files` scopes a search to a single Shared Drive (`corpora: 'drive'` + `driveId`)
- [DONE] Surface `driveId` on returned `DriveFile` objects so agents can tell which Shared Drive a file lives in
- [DONE] Update `drive_list_files` description: pass a Shared Drive ID as `folderId` to list its top level
- [DONE] Unit tests asserting Shared Drive flags are forwarded on every read/write/share method + new `listSharedDrives`

---

## v0.4.2 - Re-authentication Support (COMPLETED)

- [DONE] `google_reauth_account` MCP tool: re-run OAuth on an existing account while preserving accountId, alias, description, labels
- [DONE] `AccountStore.startReauthAccount` + reauth-aware `checkPendingAuth` (updates scopes & lastUsedAt, no duplicate row)
- [DONE] OAuth callback verifies the authorized Google email matches the existing account (prevents accidental account swap)
- [DONE] Optional scopeTier / scopeTiers on reauth so tier upgrades don't require remove+add
- [DONE] Unit tests for reauth flow (preservation, scope updates, email mismatch protection)

---

## v0.4.1 - Outbound MIME Fixes (COMPLETED)

- [DONE] RFC 2047 encode non-ASCII subjects on the simple draft/send/reply path (em-dash, smart quotes, accents no longer mojibake)
- [DONE] Plain-text bodies sent with RFC 3676 `format=flowed; delsp=no` and soft-break markers so clients reflow paragraphs
- [DONE] Added `bodyFormat: "text" | "html"` parameter to `gmail_create_draft`, `gmail_update_draft`, `gmail_create_draft_with_attachment`, `gmail_reply_in_thread`
- [DONE] Routed simple-draft path through `buildRawMessage` so subject encoding and body formatting are consistent across attachment / non-attachment flows

---

## v0.4.0 - Drive Content Safety & Search (COMPLETED)

- [DONE] `drive_get_file_content` now returns truncated preview (default 10k chars) with metadata (fileName, totalSize, truncated flag)
- [DONE] New `drive_get_full_file_content` tool for complete content (with agent warning)
- [DONE] New `drive_download_file` tool to save Drive files to local disk
- [DONE] `content:keyword` shorthand in `drive_search_files` for full-text search
- [DONE] Fixed pnpm "Ignored build scripts" warning for esbuild/keytar

---

## Current Phase: 14 - Calendar Support (COMPLETED)

---

## Phase 10-14: Drive & Calendar Support (COMPLETED)

### Phase 10: Scope Tier Refactor
- [DONE] Rename scope tiers to mail_ prefix (readonly -> mail_readonly, etc.)
- [DONE] Add drive_readonly, drive_full, calendar_readonly, calendar_full tiers
- [DONE] Update hasSufficientScope to URL-based checking
- [DONE] Update all scope validation tests (73 tests)
- [DONE] Update server tool registrations for new tier names
- [DONE] Extract Gmail tools to server/gmail-tools.ts
- [DONE] Add Drive and Calendar error codes

### Phase 11-12: Drive Support
- [DONE] Create DriveClient with read/write methods
- [DONE] Register 12 Drive tools (4 read + 6 write + 2 confirm-gated)

### Phase 13-14: Calendar Support
- [DONE] Create CalendarClient with read/write methods
- [DONE] Register 10 Calendar tools (5 read + 5 write with conditional confirm)

---

## Bugfixes & Enhancements

### Version Tool
- **Issue**: No way for users to verify which version of the MCP server they're running
- **Fix**: Added `google_version` tool that returns version, git commit hash, and build date
- **Files changed**: `src/server/index.ts`, `package.json`, `scripts/generate-build-info.js`

### OAuth URL Visibility Fix (v2)
- **Issue**: OAuth authorization URL was not visible to users during `google_add_account` flow
- **Cause**: MCP tools can only return once, but the auth flow blocks waiting for user interaction. MCP logging and stderr output may not be displayed to users.
- **Fix**: Implemented async two-phase auth flow:
  1. `google_add_account` now returns immediately with the auth URL and session ID
  2. New `google_check_pending_auth` tool to poll for completion status
  3. Auth callback server runs in background and updates session status
  4. This ensures the auth URL is always visible in the tool response
- **Files changed**: `src/auth/oauth.ts`, `src/auth/account-store.ts`, `src/server/index.ts`

### OAuth URL Visibility Fix (v1 - superseded)
- **Issue**: OAuth authorization URL was not visible to users during `google_add_account` flow
- **Cause**: MCP clients (Claude Code, Claude Desktop) may not prominently display `sendLoggingMessage` notifications or stderr output
- **Fix**: Enhanced OAuth URL visibility via:
  1. Changed MCP logging level from `info` to `warning` for higher visibility
  2. Added prominent banner format to stderr output with clear framing
  3. Added troubleshooting documentation for OAuth URL visibility
- **Files changed**: `src/auth/oauth.ts`, `src/server/index.ts`, `README.md`

---

## Phase 8 - Performance & Optimization (COMPLETED)

Infrastructure improvements for reliability and efficiency.

### Completed
- [DONE] Implement configurable logging with sensitive data redaction (commit: 225c14b)
- [DONE] Implement rate limiting with exponential backoff on 429/5xx errors (commit: 225c14b)
- [DONE] Implement per-account request throttling with token bucket algorithm (commit: 225c14b)
- [DONE] Implement LRU cache with configurable TTLs (commit: 225c14b)
- [DONE] Add cache infrastructure with getWithMeta() for cache hints (commit: 225c14b)
- [DONE] Implement `gmail_get_messages_batch` tool - Fetch multiple messages in one call (commit: 225c14b)

### Notes
- Logger supports log levels via MCP_GOOGLE_LOG_LEVEL env var
- Automatic redaction of auth tokens, email content, and recipients
- Token bucket throttling prevents API rate limit errors
- LRU cache supports per-operation TTLs (search 30s, metadata 5min, bodies 10min)
- Batch tool limited to 50 messages per call

---

## Phase 7 - AI Productivity Prompts (COMPLETED)

MCP prompts that leverage existing tools with AI guidance for common workflows.

### Completed
- [DONE] Implement `summarize-thread` prompt - AI-assisted thread summarization (commit: cf8e3af)
- [DONE] Implement `smart-reply` prompt - Context-aware reply suggestions (commit: cf8e3af)
- [DONE] Implement `extract-action-items` prompt - Find TODOs/deadlines in emails (commit: cf8e3af)
- [DONE] Implement `categorize-emails` prompt - Suggest labels for uncategorized messages (commit: cf8e3af)

### Notes
- No new API integration needed - uses existing tools
- Prompts guide AI behavior, don't add business logic

---

## Phase 6 - Attachment Support (COMPLETED)

Enable downloading and sending email attachments.

### Completed
- [DONE] Implement `gmail_list_attachments` tool - List attachments in a message (commit: 9e7dcf3)
- [DONE] Implement `gmail_get_attachment` tool - Download attachment by ID (commit: 9e7dcf3)
- [DONE] Implement `gmail_create_draft_with_attachment` tool - Create draft with file attachment (commit: 9e7dcf3)
- [DONE] Add MIME handling utilities for multipart messages (commit: 9e7dcf3)
- [DONE] Add unit tests for attachment operations - 15 tests (commit: 9e7dcf3)

### Notes
- No new OAuth scope needed - uses existing `gmail.compose`
- Gmail attachment size limit is 25MB
- MIME utilities support non-ASCII filenames via RFC 2047 encoding

---

## Phase 5 - Spec Compliance (COMPLETED)

Address gaps identified in spec review to ensure full SPEC.md compliance.

### Completed
- [DONE] Add `MCP_GOOGLE_CONFIG_PATH` env override support in config loader (commit: 9b0bb99)
- [DONE] Implement structured error model (`code`, `message`, `details`) across all tools (commit: 5972860)
- [DONE] Add scope validation with explicit "needs upgrade" errors for tools requiring higher tiers (commit: 378bcd8)
- [DONE] Add unit tests for error model consistency (commit: 9254e06)

---

## Phase 9 - Advanced Features

Lower priority features for power users.

### Completed
- [DONE] Implement `gmail_batch_modify_labels` tool - Bulk label modification up to 1000 messages (commit: 2c40d9f)
- [DONE] Implement label management tools - gmail_create_label, gmail_update_label, gmail_delete_label (commit: 2c40d9f)
- [DONE] Add MCP Resources - accounts://list and cache://stats for inspection (commit: 2c40d9f)
- [DONE] Implement `settings` scope tier (parallel to full) - `gmail.settings.basic` + `gmail.readonly` + `userinfo.email`
- [DONE] Implement `gmail_list_filters` tool - List all email filters
- [DONE] Implement `gmail_create_filter` tool - Create filter with criteria/action (requires confirm: true)
- [DONE] Implement `gmail_delete_filter` tool - Delete filter by ID (requires confirm: true)
- [DONE] Implement `gmail_get_vacation` tool - Get vacation responder settings
- [DONE] Implement `gmail_set_vacation` tool - Configure vacation responder (requires confirm: true to enable)
- [DONE] Add FILTER_NOT_FOUND and FILTER_LIMIT_EXCEEDED error codes
- [DONE] Add unit tests for settings operations - 11 tests
- [DONE] Update scope validation tests for parallel tier logic - 13 new tests

### Notes
- Batch modify requires confirm: true for operations affecting >100 messages
- Label delete requires confirm: true for safety
- MCP Resources are read-only inspection endpoints
- Settings tier is parallel to full tier (neither satisfies the other)
- Filter/vacation tools require `settings` scope tier when adding account
- Gmail has a limit of 1000 filters per account

---

# Completed Phases

## Phase 4 - Inbox Management (COMPLETED)

### Completed
- [DONE] Add gmail.labels scope to full tier
- [DONE] Implement gmail_list_labels tool
- [DONE] Implement gmail_modify_labels tool
- [DONE] Implement gmail_mark_read_unread tool
- [DONE] Implement gmail_archive tool
- [DONE] Implement gmail_trash tool
- [DONE] Implement gmail_untrash tool
- [DONE] Add unit tests for label operations (commit: 692aa2d)

---

## Phase 3 - Draft/Send with Safety Gate (COMPLETED)

### Completed
- [DONE] Implement gmail_create_draft tool (commit: 23efa6c)
- [DONE] Implement gmail_update_draft tool (commit: cd4099b)
- [DONE] Implement draft preview rendering (commit: c5d2308)
- [DONE] Implement gmail_send_draft with confirm gate (commit: ba95d15)
- [DONE] Implement gmail_reply_in_thread tool (commit: 1ae85bb)
- [DONE] Add MCP prompts for safe email workflows (commit: c2ba597)
- [DONE] Write tests for confirmation flow (commit: d30b7b0)

---

## Phase 2 - Gmail Read/Search (COMPLETED)

### Completed
- [DONE] Create Gmail API client wrapper
- [DONE] Implement gmail_search_messages tool
- [DONE] Implement gmail_get_message tool
- [DONE] Implement gmail_get_thread tool
- [DONE] Add helper functions (getHeader, getTextBody, getHtmlBody, decodeBody)

---

## Phase 1 - OAuth + Account Store (COMPLETED)

### Completed
- [DONE] Design token storage abstraction (keychain vs encrypted file)
- [DONE] Implement OS keychain integration (keytar)
- [DONE] Implement encrypted file fallback (AES-256-GCM)
- [DONE] Create account store data model
- [DONE] Implement google_add_account tool (OAuth flow)
- [DONE] Implement google_remove_account tool
- [DONE] Implement google_set_account_labels tool
- [DONE] Update google_list_accounts to return stored accounts
- [DONE] Add scope tier definitions (readonly, compose, full)
- [DONE] Write unit tests for token storage

---

## Phase 0 - Skeleton (COMPLETED)

### Completed
- [DONE] Initialize pnpm project with TypeScript strict mode
- [DONE] Configure biome for linting/formatting
- [DONE] Set up vitest for testing
- [DONE] Create directory structure (src/, tests/, docs/)
- [DONE] Add @modelcontextprotocol/sdk dependency
- [DONE] Create config schema with zod validation
- [DONE] Implement config file loader (~/.config/mcp-google/config.json)
- [DONE] Create MCP server skeleton with stdio transport
- [DONE] Implement google_list_accounts tool (returns empty array)
- [DONE] Add CLI entrypoint (bin: mcp-google)
- [DONE] Verify MCP server connects via stdio

---

## Future Enhancements (Identified)

### Create native Google Docs/Sheets/Slides on upload
- [ ] `drive_upload_file` cannot produce a native Workspace file. `uploadFile` sets `requestBody.mimeType` and `media.mimeType` to the same value (`src/drive/client.ts`), so Drive's convert-on-upload never triggers — passing `application/vnd.google-apps.document` makes Drive reject the media as an un-uploadable Google Apps type
- [ ] Add an optional `convertToGoogleDoc` / `targetMimeType` so `requestBody.mimeType` can be the Workspace type while `media.mimeType` stays the source type (`text/plain`, `text/html`, `.docx`), which is Drive's documented conversion path
- [ ] Gate on `drive_full`; unit test asserting the two MIME types are sent independently
- Surfaced while designing the E2E harness: the fixture seeder has to bypass the MCP and call `drive.files.create` directly because of this

### Write Drive comments (`comments.create` / `replies.create`)
- [ ] Comment *writing* was explicitly out of scope for the read-side work (see `docs/plans/2026-06-08-drive-comments-and-export-format.md`); revisit as its own capability
- [ ] `drive_create_comment` (anchored + unanchored), `drive_reply_to_comment`, and possibly `drive_resolve_comment`
- [ ] Requires `drive.file` or broader — note `drive.file` only covers app-created files, so commenting on a client-shared Doc needs a wider scope than the read path
- [ ] Would let the E2E fixture seeder use the MCP's own tools instead of calling the Drive API directly, making the harness self-hosting

## Future Enhancements (from Competitive Analysis)

Identified from comparing against mcp-gsuite, mcp-google-workspace, and gmail-mcp-multi.

### Account Aliases
- [DONE] Allow users to assign friendly aliases ("work", "personal") to accounts, usable in tool calls instead of account IDs
- Added `alias` optional field to Account schema
- Added `resolveAccount()` to AccountStore — resolves by ID, alias (case-insensitive), or email
- Added `google_set_account_alias` tool to set/remove aliases (with uniqueness enforcement)
- All tools now accept account ID, alias, or email in `accountId` parameter
- Added 12 unit tests for alias resolution and management

### Bulk Attachment Download
- [DONE] Add `gmail_bulk_save_attachments` tool to download multiple email attachments to local disk in one call
- Downloads all attachments from up to 50 messages to a specified local directory
- Path sanitization: rejects `..` in output dir, strips path separators from filenames
- Prefixes filenames with message ID (or custom prefix) to avoid collisions
- Returns manifest of saved files with partial error handling (continues on per-file failures)
- Added 3 unit tests for path sanitization and file writing

### Account Descriptions in Tool Schemas
- [DONE] Add human-readable account descriptions to help AI identify the right account
- Added `description` optional field to Account schema
- Added `google_set_account_description` tool to set/remove descriptions
- Descriptions included in `google_list_accounts` output and `accounts://list` resource
- AI sees context like "Work - engineering team" when listing accounts before tool calls
- Added 4 unit tests for description management

### npm Trusted Publisher + GitHub Actions Publish Pipeline
- [DONE] Configure npm Trusted Publisher (OIDC) on npmjs.com — link to `bkbaheti/google-multi-account-mcp`, workflow `publish.yml`
- [DONE] Create `.github/workflows/publish.yml`:
  - Trigger on `push: tags: ['v*']`
  - `permissions: id-token: write, contents: read`
  - Steps: checkout → setup Node 20 → `pnpm install` → `pnpm build` → `pnpm test` → `npm publish --provenance --access public --tag beta`
  - Uses `environment: npm` for optional manual approval gate
- [ ] Create GitHub environment `npm` with required reviewers (optional)
- [ ] Test: `git tag v0.2.1 && git push --tags` to trigger first automated publish
- [ ] Remove local npm token dependency once OIDC publishing is verified

### Beta / Pre-Approval Notices
- [DONE] Add beta notice to package.json description, README, and landing page — "Google OAuth approval pending, by-invite access"
- [DONE] Publish with `--tag beta` dist-tag — **no longer true, and the parenthetical was never
  true.** `publish.yml` runs `npx npm@latest publish --provenance --access public` with no `--tag`,
  so it has always published to `latest`. The `beta` tag was set by hand, drifted, and was retired
  on 2026-08-18. Left here as a record; see `docs/DEPLOYMENT.md` for current behaviour.
