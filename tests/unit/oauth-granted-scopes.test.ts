import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grantedScopes } from '../../src/auth/oauth.js';

const READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';

describe('grantedScopes', () => {
  it('splits the space-delimited scope string Google returns', () => {
    expect(grantedScopes({ scope: `${READONLY} ${DRIVE_READONLY}` }, [])).toEqual([
      READONLY,
      DRIVE_READONLY,
    ]);
  });

  it('persists the subset actually granted when the user unticks a scope on consent', () => {
    // Requested both, but the consent screen response only confirms one -
    // this is the granular-permissions case defect 3 exists to handle.
    const granted = grantedScopes({ scope: READONLY }, [READONLY, DRIVE_READONLY]);
    expect(granted).toEqual([READONLY]);
    expect(granted).not.toContain(DRIVE_READONLY);
  });

  it('falls back to the requested scopes only when the response omits `scope`', () => {
    expect(grantedScopes({}, [READONLY, DRIVE_READONLY])).toEqual([READONLY, DRIVE_READONLY]);
  });

  it('ignores an empty-string scope field rather than returning ["" ]', () => {
    expect(grantedScopes({ scope: '' }, [READONLY])).toEqual([READONLY]);
  });
});

// End-to-end regression: drive the real OAuth callback handler (with
// googleapis and the HTTP server mocked out) and confirm what actually gets
// persisted to token storage and reported on the completed session is the
// GRANTED set, not the array startAuthFlowAsync was called with. This is
// the exact bug defect 3 describes: closing over the requested `scopes`
// array and persisting it unconditionally, discarding tokens.scope.
const mockGetToken = vi.fn();
const mockUserinfoGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      // Must be `function`, not an arrow, so `new google.auth.OAuth2(...)`
      // (as GoogleOAuth.createOAuth2Client calls it) works.
      OAuth2: vi.fn().mockImplementation(function OAuth2() {
        return {
          getToken: mockGetToken,
          setCredentials: vi.fn(),
        };
      }),
    },
    oauth2: vi.fn(() => ({
      userinfo: { get: mockUserinfoGet },
    })),
  },
}));

// node:http's ESM namespace is non-configurable, so vi.spyOn can't patch
// `createServer` in place - mock the module instead, capturing whatever
// request listener oauth.ts registers so the test can drive it directly
// without ever binding a real port.
let capturedHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => unknown) | null =
  null;
const mockCreateServer = vi.fn((handler: unknown) => {
  capturedHandler = handler as typeof capturedHandler;
  return {
    listen: (_port: number, cb?: () => void) => cb?.(),
    on: vi.fn(),
    close: vi.fn(),
  } as unknown as http.Server;
});

vi.mock('node:http', () => ({
  createServer: (handler: unknown) => mockCreateServer(handler),
}));

describe('GoogleOAuth callback flow persists granted scopes, not requested', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeCallbackRequest(query: string) {
    const req = { url: `/callback?${query}` } as http.IncomingMessage;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as http.ServerResponse;
    return { req, res };
  }

  it('saves only the scopes Google reports in tokens.scope', async () => {
    const { GoogleOAuth } = await import('../../src/auth/oauth.js');

    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600 * 1000,
        // Google reports only gmail.readonly was granted, even though
        // drive.readonly was requested below (user unticked it on consent).
        scope: READONLY,
      },
    });
    mockUserinfoGet.mockResolvedValue({ data: { email: 'alice@example.com' } });

    const mockStorage = { save: vi.fn(), load: vi.fn(), delete: vi.fn() };
    const oauth = new GoogleOAuth(
      { clientId: 'client-id', clientSecret: 'client-secret' },
      mockStorage as never,
    );

    const session = oauth.startAuthFlowAsync([READONLY, DRIVE_READONLY]);
    expect(capturedHandler).not.toBeNull();

    const { req, res } = fakeCallbackRequest(`code=auth-code&state=${session.state}`);
    await capturedHandler?.(req, res);
    // Flush the microtask queue so the async callback body completes.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockStorage.save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ scopes: [READONLY] }),
    );

    const completed = oauth.getPendingSession(session.sessionId);
    expect(completed?.status).toBe('completed');
    expect(completed?.result?.scopes).toEqual([READONLY]);
    expect(completed?.result?.scopes).not.toContain(DRIVE_READONLY);
  });
});
