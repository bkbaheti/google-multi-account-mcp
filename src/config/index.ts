import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET } from '../auth/oauth-defaults.js';
import { type Config, ConfigSchema, DEFAULT_CONFIG } from '../types/index.js';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'mcp-google');
const DEFAULT_CONFIG_FILE = path.join(DEFAULT_CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return process.env['MCP_GOOGLE_CONFIG_PATH'] || DEFAULT_CONFIG_FILE;
}

function getConfigDir(): string {
  const configPath = getConfigPath();
  return path.dirname(configPath);
}

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return ConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${configPath}`);
    }
    throw error;
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Resolve OAuth credentials with priority:
 * 1. Environment variables (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 * 2. Config file (~/.config/mcp-google/config.json oauth field)
 * 3. Package defaults (shared public OAuth client)
 */
export function resolveOAuthConfig(): OAuthCredentials {
  // biome-ignore lint/complexity/useLiteralKeys: env vars require bracket notation
  const envId = process.env['GOOGLE_CLIENT_ID'];
  // biome-ignore lint/complexity/useLiteralKeys: env vars require bracket notation
  const envSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }

  const config = loadConfig();
  if (config.oauth?.clientId && config.oauth?.clientSecret) {
    return {
      clientId: config.oauth.clientId,
      clientSecret: config.oauth.clientSecret,
    };
  }

  return {
    clientId: DEFAULT_OAUTH_CLIENT_ID,
    clientSecret: DEFAULT_OAUTH_CLIENT_SECRET,
  };
}
