import type { drive_v3 } from 'googleapis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_FOLDER_NAME,
  findChildByName,
  findFolderByName,
  findOrCreateFolder,
} from '../../scripts/e2e/drive-fixtures.js';

const mockFilesList = vi.fn();
const mockFilesCreate = vi.fn();

function fakeDrive(): drive_v3.Drive {
  return {
    files: { list: mockFilesList, create: mockFilesCreate },
  } as unknown as drive_v3.Drive;
}

describe('e2e drive fixtures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a fixture folder name that reads as off-limits', () => {
    expect(FIXTURE_FOLDER_NAME).toBe('__MCP-E2E-FIXTURES — DO NOT DELETE__');
  });

  it('finds an existing folder by exact name, excluding trashed ones', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [{ id: 'fold-1' }] } });

    const id = await findFolderByName(fakeDrive(), FIXTURE_FOLDER_NAME);

    expect(id).toBe('fold-1');
    const query = mockFilesList.mock.calls[0][0].q as string;
    expect(query).toContain('trashed = false');
    expect(query).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(query).toContain(FIXTURE_FOLDER_NAME);
  });

  it('returns null when no folder matches', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

    expect(await findFolderByName(fakeDrive(), FIXTURE_FOLDER_NAME)).toBeNull();
  });

  it('reuses an existing folder rather than creating a duplicate', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [{ id: 'fold-1' }] } });

    const result = await findOrCreateFolder(fakeDrive(), FIXTURE_FOLDER_NAME);

    expect(result).toEqual({ id: 'fold-1', created: false });
    expect(mockFilesCreate).not.toHaveBeenCalled();
  });

  it('creates the folder when it is missing', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'fold-new' } });

    const result = await findOrCreateFolder(fakeDrive(), FIXTURE_FOLDER_NAME);

    expect(result).toEqual({ id: 'fold-new', created: true });
    expect(mockFilesCreate.mock.calls[0][0].requestBody).toEqual({
      name: FIXTURE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    });
  });

  it('escapes single quotes in names so the Drive query cannot break', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

    await findFolderByName(fakeDrive(), "Bob's Folder");

    expect(mockFilesList.mock.calls[0][0].q as string).toContain("Bob\\'s Folder");
  });

  it('scopes a child lookup to the parent folder', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [{ id: 'doc-1' }] } });

    const id = await findChildByName(fakeDrive(), 'fold-1', 'e2e-fixture-contract');

    expect(id).toBe('doc-1');
    expect(mockFilesList.mock.calls[0][0].q as string).toContain("'fold-1' in parents");
  });
});
