import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../auth/index.js';
import { AccountStore } from '../auth/index.js';
import { SCOPE_TIERS, type ScopeTier } from '../types/index.js';

export interface ServerOptions {
  tokenStorage: TokenStorage;
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({
    name: 'mcp-google',
    version: '0.1.0',
  });

  const accountStore = new AccountStore(options.tokenStorage);

  // google_list_accounts - List all connected Google accounts
  server.registerTool(
    'google_list_accounts',
    {
      description: 'List all connected Google accounts',
    },
    async () => {
      const accounts = accountStore.listAccounts();
      const result = accounts.map((account) => ({
        id: account.id,
        email: account.email,
        labels: account.labels,
        scopes: account.scopes,
        addedAt: account.addedAt,
        lastUsedAt: account.lastUsedAt,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // google_add_account - Add a new Google account via OAuth
  server.registerTool(
    'google_add_account',
    {
      description:
        'Add a new Google account via OAuth. Opens browser for authorization. Scope tier: readonly (default), compose (send emails), or full (modify labels/archive).',
      inputSchema: {
        scopeTier: z
          .enum(['readonly', 'compose', 'full'])
          .optional()
          .describe('Permission level: readonly, compose, or full'),
      },
    },
    async (args) => {
      const scopeTier = (args.scopeTier ?? 'readonly') as ScopeTier;

      try {
        const account = await accountStore.addAccount(scopeTier);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Successfully added account ${account.email}`,
                  account: {
                    id: account.id,
                    email: account.email,
                    scopes: account.scopes,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // google_remove_account - Remove a Google account
  server.registerTool(
    'google_remove_account',
    {
      description: 'Remove a Google account and revoke its tokens',
      inputSchema: {
        accountId: z.string().describe('The account ID to remove'),
      },
    },
    async (args) => {
      const removed = await accountStore.removeAccount(args.accountId);

      if (removed) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Account removed' }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: 'Account not found' }, null, 2),
          },
        ],
        isError: true,
      };
    },
  );

  // google_set_account_labels - Set labels on an account
  server.registerTool(
    'google_set_account_labels',
    {
      description: 'Set labels on a Google account (e.g., personal, work, school)',
      inputSchema: {
        accountId: z.string().describe('The account ID to update'),
        labels: z.array(z.string()).describe('Labels to set on the account'),
      },
    },
    async (args) => {
      const updated = accountStore.setAccountLabels(args.accountId, args.labels);

      if (updated) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { success: true, message: 'Labels updated', labels: args.labels },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: 'Account not found' }, null, 2),
          },
        ],
        isError: true,
      };
    },
  );

  return server;
}

export { SCOPE_TIERS };
