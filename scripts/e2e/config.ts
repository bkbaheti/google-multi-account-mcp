import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Fixture IDs for one account. Only folderId is guaranteed — a spike may leave the rest unseeded. */
export interface FixtureSet {
  folderId: string;
  contractDocId?: string;
  sheetId?: string;
  drawingId?: string;
  /** Whether an API-created anchored comment returned quotedFileContent (spike 1) */
  anchoredCommentSupported?: boolean;
}

export interface E2eConfig {
  accounts: { primary: string; secondary: string };
  /** Keyed by account alias */
  fixtures: Record<string, FixtureSet>;
}

export const E2E_CONFIG_PATH = join(process.cwd(), 'e2e.config.json');

export function defaultE2eConfig(): E2eConfig {
  return {
    accounts: { primary: 'Procedure', secondary: 'Personal' },
    fixtures: {},
  };
}

export function loadE2eConfig(path: string = E2E_CONFIG_PATH): E2eConfig {
  if (!existsSync(path)) {
    return defaultE2eConfig();
  }

  const raw = readFileSync(path, 'utf-8');

  try {
    return JSON.parse(raw) as E2eConfig;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse e2e.config.json at ${path}: ${detail}`);
  }
}

export function saveE2eConfig(config: E2eConfig, path: string = E2E_CONFIG_PATH): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
