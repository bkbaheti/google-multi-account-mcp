import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFilesGet = vi.fn();
const mockFilesList = vi.fn();
const mockFilesCreate = vi.fn();
const mockFilesUpdate = vi.fn();
const mockFilesCopy = vi.fn();
const mockFilesExport = vi.fn();
const mockDrivesList = vi.fn();
const mockPermissionsCreate = vi.fn();
const mockPermissionsUpdate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      files: {
        get: mockFilesGet,
        list: mockFilesList,
        create: mockFilesCreate,
        update: mockFilesUpdate,
        copy: mockFilesCopy,
        export: mockFilesExport,
      },
      drives: {
        list: mockDrivesList,
      },
      permissions: {
        create: mockPermissionsCreate,
        update: mockPermissionsUpdate,
      },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import { DriveClient } from '../../src/drive/client.js';

describe('DriveClient — Shared Drive support', () => {
  let store: AccountStore;
  let client: DriveClient;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;
    client = new DriveClient(store, 'acct-1');
  });

  describe('searchFiles', () => {
    it('passes supportsAllDrives, includeItemsFromAllDrives, and corpora=allDrives by default', async () => {
      mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

      await client.searchFiles("name contains 'report'");

      expect(mockFilesList).toHaveBeenCalledTimes(1);
      const params = mockFilesList.mock.calls[0][0];
      expect(params.supportsAllDrives).toBe(true);
      expect(params.includeItemsFromAllDrives).toBe(true);
      expect(params.corpora).toBe('allDrives');
      expect(params.driveId).toBeUndefined();
    });

    it('switches to corpora=drive + driveId when driveId is provided', async () => {
      mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

      await client.searchFiles("name contains 'report'", { driveId: 'shared-drive-123' });

      const params = mockFilesList.mock.calls[0][0];
      expect(params.corpora).toBe('drive');
      expect(params.driveId).toBe('shared-drive-123');
      expect(params.supportsAllDrives).toBe(true);
      expect(params.includeItemsFromAllDrives).toBe(true);
    });

    it('returns the driveId field on files that live in a Shared Drive', async () => {
      mockFilesList.mockResolvedValueOnce({
        data: {
          files: [
            {
              id: 'f1',
              name: 'spec.md',
              mimeType: 'text/markdown',
              driveId: 'shared-drive-123',
            },
          ],
        },
      });

      const result = await client.searchFiles('name contains "spec"');
      expect(result.files[0]?.driveId).toBe('shared-drive-123');
    });
  });

  describe('listFiles', () => {
    it('forwards Shared Drive flags when listing the My Drive root', async () => {
      mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

      await client.listFiles();

      const params = mockFilesList.mock.calls[0][0];
      expect(params.q).toContain("'root' in parents");
      expect(params.supportsAllDrives).toBe(true);
      expect(params.includeItemsFromAllDrives).toBe(true);
    });

    it('treats a Shared Drive ID as the folderId for top-level listing', async () => {
      mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

      await client.listFiles('shared-drive-123');

      const params = mockFilesList.mock.calls[0][0];
      expect(params.q).toContain("'shared-drive-123' in parents");
      expect(params.supportsAllDrives).toBe(true);
      expect(params.includeItemsFromAllDrives).toBe(true);
    });
  });

  describe('listSharedDrives', () => {
    it('calls drives.list and converts the response', async () => {
      mockDrivesList.mockResolvedValueOnce({
        data: {
          drives: [
            { id: 'd1', name: 'Engineering', createdTime: '2024-01-01T00:00:00Z' },
            { id: 'd2', name: 'Finance' },
          ],
          nextPageToken: 'tok-123',
        },
      });

      const result = await client.listSharedDrives({ pageSize: 25 });

      expect(mockDrivesList).toHaveBeenCalledWith({
        pageSize: 25,
        fields: 'nextPageToken, drives(id, name, createdTime)',
      });
      expect(result.drives).toEqual([
        { id: 'd1', name: 'Engineering', createdTime: '2024-01-01T00:00:00Z' },
        { id: 'd2', name: 'Finance' },
      ]);
      expect(result.nextPageToken).toBe('tok-123');
    });

    it('uses a default page size and omits pageToken when not provided', async () => {
      mockDrivesList.mockResolvedValueOnce({ data: { drives: [] } });

      const result = await client.listSharedDrives();

      const params = mockDrivesList.mock.calls[0][0];
      expect(params.pageSize).toBe(50);
      expect(params.pageToken).toBeUndefined();
      expect(result.drives).toEqual([]);
      expect(result.nextPageToken).toBeUndefined();
    });
  });

  describe('supportsAllDrives is set on every mutating/read call', () => {
    it('getFile', async () => {
      mockFilesGet.mockResolvedValueOnce({ data: { id: 'f1', name: 'x', mimeType: 'text/plain' } });
      await client.getFile('f1');
      expect(mockFilesGet.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('createFolder', async () => {
      mockFilesCreate.mockResolvedValueOnce({
        data: { id: 'fold-1', name: 'New', mimeType: 'application/vnd.google-apps.folder' },
      });
      await client.createFolder('New', 'parent-1');
      expect(mockFilesCreate.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('uploadFile', async () => {
      mockFilesCreate.mockResolvedValueOnce({
        data: { id: 'f-up', name: 'a.txt', mimeType: 'text/plain' },
      });
      await client.uploadFile({ name: 'a.txt', content: 'hi', mimeType: 'text/plain' });
      expect(mockFilesCreate.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('moveFile', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: { id: 'f1', name: 'x', mimeType: 'text/plain', parents: ['old-parent'] },
      });
      mockFilesUpdate.mockResolvedValueOnce({
        data: { id: 'f1', name: 'x', mimeType: 'text/plain' },
      });
      await client.moveFile('f1', 'new-parent');
      expect(mockFilesUpdate.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('copyFile', async () => {
      mockFilesCopy.mockResolvedValueOnce({
        data: { id: 'f1-copy', name: 'x copy', mimeType: 'text/plain' },
      });
      await client.copyFile('f1', 'x copy');
      expect(mockFilesCopy.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('renameFile', async () => {
      mockFilesUpdate.mockResolvedValueOnce({
        data: { id: 'f1', name: 'renamed', mimeType: 'text/plain' },
      });
      await client.renameFile('f1', 'renamed');
      expect(mockFilesUpdate.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('trashFile', async () => {
      mockFilesUpdate.mockResolvedValueOnce({
        data: { id: 'f1', name: 'x', mimeType: 'text/plain', trashed: true },
      });
      await client.trashFile('f1');
      expect(mockFilesUpdate.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('shareFile', async () => {
      mockPermissionsCreate.mockResolvedValueOnce({
        data: { id: 'p1', type: 'user', role: 'reader', emailAddress: 'a@b.com' },
      });
      await client.shareFile('f1', { type: 'user', role: 'reader', emailAddress: 'a@b.com' });
      expect(mockPermissionsCreate.mock.calls[0][0].supportsAllDrives).toBe(true);
    });

    it('updatePermissions', async () => {
      mockPermissionsUpdate.mockResolvedValueOnce({
        data: { id: 'p1', type: 'user', role: 'writer' },
      });
      await client.updatePermissions('f1', 'p1', 'writer');
      expect(mockPermissionsUpdate.mock.calls[0][0].supportsAllDrives).toBe(true);
    });
  });
});
