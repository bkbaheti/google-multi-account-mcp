# Tasks

## Current Phase: 2 - Gmail Read/Search

### Active
<!-- Tasks currently being worked on -->

### Pending
<!-- Ready to pick up -->
- [ ] Create Gmail API client wrapper
- [ ] Implement request caching (LRU with TTL)
- [ ] Implement gmail_search_messages tool
- [ ] Implement gmail_get_message tool
- [ ] Implement gmail_get_thread tool
- [ ] Add rate limiting per account
- [ ] Write tests with mocked Gmail API

### Identified
<!-- New tasks discovered during work -->

### Completed
<!-- Format: [DONE] Task description (commit: abc1234) -->

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

## Phase 3 - Draft/Send with Safety Gate
### Pending
- [ ] Implement gmail_create_draft tool
- [ ] Implement gmail_update_draft tool
- [ ] Implement draft preview rendering
- [ ] Implement gmail_send_draft with confirm gate
- [ ] Implement gmail_reply_in_thread tool
- [ ] Add MCP prompts for safe workflows
- [ ] Write tests for confirmation flow

### Identified
### Completed

---

## Phase 4 - Modify Tools (Optional)
### Pending
- [ ] Implement gmail_modify_labels tool
- [ ] Implement gmail_mark_read_unread tool
- [ ] Implement gmail_archive tool

### Identified
### Completed
