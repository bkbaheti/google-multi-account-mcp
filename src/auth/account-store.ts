import { loadConfig, resolveOAuthConfig, saveConfig } from '../config/index.js';
import type { Account, ScopeTier } from '../types/index.js';
import { mergeScopeTiers, SCOPE_TIERS } from '../types/index.js';
import {
  type AuthFlowOptions,
  GoogleOAuth,
  type OAuth2Client,
  type OAuthConfig,
  type PendingAuthSession,
} from './oauth.js';
import type { TokenStorage } from './token-storage.js';

export class AccountStore {
  private readonly tokenStorage: TokenStorage;
  private oauth: GoogleOAuth | null = null;

  constructor(tokenStorage: TokenStorage) {
    this.tokenStorage = tokenStorage;
  }

  private getOAuth(): GoogleOAuth {
    if (!this.oauth) {
      const oauthConfig: OAuthConfig = resolveOAuthConfig();
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

  /**
   * Resolve an account by ID, alias, or email.
   * Priority: exact ID match > alias match > email match.
   */
  resolveAccount(idOrAlias: string): Account | null {
    const accounts = this.listAccounts();

    // 1. Try exact ID match
    const byId = accounts.find((a) => a.id === idOrAlias);
    if (byId) return byId;

    // 2. Try alias match (case-insensitive)
    const lower = idOrAlias.toLowerCase();
    const byAlias = accounts.find((a) => a.alias?.toLowerCase() === lower);
    if (byAlias) return byAlias;

    // 3. Try email match
    const byEmail = accounts.find((a) => a.email === idOrAlias);
    if (byEmail) return byEmail;

    return null;
  }

  setAccountAlias(accountId: string, alias: string | null): { success: boolean; error?: string; existingAccountId?: string } {
    const config = loadConfig();
    const account = config.accounts.find((a) => a.id === accountId);

    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    if (alias !== null) {
      // Check uniqueness (case-insensitive)
      const lower = alias.toLowerCase();
      const existing = config.accounts.find(
        (a) => a.id !== accountId && a.alias?.toLowerCase() === lower,
      );
      if (existing) {
        return { success: false, error: 'Alias already in use', existingAccountId: existing.id };
      }
      account.alias = alias;
    } else {
      delete account.alias;
    }

    saveConfig(config);
    return { success: true };
  }

  /**
   * Start adding an account asynchronously - returns auth URL immediately.
   * Use checkPendingAuth to poll for completion.
   */
  startAddAccount(scopeTierOrTiers: ScopeTier | ScopeTier[] = 'mail_readonly'): PendingAuthSession {
    const scopes = Array.isArray(scopeTierOrTiers)
      ? mergeScopeTiers(scopeTierOrTiers)
      : [...SCOPE_TIERS[scopeTierOrTiers]];
    const oauth = this.getOAuth();
    return oauth.startAuthFlowAsync(scopes);
  }

  /**
   * Check if a pending auth session completed. If completed, saves the account.
   * Returns the session status and account if completed.
   */
  checkPendingAuth(sessionId: string): {
    status: 'pending' | 'completed' | 'failed' | 'not_found';
    account?: Account;
    error?: string;
  } {
    const oauth = this.getOAuth();
    const session = oauth.getPendingSession(sessionId);

    if (!session) {
      return { status: 'not_found', error: 'Session not found or expired' };
    }

    if (session.status === 'pending') {
      return { status: 'pending' };
    }

    if (session.status === 'failed') {
      return { status: 'failed', error: session.error ?? 'Unknown error' };
    }

    if (session.status === 'completed' && session.result) {
      // Save the account to config
      const account: Account = {
        id: session.result.accountId,
        email: session.result.email,
        labels: [],
        scopes: session.result.scopes,
        addedAt: new Date().toISOString(),
      };

      const config = loadConfig();
      // Check if account already saved (avoid duplicates)
      if (!config.accounts.find((a) => a.id === account.id)) {
        config.accounts.push(account);
        saveConfig(config);
      }

      return { status: 'completed', account };
    }

    return { status: 'failed', error: 'Unknown error' };
  }

  /**
   * List all pending auth sessions
   */
  listPendingSessions(): PendingAuthSession[] {
    const oauth = this.getOAuth();
    return oauth.listPendingSessions();
  }

  /**
   * Original blocking addAccount method for backwards compatibility
   */
  async addAccount(
    scopeTierOrTiers: ScopeTier | ScopeTier[] = 'mail_readonly',
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

  setAccountDescription(accountId: string, description: string | null): boolean {
    const config = loadConfig();
    const account = config.accounts.find((a) => a.id === accountId);

    if (!account) {
      return false;
    }

    if (description !== null) {
      account.description = description;
    } else {
      delete account.description;
    }

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

  /**
   * Resolve an ID-or-alias to the real account ID for token storage.
   * Falls back to the input if no match found (preserves original error paths).
   */
  private resolveToId(accountIdOrAlias: string): string {
    const account = this.resolveAccount(accountIdOrAlias);
    return account ? account.id : accountIdOrAlias;
  }

  async getAccessToken(accountIdOrAlias: string): Promise<string> {
    const id = this.resolveToId(accountIdOrAlias);
    const oauth = this.getOAuth();
    this.updateLastUsed(id);
    return oauth.getAccessToken(id);
  }

  async getAuthenticatedClient(accountIdOrAlias: string): Promise<OAuth2Client> {
    const id = this.resolveToId(accountIdOrAlias);
    const oauth = this.getOAuth();
    this.updateLastUsed(id);
    return oauth.getAuthenticatedClient(id);
  }
}
