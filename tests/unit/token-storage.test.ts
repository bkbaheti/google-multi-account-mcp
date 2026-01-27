import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EncryptedFileStorage, type TokenData } from '../../src/auth/index.js';

const TEST_DIR = path.join(os.tmpdir(), `mcp-google-test-${Date.now()}`);
const PASSPHRASE = 'test-passphrase-123';

describe('EncryptedFileStorage', () => {
  let storage: EncryptedFileStorage;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    storage = new EncryptedFileStorage(TEST_DIR, PASSPHRASE);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should save and load token data', async () => {
    const accountId = 'test-account-123';
    const tokenData: TokenData = {
      accessToken: 'access-token-xyz',
      refreshToken: 'refresh-token-abc',
      expiresAt: Date.now() + 3600000,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    };

    await storage.save(accountId, tokenData);
    const loaded = await storage.load(accountId);

    expect(loaded).toEqual(tokenData);
  });

  it('should return null for non-existent account', async () => {
    const loaded = await storage.load('non-existent');
    expect(loaded).toBeNull();
  });

  it('should delete token data', async () => {
    const accountId = 'test-account-456';
    const tokenData: TokenData = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
      scopes: [],
    };

    await storage.save(accountId, tokenData);
    await storage.delete(accountId);
    const loaded = await storage.load(accountId);

    expect(loaded).toBeNull();
  });

  it('should encrypt data on disk', async () => {
    const accountId = 'test-account-789';
    const tokenData: TokenData = {
      accessToken: 'super-secret-access-token',
      refreshToken: 'super-secret-refresh-token',
      expiresAt: Date.now() + 3600000,
      scopes: [],
    };

    await storage.save(accountId, tokenData);

    // Read the raw file and verify it doesn't contain plaintext tokens
    const files = fs.readdirSync(TEST_DIR);
    expect(files.length).toBe(1);

    const fileName = files[0];
    expect(fileName).toBeDefined();
    const fileContent = fs.readFileSync(path.join(TEST_DIR, fileName as string), 'utf8');
    expect(fileContent).not.toContain('super-secret-access-token');
    expect(fileContent).not.toContain('super-secret-refresh-token');
  });

  it('should fail to load with wrong passphrase', async () => {
    const accountId = 'test-account-wrong-pass';
    const tokenData: TokenData = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
      scopes: [],
    };

    await storage.save(accountId, tokenData);

    // Create new storage with different passphrase
    const wrongStorage = new EncryptedFileStorage(TEST_DIR, 'wrong-passphrase');
    const loaded = await wrongStorage.load(accountId);

    // Should return null because decryption failed
    expect(loaded).toBeNull();
  });
});
