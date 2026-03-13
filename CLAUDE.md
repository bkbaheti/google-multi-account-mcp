# Project: MCP Google Multi-Account Broker

## Quick Reference

### What This Is
npm-installable MCP server for multi-Google-account access. Supports: Gmail, Google Drive, Google Calendar.

### Package Info
- Name: `@anthropic/mcp-google`
- Runtime: Node.js LTS, TypeScript, pnpm
- Transport: stdio (default), HTTP/SSE (future)
- Config: `~/.config/mcp-google/config.json`

### MCP Tools (Current)

**Account:**
- `google_version` - get server version, commit, build date
- `google_list_accounts` - list connected accounts
- `google_add_account` - start OAuth flow (returns auth URL + session ID)
- `google_check_pending_auth` - check/complete pending auth session
- `google_remove_account` - delete account + tokens
- `google_set_account_labels` - tag accounts

**Gmail Read:**
- `gmail_search_messages` - search with query
- `gmail_get_message` - fetch single message
- `gmail_get_thread` - fetch thread

**Gmail Write (with confirm gate):**
- `gmail_create_draft` - create draft
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

**Drive:**
- `drive_search_files` - search files in Drive
- `drive_list_files` - list files in folder
- `drive_get_file` - get file metadata
- `drive_get_file_content` - download/export file content
- `drive_upload_file` - upload a file
- `drive_create_folder` - create folder
- `drive_move_file` - move file to folder
- `drive_copy_file` - copy a file
- `drive_rename_file` - rename a file
- `drive_trash_file` - move to trash
- `drive_share_file` - share file (requires confirm: true)
- `drive_update_permissions` - modify permissions (requires confirm: true)

**Calendar:**
- `calendar_list_calendars` - list all calendars
- `calendar_list_events` - list events in time range
- `calendar_get_event` - get event details
- `calendar_search_events` - search events by text
- `calendar_freebusy` - check free/busy status
- `calendar_create_event` - create event (confirm if attendees)
- `calendar_update_event` - update event (confirm if attendees)
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
- BYO OAuth credentials (no shared client)
- Local-first stdio MCP server
- Account isolation (tokens, cache, rate limits)
- Draft-first + confirm gate for all sends
- Tiered scopes with explicit upgrade (mail_readonly, mail_compose, mail_full, mail_settings, drive_readonly, drive_full, calendar_readonly, calendar_full, all)

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

## File Structure
```
CLAUDE.md                 # This file (agent instructions + key spec)
docs/
  TASKS.md               # Task tracking (source of truth)
  ARCHITECTURE.md        # Design decisions log
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
