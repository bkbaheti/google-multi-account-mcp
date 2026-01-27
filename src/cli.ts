#!/usr/bin/env node
import * as os from 'node:os';
import * as path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTokenStorage } from './auth/index.js';
import { createServer } from './server/index.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'mcp-google');
const TOKENS_DIR = path.join(CONFIG_DIR, 'tokens');

async function main(): Promise<void> {
  // Get passphrase from env if keychain not available
  // biome-ignore lint/complexity/useLiteralKeys: env vars require bracket notation
  const passphrase = process.env['MCP_GOOGLE_PASSPHRASE'];

  const tokenStorage = await createTokenStorage(TOKENS_DIR, passphrase);

  const server = createServer({ tokenStorage });
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
