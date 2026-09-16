# Project: MCP Google Multi-Account Broker

## Quick Reference

### What This Is
npm-installable MCP server for multi-Google-account access. Supports: Gmail, Google Drive, Google Calendar.

### Package Info
- Name: `@procedure-tech/mcp-google`
- Runtime: Node.js LTS, TypeScript, pnpm
- Transport: stdio (default), HTTP/SSE (future)
- Config: `~/.config/mcp-google/config.json`

### MCP Tools (Current)

**Account:**
- `google_version` - get server version, commit, build date
- `google_list_accounts` - list connected accounts
- `google_add_account` - start OAuth flow (returns auth URL + session ID)
- `google_check_pending_auth` - check/complete pending auth session
- `google_reauth_account` - re-run OAuth on an existing account (preserves ID, alias, description, labels; optionally change capabilities)
- `google_remove_account` - delete account + tokens
- `google_set_account_labels` - tag accounts
- `google_set_account_alias` - set friendly alias (e.g., "work") for use in all tool calls
- `google_set_account_description` - set human-readable description (e.g., "Work - engineering team")

**Gmail Read:**
- `gmail_search_messages` - search with query
- `gmail_get_message` - fetch single message (returns From/To/**Cc**/**Bcc**/**Reply-To**/Subject/Date/**Message-ID**/**In-Reply-To**; optional `metadataHeaders` restricts and echoes headers when `format: "metadata"`)
- `gmail_get_thread` - fetch thread (same header set per message)

**Gmail Write (with confirm gate):**
- `gmail_create_draft` - create draft
- `gmail_create_draft_with_attachment` - create draft with attachments (supports `filePath` for large files)
- `gmail_update_draft` - modify draft
- `gmail_get_draft` - preview draft before sending
- `gmail_delete_draft` - delete draft
- `gmail_send_draft` - send (requires confirm: true)
- `gmail_reply_in_thread` - reply (requires confirm: true)

**Gmail Inbox Management:**
- `gmail_list_labels` - list all labels (system + custom)
- `gmail_modify_labels` - add/remove labels from message
- `gmail_mark_read_unread` - toggle read status
- `gmail_archive` - remove from INBOX
- `gmail_trash` - move to trash
- `gmail_untrash` - restore from trash

- `gmail_bulk_save_attachments` - download attachments from multiple messages to local disk

**Drive:**
- `drive_list_shared_drives` - list Shared Drives (Team Drives) the user is a member of
- `drive_search_files` - search files in Drive (supports `content:keyword` for full-text search; searches across My Drive + all Shared Drives by default, or pass `driveId` to scope to one)
- `drive_list_files` - list files in folder (pass a Shared Drive ID as `folderId` to list its top level)
- `drive_get_file` - get file metadata
- `drive_get_file_content` - preview file content (truncated, default 10k chars)
- `drive_get_full_file_content` - get complete file content (use sparingly)
- `drive_get_comments` - read comments on a Doc/Sheet/Slide (author, quoted text, resolved flag, replies); needs `drive:read` capability
- `drive_get_comment_replies` - read replies to a single comment (only when a comment's inline replies are paginated)
- `drive_download_file` - download file from Drive to local disk (supports `exportMimeType` to export Workspace files as `.docx`/`.pdf`/`.xlsx` instead of the default flat text)
- `drive_upload_file` - upload a file (supports `filePath` for large files)
- `drive_create_folder` - create folder
- `drive_move_file` - move file to folder
- `drive_copy_file` - copy a file
- `drive_rename_file` - rename a file
- `drive_trash_file` - move to trash
- `drive_share_file` - share file (requires confirm: true)
- `drive_update_permissions` - modify permissions (requires confirm: true)

**Calendar:**
- `calendar_list_colors` - list the event palette (11 ids, hex + Calendar UI names) and calendar palette (24); needs `calendar:read`
- `calendar_list_calendars` - list all calendars (paginated; reports `accessRole` plus a derived `canEdit`, and `summaryOverride`/`selected`/`hidden`/`deleted`)
- `calendar_list_events` - list events in time range
- `calendar_get_event` - get event details
- `calendar_search_events` - search events by text
- `calendar_freebusy` - check free/busy status
- `calendar_create_event` - create event (confirm if attendees; `addMeet` for a new Google Meet link, `meetingCode` to attach an existing one; `colorId` takes an id 1-11 or a colour name)
- `calendar_update_event` - update event (confirm if attendees; `addMeet`/`meetingCode`/`removeConferencing`; `colorId`/`resetColor`)
- `calendar_delete_event` - delete event (confirm if attendees)
- `calendar_rsvp` - respond to invitation
- `calendar_move_event` - move to different calendar

**MCP Prompts:**
- `compose-email` - guided email composition workflow
- `reply-to-email` - guided reply workflow with threading
- `review-drafts` - review and manage pending drafts

### Implementation Phases

**Completed:**
- Phase 0: Skeleton (MCP boots, config, empty list_accounts)
- Phase 1: OAuth + account store
- Phase 2: Gmail read/search
- Phase 3: Draft/send with safety gate
- Phase 4: Inbox management (labels, archive, trash)
- Phase 5: Spec compliance (env config, error model, scope validation)
- Phase 6: Attachment support
- Phase 7: AI productivity prompts
- Phase 8: Performance & optimization (caching, rate limiting)
- Phase 9: Advanced features (filters, vacation, batch ops)
- Phase 10: Scope tier refactor (mail_ prefix, drive/calendar tiers)
- Phase 11-12: Drive support (12 tools: search, list, get, upload, share, permissions)
- Phase 13-14: Calendar support (10 tools: list, get, search, create, update, RSVP)

**Pending:**
- HTTP/SSE transport support (deferred - significant architectural work)

### Non-Negotiable Constraints
- OAuth credential resolution: env vars → config file → **shipped default client**
  (`src/auth/oauth-defaults.ts`). BYO is fully supported but is the *override*, not the
  default — the package deliberately ships a public "Desktop app" client ID **and secret**
  so install is zero-config. This reverses the original "no shared client" guardrail; see
  `docs/SPEC.md` §10 and `SECURITY.md` before touching those constants.
  - **The embedded client secret is not a leak and must not be "fixed" by rotation.** Google
    Desktop-app clients are public clients under RFC 8252 — the secret is not confidential,
    and any replacement ships in the next tarball. This has already been reported once
    through responsible disclosure.
  - What *does* protect the flow is PKCE plus an ephemeral loopback port (`src/auth/oauth.ts`).
    Those are the compensating controls for a public client, not optional hardening — do not
    remove them, and keep both auth flows on the shared `buildAuthUrl`.
- Local-first stdio MCP server
- Account isolation (tokens, cache, rate limits)
- Draft-first + confirm gate for all sends
- **Conferencing goes through `buildConferenceData`.** Google accepts conference data two
  mutually exclusive ways, and the difference is not cosmetic: `createRequest` mints a
  **new** conference (its only fields are `requestId` and `conferenceSolutionKey` — there is
  no way to ask for a specific meeting code), while `conferenceSolution` + `entryPoints`
  **attaches an existing** one. Both need `conferenceDataVersion: 1`; at version 0 Google
  silently ignores conference data in the body. Reusing a meeting code leaves access bound
  to the original event's guest list, which is why `meetingCode` sits behind a confirm gate
  and `addMeet` does not.
  - Google's "you may inadvertently remove existing conferences" warning is scoped to apps
    that hold events in **local storage** and write back stale copies. It is not a statement
    about `events.update` as such. Do not cite it as one.
- **`updateEvent` uses `events.patch`, and patch merges nested objects.** Sending only
  `start.dateTime` at an event that currently has `start.date` leaves BOTH set, which Google
  rejects — so `buildEventDateTimeForPatch` nulls the mutually exclusive sibling explicitly.
  Anything nested added to the patch body needs the same treatment; arrays are fine, patch
  overwrites those. Patch was chosen over the previous get-then-`events.update` because it
  cannot lose a concurrent edit to a field the caller did not touch, **not** on quota
  grounds — Google's own reference prefers get+update, which costs 2 units against patch's
  3. Either shape is defensible; the nested-merge rule is what is non-negotiable.
- **Event colour is the one update that does not notify guests.** `updateEvent` sends
  `sendUpdates: 'none'` when the patch body contains nothing but `colorId`, and
  `calendar_update_event` skips the attendee confirm gate in that same case. Both follow
  from the same fact: an event's colour is the organiser's own view — a guest's copy is
  coloured by their settings, not this field — so a notification would be mail about a
  change the recipient cannot see, once per event per guest across a bulk recolour. The
  decision is read off the **built patch body** (`isColorOnlyPatch`), not the caller's
  arguments, so a field added to the body later cannot slip into the silent path. Anything
  that *is* visible to a guest keeps `'all'`.
  - `colorId: null` is the reset — verified live, the event falls back to its calendar's
    colour. An empty string is rejected by Google as an invalid colour id, so null is the
    only way to express it, hence `EventUpdate` rather than `Partial<EventInput>`.
  - Colours are validated against 1-11 **before** the API call. Google's own error is a
    bare `Invalid color id value.` naming neither the range nor the fact that names exist.
  - The Calendar UI names (Tomato, Basil, …) in `src/calendar/colors.ts` are **not API
    data** — `colors.get` returns ids and hex only. Event and calendar palettes are
    separate: Tomato is event 11 but calendar 3, so the map is event-only.
  - `colors.get` accepts `calendar` and `calendar.readonly` but **not** `calendar.events`,
    so `calendar_list_colors` is gated on `calendar:read` and not on the read-or-write gate
    the other read tools use. An account holding only `calendar:write` cannot call it.
  - `eventLabelVersion` defaults to `0`, which is what keeps `colorId` honoured. At
    version 1 Google processes `eventLabelId` and **ignores `colorId`** — do not send it.
- **One header list.** `MESSAGE_HEADER_FIELDS` in `src/server/gmail-tools.ts` is the single
  definition of which headers a message response surfaces, used by `gmail_get_message`,
  `gmail_get_messages_batch`, `gmail_get_thread` and `gmail_get_draft`. Each of those four
  handlers previously inlined its own list; three drifted to From/To/Subject/Date only, which
  is how Cc silently disappeared from every read path while drafts still returned it. Add
  headers there, never in a handler. `References` is deliberately excluded — it repeats every
  prior `Message-ID`, so surfacing it per message would grow a thread response quadratically;
  callers that need it name it in `metadataHeaders`.
- Per-service capabilities with explicit upgrade (`mail:read`, `mail:compose`, `mail:modify`, `mail:settings`, `drive:read`, `drive:appfiles`, `calendar:read`, `calendar:write`). Capabilities are checked directly against required scopes — there is no tier-to-scope lookup. The only true implication is `mail:modify` ⇒ `mail:read` (Google documents `gmail.modify` as including read access). Deliberately no `drive:appfiles` ⇒ `drive:read` implication: `drive.file` (per-file, app-created access) and `drive.readonly` (read everything) are independent grants, neither contains the other — asserting otherwise previously defeated the scope gate on `drive_get_comments`. Same reasoning excludes any `calendar:write` ⇒ `calendar:read` implication (`calendar.events` doesn't authorize `calendarList.list` or `freebusy.query`).

---

## Cold Start Protocol
1. Read this file (CLAUDE.md)
2. Read `docs/TASKS.md` for current state
3. **Announce context** - Start your first message with a brief status:
   ```
   **Session Context:**
   - Phase: [current phase]
   - Active tasks: [any in-progress tasks, or "none"]
   - Next pending: [first pending task]
   - Completed this phase: [count or "none yet"]
   ```
4. Ask user what they'd like to work on, or suggest the next pending task
5. Work on ONE task at a time

## Task Workflow

### Starting a Task
1. Move task from Pending to Active section
2. Add `[IN PROGRESS]` prefix
3. Begin work

### Completing a Task
1. Run relevant tests
2. Commit with conventional commit message
3. Move task to Completed: `[DONE] description (commit: abc1234)`
4. Add any newly discovered tasks to "Identified" section
5. Pick next task or end session

### Discovering New Tasks
During work, if you identify something that needs doing:
1. Add to "Identified" section of current phase (or appropriate future phase)
2. Keep working on current task
3. New tasks get triaged in next session

## Updating This Document
This CLAUDE.md contains inlined spec sections that may evolve.

**When to update:**
- Implementation reveals spec ambiguity
- Design decision is made that affects future work
- New constraint or pattern emerges

**How to update:**
1. Describe the proposed change
2. Get user confirmation
3. Update CLAUDE.md
4. Note the change in docs/ARCHITECTURE.md

## Commit Convention
- `feat:` new feature
- `fix:` bug fix
- `refactor:` code restructuring
- `test:` adding tests
- `docs:` documentation
- `chore:` tooling/config

## Testing Requirements
- Unit tests for all non-trivial functions
- Integration tests for MCP tool handlers
- Test before marking task complete

## Deployment — read `docs/DEPLOYMENT.md` before investigating

Two things ship from this repo by unrelated mechanisms, and neither is discoverable from the files:

- **The website** (https://multiaccountgooglemcp.procedure.tech/) deploys **automatically from `master`** via Cloudflare. The connection lives in the Cloudflare dashboard — there is **no** deploy workflow, no `wrangler.toml`, no `CNAME` in this repo. Searching for one is a dead end; that has already cost a full investigation once.
- **The npm package** publishes from `.github/workflows/publish.yml`, triggered by pushing a `v*` tag. It publishes to `latest`, not `beta`.

Do not trust the branch `origin/cloudflare/workers-autoconfig` or the commits mentioning Cloudflare Pages/Workers — all three describe paths that are not in use. `docs/DEPLOYMENT.md` explains why.

`mcp-google.procedure.tech` does **not** exist (NXDOMAIN). Never reference it; use the live domain above.

### Release checklist

There is exactly **one** dist-tag: `latest`. `beta` was retired on 2026-08-18
(`npm dist-tag rm`) precisely because keeping it current was a manual step that
could not be automated, and it had already drifted four months behind `latest`
(stuck on 0.3.1 while `latest` was 0.5.1) — so anyone following the project's own
"Beta" labelling was installing a build from April.

**Do not re-add `beta` or any second tag.** OIDC in CI authorizes only `npm publish`,
so a second tag can only be maintained by a human with a 2FA one-time password on every
single release. It will drift again. "Beta" is a maturity statement in the README, on
the site, and in the package description; it does not need a dist-tag. See
`docs/DEPLOYMENT.md`.

After pushing a `v*` tag and seeing the workflow go green, you are not finished:

1. **Verify what actually shipped**, rather than trusting the green check:
   `npm view @procedure-tech/mcp-google version dist-tags` — `latest` must be the new
   version, and must be the only tag listed.
2. **Confirm the published build matches the tag**: `npm pack @procedure-tech/mcp-google@<version>`
   and check `package/dist/build-info.json` — its `commit` must equal the tagged commit. A mismatch
   means the build predates the version bump.
3. **If the site content changed**, confirm the deploy landed:
   `curl -s https://multiaccountgooglemcp.procedure.tech/ | grep softwareVersion`
   Bump `site/index.html` (`softwareVersion` in the JSON-LD, and the release-notes block)
   *after* the npm tag is out, never before — the site auto-deploys from `master`, so an
   early bump advertises a version nobody can install.

## Debugging "google_version returns an old version" (npx cache gotcha)

`google_version` reads `dist/build-info.json` next to the server's compiled JS (see `loadBuildInfo` in `src/server/index.ts`), which is generated from `package.json` + `git rev-parse --short HEAD` by `scripts/generate-build-info.js` during `pnpm build`. So a stale version reading from `google_version` means one of two things:

1. **The release was built BEFORE the version bump.** `pnpm build` reads `package.json` at run time. Always bump version FIRST, THEN run `pnpm build`. (CI does this correctly; it's only an issue for local builds.)
2. **The MCP client is launching a stale npx-cached install** — most common. `npx -y @procedure-tech/mcp-google` hashes the package spec (not the resolved version) into `~/.npm/_npx/<hash>/`. After the first install, npm's metadata cache (default ~10 min TTL, but effectively unbounded for content-addressed installs once present) can keep serving the old version even after a new release. Restarting the MCP client is NOT enough.

**Diagnosis steps when google_version is wrong:**

1. Confirm the registry is current: `npm view @procedure-tech/mcp-google version dist-tags`.
2. Verify the published tarball: `npm pack @procedure-tech/mcp-google@<version>` then inspect `package/dist/build-info.json` inside.
3. Find what's actually running on the user's machine: `ps aux | grep mcp-google` — the path tells you which install is live.
4. Inspect that install's `dist/build-info.json` directly.
5. Search all caches: `find ~/.npm/_npx -name "build-info.json" -path "*mcp-google*" -exec cat {} \;`

**Fix on the consumer side:**

- Quit the MCP client (Claude Desktop / Claude Code, etc.) fully — the running server is what's holding the old code.
- `rm -rf ~/.npm/_npx/<hash>` for any stale dirs found in step 5.
- Recommend pinning to an exact version in the MCP config: `npx -y @procedure-tech/mcp-google@<exact-version>` — each version becomes a separate cache hash, so updates are never silently skipped.
- Relaunch the MCP client.

**Important: a single MCP server process cannot return different versions across tool calls.** If the user reports "tool X is from the new version but google_version shows the old version", they almost certainly have two MCP servers configured (e.g., one in `~/Library/Application Support/Claude/claude_desktop_config.json` and another in `~/.claude.json` or a project-local `.mcp.json`) — or are looking at two different UI surfaces. Enumerate every config before assuming a code bug.

## File Structure
```
CLAUDE.md                 # This file (agent instructions + key spec)
docs/
  TASKS.md               # Task tracking (source of truth)
  ARCHITECTURE.md        # Design decisions log
  DEPLOYMENT.md          # How the site and the npm package actually ship
src/
  index.ts               # Library entrypoint
  cli.ts                 # CLI entrypoint
  server/                # MCP server setup
  auth/                  # OAuth, token storage
  gmail/                 # Gmail client, caching
  drive/                 # Drive client, file operations
  calendar/              # Calendar client, event operations
  config/                # Config schema, loader
  types/                 # Shared types
tests/
  unit/
  integration/
```

## Full Spec Reference
For complete details: `docs/SPEC.md`
