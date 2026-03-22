# Demo Video Scripts for Google OAuth Verification

Google requires a YouTube video demonstrating how each OAuth scope is used. Below are two scripts — one using Claude Code CLI, one using Claude Desktop — that together cover all scopes.

---

## Video 1: Claude Code CLI (Recommended: 5-7 minutes)

**Focus:** Account setup, Gmail (all scopes), Drive (all scopes)

### Pre-recording Setup
- Have the MCP server installed: `npx @procedure-tech/mcp-google`
- Have a test Google account ready (not your primary — use a throwaway)
- Clear any previous config: `rm -rf ~/.config/mcp-google/`
- Terminal with large font size (18-20pt) for readability

### Script

#### Scene 1: Installation & Account Connection (1 min)
```
NARRATION: "MCP Google Multi-Account is a local MCP server that connects
AI assistants to Google Workspace. Let me show how it works with Claude Code CLI."

ACTION: Show terminal
TYPE: claude mcp add google -- npx -y @procedure-tech/mcp-google
TYPE: claude

NARRATION: "First, I'll connect a Google account."
TYPE (to Claude): "Add my Google account"

ACTION: Claude calls google_add_account, returns an OAuth URL
ACTION: Click the URL — browser opens Google consent screen
ACTION: Show the consent screen (scopes listed), click "Allow"
ACTION: Return to terminal — Claude confirms account connected

NARRATION: "The OAuth flow runs locally. Tokens are stored on my machine
at ~/.config/mcp-google/. No data goes through any external server."
```

#### Scene 2: Gmail Read (gmail.readonly) (1 min)
```
NARRATION: "Let me search my emails."
TYPE: "Search my Gmail for emails from the last week"

ACTION: Claude calls gmail_search_messages, shows results
ACTION: Show a few email subjects returned

TYPE: "Show me the full content of the first email"

ACTION: Claude calls gmail_get_message, displays the email

NARRATION: "This uses the gmail.readonly scope to search and read emails."
```

#### Scene 3: Gmail Compose & Send (gmail.compose, gmail.modify) (1.5 min)
```
NARRATION: "Now I'll compose and send an email using the draft-first workflow."
TYPE: "Draft an email to myself with subject 'MCP Test' saying 'Hello from MCP Google'"

ACTION: Claude calls gmail_create_draft, returns draft ID
NARRATION: "Notice it created a draft first, not sent directly."

TYPE: "Show me the draft"
ACTION: Claude calls gmail_get_draft, displays the draft content

TYPE: "Send that draft"
ACTION: Claude calls gmail_send_draft with confirm: true
NARRATION: "Destructive actions like sending require explicit confirmation.
Claude asks me to confirm before sending."

ACTION: Confirm the send
NARRATION: "This uses gmail.compose for drafting and gmail.modify for sending."
```

#### Scene 4: Gmail Labels & Inbox Management (gmail.labels) (45 sec)
```
TYPE: "Show me all my Gmail labels"
ACTION: Claude calls gmail_list_labels, shows system + custom labels

TYPE: "Archive the email I just sent to myself"
ACTION: Claude calls gmail_archive

NARRATION: "Label management and inbox operations use the gmail.labels scope."
```

#### Scene 5: Gmail Settings (gmail.settings.basic) (30 sec)
```
TYPE: "Show me my Gmail filters"
ACTION: Claude calls gmail_list_filters, shows any existing filters

NARRATION: "Filter and settings access uses gmail.settings.basic."
```

#### Scene 6: Google Drive Read (drive.readonly) (1 min)
```
NARRATION: "Now let me show Google Drive access."
TYPE: "Search my Drive for any documents"

ACTION: Claude calls drive_search_files, shows results
ACTION: Pick a file from the results

TYPE: "Show me the contents of that file"
ACTION: Claude calls drive_get_file_content, displays content

NARRATION: "Searching across all Drive files requires drive.readonly.
The narrower drive.file scope only accesses files created by this app,
which wouldn't let users search their existing files."
```

#### Scene 7: Google Drive Write (drive.file) (45 sec)
```
TYPE: "Create a new folder called 'MCP Test Folder' in my Drive"
ACTION: Claude calls drive_create_folder

TYPE: "Upload a text file with the content 'Hello World' to that folder"
ACTION: Claude calls drive_upload_file

NARRATION: "File creation and uploads use the drive.file scope."
```

#### Scene 8: Account Removal (30 sec)
```
TYPE: "Remove my Google account"
ACTION: Claude calls google_remove_account
NARRATION: "Removing an account deletes all local tokens immediately.
Users can also revoke access from their Google Account Permissions page."
```

---

## Video 2: Claude Desktop (Recommended: 4-5 minutes)

**Focus:** Calendar (all scopes), multi-account, scope tiers

### Pre-recording Setup
- Claude Desktop installed with MCP server configured in `claude_desktop_config.json`:
  ```json
  {
    "mcpServers": {
      "google": {
        "command": "npx",
        "args": ["-y", "@procedure-tech/mcp-google"]
      }
    }
  }
  ```
- Two test Google accounts ready (e.g., personal + work)
- Create a test calendar event in advance for the demo

### Script

#### Scene 1: Setup in Claude Desktop (30 sec)
```
NARRATION: "Here's how MCP Google works in Claude Desktop."

ACTION: Show claude_desktop_config.json briefly
ACTION: Open Claude Desktop, start a new conversation

NARRATION: "The server is configured as an MCP server. Let me connect an account."
TYPE: "Connect my Google account"

ACTION: Claude calls google_add_account, OAuth flow in browser
ACTION: Complete consent, return to Claude Desktop
```

#### Scene 2: Multi-Account Support (1 min)
```
NARRATION: "A key feature is multi-account support. Let me add a second account."
TYPE: "Add another Google account and label it 'work'"

ACTION: Complete OAuth for second account

TYPE: "List my connected accounts"
ACTION: Claude calls google_list_accounts, shows both accounts with labels

NARRATION: "Each account has isolated tokens and can be labeled for easy reference."
```

#### Scene 3: Calendar Read (calendar.readonly) (1 min)
```
TYPE: "Show me my calendars"
ACTION: Claude calls calendar_list_calendars, shows all calendars

TYPE: "What events do I have this week?"
ACTION: Claude calls calendar_list_events, shows upcoming events

TYPE: "Search for any meetings about 'standup'"
ACTION: Claude calls calendar_search_events

NARRATION: "Reading calendars and events uses calendar.readonly."
```

#### Scene 4: Calendar Write (calendar.events) (1.5 min)
```
TYPE: "Create a meeting called 'MCP Demo Review' tomorrow at 2pm for 30 minutes"

ACTION: Claude calls calendar_create_event (no attendees, so no confirmation needed)
NARRATION: "Events without attendees are created directly."

TYPE: "Now update that event to add a description: 'Review the demo video'"
ACTION: Claude calls calendar_update_event

TYPE: "Check if I'm free tomorrow between 3pm and 5pm"
ACTION: Claude calls calendar_freebusy, shows availability

TYPE: "Delete the demo review event"
ACTION: Claude calls calendar_delete_event

NARRATION: "Creating, updating, and deleting events uses calendar.events.
When attendees are involved, the server requires explicit confirmation
before sending invitations."
```

#### Scene 5: Scope Tiers (30 sec)
```
NARRATION: "Scopes are requested incrementally. Users start with read-only
access and upgrade only when needed."

TYPE: "What scope tier am I using for my personal account?"
ACTION: Show account details with scope tier

NARRATION: "This minimizes the permissions requested from each user."
```

#### Scene 6: Privacy & Security Summary (30 sec)
```
NARRATION: "To summarize the security model:
- The server runs entirely on the user's machine
- OAuth tokens are stored locally at ~/.config/mcp-google/
- All API calls go directly from the user's machine to Google
- No data passes through any third-party server
- No analytics or telemetry
- The source code is open source and publicly auditable
- Destructive actions require explicit user confirmation

The app is available at multiaccountgooglemcp.procedure.tech
and the source code is on GitHub."
```

---

## Recording Tips

1. **Resolution:** Record at 1080p minimum
2. **Font size:** Use 18-20pt in terminal, zoom in Claude Desktop
3. **Pace:** Go slowly on the OAuth consent screen so Google can see the scopes
4. **Pause:** Briefly pause on each tool result so it's readable
5. **Blur:** Blur any real email content or sensitive info — use test accounts
6. **Upload:** Upload as Unlisted on YouTube, paste the link in the consent screen

## Scope Coverage Checklist

| Scope | Video | Scene |
|-------|-------|-------|
| openid | 1 | Scene 1 (OAuth flow) |
| userinfo.email | 1 | Scene 1 (account identification) |
| userinfo.profile | 1 | Scene 1 (account identification) |
| gmail.readonly | 1 | Scene 2 (search, read) |
| gmail.compose | 1 | Scene 3 (create draft) |
| gmail.modify | 1 | Scene 3 (send draft) |
| gmail.labels | 1 | Scene 4 (list labels, archive) |
| gmail.settings.basic | 1 | Scene 5 (list filters) |
| drive.readonly | 1 | Scene 6 (search, read files) |
| drive.file | 1 | Scene 7 (create folder, upload) |
| calendar.readonly | 2 | Scene 3 (list calendars, events) |
| calendar.events | 2 | Scene 4 (create, update, delete) |
