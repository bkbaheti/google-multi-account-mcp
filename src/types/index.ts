import { z } from 'zod';

export const AccountSchema = z.object({
  id: z.string(),
  email: z.email(),
  labels: z.array(z.string()).default([]),
  scopes: z.array(z.string()),
  addedAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().optional(),
});

// Scope tiers for incremental authorization
// Mail tier hierarchy: mail_readonly < mail_compose < mail_full (linear)
//                      mail_readonly < mail_settings (parallel branch)
// mail_settings and mail_full are parallel - neither satisfies the other
// 'all' combines everything: mail + drive + calendar
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
} as const;

export type ScopeTier = keyof typeof SCOPE_TIERS;

/**
 * Merge scopes from multiple tiers into a single deduplicated array.
 * This allows combining independent branches like 'full' + 'settings'.
 */
export function mergeScopeTiers(tiers: ScopeTier[]): string[] {
  const scopeSet = new Set<string>();
  for (const tier of tiers) {
    for (const scope of SCOPE_TIERS[tier]) {
      scopeSet.add(scope);
    }
  }
  return Array.from(scopeSet);
}

export type Account = z.infer<typeof AccountSchema>;

export const ConfigSchema = z.object({
  version: z.literal(1),
  accounts: z.array(AccountSchema).default([]),
  oauth: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  version: 1,
  accounts: [],
};

// Scope validation utilities

// Determine the effective scope tier from an account's scopes
export function getScopeTier(scopes: string[]): ScopeTier {
  const hasModify = scopes.includes('https://www.googleapis.com/auth/gmail.modify');
  const hasLabels = scopes.includes('https://www.googleapis.com/auth/gmail.labels');
  const hasCompose = scopes.includes('https://www.googleapis.com/auth/gmail.compose');
  const hasSettings = scopes.includes('https://www.googleapis.com/auth/gmail.settings.basic');
  const hasDriveReadonly = scopes.includes('https://www.googleapis.com/auth/drive.readonly');
  const hasDriveFile = scopes.includes('https://www.googleapis.com/auth/drive.file');
  const hasCalendarReadonly = scopes.includes('https://www.googleapis.com/auth/calendar.readonly');
  const hasCalendarEvents = scopes.includes('https://www.googleapis.com/auth/calendar.events');

  // 'all' tier has mail full + settings + drive + calendar
  if ((hasModify || hasLabels) && hasSettings && (hasDriveReadonly || hasDriveFile) && (hasCalendarReadonly || hasCalendarEvents)) {
    return 'all';
  }

  // Drive tiers
  if (hasDriveFile) {
    return 'drive_full';
  }
  if (hasDriveReadonly) {
    return 'drive_readonly';
  }

  // Calendar tiers
  if (hasCalendarEvents) {
    return 'calendar_full';
  }
  if (hasCalendarReadonly) {
    return 'calendar_readonly';
  }

  // Mail tiers: 'all' mail tier has both full (modify/labels) AND settings
  if ((hasModify || hasLabels) && hasSettings) {
    return 'all';
  }

  // mail_full tier has modify + labels
  if (hasModify || hasLabels) {
    return 'mail_full';
  }

  // mail_settings tier has gmail.settings.basic
  if (hasSettings) {
    return 'mail_settings';
  }

  // mail_compose tier has compose (and usually readonly too)
  if (hasCompose) {
    return 'mail_compose';
  }

  // default to mail_readonly
  return 'mail_readonly';
}

// Check if account scopes satisfy the required tier
// Simple scope-URL based check: account must have all scope URLs in the required tier
export function hasSufficientScope(accountScopes: string[], requiredTier: ScopeTier): boolean {
  const requiredScopes = SCOPE_TIERS[requiredTier];
  return requiredScopes.every(scope => accountScopes.includes(scope));
}

// Get the scope tier required for each operation category
export const OPERATION_SCOPE_REQUIREMENTS = {
  // Mail read operations - mail_readonly tier
  search: 'mail_readonly',
  getMessage: 'mail_readonly',
  getThread: 'mail_readonly',

  // Mail compose operations - mail_compose tier
  createDraft: 'mail_compose',
  updateDraft: 'mail_compose',
  getDraft: 'mail_compose',
  sendDraft: 'mail_compose',
  deleteDraft: 'mail_compose',
  replyToThread: 'mail_compose',

  // Mail modify operations - mail_full tier
  listLabels: 'mail_full',
  modifyLabels: 'mail_full',
  markReadUnread: 'mail_full',
  archive: 'mail_full',
  trash: 'mail_full',
  untrash: 'mail_full',

  // Mail settings operations - mail_settings tier (parallel branch)
  listFilters: 'mail_settings',
  createFilter: 'mail_settings',
  deleteFilter: 'mail_settings',
  getVacation: 'mail_settings',
  setVacation: 'mail_settings',

  // Drive read operations - drive_readonly tier
  driveSearch: 'drive_readonly',
  driveListFiles: 'drive_readonly',
  driveGetFile: 'drive_readonly',
  driveGetContent: 'drive_readonly',

  // Drive write operations - drive_full tier
  driveUpload: 'drive_full',
  driveCreateFolder: 'drive_full',
  driveMoveFile: 'drive_full',
  driveCopyFile: 'drive_full',
  driveRenameFile: 'drive_full',
  driveTrashFile: 'drive_full',
  driveShareFile: 'drive_full',
  driveUpdatePermissions: 'drive_full',

  // Calendar read operations - calendar_readonly tier
  calendarListCalendars: 'calendar_readonly',
  calendarListEvents: 'calendar_readonly',
  calendarGetEvent: 'calendar_readonly',
  calendarSearchEvents: 'calendar_readonly',
  calendarFreeBusy: 'calendar_readonly',

  // Calendar write operations - calendar_full tier
  calendarCreateEvent: 'calendar_full',
  calendarUpdateEvent: 'calendar_full',
  calendarDeleteEvent: 'calendar_full',
  calendarRsvp: 'calendar_full',
  calendarMoveEvent: 'calendar_full',
} as const satisfies Record<string, ScopeTier>;
