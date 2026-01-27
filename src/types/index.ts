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
export const SCOPE_TIERS = {
  readonly: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  compose: [
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  full: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
} as const;

export type ScopeTier = keyof typeof SCOPE_TIERS;

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

  // full tier has modify + labels
  if (hasModify || hasLabels) {
    return 'full';
  }

  // compose tier has compose (and usually readonly too)
  if (hasCompose) {
    return 'compose';
  }

  // default to readonly
  return 'readonly';
}

// Check if account scopes satisfy the required tier
export function hasSufficientScope(accountScopes: string[], requiredTier: ScopeTier): boolean {
  const accountTier = getScopeTier(accountScopes);

  // Tier hierarchy: full > compose > readonly
  const tierOrder: ScopeTier[] = ['readonly', 'compose', 'full'];
  const accountTierIndex = tierOrder.indexOf(accountTier);
  const requiredTierIndex = tierOrder.indexOf(requiredTier);

  return accountTierIndex >= requiredTierIndex;
}

// Get the scope tier required for each operation category
export const OPERATION_SCOPE_REQUIREMENTS = {
  // Read operations - readonly tier
  search: 'readonly',
  getMessage: 'readonly',
  getThread: 'readonly',

  // Compose operations - compose tier
  createDraft: 'compose',
  updateDraft: 'compose',
  getDraft: 'compose',
  sendDraft: 'compose',
  deleteDraft: 'compose',
  replyToThread: 'compose',

  // Modify operations - full tier
  listLabels: 'full',
  modifyLabels: 'full',
  markReadUnread: 'full',
  archive: 'full',
  trash: 'full',
  untrash: 'full',
} as const satisfies Record<string, ScopeTier>;
