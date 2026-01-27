#!/usr/bin/env npx tsx
/**
 * Quick test script for OAuth flow.
 *
 * Prerequisites:
 * 1. Create OAuth credentials at https://console.cloud.google.com/apis/credentials
 * 2. Enable Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com
 * 3. Add http://localhost:8089/callback as authorized redirect URI
 * 4. Update ~/.config/mcp-google/config.json with your clientId and clientSecret
 *
 * Usage:
 *   npx tsx scripts/test-oauth.ts add [readonly|compose|full]
 *   npx tsx scripts/test-oauth.ts list
 *   npx tsx scripts/test-oauth.ts remove <accountId>
 */

import { AccountStore, createTokenStorage } from '../src/index.js';
import { loadConfig } from '../src/config/index.js';
import * as path from 'node:path';
import * as os from 'node:os';

const TOKENS_DIR = path.join(os.homedir(), '.config', 'mcp-google', 'tokens');

async function main() {
  const command = process.argv[2];

  // Check config first
  const config = loadConfig();
  if (command === 'add' && (!config.oauth?.clientId || !config.oauth?.clientSecret)) {
    console.error('Error: OAuth credentials not configured.');
    console.error('Edit ~/.config/mcp-google/config.json and add:');
    console.error(JSON.stringify({
      version: 1,
      accounts: [],
      oauth: {
        clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
        clientSecret: 'YOUR_CLIENT_SECRET'
      }
    }, null, 2));
    process.exit(1);
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
          console.log(`    Labels: ${account.labels.length > 0 ? account.labels.join(', ') : '(none)'}`);
          console.log(`    Scopes: ${account.scopes.join(', ')}`);
          console.log(`    Added: ${account.addedAt}`);
        }
      }
      break;
    }

    case 'add': {
      const scopeTier = (process.argv[3] as 'readonly' | 'compose' | 'full') || 'readonly';
      if (!['readonly', 'compose', 'full'].includes(scopeTier)) {
        console.error('Invalid scope tier. Use: readonly, compose, or full');
        process.exit(1);
      }

      console.log(`Adding account with scope tier: ${scopeTier}`);
      console.log('A browser window will open for authorization...\n');

      try {
        const account = await accountStore.addAccount(scopeTier);
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
      console.log('  npx tsx scripts/test-oauth.ts add [readonly|compose|full]');
      console.log('  npx tsx scripts/test-oauth.ts remove <accountId>');
  }
}

main().catch(console.error);
