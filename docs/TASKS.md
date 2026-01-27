# Tasks

## Current Phase: 8 - Performance & Optimization (Pending)

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

## Phase 8 - Performance & Optimization

Infrastructure improvements for reliability and efficiency.

### Pending

- [ ] **Implement rate limiting with exponential backoff on 429/5xx errors**

  APIs enforce rate limits to prevent abuse and ensure fair usage. Gmail's default is 250 quota units per user per second. When exceeded, the API returns HTTP 429 (Too Many Requests). Exponential backoff is the standard retry strategy: wait 1s, then 2s, then 4s, up to a maximum. This prevents "thundering herd" where all retries happen simultaneously. We'll wrap API calls with a retry decorator that catches 429/5xx errors, waits appropriately, and retries. The implementation tracks per-account rate limit state to avoid one account's heavy usage affecting others.

- [ ] **Add request-level LRU cache with configurable TTLs**

  Many email workflows repeatedly access the same data: reading a message, checking its thread, reading again. An LRU (Least Recently Used) cache stores recent API responses keyed by `accountId + method + params`. When a request matches a cached entry that hasn't expired, we return the cached data without hitting the API. TTL (Time To Live) varies by data type: search results change frequently (15-60s TTL), message metadata is stable (5-10min), message bodies never change (longer TTL). LRU eviction ensures the cache doesn't grow unbounded—when full, the least recently accessed entries are removed.

- [ ] **Add cache hints in tool responses (`cacheHit`, `ttlRemainingMs`)**

  Transparency about caching helps users understand data freshness. When a response includes `cacheHit: true, ttlRemainingMs: 45000`, the user knows they're seeing 45-second-old data. This is especially important for search results where new emails might have arrived. Cache hints also help debugging ("why am I seeing old data?") and allow clients to implement their own refresh logic. The implementation adds these fields to all tool responses, defaulting to `cacheHit: false` for uncached requests.

- [ ] **Implement `gmail_get_messages_batch` tool - Fetch multiple messages in one call**

  Fetching 10 messages individually requires 10 API calls with 10 round-trips of network latency. Gmail's batch API lets you bundle up to 100 requests into one HTTP request, dramatically reducing latency and quota usage. The response contains all results (or individual errors). We'll accept an array of message IDs and return an array of messages. Implementation uses `gmail.users.messages.batchGet` or constructs a multipart batch request. This is essential for workflows that process search results—instead of N sequential fetches, one batch request.

- [ ] **Add per-account request throttling**

  Beyond reactive rate limiting (handling 429s), proactive throttling prevents hitting limits in the first place. We maintain a token bucket per account: tokens regenerate at the rate limit (e.g., 250/second), each request consumes tokens, and requests wait if the bucket is empty. This smooths out bursty traffic and provides predictable behavior. It also enforces fairness between accounts—one account's heavy usage shouldn't starve others. The implementation uses a simple in-memory token bucket with timestamps.

- [ ] **Add configurable logging levels with sensitive data redaction**

  Debugging production issues requires logs, but email content is sensitive. We'll implement log levels (debug, info, warn, error) configurable via environment variable (`MCP_GOOGLE_LOG_LEVEL`). The key feature is automatic redaction: email bodies, subjects, and recipients are replaced with `[REDACTED]` in logs unless explicitly enabled. Headers like `Authorization` are always redacted. This balances debuggability with privacy. The implementation wraps console.log with level checking and runs output through a redaction filter.

### Identified
- Default TTLs from spec: search 15-60s, metadata 5-10min, bodies 2-5min
- Batch limit: 100 messages max (50 recommended for reliability)
- Cache invalidation needed after send/modify operations
- Consider cache persistence across restarts (SQLite) in future

---

## Phase 9 - Advanced Features (Future)

Lower priority features for power users.

### Pending

- [ ] **Implement `gmail_batch_modify` tool - Apply labels to multiple messages**

  Processing emails in bulk is common: "archive all notifications older than a week" or "label all emails from this sender as 'Vendor'". Doing this one message at a time is slow and quota-inefficient. Gmail's `messages.batchModify` accepts up to 1000 message IDs and applies the same label changes to all. We'll accept `{ messageIds: string[], addLabelIds: string[], removeLabelIds: string[] }` and return success/failure counts. This enables powerful automation while staying within a single tool call. Safety consideration: require confirmation for operations affecting >100 messages.

- [ ] **Implement label management tools (`gmail_create_label`, `gmail_update_label`, `gmail_delete_label`)**

  Users need to create custom labels to organize email their way. Gmail allows up to 10,000 labels per account. `gmail_create_label` accepts name and optional color/visibility settings. `gmail_update_label` can rename or change appearance. `gmail_delete_label` removes the label (but not the messages—they just lose that label). These use the `labels.create/patch/delete` endpoints. Note: system labels (INBOX, SENT, SPAM, etc.) cannot be modified or deleted. We'll validate label names (no slashes for nesting conflicts) and handle the 10k limit gracefully.

- [ ] **Implement filter/automation tools (`gmail_list_filters`, `gmail_create_filter`)**

  Gmail filters automatically process incoming mail: skip inbox, apply label, forward, delete, etc. Filters have criteria (from, to, subject, hasAttachment) and actions (addLabel, markRead, archive). `gmail_list_filters` returns existing rules so users understand their automation. `gmail_create_filter` adds new rules—powerful but needs careful validation since a bad filter could auto-delete important mail. These require the `gmail.settings.basic` scope, which is a new tier we'd need to add. Filters are the gateway to "set it and forget it" email management.

- [ ] **Implement vacation responder tools (`gmail_get_vacation`, `gmail_set_vacation`)**

  The vacation responder (auto-reply) tells senders you're away. It has: enabled flag, subject, HTML body, date range, and audience (contacts only, or everyone). `gmail_get_vacation` returns current settings. `gmail_set_vacation` configures it. Common workflow: "I'm going on vacation Friday, set up an auto-reply." The tool would accept natural parameters like `startDate`, `endDate`, `message` and translate to the API format. Requires `gmail.settings.basic` scope. This is a "nice to have" that rounds out the full Gmail management experience.

- [ ] **Add MCP Resources for account inspection and cache stats**

  MCP Resources are read-only URIs that clients can inspect. Unlike tools (which perform actions), resources expose state. Examples: `accounts://list` returns connected accounts without side effects, `cache://stats` shows hit rate and memory usage, `quota://usage` shows API quota consumption. Resources are useful for debugging ("why is this slow?" → check cache stats) and monitoring. They're also discoverable—clients can list available resources. This makes the server more transparent and debuggable without cluttering the tool namespace.

- [ ] **Consider HTTP/SSE transport support**

  Currently we only support stdio transport (stdin/stdout), which requires the MCP server to run as a child process of the client. HTTP transport would let the server run as a standalone service, accessible over the network. SSE (Server-Sent Events) enables the server to push notifications to clients (new email arrived, rate limit warning). This enables architectures like: server running on a home server, accessed from multiple devices. Implementation requires an HTTP server (Express/Fastify), authentication (API keys or OAuth), and adapting MCP's message format to HTTP request/response. This is significant work but enables new use cases.

### Identified
- Filter/vacation tools require `gmail.settings.basic` scope (new tier)
- MCP Resources are read-only inspection endpoints per MCP spec
- HTTP transport requires careful security consideration (authentication, TLS)
- Consider webhook support for real-time notifications (Gmail push notifications via Pub/Sub)

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
