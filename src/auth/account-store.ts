import { loadConfig, saveConfig } from '../config/index.js';
import type { Account, ScopeTier } from '../types/index.js';
import { mergeScopeTiers, SCOPE_TIERS } from '../types/index.js';
import { GoogleOAuth, type AuthFlowOptions, type OAuth2Client, type OAuthConfig } from './oauth.js';
import type { TokenStorage } from './token-storage.js';

export class AccountStore {
  private readonly tokenStorage: TokenStorage;
  private oauth: GoogleOAuth | null = null;

  constructor(tokenStorage: TokenStorage) {
    this.tokenStorage = tokenStorage;
  }

  private getOAuth(): GoogleOAuth {
    if (!this.oauth) {
      const config = loadConfig();
      if (!config.oauth?.clientId || !config.oauth?.clientSecret) {
        throw new Error(
          'OAuth credentials not configured. Set clientId and clientSecret in ~/.config/mcp-google/config.json',
        );
      }
      const oauthConfig: OAuthConfig = {
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
      };
      this.oauth = new GoogleOAuth(oauthConfig, this.tokenStorage);
    }
    return this.oauth;
  }

  listAccounts(): Account[] {
    const config = loadConfig();
    return config.accounts;
  }

  getAccount(accountId: string): Account | null {
    const accounts = this.listAccounts();
    return accounts.find((a) => a.id === accountId) ?? null;
  }

  async addAccount(
    scopeTierOrTiers: ScopeTier | ScopeTier[] = 'readonly',
    options?: AuthFlowOptions,
  ): Promise<Account> {
    // Support both single tier (backwards compat) and array of tiers
    const scopes = Array.isArray(scopeTierOrTiers)
      ? mergeScopeTiers(scopeTierOrTiers)
      : [...SCOPE_TIERS[scopeTierOrTiers]];
    const oauth = this.getOAuth();
    const result = await oauth.startAuthFlow(scopes, options);

    const account: Account = {
      id: result.accountId,
      email: result.email,
      labels: [],
      scopes: result.scopes,
      addedAt: new Date().toISOString(),
    };

    // Save to config
    const config = loadConfig();
    config.accounts.push(account);
    saveConfig(config);

    return account;
  }

  async removeAccount(accountId: string): Promise<boolean> {
    const config = loadConfig();
    const index = config.accounts.findIndex((a) => a.id === accountId);

    if (index === -1) {
      return false;
    }

    // Revoke and delete token
    try {
      const oauth = this.getOAuth();
      await oauth.revokeToken(accountId);
    } catch {
      // Continue even if revocation fails
    }

    // Remove from config
    config.accounts.splice(index, 1);
    saveConfig(config);

    return true;
  }

  setAccountLabels(accountId: string, labels: string[]): boolean {
    const config = loadConfig();
    const account = config.accounts.find((a) => a.id === accountId);

    if (!account) {
      return false;
    }

    account.labels = labels;
    saveConfig(config);

    return true;
  }

  updateLastUsed(accountId: string): void {
    const config = loadConfig();
    const account = config.accounts.find((a) => a.id === accountId);

    if (account) {
      account.lastUsedAt = new Date().toISOString();
      saveConfig(config);
    }
  }

  async getAccessToken(accountId: string): Promise<string> {
    const oauth = this.getOAuth();
    this.updateLastUsed(accountId);
    return oauth.getAccessToken(accountId);
  }

  async getAuthenticatedClient(accountId: string): Promise<OAuth2Client> {
    const oauth = this.getOAuth();
    this.updateLastUsed(accountId);
    return oauth.getAuthenticatedClient(accountId);
  }
}
