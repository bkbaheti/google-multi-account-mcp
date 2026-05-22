import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../src/types/index.js';

const mockAccounts: Account[] = [
  {
    id: 'uuid-1',
    email: 'alice@work.com',
    alias: 'work',
    description: 'Work - engineering team',
    labels: ['work', 'eng'],
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
let configAccounts: Account[] = [];

// Capture args passed to startAuthFlowAsync so we can assert reauth wiring
let lastStartAuthFlowArgs: { scopes: string[]; options?: any } | null = null;

// Mock pending session that the OAuth layer "returns" — tests set this
// before calling checkPendingAuth.
let mockPendingSession: any = null;

describe('AccountStore reauth', () => {
  beforeEach(() => {
    savedConfig = null;
    configAccounts = JSON.parse(JSON.stringify(mockAccounts));
    lastStartAuthFlowArgs = null;
    mockPendingSession = null;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function getAccountStore() {
    vi.doMock('../../src/config/index.js', () => ({
      loadConfig: () => ({ version: 1, accounts: configAccounts }),
      saveConfig: vi.fn((config: any) => {
        savedConfig = config;
        configAccounts = config.accounts;
      }),
      resolveOAuthConfig: () => ({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      }),
    }));

    // Stub out GoogleOAuth so we don't open ports or hit Google.
    vi.doMock('../../src/auth/oauth.js', async () => {
      class FakeGoogleOAuth {
        startAuthFlowAsync(scopes: string[], options?: any) {
          lastStartAuthFlowArgs = { scopes, options };
          return {
            sessionId: 'session-abc',
            authUrl: 'https://example.com/auth?fake=1',
            scopes,
            state: 'state-xyz',
            status: 'pending',
            createdAt: Date.now(),
            existingAccountId: options?.existingAccountId,
            existingEmail: options?.existingEmail,
          };
        }
        getPendingSession() {
          return mockPendingSession;
        }
        listPendingSessions() {
          return mockPendingSession ? [mockPendingSession] : [];
        }
        revokeToken = vi.fn(async () => {});
        getAccessToken = vi.fn(async () => 'fake-token');
        getAuthenticatedClient = vi.fn();
      }
      return { GoogleOAuth: FakeGoogleOAuth };
    });

    const { AccountStore } = await import('../../src/auth/account-store.js');
    const mockStorage = {
      save: vi.fn(),
      load: vi.fn(),
      delete: vi.fn(),
    };
    return new AccountStore(mockStorage as any);
  }

  describe('startReauthAccount', () => {
    it('reuses existing account ID and email in OAuth options', async () => {
      const store = await getAccountStore();
      const result = store.startReauthAccount('uuid-1');
      expect('session' in result).toBe(true);
      if (!('session' in result)) return;

      expect(result.session.existingAccountId).toBe('uuid-1');
      expect(result.session.existingEmail).toBe('alice@work.com');
      expect(lastStartAuthFlowArgs?.options?.existingAccountId).toBe('uuid-1');
      expect(lastStartAuthFlowArgs?.options?.existingEmail).toBe('alice@work.com');
    });

    it('resolves by alias', async () => {
      const store = await getAccountStore();
      const result = store.startReauthAccount('work');
      expect('session' in result).toBe(true);
      if (!('session' in result)) return;
      expect(result.session.existingAccountId).toBe('uuid-1');
    });

    it('resolves by email', async () => {
      const store = await getAccountStore();
      const result = store.startReauthAccount('alice@personal.com');
      expect('session' in result).toBe(true);
      if (!('session' in result)) return;
      expect(result.session.existingAccountId).toBe('uuid-2');
    });

    it('returns error for unknown account', async () => {
      const store = await getAccountStore();
      const result = store.startReauthAccount('nonexistent');
      expect('error' in result).toBe(true);
    });

    it('defaults scopes to the account current scopes when no tier given', async () => {
      const store = await getAccountStore();
      store.startReauthAccount('uuid-1');
      expect(lastStartAuthFlowArgs?.scopes).toEqual([
        'https://www.googleapis.com/auth/gmail.readonly',
      ]);
    });

    it('uses provided scope tier when supplied', async () => {
      const store = await getAccountStore();
      store.startReauthAccount('uuid-1', 'mail_compose');
      expect(lastStartAuthFlowArgs?.scopes).toContain(
        'https://www.googleapis.com/auth/gmail.compose',
      );
    });

    it('uses provided multi-tier scopes when supplied', async () => {
      const store = await getAccountStore();
      store.startReauthAccount('uuid-1', ['mail_readonly', 'drive_readonly']);
      const scopes = lastStartAuthFlowArgs?.scopes ?? [];
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
    });
  });

  describe('checkPendingAuth on reauth completion', () => {
    it('preserves alias, description, labels, and addedAt; updates scopes', async () => {
      const store = await getAccountStore();
      mockPendingSession = {
        sessionId: 'session-abc',
        status: 'completed',
        existingAccountId: 'uuid-1',
        existingEmail: 'alice@work.com',
        result: {
          accountId: 'uuid-1',
          email: 'alice@work.com',
          scopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.compose',
          ],
        },
      };

      const result = store.checkPendingAuth('session-abc');
      expect(result.status).toBe('completed');
      expect(result.account?.id).toBe('uuid-1');
      expect(result.account?.alias).toBe('work');
      expect(result.account?.description).toBe('Work - engineering team');
      expect(result.account?.labels).toEqual(['work', 'eng']);
      expect(result.account?.addedAt).toBe('2025-01-01T00:00:00.000Z');
      expect(result.account?.scopes).toContain('https://www.googleapis.com/auth/gmail.compose');
      expect(result.account?.lastUsedAt).toBeTruthy();

      // No duplicate account row
      expect(savedConfig.accounts).toHaveLength(2);
    });

    it('creates a new account on fresh add (no existing match)', async () => {
      const store = await getAccountStore();
      mockPendingSession = {
        sessionId: 'session-new',
        status: 'completed',
        result: {
          accountId: 'uuid-new',
          email: 'bob@example.com',
          scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        },
      };

      const result = store.checkPendingAuth('session-new');
      expect(result.status).toBe('completed');
      expect(result.account?.id).toBe('uuid-new');
      expect(savedConfig.accounts).toHaveLength(3);
      // New account has no alias/description and empty labels
      const fresh = savedConfig.accounts.find((a: Account) => a.id === 'uuid-new');
      expect(fresh.labels).toEqual([]);
      expect(fresh.alias).toBeUndefined();
      expect(fresh.description).toBeUndefined();
    });
  });
});
