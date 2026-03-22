# Public Distribution Design: npx + Shared OAuth + Cloudflare

**Date**: 2026-03-16
**Status**: Approved (revised from Railway-hosted to local-execution model)

## Summary

Distribute the MCP Google Multi-Account server as a public npm package with a shared OAuth client. Users run it locally via `npx` (stdio transport, same as today), but instead of bringing their own OAuth credentials, the package ships with a published OAuth client ID. Google API calls go directly from the user's machine to Google — no proxy server. Cloudflare Pages hosts the static landing page, privacy policy, and terms of service required for Google OAuth app verification.

**Operating cost: $0** (Cloudflare Pages free tier only).

## Why This Over Railway-Hosted

| Concern | Railway-hosted | npx + shared OAuth |
|---------|---------------|-------------------|
| Monthly cost | $10-20+ scaling with users | $0 |
| API traffic | Proxied through your server | Direct: user → Google |
| Bandwidth cost | You pay | None |
| User setup | Paste a URL | `npx @anthropic/mcp-google` (same as today) |
| Token storage | PostgreSQL (you manage) | User's local keychain |
| Scaling | You scale infrastructure | Each user runs their own |
| Client secret | Server-side (private) | Embedded in package (public — this is fine for Desktop OAuth clients) |

Google's OAuth security model for "Desktop app" clients does not rely on client secret confidentiality. Tools like `gcloud`, `gh` CLI, and VS Code all ship embedded OAuth client IDs.

## Google API Costs

**Free for everyone.** Gmail, Drive, and Calendar APIs have generous free quotas:

| API | Free Quota |
|-----|-----------|
| Gmail API | 1 billion quota units/day per project |
| Drive API | 20,000 queries/100 sec per user |
| Calendar API | 1,000,000 queries/day per project |

API calls are made with individual users' OAuth tokens. Per-user rate limits apply, not aggregate. Project-level limits would only matter with thousands of simultaneous heavy users.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Distribution | npm package (`npx`) | Zero infrastructure cost, users run locally |
| Static pages | Cloudflare Pages | Privacy policy, terms, landing page for Google verification |
| Domain | `multiaccountgooglemcp.procedure.tech` | Cloudflare Pages |
| OAuth client type | Desktop app (public client) | Client secret can be embedded; Google expects this |
| OAuth credentials | Shipped in package + env override | Default shared client, power users can BYO |
| Token storage | Local keychain / encrypted file (unchanged) | No server-side storage needed |
| Transport | stdio (unchanged) | Local execution, no HTTP needed |
| Phase 1 clients | Claude Code CLI + Claude Desktop | Native stdio MCP support |
| Phase 2 clients | Cursor, ChatGPT, others | Deferred |

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  User's Machine                                             │
│                                                              │
│  ┌─────────────────┐    ┌──────────────────────────────┐    │
│  │ Claude Code CLI  │    │ npx @anthropic/mcp-google     │    │
│  │ or Claude Desktop│◄──►│                                │    │
│  │                  │stdio│ ┌────────────┐ ┌───────────┐ │    │
│  └─────────────────┘    │ │ Shared OAuth│ │Tool       │ │    │
│                          │ │ Client ID   │ │Handlers   │ │    │
│                          │ └──────┬─────┘ └─────┬─────┘ │    │
│                          │        │             │        │    │
│                          └────────┼─────────────┼────────┘    │
│                                   │             │             │
└───────────────────────────────────┼─────────────┼─────────────┘
                                    │             │
                              OAuth flow    API calls
                              (browser)     (direct)
                                    │             │
                                    ▼             ▼
                          ┌──────────────────────────────┐
                          │  Google APIs                   │
                          │  Gmail, Drive, Calendar        │
                          └──────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  Cloudflare Pages: multiaccountgooglemcp.procedure.tech     │
│  /              → Landing page + install instructions       │
│  /privacy       → Privacy policy                            │
│  /terms         → Terms of service                          │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  Google Cloud (project: double-hold-485609-h9)              │
│  OAuth consent screen → published, verified                 │
│  OAuth client type: Desktop app                             │
│  Client ID embedded in npm package                          │
└────────────────────────────────────────────────────────────┘
```

## OAuth Credential Strategy

### Default: Shared public client (zero-config for users)
The npm package ships with a default OAuth client ID and secret baked in:

```typescript
// src/auth/oauth-defaults.ts
export const DEFAULT_OAUTH_CLIENT_ID = '162760119336-...apps.googleusercontent.com';
export const DEFAULT_OAUTH_CLIENT_SECRET = 'GOCSPX-...';
```

On first `google_add_account`, the user sees Google's consent screen branded with your app name, links to privacy policy/terms on Cloudflare Pages. Tokens are stored locally on their machine.

### Override: BYO credentials (power users)
Users can still bring their own OAuth credentials via:
- Environment variables: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- Config file: `~/.config/mcp-google/config.json` `oauth` field (existing behavior)

Priority: env vars → config file → package defaults.

### Google OAuth Console Setup

- **Client type**: Desktop application (not Web application)
- **Redirect URI**: `http://localhost:8089/callback` (unchanged, local only)
- **Consent screen**: Published, verified
- **Privacy policy**: `https://multiaccountgooglemcp.procedure.tech/privacy`
- **Terms**: `https://multiaccountgooglemcp.procedure.tech/terms`
- **Scopes**: All current scopes (Gmail, Drive, Calendar, userinfo.email)

## What Changes in Code

### Modified Files

```
src/
  auth/
    oauth.ts                    # Modified: fall back to default credentials
                                # if no BYO config found
    account-store.ts            # Modified: use default credentials as fallback
  config/
    index.ts                    # Modified: env var override for OAuth credentials
  auth/
    oauth-defaults.ts           # NEW: default client ID/secret constants
```

### Static Site (separate deployment)

```
site/
  index.html                    # Landing page with install instructions
  privacy.html                  # Privacy policy
  terms.html                    # Terms of service
  style.css                     # Minimal styling
```

### Estimated Scope

- ~50 lines new code (`oauth-defaults.ts` + fallback logic)
- ~30 lines modifications to existing files
- Static site: 3 HTML pages
- Zero changes to tool handlers, API clients, or transport

## Cloudflare Pages Setup

**Domain**: `multiaccountgooglemcp.procedure.tech`

**DNS record**:
| Record | Type | Value |
|--------|------|-------|
| `multiaccountgooglemcp` | CNAME | Cloudflare Pages |

**Pages content**:
- `/` — What this is, how to install, link to GitHub
- `/privacy` — Privacy policy (what data the app accesses, how tokens are stored locally, no server-side collection)
- `/terms` — Terms of service

## Google OAuth Verification Process

1. Change OAuth client type to "Desktop application" in GCP Console
2. Set consent screen publishing status to "In Production"
3. Add privacy policy URL: `https://multiaccountgooglemcp.procedure.tech/privacy`
4. Add terms URL: `https://multiaccountgooglemcp.procedure.tech/terms`
5. Submit for Google verification
6. For restricted scopes (Gmail), Google may require CASA Tier 2 security assessment
7. While pending verification: app works for test users (up to 100)

## Client Configuration

**Claude Code CLI** (unchanged):
```bash
claude mcp add google -- npx -y @anthropic/mcp-google
```

**Claude Desktop** (`claude_desktop_config.json`, unchanged):
```json
{
  "mcpServers": {
    "google": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-google"]
    }
  }
}
```

Users no longer need to set up their own GCP project or OAuth credentials.

## Phase 2 (Deferred)

- Cursor support
- ChatGPT support (OpenAPI adapter or native MCP when available)
- Optional Railway-hosted mode for users who can't run Node.js locally
- Usage analytics (opt-in telemetry)

## Migration from BYO to Shared OAuth

Existing users with their own OAuth credentials: **nothing changes**. Their config file `oauth` field takes priority over package defaults. New users get zero-config setup out of the box.
