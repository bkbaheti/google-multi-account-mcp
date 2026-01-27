# Tasks

## Current Phase: 5 - Spec Compliance (Pending)

---

## Phase 5 - Spec Compliance

Address gaps identified in spec review to ensure full SPEC.md compliance.

### Pending
- [ ] Add `MCP_GOOGLE_CONFIG_PATH` env override support in config loader
- [ ] Implement structured error model (`code`, `message`, `details`) across all tools
- [ ] Add scope validation with explicit "needs upgrade" errors for tools requiring higher tiers
- [ ] Add unit tests for error model consistency

### Identified
- Error codes should follow pattern: `AUTH_NOT_CONFIGURED`, `ACCOUNT_NOT_FOUND`, `SCOPE_INSUFFICIENT`, `RATE_LIMITED`, etc.

---

## Phase 6 - Attachment Support

Enable downloading and sending email attachments.

### Pending
- [ ] Implement `gmail_list_attachments` tool - List attachments in a message
- [ ] Implement `gmail_get_attachment` tool - Download attachment by ID (returns base64)
- [ ] Implement `gmail_create_draft_with_attachment` tool - Create draft with file attachment
- [ ] Add MIME handling utilities for multipart messages
- [ ] Add unit tests for attachment operations

### Identified
- No new OAuth scope needed - uses existing `gmail.compose`
- Large attachments may need streaming or chunking consideration

---

## Phase 7 - AI Productivity Prompts

MCP prompts that leverage existing tools with AI guidance for common workflows.

### Pending
- [ ] Implement `summarize-thread` prompt - AI-assisted thread summarization
- [ ] Implement `smart-reply` prompt - Context-aware reply suggestions
- [ ] Implement `extract-action-items` prompt - Find TODOs/deadlines in emails
- [ ] Implement `categorize-emails` prompt - Suggest labels for uncategorized messages

### Identified
- No new API integration needed - uses existing tools
- Prompts guide AI behavior, don't add business logic

---

## Phase 8 - Performance & Optimization

Infrastructure improvements for reliability and efficiency.

### Pending
- [ ] Implement rate limiting with exponential backoff on 429/5xx errors
- [ ] Add request-level LRU cache with configurable TTLs
- [ ] Add cache hints in tool responses (`cacheHit`, `ttlRemainingMs`)
- [ ] Implement `gmail_get_messages_batch` tool - Fetch multiple messages in one call
- [ ] Add per-account request throttling
- [ ] Add configurable logging levels with sensitive data redaction

### Identified
- Default TTLs from spec: search 15-60s, metadata 5-10min, bodies 2-5min
- Batch limit: 100 messages max (50 recommended)
- Cache invalidation needed after send/modify operations

---

## Phase 9 - Advanced Features (Future)

Lower priority features for power users.

### Pending
- [ ] Implement `gmail_batch_modify` tool - Apply labels to multiple messages
- [ ] Implement label management tools (`gmail_create_label`, `gmail_update_label`, `gmail_delete_label`)
- [ ] Implement filter/automation tools (`gmail_list_filters`, `gmail_create_filter`)
- [ ] Implement vacation responder tools (`gmail_get_vacation`, `gmail_set_vacation`)
- [ ] Add MCP Resources for account inspection and cache stats
- [ ] Consider HTTP/SSE transport support

### Identified
- Filter/vacation tools require `gmail.settings.basic` scope (new tier)
- MCP Resources are read-only inspection endpoints

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
- [DONE] Add MCP prompts for safe workflows (commit: c2ba597)
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
