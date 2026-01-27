#!/usr/bin/env npx tsx

/**
 * Quick test script for Gmail operations.
 *
 * Prerequisites:
 * - Have at least one account added via test-oauth.ts
 *
 * Usage:
 *   npx tsx scripts/test-gmail.ts search [accountId] <query>
 *   npx tsx scripts/test-gmail.ts get [accountId] <messageId>
 *   npx tsx scripts/test-gmail.ts thread [accountId] <threadId>
 *
 * If only one account exists, accountId is optional and will be auto-selected.
 * For multiple accounts, specify account ID or 1-based index.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import {
  AccountStore,
  createTokenStorage,
  GmailClient,
  getHeader,
  getTextBody,
} from '../src/index.js';
import type { Account } from '../src/types/index.js';
import { selectAccount } from './utils.js';

const TOKENS_DIR = path.join(os.homedir(), '.config', 'mcp-google', 'tokens');

async function main() {
  const command = process.argv[2];

  if (!command) {
    console.log('Usage:');
    console.log('  npx tsx scripts/test-gmail.ts search [accountId] <query>');
    console.log('  npx tsx scripts/test-gmail.ts get [accountId] <messageId>');
    console.log('  npx tsx scripts/test-gmail.ts thread [accountId] <threadId>');
    console.log('\nIf only one account exists, accountId is optional.');
    console.log('Run "npx tsx scripts/test-oauth.ts list" to see account IDs');
    return;
  }

  const passphrase = process.env.MCP_GOOGLE_PASSPHRASE;
  const tokenStorage = await createTokenStorage(TOKENS_DIR, passphrase);
  const accountStore = new AccountStore(tokenStorage);

  // Parse arguments: command [accountId] <arg>
  // If we have only one account, arg2 is the command arg
  // If we have multiple accounts or arg2 looks like an account ID, treat it as such
  const arg2 = process.argv[3];
  const arg3 = process.argv[4];

  let account: Account;
  let commandArg: string | undefined;

  // Try to determine if arg2 is an account identifier or command argument
  const accounts = accountStore.listAccounts();

  if (accounts.length === 0) {
    throw new Error('No accounts configured. Run: pnpm tsx scripts/test-oauth.ts add');
  }

  // Check if arg2 matches an account ID or is a valid index
  const arg2IsAccountId =
    arg2 &&
    (accountStore.getAccount(arg2) !== null ||
      (parseInt(arg2, 10) >= 1 && parseInt(arg2, 10) <= accounts.length));

  if (arg2IsAccountId) {
    // arg2 is account identifier, arg3 is command argument
    account = selectAccount(accountStore, arg2);
    commandArg = arg3;
  } else if (accounts.length === 1) {
    // Single account, auto-select; arg2 is command argument
    account = selectAccount(accountStore);
    commandArg = arg2;
  } else {
    // Multiple accounts and arg2 doesn't match - show account list
    account = selectAccount(accountStore, arg2); // Will throw with helpful message
  }

  console.log(`Using account: ${account.email}\n`);

  const client = new GmailClient(accountStore, account.id);

  switch (command) {
    case 'search': {
      const query = commandArg ?? 'is:inbox';
      console.log(`Searching for: "${query}"\n`);

      const result = await client.searchMessages(query, { maxResults: 10 });
      console.log(
        `Found ${result.messages.length} messages (${result.resultSizeEstimate ?? '?'} total)`,
      );

      if (result.messages.length > 0) {
        console.log('\nFetching details for first few messages...\n');

        for (const msg of result.messages.slice(0, 5)) {
          const full = await client.getMessage(msg.id, 'metadata');
          const from = getHeader(full, 'From') ?? 'Unknown';
          const subject = getHeader(full, 'Subject') ?? '(no subject)';
          const date = getHeader(full, 'Date') ?? '';
          console.log(`  ${msg.id}`);
          console.log(`    From: ${from}`);
          console.log(`    Subject: ${subject}`);
          console.log(`    Date: ${date}`);
          console.log();
        }
      }

      if (result.nextPageToken) {
        console.log(`More results available (pageToken: ${result.nextPageToken})`);
      }
      break;
    }

    case 'get': {
      const messageId = commandArg;
      if (!messageId) {
        console.error('Usage: npx tsx scripts/test-gmail.ts get [accountId] <messageId>');
        process.exit(1);
      }

      console.log(`Fetching message: ${messageId}\n`);
      const message = await client.getMessage(messageId, 'full');

      console.log('From:', getHeader(message, 'From'));
      console.log('To:', getHeader(message, 'To'));
      console.log('Subject:', getHeader(message, 'Subject'));
      console.log('Date:', getHeader(message, 'Date'));
      console.log('Labels:', message.labelIds?.join(', ') ?? '(none)');
      console.log('\n--- Body ---\n');
      console.log(getTextBody(message) ?? '(no text body)');
      break;
    }

    case 'thread': {
      const threadId = commandArg;
      if (!threadId) {
        console.error('Usage: npx tsx scripts/test-gmail.ts thread [accountId] <threadId>');
        process.exit(1);
      }

      console.log(`Fetching thread: ${threadId}\n`);
      const thread = await client.getThread(threadId, 'full');

      console.log(`Thread has ${thread.messages?.length ?? 0} messages\n`);

      for (const msg of thread.messages ?? []) {
        console.log(`--- Message ${msg.id} ---`);
        console.log('From:', getHeader(msg, 'From'));
        console.log('Date:', getHeader(msg, 'Date'));
        console.log('Subject:', getHeader(msg, 'Subject'));
        console.log(`\n${getTextBody(msg)?.slice(0, 200) ?? '(no text body)'}...\n`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
