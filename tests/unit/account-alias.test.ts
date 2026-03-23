import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../src/types/index.js';

const mockAccounts: Account[] = [
  {
    id: 'uuid-1',
    email: 'alice@work.com',
    alias: 'work',
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

describe('AccountStore alias features', () => {
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

  describe('resolveAccount', () => {
    it('should resolve by exact ID', async () => {
      const store = await getAccountStore();
      const account = store.resolveAccount('uuid-1');
      expect(account).not.toBeNull();
      expect(account!.id).toBe('uuid-1');
    }, 15000);

    it('should resolve by alias', async () => {
      const store = await getAccountStore();
      const account = store.resolveAccount('work');
      expect(account).not.toBeNull();
      expect(account!.id).toBe('uuid-1');
      expect(account!.email).toBe('alice@work.com');
    });

    it('should resolve alias case-insensitively', async () => {
      const store = await getAccountStore();
      const account = store.resolveAccount('Work');
      expect(account).not.toBeNull();
      expect(account!.id).toBe('uuid-1');
    });

    it('should resolve by email', async () => {
      const store = await getAccountStore();
      const account = store.resolveAccount('alice@personal.com');
      expect(account).not.toBeNull();
      expect(account!.id).toBe('uuid-2');
    });

    it('should return null for unknown identifier', async () => {
      const store = await getAccountStore();
      const account = store.resolveAccount('nonexistent');
      expect(account).toBeNull();
    });

    it('should prioritize ID over alias', async () => {
      // If an alias matches another account's ID, ID wins
      const store = await getAccountStore();
      const account = store.resolveAccount('uuid-2');
      expect(account).not.toBeNull();
      expect(account!.id).toBe('uuid-2');
    });
  });

  describe('setAccountAlias', () => {
    it('should set an alias on an account', async () => {
      const store = await getAccountStore();
      const result = store.setAccountAlias('uuid-2', 'personal');
      expect(result.success).toBe(true);
      expect(savedConfig.accounts[1].alias).toBe('personal');
    });

    it('should remove alias when set to null', async () => {
      const store = await getAccountStore();
      const result = store.setAccountAlias('uuid-1', null);
      expect(result.success).toBe(true);
      expect(savedConfig.accounts[0].alias).toBeUndefined();
    });

    it('should reject duplicate alias', async () => {
      const store = await getAccountStore();
      const result = store.setAccountAlias('uuid-2', 'work');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Alias already in use');
      expect(result.existingAccountId).toBe('uuid-1');
    });

    it('should reject duplicate alias case-insensitively', async () => {
      const store = await getAccountStore();
      const result = store.setAccountAlias('uuid-2', 'WORK');
      expect(result.success).toBe(false);
      expect(result.existingAccountId).toBe('uuid-1');
    });

    it('should allow reassigning same alias to same account', async () => {
      const store = await getAccountStore();
      const result = store.setAccountAlias('uuid-1', 'work');
      expect(result.success).toBe(true);
    });

    it('should return error for unknown account', async () => {
      const store = await getAccountStore();
      const result = store.setAccountAlias('nonexistent', 'test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Account not found');
    });
  });
});
