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
// Tier hierarchy: readonly < compose < full (linear)
//                 readonly < settings (parallel branch)
// Settings and full are parallel - neither satisfies the other
// 'all' combines everything: full + settings + compose
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
  settings: [
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

  // 'all' tier has both full (modify/labels) AND settings
  if ((hasModify || hasLabels) && hasSettings) {
    return 'all';
  }

  // full tier has modify + labels
  if (hasModify || hasLabels) {
    return 'full';
  }

  // settings tier has gmail.settings.basic
  if (hasSettings) {
    return 'settings';
  }

  // compose tier has compose (and usually readonly too)
  if (hasCompose) {
    return 'compose';
  }

  // default to readonly
  return 'readonly';
}

// Check if account scopes satisfy the required tier
// Tier hierarchy:
//   readonly < compose < full (linear chain)
//   readonly < settings (parallel branch)
// Settings and full/compose are parallel - neither satisfies the other
// 'all' tier satisfies any requirement, but only 'all' satisfies 'all'
export function hasSufficientScope(accountScopes: string[], requiredTier: ScopeTier): boolean {
  const accountTier = getScopeTier(accountScopes);

  // 'all' tier satisfies any requirement
  if (accountTier === 'all') {
    return true;
  }

  // Only 'all' tier can satisfy 'all' requirement
  if (requiredTier === 'all') {
    return false;
  }

  // Same tier always satisfies
  if (accountTier === requiredTier) {
    return true;
  }

  // readonly is satisfied by all other tiers
  if (requiredTier === 'readonly') {
    return true;
  }

  // settings tier is a parallel branch - only settings or all satisfies settings
  if (requiredTier === 'settings') {
    return accountTier === 'settings';
  }

  // For compose and full requirements, use the linear hierarchy
  // full > compose > readonly
  // settings does NOT satisfy compose or full
  if (accountTier === 'settings') {
    return false;
  }

  const linearTiers: ScopeTier[] = ['readonly', 'compose', 'full'];
  const accountTierIndex = linearTiers.indexOf(accountTier);
  const requiredTierIndex = linearTiers.indexOf(requiredTier);

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

  // Settings operations - settings tier (parallel branch)
  listFilters: 'settings',
  createFilter: 'settings',
  deleteFilter: 'settings',
  getVacation: 'settings',
  setVacation: 'settings',
} as const satisfies Record<string, ScopeTier>;
