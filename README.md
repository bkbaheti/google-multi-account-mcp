# MCP Google Multi-Account Server

An MCP (Model Context Protocol) server for accessing multiple Google accounts (primarily Gmail) from Claude Code, Claude Desktop, or any MCP-compatible client.

## Features

- **Multi-account support**: Connect and manage multiple Google accounts simultaneously
- **Gmail access**: Search, read, compose, send, and organize emails
- **Attachments**: Download and send file attachments
- **Inbox management**: Labels, archive, trash, read/unread status
- **Filters & vacation**: Create email filters and configure vacation responders
- **AI productivity prompts**: Thread summarization, smart replies, action item extraction
- **Safety gates**: Draft-first workflow with confirmation required for all sends
- **Local-first**: All credentials stored locally, BYO OAuth credentials

## Installation

### From npm (when published)

```bash
npm install -g @anthropic/mcp-google
```

### Local Development

```bash
git clone <repo-url>
cd google-multi-account-mcp
pnpm install
pnpm build
```

## Prerequisites

1. **Node.js 20+** - Required runtime
2. **Google Cloud OAuth credentials** - You must create your own (see below)
3. **Claude Code or Claude Desktop** - MCP client to connect to this server

## Google Cloud OAuth Setup

You must create your own OAuth credentials. This server does not ship with shared credentials.

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Note your project name

### Step 2: Enable the Gmail API

1. Go to **APIs & Services** > **Library**
2. Search for "Gmail API"
3. Click **Enable**

### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** user type (unless you have Google Workspace)
3. Fill in the required fields:
   - App name: e.g., "My MCP Gmail"
   - User support email: your email
   - Developer contact: your email
4. Click **Save and Continue**
5. On **Scopes**, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.settings.basic`
   - `https://www.googleapis.com/auth/userinfo.email`
6. Click **Save and Continue**
7. On **Test users**, add your Google email addresses that will use this app
8. Click **Save and Continue**

### Step 4: Create OAuth 2.0 Client ID

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Desktop app** as the application type
4. Name it (e.g., "MCP Gmail Desktop")
5. Click **Create**
6. **Important**: Copy the **Client ID** and **Client Secret**

### Step 5: Add Redirect URI

1. Click on your newly created OAuth client
2. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:8089/callback
   ```
3. Click **Save**

## Configuration

### Configure the MCP Server

Create the configuration file at `~/.config/mcp-google/config.json`:

```json
{
  "version": 1,
  "oauth": {
    "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "clientSecret": "YOUR_CLIENT_SECRET"
  },
  "accounts": []
}
```

Replace `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET` with the values from Google Cloud Console.

### Configure Claude Code

Add to your Claude Code settings (`~/.claude/settings.json` or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "google": {
      "command": "node",
      "args": ["/absolute/path/to/google-multi-account-mcp/dist/cli.js"],
      "env": {
        "MCP_GOOGLE_PASSPHRASE": "optional-passphrase-for-token-encryption"
      }
    }
  }
}
```

Replace `/absolute/path/to/google-multi-account-mcp` with the actual path to this project.

### Configure Claude Code (CLI)

Alternatively, use the Claude CLI to add the MCP server:

```bash
# Add to current project only (default)
claude mcp add google node /absolute/path/to/google-multi-account-mcp/dist/cli.js

# Add globally (available in all projects)
claude mcp add -s user google node /absolute/path/to/google-multi-account-mcp/dist/cli.js

# With passphrase for token encryption
claude mcp add -s user google node /absolute/path/to/google-multi-account-mcp/dist/cli.js \
  -e MCP_GOOGLE_PASSPHRASE=optional-passphrase-for-token-encryption
```

To verify or remove:
```bash
claude mcp list          # List configured servers
claude mcp remove google # Remove this server
```

### Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "google": {
      "command": "node",
      "args": ["/absolute/path/to/dist/cli.js"]
    }
  }
}
```

## Usage

### Getting Started

1. Start Claude Code (or restart if already running)
2. Verify the server is connected:
   ```
   Run google_list_accounts
   ```
   Should return an empty array.

3. Add a Google account:
   ```
   Run google_add_account with scopeTier "compose"
   ```
   This opens a browser for OAuth authorization.

4. Complete the OAuth flow in your browser
5. Search your emails:
   ```
   Run gmail_search_messages with query "is:unread"
   ```

### Scope Tiers

When adding an account, choose a scope tier based on what you need:

| Tier | Permissions | Use Case |
|------|-------------|----------|
| `readonly` | Search and read emails | Just reading/searching |
| `compose` | + Create drafts and send | Composing and sending emails |
| `full` | + Labels, archive, trash | Full inbox management |
| `settings` | + Filters, vacation responder | Email automation |

Add accounts with the desired tier:
```
google_add_account with scopeTier "full"
```

## Available Tools

### Account Management

| Tool | Description |
|------|-------------|
| `google_list_accounts` | List all connected Google accounts |
| `google_add_account` | Add a new account via OAuth |
| `google_remove_account` | Remove an account and revoke tokens |
| `google_set_account_labels` | Tag accounts (e.g., "work", "personal") |

### Gmail - Reading

| Tool | Description | Scope |
|------|-------------|-------|
| `gmail_search_messages` | Search with Gmail query syntax | readonly |
| `gmail_get_message` | Get a single message | readonly |
| `gmail_get_messages_batch` | Get multiple messages (max 50) | readonly |
| `gmail_get_thread` | Get a thread with all messages | readonly |
| `gmail_list_attachments` | List attachments in a message | readonly |
| `gmail_get_attachment` | Download an attachment | readonly |

### Gmail - Composing

| Tool | Description | Scope |
|------|-------------|-------|
| `gmail_create_draft` | Create a draft email | compose |
| `gmail_create_draft_with_attachment` | Create draft with attachments | compose |
| `gmail_update_draft` | Update an existing draft | compose |
| `gmail_get_draft` | Preview a draft | compose |
| `gmail_delete_draft` | Delete a draft | compose |
| `gmail_send_draft` | Send a draft (requires `confirm: true`) | compose |
| `gmail_reply_in_thread` | Reply to a thread | compose |

### Gmail - Inbox Management

| Tool | Description | Scope |
|------|-------------|-------|
| `gmail_list_labels` | List all labels | full |
| `gmail_create_label` | Create a new label | full |
| `gmail_update_label` | Update label name/color | full |
| `gmail_delete_label` | Delete a label | full |
| `gmail_modify_labels` | Add/remove labels from message | full |
| `gmail_batch_modify_labels` | Bulk label modification (max 1000) | full |
| `gmail_mark_read_unread` | Toggle read/unread status | full |
| `gmail_archive` | Remove from INBOX | full |
| `gmail_trash` | Move to trash | full |
| `gmail_untrash` | Restore from trash | full |

### Gmail - Settings (Filters & Vacation)

| Tool | Description | Scope |
|------|-------------|-------|
| `gmail_list_filters` | List all email filters | settings |
| `gmail_create_filter` | Create a filter (requires `confirm: true`) | settings |
| `gmail_delete_filter` | Delete a filter (requires `confirm: true`) | settings |
| `gmail_get_vacation` | Get vacation responder settings | settings |
| `gmail_set_vacation` | Configure vacation responder | settings |

### MCP Prompts

| Prompt | Description |
|--------|-------------|
| `compose-email` | Guided email composition workflow |
| `reply-to-email` | Guided reply with proper threading |
| `review-drafts` | Review and manage pending drafts |
| `summarize-thread` | AI-assisted thread summarization |
| `smart-reply` | Context-aware reply suggestions |
| `extract-action-items` | Find TODOs and deadlines |
| `categorize-emails` | Suggest labels for uncategorized messages |

### MCP Resources

| Resource URI | Description |
|--------------|-------------|
| `accounts://list` | List connected accounts (read-only) |
| `cache://stats` | Cache statistics |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MCP_GOOGLE_CONFIG_PATH` | Override default config file location |
| `MCP_GOOGLE_PASSPHRASE` | Passphrase for encrypted token storage (fallback when keychain unavailable) |
| `MCP_GOOGLE_LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` |

## Troubleshooting

### "OAuth credentials not configured"

Your `config.json` is missing OAuth credentials. Ensure you have:
```json
{
  "version": 1,
  "oauth": {
    "clientId": "...",
    "clientSecret": "..."
  }
}
```

### "No refresh token received"

This can happen if you've previously authorized the app. To fix:
1. Go to [Google Account Permissions](https://myaccount.google.com/permissions)
2. Find and remove your MCP app
3. Run `google_add_account` again

### Port 8089 already in use

The OAuth callback server uses port 8089. If it's in use:
- Wait for the previous OAuth flow to complete
- Kill any process using the port: `lsof -ti:8089 | xargs kill`

### Keychain access issues (Linux/headless)

If the OS keychain is unavailable, set `MCP_GOOGLE_PASSPHRASE`:
```json
{
  "env": {
    "MCP_GOOGLE_PASSPHRASE": "your-secure-passphrase"
  }
}
```

Tokens will be encrypted with AES-256-GCM using this passphrase.

### "Scope insufficient" errors

You're trying to use a tool that requires a higher scope tier than the account has. Either:
- Remove and re-add the account with a higher scope tier
- Use a different account that has the required scope

### MCP server not connecting

1. Verify the path in your settings is correct and absolute
2. Ensure you've run `pnpm build` to compile TypeScript
3. Check that `dist/cli.js` exists
4. Try running manually: `node /path/to/dist/cli.js`

## Development

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Watch mode for development
pnpm dev

# Run tests
pnpm test

# Lint and format
pnpm lint:fix
pnpm format
```

## Security Notes

- **BYO OAuth**: You must provide your own Google Cloud OAuth credentials
- **Local storage**: All tokens are stored locally on your machine
- **Keychain preferred**: Uses OS keychain when available, falls back to encrypted file
- **Draft-first**: All sends require creating a draft first, then explicit confirmation
- **No shared credentials**: This server never uses shared OAuth credentials

## License

MIT
