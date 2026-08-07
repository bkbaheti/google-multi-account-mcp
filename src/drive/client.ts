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
  driveId?: string;
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface SharedDrive {
  id: string;
  name: string;
  createdTime?: string;
}

export interface SharedDriveList {
  drives: SharedDrive[];
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

export interface DriveCommentAuthor {
  displayName?: string;
  emailAddress?: string;
}

export interface DriveCommentReply {
  id: string;
  author: DriveCommentAuthor;
  content: string;
  htmlContent?: string;
  createdTime?: string;
  modifiedTime?: string;
}

export interface DriveComment {
  id: string;
  author: DriveCommentAuthor;
  content: string;
  htmlContent?: string;
  /** The document text the comment is anchored to (quotedFileContent.value) */
  quotedText?: string;
  /** Opaque Drive anchor region descriptor */
  anchor?: string;
  createdTime?: string;
  modifiedTime?: string;
  resolved: boolean;
  replies: DriveCommentReply[];
}

export interface DriveCommentList {
  comments: DriveComment[];
  nextPageToken?: string;
}

export interface DriveCommentReplyList {
  replies: DriveCommentReply[];
  nextPageToken?: string;
}

const FILE_FIELDS =
  'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners, shared, trashed, driveId';

const REPLY_FIELDS =
  'id,author(displayName,emailAddress),content,htmlContent,createdTime,modifiedTime';

// Drive's comments resource returns almost nothing without an explicit fields mask.
const COMMENT_FIELDS = `id,author(displayName,emailAddress),content,htmlContent,quotedFileContent(value),anchor,createdTime,modifiedTime,resolved,replies(${REPLY_FIELDS})`;

/** Drive caps comments.list / replies.list at 100 items per page */
const COMMENTS_MAX_PAGE_SIZE = 100;
const COMMENTS_DEFAULT_PAGE_SIZE = 20;

const GOOGLE_APPS_MIME_PREFIX = 'application/vnd.google-apps.';
const GOOGLE_APPS_FOLDER_MIME = 'application/vnd.google-apps.folder';

// Default export format for each Google Workspace file type
const EXPORT_MIME_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.drawing': 'image/png',
};

// File extensions for export formats whose MIME subtype isn't usable as-is
const EXPORT_EXTENSIONS: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/epub+zip': 'epub',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'text/tab-separated-values': 'tsv',
  'text/markdown': 'md',
  'image/jpeg': 'jpg',
};

/**
 * Pick a file extension for an export MIME type: the lookup table first, then the
 * MIME subtype when it is already extension-shaped (e.g. `image/svg+xml` -> `svg`),
 * falling back to `bin` for anything unrecognized.
 */
function exportExtensionFor(mimeType: string): string {
  const known = EXPORT_EXTENSIONS[mimeType];
  if (known) {
    return known;
  }

  const subtype = mimeType.split('/')[1]?.split('+')[0] ?? '';
  return /^[a-z0-9]{1,5}$/.test(subtype) ? subtype : 'bin';
}

/** Content types safe to hand back as UTF-8 text rather than base64 */
function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  );
}

function clampPageSize(pageSize?: number): number {
  if (pageSize === undefined) {
    return COMMENTS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(1, Math.floor(pageSize)), COMMENTS_MAX_PAGE_SIZE);
}

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
      driveId?: string;
    } = {},
  ): Promise<DriveFileList> {
    const drive = await this.getDrive();

    const params: drive_v3.Params$Resource$Files$List = {
      q: query,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: options.maxResults ?? 20,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: options.driveId ? 'drive' : 'allDrives',
    };

    if (options.driveId) {
      params.driveId = options.driveId;
    }
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

  async listSharedDrives(
    options: { pageSize?: number; pageToken?: string } = {},
  ): Promise<SharedDriveList> {
    const drive = await this.getDrive();

    const params: drive_v3.Params$Resource$Drives$List = {
      pageSize: options.pageSize ?? 50,
      fields: 'nextPageToken, drives(id, name, createdTime)',
    };

    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }

    const response = await drive.drives.list(params);

    const drives: SharedDrive[] = (response.data.drives ?? []).map((d) => {
      const result: SharedDrive = {
        id: d.id ?? '',
        name: d.name ?? '',
      };
      if (d.createdTime) {
        result.createdTime = d.createdTime;
      }
      return result;
    });

    const result: SharedDriveList = { drives };
    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }
    return result;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.get({
      fileId,
      fields: FILE_FIELDS,
      supportsAllDrives: true,
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
    const defaultExportMimeType = EXPORT_MIME_TYPES[file.mimeType];

    let buffer: Buffer;
    let contentMimeType: string;

    if (defaultExportMimeType) {
      // Google Workspace file: export it. Read as an arraybuffer so binary export
      // formats (a Drawing exports to image/png) survive intact — decoding those as
      // UTF-8 replaces every invalid byte sequence with U+FFFD.
      const response = await drive.files.export(
        { fileId, mimeType: defaultExportMimeType },
        { responseType: 'arraybuffer' },
      );

      buffer = Buffer.from(response.data as ArrayBuffer);
      contentMimeType = defaultExportMimeType;
    } else {
      // Regular file: download it
      const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );

      buffer = Buffer.from(response.data as ArrayBuffer);
      contentMimeType = file.mimeType;
    }

    // Text: return as utf-8
    if (isTextMimeType(contentMimeType)) {
      const full = buffer.toString('utf-8');
      const truncated = maxChars !== undefined && full.length > maxChars;
      return {
        content: truncated ? full.slice(0, maxChars) : full,
        mimeType: contentMimeType,
        fileName: file.name,
        totalSize: full.length,
        truncated,
        encoding: 'utf-8',
      };
    }

    // Binary: return as base64 (no truncation — use drive_download_file instead)
    const b64 = buffer.toString('base64');
    return {
      content: b64,
      mimeType: contentMimeType,
      fileName: file.name,
      totalSize: buffer.length,
      truncated: false,
      encoding: 'base64',
    };
  }

  /**
   * Download a Drive file to disk. Google Workspace files are exported; pass
   * `exportMimeType` to override the default export format (e.g. `.docx` to preserve
   * comments and formatting instead of the default flattened `text/plain`).
   */
  async downloadFileToLocal(
    fileId: string,
    outputDir: string,
    fileName?: string,
    exportMimeType?: string,
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

    if (exportMimeType !== undefined) {
      if (file.mimeType === GOOGLE_APPS_FOLDER_MIME) {
        throw new Error(`Cannot export "${file.name}": it is a folder, not a document.`);
      }
      if (!file.mimeType.startsWith(GOOGLE_APPS_MIME_PREFIX)) {
        throw new Error(
          `exportMimeType is only supported for Google Workspace files; "${file.name}" is ${file.mimeType}. Omit exportMimeType to download it as-is.`,
        );
      }
    }

    const effectiveExportMimeType = exportMimeType ?? EXPORT_MIME_TYPES[file.mimeType];

    let buffer: Buffer;
    let mimeType: string;
    let outputFileName: string;

    if (effectiveExportMimeType) {
      // Google Workspace file: export it. Request an arraybuffer so binary export
      // formats (.docx, .xlsx, .pdf) are written byte-for-byte rather than stringified.
      const response = await drive.files.export(
        { fileId, mimeType: effectiveExportMimeType },
        { responseType: 'arraybuffer' },
      );

      buffer = Buffer.from(response.data as ArrayBuffer);
      mimeType = effectiveExportMimeType;
      // Use provided name or derive from file name + export extension
      outputFileName = fileName ?? `${file.name}.${exportExtensionFor(effectiveExportMimeType)}`;
    } else {
      // Regular file: download it
      const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
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

  // === Comment methods ===

  /**
   * List the comments on a Drive file, including the anchored document text each
   * comment refers to and its inline replies. Requires the `drive.readonly` scope —
   * `drive.file` only covers app-created files, not Docs shared by someone else.
   */
  async getComments(
    fileId: string,
    options: { pageSize?: number; pageToken?: string; includeResolved?: boolean } = {},
  ): Promise<DriveCommentList> {
    const drive = await this.getDrive();

    const params: drive_v3.Params$Resource$Comments$List = {
      fileId,
      fields: `nextPageToken, comments(${COMMENT_FIELDS})`,
      includeDeleted: false,
      pageSize: clampPageSize(options.pageSize),
    };

    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }

    const response = await drive.comments.list(params);

    let comments = (response.data.comments ?? []).map((c) => this.convertComment(c));

    // Drive has no server-side filter for resolved comments, so filter here.
    if (options.includeResolved === false) {
      comments = comments.filter((c) => !c.resolved);
    }

    const result: DriveCommentList = { comments };

    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }

    return result;
  }

  /**
   * List the replies to a single comment. `getComments` already inlines replies; use
   * this when a comment has more replies than that inline list returns.
   */
  async getCommentReplies(
    fileId: string,
    commentId: string,
    options: { pageSize?: number; pageToken?: string } = {},
  ): Promise<DriveCommentReplyList> {
    const drive = await this.getDrive();

    const params: drive_v3.Params$Resource$Replies$List = {
      fileId,
      commentId,
      fields: `nextPageToken, replies(${REPLY_FIELDS})`,
      includeDeleted: false,
      pageSize: clampPageSize(options.pageSize),
    };

    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }

    const response = await drive.replies.list(params);

    const replies = (response.data.replies ?? []).map((r) => this.convertReply(r));

    const result: DriveCommentReplyList = { replies };

    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }

    return result;
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
      supportsAllDrives: true,
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
      supportsAllDrives: true,
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
      supportsAllDrives: true,
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
      supportsAllDrives: true,
    });

    return this.convertFile(response.data);
  }

  async renameFile(fileId: string, name: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.update({
      fileId,
      requestBody: { name },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });

    return this.convertFile(response.data);
  }

  async trashFile(fileId: string): Promise<DriveFile> {
    const drive = await this.getDrive();

    const response = await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
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
      supportsAllDrives: true,
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
      supportsAllDrives: true,
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
    if (f.driveId) {
      result.driveId = f.driveId;
    }

    return result;
  }

  private convertAuthor(author?: drive_v3.Schema$User | null): DriveCommentAuthor {
    const result: DriveCommentAuthor = {};

    if (author?.displayName) {
      result.displayName = author.displayName;
    }
    if (author?.emailAddress) {
      result.emailAddress = author.emailAddress;
    }

    return result;
  }

  private convertReply(r: drive_v3.Schema$Reply): DriveCommentReply {
    const result: DriveCommentReply = {
      id: r.id ?? '',
      author: this.convertAuthor(r.author),
      content: r.content ?? '',
    };

    if (r.htmlContent) {
      result.htmlContent = r.htmlContent;
    }
    if (r.createdTime) {
      result.createdTime = r.createdTime;
    }
    if (r.modifiedTime) {
      result.modifiedTime = r.modifiedTime;
    }

    return result;
  }

  private convertComment(c: drive_v3.Schema$Comment): DriveComment {
    const result: DriveComment = {
      id: c.id ?? '',
      author: this.convertAuthor(c.author),
      content: c.content ?? '',
      resolved: c.resolved === true,
      replies: (c.replies ?? []).map((r) => this.convertReply(r)),
    };

    if (c.htmlContent) {
      result.htmlContent = c.htmlContent;
    }
    if (c.quotedFileContent?.value) {
      result.quotedText = c.quotedFileContent.value;
    }
    if (c.anchor) {
      result.anchor = c.anchor;
    }
    if (c.createdTime) {
      result.createdTime = c.createdTime;
    }
    if (c.modifiedTime) {
      result.modifiedTime = c.modifiedTime;
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
