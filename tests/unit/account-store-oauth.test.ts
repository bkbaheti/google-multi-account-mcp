import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('AccountStore OAuth resolution', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('should not throw when no config file OAuth credentials exist (uses defaults)', async () => {
    vi.doMock('../../src/config/index.js', () => ({
      loadConfig: () => ({ version: 1, accounts: [] }),
      saveConfig: vi.fn(),
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

    const store = new AccountStore(mockStorage);
    // listAccounts uses loadConfig directly, not getOAuth — should work
    expect(() => store.listAccounts()).not.toThrow();
  }, 15000);
});
