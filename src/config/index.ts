import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type Config, ConfigSchema, DEFAULT_CONFIG } from '../types/index.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'mcp-google');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return ConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${CONFIG_FILE}`);
    }
    throw error;
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}
