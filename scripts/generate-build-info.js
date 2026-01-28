#!/usr/bin/env node
/**
 * Generates build info JSON file with version, git commit, and build date.
 * Run during build: node scripts/generate-build-info.js
 *
 * Note: Uses execSync with hardcoded command (no user input) - safe from injection.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;

// Get git commit hash (hardcoded command, no user input)
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
} catch {
  // Not a git repo or git not available
}

// Get build date
const buildDate = new Date().toISOString();

const buildInfo = {
  version,
  commit,
  buildDate,
};

// Ensure dist directory exists
const distDir = join(rootDir, 'dist');
try {
  mkdirSync(distDir, { recursive: true });
} catch {
  // Directory exists
}

// Write to dist/build-info.json
const outputPath = join(distDir, 'build-info.json');
writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));

console.log(`Generated build info: ${JSON.stringify(buildInfo)}`);
