import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileAsBase64 } from '../../src/utils/index.js';

describe('readFileAsBase64', () => {
  const testDir = join(tmpdir(), `file-reader-test-${Date.now()}`);
  const testContent = 'Hello, this is test content for file-reader!';
  const testFilePath = join(testDir, 'test-file.txt');
  const emptyFilePath = join(testDir, 'empty-file.txt');
  const largeFilePath = join(testDir, 'large-file.bin');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFilePath, testContent);
    writeFileSync(emptyFilePath, '');
    // 200 bytes — used for size limit tests
    writeFileSync(largeFilePath, Buffer.alloc(200, 0x42));
  });

  afterAll(() => {
    // Cleanup is best-effort; OS cleans tmpdir eventually
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('reads a file and returns base64 with correct size', () => {
    const result = readFileAsBase64(testFilePath, 1024 * 1024);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const decoded = Buffer.from(result.data, 'base64').toString('utf-8');
      expect(decoded).toBe(testContent);
      expect(result.sizeBytes).toBe(Buffer.byteLength(testContent));
    }
  });

  it('handles empty files', () => {
    const result = readFileAsBase64(emptyFilePath, 1024);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.data).toBe('');
      expect(result.sizeBytes).toBe(0);
    }
  });

  it('rejects paths with path traversal', () => {
    const result = readFileAsBase64('../etc/passwd', 1024 * 1024);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('..');
    }
  });

  it('returns error for non-existent file', () => {
    const result = readFileAsBase64(join(testDir, 'does-not-exist.txt'), 1024 * 1024);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('File not found');
    }
  });

  it('rejects directory paths', () => {
    const result = readFileAsBase64(testDir, 1024 * 1024);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('not a regular file');
    }
  });

  it('rejects files exceeding size limit', () => {
    const result = readFileAsBase64(largeFilePath, 100);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('too large');
    }
  });

  it('accepts files within size limit', () => {
    const result = readFileAsBase64(largeFilePath, 1024);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.sizeBytes).toBe(200);
    }
  });
});
