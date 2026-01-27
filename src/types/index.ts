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
