import type { drive_v3 } from 'googleapis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTRACT_DOC_TEXT,
  createNativeDoc,
  createNativeSheet,
  FIXTURE_FOLDER_NAME,
  findChildByName,
  findFolderByName,
  findOrCreateFolder,
  QUOTED_SENTENCE,
  readBackQuotedText,
  seedAnchoredComment,
  tryCreateDrawing,
} from '../../scripts/e2e/drive-fixtures.js';

const mockFilesList = vi.fn();
const mockFilesCreate = vi.fn();
const mockCommentsCreate = vi.fn();
const mockCommentsList = vi.fn();

function fakeDrive(): drive_v3.Drive {
  return {
    files: { list: mockFilesList, create: mockFilesCreate },
    comments: { create: mockCommentsCreate, list: mockCommentsList },
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

describe('doc and comment seeding', () => {
  it('creates a native Google Doc by converting uploaded plain text', async () => {
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'doc-1' } });

    const id = await createNativeDoc(fakeDrive(), 'fold-1', 'e2e-fixture-contract', 'body text');

    expect(id).toBe('doc-1');
    const params = mockFilesCreate.mock.calls[0][0];
    // The conversion only happens when the two MIME types differ.
    expect(params.requestBody.mimeType).toBe('application/vnd.google-apps.document');
    expect(params.media.mimeType).toBe('text/plain');
    expect(params.requestBody.parents).toEqual(['fold-1']);
  });

  it('quotes a sentence that actually appears in the fixture body', () => {
    expect(CONTRACT_DOC_TEXT).toContain(QUOTED_SENTENCE);
  });

  it('sends both an anchor and quotedFileContent when seeding a comment', async () => {
    mockCommentsCreate.mockResolvedValueOnce({ data: { id: 'c1' } });

    const id = await seedAnchoredComment(fakeDrive(), 'doc-1', 'unlimited liability', 'Too broad.');

    expect(id).toBe('c1');
    const params = mockCommentsCreate.mock.calls[0][0];
    expect(params.fileId).toBe('doc-1');
    expect(params.requestBody.content).toBe('Too broad.');
    expect(params.requestBody.quotedFileContent.value).toBe('unlimited liability');
    expect(params.requestBody.anchor).toBeTypeOf('string');
    expect(params.fields).toContain('id');
  });

  it('reads back the quoted text Drive actually stored', async () => {
    mockCommentsList.mockResolvedValueOnce({
      data: {
        comments: [{ id: 'c1', quotedFileContent: { value: 'unlimited liability' } }],
      },
    });

    const quoted = await readBackQuotedText(fakeDrive(), 'doc-1', 'c1');

    expect(quoted).toBe('unlimited liability');
    expect(mockCommentsList.mock.calls[0][0].fields).toContain('quotedFileContent');
  });

  it('reports undefined when Drive dropped the quoted text', async () => {
    mockCommentsList.mockResolvedValueOnce({ data: { comments: [{ id: 'c1' }] } });

    expect(await readBackQuotedText(fakeDrive(), 'doc-1', 'c1')).toBeUndefined();
  });
});

describe('sheet and drawing fixtures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a native Sheet by converting uploaded CSV', async () => {
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'sheet-1' } });

    const id = await createNativeSheet(fakeDrive(), 'fold-1', 'e2e-fixture-sheet', 'a,b\n1,2');

    expect(id).toBe('sheet-1');
    const params = mockFilesCreate.mock.calls[0][0];
    expect(params.requestBody.mimeType).toBe('application/vnd.google-apps.spreadsheet');
    expect(params.media.mimeType).toBe('text/csv');
  });

  it('creates a blank Drawing with no media body', async () => {
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'draw-1' } });

    const id = await tryCreateDrawing(fakeDrive(), 'fold-1', 'e2e-fixture-drawing');

    expect(id).toBe('draw-1');
    const params = mockFilesCreate.mock.calls[0][0];
    expect(params.requestBody.mimeType).toBe('application/vnd.google-apps.drawing');
    expect(params.media).toBeUndefined();
  });

  it('returns null instead of throwing when Drive refuses to create a Drawing', async () => {
    mockFilesCreate.mockRejectedValueOnce(new Error('Bad Request'));

    expect(await tryCreateDrawing(fakeDrive(), 'fold-1', 'e2e-fixture-drawing')).toBeNull();
  });
});
