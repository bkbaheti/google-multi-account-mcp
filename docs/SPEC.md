# MCP Google Multi-Account Broker (npm) — Spec (Structure v0)

- Purpose
  - Provide an npm-installable MCP server that lets an MCP client (e.g., Claude) interact with multiple Google accounts.
  - Primary target: Gmail (search/read/draft/send/reply) with account selection.
  - Secondary target (future): Calendar/Contacts/Drive modules behind separate optional capability flags.

- Design principles
  - Human-readable spec that doubles as agent-ready implementation guide.
  - Optimized for execution by Claude Code CLI / agentic workflows.
  - Multi-account by design (per-account auth + token storage).
  - Minimize Google API calls (caching + batching + conditional requests).
  - Least-privilege scopes; incremental scope upgrades.
  - Safe-by-default: explicit user confirmation hooks for send/modify.
  - Portable: works as local CLI + stdio MCP server.

- Non-goals (v1)
  - No hosted SaaS token broker.
  - No domain-wide delegation.
  - No full mailbox sync / offline archive.

---

## 1) Package & distribution

- npm package
  - Name: `@<scope>/mcp-google` (placeholder)
  - Entrypoints
    - CLI: `mcp-google` (bin)
    - Library (optional): `createServer(config)`

- Runtime
  - Node.js LTS
  - TypeScript

- Deployment modes
  - Local stdio MCP server (default)
  - Optional HTTP/SSE transport (later)

- Configuration
  - Config file (default path)
    - `~/.config/mcp-google/config.json`
  - Env overrides
    - `MCP_GOOGLE_CONFIG_PATH`

---

## 2) Authentication & account management

- OAuth strategy
  - BYO OAuth credentials (default)
    - Users create their own Google Cloud OAuth client and supply credentials.
  - OAuth client configuration
    - Client ID
    - Client secret (if applicable)
    - Redirect strategy
      - Local loopback callback on `http://127.0.0.1:<port>/oauth/callback`
      - Fallback: manual copy-paste code flow (if loopback blocked)

- Account store
  - Each connected Google account is stored as an entry
    - `accountId` (stable UUID)
    - `email` (from token introspection/userinfo)
    - `labels` (user-defined: `personal|work|school|custom`)
    - `createdAt`, `lastUsedAt`
    - `scopesGranted[]`
    - `tokenRef` (reference to encrypted token record)

- Token storage
  - Refresh token + access token cache
  - Encryption at rest (required)
    - OS keychain preferred (Windows Credential Manager / macOS Keychain / libsecret)
    - Fallback: local encrypted file with user-supplied passphrase

- Scope tiers
  - Tier 1 (read/search)
    - Gmail read-only/search scopes
  - Tier 2 (compose/send)
    - Draft + send scopes
  - Tier 3 (modify)
    - Labels, archive, mark read/unread, etc.
  - Incremental consent
    - Upgrade only when tool requiring higher tier is invoked

- Workspace constraints
  - Note that work/school domains may block OAuth apps or restricted scopes.
  - Surface actionable errors to user: domain blocked / admin approval needed.

---

## 3) MCP tools (initial set)

- Naming convention
  - Prefix by product: `google_*`, `gmail_*`

- Account tools
  - `google_list_accounts`
    - Returns: array of { accountId, email, labels[], scopesGranted[], lastUsedAt }
  - `google_add_account`
    - Inputs: { label?: string, scopesTier?: 1|2|3 }
    - Behavior: launches OAuth flow, stores account entry
    - Returns: { accountId, email }
  - `google_remove_account`
    - Inputs: { accountId }
    - Behavior: deletes account entry + token
  - `google_set_account_labels`
    - Inputs: { accountId, labels[] }

- Gmail read/search tools
  - `gmail_search_messages`
    - Inputs: { accountId, query, maxResults?, pageToken? }
    - Returns: { messages: [{ id, threadId, snippet?, internalDate? }], nextPageToken? }
  - `gmail_get_message`
    - Inputs: { accountId, messageId, format?: 'metadata'|'full' }
    - Returns: { id, threadId, headers, snippet, bodyText?, bodyHtml?, labelIds?, internalDate }
  - `gmail_get_thread`
    - Inputs: { accountId, threadId }
    - Returns: { threadId, messages: [...] }

- Gmail draft/send tools
  - `gmail_create_draft`
    - Inputs: { accountId, to[], cc?, bcc?, subject, bodyText?, bodyHtml?, threadId? }
    - Returns: { draftId, messageId?, threadId? }
  - `gmail_update_draft`
    - Inputs: { accountId, draftId, patch: { ... } }
  - `gmail_send_draft`
    - Inputs: { accountId, draftId, confirm?: boolean }
    - Behavior: if confirm is false/absent, return a preview and require confirm on next call
  - `gmail_reply_in_thread`
    - Inputs: { accountId, threadId, replyToMessageId, bodyText?, bodyHtml?, confirm?: boolean }

- Optional Gmail modify tools (later)
  - `gmail_modify_labels`
  - `gmail_mark_read_unread`
  - `gmail_archive`

---

## 4) MCP alignment (from MCP intro + architecture)

- MCP primitives used
  - Tools
    - Primary integration surface (all Gmail + account operations).
    - Each tool has a strict input/output schema to avoid ambiguous agent behavior.
    - Tools are stateless at the protocol level; all state is owned by the server (tokens, cache, account store).
  - Prompts (lightweight, shipped with server)
    - Encode recommended workflows so agents use tools safely and consistently.
    - Act as *policy guidance*, not business logic.
    - Examples (v1):
      - `gmail_safe_draft`: gather intent → create draft → return preview → require confirm.
      - `gmail_reply_triage`: summarize thread → propose reply options → create draft.
  - Resources (optional, later)
    - Read-only, addressable entities exposed by the server.
    - Intended for inspection, debugging, or discovery — not mutation.
    - Examples (future): connected accounts list, recent searches, cache stats.

- Client–server responsibility split
  - MCP client (e.g., Claude)
    - Decides *when* to call tools and *in what sequence*.
    - Holds no long-lived credentials or Google-specific logic.
  - MCP server (this package)
    - Owns authentication, token refresh, caching, rate limiting, and retries.
    - Enforces safety gates (confirm-before-send).
    - Translates high-level intents into Google API calls.

- Transport & lifecycle
  - Default transport: stdio (local, process-bound).
  - Server must be restart-safe; all durable state persisted outside process memory.
  - Startup sequence
    - Load config → validate OAuth setup → initialize stores → expose MCP manifest.
  - Fail fast with explicit errors if required config is missing.

- Tool discoverability & schema design
  - Tool names are verb–noun, product-prefixed (`gmail_search_messages`).
  - Input schemas favor explicit fields over free-form text.
  - Outputs are structured and stable to support agent chaining and caching.

- Alignment with MCP architecture goals
  - Clear separation between reasoning (agent) and execution (server).
  - Server is replaceable/swappable without retraining the agent.
  - Encourages composition with other MCP servers (e.g., Slack, Notion).

- MCP lifecycle & capability negotiation
  - Server must implement MCP initialization handshake before tools are callable.
  - Capabilities (tools, prompts, resources) are declared explicitly at startup.
  - Clients should not assume tool availability until initialization completes.

- Dynamic tool discovery & notifications
  - Server supports dynamic tool listing via MCP `tools/list`.
  - Server may emit notifications (e.g., `notifications/tools/list_changed`) when:
    - a new account is added or removed,
    - scopes are upgraded or downgraded,
    - tools become newly available or unavailable.
  - Clients are expected to re-discover tools after such notifications.

- Transport extensibility
  - v1 focuses on local stdio transport for safety and simplicity.
  - Architecture permits future remote transports (HTTP/SSE) without changing tool semantics.
  - Remote transport support must preserve the same security and scope guarantees.


---

## 5) Safety & UX behaviors

- Send confirmation gate (default on)
  - Draft-first workflow
  - Tool returns a rendered preview (to/cc/subject/body) and requires explicit `confirm: true` to send.

- Sensitive data handling
  - Never log message bodies by default
  - Redact headers (auth, tokens)
  - Configurable logging level

- Rate limiting
  - Client-side throttling per account
  - Backoff on 429/5xx

---

## 6) Caching & call-reduction strategies

- Token-level caching
  - Access token cache per account with expiry tracking
  - Avoid refresh unless near-expiry

- Request-level caching (short-lived)
  - In-memory LRU cache keyed by
    - `accountId + method + normalizedParams`
  - Default TTLs
    - search results: 15–60 seconds
    - message metadata: 5–10 minutes
    - full message bodies: 2–5 minutes
  - Cache invalidation triggers
    - After send/modify operations on the same thread/message

- Conditional requests / partial responses
  - Prefer `format=metadata` where possible
  - Use partial fields selection where supported
  - Use history-based incremental sync for threads (future)

- Batching
  - Implement client-side batch for read operations
    - e.g., `gmail_get_messages_batch` to fetch N message metadata/body in one tool call
  - De-dup concurrent identical requests
    - Promise coalescing per cache key

- Local index (optional later)
  - Build a lightweight cache DB (SQLite) to store
    - messageId -> headers/snippet/internalDate
    - threadId -> lastSeenHistoryId
  - Use for
    - avoiding repeated fetches when agent iterates
    - quick “re-open last search” flows

- Client hints
  - Tool responses include cache hints
    - `cacheHit: true|false`
    - `ttlRemainingMs`

---

## 7) Data models (spec-level)

- Account
  - `accountId: string`
  - `email: string`
  - `labels: string[]`
  - `scopesGranted: string[]`
  - `createdAt: string`
  - `lastUsedAt: string`

- Cache entry
  - `key: string`
  - `value: any`
  - `expiresAt: number`
  - `tags: string[]` (e.g., accountId, threadId, messageId)

---

## 8) Error model

- Standard error envelope
  - `code: string`
  - `message: string`
  - `details?: object`

- Key error cases
  - OAuth not configured (missing client ID)
  - Account not connected
  - Insufficient scopes (needs upgrade)
  - Workspace blocked by admin
  - Rate limited

---

## 9) Implementation phases

- Agent handoff expectations
  - This document is the authoritative source of truth for implementation.
  - Agents may expand sections but must not violate "Non-reversible decisions".
  - Agents should implement phases sequentially; later phases may assume earlier guarantees.


- Phase 0 — Skeleton
  - MCP server boots
  - Config load
  - `google_list_accounts` returns empty

- Phase 1 — OAuth + account store
  - `google_add_account` works
  - Tokens stored encrypted
  - `google_list_accounts` returns connected accounts

- Phase 2 — Gmail read/search
  - `gmail_search_messages`
  - `gmail_get_message`
  - Basic caching + batching

- Phase 3 — Draft/send with safety gate
  - Draft create/update
  - Send with confirm
  - Thread reply

- Phase 4 — Optional modify tools
  - Labels/read/unread/archive

---

## 10) Non-reversible decisions (guardrails)

- OAuth ownership model
  - BYO OAuth credentials is the default and expected path.
  - The package will not ship with a shared Google OAuth client for end users.
  - Rationale: avoids centralized trust, verification, and security assessment burden.

- Execution model
  - Local-first MCP server over stdio is the canonical mode.
  - No background daemon or always-on service assumptions.

- Account isolation
  - Each Google account is isolated at the token, cache, and rate-limit level.
  - No cross-account batching or optimization that could blur boundaries.

- Email mutation safety
  - All send/reply actions go through a draft-first + confirm gate.
  - No direct "send raw message" tool without preview.

- Scope discipline
  - Scopes are tiered and incrementally requested.
  - Tools must fail with explicit errors if required scopes are missing (no silent escalation).

- State ownership
  - MCP tools remain stateless; all durable state lives in the server.
  - Clients and prompts never store Google credentials or tokens.

- Extensibility boundaries
  - New Google products (Calendar, Drive, etc.) are added as opt-in modules.
  - No implicit expansion of scopes when installing upgrades.

---

## 11) Open questions (parked)

- Exact scopes list per tier (map to Google OAuth scope strings)
- Preferred token encryption backend across Windows/macOS/Linux
- Whether to ship a tiny local webserver for OAuth callback or use device flow fallback
- How to represent HTML bodies safely (sanitize vs raw)
- How much SQLite caching is acceptable by default

