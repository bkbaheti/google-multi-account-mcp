import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultE2eConfig, loadE2eConfig, saveE2eConfig } from '../../scripts/e2e/config.js';

describe('e2e config', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-config-'));
    path = join(dir, 'e2e.config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to the Procedure and Personal aliases with no fixtures', () => {
    const config = defaultE2eConfig();

    expect(config.accounts.primary).toBe('Procedure');
    expect(config.accounts.secondary).toBe('Personal');
    expect(config.fixtures).toEqual({});
  });

  it('returns the default config when the file does not exist', () => {
    const config = loadE2eConfig(path);

    expect(config).toEqual(defaultE2eConfig());
  });

  it('round-trips a saved config', () => {
    const config = defaultE2eConfig();
    config.fixtures.Procedure = { folderId: 'fold-1', contractDocId: 'doc-1' };

    saveE2eConfig(config, path);

    expect(loadE2eConfig(path)).toEqual(config);
  });

  it('writes readable indented JSON', () => {
    saveE2eConfig(defaultE2eConfig(), path);

    expect(readFileSync(path, 'utf-8')).toContain('\n  "accounts"');
  });

  it('throws a clear error when the file is not valid JSON', () => {
    writeFileSync(path, '{ not json');

    expect(() => loadE2eConfig(path)).toThrow(/e2e.config.json/);
  });
});
