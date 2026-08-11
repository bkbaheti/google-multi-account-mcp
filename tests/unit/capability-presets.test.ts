import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_INFO, CAPABILITY_PRESETS } from '../../src/auth/capabilities.js';
import type { Account } from '../../src/types/index.js';

// Task 10 [B4]: presets are a front door onto the primitive Capability
// vocabulary (expanded before anything is stored - no preset name ever
// reaches an account record), and widening a reauth into drive:read gets
// the same confirm: true friction the existing narrowing gate has. See
// docs/superpowers/specs/2026-08-11-capability-correctness-and-ux-design.md,
// sections B3 and B4.

const mockAccounts: Account[] = [
  // Holds nothing beyond the baseline - used to prove that gaining a
  // capability NOT in CONFIRM_ON_WIDEN (mail:read) never needs confirm.
  {
    id: 'uuid-none',
    email: 'none@example.com',
    labels: [],
    scopes: ['https://www.googleapis.com/auth/userinfo.email'],
    addedAt: '2025-01-01T00:00:00.000Z',
  },
  // Holds mail:read only - requesting mail:read + drive:read is a pure
  // widen (drive:read is new, nothing is dropped).
  {
    id: 'uuid-nodrive',
    email: 'nodrive@example.com',
    labels: [],
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    addedAt: '2025-01-01T00:00:00.000Z',
  },
  // Holds mail:read, mail:compose, and calendar:read - requesting
  // mail:read + drive:read simultaneously drops mail:compose and
  // calendar:read (narrows) while gaining drive:read (widens).
  {
    id: 'uuid-both',
    email: 'both@example.com',
    labels: [],
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    addedAt: '2025-01-01T00:00:00.000Z',
  },
];

vi.mock('../../src/config/index.js', () => ({
  loadConfig: () => ({ version: 1, accounts: mockAccounts }),
  saveConfig: vi.fn(),
  resolveOAuthConfig: () => ({ clientId: 'test-client-id', clientSecret: 'test-client-secret' }),
}));

describe('capability presets (pure data)', () => {
  it('read-only expands to exactly mail:read, drive:read, calendar:read', () => {
    expect(CAPABILITY_PRESETS['read-only']).toEqual(['mail:read', 'drive:read', 'calendar:read']);
  });

  it('inbox-assistant expands to exactly mail:modify', () => {
    expect(CAPABILITY_PRESETS['inbox-assistant']).toEqual(['mail:modify']);
  });

  it('scheduler expands to both calendar capabilities', () => {
    expect(CAPABILITY_PRESETS.scheduler).toEqual(['calendar:read', 'calendar:write']);
  });

  it('has no full-access or Drive-only preset', () => {
    expect(Object.keys(CAPABILITY_PRESETS).sort()).toEqual([
      'inbox-assistant',
      'read-only',
      'scheduler',
    ]);
  });
});

describe('google_add_account / google_reauth_account: presets and widening confirmation', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;
  let originalRegisterTool: typeof McpServer.prototype.registerTool;
  let startAddAccountSpy: ReturnType<typeof vi.fn>;
  let startReauthAccountSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    handlers = {};
    originalRegisterTool = McpServer.prototype.registerTool;
    // Capture every tool handler as it's registered, without changing how
    // registerTool actually wires things up - real inputSchema, real
    // parsing, real gate logic in the handler body.
    McpServer.prototype.registerTool = function (
      this: McpServer,
      name: string,
      config: unknown,
      cb: unknown,
    ) {
      handlers[name] = cb as (args: Record<string, unknown>) => unknown;
      return originalRegisterTool.call(this, name, config as never, cb as never);
    } as typeof McpServer.prototype.registerTool;

    const { AccountStore } = await import('../../src/auth/account-store.js');
    startAddAccountSpy = vi
      .spyOn(AccountStore.prototype, 'startAddAccount')
      .mockImplementation(() => {
        throw new Error('startAddAccount should not be called when args are rejected');
      }) as unknown as ReturnType<typeof vi.fn>;
    startReauthAccountSpy = vi
      .spyOn(AccountStore.prototype, 'startReauthAccount')
      .mockImplementation(() => {
        throw new Error('startReauthAccount should not be called without confirm');
      }) as unknown as ReturnType<typeof vi.fn>;

    const { createServer } = await import('../../src/server/index.js');
    const mockStorage = { save: vi.fn(), load: vi.fn(), delete: vi.fn() };
    createServer({ tokenStorage: mockStorage as never });
  });

  afterEach(() => {
    McpServer.prototype.registerTool = originalRegisterTool;
    vi.restoreAllMocks();
  });

  describe('presets on google_add_account', () => {
    it('rejects an unknown preset by name, listing the valid ones', async () => {
      const result = (await handlers.google_add_account?.({
        presets: ['bogus-preset'],
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('bogus-preset');
      expect(text).toContain('read-only');
      expect(text).toContain('inbox-assistant');
      expect(text).toContain('scheduler');
      expect(startAddAccountSpy).not.toHaveBeenCalled();
    });

    it('composes a preset with explicit capabilities and deduplicates the result', async () => {
      startAddAccountSpy.mockImplementation(() => ({
        sessionId: 'session-1',
        authUrl: 'https://example.com/auth',
        scopes: [],
        state: 'state',
        status: 'pending',
        createdAt: Date.now(),
      }));

      // read-only -> [mail:read, drive:read, calendar:read]; explicit adds
      // calendar:write and repeats drive:read, which must not appear twice.
      const result = (await handlers.google_add_account?.({
        presets: ['read-only'],
        capabilities: ['drive:read', 'calendar:write'],
      })) as { isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(startAddAccountSpy).toHaveBeenCalledTimes(1);
      const granted = startAddAccountSpy.mock.calls[0]?.[0] as string[];
      expect([...granted].sort()).toEqual(
        ['calendar:read', 'calendar:write', 'drive:read', 'mail:read'].sort(),
      );
    });

    it('expands a preset alone to its documented primitives', async () => {
      startAddAccountSpy.mockImplementation(() => ({
        sessionId: 'session-2',
        authUrl: 'https://example.com/auth',
        scopes: [],
        state: 'state',
        status: 'pending',
        createdAt: Date.now(),
      }));

      const result = (await handlers.google_add_account?.({
        presets: ['scheduler'],
      })) as { isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(startAddAccountSpy).toHaveBeenCalledWith(['calendar:read', 'calendar:write']);
    });
  });

  describe('widening confirmation on google_reauth_account', () => {
    it('refuses to gain drive:read without confirm: true, and states the breadth of the grant', async () => {
      const result = (await handlers.google_reauth_account?.({
        accountId: 'uuid-nodrive',
        capabilities: ['mail:read', 'drive:read'],
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('drive:read');
      // Reuses CAPABILITY_INFO['drive:read'].canDo verbatim rather than new
      // prose that can drift from the picker/README copy.
      expect(text).toContain(CAPABILITY_INFO['drive:read'].canDo);
      expect(text).toContain('confirm: true');
      expect(startReauthAccountSpy).not.toHaveBeenCalled();
    });

    it('does not refuse gaining mail:read alone', async () => {
      startReauthAccountSpy.mockImplementation(() => ({
        session: {
          sessionId: 'session-3',
          authUrl: 'https://example.com/auth',
          scopes: [],
          state: 'state',
          status: 'pending',
          createdAt: Date.now(),
        },
      }));

      const result = (await handlers.google_reauth_account?.({
        accountId: 'uuid-none',
        capabilities: ['mail:read'],
      })) as { isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(startReauthAccountSpy).toHaveBeenCalledWith('uuid-none', ['mail:read']);
    });

    it('reports a simultaneous narrow and widen in one message, satisfied by a single confirm: true', async () => {
      const withoutConfirm = (await handlers.google_reauth_account?.({
        accountId: 'uuid-both',
        capabilities: ['mail:read', 'drive:read'],
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(withoutConfirm.isError).toBe(true);
      const text = withoutConfirm.content[0]?.text ?? '';
      // Narrowing: mail:compose and calendar:read would be dropped.
      expect(text).toContain('mail:compose');
      expect(text).toContain('calendar:read');
      // Widening: drive:read would be newly granted, breadth stated.
      expect(text).toContain(CAPABILITY_INFO['drive:read'].canDo);
      // A single confirm: true is asked for once, not once per fact (the
      // fixed "Confirmation required..." preamble also says "confirm: true",
      // so this checks the closing instruction isn't duplicated per fact).
      expect((text.match(/to proceed anyway/g) ?? []).length).toBe(1);
      expect(startReauthAccountSpy).not.toHaveBeenCalled();

      startReauthAccountSpy.mockImplementation(() => ({
        session: {
          sessionId: 'session-4',
          authUrl: 'https://example.com/auth',
          scopes: [],
          state: 'state',
          status: 'pending',
          createdAt: Date.now(),
        },
      }));

      const withConfirm = (await handlers.google_reauth_account?.({
        accountId: 'uuid-both',
        capabilities: ['mail:read', 'drive:read'],
        confirm: true,
      })) as { isError?: boolean };

      expect(withConfirm.isError).toBeUndefined();
      expect(startReauthAccountSpy).toHaveBeenCalledTimes(1);
      expect(startReauthAccountSpy).toHaveBeenCalledWith('uuid-both', ['mail:read', 'drive:read']);
    });
  });
});
