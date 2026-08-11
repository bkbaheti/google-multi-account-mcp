import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFilesGet = vi.fn();
const mockFilesExport = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      files: {
        get: mockFilesGet,
        export: mockFilesExport,
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        copy: vi.fn(),
      },
      drives: { list: vi.fn() },
      permissions: { create: vi.fn(), update: vi.fn() },
      comments: { list: vi.fn() },
      replies: { list: vi.fn() },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import { DriveClient } from '../../src/drive/client.js';
import { ErrorCode, McpToolError } from '../../src/errors/index.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function toArrayBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function utf8ArrayBuffer(str: string): ArrayBuffer {
  const buf = Buffer.from(str, 'utf-8');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function mockDoc(name = 'SOW Contract'): void {
  mockFilesGet.mockResolvedValueOnce({
    data: { id: 'doc-1', name, mimeType: 'application/vnd.google-apps.document' },
  });
}

describe('DriveClient downloadFileToLocal — export format', () => {
  let store: AccountStore;
  let client: DriveClient;
  let outputDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;
    client = new DriveClient(store, 'acct-1');
    outputDir = mkdtempSync(join(tmpdir(), 'drive-export-'));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('forwards exportMimeType to files.export instead of the default text/plain', async () => {
    mockDoc();
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('docx bytes') });

    await client.downloadFileToLocal('doc-1', outputDir, undefined, DOCX_MIME);

    expect(mockFilesExport).toHaveBeenCalledTimes(1);
    expect(mockFilesExport.mock.calls[0][0]).toMatchObject({
      fileId: 'doc-1',
      mimeType: DOCX_MIME,
    });
  });

  it('derives a .docx extension from the wordprocessing export MIME type', async () => {
    mockDoc();
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('docx bytes') });

    const result = await client.downloadFileToLocal('doc-1', outputDir, undefined, DOCX_MIME);

    expect(result.fileName).toBe('SOW Contract.docx');
    expect(result.mimeType).toBe(DOCX_MIME);
  });

  it('writes binary export bytes to disk unchanged', async () => {
    // A real .docx is a ZIP — starts with PK\x03\x04 and contains non-UTF-8 bytes.
    const docxBytes = [0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x14];
    mockDoc();
    mockFilesExport.mockResolvedValueOnce({ data: toArrayBuffer(docxBytes) });

    const result = await client.downloadFileToLocal('doc-1', outputDir, undefined, DOCX_MIME);

    const written = readFileSync(result.filePath);
    expect(Array.from(written)).toEqual(docxBytes);
    expect(result.sizeBytes).toBe(docxBytes.length);
  });

  it('exports a Doc as PDF with a .pdf extension', async () => {
    mockDoc();
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('%PDF-1.4') });

    const result = await client.downloadFileToLocal(
      'doc-1',
      outputDir,
      undefined,
      'application/pdf',
    );

    expect(result.fileName).toBe('SOW Contract.pdf');
  });

  it('keeps the .txt default for a Doc when exportMimeType is omitted', async () => {
    mockDoc('Report');
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('plain text body') });

    const result = await client.downloadFileToLocal('doc-1', outputDir);

    expect(mockFilesExport.mock.calls[0][0].mimeType).toBe('text/plain');
    expect(result.fileName).toBe('Report.txt');
    expect(result.mimeType).toBe('text/plain');
    expect(readFileSync(result.filePath, 'utf-8')).toBe('plain text body');
  });

  it('keeps the .csv default for a Sheet when exportMimeType is omitted', async () => {
    mockFilesGet.mockResolvedValueOnce({
      data: { id: 'sheet-1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' },
    });
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('a,b\n1,2') });

    const result = await client.downloadFileToLocal('sheet-1', outputDir);

    expect(mockFilesExport.mock.calls[0][0].mimeType).toBe('text/csv');
    expect(result.fileName).toBe('Budget.csv');
  });

  // A Drawing's default export (image/png) is binary, so this path was silently
  // corrupting downloads before the export switched to an arraybuffer read.
  it('writes a Drawing default PNG export to disk byte-for-byte', async () => {
    const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x80];
    mockFilesGet.mockResolvedValueOnce({
      data: { id: 'draw-1', name: 'Diagram', mimeType: 'application/vnd.google-apps.drawing' },
    });
    mockFilesExport.mockResolvedValueOnce({ data: toArrayBuffer(pngBytes) });

    const result = await client.downloadFileToLocal('draw-1', outputDir);

    expect(mockFilesExport.mock.calls[0][0].mimeType).toBe('image/png');
    expect(result.fileName).toBe('Diagram.png');
    expect(Array.from(readFileSync(result.filePath))).toEqual(pngBytes);
  });

  it('lets an explicit fileName override the derived extension', async () => {
    mockDoc();
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('docx bytes') });

    const result = await client.downloadFileToLocal(
      'doc-1',
      outputDir,
      'contract-final.docx',
      DOCX_MIME,
    );

    expect(result.fileName).toBe('contract-final.docx');
  });

  it('derives the extension from the MIME subtype for formats outside the known table', async () => {
    mockFilesGet.mockResolvedValueOnce({
      data: { id: 'draw-1', name: 'Diagram', mimeType: 'application/vnd.google-apps.drawing' },
    });
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('<svg/>') });

    const result = await client.downloadFileToLocal(
      'draw-1',
      outputDir,
      undefined,
      'image/svg+xml',
    );

    expect(result.fileName).toBe('Diagram.svg');
  });

  it('falls back to a .bin extension for an unrecognized export MIME type', async () => {
    mockDoc('Weird');
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('data') });

    const result = await client.downloadFileToLocal(
      'doc-1',
      outputDir,
      undefined,
      'application/vnd.oasis.opendocument.text-master',
    );

    expect(result.fileName).toBe('Weird.bin');
  });

  it('rejects exportMimeType on a Drive folder, which cannot be exported', async () => {
    mockFilesGet.mockResolvedValueOnce({
      data: { id: 'fold-1', name: 'Contracts', mimeType: 'application/vnd.google-apps.folder' },
    });

    await expect(
      client.downloadFileToLocal('fold-1', outputDir, undefined, 'application/pdf'),
    ).rejects.toThrow(/folder/i);

    expect(mockFilesExport).not.toHaveBeenCalled();
  });

  it('rejects exportMimeType on a file that is not a Google Workspace file', async () => {
    mockFilesGet.mockResolvedValueOnce({
      data: { id: 'bin-1', name: 'photo.png', mimeType: 'image/png' },
    });

    await expect(
      client.downloadFileToLocal('bin-1', outputDir, undefined, DOCX_MIME),
    ).rejects.toThrow(/exportMimeType/);

    expect(mockFilesExport).not.toHaveBeenCalled();
  });

  // Both exportMimeType misuse cases must surface as a classifiable McpToolError
  // (VALIDATION_ERROR) rather than a bare Error, which toMcpError falls back to
  // classifying by substring match and can misfire into UNKNOWN_ERROR — or worse,
  // into an unrelated code if the message happens to contain a matched substring.
  it('surfaces the folder rejection as a VALIDATION_ERROR, not UNKNOWN_ERROR', async () => {
    mockFilesGet.mockResolvedValueOnce({
      data: { id: 'fold-1', name: 'Contracts', mimeType: 'application/vnd.google-apps.folder' },
    });

    const error: unknown = await client
      .downloadFileToLocal('fold-1', outputDir, undefined, 'application/pdf')
      .catch((e) => e);

    expect(error).toBeInstanceOf(McpToolError);
    expect((error as McpToolError).code).toBe(ErrorCode.VALIDATION_ERROR);
    // Guards against a message that happens to contain "not found", which
    // toMcpError's substring fallback would reclassify as a not-found error.
    expect((error as McpToolError).message).not.toMatch(/not found/i);
  });

  it('surfaces the non-Workspace-file rejection as a VALIDATION_ERROR, not UNKNOWN_ERROR', async () => {
    mockFilesGet.mockResolvedValueOnce({
      data: { id: 'bin-1', name: 'photo.png', mimeType: 'image/png' },
    });

    const error: unknown = await client
      .downloadFileToLocal('bin-1', outputDir, undefined, DOCX_MIME)
      .catch((e) => e);

    expect(error).toBeInstanceOf(McpToolError);
    expect((error as McpToolError).code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  // exportMimeType !== undefined is true for '', so the Workspace-file guards used
  // to run and pass for a Doc, then '' ?? EXPORT_MIME_TYPES[...] evaluated to '' —
  // nullish coalescing does not treat '' as absent — which is falsy, so control fell
  // through to the raw-media branch and called files.get({ alt: 'media' }) on a
  // Google Doc, which Drive rejects. An empty string must take the same default
  // export path as omitting the argument entirely.
  it('treats exportMimeType: "" as absent and takes the default text/plain export for a Doc', async () => {
    mockDoc('Report');
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('plain text body') });

    const result = await client.downloadFileToLocal('doc-1', outputDir, undefined, '');

    expect(mockFilesGet).toHaveBeenCalledTimes(1); // metadata only — no raw-media get
    expect(mockFilesExport.mock.calls[0][0].mimeType).toBe('text/plain');
    expect(result.fileName).toBe('Report.txt');
  });

  it('treats a whitespace-only exportMimeType as absent', async () => {
    mockDoc('Report');
    mockFilesExport.mockResolvedValueOnce({ data: utf8ArrayBuffer('plain text body') });

    const result = await client.downloadFileToLocal('doc-1', outputDir, undefined, '   ');

    expect(mockFilesExport.mock.calls[0][0].mimeType).toBe('text/plain');
    expect(result.fileName).toBe('Report.txt');
  });

  it('still downloads a regular binary file when exportMimeType is omitted', async () => {
    const bytes = [0x89, 0x50, 0x4e, 0x47];
    mockFilesGet
      .mockResolvedValueOnce({
        data: { id: 'bin-1', name: 'photo.png', mimeType: 'image/png' },
      })
      .mockResolvedValueOnce({ data: toArrayBuffer(bytes) });

    const result = await client.downloadFileToLocal('bin-1', outputDir);

    expect(result.fileName).toBe('photo.png');
    expect(Array.from(readFileSync(result.filePath))).toEqual(bytes);
  });
});
