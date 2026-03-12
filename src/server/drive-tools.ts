import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AccountStore } from '../auth/index.js';
import {
  confirmationRequired,
  errorResponse,
  successResponse,
  toMcpError,
} from '../errors/index.js';
import { DriveClient } from '../drive/index.js';
import type { ScopeTier } from '../types/index.js';

export function registerDriveTools(
  server: McpServer,
  accountStore: AccountStore,
  validateAccountScope: (accountId: string, requiredTier: ScopeTier) =>
    { error: ReturnType<typeof errorResponse> } | { account: any },
): void {
  // === Read tools (require drive_readonly) ===

  // drive_search_files - Search for files using Drive search syntax
  server.registerTool(
    'drive_search_files',
    {
      description:
        'Search for files in Google Drive using Drive search syntax (e.g., "name contains \'report\'", "mimeType = \'application/pdf\'")',
      inputSchema: {
        accountId: z.string().describe('The Google account ID to search'),
        query: z.string().describe('Drive search query (e.g., "name contains \'report\'")'),
        maxResults: z.number().optional().describe('Maximum number of results (default: 20)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
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
        const result = await client.searchFiles(args.query, options);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_list_files - List files in a folder or root
  server.registerTool(
    'drive_list_files',
    {
      description:
        'List files in a Google Drive folder. If no folderId is provided, lists files in the root folder.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        folderId: z.string().optional().describe('Folder ID to list (default: root)'),
        maxResults: z.number().optional().describe('Maximum number of results (default: 20)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
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

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_get_file - Get file metadata
  server.registerTool(
    'drive_get_file',
    {
      description: 'Get metadata for a Google Drive file (name, size, type, owners, sharing status, etc.)',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const file = await client.getFile(args.fileId);

        return successResponse(file);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // drive_get_file_content - Download/export file content
  server.registerTool(
    'drive_get_file_content',
    {
      description:
        'Download or export file content from Google Drive. Google Workspace files (Docs, Sheets, Slides) are exported to plain text/CSV. Binary files are returned as base64.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new DriveClient(accountStore, args.accountId);
        const result = await client.getFileContent(args.fileId);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // === Write tools (require drive_full) ===

  // drive_upload_file - Upload a file
  server.registerTool(
    'drive_upload_file',
    {
      description:
        'Upload a file to Google Drive. Provide content as UTF-8 text or base64-encoded binary (set isBase64: true).',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        name: z.string().describe('File name including extension'),
        content: z.string().describe('File content (UTF-8 text or base64-encoded binary)'),
        mimeType: z.string().describe('MIME type of the file (e.g., "text/plain", "application/pdf")'),
        parentFolderId: z.string().optional().describe('Parent folder ID (default: root)'),
        isBase64: z.boolean().optional().describe('Set to true if content is base64-encoded'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
      if ('error' in validation) return validation.error;

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
          content: args.content,
          mimeType: args.mimeType,
        };
        if (args.parentFolderId !== undefined) {
          input.parentFolderId = args.parentFolderId;
        }
        if (args.isBase64 !== undefined) {
          input.isBase64 = args.isBase64;
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
        accountId: z.string().describe('The Google account ID'),
        name: z.string().describe('Folder name'),
        parentFolderId: z.string().optional().describe('Parent folder ID (default: root)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
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
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID to move'),
        newParentId: z.string().describe('The destination folder ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
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
      description: 'Create a copy of a file in Google Drive. Optionally specify a new name for the copy.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID to copy'),
        name: z.string().optional().describe('Name for the copy (default: "Copy of [original name]")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
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
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID to rename'),
        name: z.string().describe('New file name'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
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
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID to trash'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
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

  // === Write tools with confirm gate (require drive_full) ===

  // drive_share_file - Share file (requires confirm: true)
  server.registerTool(
    'drive_share_file',
    {
      description:
        'Share a Google Drive file by creating a permission. Requires confirm: true as a safety gate since sharing exposes the file to others.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID to share'),
        type: z.enum(['user', 'group', 'domain', 'anyone']).describe('Permission type'),
        role: z
          .enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'])
          .describe('Permission role'),
        emailAddress: z.string().optional().describe('Email address (required for user/group type)'),
        domain: z.string().optional().describe('Domain (required for domain type)'),
        sendNotification: z.boolean().optional().describe('Send notification email (default: false)'),
        confirm: z.boolean().optional().describe('Set to true to confirm sharing'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
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
        accountId: z.string().describe('The Google account ID'),
        fileId: z.string().describe('The file ID'),
        permissionId: z.string().describe('The permission ID to update'),
        role: z
          .enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'])
          .describe('New role'),
        confirm: z.boolean().optional().describe('Set to true to confirm permission update'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'drive_full');
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
        const permission = await client.updatePermissions(args.fileId, args.permissionId, args.role);

        return successResponse(permission);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );
}
