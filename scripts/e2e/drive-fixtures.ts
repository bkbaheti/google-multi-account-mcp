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
