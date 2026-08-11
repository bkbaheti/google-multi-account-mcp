#!/usr/bin/env npx tsx

/**
 * Quick test script for OAuth flow.
 *
 * Built-in OAuth credentials are used by default. To override, set
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables,
 * or add oauth.clientId / oauth.clientSecret to ~/.config/mcp-google/config.json.
 *
 * Usage:
 *   npx tsx scripts/test-oauth.ts add [capability,capability,...]
 *   npx tsx scripts/test-oauth.ts list
 *   npx tsx scripts/test-oauth.ts remove <accountId>
 *
 * Capabilities: mail:read, mail:compose, mail:modify, mail:settings,
 * drive:read, drive:appfiles, calendar:read, calendar:write.
 * Defaults to mail:read when omitted.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { CAPABILITIES, type Capability, isCapability } from '../src/auth/capabilities.js';
import { resolveOAuthConfig } from '../src/config/index.js';
import { AccountStore, createTokenStorage } from '../src/index.js';

const TOKENS_DIR = path.join(os.homedir(), '.config', 'mcp-google', 'tokens');

async function main() {
  const command = process.argv[2];

  // Resolve OAuth credentials (env vars > config file > built-in defaults)
  if (command === 'add') {
    const oauthConfig = resolveOAuthConfig();
    console.log(`Using OAuth client ID: ${oauthConfig.clientId.slice(0, 20)}...`);
  }

  // Initialize token storage
  const passphrase = process.env.MCP_GOOGLE_PASSPHRASE;
  let tokenStorage: Awaited<ReturnType<typeof createTokenStorage>>;
  try {
    tokenStorage = await createTokenStorage(TOKENS_DIR, passphrase);
    console.log(`Using token storage: ${tokenStorage.type}`);
  } catch (error) {
    console.error('Error:', (error as Error).message);
    console.error('\nIf keychain is not available, set MCP_GOOGLE_PASSPHRASE:');
    console.error('  export MCP_GOOGLE_PASSPHRASE="your-secure-passphrase"');
    process.exit(1);
  }

  const accountStore = new AccountStore(tokenStorage);

  switch (command) {
    case 'list': {
      const accounts = accountStore.listAccounts();
      if (accounts.length === 0) {
        console.log('No accounts configured.');
      } else {
        console.log('Configured accounts:');
        for (const account of accounts) {
          console.log(`  - ${account.email} (${account.id})`);
          console.log(
            `    Labels: ${account.labels.length > 0 ? account.labels.join(', ') : '(none)'}`,
          );
          console.log(`    Scopes: ${account.scopes.join(', ')}`);
          console.log(`    Added: ${account.addedAt}`);
        }
      }
      break;
    }

    case 'add': {
      const arg = process.argv[3];
      const requested = arg ? arg.split(',').map((c) => c.trim()) : ['mail:read'];

      const unknown = requested.filter((c) => !isCapability(c));
      if (unknown.length > 0) {
        console.error(
          `Unknown capabilit${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`,
        );
        console.error(`Valid capabilities: ${CAPABILITIES.join(', ')}`);
        process.exit(1);
      }
      const capabilities = requested as Capability[];

      console.log(`Adding account with capabilities: ${capabilities.join(', ')}`);
      console.log('A browser window will open for authorization...\n');

      try {
        const account = await accountStore.addAccount(capabilities);
        console.log('\nSuccess!');
        console.log(`  Email: ${account.email}`);
        console.log(`  Account ID: ${account.id}`);
        console.log(`  Scopes: ${account.scopes.join(', ')}`);
      } catch (error) {
        console.error('\nError:', (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case 'remove': {
      const accountId = process.argv[3];
      if (!accountId) {
        console.error('Usage: npx tsx scripts/test-oauth.ts remove <accountId>');
        process.exit(1);
      }

      const removed = await accountStore.removeAccount(accountId);
      if (removed) {
        console.log('Account removed successfully.');
      } else {
        console.error('Account not found.');
        process.exit(1);
      }
      break;
    }

    default:
      console.log('Usage:');
      console.log('  npx tsx scripts/test-oauth.ts list');
      console.log('  npx tsx scripts/test-oauth.ts add [capability,capability,...]');
      console.log(`    Capabilities: ${CAPABILITIES.join(', ')}`);
      console.log('    Defaults to mail:read when omitted.');
      console.log('  npx tsx scripts/test-oauth.ts remove <accountId>');
  }
}

main().catch(console.error);
