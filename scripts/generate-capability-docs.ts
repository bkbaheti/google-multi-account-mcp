#!/usr/bin/env npx tsx

/**
 * Generates the capability documentation embedded in README.md and
 * site/llms.txt from CAPABILITY_INFO, the single source of truth defined in
 * src/auth/capabilities.ts (see docs/superpowers/specs/2026-08-11-capability-
 * correctness-and-ux-design.md, section B3).
 *
 * Run: pnpm docs:capabilities
 *
 * Each target file carries a marker pair:
 *   <!-- BEGIN GENERATED: capabilities -->
 *   <!-- END GENERATED: capabilities -->
 * Everything between the markers is replaced; everything outside them is
 * left untouched. A file missing the markers fails loudly instead of
 * guessing where to insert - see replaceBetweenMarkers below.
 *
 * tests/unit/capability-docs.test.ts asserts the committed files already
 * match this output, so an edit to CAPABILITY_INFO that isn't followed by
 * `pnpm docs:capabilities` fails CI.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, CAPABILITY_INFO } from '../src/auth/capabilities.js';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER_NAME = 'capabilities';

/** Last path segment of a Google OAuth scope URL, e.g. "gmail.readonly". */
function scopeSuffix(scope: string): string {
  return scope.slice(scope.lastIndexOf('/') + 1);
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A Markdown table cell can't contain a literal pipe or newline. */
function tableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Markdown table for README.md - one row per capability, in CAPABILITIES
 * order (not object key order) so regeneration is stable across runs.
 */
export function generateReadmeTable(): string {
  const header = '| Capability | Can do | Cannot do | Reach | Scopes |';
  const divider = '|---|---|---|---|---|';
  const rows = CAPABILITIES.map((capability) => {
    const info = CAPABILITY_INFO[capability];
    const scopes = info.scopes.map((scope) => `\`${scopeSuffix(scope)}\``).join(', ');
    return `| \`${capability}\` (${tableCell(info.name)}) | ${tableCell(info.canDo)} | ${tableCell(info.cannotDo)} | ${tableCell(info.reach)} | ${scopes} |`;
  });
  return [header, divider, ...rows].join('\n');
}

/**
 * Compact plain-text list for site/llms.txt - an agent parses this, so it
 * favors a flat "key: value" shape over Markdown table syntax.
 */
export function generateLlmsTxtBlock(): string {
  const blocks = CAPABILITIES.map((capability) => {
    const info = CAPABILITY_INFO[capability];
    const scopes = info.scopes.map(scopeSuffix).join(', ');
    return [
      `${capability} (${info.name})`,
      `  can: ${info.canDo}`,
      `  cannot: ${info.cannotDo}`,
      `  reach: ${info.reach}`,
      `  scopes: ${scopes}`,
    ].join('\n');
  });
  return blocks.join('\n\n');
}

/**
 * Replace everything between the "capabilities" marker pair in `content`
 * with `generated`. Throws, naming `filePath`, when the markers are absent
 * or ambiguous - silently guessing where to insert would be worse than
 * failing outright.
 */
export function replaceBetweenMarkers(
  content: string,
  generated: string,
  filePath: string,
): string {
  const begin = `<!-- BEGIN GENERATED: ${MARKER_NAME} -->`;
  const end = `<!-- END GENERATED: ${MARKER_NAME} -->`;
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'g');
  const matches = content.match(pattern);

  if (!matches || matches.length === 0) {
    throw new Error(
      `${filePath} has no "${MARKER_NAME}" marker comments. Add:\n  ${begin}\n  ${end}\n` +
        'around the section that should hold generated capability docs, then re-run this generator.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${filePath} has more than one "${MARKER_NAME}" marker pair; expected exactly one.`,
    );
  }

  return content.replace(pattern, `${begin}\n${generated}\n${end}`);
}

interface GeneratedTarget {
  relativePath: string;
  generate: () => string;
}

const TARGETS: readonly GeneratedTarget[] = [
  { relativePath: 'README.md', generate: generateReadmeTable },
  { relativePath: 'site/llms.txt', generate: generateLlmsTxtBlock },
];

/** Regenerate every target file in place, under `rootDir`. */
export function regenerateAll(rootDir: string = ROOT_DIR): void {
  for (const target of TARGETS) {
    const filePath = join(rootDir, target.relativePath);
    const current = readFileSync(filePath, 'utf-8');
    const next = replaceBetweenMarkers(current, target.generate(), target.relativePath);
    if (next !== current) {
      writeFileSync(filePath, next);
    }
  }
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  regenerateAll();
  console.log(`Generated capability docs for: ${TARGETS.map((t) => t.relativePath).join(', ')}`);
}
