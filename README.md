# MCP Google Multi-Account Server

An MCP (Model Context Protocol) server for accessing multiple Google accounts (primarily Gmail) from Claude Code, Claude Desktop, or any MCP-compatible client.

**Just talk to Claude naturally:**
```
"Check my email"
"Find messages from my boss this week"
"Write a reply thanking them for the update"
"Send it"
```

No special commands to memorize - Claude understands what you want.

## Features

- **Natural language**: Just describe what you want - "find my unread emails", "draft a reply"
- **Multi-account support**: Connect work, personal, and other accounts - search across all of them
- **Full Gmail access**: Search, read, compose, send, and organize emails
- **Attachments**: Download and send file attachments
- **Inbox management**: Labels, archive, trash, read/unread status
- **Filters & vacation**: Create email filters and configure vacation responders
- **AI productivity**: Thread summaries, smart reply suggestions, action item extraction
- **Safety first**: All sends require confirmation - Claude shows you the draft before sending
- **Privacy focused**: All credentials stored locally, you bring your own OAuth credentials

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

1. Start Claude Code (or restart if already running to pick up config changes)

2. Verify the server is connected and check the version:
   ```
   "What version of the Google MCP server is running?"
   ```
   Claude will show the version, git commit, and build date.

3. Add a Google account:
   ```
   "Add my Gmail account"
   ```
   Claude will:
   - Ask which permissions you need (readonly, compose, full, etc.)
   - Show you an authorization URL to open in your browser
   - After you complete OAuth in the browser, Claude will confirm the account was added

4. Start using your email:
   ```
   "Find my unread emails"
   "Search for emails from john@example.com"
   "Draft a reply to the last email"
   ```

**Note:** These examples are natural language - Claude understands your intent and uses the appropriate MCP tools automatically. You don't need to know the tool names.

### Example Conversations

Here are some real-world examples of how to interact with Claude using this MCP server:

#### Reading and Searching Email

```
You: "Check my email for anything from Amazon in the last week"
Claude: [Searches and returns matching emails with subjects, dates, and snippets]

You: "Show me the full email about my order"
Claude: [Fetches the complete message with body content]

You: "What attachments are in that email?"
Claude: [Lists any attachments with filenames and sizes]
```

#### Composing and Sending

```
You: "Write an email to sarah@example.com thanking her for the meeting"
Claude: I'll draft that email for you.
       [Creates draft]
       Here's the draft:
       To: sarah@example.com
       Subject: Thank you for the meeting
       ...
       Would you like me to send it, or make any changes?

You: "Looks good, send it"
Claude: [Sends the email with confirmation]
```

#### Managing Your Inbox

```
You: "Archive all emails from newsletters@example.com"
Claude: [Archives matching messages]

You: "Create a label called 'Urgent' with a red color"
Claude: [Creates the label]

You: "Mark the last 5 unread emails as read"
Claude: [Updates the messages]
```

#### Multi-Account Workflows

```
You: "Add my work Gmail account"
Claude: Which permissions would you like?
        - readonly: Read and search only
        - compose: Also send emails (recommended)
        - full: Also manage labels, archive, trash
        ...

You: "Compose, please"
Claude: [Opens OAuth flow for work account]

You: "Label my work account as 'work' and my personal as 'personal'"
Claude: [Sets labels on both accounts]

You: "Search for 'project update' across all my accounts"
Claude: [Searches both accounts and shows combined results]
```

#### AI-Powered Productivity

```
You: "Summarize this email thread"
Claude: [Analyzes the thread and provides]:
        - Main topic: Q3 budget review
        - Participants: Finance team (5 people)
        - Key decisions: Budget approved with 10% increase
        - Action items: Submit receipts by Friday

You: "What action items do I have from my unread emails?"
Claude: [Scans unread messages and extracts tasks with deadlines]

You: "Suggest a reply to the last email"
Claude: Based on the context, here are 3 options:
        1. Brief: "Thanks, I'll review and get back to you."
        2. Detailed: [longer response addressing all points]
        ...
        Which would you like me to draft?
```

#### Setting Up Automation

```
You: "Create a filter to auto-archive emails from noreply@example.com"
Claude: I'll create that filter. This will automatically archive
        all future emails from that sender. Confirm?

You: "Yes"
Claude: [Creates the filter]

You: "Set up my vacation responder - I'm out Dec 20-27"
Claude: What message would you like to send?

You: "Just say I'm on holiday and will respond when I return"
Claude: [Configures vacation responder with dates]
```

### Scope Tiers

When adding an account, Claude will ask which permissions you need:

| Tier | What You Can Do | Best For |
|------|-----------------|----------|
| `readonly` | Read and search emails | Checking email, research |
| `compose` | + Create drafts and send | Daily email use (recommended) |
| `full` | + Labels, archive, trash | Inbox organization |
| `settings` | + Filters, vacation responder | Email automation |
| `all` | Everything above | Full control |

**How it works:**
- `readonly` → `compose` → `full` builds on each other
- `settings` is separate (for filters/vacation only)
- You can combine them: "I want inbox management AND filters" → `full` + `settings`

**Examples:**
```
You: "Add my Gmail account"
Claude: Which permissions would you like?
        [Shows options]

You: "I just want to read emails"
Claude: [Adds with readonly scope]

You: "Actually, I need to send emails too"
Claude: You'll need to remove and re-add with compose permissions.
        Want me to do that?
```

## Available Tools

You don't need to memorize tool names - just describe what you want. Here's what's available:

### Account Management

| Just Say... | What Happens |
|-------------|--------------|
| "Show my Google accounts" | Lists all connected accounts |
| "Add my Gmail account" | Starts OAuth flow to add account |
| "Remove my work account" | Disconnects account and revokes tokens |
| "Label this account as 'personal'" | Tags account for easy reference |

### Reading Email (readonly scope)

| Just Say... | What Happens |
|-------------|--------------|
| "Find emails from john@example.com" | Searches with Gmail query syntax |
| "Show me unread emails from this week" | Returns matching messages |
| "Get the full email about the project" | Fetches complete message content |
| "Show me that entire conversation" | Gets thread with all messages |
| "What attachments are in this email?" | Lists files with names and sizes |
| "Download the PDF attachment" | Retrieves the file data |

**Gmail search tips:** Use Gmail's search syntax for powerful queries:
- `from:someone@example.com` - From specific sender
- `subject:meeting` - Subject contains word
- `is:unread` - Unread messages only
- `has:attachment` - Messages with attachments
- `newer_than:7d` - Last 7 days
- `label:important` - Has specific label

### Composing Email (compose scope)

| Just Say... | What Happens |
|-------------|--------------|
| "Write an email to sarah@example.com" | Creates a draft for review |
| "Draft a reply to the last email" | Creates reply with proper threading |
| "Attach report.pdf to this draft" | Adds attachment to draft |
| "Update the draft - change the subject" | Modifies existing draft |
| "Show me my draft before sending" | Previews the draft |
| "Delete that draft" | Removes the draft |
| "Send the email" | Sends after confirmation |

**Safety feature:** All emails go through a draft-first workflow. Claude will always show you the draft and ask for confirmation before sending.

### Inbox Management (full scope)

| Just Say... | What Happens |
|-------------|--------------|
| "Show my labels" | Lists all Gmail labels |
| "Create a 'Projects' label in blue" | Creates label with color |
| "Rename 'Old' label to 'Archive'" | Updates label properties |
| "Delete the 'Temp' label" | Removes label (keeps messages) |
| "Add the 'Important' label to this email" | Applies label to message |
| "Label these 50 emails as 'Done'" | Bulk label operation |
| "Mark this as read" | Changes read status |
| "Archive this email" | Removes from inbox |
| "Delete this email" | Moves to trash |
| "Restore from trash" | Recovers deleted message |

### Filters & Vacation (settings scope)

| Just Say... | What Happens |
|-------------|--------------|
| "Show my email filters" | Lists automatic rules |
| "Create a filter for newsletters" | Sets up auto-processing |
| "Delete the filter for old@example.com" | Removes automation rule |
| "Check my vacation settings" | Shows auto-reply config |
| "Turn on vacation responder" | Enables auto-reply |
| "I'm back - disable vacation reply" | Turns off auto-reply |

### AI Productivity Prompts

These prompts guide Claude through complex workflows:

| Just Say... | What Happens |
|-------------|--------------|
| "Help me compose an email" | Guided drafting with preview and confirmation |
| "Help me reply to this thread" | Proper threading, tone matching |
| "Review my pending drafts" | Shows drafts, offers send/edit/delete |
| "Summarize this email thread" | Extracts key points, decisions, action items |
| "Suggest replies for this email" | Offers brief/standard/detailed options |
| "What action items do I have?" | Scans emails for tasks and deadlines |
| "Help me organize my inbox" | Suggests labels for uncategorized emails |

### Technical Reference

<details>
<summary>Click to see exact tool names (for advanced users)</summary>

**Account Management:**
- `google_list_accounts`, `google_add_account`, `google_remove_account`, `google_set_account_labels`

**Gmail Reading:**
- `gmail_search_messages`, `gmail_get_message`, `gmail_get_messages_batch`, `gmail_get_thread`, `gmail_list_attachments`, `gmail_get_attachment`

**Gmail Composing:**
- `gmail_create_draft`, `gmail_create_draft_with_attachment`, `gmail_update_draft`, `gmail_get_draft`, `gmail_delete_draft`, `gmail_send_draft`, `gmail_reply_in_thread`

**Inbox Management:**
- `gmail_list_labels`, `gmail_create_label`, `gmail_update_label`, `gmail_delete_label`, `gmail_modify_labels`, `gmail_batch_modify_labels`, `gmail_mark_read_unread`, `gmail_archive`, `gmail_trash`, `gmail_untrash`

**Settings:**
- `gmail_list_filters`, `gmail_create_filter`, `gmail_delete_filter`, `gmail_get_vacation`, `gmail_set_vacation`

**MCP Prompts:**
- `compose-email`, `reply-to-email`, `review-drafts`, `summarize-thread`, `smart-reply`, `extract-action-items`, `categorize-emails`

**MCP Resources:**
- `accounts://list` - List connected accounts
- `cache://stats` - Cache statistics

</details>

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
3. Say "Add my Gmail account" again

### OAuth URL not showing up

When adding an account, the OAuth authorization URL should appear in:
- **Claude Code**: Look for a warning-level log message with the URL
- **Claude Desktop**: Check the MCP server logs
- **Terminal stderr**: The URL is also written to stderr with a visible banner

If you don't see the URL:
1. Check your MCP client's log output or notification area
2. The URL is also logged to stderr - check terminal output if running manually
3. The OAuth flow times out after 5 minutes if not completed

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

You're trying to do something that requires more permissions than the account has.

```
You: "Archive this email"
Claude: This account only has readonly permissions. You need 'full' scope
        to archive emails. Would you like me to remove and re-add the
        account with higher permissions?
```

**Fix:** Say "Remove my account and add it back with full permissions"

### MCP server not connecting

1. Verify the path in your settings is correct and absolute
2. Ensure you've run `pnpm build` to compile TypeScript
3. Check that `dist/cli.js` exists
4. Try running manually: `node /path/to/dist/cli.js`

### Common Questions

**Q: Can I use multiple Google accounts?**
Yes! Just say "Add another Gmail account" and repeat the OAuth flow. You can label them ("Label my work account as 'work'") and search across all of them.

**Q: Will Claude send emails without asking?**
No. All sends require explicit confirmation. Claude will always show you the draft first and ask "Would you like me to send this?"

**Q: What happens if I accidentally delete an email?**
Emails go to Trash first and stay there for 30 days. Say "Show my trash" or "Restore that email from trash" to recover it.

**Q: Can Claude read my emails when I'm not using it?**
No. The MCP server only runs when Claude Code/Desktop is active, and only accesses emails when you ask it to.

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
