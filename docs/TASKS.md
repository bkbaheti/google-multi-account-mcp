# Tasks

## Current Phase: 9 - Advanced Features (COMPLETED)

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

### Deferred (Significant Architectural Work)
- [ ] **HTTP/SSE transport support** - Requires HTTP server, authentication, message format adaptation

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
