import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from '../config/index.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-google',
    version: '0.1.0',
  });

  server.registerTool(
    'google_list_accounts',
    {
      description: 'List all connected Google accounts',
    },
    async () => {
      const config = loadConfig();
      const accounts = config.accounts.map((account) => ({
        id: account.id,
        email: account.email,
        labels: account.labels,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(accounts, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
