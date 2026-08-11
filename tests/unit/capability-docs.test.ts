import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  generateLlmsTxtBlock,
  generateReadmeTable,
  replaceBetweenMarkers,
} from '../../scripts/generate-capability-docs.js';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Asserts a committed file already matches what `pnpm docs:capabilities`
 * would (re)generate. The expected content is computed fresh from the
 * current CAPABILITY_INFO on every run - never a checked-in fixture - by
 * running the same marker-replacement the generator itself uses against the
 * file's own on-disk content. So if CAPABILITY_INFO changes without
 * re-running the generator, the freshly generated block won't match what's
 * embedded between the markers and this test fails.
 */
function expectGenerated(relativePath: string, generate: () => string): void {
  const filePath = join(ROOT_DIR, relativePath);
  const actual = readFileSync(filePath, 'utf-8');
  const expected = replaceBetweenMarkers(actual, generate(), relativePath);

  expect(
    actual,
    `${relativePath} is out of date with src/auth/capabilities.ts. Run \`pnpm docs:capabilities\` and commit the result.`,
  ).toBe(expected);
}

describe('generated capability docs', () => {
  it('README.md matches freshly generated capability table', () => {
    expectGenerated('README.md', generateReadmeTable);
  });

  it('site/llms.txt matches freshly generated capability block', () => {
    expectGenerated('site/llms.txt', generateLlmsTxtBlock);
  });
});
