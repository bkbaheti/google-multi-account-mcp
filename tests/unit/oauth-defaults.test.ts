import { describe, expect, it } from 'vitest';
import { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET } from '../../src/auth/oauth-defaults.js';

describe('OAuth Defaults', () => {
  it('should export a non-empty default client ID', () => {
    expect(DEFAULT_OAUTH_CLIENT_ID).toBeDefined();
    expect(typeof DEFAULT_OAUTH_CLIENT_ID).toBe('string');
    expect(DEFAULT_OAUTH_CLIENT_ID.length).toBeGreaterThan(0);
    expect(DEFAULT_OAUTH_CLIENT_ID).toContain('.apps.googleusercontent.com');
  });

  it('should export a non-empty default client secret', () => {
    expect(DEFAULT_OAUTH_CLIENT_SECRET).toBeDefined();
    expect(typeof DEFAULT_OAUTH_CLIENT_SECRET).toBe('string');
    expect(DEFAULT_OAUTH_CLIENT_SECRET.length).toBeGreaterThan(0);
    expect(DEFAULT_OAUTH_CLIENT_SECRET).toMatch(/^GOCSPX-/);
  });
});
