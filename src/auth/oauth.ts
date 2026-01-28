import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { URL } from 'node:url';
import { type Auth, google } from 'googleapis';
import type { TokenData, TokenStorage } from './token-storage.js';

export type OAuth2Client = Auth.OAuth2Client;

const REDIRECT_PORT = 8089;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

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

export class GoogleOAuth {
  private readonly config: OAuthConfig;
  private readonly tokenStorage: TokenStorage;

  constructor(config: OAuthConfig, tokenStorage: TokenStorage) {
    this.config = config;
    this.tokenStorage = tokenStorage;
  }

  private createOAuth2Client() {
    return new google.auth.OAuth2(this.config.clientId, this.config.clientSecret, REDIRECT_URI);
  }

  async startAuthFlow(scopes: string[], options?: AuthFlowOptions): Promise<OAuthResult> {
    const oauth2Client = this.createOAuth2Client();
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state,
      prompt: 'consent', // Force consent to get refresh token
    });

    // Notify caller of the auth URL if callback provided
    if (options?.onAuthUrl) {
      options.onAuthUrl(authUrl);
    }

    // Start local server to receive callback
    const code = await this.waitForCallback(state, authUrl);

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
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

    // Store tokens
    const tokenData: TokenData = {
      accessToken: tokens.access_token ?? '',
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ?? Date.now() + 3600 * 1000,
      scopes,
    };

    await this.tokenStorage.save(accountId, tokenData);

    return {
      accountId,
      email,
      scopes,
    };
  }

  private waitForCallback(expectedState: string, authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '', `http://localhost:${REDIRECT_PORT}`);

        if (url.pathname !== '/callback') {
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
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400);
          res.end('Invalid state parameter');
          server.close();
          reject(new Error('Invalid state parameter - possible CSRF attack'));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end('No authorization code received');
          server.close();
          reject(new Error('No authorization code received'));
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
        resolve(code);
      });

      server.listen(REDIRECT_PORT, () => {
        console.error(`\nOpen this URL to authorize:\n\n${authUrl}\n`);
        console.error(`Waiting for authorization...`);
      });

      server.on('error', (err) => {
        reject(new Error(`Failed to start local server: ${err.message}`));
      });

      // Timeout after 5 minutes
      setTimeout(
        () => {
          server.close();
          reject(new Error('Authorization timed out'));
        },
        5 * 60 * 1000,
      );
    });
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
