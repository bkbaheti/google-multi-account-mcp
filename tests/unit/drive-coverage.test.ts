import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability, CapabilityGate } from '../../src/auth/capabilities.js';
import type { AccountStore } from '../../src/auth/index.js';
import { registerDriveTools } from '../../src/server/drive-tools.js';

// registerDriveTools always constructs its own `new DriveClient(...)`, so the
// only way to control what a handler sees is to mock the client module
// itself and hand every instance the same jest.fn()s.
const mockSearchFiles = vi.fn();
const mockListFiles = vi.fn();
const mockGetFile = vi.fn();
const mockGetFileContent = vi.fn();
const mockGetComments = vi.fn();
const mockGetCommentReplies = vi.fn();
const mockDownloadFileToLocal = vi.fn();

vi.mock('../../src/drive/index.js', () => ({
  DriveClient: vi.fn().mockImplementation(function DriveClient() {
    return {
      searchFiles: mockSearchFiles,
      listFiles: mockListFiles,
      getFile: mockGetFile,
      getFileContent: mockGetFileContent,
      getComments: mockGetComments,
      getCommentReplies: mockGetCommentReplies,
      downloadFileToLocal: mockDownloadFileToLocal,
    };
  }),
}));

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

/**
 * Register every Drive tool against a fake McpServer (capturing handlers
 * instead of talking to a real MCP transport) and a fake validateAccountScope
 * that always succeeds, handing every handler an account holding exactly
 * `scopes`. Real gating is covered by tests/unit/gate-mapping.test.ts; this
 * suite is only about what a handler does with the account it's given.
 */
function registerWithScopes(scopes: string[]): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;

  const validateAccountScope = (
    _accountId: string,
    _required: Capability | CapabilityGate,
  ) => ({ account: { scopes } });

  registerDriveTools(server, {} as AccountStore, validateAccountScope);

  return handlers;
}

async function bodyOf(handler: ToolHandler, args: Record<string, unknown>): Promise<any> {
  const response = await handler({ accountId: 'acct-1', ...args });
  expect(response.isError).toBeFalsy();
  return JSON.parse(response.content[0]!.text);
}

describe('Drive coverage annotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('drive:appfiles only', () => {
    const scopes = [DRIVE_FILE_SCOPE];

    it('annotates a NON-EMPTY search result with coverage', async () => {
      mockSearchFiles.mockResolvedValueOnce({
        files: [
          { id: 'f1', name: 'contract.docx' },
          { id: 'f2', name: 'contract-v2.docx' },
        ],
      });
      const handlers = registerWithScopes(scopes);

      const body = await bodyOf(handlers['drive_search_files']!, { query: 'name contains \'contract\'' });

      expect(body.files).toHaveLength(2);
      expect(body.coverage).toEqual({
        scope: 'app-created-only',
        explanation: expect.stringContaining('Files this server created'),
      });
    });

    it('also annotates an empty search result (not only the empty case)', async () => {
      mockSearchFiles.mockResolvedValueOnce({ files: [] });
      const handlers = registerWithScopes(scopes);

      const body = await bodyOf(handlers['drive_search_files']!, { query: 'q' });

      expect(body.files).toEqual([]);
      expect(body.coverage.scope).toBe('app-created-only');
    });

    it('puts `warning` as the literal first key of a list response', async () => {
      mockListFiles.mockResolvedValueOnce({ files: [{ id: 'f1', name: 'doc.txt' }] });
      const handlers = registerWithScopes(scopes);

      const body = await bodyOf(handlers['drive_list_files']!, {});

      expect(Object.keys(body)[0]).toBe('warning');
      expect(typeof body.warning).toBe('string');
      expect(body.warning.length).toBeGreaterThan(0);
    });

    it('puts `warning` first on comment list responses too', async () => {
      mockGetComments.mockResolvedValueOnce({ comments: [{ id: 'c1', content: 'hi' }] });
      const handlers = registerWithScopes(scopes);

      const body = await bodyOf(handlers['drive_get_comments']!, { fileId: 'f1' });

      expect(Object.keys(body)[0]).toBe('warning');
    });

    it('annotates single-resource responses (get_file) with coverage but no warning key', async () => {
      mockGetFile.mockResolvedValueOnce({ id: 'f1', name: 'doc.txt' });
      const handlers = registerWithScopes(scopes);

      const body = await bodyOf(handlers['drive_get_file']!, { fileId: 'f1' });

      expect(body.coverage.scope).toBe('app-created-only');
      expect(body.warning).toBeUndefined();
    });
  });

  describe('drive:read (with or without drive:appfiles)', () => {
    it('gets NO coverage block on a search result when the account holds drive:read', async () => {
      mockSearchFiles.mockResolvedValueOnce({ files: [{ id: 'f1', name: 'doc.txt' }] });
      const handlers = registerWithScopes([DRIVE_READONLY_SCOPE]);

      const body = await bodyOf(handlers['drive_search_files']!, { query: 'q' });

      expect(body.coverage).toBeUndefined();
      expect(body.warning).toBeUndefined();
    });

    it('gets NO coverage block when the account holds BOTH drive:read and drive:appfiles', async () => {
      mockSearchFiles.mockResolvedValueOnce({ files: [{ id: 'f1', name: 'doc.txt' }] });
      const handlers = registerWithScopes([DRIVE_READONLY_SCOPE, DRIVE_FILE_SCOPE]);

      const body = await bodyOf(handlers['drive_search_files']!, { query: 'q' });

      expect(body.coverage).toBeUndefined();
      expect(body.warning).toBeUndefined();
    });

    it('gets no coverage block on drive_list_files either', async () => {
      mockListFiles.mockResolvedValueOnce({ files: [] });
      const handlers = registerWithScopes([DRIVE_READONLY_SCOPE]);

      const body = await bodyOf(handlers['drive_list_files']!, {});

      expect(body.coverage).toBeUndefined();
      expect(Object.keys(body)[0]).not.toBe('warning');
    });
  });
});
