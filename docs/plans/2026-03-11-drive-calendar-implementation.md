# Drive & Calendar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Google Drive and Google Calendar as first-class services with full read + write support, independent scope tiers, and confirm gates for sharing/attendee operations.

**Architecture:** Extend existing multi-service MCP server. Each service (Gmail, Drive, Calendar) gets its own client class in `src/<service>/client.ts`, tool registration in `src/server/<service>-tools.ts`, and independent scope tiers. Shared infrastructure (auth, errors, config) is extended in-place.

**Tech Stack:** TypeScript, googleapis SDK (drive_v3, calendar_v3), vitest, zod, @modelcontextprotocol/sdk

---

## Task 1: Rename SCOPE_TIERS keys to mail_ prefix

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Update SCOPE_TIERS object keys**

In `src/types/index.ts`, rename the keys in `SCOPE_TIERS`:
- `readonly` → `mail_readonly`
- `compose` → `mail_compose`
- `full` → `mail_full`
- `settings` → `mail_settings`
- `all` stays `all` (but will be expanded later in Task 3)

```typescript
export const SCOPE_TIERS = {
  mail_readonly: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  mail_compose: [
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  mail_full: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  mail_settings: [
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  all: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
} as const;
```

**Step 2: Update getScopeTier function**

Update the return values from `'readonly'` to `'mail_readonly'`, etc. Also update internal checks:

```typescript
export function getScopeTier(scopes: string[]): ScopeTier {
  const hasModify = scopes.includes('https://www.googleapis.com/auth/gmail.modify');
  const hasLabels = scopes.includes('https://www.googleapis.com/auth/gmail.labels');
  const hasCompose = scopes.includes('https://www.googleapis.com/auth/gmail.compose');
  const hasSettings = scopes.includes('https://www.googleapis.com/auth/gmail.settings.basic');
  const hasDriveReadonly = scopes.includes('https://www.googleapis.com/auth/drive.readonly');
  const hasDriveFull = scopes.includes('https://www.googleapis.com/auth/drive.file');
  const hasCalendarReadonly = scopes.includes('https://www.googleapis.com/auth/calendar.readonly');
  const hasCalendarFull = scopes.includes('https://www.googleapis.com/auth/calendar.events');

  // 'all' tier has scopes from multiple services
  const hasMailFull = hasModify || hasLabels;
  const hasDrive = hasDriveReadonly || hasDriveFull;
  const hasCalendar = hasCalendarReadonly || hasCalendarFull;
  if (hasMailFull && hasSettings && hasDrive && hasCalendar) {
    return 'all';
  }

  // Calendar tiers
  if (hasCalendarFull) return 'calendar_full';
  if (hasCalendarReadonly) return 'calendar_readonly';

  // Drive tiers
  if (hasDriveFull) return 'drive_full';
  if (hasDriveReadonly) return 'drive_readonly';

  // Mail tiers (original logic with new names)
  if ((hasModify || hasLabels) && hasSettings) return 'all';
  if (hasModify || hasLabels) return 'mail_full';
  if (hasSettings) return 'mail_settings';
  if (hasCompose) return 'mail_compose';
  return 'mail_readonly';
}
```

Note: `getScopeTier` returns the "primary" tier. Since accounts can have multiple tiers merged, the `hasSufficientScope` function is what actually matters for validation — it checks if the account's scopes include the required scope URLs.

**Step 3: Update hasSufficientScope function**

Rewrite to be scope-URL based rather than tier-hierarchy based. This is cleaner for multi-service:

```typescript
export function hasSufficientScope(accountScopes: string[], requiredTier: ScopeTier): boolean {
  const requiredScopes = SCOPE_TIERS[requiredTier];
  // Account must have all required scopes (except userinfo.email which is always present)
  return requiredScopes.every(scope => accountScopes.includes(scope));
}
```

This is simpler and more correct — instead of tier hierarchy logic, just check if the account has all scopes needed for the operation.

**Step 4: Update OPERATION_SCOPE_REQUIREMENTS**

Rename all values:

```typescript
export const OPERATION_SCOPE_REQUIREMENTS = {
  // Read operations
  search: 'mail_readonly',
  getMessage: 'mail_readonly',
  getThread: 'mail_readonly',
  // Compose operations
  createDraft: 'mail_compose',
  updateDraft: 'mail_compose',
  getDraft: 'mail_compose',
  sendDraft: 'mail_compose',
  deleteDraft: 'mail_compose',
  replyToThread: 'mail_compose',
  // Modify operations
  listLabels: 'mail_full',
  modifyLabels: 'mail_full',
  markReadUnread: 'mail_full',
  archive: 'mail_full',
  trash: 'mail_full',
  untrash: 'mail_full',
  // Settings operations
  listFilters: 'mail_settings',
  createFilter: 'mail_settings',
  deleteFilter: 'mail_settings',
  getVacation: 'mail_settings',
  setVacation: 'mail_settings',
  // Drive operations
  driveSearch: 'drive_readonly',
  driveListFiles: 'drive_readonly',
  driveGetFile: 'drive_readonly',
  driveGetContent: 'drive_readonly',
  driveUpload: 'drive_full',
  driveCreateFolder: 'drive_full',
  driveMoveFile: 'drive_full',
  driveCopyFile: 'drive_full',
  driveRenameFile: 'drive_full',
  driveTrashFile: 'drive_full',
  driveShareFile: 'drive_full',
  driveUpdatePermissions: 'drive_full',
  // Calendar operations
  calendarListCalendars: 'calendar_readonly',
  calendarListEvents: 'calendar_readonly',
  calendarGetEvent: 'calendar_readonly',
  calendarSearchEvents: 'calendar_readonly',
  calendarFreeBusy: 'calendar_readonly',
  calendarCreateEvent: 'calendar_full',
  calendarUpdateEvent: 'calendar_full',
  calendarDeleteEvent: 'calendar_full',
  calendarRsvp: 'calendar_full',
  calendarMoveEvent: 'calendar_full',
} as const satisfies Record<string, ScopeTier>;
```

**Step 5: Run tests to verify they fail**

Run: `pnpm test`
Expected: Many failures because tests reference old tier names.

**Step 6: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: rename scope tiers to mail_ prefix, add drive/calendar tiers"
```

---

## Task 2: Add Drive and Calendar scope tiers

**Files:**
- Modify: `src/types/index.ts` (already partially done in Task 1)

**Step 1: Add new tier entries to SCOPE_TIERS**

Add after `mail_settings`:

```typescript
  drive_readonly: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  drive_full: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  calendar_readonly: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  calendar_full: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
```

**Step 2: Update `all` tier to include everything**

```typescript
  all: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
```

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add drive and calendar scope tiers"
```

---

## Task 3: Add config migration for old tier names

**Files:**
- Modify: `src/config/index.ts`

**Step 1: Add migration map and function**

Add before `loadConfig()`:

```typescript
// Migration map: old tier names -> new tier names (v1 -> v2)
const SCOPE_MIGRATION: Record<string, string> = {
  'readonly': 'mail_readonly',
  'compose': 'mail_compose',
  'full': 'mail_full',
  'settings': 'mail_settings',
};

// Migrate old scope URLs to work with new tier-based validation
// Old accounts stored raw scope URLs, which still work — but if
// they stored tier names anywhere, we need to map them.
function migrateConfig(config: Config): Config {
  // No migration needed for scope URLs — they're the same Google OAuth URLs.
  // Migration only matters for the scopeTier parameter in google_add_account,
  // which we handle by accepting both old and new names.
  return config;
}
```

Actually, looking more carefully at the code — accounts store raw Google scope URLs (like `https://www.googleapis.com/auth/gmail.readonly`), not tier names. The tier names are only used in the tool input schema for `google_add_account`. So the migration is actually at the **tool input level** — we accept both old and new tier names. No config file migration needed.

**Step 2: Update google_add_account to accept both old and new names**

This will be done in Task 5 when updating server/index.ts.

**Step 3: Commit** (skip if no config changes needed)

---

## Task 4: Update scope validation tests

**Files:**
- Modify: `tests/unit/scope-validation.test.ts`

**Step 1: Update all tier name references**

Replace all occurrences of old tier names in test expectations:
- `'readonly'` → `'mail_readonly'`
- `'compose'` → `'mail_compose'`
- `'full'` → `'mail_full'`
- `'settings'` → `'mail_settings'`

Also update `SCOPE_TIERS.readonly` → `SCOPE_TIERS.mail_readonly`, etc.

**Step 2: Add tests for new Drive/Calendar tiers**

Add test cases:

```typescript
describe('Drive scope tiers', () => {
  it('drive_readonly tier has drive.readonly scope', () => {
    expect(SCOPE_TIERS.drive_readonly).toContain(
      'https://www.googleapis.com/auth/drive.readonly',
    );
  });

  it('drive_full tier has drive.file scope', () => {
    expect(SCOPE_TIERS.drive_full).toContain(
      'https://www.googleapis.com/auth/drive.file',
    );
  });

  it('drive_readonly account satisfies drive_readonly requirement', () => {
    expect(hasSufficientScope([...SCOPE_TIERS.drive_readonly], 'drive_readonly')).toBe(true);
  });

  it('drive_readonly account does not satisfy drive_full requirement', () => {
    expect(hasSufficientScope([...SCOPE_TIERS.drive_readonly], 'drive_full')).toBe(false);
  });

  it('drive_full account does not satisfy mail_readonly requirement', () => {
    expect(hasSufficientScope([...SCOPE_TIERS.drive_full], 'mail_readonly')).toBe(false);
  });
});

describe('Calendar scope tiers', () => {
  it('calendar_readonly tier has calendar.readonly scope', () => {
    expect(SCOPE_TIERS.calendar_readonly).toContain(
      'https://www.googleapis.com/auth/calendar.readonly',
    );
  });

  it('calendar_full tier has calendar.events scope', () => {
    expect(SCOPE_TIERS.calendar_full).toContain(
      'https://www.googleapis.com/auth/calendar.events',
    );
  });

  it('calendar_readonly satisfies calendar_readonly', () => {
    expect(hasSufficientScope([...SCOPE_TIERS.calendar_readonly], 'calendar_readonly')).toBe(true);
  });

  it('calendar_readonly does not satisfy calendar_full', () => {
    expect(hasSufficientScope([...SCOPE_TIERS.calendar_readonly], 'calendar_full')).toBe(false);
  });
});

describe('Cross-service isolation', () => {
  it('mail_full does not satisfy drive_readonly', () => {
    expect(hasSufficientScope([...SCOPE_TIERS.mail_full], 'drive_readonly')).toBe(false);
  });

  it('drive_full does not satisfy calendar_readonly', () => {
    expect(hasSufficientScope([...SCOPE_TIERS.drive_full], 'calendar_readonly')).toBe(false);
  });

  it('merged tiers satisfy both', () => {
    const scopes = mergeScopeTiers(['mail_full', 'drive_readonly']);
    expect(hasSufficientScope(scopes, 'mail_full')).toBe(true);
    expect(hasSufficientScope(scopes, 'drive_readonly')).toBe(true);
    expect(hasSufficientScope(scopes, 'calendar_readonly')).toBe(false);
  });
});
```

**Step 3: Run tests**

Run: `pnpm test tests/unit/scope-validation.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/unit/scope-validation.test.ts
git commit -m "test: update scope validation tests for mail_ prefix and drive/calendar tiers"
```

---

## Task 5: Update server/index.ts — account tools and scope references

**Files:**
- Modify: `src/server/index.ts`

**Step 1: Update google_add_account tool**

Update the `scopeTier` enum and description to use new tier names. Accept both old and new names for backwards compatibility:

```typescript
scopeTier: z
  .enum([
    'mail_readonly', 'mail_compose', 'mail_full', 'mail_settings',
    'drive_readonly', 'drive_full',
    'calendar_readonly', 'calendar_full',
    'all',
    // Legacy aliases
    'readonly', 'compose', 'full', 'settings',
  ])
  .optional()
  .describe('Single permission tier (use scopeTiers for multiple)'),
scopeTiers: z
  .array(z.enum([
    'mail_readonly', 'mail_compose', 'mail_full', 'mail_settings',
    'drive_readonly', 'drive_full',
    'calendar_readonly', 'calendar_full',
    'all',
    // Legacy aliases
    'readonly', 'compose', 'full', 'settings',
  ]))
  .optional()
  .describe('Combine multiple tiers (e.g., ["mail_full", "drive_readonly"])'),
```

Add a migration helper inside the tool handler:

```typescript
// Map legacy tier names to new names
function migrateTierName(tier: string): ScopeTier {
  const LEGACY_MAP: Record<string, ScopeTier> = {
    readonly: 'mail_readonly',
    compose: 'mail_compose',
    full: 'mail_full',
    settings: 'mail_settings',
  };
  return LEGACY_MAP[tier] ?? (tier as ScopeTier);
}
```

**Step 2: Update all validateAccountScope calls**

Replace `'readonly'` → `'mail_readonly'`, `'compose'` → `'mail_compose'`, `'full'` → `'mail_full'`, `'settings'` → `'mail_settings'` in all Gmail tool handlers.

**Step 3: Update the scope selection prompt options**

```typescript
options: [
  { tier: 'mail_readonly', description: 'Read and search emails only' },
  { tier: 'mail_compose', description: 'Also compose and send emails' },
  { tier: 'mail_full', description: 'Also manage labels, archive, trash' },
  { tier: 'mail_settings', description: 'Also manage filters and vacation responder' },
  { tier: 'drive_readonly', description: 'Read Google Drive files' },
  { tier: 'drive_full', description: 'Read and write Google Drive files' },
  { tier: 'calendar_readonly', description: 'Read Google Calendar events' },
  { tier: 'calendar_full', description: 'Read and write Google Calendar events' },
  { tier: 'all', description: 'All permissions across all services' },
],
```

**Step 4: Run tests**

Run: `pnpm test`
Expected: All tests PASS (after Task 4 updates)

**Step 5: Commit**

```bash
git add src/server/index.ts
git commit -m "refactor: update server tool registrations for new scope tier names"
```

---

## Task 6: Extract Gmail tools to server/gmail-tools.ts

**Files:**
- Create: `src/server/gmail-tools.ts`
- Modify: `src/server/index.ts`

**Step 1: Create gmail-tools.ts**

Extract all Gmail tool registrations (from `gmail_search_messages` through the last Gmail tool) into a new file. The file exports a single function:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AccountStore } from '../auth/index.js';
import {
  confirmationRequired,
  errorResponse,
  successResponse,
  toMcpError,
} from '../errors/index.js';
import { GmailClient, getHeader, getTextBody } from '../gmail/index.js';
import type { ScopeTier } from '../types/index.js';
import { cache } from '../utils/index.js';

export function registerGmailTools(
  server: McpServer,
  accountStore: AccountStore,
  validateAccountScope: (accountId: string, requiredTier: ScopeTier) =>
    { error: ReturnType<typeof errorResponse> } | { account: any },
): void {
  // ... all gmail tool registrations moved here ...
}
```

Move ALL Gmail tool registrations (`gmail_search_messages`, `gmail_get_message`, `gmail_get_thread`, `gmail_get_messages_batch`, `gmail_create_draft`, `gmail_update_draft`, `gmail_get_draft`, `gmail_delete_draft`, `gmail_send_draft`, `gmail_reply_in_thread`, `gmail_create_draft_with_attachment`, `gmail_list_attachments`, `gmail_get_attachment`, `gmail_list_labels`, `gmail_modify_labels`, `gmail_batch_modify_labels`, `gmail_create_label`, `gmail_update_label`, `gmail_delete_label`, `gmail_mark_read_unread`, `gmail_archive`, `gmail_trash`, `gmail_untrash`, `gmail_list_filters`, `gmail_create_filter`, `gmail_delete_filter`, `gmail_get_vacation`, `gmail_set_vacation`) from `server/index.ts` into this function.

**Step 2: Update server/index.ts to call registerGmailTools**

```typescript
import { registerGmailTools } from './gmail-tools.js';

// After validateAccountScope is defined:
registerGmailTools(server, accountStore, validateAccountScope);
```

Remove all the Gmail tool registrations from `server/index.ts`. Keep: version, list_accounts, add_account, check_pending_auth, remove_account, set_account_labels, MCP prompts, and MCP resources.

**Step 3: Run tests**

Run: `pnpm test`
Expected: All tests PASS (no behavior change)

**Step 4: Commit**

```bash
git add src/server/gmail-tools.ts src/server/index.ts
git commit -m "refactor: extract Gmail tools to server/gmail-tools.ts"
```

---

## Task 7: Add Drive and Calendar error codes

**Files:**
- Modify: `src/errors/index.ts`

**Step 1: Add error codes**

Add to the `ErrorCode` object:

```typescript
  // Drive resource errors
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FOLDER_NOT_FOUND: 'FOLDER_NOT_FOUND',
  DRIVE_API_ERROR: 'DRIVE_API_ERROR',
  DRIVE_QUOTA_EXCEEDED: 'DRIVE_QUOTA_EXCEEDED',

  // Calendar resource errors
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  CALENDAR_NOT_FOUND: 'CALENDAR_NOT_FOUND',
  CALENDAR_API_ERROR: 'CALENDAR_API_ERROR',
```

**Step 2: Add factory functions**

```typescript
export function fileNotFound(fileId: string): McpToolError {
  return new McpToolError(ErrorCode.FILE_NOT_FOUND, `File not found: ${fileId}`, { fileId });
}

export function driveApiError(originalMessage: string, statusCode?: number): McpToolError {
  return new McpToolError(ErrorCode.DRIVE_API_ERROR, `Drive API error: ${originalMessage}`, {
    originalMessage,
    ...(statusCode && { statusCode }),
  });
}

export function eventNotFound(eventId: string): McpToolError {
  return new McpToolError(ErrorCode.EVENT_NOT_FOUND, `Event not found: ${eventId}`, { eventId });
}

export function calendarNotFound(calendarId: string): McpToolError {
  return new McpToolError(ErrorCode.CALENDAR_NOT_FOUND, `Calendar not found: ${calendarId}`, { calendarId });
}

export function calendarApiError(originalMessage: string, statusCode?: number): McpToolError {
  return new McpToolError(ErrorCode.CALENDAR_API_ERROR, `Calendar API error: ${originalMessage}`, {
    originalMessage,
    ...(statusCode && { statusCode }),
  });
}
```

**Step 3: Commit**

```bash
git add src/errors/index.ts
git commit -m "feat: add Drive and Calendar error codes and factory functions"
```

---

## Task 8: Create DriveClient

**Files:**
- Create: `src/drive/client.ts`
- Create: `src/drive/index.ts`

**Step 1: Write failing test**

Create `tests/unit/drive-client.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

// We'll test DriveClient methods via mocked googleapis
// Test structure mirrors gmail-drafts.test.ts pattern

describe('DriveClient', () => {
  it('placeholder - drive client exists', async () => {
    const { DriveClient } = await import('../../src/drive/index.js');
    expect(DriveClient).toBeDefined();
  });
});
```

Run: `pnpm test tests/unit/drive-client.test.ts`
Expected: FAIL (module not found)

**Step 2: Create src/drive/client.ts**

```typescript
import { type drive_v3, google } from 'googleapis';
import type { AccountStore } from '../auth/index.js';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  owners?: Array<{ emailAddress: string; displayName?: string }>;
  shared?: boolean;
  trashed?: boolean;
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface DrivePermission {
  id?: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  domain?: string;
  displayName?: string;
}

export class DriveClient {
  private readonly accountStore: AccountStore;
  private readonly accountId: string;
  private drive: drive_v3.Drive | null = null;

  constructor(accountStore: AccountStore, accountId: string) {
    this.accountStore = accountStore;
    this.accountId = accountId;
  }

  private async getDrive(): Promise<drive_v3.Drive> {
    if (!this.drive) {
      const auth = await this.accountStore.getAuthenticatedClient(this.accountId);
      this.drive = google.drive({ version: 'v3', auth });
    }
    return this.drive;
  }

  async searchFiles(query: string, options: { maxResults?: number; pageToken?: string } = {}): Promise<DriveFileList> {
    const drive = await this.getDrive();
    const response = await drive.files.list({
      q: query,
      pageSize: options.maxResults ?? 20,
      pageToken: options.pageToken,
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed)',
    });

    const files: DriveFile[] = (response.data.files ?? []).map(f => this.convertFile(f));
    const result: DriveFileList = { files };
    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }
    return result;
  }

  async listFiles(folderId?: string, options: { maxResults?: number; pageToken?: string } = {}): Promise<DriveFileList> {
    const query = folderId ? `'${folderId}' in parents and trashed = false` : 'trashed = false';
    return this.searchFiles(query, options);
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const drive = await this.getDrive();
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed',
    });
    return this.convertFile(response.data);
  }

  async getFileContent(fileId: string): Promise<{ content: string; mimeType: string }> {
    const drive = await this.getDrive();

    // First get file metadata to check type
    const file = await this.getFile(fileId);

    // Google Workspace files need to be exported
    const exportMimeTypes: Record<string, string> = {
      'application/vnd.google-apps.document': 'text/plain',
      'application/vnd.google-apps.spreadsheet': 'text/csv',
      'application/vnd.google-apps.presentation': 'text/plain',
      'application/vnd.google-apps.drawing': 'image/png',
    };

    const exportMimeType = exportMimeTypes[file.mimeType];
    if (exportMimeType) {
      const response = await drive.files.export({
        fileId,
        mimeType: exportMimeType,
      }, { responseType: 'text' });
      return { content: response.data as string, mimeType: exportMimeType };
    }

    // Regular files - download content
    const response = await drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'arraybuffer' });

    const buffer = Buffer.from(response.data as ArrayBuffer);
    const isText = file.mimeType.startsWith('text/') ||
      file.mimeType === 'application/json' ||
      file.mimeType === 'application/xml';

    if (isText) {
      return { content: buffer.toString('utf-8'), mimeType: file.mimeType };
    }

    // Binary files returned as base64
    return { content: buffer.toString('base64'), mimeType: file.mimeType };
  }

  async uploadFile(options: {
    name: string;
    content: string;
    mimeType: string;
    parentFolderId?: string;
    isBase64?: boolean;
  }): Promise<DriveFile> {
    const drive = await this.getDrive();

    const fileMetadata: drive_v3.Schema$File = {
      name: options.name,
    };
    if (options.parentFolderId) {
      fileMetadata.parents = [options.parentFolderId];
    }

    const buffer = options.isBase64
      ? Buffer.from(options.content, 'base64')
      : Buffer.from(options.content, 'utf-8');

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: options.mimeType,
        body: require('stream').Readable.from(buffer),
      },
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed',
    });

    return this.convertFile(response.data);
  }

  async createFolder(name: string, parentFolderId?: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId];
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed',
    });

    return this.convertFile(response.data);
  }

  async moveFile(fileId: string, newParentId: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    // Get current parents to remove
    const file = await this.getFile(fileId);
    const previousParents = (file.parents ?? []).join(',');

    const response = await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: previousParents,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed',
    });

    return this.convertFile(response.data);
  }

  async copyFile(fileId: string, name?: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const requestBody: drive_v3.Schema$File = {};
    if (name) {
      requestBody.name = name;
    }

    const response = await drive.files.copy({
      fileId,
      requestBody,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed',
    });

    return this.convertFile(response.data);
  }

  async renameFile(fileId: string, name: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.update({
      fileId,
      requestBody: { name },
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed',
    });

    return this.convertFile(response.data);
  }

  async trashFile(fileId: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed',
    });

    return this.convertFile(response.data);
  }

  async shareFile(fileId: string, permission: Omit<DrivePermission, 'id'>, sendNotification?: boolean): Promise<DrivePermission> {
    const drive = await this.getDrive();

    const response = await drive.permissions.create({
      fileId,
      sendNotificationEmail: sendNotification ?? true,
      requestBody: {
        type: permission.type,
        role: permission.role,
        emailAddress: permission.emailAddress,
        domain: permission.domain,
      },
      fields: 'id, type, role, emailAddress, domain, displayName',
    });

    return this.convertPermission(response.data);
  }

  async updatePermissions(fileId: string, permissionId: string, role: DrivePermission['role']): Promise<DrivePermission> {
    const drive = await this.getDrive();

    const response = await drive.permissions.update({
      fileId,
      permissionId,
      requestBody: { role },
      fields: 'id, type, role, emailAddress, domain, displayName',
    });

    return this.convertPermission(response.data);
  }

  private convertFile(f: drive_v3.Schema$File): DriveFile {
    const result: DriveFile = {
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
    };
    if (f.size) result.size = f.size;
    if (f.createdTime) result.createdTime = f.createdTime;
    if (f.modifiedTime) result.modifiedTime = f.modifiedTime;
    if (f.parents) result.parents = f.parents;
    if (f.webViewLink) result.webViewLink = f.webViewLink;
    if (f.owners) {
      result.owners = f.owners.map(o => ({
        emailAddress: o.emailAddress ?? '',
        ...(o.displayName && { displayName: o.displayName }),
      }));
    }
    if (f.shared !== undefined && f.shared !== null) result.shared = f.shared;
    if (f.trashed !== undefined && f.trashed !== null) result.trashed = f.trashed;
    return result;
  }

  private convertPermission(p: drive_v3.Schema$Permission): DrivePermission {
    const result: DrivePermission = {
      type: (p.type ?? 'user') as DrivePermission['type'],
      role: (p.role ?? 'reader') as DrivePermission['role'],
    };
    if (p.id) result.id = p.id;
    if (p.emailAddress) result.emailAddress = p.emailAddress;
    if (p.domain) result.domain = p.domain;
    if (p.displayName) result.displayName = p.displayName;
    return result;
  }
}
```

**Step 3: Create src/drive/index.ts**

```typescript
export {
  DriveClient,
  type DriveFile,
  type DriveFileList,
  type DrivePermission,
} from './client.js';
```

**Step 4: Run test**

Run: `pnpm test tests/unit/drive-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/drive/ tests/unit/drive-client.test.ts
git commit -m "feat: add DriveClient with read and write methods"
```

---

## Task 9: Create Drive tool registrations

**Files:**
- Create: `src/server/drive-tools.ts`
- Modify: `src/server/index.ts`

**Step 1: Create src/server/drive-tools.ts**

Create the file with all Drive tool registrations. Pattern follows gmail-tools.ts:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AccountStore } from '../auth/index.js';
import {
  confirmationRequired,
  errorResponse,
  successResponse,
  toMcpError,
} from '../errors/index.js';
import { DriveClient } from '../drive/index.js';
import type { ScopeTier } from '../types/index.js';

export function registerDriveTools(
  server: McpServer,
  accountStore: AccountStore,
  validateAccountScope: (accountId: string, requiredTier: ScopeTier) =>
    { error: ReturnType<typeof errorResponse> } | { account: any },
): void {

  // drive_search_files
  server.registerTool(
    'drive_search_files',
    {
      description: 'Search for files in Google Drive using Drive search syntax (e.g., "name contains \'report\'", "mimeType=\'application/pdf\'")',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        query: z.string().describe('Drive search query'),
        maxResults: z.number().optional().describe('Maximum results (default: 20)'),
        pageToken: z.string().optional().describe('Pagination token'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.searchFiles(args.query, {
          maxResults: args.maxResults,
          pageToken: args.pageToken,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_list_files
  server.registerTool(
    'drive_list_files',
    {
      description: 'List files in a Google Drive folder (or root if no folderId specified)',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        folderId: z.string().optional().describe('Folder ID (omit for root)'),
        maxResults: z.number().optional().describe('Maximum results (default: 20)'),
        pageToken: z.string().optional().describe('Pagination token'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.listFiles(args.folderId, {
          maxResults: args.maxResults,
          pageToken: args.pageToken,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_get_file
  server.registerTool(
    'drive_get_file',
    {
      description: 'Get metadata for a Google Drive file (name, type, size, sharing status, modified date)',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.getFile(args.fileId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_get_file_content
  server.registerTool(
    'drive_get_file_content',
    {
      description: 'Download/export file content from Google Drive. Google Docs export as plain text, Sheets as CSV. Binary files return base64.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.getFileContent(args.fileId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_upload_file
  server.registerTool(
    'drive_upload_file',
    {
      description: 'Upload a file to Google Drive',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        name: z.string().describe('File name'),
        content: z.string().describe('File content (text or base64 for binary)'),
        mimeType: z.string().describe('MIME type of the file'),
        parentFolderId: z.string().optional().describe('Parent folder ID'),
        isBase64: z.boolean().optional().describe('Set true if content is base64-encoded binary'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.uploadFile({
          name: args.name,
          content: args.content,
          mimeType: args.mimeType,
          parentFolderId: args.parentFolderId,
          isBase64: args.isBase64,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_create_folder
  server.registerTool(
    'drive_create_folder',
    {
      description: 'Create a folder in Google Drive',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        name: z.string().describe('Folder name'),
        parentFolderId: z.string().optional().describe('Parent folder ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.createFolder(args.name, args.parentFolderId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_move_file
  server.registerTool(
    'drive_move_file',
    {
      description: 'Move a file to a different folder in Google Drive',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID to move'),
        newParentId: z.string().describe('The destination folder ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.moveFile(args.fileId, args.newParentId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_copy_file
  server.registerTool(
    'drive_copy_file',
    {
      description: 'Copy a file in Google Drive',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID to copy'),
        name: z.string().optional().describe('Name for the copy'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.copyFile(args.fileId, args.name);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_rename_file
  server.registerTool(
    'drive_rename_file',
    {
      description: 'Rename a file in Google Drive',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
        name: z.string().describe('New name'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.renameFile(args.fileId, args.name);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_trash_file
  server.registerTool(
    'drive_trash_file',
    {
      description: 'Move a file to trash in Google Drive',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.trashFile(args.fileId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_share_file (confirm gate)
  server.registerTool(
    'drive_share_file',
    {
      description: 'Share a file with a user or make it public. Requires confirm: true to execute.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
        type: z.enum(['user', 'group', 'domain', 'anyone']).describe('Permission type'),
        role: z.enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader']).describe('Permission role'),
        emailAddress: z.string().optional().describe('Email address (required for user/group type)'),
        domain: z.string().optional().describe('Domain (required for domain type)'),
        sendNotification: z.boolean().optional().describe('Send email notification (default: true)'),
        confirm: z.boolean().optional().describe('Must be true to execute sharing'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;

      if (!args.confirm) {
        return errorResponse(
          confirmationRequired(
            `share file with ${args.emailAddress ?? args.domain ?? 'anyone'}`,
            'This will grant access to the file. Set confirm: true to proceed.',
          ).toResponse(),
        );
      }

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.shareFile(args.fileId, {
          type: args.type,
          role: args.role,
          emailAddress: args.emailAddress,
          domain: args.domain,
        }, args.sendNotification);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_update_permissions (confirm gate)
  server.registerTool(
    'drive_update_permissions',
    {
      description: 'Update sharing permissions on a file. Requires confirm: true to execute.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
        permissionId: z.string().describe('The permission ID to update'),
        role: z.enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader']).describe('New role'),
        confirm: z.boolean().optional().describe('Must be true to execute'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;

      if (!args.confirm) {
        return errorResponse(
          confirmationRequired(
            'update file permissions',
            'This will change access to the file. Set confirm: true to proceed.',
          ).toResponse(),
        );
      }

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.updatePermissions(args.fileId, args.permissionId, args.role);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );
}
```

**Step 2: Register in server/index.ts**

Add import and call:

```typescript
import { registerDriveTools } from './drive-tools.js';

// After registerGmailTools call:
registerDriveTools(server, accountStore, validateAccountScope);
```

**Step 3: Run tests**

Run: `pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/server/drive-tools.ts src/server/index.ts
git commit -m "feat: add Drive tool registrations (search, list, get, upload, share)"
```

---

## Task 10: Create CalendarClient

**Files:**
- Create: `src/calendar/client.ts`
- Create: `src/calendar/index.ts`

**Step 1: Write failing test**

Create `tests/unit/calendar-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

describe('CalendarClient', () => {
  it('placeholder - calendar client exists', async () => {
    const { CalendarClient } = await import('../../src/calendar/index.js');
    expect(CalendarClient).toBeDefined();
  });
});
```

Run: `pnpm test tests/unit/calendar-client.test.ts`
Expected: FAIL

**Step 2: Create src/calendar/client.ts**

```typescript
import { type calendar_v3, google } from 'googleapis';
import type { AccountStore } from '../auth/index.js';

export interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  status?: string;
  creator?: { email?: string; displayName?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: EventAttendee[];
  recurrence?: string[];
  recurringEventId?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
}

export interface EventDateTime {
  dateTime?: string;  // RFC3339 timestamp
  date?: string;      // YYYY-MM-DD for all-day events
  timeZone?: string;
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
}

export interface EventList {
  events: CalendarEvent[];
  nextPageToken?: string;
}

export interface FreeBusyResult {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

export interface EventInput {
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Array<{ email: string }>;
  recurrence?: string[];
  timeZone?: string;
}

export class CalendarClient {
  private readonly accountStore: AccountStore;
  private readonly accountId: string;
  private calendar: calendar_v3.Calendar | null = null;

  constructor(accountStore: AccountStore, accountId: string) {
    this.accountStore = accountStore;
    this.accountId = accountId;
  }

  private async getCalendar(): Promise<calendar_v3.Calendar> {
    if (!this.calendar) {
      const auth = await this.accountStore.getAuthenticatedClient(this.accountId);
      this.calendar = google.calendar({ version: 'v3', auth });
    }
    return this.calendar;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const calendar = await this.getCalendar();
    const response = await calendar.calendarList.list();
    return (response.data.items ?? []).map(c => this.convertCalendarInfo(c));
  }

  async listEvents(options: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    pageToken?: string;
    singleEvents?: boolean;
    orderBy?: 'startTime' | 'updated';
  } = {}): Promise<EventList> {
    const calendar = await this.getCalendar();
    const calendarId = options.calendarId ?? 'primary';

    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      maxResults: options.maxResults ?? 20,
      singleEvents: options.singleEvents ?? true,
      orderBy: options.orderBy ?? 'startTime',
    };
    if (options.timeMin) params.timeMin = options.timeMin;
    if (options.timeMax) params.timeMax = options.timeMax;
    if (options.pageToken) params.pageToken = options.pageToken;

    const response = await calendar.events.list(params);
    const events = (response.data.items ?? []).map(e => this.convertEvent(e));
    const result: EventList = { events };
    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }
    return result;
  }

  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();
    const response = await calendar.events.get({
      calendarId: calendarId ?? 'primary',
      eventId,
    });
    return this.convertEvent(response.data);
  }

  async searchEvents(query: string, options: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  } = {}): Promise<EventList> {
    const calendar = await this.getCalendar();
    const calendarId = options.calendarId ?? 'primary';

    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      q: query,
      maxResults: options.maxResults ?? 20,
      singleEvents: true,
      orderBy: 'startTime',
    };
    if (options.timeMin) params.timeMin = options.timeMin;
    if (options.timeMax) params.timeMax = options.timeMax;

    const response = await calendar.events.list(params);
    const events = (response.data.items ?? []).map(e => this.convertEvent(e));
    const result: EventList = { events };
    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }
    return result;
  }

  async freeBusy(options: {
    timeMin: string;
    timeMax: string;
    calendarIds?: string[];
  }): Promise<FreeBusyResult> {
    const calendar = await this.getCalendar();

    const items = (options.calendarIds ?? ['primary']).map(id => ({ id }));

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        items,
      },
    });

    const calendars: FreeBusyResult['calendars'] = {};
    const responseCalendars = response.data.calendars ?? {};
    for (const [calId, data] of Object.entries(responseCalendars)) {
      calendars[calId] = {
        busy: (data.busy ?? []).map(b => ({
          start: b.start ?? '',
          end: b.end ?? '',
        })),
      };
    }

    return { calendars };
  }

  async createEvent(input: EventInput, calendarId?: string): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();

    const requestBody: calendar_v3.Schema$Event = {
      summary: input.summary,
      start: this.convertEventDateTimeToSchema(input.start),
      end: this.convertEventDateTimeToSchema(input.end),
    };
    if (input.description) requestBody.description = input.description;
    if (input.location) requestBody.location = input.location;
    if (input.attendees) {
      requestBody.attendees = input.attendees.map(a => ({ email: a.email }));
    }
    if (input.recurrence) requestBody.recurrence = input.recurrence;

    const response = await calendar.events.insert({
      calendarId: calendarId ?? 'primary',
      requestBody,
      sendUpdates: input.attendees?.length ? 'all' : 'none',
    });

    return this.convertEvent(response.data);
  }

  async updateEvent(eventId: string, updates: Partial<EventInput>, calendarId?: string): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();
    const cid = calendarId ?? 'primary';

    // Get existing event first
    const existing = await calendar.events.get({ calendarId: cid, eventId });

    const requestBody: calendar_v3.Schema$Event = { ...existing.data };
    if (updates.summary !== undefined) requestBody.summary = updates.summary;
    if (updates.description !== undefined) requestBody.description = updates.description;
    if (updates.location !== undefined) requestBody.location = updates.location;
    if (updates.start) requestBody.start = this.convertEventDateTimeToSchema(updates.start);
    if (updates.end) requestBody.end = this.convertEventDateTimeToSchema(updates.end);
    if (updates.attendees) {
      requestBody.attendees = updates.attendees.map(a => ({ email: a.email }));
    }
    if (updates.recurrence) requestBody.recurrence = updates.recurrence;

    // Determine if attendees are involved
    const hasAttendees = (updates.attendees?.length ?? 0) > 0 ||
      (existing.data.attendees?.length ?? 0) > 0;

    const response = await calendar.events.update({
      calendarId: cid,
      eventId,
      requestBody,
      sendUpdates: hasAttendees ? 'all' : 'none',
    });

    return this.convertEvent(response.data);
  }

  async deleteEvent(eventId: string, calendarId?: string, sendUpdates?: boolean): Promise<void> {
    const calendar = await this.getCalendar();
    const cid = calendarId ?? 'primary';

    // Get event to check for attendees if sendUpdates not specified
    let shouldNotify = sendUpdates;
    if (shouldNotify === undefined) {
      const existing = await calendar.events.get({ calendarId: cid, eventId });
      shouldNotify = (existing.data.attendees?.length ?? 0) > 0;
    }

    await calendar.events.delete({
      calendarId: cid,
      eventId,
      sendUpdates: shouldNotify ? 'all' : 'none',
    });
  }

  async rsvp(eventId: string, response: 'accepted' | 'declined' | 'tentative', calendarId?: string): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();
    const cid = calendarId ?? 'primary';

    // Get current event
    const existing = await calendar.events.get({ calendarId: cid, eventId });
    const attendees = existing.data.attendees ?? [];

    // Find self in attendees and update response
    const updated = attendees.map(a => {
      if (a.self) {
        return { ...a, responseStatus: response };
      }
      return a;
    });

    const resp = await calendar.events.patch({
      calendarId: cid,
      eventId,
      requestBody: { attendees: updated },
      sendUpdates: 'all',
    });

    return this.convertEvent(resp.data);
  }

  async moveEvent(eventId: string, destinationCalendarId: string, sourceCalendarId?: string): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();

    const response = await calendar.events.move({
      calendarId: sourceCalendarId ?? 'primary',
      eventId,
      destination: destinationCalendarId,
    });

    return this.convertEvent(response.data);
  }

  private convertEventDateTimeToSchema(dt: EventDateTime): calendar_v3.Schema$EventDateTime {
    const result: calendar_v3.Schema$EventDateTime = {};
    if (dt.dateTime) result.dateTime = dt.dateTime;
    if (dt.date) result.date = dt.date;
    if (dt.timeZone) result.timeZone = dt.timeZone;
    return result;
  }

  private convertCalendarInfo(c: calendar_v3.Schema$CalendarListEntry): CalendarInfo {
    const result: CalendarInfo = {
      id: c.id ?? '',
      summary: c.summary ?? '',
    };
    if (c.description) result.description = c.description;
    if (c.timeZone) result.timeZone = c.timeZone;
    if (c.primary) result.primary = c.primary;
    if (c.accessRole) result.accessRole = c.accessRole;
    if (c.backgroundColor) result.backgroundColor = c.backgroundColor;
    return result;
  }

  private convertEvent(e: calendar_v3.Schema$Event): CalendarEvent {
    const result: CalendarEvent = {
      id: e.id ?? '',
    };
    if (e.summary) result.summary = e.summary;
    if (e.description) result.description = e.description;
    if (e.location) result.location = e.location;
    if (e.start) result.start = this.convertEventDateTime(e.start);
    if (e.end) result.end = this.convertEventDateTime(e.end);
    if (e.status) result.status = e.status;
    if (e.creator) {
      result.creator = {};
      if (e.creator.email) result.creator.email = e.creator.email;
      if (e.creator.displayName) result.creator.displayName = e.creator.displayName;
    }
    if (e.organizer) {
      result.organizer = {};
      if (e.organizer.email) result.organizer.email = e.organizer.email;
      if (e.organizer.displayName) result.organizer.displayName = e.organizer.displayName;
    }
    if (e.attendees) {
      result.attendees = e.attendees.map(a => this.convertAttendee(a));
    }
    if (e.recurrence) result.recurrence = e.recurrence;
    if (e.recurringEventId) result.recurringEventId = e.recurringEventId;
    if (e.htmlLink) result.htmlLink = e.htmlLink;
    if (e.created) result.created = e.created;
    if (e.updated) result.updated = e.updated;
    return result;
  }

  private convertEventDateTime(dt: calendar_v3.Schema$EventDateTime): EventDateTime {
    const result: EventDateTime = {};
    if (dt.dateTime) result.dateTime = dt.dateTime;
    if (dt.date) result.date = dt.date;
    if (dt.timeZone) result.timeZone = dt.timeZone;
    return result;
  }

  private convertAttendee(a: calendar_v3.Schema$EventAttendee): EventAttendee {
    const result: EventAttendee = {
      email: a.email ?? '',
    };
    if (a.displayName) result.displayName = a.displayName;
    if (a.responseStatus) result.responseStatus = a.responseStatus as EventAttendee['responseStatus'];
    if (a.organizer) result.organizer = a.organizer;
    if (a.self) result.self = a.self;
    return result;
  }
}
```

**Step 3: Create src/calendar/index.ts**

```typescript
export {
  CalendarClient,
  type CalendarEvent,
  type CalendarInfo,
  type EventAttendee,
  type EventDateTime,
  type EventInput,
  type EventList,
  type FreeBusyResult,
} from './client.js';
```

**Step 4: Run test**

Run: `pnpm test tests/unit/calendar-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/calendar/ tests/unit/calendar-client.test.ts
git commit -m "feat: add CalendarClient with read and write methods"
```

---

## Task 11: Create Calendar tool registrations

**Files:**
- Create: `src/server/calendar-tools.ts`
- Modify: `src/server/index.ts`

**Step 1: Create src/server/calendar-tools.ts**

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AccountStore } from '../auth/index.js';
import {
  confirmationRequired,
  errorResponse,
  successResponse,
  toMcpError,
} from '../errors/index.js';
import { CalendarClient } from '../calendar/index.js';
import type { ScopeTier } from '../types/index.js';

export function registerCalendarTools(
  server: McpServer,
  accountStore: AccountStore,
  validateAccountScope: (accountId: string, requiredTier: ScopeTier) =>
    { error: ReturnType<typeof errorResponse> } | { account: any },
): void {

  // calendar_list_calendars
  server.registerTool(
    'calendar_list_calendars',
    {
      description: 'List all Google Calendars for the account',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const result = await client.listCalendars();
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_list_events
  server.registerTool(
    'calendar_list_events',
    {
      description: 'List events in a time range from Google Calendar',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
        timeMin: z.string().optional().describe('Start time (RFC3339, e.g., 2026-03-11T00:00:00Z)'),
        timeMax: z.string().optional().describe('End time (RFC3339)'),
        maxResults: z.number().optional().describe('Maximum results (default: 20)'),
        pageToken: z.string().optional().describe('Pagination token'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const result = await client.listEvents({
          calendarId: args.calendarId,
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          maxResults: args.maxResults,
          pageToken: args.pageToken,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_get_event
  server.registerTool(
    'calendar_get_event',
    {
      description: 'Get full details of a Google Calendar event (attendees, location, description, recurrence)',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID'),
        calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const result = await client.getEvent(args.eventId, args.calendarId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_search_events
  server.registerTool(
    'calendar_search_events',
    {
      description: 'Search for events by text query in Google Calendar',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        query: z.string().describe('Search query text'),
        calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
        timeMin: z.string().optional().describe('Start time (RFC3339)'),
        timeMax: z.string().optional().describe('End time (RFC3339)'),
        maxResults: z.number().optional().describe('Maximum results (default: 20)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const result = await client.searchEvents(args.query, {
          calendarId: args.calendarId,
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          maxResults: args.maxResults,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_freebusy
  server.registerTool(
    'calendar_freebusy',
    {
      description: 'Check free/busy status for calendars in a time range',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        timeMin: z.string().describe('Start time (RFC3339)'),
        timeMax: z.string().describe('End time (RFC3339)'),
        calendarIds: z.array(z.string()).optional().describe('Calendar IDs to check (default: primary)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
      if ('error' in validation) return validation.error;
      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const result = await client.freeBusy({
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          calendarIds: args.calendarIds,
        });
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_create_event (conditional confirm gate)
  server.registerTool(
    'calendar_create_event',
    {
      description: 'Create a Google Calendar event. Requires confirm: true if attendees are included (sends invitations).',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        summary: z.string().describe('Event title'),
        start: z.string().describe('Start time (RFC3339) or date (YYYY-MM-DD for all-day)'),
        end: z.string().describe('End time (RFC3339) or date (YYYY-MM-DD for all-day)'),
        description: z.string().optional().describe('Event description'),
        location: z.string().optional().describe('Event location'),
        attendees: z.array(z.string()).optional().describe('Attendee email addresses'),
        timeZone: z.string().optional().describe('Time zone (e.g., America/New_York)'),
        calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
        recurrence: z.array(z.string()).optional().describe('RRULE strings (e.g., ["RRULE:FREQ=WEEKLY;COUNT=10"])'),
        confirm: z.boolean().optional().describe('Must be true when attendees are included'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
      if ('error' in validation) return validation.error;

      const hasAttendees = args.attendees && args.attendees.length > 0;
      if (hasAttendees && !args.confirm) {
        return errorResponse(
          confirmationRequired(
            `create event with ${args.attendees!.length} attendee(s)`,
            'This will send calendar invitations. Set confirm: true to proceed.',
          ).toResponse(),
        );
      }

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        // Parse start/end - detect all-day vs timed
        const isAllDay = !args.start.includes('T');
        const start = isAllDay ? { date: args.start } : { dateTime: args.start, timeZone: args.timeZone };
        const end = isAllDay ? { date: args.end } : { dateTime: args.end, timeZone: args.timeZone };

        const result = await client.createEvent({
          summary: args.summary,
          description: args.description,
          location: args.location,
          start,
          end,
          attendees: args.attendees?.map(email => ({ email })),
          recurrence: args.recurrence,
        }, args.calendarId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_update_event (conditional confirm gate)
  server.registerTool(
    'calendar_update_event',
    {
      description: 'Update a Google Calendar event. Requires confirm: true if attendees are present or being added.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID'),
        summary: z.string().optional().describe('New event title'),
        start: z.string().optional().describe('New start time (RFC3339 or YYYY-MM-DD)'),
        end: z.string().optional().describe('New end time (RFC3339 or YYYY-MM-DD)'),
        description: z.string().optional().describe('New description'),
        location: z.string().optional().describe('New location'),
        attendees: z.array(z.string()).optional().describe('Updated attendee emails'),
        timeZone: z.string().optional().describe('Time zone'),
        calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
        confirm: z.boolean().optional().describe('Must be true when attendees are involved'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
      if ('error' in validation) return validation.error;

      // Check if attendees are being added
      const addingAttendees = args.attendees && args.attendees.length > 0;

      // If adding attendees, require confirmation
      if (addingAttendees && !args.confirm) {
        return errorResponse(
          confirmationRequired(
            `update event with attendees`,
            'This may send notifications to attendees. Set confirm: true to proceed.',
          ).toResponse(),
        );
      }

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        // Check if existing event has attendees (also needs confirm)
        if (!addingAttendees && !args.confirm) {
          const existing = await client.getEvent(args.eventId, args.calendarId);
          if (existing.attendees && existing.attendees.length > 0) {
            return errorResponse(
              confirmationRequired(
                `update event with existing attendees`,
                'This event has attendees who will be notified. Set confirm: true to proceed.',
              ).toResponse(),
            );
          }
        }

        const updates: any = {};
        if (args.summary !== undefined) updates.summary = args.summary;
        if (args.description !== undefined) updates.description = args.description;
        if (args.location !== undefined) updates.location = args.location;
        if (args.start) {
          const isAllDay = !args.start.includes('T');
          updates.start = isAllDay ? { date: args.start } : { dateTime: args.start, timeZone: args.timeZone };
        }
        if (args.end) {
          const isAllDay = !args.end.includes('T');
          updates.end = isAllDay ? { date: args.end } : { dateTime: args.end, timeZone: args.timeZone };
        }
        if (args.attendees) {
          updates.attendees = args.attendees.map((email: string) => ({ email }));
        }

        const result = await client.updateEvent(args.eventId, updates, args.calendarId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_delete_event (conditional confirm gate)
  server.registerTool(
    'calendar_delete_event',
    {
      description: 'Delete a Google Calendar event. Requires confirm: true if the event has attendees.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID'),
        calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
        confirm: z.boolean().optional().describe('Must be true when event has attendees'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        // Check if event has attendees
        if (!args.confirm) {
          const existing = await client.getEvent(args.eventId, args.calendarId);
          if (existing.attendees && existing.attendees.length > 0) {
            return errorResponse(
              confirmationRequired(
                `delete event with ${existing.attendees.length} attendee(s)`,
                'This will notify attendees of the cancellation. Set confirm: true to proceed.',
              ).toResponse(),
            );
          }
        }

        await client.deleteEvent(args.eventId, args.calendarId);
        return successResponse({ success: true, message: 'Event deleted' });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_rsvp
  server.registerTool(
    'calendar_rsvp',
    {
      description: 'Respond to a Google Calendar event invitation (accept, decline, or tentative)',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID'),
        response: z.enum(['accepted', 'declined', 'tentative']).describe('Your response'),
        calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const result = await client.rsvp(args.eventId, args.response, args.calendarId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_move_event
  server.registerTool(
    'calendar_move_event',
    {
      description: 'Move a Google Calendar event to a different calendar',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID'),
        destinationCalendarId: z.string().describe('Destination calendar ID'),
        sourceCalendarId: z.string().optional().describe('Source calendar ID (default: primary)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
      if ('error' in validation) return validation.error;
      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const result = await client.moveEvent(args.eventId, args.destinationCalendarId, args.sourceCalendarId);
        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );
}
```

**Step 2: Register in server/index.ts**

```typescript
import { registerCalendarTools } from './calendar-tools.js';

// After registerDriveTools call:
registerCalendarTools(server, accountStore, validateAccountScope);
```

**Step 3: Run tests**

Run: `pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/server/calendar-tools.ts src/server/index.ts
git commit -m "feat: add Calendar tool registrations (list, search, create, update, RSVP)"
```

---

## Task 12: Update CLAUDE.md and TASKS.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/TASKS.md`

**Step 1: Update CLAUDE.md**

Add Drive and Calendar tools to the MCP Tools section. Update scope tiers to show new names. Add Phase 10-14 to implementation phases.

**Step 2: Update TASKS.md**

Add Phase 10-14 entries with completion status.

**Step 3: Commit**

```bash
git add CLAUDE.md docs/TASKS.md
git commit -m "docs: update CLAUDE.md and TASKS.md for Drive and Calendar support"
```

---

## Task 13: Final verification

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

**Step 2: Run TypeScript build**

Run: `pnpm build`
Expected: No type errors

**Step 3: Verify MCP server starts**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/cli.js 2>/dev/null | head -20`
Expected: Tool list includes drive_* and calendar_* tools

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any remaining issues from Drive/Calendar integration"
```
