# Drive & Calendar Support Design

## Summary

Add Google Drive and Google Calendar as first-class services alongside Gmail, with full read + write support, independent scope tiers, and confirm gates for operations that affect other people.

## Scope Tiers

Rename existing Gmail tiers to `mail_` prefix. Each service gets independent tiers:

```
Mail:      mail_readonly < mail_compose < mail_full  |  mail_settings (parallel)
Drive:     drive_readonly < drive_full
Calendar:  calendar_readonly < calendar_full
Combined:  all (everything across all services)
```

### Google API Scopes

| Tier | Google Scopes |
|------|--------------|
| `mail_readonly` | `gmail.readonly`, `userinfo.email` |
| `mail_compose` | `gmail.compose`, `gmail.readonly`, `userinfo.email` |
| `mail_full` | `gmail.modify`, `gmail.labels`, `userinfo.email` |
| `mail_settings` | `gmail.settings.basic`, `gmail.readonly`, `userinfo.email` |
| `drive_readonly` | `drive.readonly`, `userinfo.email` |
| `drive_full` | `drive.file`, `userinfo.email` |
| `calendar_readonly` | `calendar.readonly`, `userinfo.email` |
| `calendar_full` | `calendar.events`, `userinfo.email` |
| `all` | All of the above merged |

At `google_add_account`, user specifies tier(s) as an array — e.g., `tiers: ["mail_readonly", "drive_full", "calendar_full"]`. Scopes are merged and deduplicated.

### Migration

Existing accounts with old tier names (`readonly`, `compose`, `full`, `settings`) are auto-migrated on config load: silently rewrite to `mail_readonly`, `mail_compose`, `mail_full`, `mail_settings`.

## MCP Tools — Drive

### Read (drive_readonly)

| Tool | Description |
|------|------------|
| `drive_search_files` | Search with query string, returns file list with metadata |
| `drive_list_files` | List files in a folder (or root) |
| `drive_get_file` | Get file metadata (name, type, size, sharing, modified date) |
| `drive_get_file_content` | Download/export file content (text for docs/sheets, binary as base64) |

### Write (drive_full)

| Tool | Confirm Gate | Description |
|------|-------------|------------|
| `drive_upload_file` | No | Upload file content (text or base64) |
| `drive_create_folder` | No | Create folder |
| `drive_move_file` | No | Move file to different folder |
| `drive_copy_file` | No | Copy a file |
| `drive_rename_file` | No | Rename a file |
| `drive_trash_file` | No | Move to trash |
| `drive_share_file` | **Yes** | Share with user/anyone |
| `drive_update_permissions` | **Yes** | Modify sharing permissions |

## MCP Tools — Calendar

### Read (calendar_readonly)

| Tool | Description |
|------|------------|
| `calendar_list_calendars` | List all calendars for the account |
| `calendar_list_events` | List events in a time range (with optional calendar ID) |
| `calendar_get_event` | Get full event details (attendees, location, description, recurrence) |
| `calendar_search_events` | Search events by text query |
| `calendar_freebusy` | Check free/busy for a set of time ranges |

### Write (calendar_full)

| Tool | Confirm Gate | Description |
|------|-------------|------------|
| `calendar_create_event` | **If attendees** | Create event |
| `calendar_update_event` | **If attendees present or being added** | Update event |
| `calendar_delete_event` | **If attendees** | Delete event |
| `calendar_rsvp` | No | Respond to invitation (accept/decline/tentative) |
| `calendar_move_event` | No | Move event to different calendar |

## File Structure

```
src/
  drive/
    client.ts          # DriveClient class (wraps googleapis drive_v3)
    index.ts           # re-exports
  calendar/
    client.ts          # CalendarClient class (wraps googleapis calendar_v3)
    index.ts           # re-exports
  server/
    index.ts           # main server — calls register functions from each service
    gmail-tools.ts     # extracted Gmail tool handlers
    drive-tools.ts     # Drive tool handlers
    calendar-tools.ts  # Calendar tool handlers
```

Each service file exports a `registerXxxTools(server, accountStore)` function called from `server/index.ts`.

`DriveClient` and `CalendarClient` follow the same pattern as `GmailClient` — take an `AccountStore`, get an authenticated OAuth2 client per-account, wrap the googleapis SDK.

## Implementation Phases

### Phase 10: Scope Tier Refactor + Migration
- Rename existing tiers (readonly -> mail_readonly, etc.)
- Add drive_readonly, drive_full, calendar_readonly, calendar_full tiers
- Auto-migrate config on load
- Extract Gmail tool handlers to server/gmail-tools.ts
- Update `all` tier to include all services
- Update all existing tests

### Phase 11: Drive Read
- DriveClient class
- drive_search_files, drive_list_files, drive_get_file, drive_get_file_content
- Unit tests

### Phase 12: Drive Write
- drive_upload_file, drive_create_folder, drive_move_file, drive_copy_file, drive_rename_file, drive_trash_file
- drive_share_file, drive_update_permissions (with confirm gate)
- Unit tests

### Phase 13: Calendar Read
- CalendarClient class
- calendar_list_calendars, calendar_list_events, calendar_get_event, calendar_search_events, calendar_freebusy
- Unit tests

### Phase 14: Calendar Write
- calendar_create_event, calendar_update_event, calendar_delete_event, calendar_rsvp, calendar_move_event (with conditional confirm gate)
- Unit tests
