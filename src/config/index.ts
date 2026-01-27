import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
