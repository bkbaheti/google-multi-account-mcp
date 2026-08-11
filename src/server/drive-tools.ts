import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CAPABILITY_INFO, hasCapability } from '../auth/capabilities.js';
import type { Capability, CapabilityGate } from '../auth/capabilities.js';
import type { AccountStore } from '../auth/index.js';
import { DriveClient } from '../drive/index.js';
import {
  confirmationRequired,
  errorResponse,
  successResponse,
  toDriveMcpError,
  toMcpError,
  validationError,
} from '../errors/index.js';
import { DRIVE_MAX_UPLOAD_BYTES, coerceArgs, readFileAsBase64 } from '../utils/index.js';

/** Default character limit for drive_get_file_content preview */
const DEFAULT_PREVIEW_MAX_CHARS = 10_000;

/**
 * Convert common shorthand query formats to Google Drive API query syntax.
 * For example, "type:document" becomes "mimeType='application/vnd.google-apps.document'".
 */
export function normalizeDriveQuery(query: string): string {
  const typeMap: Record<string, string> = {
    document: 'application/vnd.google-apps.document',
    spreadsheet: 'application/vnd.google-apps.spreadsheet',
    presentation: 'application/vnd.google-apps.presentation',
    folder: 'application/vnd.google-apps.folder',
    form: 'application/vnd.google-apps.form',
    pdf: 'application/pdf',
    image: 'image/',
    video: 'video/',
    audio: 'audio/',
  };

  // Replace content:keyword with fullText contains 'keyword'
  let normalized = query.replace(/content:(\S+)/gi, (_match, keyword) => {
    return `fullText contains '${keyword}'`;
  });

  // Replace type:doctype with mimeType queries
  normalized = normalized.replace(/type:(\w+)/gi, (_match, type) => {
    const mime = typeMap[type.toLowerCase()];
    if (mime) {
      // Use "contains" for partial mime types (image/, video/, audio/)
      if (mime.endsWith('/')) {
        return `mimeType contains '${mime}'`;
      }
      return `mimeType='${mime}'`;
    }
    return _match; // Leave unknown types as-is
  });

  return normalized;
}

// files.get, files.export, files.list, comments.list, and replies.list all
// accept either drive.readonly or drive.file (verified against Google's
// per-method scope reference), so drive:appfiles alone satisfies these
// calls when they're made against files this server created. drives.list
// does NOT accept drive.file (see drive_list_shared_drives below, which
// keeps the bare drive:read gate instead of this one), so it is excluded
// from this set.
//
// Escalation: drive:appfiles reaches only files this server created, via
// drive.file's per-file grant. A file this account did not create through
// this server - for example, one shared with it by another app or person -
// can still make drive:appfiles insufficient for THIS call. That is a
// property of the file in front of the caller right now, not a want for
// some future one. See the `escalation` field's doc comment on
// CapabilityGate for why that distinction is what makes this a valid
// escalation rather than an upsell.
const DRIVE_READ_OR_APPFILES_GATE: CapabilityGate = {
  accept: ['drive:read', 'drive:appfiles'],
  remedy: 'drive:appfiles',
  escalation: 'drive:read',
};

// Reuse CAPABILITY_INFO's agreed-on wording for what drive:appfiles reaches,
// rather than restating it here where it could drift out of sync.
const APPFILES_INFO = CAPABILITY_INFO['drive:appfiles'];

/**
 * A drive:appfiles-only account never gets a permission error for files
 * outside its reach - files.list/files.get/comments.list etc. all accept
 * drive.file, so the call just succeeds against a narrower corpus (see
 * DRIVE_READ_OR_APPFILES_GATE above). That means a search for a document
 * that genuinely exists can come back empty, indistinguishable from "no
 * such file" - the exact silent-partial-result bug this annotation exists
 * to surface. See docs/superpowers/specs/2026-08-11-capability-correctness-
 * and-ux-design.md, section B1.
 */
interface DriveCoverage {
  scope: 'app-created-only';
  explanation: string;
}

function driveCoverage(): DriveCoverage {
  return {
    scope: 'app-created-only',
    explanation: `${APPFILES_INFO.reach} ${APPFILES_INFO.cannotDo}`,
  };
}

// Read for a list/search response's `warning` key (see withDriveCoverage
// below). Written for an AI-agent reader, not just a human one: it needs to
// land as "my view here is partial, say so or try another account" rather
// than as an incidental note that a human skims past and an agent ignores.
// Applies regardless of whether the result on hand is empty or not - see
// driveCoverage's doc comment for why "only warn when empty" is the wrong
// shape.
const DRIVE_COVERAGE_WARNING =
  `Partial results, not a complete answer: ${APPFILES_INFO.reach} ${APPFILES_INFO.cannotDo} ` +
  'This holds for every result below, whether the list is empty, short, or long - a file ' +
  'missing from it may still exist outside this reach. Do not report an empty or short result ' +
  'as "no such file" or "that\'s everything"; tell the user this view is partial, or retry with ' +
  'an account that also holds drive:read.';

/**
 * Annotate a Drive response when the account's only Drive read access is
 * drive:appfiles (drive.file), leaving accounts with drive:read (with or
 * without drive:appfiles too) untouched - drive:read is what makes the view
 * complete, so its presence is what turns this annotation off.
 *
 * Runs on every matching response, not only empty ones: an annotation that
 * shows up only when a result is empty teaches "warning means zero
 * results", so a three-of-four-thousand answer would still read as
 * complete.
 *
 * `list: true` additionally puts a `warning` string as the literal first
 * key of the response body, for MCP clients that truncate large tool
 * results before a `coverage` block buried after hundreds of files would
 * ever be read. That is a mitigation, not a guarantee - a client that
 * truncates before even the first key, or that re-serializes the object
 * with different key order, isn't helped by this.
 */
function withDriveCoverage<T extends object>(
  scopes: string[],
  data: T,
  options: { list?: boolean } = {},
): T & { coverage?: DriveCoverage; warning?: string } {
  if (!hasCapability(scopes, 'drive:appfiles') || hasCapability(scopes, 'drive:read')) {
    return data;
  }

  const coverage = driveCoverage();

  if (options.list) {
    return { warning: DRIVE_COVERAGE_WARNING, ...data, coverage };
  }

  return { ...data, coverage };
}

export function registerDriveTools(
  server: McpServer,
  accountStore: AccountStore,
  validateAccountScope: (
    accountId: string,
    required: Capability | CapabilityGate,
  ) => { error: ReturnType<typeof errorResponse> } | { account: any },
): void {
  // Build the DRIVE_FILE_NOT_VISIBLE-aware error response for a Drive read
  // tool's catch block. `account` is the resolved account from
  // validateAccountScope (drive:appfiles-or-drive:read), so its scopes are
  // exactly what toDriveMcpError needs to tell "invisible to this grant"
  // apart from "genuinely absent" - see toDriveMcpError's doc comment.
  function driveReadErrorResponse(error: unknown, account: { id: string; scopes: string[] }, accountRef: string) {
    return errorResponse(
      toDriveMcpError(error, {
        accountRef,
        accountScopes: account.scopes,
        otherAccounts: accountStore.listAccounts().filter((a) => a.id !== account.id),
      }),
    );
  }

  // === Read tools (drive:appfiles or drive:read - see DRIVE_READ_OR_APPFILES_GATE above;
  // drive_list_shared_drives is the one exception, requiring bare drive:read) ===

  // drive_list_shared_drives - List Shared Drives the user is a member of
  server.registerTool(
    'drive_list_shared_drives',
    {
      description:
        'List the Shared Drives (Team Drives) the user is a member of. Use the returned drive IDs as the folderId argument to drive_list_files to browse a Shared Drive, or as driveId on drive_search_files to scope a search.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        pageSize: z
          .number()
          .optional()
          .describe('Maximum number of drives to return (default: 50, max: 100)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { pageSize: 'number' });
      const validation = validateAccountScope(args.accountId, 'drive:read');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const options: { pageSize?: number; pageToken?: string } = {};
        if (args.pageSize !== undefined) {
          options.pageSize = args.pageSize;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        const result = await client.listSharedDrives(options);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_search_files - Search for files using Drive search syntax
  server.registerTool(
    'drive_search_files',
    {
      description:
        'Search for files in Google Drive. Searches across My Drive and all Shared Drives the user is a member of by default; pass driveId to scope the search to a single Shared Drive (discover IDs with drive_list_shared_drives). Supports shorthand syntax: type:document, type:spreadsheet, type:pdf, type:folder, type:image, type:video, type:audio (converted to mimeType queries), and content:keyword (searches inside file contents via fullText). Also accepts raw Drive API query syntax (e.g., "name contains \'report\'").',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        query: z.string().describe('Drive search query (e.g., "name contains \'report\'")'),
        maxResults: z.number().optional().describe('Maximum number of results (default: 20)'),
        pageToken: z.string().optional().describe('Token for pagination'),
        driveId: z
          .string()
          .optional()
          .describe('Restrict search to a single Shared Drive (omit to search My Drive + all Shared Drives)'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { maxResults: 'number' });
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const options: { maxResults?: number; pageToken?: string; driveId?: string } = {};
        if (args.maxResults !== undefined) {
          options.maxResults = args.maxResults;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        if (args.driveId !== undefined) {
          options.driveId = args.driveId;
        }
        const normalizedQuery = normalizeDriveQuery(args.query);
        const result = await client.searchFiles(normalizedQuery, options);

        return successResponse(withDriveCoverage(validation.account.scopes, result, { list: true }));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // drive_list_files - List files in a folder or root
  server.registerTool(
    'drive_list_files',
    {
      description:
        'List files in a Google Drive folder. If no folderId is provided, lists files in the user\'s My Drive root. To list a Shared Drive\'s top level, pass the Shared Drive ID as folderId (discover IDs with drive_list_shared_drives).',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        folderId: z
          .string()
          .optional()
          .describe('Folder ID, or a Shared Drive ID for its top level (default: My Drive root)'),
        maxResults: z.number().optional().describe('Maximum number of results (default: 20)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { maxResults: 'number' });
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const options: { maxResults?: number; pageToken?: string } = {};
        if (args.maxResults !== undefined) {
          options.maxResults = args.maxResults;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        const result = await client.listFiles(args.folderId, options);

        return successResponse(withDriveCoverage(validation.account.scopes, result, { list: true }));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // drive_get_file - Get file metadata
  server.registerTool(
    'drive_get_file',
    {
      description:
        'Get metadata for a Google Drive file (name, size, type, owners, sharing status, etc.)',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const file = await client.getFile(args.fileId);

        return successResponse(withDriveCoverage(validation.account.scopes, file));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // drive_get_file_content - Preview file content (truncated to protect context)
  server.registerTool(
    'drive_get_file_content',
    {
      description:
        'Get a preview of file content from Google Drive (default: first 10,000 characters). Returns truncated text with metadata (fileName, totalSize, truncated flag). For full content use drive_get_full_file_content. For large/binary files prefer drive_download_file to save to disk instead.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID'),
        maxChars: z
          .number()
          .optional()
          .describe('Maximum characters to return (default: 10000). Set higher only if you need more context.'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { maxChars: 'number' });
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const maxChars = args.maxChars ?? DEFAULT_PREVIEW_MAX_CHARS;
        const result = await client.getFileContent(args.fileId, { maxChars });

        return successResponse(withDriveCoverage(validation.account.scopes, result));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // drive_get_full_file_content - Full file content (use sparingly)
  server.registerTool(
    'drive_get_full_file_content',
    {
      description:
        'WARNING: Returns the ENTIRE file content — can be very large and may overload your context window. Only use this when you genuinely need the complete file (e.g., for analysis or transformation). Prefer drive_get_file_content (preview) for browsing, or drive_download_file to save large files to disk.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.getFileContent(args.fileId);

        return successResponse(withDriveCoverage(validation.account.scopes, result));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // drive_get_comments - Read reviewer comments on a Drive file
  server.registerTool(
    'drive_get_comments',
    {
      description:
        'Read the comments on a Google Drive file (Doc, Sheet, Slide), including the document text each comment is anchored to, the author, timestamps, resolved status, and replies. Use this to review feedback left on a shared document. An account holding only drive:appfiles (drive.file) can read comments on files this server created, but not on files it did not create (e.g., shared with it by another app or person) — re-authorize with google_reauth_account to add drive:read if you hit a permission error on such a file.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The Drive file ID'),
        pageSize: z
          .number()
          .optional()
          .describe('Maximum number of comments to return (default: 20, max: 100)'),
        pageToken: z.string().optional().describe('Token for pagination'),
        includeResolved: z
          .boolean()
          .optional()
          .describe(
            'Include comments already marked resolved (default: true). Resolved comments are filtered out after Drive paginates, so with includeResolved: false a page can come back empty while unresolved comments still remain — keep paging while nextPageToken is present rather than treating an empty page as "no comments".',
          ),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { pageSize: 'number', includeResolved: 'boolean' });
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const options: { pageSize?: number; pageToken?: string; includeResolved?: boolean } = {};
        if (args.pageSize !== undefined) {
          options.pageSize = args.pageSize;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        if (args.includeResolved !== undefined) {
          options.includeResolved = args.includeResolved;
        }
        const result = await client.getComments(args.fileId, options);

        return successResponse(withDriveCoverage(validation.account.scopes, result, { list: true }));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // drive_get_comment_replies - Read replies to a single comment
  server.registerTool(
    'drive_get_comment_replies',
    {
      description:
        'Read the replies to a single comment on a Google Drive file. drive_get_comments already returns replies inline, so use this only when a comment has more replies than that inline list returned.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The Drive file ID'),
        commentId: z.string().describe('The parent comment ID (from drive_get_comments)'),
        pageSize: z
          .number()
          .optional()
          .describe('Maximum number of replies to return (default: 20, max: 100)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { pageSize: 'number' });
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const options: { pageSize?: number; pageToken?: string } = {};
        if (args.pageSize !== undefined) {
          options.pageSize = args.pageSize;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        const result = await client.getCommentReplies(args.fileId, args.commentId, options);

        return successResponse(withDriveCoverage(validation.account.scopes, result, { list: true }));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // drive_download_file - Download file to local disk
  server.registerTool(
    'drive_download_file',
    {
      description:
        'Download a file from Google Drive and save it to a local directory. Google Workspace files (Docs, Sheets, Slides) are exported — by default to plain formats (txt, csv, png) which discard comments and formatting. Pass exportMimeType to choose a richer format instead: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" (.docx, preserves a Doc\'s comments and formatting), "application/pdf" (.pdf, rendered, no comments), or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (.xlsx) for a Sheet.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID to download'),
        outputDir: z
          .string()
          .describe('Absolute path to the local directory where the file will be saved'),
        fileName: z
          .string()
          .optional()
          .describe(
            'Override the file name (default: original name from Drive). For Workspace files, include the export extension.',
          ),
        exportMimeType: z
          .string()
          .optional()
          .describe(
            'Export format for Google Workspace files (e.g. "application/pdf"). The file extension is derived from it. Only valid for Workspace files; omit for regular files.',
          ),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, DRIVE_READ_OR_APPFILES_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.downloadFileToLocal(
          args.fileId,
          args.outputDir,
          args.fileName,
          args.exportMimeType,
        );

        return successResponse(withDriveCoverage(validation.account.scopes, result));
      } catch (error) {
        return driveReadErrorResponse(error, validation.account, args.accountId);
      }
    },
  );

  // === Write tools (require drive:appfiles) ===

  // drive_upload_file - Upload a file
  server.registerTool(
    'drive_upload_file',
    {
      description:
        'Upload a file to Google Drive. Provide content as UTF-8 text, base64-encoded binary (set isBase64: true), or a local file path (the server reads the file from disk).',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        name: z.string().describe('File name including extension'),
        content: z
          .string()
          .optional()
          .describe('File content (UTF-8 text or base64-encoded binary). Provide this OR filePath.'),
        mimeType: z
          .string()
          .describe('MIME type of the file (e.g., "text/plain", "application/pdf")'),
        parentFolderId: z.string().optional().describe('Parent folder ID (default: root)'),
        isBase64: z
          .boolean()
          .optional()
          .describe('Set to true if content is base64-encoded (only used with content, not filePath)'),
        filePath: z
          .string()
          .optional()
          .describe(
            'Absolute path to file on disk (provide this OR content). Server reads the file directly.',
          ),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { isBase64: 'boolean' });
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      // Validate mutual exclusivity of content vs filePath
      if (args.content && args.filePath) {
        return errorResponse(
          validationError('Provide either "content" or "filePath", not both').toResponse(),
        );
      }
      if (!args.content && !args.filePath) {
        return errorResponse(
          validationError('Must provide either "content" or "filePath"').toResponse(),
        );
      }

      let content: string;
      let isBase64: boolean | undefined;

      if (args.filePath) {
        const fileResult = readFileAsBase64(args.filePath, DRIVE_MAX_UPLOAD_BYTES);
        if ('error' in fileResult) {
          return errorResponse(validationError(fileResult.error).toResponse());
        }
        content = fileResult.data;
        isBase64 = true;
      } else {
        content = args.content as string;
        isBase64 = args.isBase64;
      }

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const input: {
          name: string;
          content: string;
          mimeType: string;
          parentFolderId?: string;
          isBase64?: boolean;
        } = {
          name: args.name,
          content,
          mimeType: args.mimeType,
        };
        if (args.parentFolderId !== undefined) {
          input.parentFolderId = args.parentFolderId;
        }
        if (isBase64 !== undefined) {
          input.isBase64 = isBase64;
        }
        const file = await client.uploadFile(input);

        return successResponse(file);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_create_folder - Create a folder
  server.registerTool(
    'drive_create_folder',
    {
      description: 'Create a new folder in Google Drive.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        name: z.string().describe('Folder name'),
        parentFolderId: z.string().optional().describe('Parent folder ID (default: root)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const folder = await client.createFolder(args.name, args.parentFolderId);

        return successResponse(folder);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_move_file - Move file to different folder
  server.registerTool(
    'drive_move_file',
    {
      description: 'Move a file to a different folder in Google Drive.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID to move'),
        newParentId: z.string().describe('The destination folder ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const file = await client.moveFile(args.fileId, args.newParentId);

        return successResponse(file);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_copy_file - Copy a file
  server.registerTool(
    'drive_copy_file',
    {
      description:
        'Create a copy of a file in Google Drive. Optionally specify a new name for the copy.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID to copy'),
        name: z
          .string()
          .optional()
          .describe('Name for the copy (default: "Copy of [original name]")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const file = await client.copyFile(args.fileId, args.name);

        return successResponse(file);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_rename_file - Rename a file
  server.registerTool(
    'drive_rename_file',
    {
      description: 'Rename a file in Google Drive.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID to rename'),
        name: z.string().describe('New file name'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const file = await client.renameFile(args.fileId, args.name);

        return successResponse(file);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_trash_file - Move to trash
  server.registerTool(
    'drive_trash_file',
    {
      description: 'Move a file to trash in Google Drive.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID to trash'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const file = await client.trashFile(args.fileId);

        return successResponse(file);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // === Write tools with confirm gate (require drive:appfiles) ===

  // drive_share_file - Share file (requires confirm: true)
  server.registerTool(
    'drive_share_file',
    {
      description:
        'Share a Google Drive file by creating a permission. Requires confirm: true as a safety gate since sharing exposes the file to others.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID to share'),
        type: z.enum(['user', 'group', 'domain', 'anyone']).describe('Permission type'),
        role: z
          .enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'])
          .describe('Permission role'),
        emailAddress: z
          .string()
          .optional()
          .describe('Email address (required for user/group type)'),
        domain: z.string().optional().describe('Domain (required for domain type)'),
        sendNotification: z
          .boolean()
          .optional()
          .describe('Send notification email (default: false)'),
        confirm: z.boolean().optional().describe('Set to true to confirm sharing'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { sendNotification: 'boolean', confirm: 'boolean' });
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      // Safety gate: require explicit confirmation
      if (args.confirm !== true) {
        return errorResponse(
          confirmationRequired(
            'share this file',
            'Sharing exposes the file to others. Set confirm: true to proceed.',
          ).toResponse(),
        );
      }

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const permissionInput: {
          type: 'user' | 'group' | 'domain' | 'anyone';
          role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
          emailAddress?: string;
          domain?: string;
        } = {
          type: args.type,
          role: args.role,
        };
        if (args.emailAddress !== undefined) {
          permissionInput.emailAddress = args.emailAddress;
        }
        if (args.domain !== undefined) {
          permissionInput.domain = args.domain;
        }
        const permission = await client.shareFile(
          args.fileId,
          permissionInput,
          args.sendNotification,
        );

        return successResponse(permission);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_update_permissions - Update permissions (requires confirm: true)
  server.registerTool(
    'drive_update_permissions',
    {
      description:
        'Update an existing permission on a Google Drive file. Requires confirm: true as a safety gate since permission changes affect access control.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        fileId: z.string().describe('The file ID'),
        permissionId: z.string().describe('The permission ID to update'),
        role: z
          .enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'])
          .describe('New role'),
        confirm: z.boolean().optional().describe('Set to true to confirm permission update'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { confirm: 'boolean' });
      const validation = validateAccountScope(args.accountId, 'drive:appfiles');
      if ('error' in validation) return validation.error;

      // Safety gate: require explicit confirmation
      if (args.confirm !== true) {
        return errorResponse(
          confirmationRequired(
            'update file permissions',
            'Permission changes affect who can access this file. Set confirm: true to proceed.',
          ).toResponse(),
        );
      }

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const permission = await client.updatePermissions(
          args.fileId,
          args.permissionId,
          args.role,
        );

        return successResponse(permission);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );
}
