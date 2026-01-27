import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  scopes: string[];
}

export interface TokenStorage {
  save(accountId: string, token: TokenData): Promise<void>;
  load(accountId: string): Promise<TokenData | null>;
  delete(accountId: string): Promise<void>;
  readonly type: 'keychain' | 'encrypted-file';
}

const SERVICE_NAME = 'mcp-google';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const ITERATIONS = 100000;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

function encrypt(data: string, passphrase: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: salt:iv:authTag:encrypted (all base64)
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted,
  ].join(':');
}

function decrypt(encryptedData: string, passphrase: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }

  const [saltB64, ivB64, authTagB64, encrypted] = parts as [string, string, string, string];
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const key = deriveKey(passphrase, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export class KeychainStorage implements TokenStorage {
  readonly type = 'keychain' as const;
  private keytar: typeof import('keytar') | null = null;

  private async getKeytar(): Promise<typeof import('keytar')> {
    if (!this.keytar) {
      try {
        this.keytar = await import('keytar');
      } catch {
        throw new Error('Keychain storage not available: keytar module failed to load');
      }
    }
    return this.keytar;
  }

  async save(accountId: string, token: TokenData): Promise<void> {
    const keytar = await this.getKeytar();
    const data = JSON.stringify(token);
    await keytar.setPassword(SERVICE_NAME, accountId, data);
  }

  async load(accountId: string): Promise<TokenData | null> {
    const keytar = await this.getKeytar();
    const data = await keytar.getPassword(SERVICE_NAME, accountId);
    if (!data) {
      return null;
    }
    return JSON.parse(data) as TokenData;
  }

  async delete(accountId: string): Promise<void> {
    const keytar = await this.getKeytar();
    await keytar.deletePassword(SERVICE_NAME, accountId);
  }
}

export class EncryptedFileStorage implements TokenStorage {
  readonly type = 'encrypted-file' as const;
  private readonly storageDir: string;
  private readonly passphrase: string;

  constructor(storageDir: string, passphrase: string) {
    this.storageDir = storageDir;
    this.passphrase = passphrase;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
    }
  }

  private getFilePath(accountId: string): string {
    // Use hash of accountId for filename to avoid special chars
    const hash = crypto.createHash('sha256').update(accountId).digest('hex').slice(0, 16);
    return path.join(this.storageDir, `token-${hash}.enc`);
  }

  async save(accountId: string, token: TokenData): Promise<void> {
    const filePath = this.getFilePath(accountId);
    const data = JSON.stringify({ accountId, token });
    const encrypted = encrypt(data, this.passphrase);
    fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
  }

  async load(accountId: string): Promise<TokenData | null> {
    const filePath = this.getFilePath(accountId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const encrypted = fs.readFileSync(filePath, 'utf8');
      const decrypted = decrypt(encrypted, this.passphrase);
      const data = JSON.parse(decrypted) as { accountId: string; token: TokenData };

      if (data.accountId !== accountId) {
        throw new Error('Account ID mismatch');
      }

      return data.token;
    } catch {
      return null;
    }
  }

  async delete(accountId: string): Promise<void> {
    const filePath = this.getFilePath(accountId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export async function createTokenStorage(
  storageDir: string,
  passphrase?: string,
): Promise<TokenStorage> {
  // Try keychain first
  try {
    const storage = new KeychainStorage();
    // Test if keytar works by trying to load the module
    await storage.load('__test__');
    return storage;
  } catch {
    // Fall back to encrypted file
    if (!passphrase) {
      throw new Error(
        'Keychain not available and no passphrase provided for encrypted file storage',
      );
    }
    return new EncryptedFileStorage(storageDir, passphrase);
  }
}
