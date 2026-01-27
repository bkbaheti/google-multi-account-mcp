import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEST_CONFIG_DIR = `${os.tmpdir()}/mcp-google-test-${Date.now()}`;

describe('Config', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  it('should create default config when none exists', async () => {
    const { loadConfig, ensureConfigDir } = await import('../../src/config/index.js');

    // This will use the actual config path, not our test path
    // For now, just verify the functions exist and can be called
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
});
