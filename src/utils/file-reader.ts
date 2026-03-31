import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FileReadResult {
  data: string; // base64-encoded
  sizeBytes: number;
}

export interface FileReadError {
  error: string;
}

/** Gmail hard limit: 25 MB */
export const GMAIL_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Reasonable guard for Drive simple uploads: 50 MB */
export const DRIVE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Read a file from disk and return its contents as base64.
 * Validates path safety, existence, type, and size before reading.
 */
export function readFileAsBase64(
  filePath: string,
  maxSizeBytes: number,
): FileReadResult | FileReadError {
  // 1. Reject path traversal
  if (filePath.includes('..')) {
    return { error: 'File path must not contain ".." path segments' };
  }

  // 2. Normalize
  const resolved = resolve(filePath);

  // 3. Existence check
  if (!existsSync(resolved)) {
    return { error: `File not found: ${resolved}` };
  }

  // 4. Must be a regular file
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    return { error: `Path is not a regular file: ${resolved}` };
  }

  // 5. Size check
  if (stat.size > maxSizeBytes) {
    const maxMB = (maxSizeBytes / (1024 * 1024)).toFixed(1);
    const actualMB = (stat.size / (1024 * 1024)).toFixed(1);
    return {
      error: `File too large: ${actualMB} MB exceeds ${maxMB} MB limit (${resolved})`,
    };
  }

  // 6. Read and encode
  const buffer = readFileSync(resolved);
  return {
    data: buffer.toString('base64'),
    sizeBytes: stat.size,
  };
}
