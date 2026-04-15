import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { type drive_v3, google } from 'googleapis';
import type { AccountStore } from '../auth/index.js';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  owners?: Array<{ emailAddress: string; displayName?: string }>;
  shared?: boolean;
  trashed?: boolean;
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface DrivePermission {
  id?: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  domain?: string;
  displayName?: string;
}

const FILE_FIELDS =
  'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed';

// Google Workspace MIME type export mappings
const EXPORT_MIME_TYPES: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'text/plain', extension: 'txt' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'text/csv', extension: 'csv' },
  'application/vnd.google-apps.presentation': { mimeType: 'text/plain', extension: 'txt' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: 'png' },
};

export class DriveClient {
  private readonly accountStore: AccountStore;
  private readonly accountId: string;
  private drive: drive_v3.Drive | null = null;

  constructor(accountStore: AccountStore, accountId: string) {
    this.accountStore = accountStore;
    this.accountId = accountId;
  }

  private async getDrive(): Promise<drive_v3.Drive> {
    if (!this.drive) {
      const auth = await this.accountStore.getAuthenticatedClient(this.accountId);
      this.drive = google.drive({ version: 'v3', auth });
    }
    return this.drive;
  }

  // === Read methods ===

  async searchFiles(
    query: string,
    options: {
      maxResults?: number;
      pageToken?: string;
      orderBy?: string;
    } = {},
  ): Promise<DriveFileList> {
    const drive = await this.getDrive();

    const params: drive_v3.Params$Resource$Files$List = {
      q: query,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: options.maxResults ?? 20,
    };

    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }
    if (options.orderBy) {
      params.orderBy = options.orderBy;
    }

    const response = await drive.files.list(params);

    const files: DriveFile[] = (response.data.files ?? []).map((f) => this.convertFile(f));

    const result: DriveFileList = { files };

    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }

    return result;
  }

  async listFiles(
    folderId?: string,
    options: {
      maxResults?: number;
      pageToken?: string;
      orderBy?: string;
    } = {},
  ): Promise<DriveFileList> {
    const parentQuery = folderId ? `'${folderId}' in parents` : "'root' in parents";
    const query = `${parentQuery} and trashed = false`;
    return this.searchFiles(query, options);
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.get({
      fileId,
      fields: FILE_FIELDS,
    });

    return this.convertFile(response.data);
  }

  async getFileContent(
    fileId: string,
    options: { maxChars?: number } = {},
  ): Promise<{
    content: string;
    mimeType: string;
    fileName: string;
    totalSize: number;
    truncated: boolean;
    encoding: 'utf-8' | 'base64';
  }> {
    const drive = await this.getDrive();
    const maxChars = options.maxChars;

    // First get file metadata to determine type
    const file = await this.getFile(fileId);
    const exportMapping = EXPORT_MIME_TYPES[file.mimeType];

    if (exportMapping) {
      // Google Workspace file: export it
      const response = await drive.files.export({
        fileId,
        mimeType: exportMapping.mimeType,
      });

      const full = String(response.data);
      const truncated = maxChars !== undefined && full.length > maxChars;
      return {
        content: truncated ? full.slice(0, maxChars) : full,
        mimeType: exportMapping.mimeType,
        fileName: file.name,
        totalSize: full.length,
        truncated,
        encoding: 'utf-8',
      };
    }

    // Regular file: download it
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);

    // Text files: return as utf-8
    if (
      file.mimeType.startsWith('text/') ||
      file.mimeType === 'application/json' ||
      file.mimeType === 'application/xml'
    ) {
      const full = buffer.toString('utf-8');
      const truncated = maxChars !== undefined && full.length > maxChars;
      return {
        content: truncated ? full.slice(0, maxChars) : full,
        mimeType: file.mimeType,
        fileName: file.name,
        totalSize: full.length,
        truncated,
        encoding: 'utf-8',
      };
    }

    // Binary files: return as base64 (no truncation — use drive_download_file instead)
    const b64 = buffer.toString('base64');
    return {
      content: b64,
      mimeType: file.mimeType,
      fileName: file.name,
      totalSize: buffer.length,
      truncated: false,
      encoding: 'base64',
    };
  }

  async downloadFileToLocal(
    fileId: string,
    outputDir: string,
    fileName?: string,
  ): Promise<{ filePath: string; fileName: string; mimeType: string; sizeBytes: number }> {
    const drive = await this.getDrive();

    // Validate output directory path
    if (outputDir.includes('..')) {
      throw new Error('Output directory must not contain ".." path segments');
    }

    const resolvedDir = resolve(outputDir);
    mkdirSync(resolvedDir, { recursive: true });

    // Get file metadata
    const file = await this.getFile(fileId);
    const exportMapping = EXPORT_MIME_TYPES[file.mimeType];

    let buffer: Buffer;
    let mimeType: string;
    let outputFileName: string;

    if (exportMapping) {
      // Google Workspace file: export it
      const response = await drive.files.export({
        fileId,
        mimeType: exportMapping.mimeType,
      });

      buffer = Buffer.from(String(response.data), 'utf-8');
      mimeType = exportMapping.mimeType;
      // Use provided name or derive from file name + export extension
      outputFileName = fileName ?? `${file.name}.${exportMapping.extension}`;
    } else {
      // Regular file: download it
      const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );

      buffer = Buffer.from(response.data as ArrayBuffer);
      mimeType = file.mimeType;
      outputFileName = fileName ?? file.name;
    }

    // Sanitize filename (strip path separators)
    const safeName = basename(outputFileName).replace(/[/\\]/g, '_');
    const filePath = join(resolvedDir, safeName);

    writeFileSync(filePath, buffer);

    return {
      filePath,
      fileName: safeName,
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  // === Write methods ===

  async uploadFile(input: {
    name: string;
    content: string;
    mimeType: string;
    parentFolderId?: string;
    isBase64?: boolean;
  }): Promise<DriveFile> {
    const drive = await this.getDrive();

    const buffer = input.isBase64
      ? Buffer.from(input.content, 'base64')
      : Buffer.from(input.content, 'utf-8');

    const requestBody: drive_v3.Schema$File = {
      name: input.name,
      mimeType: input.mimeType,
    };

    if (input.parentFolderId) {
      requestBody.parents = [input.parentFolderId];
    }

    const response = await drive.files.create({
      requestBody,
      media: {
        mimeType: input.mimeType,
        body: Readable.from(buffer),
      },
      fields: FILE_FIELDS,
    });

    return this.convertFile(response.data);
  }

  async createFolder(name: string, parentFolderId?: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const requestBody: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentFolderId) {
      requestBody.parents = [parentFolderId];
    }

    const response = await drive.files.create({
      requestBody,
      fields: FILE_FIELDS,
    });

    return this.convertFile(response.data);
  }

  async moveFile(fileId: string, newParentId: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    // Get current parents to remove
    const file = await this.getFile(fileId);
    const previousParents = (file.parents ?? []).join(',');

    const response = await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: previousParents,
      fields: FILE_FIELDS,
    });

    return this.convertFile(response.data);
  }

  async copyFile(fileId: string, name?: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const requestBody: drive_v3.Schema$File = {};
    if (name) {
      requestBody.name = name;
    }

    const response = await drive.files.copy({
      fileId,
      requestBody,
      fields: FILE_FIELDS,
    });

    return this.convertFile(response.data);
  }

  async renameFile(fileId: string, name: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.update({
      fileId,
      requestBody: { name },
      fields: FILE_FIELDS,
    });

    return this.convertFile(response.data);
  }

  async trashFile(fileId: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: FILE_FIELDS,
    });

    return this.convertFile(response.data);
  }

  // === Sharing methods ===

  async shareFile(
    fileId: string,
    permission: Omit<DrivePermission, 'id'>,
    sendNotification?: boolean,
  ): Promise<DrivePermission> {
    const drive = await this.getDrive();

    const requestBody: drive_v3.Schema$Permission = {
      type: permission.type,
      role: permission.role,
    };

    if (permission.emailAddress) {
      requestBody.emailAddress = permission.emailAddress;
    }
    if (permission.domain) {
      requestBody.domain = permission.domain;
    }

    const response = await drive.permissions.create({
      fileId,
      requestBody,
      sendNotificationEmail: sendNotification ?? false,
      fields: 'id, type, role, emailAddress, domain, displayName',
    });

    return this.convertPermission(response.data);
  }

  async updatePermissions(
    fileId: string,
    permissionId: string,
    role: DrivePermission['role'],
  ): Promise<DrivePermission> {
    const drive = await this.getDrive();

    const response = await drive.permissions.update({
      fileId,
      permissionId,
      requestBody: { role },
      fields: 'id, type, role, emailAddress, domain, displayName',
    });

    return this.convertPermission(response.data);
  }

  // === Private converter methods ===

  private convertFile(f: drive_v3.Schema$File): DriveFile {
    const result: DriveFile = {
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
    };

    if (f.size) {
      result.size = f.size;
    }
    if (f.createdTime) {
      result.createdTime = f.createdTime;
    }
    if (f.modifiedTime) {
      result.modifiedTime = f.modifiedTime;
    }
    if (f.parents) {
      result.parents = f.parents;
    }
    if (f.webViewLink) {
      result.webViewLink = f.webViewLink;
    }
    if (f.owners) {
      result.owners = f.owners.map((o) => {
        const owner: { emailAddress: string; displayName?: string } = {
          emailAddress: o.emailAddress ?? '',
        };
        if (o.displayName) {
          owner.displayName = o.displayName;
        }
        return owner;
      });
    }
    if (f.shared !== undefined && f.shared !== null) {
      result.shared = f.shared;
    }
    if (f.trashed !== undefined && f.trashed !== null) {
      result.trashed = f.trashed;
    }

    return result;
  }

  private convertPermission(p: drive_v3.Schema$Permission): DrivePermission {
    const result: DrivePermission = {
      type: (p.type as DrivePermission['type']) ?? 'anyone',
      role: (p.role as DrivePermission['role']) ?? 'reader',
    };

    if (p.id) {
      result.id = p.id;
    }
    if (p.emailAddress) {
      result.emailAddress = p.emailAddress;
    }
    if (p.domain) {
      result.domain = p.domain;
    }
    if (p.displayName) {
      result.displayName = p.displayName;
    }

    return result;
  }
}
