import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../src/types/index.js';

const mockAccounts: Account[] = [
  {
    id: 'uuid-1',
    email: 'alice@work.com',
    alias: 'work',
    description: 'Work - engineering team',
    labels: ['work'],
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    addedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'uuid-2',
    email: 'alice@personal.com',
    labels: ['personal'],
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    addedAt: '2025-01-02T00:00:00.000Z',
  },
];

let savedConfig: any = null;

describe('AccountStore description features', () => {
  beforeEach(() => {
    savedConfig = null;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function getAccountStore() {
    vi.doMock('../../src/config/index.js', () => ({
      loadConfig: () => ({
        version: 1,
        accounts: JSON.parse(JSON.stringify(mockAccounts)),
      }),
      saveConfig: vi.fn((config: any) => {
        savedConfig = config;
      }),
      resolveOAuthConfig: () => ({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      }),
    }));

    const { AccountStore } = await import('../../src/auth/account-store.js');
    const mockStorage = {
      save: vi.fn(),
      load: vi.fn(),
      delete: vi.fn(),
    };
    return new AccountStore(mockStorage);
  }

  it('should set a description on an account', async () => {
    const store = await getAccountStore();
    const result = store.setAccountDescription('uuid-2', 'Personal Gmail');
    expect(result).toBe(true);
    expect(savedConfig.accounts[1].description).toBe('Personal Gmail');
  }, 15000);

  it('should remove description when set to null', async () => {
    const store = await getAccountStore();
    const result = store.setAccountDescription('uuid-1', null);
    expect(result).toBe(true);
    expect(savedConfig.accounts[0].description).toBeUndefined();
  });

  it('should return false for unknown account', async () => {
    const store = await getAccountStore();
    const result = store.setAccountDescription('nonexistent', 'test');
    expect(result).toBe(false);
  });

  it('should include description in account listing', async () => {
    const store = await getAccountStore();
    const accounts = store.listAccounts();
    expect(accounts[0].description).toBe('Work - engineering team');
    expect(accounts[1].description).toBeUndefined();
  });
});
