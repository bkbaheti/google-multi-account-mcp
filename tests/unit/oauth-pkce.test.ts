import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const READONLY = 'https://www.googleapis.com/auth/gmail.readonly';

// PKCE (RFC 7636) is the compensating control for shipping a public OAuth
// client: the client secret in src/auth/oauth-defaults.ts is embedded in the
// npm package by design (Google "Desktop app" clients are public clients per
// RFC 8252), so possession of the secret is NOT a barrier to redeeming a
// stolen authorization code. Without PKCE, any local process that binds the
// loopback callback port before we do can capture the code and exchange it
// for the user's tokens using the published secret. The code_verifier never
// leaves this process, so it is the only thing that makes the intercepted
// code useless.

describe('PKCE primitives', () => {
  it('derives the challenge from the verifier using the RFC 7636 Appendix B vector', async () => {
    const { codeChallengeFor } = await import('../../src/auth/oauth.js');
    // RFC 7636 Appendix B known-answer test. Pinning the published vector
    // rather than re-deriving it here means a swap to plain SHA-1, hex
    // encoding, or standard (non-URL-safe) base64 fails this test.
    expect(codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('generates a verifier within the length range RFC 7636 §4.1 mandates', async () => {
    const { generateCodeVerifier } = await import('../../src/auth/oauth.js');
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('generates a verifier using only the unreserved character set', async () => {
    const { generateCodeVerifier } = await import('../../src/auth/oauth.js');
    // RFC 7636 §4.1: ALPHA / DIGIT / "-" / "." / "_" / "~". Standard base64
    // would emit "+", "/" and "=" here, which would be mangled in transit.
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('generates a distinct verifier per call', async () => {
    const { generateCodeVerifier } = await import('../../src/auth/oauth.js');
    const verifiers = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()));
    expect(verifiers.size).toBe(50);
  });
});

const mockGetToken = vi.fn();
const mockUserinfoGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
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

// node:http's ESM namespace is non-configurable, so mock the module and
// capture the request listener, letting the test drive the callback without
// binding a real port. `address()` reports the port the OS would have
// assigned, which is what the ephemeral-port behaviour reads.
const ASSIGNED_PORT = 54321;
let capturedHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => unknown) | null =
  null;
let listenArgs: unknown[] = [];

const mockCreateServer = vi.fn((handler: unknown) => {
  capturedHandler = handler as typeof capturedHandler;
  return {
    listen: (...args: unknown[]) => {
      listenArgs = args;
      const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
      cb?.();
    },
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: ASSIGNED_PORT }),
    on: vi.fn(),
    close: vi.fn(),
  } as unknown as http.Server;
});

vi.mock('node:http', () => ({
  createServer: (handler: unknown) => mockCreateServer(handler),
}));

function fakeCallbackRequest(query: string) {
  const req = { url: `/callback?${query}` } as http.IncomingMessage;
  const res = { writeHead: vi.fn(), end: vi.fn() } as unknown as http.ServerResponse;
  return { req, res };
}

function makeOAuth(GoogleOAuth: typeof import('../../src/auth/oauth.js').GoogleOAuth) {
  const storage = { save: vi.fn(), load: vi.fn(), delete: vi.fn() };
  const oauth = new GoogleOAuth(
    { clientId: 'client-id', clientSecret: 'client-secret' },
    storage as never,
  );
  return { oauth, storage };
}

function successfulTokenResponse() {
  mockGetToken.mockResolvedValue({
    tokens: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expiry_date: Date.now() + 3600 * 1000,
      scope: READONLY,
    },
  });
  mockUserinfoGet.mockResolvedValue({ data: { email: 'alice@example.com' } });
}

describe('async auth flow sends PKCE and binds an ephemeral loopback port', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    listenArgs = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes an S256 code challenge on the authorization URL', async () => {
    const { GoogleOAuth } = await import('../../src/auth/oauth.js');
    const { oauth } = makeOAuth(GoogleOAuth);

    const session = await oauth.startAuthFlowAsync([READONLY]);
    const params = new URL(session.authUrl).searchParams;

    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });

  it('never puts the verifier itself on the authorization URL', async () => {
    const { GoogleOAuth } = await import('../../src/auth/oauth.js');
    const { oauth } = makeOAuth(GoogleOAuth);

    // The whole point of S256 over "plain" is that the URL — which travels
    // through the browser, shell history and stderr logs — carries only the
    // hash. If the verifier leaked here, PKCE would buy nothing. Asserting
    // the challenge is present keeps this from passing vacuously on a URL
    // that simply has no PKCE at all.
    const session = await oauth.startAuthFlowAsync([READONLY]);
    expect(session.authUrl).toContain('code_challenge=');
    expect(session.authUrl).not.toContain('code_verifier');
  });

  it('redeems the code with the verifier matching the challenge it advertised', async () => {
    const { GoogleOAuth, codeChallengeFor } = await import('../../src/auth/oauth.js');
    successfulTokenResponse();
    const { oauth } = makeOAuth(GoogleOAuth);

    const session = await oauth.startAuthFlowAsync([READONLY]);
    const advertisedChallenge = new URL(session.authUrl).searchParams.get('code_challenge');

    const { req, res } = fakeCallbackRequest(`code=auth-code&state=${session.state}`);
    await capturedHandler?.(req, res);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockGetToken).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'auth-code', codeVerifier: expect.any(String) }),
    );
    const sentVerifier = mockGetToken.mock.calls[0]?.[0]?.codeVerifier as string;
    expect(codeChallengeFor(sentVerifier)).toBe(advertisedChallenge);
  });

  it('gives each session an independent verifier', async () => {
    const { GoogleOAuth } = await import('../../src/auth/oauth.js');
    const { oauth } = makeOAuth(GoogleOAuth);

    const first = await oauth.startAuthFlowAsync([READONLY]);
    const second = await oauth.startAuthFlowAsync([READONLY]);

    const challengeOf = (s: { authUrl: string }) =>
      new URL(s.authUrl).searchParams.get('code_challenge');
    expect(challengeOf(first)).not.toBe(challengeOf(second));
  });

  it('binds an OS-assigned port on the loopback IP rather than a fixed 8089', async () => {
    const { GoogleOAuth } = await import('../../src/auth/oauth.js');
    const { oauth } = makeOAuth(GoogleOAuth);

    await oauth.startAuthFlowAsync([READONLY]);

    // Port 0 asks the OS for a free port (RFC 8252 §7.3). A fixed port is
    // what makes the pre-bind squat practical in the first place.
    expect(listenArgs[0]).toBe(0);
    expect(listenArgs[1]).toBe('127.0.0.1');
  });

  it('advertises the redirect URI it actually bound', async () => {
    const { GoogleOAuth } = await import('../../src/auth/oauth.js');
    const { oauth } = makeOAuth(GoogleOAuth);

    const session = await oauth.startAuthFlowAsync([READONLY]);
    const redirectUri = new URL(session.authUrl).searchParams.get('redirect_uri');

    expect(redirectUri).toBe(`http://127.0.0.1:${ASSIGNED_PORT}/callback`);
  });

  it('uses the literal loopback IP, not the resolvable name "localhost"', async () => {
    const { GoogleOAuth } = await import('../../src/auth/oauth.js');
    const { oauth } = makeOAuth(GoogleOAuth);

    // RFC 8252 §8.3: "localhost" depends on name resolution, so a tampered
    // hosts file or resolver can point the callback somewhere else.
    const session = await oauth.startAuthFlowAsync([READONLY]);
    expect(session.authUrl).not.toContain('localhost');
  });
});

describe('blocking auth flow sends PKCE too', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    listenArgs = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redeems the code with a verifier matching the advertised challenge', async () => {
    const { GoogleOAuth, codeChallengeFor } = await import('../../src/auth/oauth.js');
    successfulTokenResponse();
    const { oauth } = makeOAuth(GoogleOAuth);

    // The legacy blocking flow is a second, independent code path. It has
    // drifted from the async one before (see the duplicated URL builders),
    // so it gets its own regression rather than trusting shared helpers.
    let authUrl = '';
    const flow = oauth.startAuthFlow([READONLY], {
      onAuthUrl: (url) => {
        authUrl = url;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authUrl).not.toBe('');
    const advertisedChallenge = new URL(authUrl).searchParams.get('code_challenge');
    expect(advertisedChallenge).toMatch(/^[A-Za-z0-9\-_]{43}$/);

    const returnedState = new URL(authUrl).searchParams.get('state');
    const { req, res } = fakeCallbackRequest(`code=auth-code&state=${returnedState}`);
    await capturedHandler?.(req, res);
    await flow;

    const sentVerifier = mockGetToken.mock.calls[0]?.[0]?.codeVerifier as string;
    expect(codeChallengeFor(sentVerifier)).toBe(advertisedChallenge);
  });
});
