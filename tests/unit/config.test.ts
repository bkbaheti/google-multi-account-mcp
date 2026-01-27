import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_CONFIG_DIR = `${os.tmpdir()}/mcp-google-test-${Date.now()}`;

describe('Config', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
    vi.resetModules();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
    delete process.env.MCP_GOOGLE_CONFIG_PATH;
  });

  it('should create default config when none exists', async () => {
    const { loadConfig, ensureConfigDir } = await import('../../src/config/index.js');

    expect(typeof loadConfig).toBe('function');
    expect(typeof ensureConfigDir).toBe('function');
  });

  it('should have correct default config structure', async () => {
    const { DEFAULT_CONFIG } = await import('../../src/types/index.js');

    expect(DEFAULT_CONFIG).toEqual({
      version: 1,
      accounts: [],
    });
  });

  describe('MCP_GOOGLE_CONFIG_PATH env override', () => {
    it('should use env path when MCP_GOOGLE_CONFIG_PATH is set', async () => {
      const customPath = path.join(TEST_CONFIG_DIR, 'custom', 'config.json');
      process.env.MCP_GOOGLE_CONFIG_PATH = customPath;

      const { getConfigPath } = await import('../../src/config/index.js');

      expect(getConfigPath()).toBe(customPath);
    });

    it('should use default path when MCP_GOOGLE_CONFIG_PATH is not set', async () => {
      delete process.env.MCP_GOOGLE_CONFIG_PATH;

      const { getConfigPath } = await import('../../src/config/index.js');

      expect(getConfigPath()).toBe(
        path.join(os.homedir(), '.config', 'mcp-google', 'config.json')
      );
    });

    it('should save and load config from env path', async () => {
      const customPath = path.join(TEST_CONFIG_DIR, 'custom', 'config.json');
      process.env.MCP_GOOGLE_CONFIG_PATH = customPath;

      const { loadConfig, saveConfig, getConfigPath } = await import('../../src/config/index.js');
      const { DEFAULT_CONFIG } = await import('../../src/types/index.js');

      const config = loadConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(fs.existsSync(customPath)).toBe(true);

      const customConfig = { ...DEFAULT_CONFIG, version: 2 };
      saveConfig(customConfig as any);

      const reloaded = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
      expect(reloaded.version).toBe(2);
    });
  });
});
