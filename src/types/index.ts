import { z } from 'zod';

export const AccountSchema = z.object({
  id: z.string(),
  email: z.email(),
  labels: z.array(z.string()).default([]),
  scopes: z.array(z.string()),
  addedAt: z.iso.datetime(),
});

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
