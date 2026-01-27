# Tasks

## Current Phase: 5 - Attachment Support (Pending)

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

### Identified
- Caching and rate limiting deferred to optimization phase
- Full tests require mocked Gmail API (integration tested manually)

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

### Identified
- Integration tests for OAuth flow deferred (requires manual testing with real Google account)

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

## Phase 4 - Inbox Management (COMPLETED)

### Completed
- [DONE] Add gmail.labels scope to full tier
- [DONE] Implement gmail_list_labels tool
- [DONE] Implement gmail_modify_labels tool
- [DONE] Implement gmail_mark_read_unread tool
- [DONE] Implement gmail_archive tool
- [DONE] Implement gmail_trash tool
- [DONE] Implement gmail_untrash tool
- [DONE] Add unit tests for label operations

### Identified
- Batch modify (multiple messages at once) deferred to future phase
