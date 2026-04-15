import { describe, expect, it } from 'vitest';
import { normalizeDriveQuery } from '../../src/server/drive-tools.js';

describe('normalizeDriveQuery', () => {
  // type: shorthand
  it('converts type:document to mimeType query', () => {
    expect(normalizeDriveQuery('type:document')).toBe(
      "mimeType='application/vnd.google-apps.document'",
    );
  });

  it('converts type:spreadsheet to mimeType query', () => {
    expect(normalizeDriveQuery('type:spreadsheet')).toBe(
      "mimeType='application/vnd.google-apps.spreadsheet'",
    );
  });

  it('converts type:pdf to mimeType query', () => {
    expect(normalizeDriveQuery('type:pdf')).toBe("mimeType='application/pdf'");
  });

  it('converts type:image to mimeType contains query', () => {
    expect(normalizeDriveQuery('type:image')).toBe("mimeType contains 'image/'");
  });

  it('converts type:video to mimeType contains query', () => {
    expect(normalizeDriveQuery('type:video')).toBe("mimeType contains 'video/'");
  });

  it('is case insensitive for type shorthand', () => {
    expect(normalizeDriveQuery('type:Document')).toBe(
      "mimeType='application/vnd.google-apps.document'",
    );
    expect(normalizeDriveQuery('TYPE:PDF')).toBe("mimeType='application/pdf'");
  });

  it('leaves unknown types as-is', () => {
    expect(normalizeDriveQuery('type:foobar')).toBe('type:foobar');
  });

  // content: shorthand
  it('converts content:keyword to fullText contains query', () => {
    expect(normalizeDriveQuery('content:budget')).toBe("fullText contains 'budget'");
  });

  it('converts content:keyword case insensitively', () => {
    expect(normalizeDriveQuery('CONTENT:report')).toBe("fullText contains 'report'");
  });

  it('handles content: with alphanumeric keywords', () => {
    expect(normalizeDriveQuery('content:Q4-2025')).toBe("fullText contains 'Q4-2025'");
  });

  // combined
  it('handles both type: and content: in one query', () => {
    const result = normalizeDriveQuery('type:document content:budget');
    expect(result).toBe(
      "mimeType='application/vnd.google-apps.document' fullText contains 'budget'",
    );
  });

  // passthrough
  it('passes raw Drive API queries through unchanged', () => {
    const raw = "name contains 'report' and trashed = false";
    expect(normalizeDriveQuery(raw)).toBe(raw);
  });

  it('passes fullText contains queries through unchanged', () => {
    const raw = "fullText contains 'quarterly'";
    expect(normalizeDriveQuery(raw)).toBe(raw);
  });
});
