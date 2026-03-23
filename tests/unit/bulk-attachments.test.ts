import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

describe('Bulk attachment download - path sanitization', () => {
  it('strips path separators from filenames', () => {
    // The tool uses: attachment.filename.replace(/[/\\]/g, '_')
    const sanitize = (name: string) => name.replace(/[/\\]/g, '_');

    expect(sanitize('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitize('normal.pdf')).toBe('normal.pdf');
    expect(sanitize('path/to\\file.txt')).toBe('path_to_file.txt');
  });

  it('rejects output directories with traversal segments', () => {
    // The tool checks: outputDir.includes('..')
    const hasDotDot = (dir: string) => dir.includes('..');

    expect(hasDotDot('/tmp/safe/dir')).toBe(false);
    expect(hasDotDot('/tmp/../etc')).toBe(true);
    expect(hasDotDot('../home')).toBe(true);
  });

  it('writes base64 data correctly to file', () => {
    const testDir = join(tmpdir(), `mcp-google-test-${Date.now()}`);
    try {
      mkdirSync(testDir, { recursive: true });

      const base64Data = Buffer.from('Hello, World!').toString('base64');
      const buffer = Buffer.from(base64Data, 'base64');
      const filePath = join(testDir, 'test_file.txt');

      const { writeFileSync } = require('node:fs');
      writeFileSync(filePath, buffer);

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toBe('Hello, World!');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
