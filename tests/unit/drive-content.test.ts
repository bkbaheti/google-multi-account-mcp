import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFilesGet = vi.fn();
const mockFilesExport = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      files: {
        get: mockFilesGet,
        export: mockFilesExport,
        create: vi.fn(),
        list: vi.fn(),
      },
      permissions: {
        create: vi.fn(),
        update: vi.fn(),
      },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import { DriveClient } from '../../src/drive/client.js';

/** Create an ArrayBuffer that is NOT backed by Node's shared Buffer pool */
function toArrayBuffer(str: string): ArrayBuffer {
  const buf = Buffer.from(str, 'utf-8');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function toArrayBufferFromBytes(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('DriveClient getFileContent', () => {
  let mockAccountStore: AccountStore;
  let client: DriveClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAccountStore = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;

    client = new DriveClient(mockAccountStore, 'test-account-id');
  });

  describe('text file truncation', () => {
    const longText = 'a'.repeat(20_000);

    it('truncates text content when maxChars is set', async () => {
      mockFilesGet
        .mockResolvedValueOnce({
          data: { id: 'file-1', name: 'big.txt', mimeType: 'text/plain' },
        })
        .mockResolvedValueOnce({
          data: toArrayBuffer(longText),
        });

      const result = await client.getFileContent('file-1', { maxChars: 100 });

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(100);
      expect(result.totalSize).toBe(20_000);
      expect(result.fileName).toBe('big.txt');
      expect(result.encoding).toBe('utf-8');
    });

    it('does not truncate when maxChars is not set', async () => {
      mockFilesGet
        .mockResolvedValueOnce({
          data: { id: 'file-1', name: 'big.txt', mimeType: 'text/plain' },
        })
        .mockResolvedValueOnce({
          data: toArrayBuffer(longText),
        });

      const result = await client.getFileContent('file-1');

      expect(result.truncated).toBe(false);
      expect(result.content.length).toBe(20_000);
      expect(result.totalSize).toBe(20_000);
    });

    it('does not truncate when content is shorter than maxChars', async () => {
      mockFilesGet
        .mockResolvedValueOnce({
          data: { id: 'file-1', name: 'small.txt', mimeType: 'text/plain' },
        })
        .mockResolvedValueOnce({
          data: toArrayBuffer('hello'),
        });

      const result = await client.getFileContent('file-1', { maxChars: 10_000 });

      expect(result.truncated).toBe(false);
      expect(result.content).toBe('hello');
      expect(result.totalSize).toBe(5);
    });
  });

  describe('Google Workspace file truncation', () => {
    const longDoc = 'b'.repeat(15_000);

    it('truncates exported Workspace content when maxChars is set', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: {
          id: 'doc-1',
          name: 'Report',
          mimeType: 'application/vnd.google-apps.document',
        },
      });
      mockFilesExport.mockResolvedValueOnce({ data: longDoc });

      const result = await client.getFileContent('doc-1', { maxChars: 500 });

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(500);
      expect(result.totalSize).toBe(15_000);
      expect(result.mimeType).toBe('text/plain');
      expect(result.fileName).toBe('Report');
    });

    it('does not truncate exported content when maxChars is not set', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: {
          id: 'doc-1',
          name: 'Report',
          mimeType: 'application/vnd.google-apps.document',
        },
      });
      mockFilesExport.mockResolvedValueOnce({ data: longDoc });

      const result = await client.getFileContent('doc-1');

      expect(result.truncated).toBe(false);
      expect(result.content.length).toBe(15_000);
    });
  });

  describe('binary files', () => {
    it('returns base64 without truncation regardless of maxChars', async () => {
      const bytes = [0x00, 0x01, 0x02, 0xff, 0xfe];

      mockFilesGet
        .mockResolvedValueOnce({
          data: { id: 'bin-1', name: 'photo.png', mimeType: 'image/png' },
        })
        .mockResolvedValueOnce({
          data: toArrayBufferFromBytes(bytes),
        });

      const result = await client.getFileContent('bin-1', { maxChars: 2 });

      expect(result.truncated).toBe(false);
      expect(result.encoding).toBe('base64');
      expect(result.content).toBe(Buffer.from(bytes).toString('base64'));
      expect(result.fileName).toBe('photo.png');
    });
  });

  describe('JSON files', () => {
    it('treats application/json as text and truncates', async () => {
      const json = JSON.stringify({ data: 'x'.repeat(5000) });

      mockFilesGet
        .mockResolvedValueOnce({
          data: { id: 'json-1', name: 'data.json', mimeType: 'application/json' },
        })
        .mockResolvedValueOnce({
          data: toArrayBuffer(json),
        });

      const result = await client.getFileContent('json-1', { maxChars: 100 });

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(100);
      expect(result.encoding).toBe('utf-8');
    });
  });

  describe('response metadata', () => {
    it('includes fileName, totalSize, encoding in all responses', async () => {
      mockFilesGet
        .mockResolvedValueOnce({
          data: { id: 'f1', name: 'test.csv', mimeType: 'text/csv' },
        })
        .mockResolvedValueOnce({
          data: toArrayBuffer('a,b,c\n1,2,3'),
        });

      const result = await client.getFileContent('f1', { maxChars: 10_000 });

      expect(result).toHaveProperty('fileName', 'test.csv');
      expect(result).toHaveProperty('totalSize');
      expect(result).toHaveProperty('truncated');
      expect(result).toHaveProperty('encoding');
      expect(result).toHaveProperty('mimeType');
      expect(result).toHaveProperty('content');
    });
  });
});
