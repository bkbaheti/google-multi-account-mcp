import type { AccountStore } from '../src/auth/account-store.js';
import type { Account } from '../src/types/index.js';

/**
 * Select an account for test scripts.
 *
 * - If only one account exists, auto-selects it
 * - If multiple accounts exist, requires explicit selection via argument
 * - If no accounts exist, throws an error with instructions
 *
 * @param accountStore - The account store instance
 * @param accountIdOrIndex - Optional account ID or 1-based index
 * @returns The selected account
 */
export function selectAccount(accountStore: AccountStore, accountIdOrIndex?: string): Account {
  const accounts = accountStore.listAccounts();

  if (accounts.length === 0) {
    throw new Error('No accounts configured. Run: pnpm tsx scripts/test-oauth.ts add');
  }

  // If explicit account specified, use it
  if (accountIdOrIndex) {
    // Check if it's a 1-based index
    const index = parseInt(accountIdOrIndex, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= accounts.length) {
      return accounts[index - 1];
    }

    // Otherwise treat as account ID
    const account = accountStore.getAccount(accountIdOrIndex);
    if (!account) {
      throw new Error(
        `Account not found: ${accountIdOrIndex}\n` +
          'Run "pnpm tsx scripts/test-oauth.ts list" to see available accounts',
      );
    }
    return account;
  }

  // Auto-select if only one account
  if (accounts.length === 1) {
    return accounts[0];
  }

  // Multiple accounts - require explicit selection
  console.log('Multiple accounts configured. Please specify which to use:\n');
  accounts.forEach((acc, i) => {
    console.log(`  ${i + 1}) ${acc.email} (${acc.id})`);
  });
  console.log('\nUsage: provide account ID or index (1-based) as argument');

  throw new Error('Multiple accounts exist. Specify account ID or index.');
}
