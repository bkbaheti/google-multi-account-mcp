import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { URL } from 'node:url';
import { type Auth, google } from 'googleapis';
import type { TokenData, TokenStorage } from './token-storage.js';

export type OAuth2Client = Auth.OAuth2Client;

// RFC 8252 §8.3: use the literal loopback IP rather than "localhost", whose
// resolution depends on the hosts file and resolver and can therefore be
// pointed elsewhere by a local attacker.
const REDIRECT_HOST = '127.0.0.1';
const CALLBACK_PATH = '/callback';

function redirectUriFor(port: number): string {
  return `http://${REDIRECT_HOST}:${port}${CALLBACK_PATH}`;
}

/**
 * Bind the callback server to an OS-assigned port on the loopback interface
 * and resolve with the port that was chosen.
 *
 * RFC 8252 §7.3 calls for an ephemeral port. A fixed port is what makes the
 * pre-bind squat practical: a local process that claims the well-known port
 * first receives the authorization code instead of us. Combined with PKCE
 * (below) an intercepted code is useless, but not handing out a predictable
 * target is the cheaper half of the defence.
 */
function bindLoopbackServer(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on('error', (err: Error) => {
      reject(new Error(`Failed to start local server: ${err.message}`));
    });
    server.listen(0, REDIRECT_HOST, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
        return;
      }
      reject(new Error('Could not determine the callback port the OS assigned'));
    });
  });
}

/**
 * Generate a PKCE code verifier (RFC 7636 §4.1).
 *
 * PKCE is not optional hardening for this server, it is the control that
 * makes a public client safe. The OAuth client secret in ./oauth-defaults.ts
 * ships inside the npm package on purpose — Google "Desktop app" clients are
 * public clients under RFC 8252 and their secret is not confidential — so
 * possession of the secret is no barrier to redeeming a stolen authorization
 * code. The verifier never leaves this process, so it is the only thing that
 * makes an intercepted code unusable.
 *
 * 32 random bytes base64url-encode to 43 characters, the minimum §4.1 allows,
 * and base64url keeps the output inside the unreserved character set.
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Derive the S256 code challenge for a verifier (RFC 7636 §4.2).
 *
 * S256 rather than "plain" because the challenge travels on the authorization
 * URL, which passes through the browser, shell history and our own stderr
 * logging. Sending the verifier there would defeat the point.
 */
export function codeChallengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes: string[];
  loginHint?: string;
}

/**
 * Build the Google authorization URL.
 *
 * Shared by both auth flows deliberately: they previously duplicated this
 * param assembly, which is exactly how one flow would end up with PKCE and
 * the other without.
 *
 * Critical params (response_type, client_id, redirect_uri, and the PKCE pair)
 * are placed BEFORE scopes. googleapis puts them last, but if the URL gets
 * truncated by text rendering, those params are lost.
 */
function buildAuthUrl(options: AuthUrlParams): string {
  const params = new URLSearchParams();
  params.set('response_type', 'code');
  params.set('client_id', options.clientId);
  params.set('redirect_uri', options.redirectUri);
  params.set('state', options.state);
  params.set('code_challenge', options.codeChallenge);
  params.set('code_challenge_method', 'S256');
  params.set('access_type', 'offline');
  params.set('prompt', 'consent');
  params.set('scope', options.scopes.join(' '));
  // For reauth, hint Google to surface the right account picker entry.
  if (options.loginHint) {
    params.set('login_hint', options.loginHint);
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthResult {
  accountId: string;
  email: string;
  scopes: string[];
}

export interface AuthFlowOptions {
  onAuthUrl?: (url: string) => void;
}

// Pending auth session for async flow
export interface PendingAuthSession {
  sessionId: string;
  authUrl: string;
  scopes: string[];
  state: string;
  status: 'pending' | 'completed' | 'failed';
  result?: OAuthResult;
  error?: string;
  createdAt: number;
  // Reauth fields: when set, the callback reuses this accountId instead of
  // generating a new one, and verifies the authorized email matches.
  existingAccountId?: string;
  existingEmail?: string;
}

export interface StartAuthOptions {
  existingAccountId?: string;
  existingEmail?: string;
}

/**
 * The scopes Google actually granted, read from the token response's
 * `scope` field (a space-delimited string) rather than the scopes that were
 * requested. With Google's granular consent screen, a user can uncheck an
 * individual scope on the OAuth consent page and still complete the flow -
 * persisting the requested array instead would let the account record claim
 * a capability it doesn't hold, which is exactly what the capability gate
 * (see ../auth/capabilities.ts) trusts account.scopes to reflect. Silently
 * trusting the request here is precisely the gate bypass the capability
 * model exists to prevent.
 */
export function grantedScopes(tokens: { scope?: string }, requested: string[]): string[] {
  if (tokens.scope) {
    return tokens.scope.split(' ').filter(Boolean);
  }
  // Fallback: per OAuth 2.0 (RFC 6749 §5.1), the token response MAY omit
  // `scope` when the granted scope matches what was requested, so a missing
  // field isn't necessarily a sign anything was narrowed. Google's token
  // endpoint includes `scope` in practice, but this path is a defensive
  // fallback for a response shape this code hasn't observed, not a
  // documented guarantee - so it's read from the request rather than
  // treated as "granted everything" by assumption.
  return requested;
}

// Store pending auth sessions (in-memory, cleared on restart)
const pendingAuthSessions = new Map<string, PendingAuthSession>();

// Cleanup expired sessions (older than 10 minutes)
function cleanupExpiredSessions(): void {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [sessionId, session] of pendingAuthSessions) {
    if (now - session.createdAt > maxAge) {
      pendingAuthSessions.delete(sessionId);
    }
  }
}

export class GoogleOAuth {
  private readonly config: OAuthConfig;
  private readonly tokenStorage: TokenStorage;

  constructor(config: OAuthConfig, tokenStorage: TokenStorage) {
    this.config = config;
    this.tokenStorage = tokenStorage;
  }

  private createOAuth2Client(redirectUri?: string) {
    return new google.auth.OAuth2(this.config.clientId, this.config.clientSecret, redirectUri);
  }

  /**
   * Start auth flow - resolves with the auth URL once the loopback callback
   * server is bound. The server then runs in the background and updates the
   * session status. Pass options.existingAccountId to reuse that account ID
   * on completion (used by reauth so the alias/description/labels survive).
   *
   * This has to await the bind: the redirect_uri on the authorization URL
   * must name the ephemeral port the OS actually assigned, so the URL cannot
   * be built until the socket is listening.
   */
  async startAuthFlowAsync(
    scopes: string[],
    options?: StartAuthOptions,
  ): Promise<PendingAuthSession> {
    cleanupExpiredSessions();

    const state = crypto.randomBytes(16).toString('hex');
    const sessionId = crypto.randomUUID();
    // Held in this closure rather than on PendingAuthSession: the session
    // object is returned through MCP tool responses, and the verifier is the
    // one secret in this flow that must never be serialized anywhere.
    const codeVerifier = generateCodeVerifier();

    // The handler closes over `session`, which needs the authUrl, which needs
    // the bound port - so the reference is filled in after the bind below.
    // No legitimate request can arrive before then because the user has not
    // been given the URL yet, and the state check rejects anything else.
    let session: PendingAuthSession | undefined;

    const server = http.createServer((req, res) => {
      if (!session) {
        res.writeHead(503);
        res.end('Callback server not ready');
        return;
      }
      void this.handleAsyncCallback(req, res, {
        server,
        session,
        scopes,
        codeVerifier,
        redirectUri: redirectUriFor(port),
      });
    });

    const port = await bindLoopbackServer(server);
    const authUrl = buildAuthUrl({
      clientId: this.config.clientId,
      redirectUri: redirectUriFor(port),
      state,
      codeChallenge: codeChallengeFor(codeVerifier),
      scopes,
      ...(options?.existingEmail ? { loginHint: options.existingEmail } : {}),
    });

    session = {
      sessionId,
      authUrl,
      scopes,
      state,
      status: 'pending',
      createdAt: Date.now(),
      ...(options?.existingAccountId ? { existingAccountId: options.existingAccountId } : {}),
      ...(options?.existingEmail ? { existingEmail: options.existingEmail } : {}),
    };

    pendingAuthSessions.set(sessionId, session);

    // Output auth URL to stderr as backup
    process.stderr.write(`\n[mcp-google] Auth URL: ${authUrl}\n`);

    const pending = session;
    server.on('error', (err) => {
      pending.status = 'failed';
      pending.error = `Failed to start local server: ${err.message}`;
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        if (pending.status === 'pending') {
          pending.status = 'failed';
          pending.error = 'Authorization timed out after 5 minutes';
          server.close();
        }
      },
      5 * 60 * 1000,
    );

    return session;
  }

  /**
   * Get a pending auth session by ID
   */
  getPendingSession(sessionId: string): PendingAuthSession | undefined {
    return pendingAuthSessions.get(sessionId);
  }

  /**
   * List all pending auth sessions
   */
  listPendingSessions(): PendingAuthSession[] {
    cleanupExpiredSessions();
    return Array.from(pendingAuthSessions.values());
  }

  /**
   * Handle one request to the loopback callback endpoint for an async session.
   */
  private async handleAsyncCallback(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: {
      server: http.Server;
      session: PendingAuthSession;
      scopes: string[];
      codeVerifier: string;
      redirectUri: string;
    },
  ): Promise<void> {
    const { server, session, scopes, codeVerifier, redirectUri } = ctx;
    {
      const url = new URL(req.url ?? '', redirectUri);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        server.close();
        session.status = 'failed';
        session.error = `Authorization failed: ${error}`;
        return;
      }

      if (state !== session.state) {
        res.writeHead(400);
        res.end('Invalid state parameter');
        server.close();
        session.status = 'failed';
        session.error = 'Invalid state parameter - possible CSRF attack';
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('No authorization code received');
        server.close();
        session.status = 'failed';
        session.error = 'No authorization code received';
        return;
      }

      try {
        // Exchange code for tokens. codeVerifier proves this process is the
        // one that started the flow - without it, whoever holds the code can
        // redeem it using the client secret published in the npm package.
        const oauth2Client = this.createOAuth2Client(redirectUri);
        const { tokens } = await oauth2Client.getToken({ code, codeVerifier });
        oauth2Client.setCredentials(tokens);

        if (!tokens.refresh_token) {
          throw new Error('No refresh token received. Please revoke app access and try again.');
        }

        // Get user email
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;

        if (!email) {
          throw new Error('Could not retrieve user email');
        }

        // Reauth: verify email matches and reuse the existing account ID.
        if (session.existingEmail && session.existingEmail !== email) {
          throw new Error(
            `Reauth email mismatch: expected ${session.existingEmail}, got ${email}. Pick the correct Google account in the consent screen.`,
          );
        }
        const accountId = session.existingAccountId ?? crypto.randomUUID();
        const granted = grantedScopes(tokens, scopes);

        // Store tokens
        const tokenData: TokenData = {
          accessToken: tokens.access_token ?? '',
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expiry_date ?? Date.now() + 3600 * 1000,
          scopes: granted,
        };

        await this.tokenStorage.save(accountId, tokenData);

        session.status = 'completed';
        session.result = { accountId, email, scopes: granted };

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Authorization Successful</title></head>
          <body style="font-family: system-ui; text-align: center; padding: 50px;">
            <h1>Authorization Successful</h1>
            <p>Account ${email} has been connected.</p>
            <p>You can close this window and return to Claude.</p>
          </body>
          </html>
        `);
      } catch (err) {
        session.status = 'failed';
        session.error = err instanceof Error ? err.message : 'Unknown error during authorization';
        res.writeHead(500);
        res.end(`Authorization failed: ${session.error}`);
      }

      server.close();
    }
  }

  /**
   * Original blocking auth flow (for backwards compatibility)
   */
  async startAuthFlow(scopes: string[], options?: AuthFlowOptions): Promise<OAuthResult> {
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();

    // Bind first so the redirect_uri can name the assigned port, then hand
    // out the URL. Same ordering constraint as startAuthFlowAsync.
    const listener = await this.listenForCode(state);
    const redirectUri = redirectUriFor(listener.port);
    const authUrl = buildAuthUrl({
      clientId: this.config.clientId,
      redirectUri,
      state,
      codeChallenge: codeChallengeFor(codeVerifier),
      scopes,
    });

    // Notify caller of the auth URL if callback provided
    if (options?.onAuthUrl) {
      options.onAuthUrl(authUrl);
    }
    process.stderr.write(`
════════════════════════════════════════════════════════════════════════════════
  AUTHORIZATION REQUIRED

  Open this URL in your browser to authorize:

  ${authUrl}

  Waiting for authorization...
════════════════════════════════════════════════════════════════════════════════

`);

    // Wait for the loopback callback to deliver the code
    const code = await listener.code;

    // Exchange code for tokens
    const oauth2Client = this.createOAuth2Client(redirectUri);
    const { tokens } = await oauth2Client.getToken({ code, codeVerifier });
    oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. Please revoke app access and try again.');
    }

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      throw new Error('Could not retrieve user email');
    }

    // Generate account ID
    const accountId = crypto.randomUUID();
    const granted = grantedScopes(tokens, scopes);

    // Store tokens
    const tokenData: TokenData = {
      accessToken: tokens.access_token ?? '',
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ?? Date.now() + 3600 * 1000,
      scopes: granted,
    };

    await this.tokenStorage.save(accountId, tokenData);

    return {
      accountId,
      email,
      scopes: granted,
    };
  }

  /**
   * Bind a loopback callback server and return the assigned port alongside a
   * promise for the authorization code it will receive.
   *
   * Split out from the code-waiting promise because the caller needs the port
   * before it can build the authorization URL that eventually triggers the
   * callback.
   */
  private async listenForCode(
    expectedState: string,
  ): Promise<{ port: number; code: Promise<string> }> {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const code = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', redirectUriFor(port));

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const received = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        server.close();
        rejectCode(new Error(`Authorization failed: ${error}`));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400);
        res.end('Invalid state parameter');
        server.close();
        rejectCode(new Error('Invalid state parameter - possible CSRF attack'));
        return;
      }

      if (!received) {
        res.writeHead(400);
        res.end('No authorization code received');
        server.close();
        rejectCode(new Error('No authorization code received'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Authorization Successful</title></head>
          <body style="font-family: system-ui; text-align: center; padding: 50px;">
            <h1>Authorization Successful</h1>
            <p>You can close this window and return to your terminal.</p>
          </body>
          </html>
        `);

      server.close();
      resolveCode(received);
    });

    const port = await bindLoopbackServer(server);

    server.on('error', (err) => {
      rejectCode(new Error(`Failed to start local server: ${err.message}`));
    });

    // Timeout after 5 minutes
    const timeout = setTimeout(
      () => {
        server.close();
        rejectCode(new Error('Authorization timed out'));
      },
      5 * 60 * 1000,
    );
    // Settle either way clears the timer so it stops holding the event loop.
    void code.then(
      () => clearTimeout(timeout),
      () => clearTimeout(timeout),
    );

    return { port, code };
  }

  async getAccessToken(accountId: string): Promise<string> {
    const tokenData = await this.tokenStorage.load(accountId);
    if (!tokenData) {
      throw new Error(`No token found for account ${accountId}`);
    }

    // Check if token is expired (with 5 min buffer)
    if (Date.now() >= tokenData.expiresAt - 5 * 60 * 1000) {
      return this.refreshToken(accountId, tokenData);
    }

    return tokenData.accessToken;
  }

  private async refreshToken(accountId: string, tokenData: TokenData): Promise<string> {
    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: tokenData.refreshToken,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    const newTokenData: TokenData = {
      accessToken: credentials.access_token ?? '',
      refreshToken: tokenData.refreshToken, // Keep existing refresh token
      expiresAt: credentials.expiry_date ?? Date.now() + 3600 * 1000,
      scopes: tokenData.scopes,
    };

    await this.tokenStorage.save(accountId, newTokenData);

    return newTokenData.accessToken;
  }

  async revokeToken(accountId: string): Promise<void> {
    const tokenData = await this.tokenStorage.load(accountId);
    if (tokenData) {
      const oauth2Client = this.createOAuth2Client();
      try {
        await oauth2Client.revokeToken(tokenData.accessToken);
      } catch {
        // Ignore revocation errors - token might already be invalid
      }
      await this.tokenStorage.delete(accountId);
    }
  }

  async getAuthenticatedClient(accountId: string): Promise<OAuth2Client> {
    const accessToken = await this.getAccessToken(accountId);
    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });
    return oauth2Client;
  }
}
