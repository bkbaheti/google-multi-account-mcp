import type { drive_v3 } from 'googleapis';

/** Deliberately shouty so it reads as off-limits when browsing Drive. */
export const FIXTURE_FOLDER_NAME = '__MCP-E2E-FIXTURES — DO NOT DELETE__';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Drive query strings are single-quoted, so a literal quote has to be escaped. */
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function findFolderByName(
  drive: drive_v3.Drive,
  name: string,
): Promise<string | null> {
  const response = await drive.files.list({
    q: `name = '${escapeQueryValue(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  return response.data.files?.[0]?.id ?? null;
}

export async function createFolder(drive: drive_v3.Drive, name: string): Promise<string> {
  const response = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: 'id',
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating folder "${name}"`);
  }

  return id;
}

export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findFolderByName(drive, name);
  if (existing) {
    return { id: existing, created: false };
  }

  return { id: await createFolder(drive, name), created: true };
}

export async function findChildByName(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
): Promise<string | null> {
  const response = await drive.files.list({
    q: `name = '${escapeQueryValue(name)}' and '${folderId}' in parents and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  return response.data.files?.[0]?.id ?? null;
}

export const CONTRACT_DOC_NAME = 'e2e-fixture-contract';

/** The sentence a seeded comment anchors to. Must appear verbatim in CONTRACT_DOC_TEXT. */
export const QUOTED_SENTENCE = 'unlimited liability';

export const CONTRACT_DOC_TEXT = [
  'STATEMENT OF WORK (E2E FIXTURE — DO NOT EDIT)',
  '',
  '1. Scope. Supplier will deliver the services described in Schedule A.',
  `2. Liability. Supplier accepts ${QUOTED_SENTENCE} for any loss arising from the services.`,
  '3. Term. This agreement runs for twelve months from the effective date.',
  '',
  'This document exists only to exercise the MCP end-to-end suite.',
].join('\n');

/**
 * Create a native Google Doc. Drive converts on upload only when the target type
 * (requestBody.mimeType) differs from the uploaded media type — which is exactly
 * what drive_upload_file cannot express today.
 */
export async function createNativeDoc(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
  text: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    media: { mimeType: 'text/plain', body: text },
    fields: 'id',
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating Doc "${name}"`);
  }

  return id;
}

/**
 * Attempt an anchored comment. Whether Drive honours an API-supplied anchor and
 * returns quotedFileContent is the open question this fixture resolves — always
 * confirm with readBackQuotedText rather than trusting the create call.
 */
export async function seedAnchoredComment(
  drive: drive_v3.Drive,
  fileId: string,
  quoted: string,
  body: string,
): Promise<string> {
  const response = await drive.comments.create({
    fileId,
    fields: 'id, quotedFileContent(value)',
    requestBody: {
      content: body,
      anchor: JSON.stringify({ r: 'head', a: [{ txt: { o: 0, l: quoted.length } }] }),
      quotedFileContent: { mimeType: 'text/plain', value: quoted },
    },
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating a comment on ${fileId}`);
  }

  return id;
}

export async function readBackQuotedText(
  drive: drive_v3.Drive,
  fileId: string,
  commentId: string,
): Promise<string | undefined> {
  const response = await drive.comments.list({
    fileId,
    fields: 'comments(id,quotedFileContent(value))',
    includeDeleted: false,
    pageSize: 100,
  });

  const match = response.data.comments?.find((c) => c.id === commentId);
  return match?.quotedFileContent?.value ?? undefined;
}

/**
 * Verify (rather than assume) that a file already carries an anchored comment
 * quoting the given text — used on the reuse path, where the seeder has no
 * comment id to look up because it didn't just create the comment itself.
 * This also lets a comment added by hand (the ACTION NEEDED fallback) be
 * picked up on the next run, the same way findOrCreateFolder picks up a
 * folder someone created outside the seeder.
 */
export async function hasAnchoredComment(
  drive: drive_v3.Drive,
  fileId: string,
  quoted: string,
): Promise<boolean> {
  const response = await drive.comments.list({
    fileId,
    fields: 'comments(quotedFileContent(value))',
    includeDeleted: false,
    pageSize: 100,
  });

  return (response.data.comments ?? []).some((c) => c.quotedFileContent?.value === quoted);
}

export const SHEET_NAME = 'e2e-fixture-sheet';
export const DRAWING_NAME = 'e2e-fixture-drawing';

export const SHEET_CSV = 'item,qty,unit_price\nwidget,4,25\ngadget,2,60\n';

export async function createNativeSheet(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
  csv: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    media: { mimeType: 'text/csv', body: csv },
    fields: 'id',
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating Sheet "${name}"`);
  }

  return id;
}

/**
 * A Drawing exports to image/png by default, making it the only fixture that
 * exercises the binary export path. Whether Drive will create a blank one via the
 * API is unverified — return null on refusal so the caller can fall back to asking
 * the user to create it by hand once.
 */
export async function tryCreateDrawing(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
): Promise<string | null> {
  try {
    const response = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId],
        mimeType: 'application/vnd.google-apps.drawing',
      },
      fields: 'id',
    });

    return response.data.id ?? null;
  } catch (error) {
    // Surface why Drive refused — swallowing it silently would leave the
    // operator with "FAILED" and no way to tell a scope problem from an
    // unsupported operation.
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`  drawing   Drive refused to create a blank Drawing: ${detail}`);
    return null;
  }
}
