import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression for defect 2: google_add_account / google_reauth_account must
// reject a legacy scopeTier/scopeTiers argument by name instead of letting
// the MCP SDK's default (non-strict) zod parsing silently strip it and run
// a full OAuth round trip with the account's unchanged (or default) scopes.
// This drives the ACTUAL registered tools end to end (real inputSchema,
// real handler), not just the rejectUnknownArgs helper in isolation - that
// is the only way to prove the .passthrough() schema + handler check are
// wired together correctly.

vi.mock('../../src/config/index.js', () => ({
  loadConfig: () => ({ version: 1, accounts: [] }),
  saveConfig: vi.fn(),
  resolveOAuthConfig: () => ({ clientId: 'test-client-id', clientSecret: 'test-client-secret' }),
}));

describe('google_add_account / google_reauth_account reject legacy scopeTier', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;
  let originalRegisterTool: typeof McpServer.prototype.registerTool;
  let startAddAccountSpy: ReturnType<typeof vi.fn>;
  let startReauthAccountSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    handlers = {};
    originalRegisterTool = McpServer.prototype.registerTool;
    // Capture every tool handler as it's registered, without changing how
    // registerTool actually wires things up - real inputSchema, real parsing.
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
        throw new Error('startReauthAccount should not be called when args are rejected');
      }) as unknown as ReturnType<typeof vi.fn>;

    const { createServer } = await import('../../src/server/index.js');
    const mockStorage = { save: vi.fn(), load: vi.fn(), delete: vi.fn() };
    createServer({ tokenStorage: mockStorage as never });
  });

  afterEach(() => {
    McpServer.prototype.registerTool = originalRegisterTool;
    vi.restoreAllMocks();
  });

  it('google_add_account rejects a scopeTier argument and never starts an OAuth flow', async () => {
    const result = (await handlers.google_add_account?.({
      scopeTier: 'drive_full',
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('capabilities');
    expect(text).toContain('drive_full');
    expect(text).toContain('drive:appfiles');
    expect(startAddAccountSpy).not.toHaveBeenCalled();
  });

  it('google_reauth_account rejects a scopeTier argument and never starts an OAuth flow', async () => {
    const result = (await handlers.google_reauth_account?.({
      accountId: 'whatever',
      scopeTier: 'mail_full',
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('capabilities');
    expect(text).toContain('mail_full');
    expect(text).toContain('mail:modify');
    expect(startReauthAccountSpy).not.toHaveBeenCalled();
  });

  it('google_add_account still works normally when capabilities is used instead', async () => {
    startAddAccountSpy.mockImplementation(() => ({
      sessionId: 'session-1',
      authUrl: 'https://example.com/auth',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      state: 'state',
      status: 'pending',
      createdAt: Date.now(),
    }));

    const result = (await handlers.google_add_account?.({
      capabilities: ['mail:read'],
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBeUndefined();
    expect(startAddAccountSpy).toHaveBeenCalledWith(['mail:read']);
  });
});
