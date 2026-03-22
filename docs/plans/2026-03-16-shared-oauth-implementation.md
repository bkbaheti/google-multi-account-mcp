# Shared OAuth + Cloudflare Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship shared OAuth credentials in the npm package so users need zero GCP setup, and deploy static pages to Cloudflare for Google OAuth verification.

**Architecture:** Add a defaults module with the shared OAuth client ID/secret. Modify the credential resolution chain to: env vars → config file → package defaults. Deploy landing page, privacy policy, and terms of service to Cloudflare Pages.

**Tech Stack:** TypeScript, Vitest, Cloudflare Pages (static HTML/CSS)

---

### Task 1: Create OAuth Defaults Module

**Files:**
- Create: `src/auth/oauth-defaults.ts`
- Test: `tests/unit/oauth-defaults.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/oauth-defaults.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET } from '../../src/auth/oauth-defaults.js';

describe('OAuth Defaults', () => {
  it('should export a non-empty default client ID', () => {
    expect(DEFAULT_OAUTH_CLIENT_ID).toBeDefined();
    expect(typeof DEFAULT_OAUTH_CLIENT_ID).toBe('string');
    expect(DEFAULT_OAUTH_CLIENT_ID.length).toBeGreaterThan(0);
    expect(DEFAULT_OAUTH_CLIENT_ID).toContain('.apps.googleusercontent.com');
  });

  it('should export a non-empty default client secret', () => {
    expect(DEFAULT_OAUTH_CLIENT_SECRET).toBeDefined();
    expect(typeof DEFAULT_OAUTH_CLIENT_SECRET).toBe('string');
    expect(DEFAULT_OAUTH_CLIENT_SECRET.length).toBeGreaterThan(0);
    expect(DEFAULT_OAUTH_CLIENT_SECRET).toMatch(/^GOCSPX-/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/oauth-defaults.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/auth/oauth-defaults.ts`:

```typescript
// Default OAuth credentials for the published MCP Google server.
// These are intentionally embedded — this is a "Desktop app" OAuth client
// where Google's security model does not rely on client secret confidentiality.
// Same pattern used by gcloud CLI, GitHub CLI, and VS Code.
//
// Users can override with env vars (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
// or config file (~/.config/mcp-google/config.json oauth field).
export const DEFAULT_OAUTH_CLIENT_ID =
  '162760119336-lvkrke1g3kne3pe4jb8trb1gu6ik7sbi.apps.googleusercontent.com';
export const DEFAULT_OAUTH_CLIENT_SECRET = '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';
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/oauth-defaults.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/auth/oauth-defaults.ts tests/unit/oauth-defaults.test.ts
git commit -m "feat: add default OAuth credentials for zero-config setup"
```

---

### Task 2: Add OAuth Credential Resolution Function

**Files:**
- Modify: `src/config/index.ts`
- Test: `tests/unit/config.test.ts`

**Step 1: Write the failing tests**

Append to `tests/unit/config.test.ts`:

```typescript
describe('resolveOAuthConfig', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('should use env vars when both are set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'env-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-client-secret';

    const { resolveOAuthConfig } = await import('../../src/config/index.js');
    const result = resolveOAuthConfig();

    expect(result).toEqual({
      clientId: 'env-client-id',
      clientSecret: 'env-client-secret',
    });
  });

  it('should use config file values when env vars are not set', async () => {
    const customPath = path.join(TEST_CONFIG_DIR, 'oauth-test', 'config.json');
    process.env.MCP_GOOGLE_CONFIG_PATH = customPath;

    const { saveConfig } = await import('../../src/config/index.js');
    const { DEFAULT_CONFIG } = await import('../../src/types/index.js');

    saveConfig({
      ...DEFAULT_CONFIG,
      oauth: {
        clientId: 'config-client-id',
        clientSecret: 'config-client-secret',
      },
    });

    // Re-import to pick up saved config
    vi.resetModules();
    process.env.MCP_GOOGLE_CONFIG_PATH = customPath;
    const mod = await import('../../src/config/index.js');
    const result = mod.resolveOAuthConfig();

    expect(result).toEqual({
      clientId: 'config-client-id',
      clientSecret: 'config-client-secret',
    });
  });

  it('should fall back to package defaults when nothing else is configured', async () => {
    const customPath = path.join(TEST_CONFIG_DIR, 'empty-oauth', 'config.json');
    process.env.MCP_GOOGLE_CONFIG_PATH = customPath;

    const { resolveOAuthConfig } = await import('../../src/config/index.js');
    const { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET } = await import('../../src/auth/oauth-defaults.js');

    const result = resolveOAuthConfig();

    expect(result).toEqual({
      clientId: DEFAULT_OAUTH_CLIENT_ID,
      clientSecret: DEFAULT_OAUTH_CLIENT_SECRET,
    });
  });

  it('should prefer env vars over config file', async () => {
    const customPath = path.join(TEST_CONFIG_DIR, 'priority-test', 'config.json');
    process.env.MCP_GOOGLE_CONFIG_PATH = customPath;
    process.env.GOOGLE_CLIENT_ID = 'env-wins';
    process.env.GOOGLE_CLIENT_SECRET = 'env-wins-secret';

    const { saveConfig } = await import('../../src/config/index.js');
    const { DEFAULT_CONFIG } = await import('../../src/types/index.js');

    saveConfig({
      ...DEFAULT_CONFIG,
      oauth: {
        clientId: 'config-loses',
        clientSecret: 'config-loses-secret',
      },
    });

    vi.resetModules();
    process.env.MCP_GOOGLE_CONFIG_PATH = customPath;
    process.env.GOOGLE_CLIENT_ID = 'env-wins';
    process.env.GOOGLE_CLIENT_SECRET = 'env-wins-secret';
    const mod = await import('../../src/config/index.js');
    const result = mod.resolveOAuthConfig();

    expect(result.clientId).toBe('env-wins');
    expect(result.clientSecret).toBe('env-wins-secret');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL — `resolveOAuthConfig` is not exported

**Step 3: Implement resolveOAuthConfig**

Add to `src/config/index.ts` (at the end of file):

```typescript
import {
  DEFAULT_OAUTH_CLIENT_ID,
  DEFAULT_OAUTH_CLIENT_SECRET,
} from '../auth/oauth-defaults.js';

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Resolve OAuth credentials with priority:
 * 1. Environment variables (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 * 2. Config file (~/.config/mcp-google/config.json oauth field)
 * 3. Package defaults (shared public OAuth client)
 */
export function resolveOAuthConfig(): OAuthCredentials {
  // Priority 1: env vars
  const envId = process.env['GOOGLE_CLIENT_ID'];
  const envSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }

  // Priority 2: config file
  const config = loadConfig();
  if (config.oauth?.clientId && config.oauth?.clientSecret) {
    return {
      clientId: config.oauth.clientId,
      clientSecret: config.oauth.clientSecret,
    };
  }

  // Priority 3: package defaults
  return {
    clientId: DEFAULT_OAUTH_CLIENT_ID,
    clientSecret: DEFAULT_OAUTH_CLIENT_SECRET,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/index.ts tests/unit/config.test.ts
git commit -m "feat: add OAuth credential resolution with env > config > defaults priority"
```

---

### Task 3: Update AccountStore to Use resolveOAuthConfig

**Files:**
- Modify: `src/auth/account-store.ts`

**Step 1: Write the failing test**

Create `tests/unit/account-store-oauth.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('AccountStore OAuth resolution', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('should not throw when no config file OAuth credentials exist (uses defaults)', async () => {
    // Mock loadConfig to return config without oauth field
    vi.doMock('../../src/config/index.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../../src/config/index.js')>();
      return {
        ...original,
        loadConfig: () => ({ version: 1, accounts: [] }),
        resolveOAuthConfig: original.resolveOAuthConfig,
      };
    });

    const { AccountStore } = await import('../../src/auth/account-store.js');
    const mockStorage = {
      save: vi.fn(),
      load: vi.fn(),
      delete: vi.fn(),
    };

    const store = new AccountStore(mockStorage);

    // Should not throw — falls back to package defaults
    expect(() => store.listAccounts()).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/account-store-oauth.test.ts`
Expected: FAIL — AccountStore still throws "OAuth credentials not configured"

**Step 3: Update AccountStore.getOAuth()**

In `src/auth/account-store.ts`, replace the `getOAuth` method:

Old code (lines 21-36):
```typescript
  private getOAuth(): GoogleOAuth {
    if (!this.oauth) {
      const config = loadConfig();
      if (!config.oauth?.clientId || !config.oauth?.clientSecret) {
        throw new Error(
          'OAuth credentials not configured. Set clientId and clientSecret in ~/.config/mcp-google/config.json',
        );
      }
      const oauthConfig: OAuthConfig = {
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
      };
      this.oauth = new GoogleOAuth(oauthConfig, this.tokenStorage);
    }
    return this.oauth;
  }
```

New code:
```typescript
  private getOAuth(): GoogleOAuth {
    if (!this.oauth) {
      const oauthConfig: OAuthConfig = resolveOAuthConfig();
      this.oauth = new GoogleOAuth(oauthConfig, this.tokenStorage);
    }
    return this.oauth;
  }
```

Also update imports at top of file — add `resolveOAuthConfig` from config, remove unused `loadConfig` import from the `getOAuth` usage (but keep it for other methods that still use it):

```typescript
import { loadConfig, saveConfig, resolveOAuthConfig } from '../config/index.js';
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/account-store-oauth.test.ts`
Expected: PASS

Run: `npx vitest run`
Expected: All tests PASS (no regressions)

**Step 5: Commit**

```bash
git add src/auth/account-store.ts tests/unit/account-store-oauth.test.ts
git commit -m "refactor: use resolveOAuthConfig in AccountStore for zero-config OAuth"
```

---

### Task 4: Export oauth-defaults from auth index

**Files:**
- Modify: `src/auth/index.ts`

**Step 1: Update the barrel export**

Add to `src/auth/index.ts`:

```typescript
export {
  DEFAULT_OAUTH_CLIENT_ID,
  DEFAULT_OAUTH_CLIENT_SECRET,
} from './oauth-defaults.js';
```

**Step 2: Run typecheck and all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/auth/index.ts
git commit -m "chore: export OAuth defaults from auth barrel"
```

---

### Task 5: Update Error Message for Missing OAuth

**Files:**
- Modify: `src/server/index.ts` (if there are any places that reference the old "OAuth credentials not configured" message)

**Step 1: Search for old error messages**

Run: `grep -rn "OAuth credentials not configured" src/`

If any matches remain outside of `account-store.ts` (which was already fixed), update them to reference the resolution chain. If no matches, skip to Step 3.

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 3: Commit (if changes made)**

```bash
git add -A
git commit -m "fix: update OAuth error messages for new resolution chain"
```

---

### Task 6: Create Cloudflare Pages Static Site

**Files:**
- Create: `site/index.html`
- Create: `site/privacy.html`
- Create: `site/terms.html`
- Create: `site/style.css`

**Step 1: Create `site/style.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #1a1a1a;
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
}
h1 { margin-bottom: 1rem; }
h2 { margin: 2rem 0 0.5rem; }
p, ul, ol { margin-bottom: 1rem; }
ul, ol { padding-left: 1.5rem; }
code {
  background: #f4f4f4;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 0.9em;
}
pre {
  background: #f4f4f4;
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
  margin-bottom: 1rem;
}
pre code { background: none; padding: 0; }
a { color: #0066cc; }
nav { margin-bottom: 2rem; }
nav a { margin-right: 1rem; }
footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid #eee;
  font-size: 0.9em;
  color: #666;
}
```

**Step 2: Create `site/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Google Multi-Account</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/privacy">Privacy Policy</a>
    <a href="/terms">Terms of Service</a>
  </nav>

  <h1>MCP Google Multi-Account</h1>
  <p>An MCP server for multi-Google-account access. Manage Gmail, Google Drive, and Google Calendar from AI assistants like Claude.</p>

  <h2>Quick Start</h2>
  <p><strong>Claude Code CLI:</strong></p>
  <pre><code>claude mcp add google -- npx -y @anthropic/mcp-google</code></pre>

  <p><strong>Claude Desktop</strong> — add to your <code>claude_desktop_config.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "google": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-google"]
    }
  }
}</code></pre>

  <h2>Features</h2>
  <ul>
    <li>Multi-account Google access (connect multiple Gmail/Drive/Calendar accounts)</li>
    <li>Gmail: search, read, compose drafts, send, manage labels, archive</li>
    <li>Google Drive: search, list, upload, download, share files</li>
    <li>Google Calendar: list, create, update, delete events, check free/busy</li>
    <li>Zero configuration — works out of the box</li>
    <li>Tokens stored locally on your machine (keychain or encrypted file)</li>
  </ul>

  <h2>Source Code</h2>
  <p><a href="https://github.com/bkbaheti/google-multi-account-mcp">github.com/bkbaheti/google-multi-account-mcp</a></p>

  <footer>
    <p><a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Service</a></p>
  </footer>
</body>
</html>
```

**Step 3: Create `site/privacy.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — MCP Google Multi-Account</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/privacy">Privacy Policy</a>
    <a href="/terms">Terms of Service</a>
  </nav>

  <h1>Privacy Policy</h1>
  <p><em>Last updated: 2026-03-16</em></p>

  <h2>What This Application Does</h2>
  <p>MCP Google Multi-Account ("the Application") is an open-source MCP server that runs locally on your computer. It connects AI assistants (such as Claude) to your Google accounts for Gmail, Google Drive, and Google Calendar access.</p>

  <h2>Data Collection</h2>
  <p><strong>We do not collect, store, or transmit any of your data.</strong> The Application runs entirely on your local machine. There are no servers, databases, or analytics.</p>

  <h2>Data the Application Accesses</h2>
  <p>When you authorize the Application, it accesses the following Google data on your behalf:</p>
  <ul>
    <li><strong>Gmail:</strong> Read, compose, send, and manage email messages and labels</li>
    <li><strong>Google Drive:</strong> Read, upload, and manage files</li>
    <li><strong>Google Calendar:</strong> Read, create, update, and manage calendar events</li>
    <li><strong>Email address:</strong> Your Google account email for identification</li>
  </ul>

  <h2>How Data is Handled</h2>
  <ul>
    <li>All Google API calls are made <strong>directly from your machine to Google</strong> — no data passes through any intermediary server</li>
    <li>OAuth tokens are stored <strong>locally on your machine</strong> using your operating system's keychain (macOS Keychain, Windows Credential Manager, or Linux libsecret) or in AES-256-GCM encrypted files</li>
    <li>No data is shared with third parties</li>
    <li>No analytics, telemetry, or tracking of any kind</li>
  </ul>

  <h2>Data Retention</h2>
  <p>OAuth tokens remain on your machine until you remove the account using the <code>google_remove_account</code> tool, which also revokes the token with Google. Uninstalling the Application does not automatically remove stored tokens — you can delete them manually from <code>~/.config/mcp-google/</code>.</p>

  <h2>Your Rights</h2>
  <p>You can revoke the Application's access to your Google account at any time via <a href="https://myaccount.google.com/permissions">Google Account Permissions</a>.</p>

  <h2>Open Source</h2>
  <p>The Application's source code is publicly available at <a href="https://github.com/bkbaheti/google-multi-account-mcp">github.com/bkbaheti/google-multi-account-mcp</a>. You can inspect exactly what data the Application accesses and how it handles it.</p>

  <h2>Contact</h2>
  <p>For privacy questions, open an issue on the <a href="https://github.com/bkbaheti/google-multi-account-mcp/issues">GitHub repository</a>.</p>

  <footer>
    <p><a href="/">Home</a> | <a href="/terms">Terms of Service</a></p>
  </footer>
</body>
</html>
```

**Step 4: Create `site/terms.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — MCP Google Multi-Account</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/privacy">Privacy Policy</a>
    <a href="/terms">Terms of Service</a>
  </nav>

  <h1>Terms of Service</h1>
  <p><em>Last updated: 2026-03-16</em></p>

  <h2>Acceptance</h2>
  <p>By using MCP Google Multi-Account ("the Application"), you agree to these terms.</p>

  <h2>Description</h2>
  <p>The Application is a free, open-source MCP server that provides AI assistants with access to your Google accounts (Gmail, Drive, Calendar). It runs locally on your computer.</p>

  <h2>Your Responsibilities</h2>
  <ul>
    <li>You are responsible for how you use the Application and any actions taken through it</li>
    <li>You must comply with Google's <a href="https://developers.google.com/terms/api-services-user-data-policy">API Services User Data Policy</a></li>
    <li>You are responsible for safeguarding your OAuth tokens and credentials</li>
    <li>Do not use the Application for any purpose that violates applicable laws</li>
  </ul>

  <h2>No Warranty</h2>
  <p>The Application is provided "as is" without warranty of any kind. The authors are not liable for any damages arising from its use. This includes but is not limited to: data loss, unauthorized access resulting from compromised credentials, or service interruptions.</p>

  <h2>License</h2>
  <p>The Application is licensed under the <a href="https://opensource.org/licenses/MIT">MIT License</a>.</p>

  <h2>Changes</h2>
  <p>These terms may be updated. Continued use after changes constitutes acceptance.</p>

  <h2>Contact</h2>
  <p>For questions, open an issue on the <a href="https://github.com/bkbaheti/google-multi-account-mcp/issues">GitHub repository</a>.</p>

  <footer>
    <p><a href="/">Home</a> | <a href="/privacy">Privacy Policy</a></p>
  </footer>
</body>
</html>
```

**Step 5: Commit**

```bash
git add site/
git commit -m "feat: add static site for Cloudflare Pages (landing, privacy, terms)"
```

---

### Task 7: Deploy Static Site to Cloudflare Pages

This task uses the Cloudflare MCP and CLI. Non-code steps.

**Step 1: Create Cloudflare Pages project**

Use Cloudflare dashboard or CLI to create a Pages project:
- Project name: `mcp-google`
- Build output directory: `site/`
- No build command (static files)

**Step 2: Configure custom domain**

Add custom domain `multiaccountgooglemcp.procedure.tech` to the Cloudflare Pages project.

**Step 3: Deploy**

Push the `site/` directory to Cloudflare Pages (via git integration or `wrangler pages deploy site/`).

**Step 4: Verify**

Open `https://multiaccountgooglemcp.procedure.tech` — should show landing page.
Open `https://multiaccountgooglemcp.procedure.tech/privacy` — should show privacy policy.
Open `https://multiaccountgooglemcp.procedure.tech/terms` — should show terms.

**Step 5: Commit any config changes**

```bash
git add wrangler.toml  # if created
git commit -m "chore: add Cloudflare Pages deployment config"
```

---

### Task 8: Update Google OAuth Console

Non-code steps — manual in GCP Console.

**Step 1: Update OAuth consent screen**

Go to: `https://console.cloud.google.com/apis/credentials/consent?project=double-hold-485609-h9`

- Add privacy policy URL: `https://multiaccountgooglemcp.procedure.tech/privacy`
- Add terms URL: `https://multiaccountgooglemcp.procedure.tech/terms`

**Step 2: Verify OAuth client type**

Go to: `https://console.cloud.google.com/apis/credentials?project=double-hold-485609-h9`

- Confirm client `162760119336-lvkrke1g3kne3pe4jb8trb1gu6ik7sbi` is type "Desktop application"
- If it's "Web application", create a new "Desktop application" client and update `src/auth/oauth-defaults.ts` with the new credentials

**Step 3: Set publishing status**

On consent screen page:
- Click "Publish App" to move from Testing → In Production
- Note: unverified apps show a warning to users but still work
- Submit for verification when ready (restricted scopes need CASA Tier 2 audit)

---

### Task 9: Update README and Package Metadata

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Update README**

Add a section near the top of `README.md` explaining zero-config setup:

```markdown
## Quick Start

No Google Cloud setup needed — just install and connect:

**Claude Code CLI:**
```bash
claude mcp add google -- npx -y @anthropic/mcp-google
```

**Claude Desktop** — add to `claude_desktop_config.json`:
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

Then use the `google_add_account` tool to connect your Google account.

### Advanced: Bring Your Own OAuth Credentials

If you prefer to use your own GCP project:
- Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables, or
- Add `oauth.clientId` and `oauth.clientSecret` to `~/.config/mcp-google/config.json`
```

**Step 2: Update package.json keywords**

Add `"drive"`, `"calendar"`, `"zero-config"` to keywords array.

**Step 3: Run all tests one final time**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All PASS

**Step 4: Commit**

```bash
git add README.md package.json
git commit -m "docs: update README for zero-config setup and add package keywords"
```

---

### Task 10: Final Verification

**Step 1: Clean build**

Run: `rm -rf dist && pnpm build`
Expected: Build succeeds

**Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Test the zero-config flow end-to-end**

```bash
# Remove existing config to simulate new user
mv ~/.config/mcp-google/config.json ~/.config/mcp-google/config.json.bak

# Start the server
node dist/cli.js
# Should NOT throw "OAuth credentials not configured"
# Ctrl+C to stop

# Restore config
mv ~/.config/mcp-google/config.json.bak ~/.config/mcp-google/config.json
```

**Step 4: Lint**

Run: `pnpm lint`
Expected: No errors

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found in final verification"
```
