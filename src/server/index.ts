import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../auth/index.js';
import { AccountStore } from '../auth/index.js';
import {
  accountNotFound,
  confirmationRequired,
  errorResponse,
  scopeInsufficient,
  successResponse,
  toMcpError,
} from '../errors/index.js';
import { GmailClient, getHeader, getTextBody } from '../gmail/index.js';
import {
  getScopeTier,
  hasSufficientScope,
  SCOPE_TIERS,
  type ScopeTier,
} from '../types/index.js';
import { cache } from '../utils/index.js';

export interface ServerOptions {
  tokenStorage: TokenStorage;
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({
    name: 'mcp-google',
    version: '0.1.0',
  });

  const accountStore = new AccountStore(options.tokenStorage);

  // Helper to validate account exists and has sufficient scope
  function validateAccountScope(
    accountId: string,
    requiredTier: ScopeTier,
  ): { error: ReturnType<typeof errorResponse> } | { account: NonNullable<ReturnType<typeof accountStore.getAccount>> } {
    const account = accountStore.getAccount(accountId);
    if (!account) {
      return { error: errorResponse(accountNotFound(accountId).toResponse()) };
    }

    if (!hasSufficientScope(account.scopes, requiredTier)) {
      const currentTier = getScopeTier(account.scopes);
      return {
        error: errorResponse(scopeInsufficient(requiredTier, currentTier, accountId).toResponse()),
      };
    }

    return { account };
  }

  // google_list_accounts - List all connected Google accounts
  server.registerTool(
    'google_list_accounts',
    {
      description: 'List all connected Google accounts',
    },
    async () => {
      const accounts = accountStore.listAccounts();
      const result = accounts.map((account) => ({
        id: account.id,
        email: account.email,
        labels: account.labels,
        scopes: account.scopes,
        addedAt: account.addedAt,
        lastUsedAt: account.lastUsedAt,
      }));

      return successResponse(result);
    },
  );

  // google_add_account - Add a new Google account via OAuth
  server.registerTool(
    'google_add_account',
    {
      description:
        'Add a new Google account via OAuth. Opens browser for authorization. Scope tier: readonly (default), compose (send emails), or full (modify labels/archive).',
      inputSchema: {
        scopeTier: z
          .enum(['readonly', 'compose', 'full'])
          .optional()
          .describe('Permission level: readonly, compose, or full'),
      },
    },
    async (args) => {
      const scopeTier = (args.scopeTier ?? 'readonly') as ScopeTier;

      try {
        const account = await accountStore.addAccount(scopeTier);

        return successResponse({
          success: true,
          message: `Successfully added account ${account.email}`,
          account: {
            id: account.id,
            email: account.email,
            scopes: account.scopes,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // google_remove_account - Remove a Google account
  server.registerTool(
    'google_remove_account',
    {
      description: 'Remove a Google account and revoke its tokens',
      inputSchema: {
        accountId: z.string().describe('The account ID to remove'),
      },
    },
    async (args) => {
      const removed = await accountStore.removeAccount(args.accountId);

      if (removed) {
        return successResponse({ success: true, message: 'Account removed' });
      }

      return errorResponse(accountNotFound(args.accountId).toResponse());
    },
  );

  // google_set_account_labels - Set labels on an account
  server.registerTool(
    'google_set_account_labels',
    {
      description: 'Set labels on a Google account (e.g., personal, work, school)',
      inputSchema: {
        accountId: z.string().describe('The account ID to update'),
        labels: z.array(z.string()).describe('Labels to set on the account'),
      },
    },
    async (args) => {
      const updated = accountStore.setAccountLabels(args.accountId, args.labels);

      if (updated) {
        return successResponse({ success: true, message: 'Labels updated', labels: args.labels });
      }

      return errorResponse(accountNotFound(args.accountId).toResponse());
    },
  );

  // gmail_search_messages - Search messages in Gmail
  server.registerTool(
    'gmail_search_messages',
    {
      description:
        'Search for messages in Gmail using Gmail search syntax (e.g., "from:user@example.com", "subject:hello", "is:unread")',
      inputSchema: {
        accountId: z.string().describe('The Google account ID to search'),
        query: z.string().describe('Gmail search query'),
        maxResults: z.number().optional().describe('Maximum number of results (default: 20)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const options: { maxResults?: number; pageToken?: string } = {};
        if (args.maxResults !== undefined) {
          options.maxResults = args.maxResults;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        const result = await client.searchMessages(args.query, options);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_get_message - Get a single message by ID
  server.registerTool(
    'gmail_get_message',
    {
      description: 'Get a single Gmail message by ID with headers and body content',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID'),
        format: z
          .enum(['minimal', 'metadata', 'full'])
          .optional()
          .describe('Response format (default: full)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.getMessage(args.messageId, args.format ?? 'full');

        // Extract useful info for the response
        const response = {
          id: message.id,
          threadId: message.threadId,
          labelIds: message.labelIds,
          snippet: message.snippet,
          from: getHeader(message, 'From'),
          to: getHeader(message, 'To'),
          subject: getHeader(message, 'Subject'),
          date: getHeader(message, 'Date'),
          body: getTextBody(message),
        };

        return successResponse(response);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_get_messages_batch - Get multiple messages in one call
  server.registerTool(
    'gmail_get_messages_batch',
    {
      description:
        'Fetch multiple Gmail messages in a single call. More efficient than fetching individually. Limited to 50 messages per call.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageIds: z.array(z.string()).describe('Array of message IDs to fetch (max 50)'),
        format: z
          .enum(['minimal', 'metadata', 'full'])
          .optional()
          .describe('Response format (default: full)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const results = await client.getMessagesBatch(args.messageIds, args.format ?? 'full');

        // Transform results for response
        const messages = results.map((result) => {
          if (result.success && result.message) {
            return {
              id: result.id,
              success: true,
              message: {
                id: result.message.id,
                threadId: result.message.threadId,
                labelIds: result.message.labelIds,
                snippet: result.message.snippet,
                from: getHeader(result.message, 'From'),
                to: getHeader(result.message, 'To'),
                subject: getHeader(result.message, 'Subject'),
                date: getHeader(result.message, 'Date'),
                body: getTextBody(result.message),
              },
            };
          }
          return {
            id: result.id,
            success: false,
            error: result.error,
          };
        });

        const successCount = messages.filter((m) => m.success).length;
        const failCount = messages.filter((m) => !m.success).length;

        return successResponse({
          total: messages.length,
          successCount,
          failCount,
          messages,
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_get_thread - Get a thread with all messages
  server.registerTool(
    'gmail_get_thread',
    {
      description: 'Get a Gmail thread with all its messages',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        threadId: z.string().describe('The thread ID'),
        format: z
          .enum(['minimal', 'metadata', 'full'])
          .optional()
          .describe('Response format (default: full)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const thread = await client.getThread(args.threadId, args.format ?? 'full');

        // Extract useful info for the response
        const response = {
          id: thread.id,
          messages: thread.messages?.map((msg) => ({
            id: msg.id,
            from: getHeader(msg, 'From'),
            to: getHeader(msg, 'To'),
            subject: getHeader(msg, 'Subject'),
            date: getHeader(msg, 'Date'),
            snippet: msg.snippet,
            body: getTextBody(msg),
          })),
        };

        return successResponse(response);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_create_draft - Create a draft email
  server.registerTool(
    'gmail_create_draft',
    {
      description:
        'Create a draft email. The draft can be reviewed, updated, and sent later. Requires compose or full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        to: z.string().describe('Recipient email address(es), comma-separated for multiple'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text)'),
        cc: z.string().optional().describe('CC email address(es), comma-separated for multiple'),
        bcc: z.string().optional().describe('BCC email address(es), comma-separated for multiple'),
        threadId: z
          .string()
          .optional()
          .describe('Thread ID to reply in (for continuing a conversation)'),
        inReplyTo: z
          .string()
          .optional()
          .describe('Message-ID of the message being replied to'),
        references: z.string().optional().describe('References header for threading'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'compose');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const draftInput: Parameters<typeof client.createDraft>[0] = {
          to: args.to,
          subject: args.subject,
          body: args.body,
        };
        if (args.cc) draftInput.cc = args.cc;
        if (args.bcc) draftInput.bcc = args.bcc;
        if (args.threadId) draftInput.threadId = args.threadId;
        if (args.inReplyTo) draftInput.inReplyTo = args.inReplyTo;
        if (args.references) draftInput.references = args.references;

        const draft = await client.createDraft(draftInput);

        return successResponse({
          success: true,
          message: 'Draft created successfully',
          draft: {
            id: draft.id,
            messageId: draft.message?.id,
            threadId: draft.message?.threadId,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_update_draft - Update an existing draft
  server.registerTool(
    'gmail_update_draft',
    {
      description:
        'Update an existing draft email. Replaces the entire draft content. Requires compose or full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        draftId: z.string().describe('The draft ID to update'),
        to: z.string().describe('Recipient email address(es), comma-separated for multiple'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text)'),
        cc: z.string().optional().describe('CC email address(es), comma-separated for multiple'),
        bcc: z.string().optional().describe('BCC email address(es), comma-separated for multiple'),
        threadId: z
          .string()
          .optional()
          .describe('Thread ID (for continuing a conversation)'),
        inReplyTo: z
          .string()
          .optional()
          .describe('Message-ID of the message being replied to'),
        references: z.string().optional().describe('References header for threading'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'compose');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const draftInput: Parameters<typeof client.createDraft>[0] = {
          to: args.to,
          subject: args.subject,
          body: args.body,
        };
        if (args.cc) draftInput.cc = args.cc;
        if (args.bcc) draftInput.bcc = args.bcc;
        if (args.threadId) draftInput.threadId = args.threadId;
        if (args.inReplyTo) draftInput.inReplyTo = args.inReplyTo;
        if (args.references) draftInput.references = args.references;

        const draft = await client.updateDraft(args.draftId, draftInput);

        return successResponse({
          success: true,
          message: 'Draft updated successfully',
          draft: {
            id: draft.id,
            messageId: draft.message?.id,
            threadId: draft.message?.threadId,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_get_draft - Get a draft with preview
  server.registerTool(
    'gmail_get_draft',
    {
      description: 'Get a draft email with full content for preview before sending',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        draftId: z.string().describe('The draft ID to retrieve'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'compose');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const draft = await client.getDraft(args.draftId);

        // Extract headers for easy access
        const headers = draft.message?.payload?.headers ?? [];
        const getHeaderValue = (name: string): string | undefined =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

        // Get body content
        const bodyContent = draft.message?.payload?.body?.data
          ? Buffer.from(draft.message.payload.body.data, 'base64url').toString('utf-8')
          : undefined;

        const response = {
          id: draft.id,
          message: {
            id: draft.message?.id,
            threadId: draft.message?.threadId,
            labelIds: draft.message?.labelIds,
            snippet: draft.message?.snippet,
            from: getHeaderValue('From'),
            to: getHeaderValue('To'),
            cc: getHeaderValue('Cc'),
            bcc: getHeaderValue('Bcc'),
            subject: getHeaderValue('Subject'),
            date: getHeaderValue('Date'),
            body: bodyContent,
          },
        };

        return successResponse(response);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_send_draft - Send a draft (with confirmation gate)
  server.registerTool(
    'gmail_send_draft',
    {
      description:
        'Send a draft email. IMPORTANT: This will actually send the email. You MUST pass confirm: true to proceed. Requires compose or full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        draftId: z.string().describe('The draft ID to send'),
        confirm: z
          .boolean()
          .describe(
            'REQUIRED: Must be true to actually send. This is a safety gate to prevent accidental sends.',
          ),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'compose');
      if ('error' in validation) return validation.error;

      // Safety gate: require explicit confirmation
      if (args.confirm !== true) {
        return errorResponse(
          confirmationRequired(
            'send this email',
            'Review the draft using gmail_get_draft first, then call gmail_send_draft with confirm: true',
          ).toResponse(),
        );
      }

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const sent = await client.sendDraft(args.draftId);

        return successResponse({
          success: true,
          message: 'Email sent successfully',
          sentMessage: {
            id: sent.id,
            threadId: sent.threadId,
            labelIds: sent.labelIds,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_delete_draft - Delete a draft
  server.registerTool(
    'gmail_delete_draft',
    {
      description: 'Delete a draft email',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        draftId: z.string().describe('The draft ID to delete'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'compose');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        await client.deleteDraft(args.draftId);

        return successResponse({
          success: true,
          message: 'Draft deleted successfully',
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_reply_in_thread - Create a reply in an existing thread
  server.registerTool(
    'gmail_reply_in_thread',
    {
      description:
        'Reply to an existing email thread. Creates a draft reply and optionally sends it. Requires compose or full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        threadId: z.string().describe('The thread ID to reply in'),
        to: z.string().describe('Recipient email address(es)'),
        subject: z.string().describe('Email subject (typically Re: original subject)'),
        body: z.string().describe('Reply body (plain text)'),
        inReplyTo: z.string().describe('Message-ID of the message being replied to'),
        references: z.string().describe('References header (Message-ID chain for threading)'),
        cc: z.string().optional().describe('CC email address(es)'),
        bcc: z.string().optional().describe('BCC email address(es)'),
        sendImmediately: z
          .boolean()
          .optional()
          .describe('If true AND confirm is true, send immediately instead of creating a draft'),
        confirm: z
          .boolean()
          .optional()
          .describe('Required if sendImmediately is true. Safety gate for sending.'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'compose');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);

        // Build reply input
        const replyInput: Parameters<typeof client.replyToThread>[0] = {
          threadId: args.threadId,
          to: args.to,
          subject: args.subject,
          body: args.body,
          inReplyTo: args.inReplyTo,
          references: args.references,
        };
        if (args.cc) replyInput.cc = args.cc;
        if (args.bcc) replyInput.bcc = args.bcc;

        // Create the draft
        const draft = await client.replyToThread(replyInput);

        // If sendImmediately requested, check confirm gate and send
        if (args.sendImmediately) {
          if (args.confirm !== true) {
            const error = confirmationRequired(
              'send immediately',
              'Draft was created but not sent. Use gmail_send_draft with confirm: true to send it.',
            ).toResponse();
            // Include draft info in the error details
            return errorResponse({
              ...error,
              details: {
                ...error.details,
                draft: {
                  id: draft.id,
                  messageId: draft.message?.id,
                  threadId: draft.message?.threadId,
                },
              },
            });
          }

          // Send the draft
          const sent = await client.sendDraft(draft.id);
          return successResponse({
            success: true,
            message: 'Reply sent successfully',
            sentMessage: {
              id: sent.id,
              threadId: sent.threadId,
              labelIds: sent.labelIds,
            },
          });
        }

        // Return draft info
        return successResponse({
          success: true,
          message: 'Reply draft created',
          draft: {
            id: draft.id,
            messageId: draft.message?.id,
            threadId: draft.message?.threadId,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // === Phase 4: Inbox Management Tools ===

  // gmail_list_labels - List all labels (system and custom)
  server.registerTool(
    'gmail_list_labels',
    {
      description:
        'List all Gmail labels (system labels like INBOX, SENT, etc. and custom user labels). Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const labels = await client.listLabels();

        return successResponse({
          labels,
          count: labels.length,
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_modify_labels - Add or remove labels from a message
  server.registerTool(
    'gmail_modify_labels',
    {
      description:
        'Add or remove labels from a Gmail message. Use label IDs (e.g., "INBOX", "STARRED", "IMPORTANT", or custom label IDs). Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to modify'),
        addLabelIds: z
          .array(z.string())
          .optional()
          .describe('Label IDs to add (e.g., ["STARRED", "IMPORTANT"])'),
        removeLabelIds: z
          .array(z.string())
          .optional()
          .describe('Label IDs to remove (e.g., ["UNREAD"])'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.modifyLabels(
          args.messageId,
          args.addLabelIds ?? [],
          args.removeLabelIds ?? [],
        );

        return successResponse({
          success: true,
          message: 'Labels modified successfully',
          updatedMessage: {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_batch_modify_labels - Bulk modify labels on multiple messages
  server.registerTool(
    'gmail_batch_modify_labels',
    {
      description:
        'Apply label changes to multiple messages in one operation. More efficient than individual modifications. Limited to 1000 messages. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageIds: z
          .array(z.string())
          .describe('Array of message IDs to modify (max 1000)'),
        addLabelIds: z
          .array(z.string())
          .optional()
          .describe('Label IDs to add to all messages'),
        removeLabelIds: z
          .array(z.string())
          .optional()
          .describe('Label IDs to remove from all messages'),
        confirm: z
          .boolean()
          .optional()
          .describe('Set to true to confirm bulk operation (required for >100 messages)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      // Require confirmation for large operations
      const messageCount = args.messageIds.length;
      if (messageCount > 100 && !args.confirm) {
        return successResponse({
          success: false,
          requiresConfirmation: true,
          message: `This operation will modify ${messageCount} messages. Set confirm: true to proceed.`,
          affectedCount: messageCount,
        });
      }

      try {
        const client = new GmailClient(accountStore, args.accountId);
        await client.batchModifyLabels(
          args.messageIds,
          args.addLabelIds ?? [],
          args.removeLabelIds ?? [],
        );

        return successResponse({
          success: true,
          message: `Labels modified on ${Math.min(messageCount, 1000)} messages`,
          affectedCount: Math.min(messageCount, 1000),
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_create_label - Create a new label
  server.registerTool(
    'gmail_create_label',
    {
      description:
        'Create a new Gmail label with optional color and visibility settings. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        name: z.string().describe('Label name (use "/" for nesting, e.g., "Work/Projects")'),
        messageListVisibility: z
          .enum(['show', 'hide'])
          .optional()
          .describe('Whether to show label in message list'),
        labelListVisibility: z
          .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
          .optional()
          .describe('Whether to show label in label list'),
        backgroundColor: z
          .string()
          .optional()
          .describe('Background color hex (e.g., "#16a765")'),
        textColor: z.string().optional().describe('Text color hex (e.g., "#ffffff")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const label = await client.createLabel(args.name, {
          messageListVisibility: args.messageListVisibility,
          labelListVisibility: args.labelListVisibility,
          backgroundColor: args.backgroundColor,
          textColor: args.textColor,
        });

        return successResponse({
          success: true,
          message: 'Label created successfully',
          label: {
            id: label.id,
            name: label.name,
            type: label.type,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_update_label - Update an existing label
  server.registerTool(
    'gmail_update_label',
    {
      description:
        'Update a Gmail label (rename, change color, visibility). System labels cannot be modified. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        labelId: z.string().describe('The label ID to update'),
        name: z.string().optional().describe('New label name'),
        messageListVisibility: z
          .enum(['show', 'hide'])
          .optional()
          .describe('Whether to show label in message list'),
        labelListVisibility: z
          .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
          .optional()
          .describe('Whether to show label in label list'),
        backgroundColor: z.string().optional().describe('New background color hex'),
        textColor: z.string().optional().describe('New text color hex'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const label = await client.updateLabel(args.labelId, {
          name: args.name,
          messageListVisibility: args.messageListVisibility,
          labelListVisibility: args.labelListVisibility,
          backgroundColor: args.backgroundColor,
          textColor: args.textColor,
        });

        return successResponse({
          success: true,
          message: 'Label updated successfully',
          label: {
            id: label.id,
            name: label.name,
            type: label.type,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_delete_label - Delete a label
  server.registerTool(
    'gmail_delete_label',
    {
      description:
        'Delete a Gmail label. Messages with this label will not be deleted, they will just lose the label. System labels cannot be deleted. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        labelId: z.string().describe('The label ID to delete'),
        confirm: z
          .boolean()
          .optional()
          .describe('Set to true to confirm deletion'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      if (!args.confirm) {
        return successResponse({
          success: false,
          requiresConfirmation: true,
          message: 'Label deletion is permanent. Set confirm: true to proceed.',
          labelId: args.labelId,
        });
      }

      try {
        const client = new GmailClient(accountStore, args.accountId);
        await client.deleteLabel(args.labelId);

        return successResponse({
          success: true,
          message: 'Label deleted successfully',
          deletedLabelId: args.labelId,
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_mark_read_unread - Toggle read/unread status
  server.registerTool(
    'gmail_mark_read_unread',
    {
      description:
        'Mark a Gmail message as read or unread. This is a shortcut for modifying the UNREAD label. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to modify'),
        markAsRead: z.boolean().describe('true to mark as read, false to mark as unread'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);

        const addLabelIds = args.markAsRead ? [] : ['UNREAD'];
        const removeLabelIds = args.markAsRead ? ['UNREAD'] : [];

        const message = await client.modifyLabels(args.messageId, addLabelIds, removeLabelIds);

        return successResponse({
          success: true,
          message: args.markAsRead ? 'Message marked as read' : 'Message marked as unread',
          updatedMessage: {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_archive - Remove message from INBOX (archive it)
  server.registerTool(
    'gmail_archive',
    {
      description:
        'Archive a Gmail message by removing it from INBOX. The message remains in All Mail and can still be found via search. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to archive'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.modifyLabels(args.messageId, [], ['INBOX']);

        return successResponse({
          success: true,
          message: 'Message archived (removed from INBOX)',
          updatedMessage: {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_trash - Move message to trash
  server.registerTool(
    'gmail_trash',
    {
      description:
        'Move a Gmail message to Trash. The message will be permanently deleted after 30 days. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to trash'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.trashMessage(args.messageId);

        return successResponse({
          success: true,
          message: 'Message moved to Trash',
          updatedMessage: {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_untrash - Restore message from trash
  server.registerTool(
    'gmail_untrash',
    {
      description: 'Restore a Gmail message from Trash back to the mailbox. Requires full scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to restore from trash'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'full');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.untrashMessage(args.messageId);

        return successResponse({
          success: true,
          message: 'Message restored from Trash',
          updatedMessage: {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // === Phase 6: Attachment Tools ===

  // gmail_list_attachments - List attachments in a message
  server.registerTool(
    'gmail_list_attachments',
    {
      description:
        'List all attachments in a Gmail message. Returns attachment IDs, filenames, MIME types, and sizes. Requires readonly scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to list attachments from'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const attachments = await client.listAttachments(args.messageId);

        return successResponse({
          attachments,
          count: attachments.length,
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_get_attachment - Download attachment by ID
  server.registerTool(
    'gmail_get_attachment',
    {
      description:
        'Download an attachment from a Gmail message. Returns base64-encoded data. Use gmail_list_attachments first to get attachment IDs. Requires readonly scope.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID containing the attachment'),
        attachmentId: z.string().describe('The attachment ID to download'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const attachment = await client.getAttachment(args.messageId, args.attachmentId);

        return successResponse({
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          data: attachment.data,
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // gmail_create_draft_with_attachment - Create a draft with file attachments
  server.registerTool(
    'gmail_create_draft_with_attachment',
    {
      description:
        'Create a draft email with file attachments. The draft can be reviewed and sent later. Requires compose or full scope. Max 25MB total attachment size.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        to: z.string().describe('Recipient email address(es), comma-separated for multiple'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text)'),
        attachments: z
          .array(
            z.object({
              filename: z.string().describe('Filename with extension'),
              mimeType: z.string().describe('MIME type (e.g., "application/pdf", "image/png")'),
              data: z.string().describe('Base64-encoded file data'),
            }),
          )
          .describe('Array of attachments to include'),
        cc: z.string().optional().describe('CC email address(es)'),
        bcc: z.string().optional().describe('BCC email address(es)'),
        threadId: z.string().optional().describe('Thread ID to reply in'),
        inReplyTo: z.string().optional().describe('Message-ID being replied to'),
        references: z.string().optional().describe('References header for threading'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'compose');
      if ('error' in validation) return validation.error;

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const draft = await client.createDraftWithAttachment({
          to: args.to,
          subject: args.subject,
          body: args.body,
          cc: args.cc,
          bcc: args.bcc,
          threadId: args.threadId,
          inReplyTo: args.inReplyTo,
          references: args.references,
          attachments: args.attachments,
        });

        return successResponse({
          success: true,
          message: `Draft created with ${args.attachments.length} attachment(s)`,
          draft: {
            id: draft.id,
            messageId: draft.message?.id,
            threadId: draft.message?.threadId,
          },
        });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // === MCP Prompts for Safe Email Workflows ===

  // Prompt: compose-email - Guided workflow for composing and sending email
  server.registerPrompt(
    'compose-email',
    {
      title: 'Compose Email',
      description:
        'Guided workflow for composing an email safely. Creates a draft, shows preview, and requires confirmation before sending.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID to send from'),
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body content'),
      },
    },
    async (args) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please help me send an email with these details:
- From account: ${args.accountId}
- To: ${args.to}
- Subject: ${args.subject}
- Body: ${args.body}

Follow this safe workflow:
1. First, create a draft using gmail_create_draft
2. Show me the draft preview using gmail_get_draft
3. Ask for my confirmation before sending
4. Only send with gmail_send_draft (confirm: true) after I approve`,
            },
          },
        ],
      };
    },
  );

  // Prompt: reply-to-email - Guided workflow for replying to an email
  server.registerPrompt(
    'reply-to-email',
    {
      title: 'Reply to Email',
      description:
        'Guided workflow for replying to an existing email thread safely with proper threading.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to reply to'),
        body: z.string().describe('Reply body content'),
      },
    },
    async (args) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please help me reply to message ${args.messageId} with account ${args.accountId}.

My reply: ${args.body}

Follow this safe workflow:
1. First, fetch the original message using gmail_get_message to get:
   - threadId
   - Message-ID header (for In-Reply-To)
   - Subject (prefix with Re: if not already)
   - From address (to use as To in reply)
2. Create a reply draft using gmail_reply_in_thread with proper headers
3. Show me the draft preview using gmail_get_draft
4. Ask for my confirmation before sending
5. Only send after I approve`,
            },
          },
        ],
      };
    },
  );

  // Prompt: review-drafts - List and review pending drafts
  server.registerPrompt(
    'review-drafts',
    {
      title: 'Review Drafts',
      description: 'List all draft emails for an account and optionally send or delete them.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID'),
      },
    },
    async (args) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please help me review my email drafts for account ${args.accountId}.

For each draft:
1. Show the preview (to, subject, snippet)
2. Ask what I want to do: send, edit, or delete
3. For sending, always require my explicit confirmation`,
            },
          },
        ],
      };
    },
  );

  // === Phase 7: AI Productivity Prompts ===

  // Prompt: summarize-thread - AI-assisted thread summarization
  server.registerPrompt(
    'summarize-thread',
    {
      title: 'Summarize Email Thread',
      description:
        'AI-assisted summarization of an email thread. Identifies main topic, key decisions, open questions, and action items.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID'),
        threadId: z.string().describe('The thread ID to summarize'),
      },
    },
    async (args) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please summarize the email thread ${args.threadId} from account ${args.accountId}.

Follow this workflow:
1. Fetch the full thread using gmail_get_thread with format "full"
2. Analyze all messages in chronological order
3. Provide a structured summary with:
   - **Main Topic/Request**: What is this thread about?
   - **Participants**: Who is involved and their roles
   - **Timeline**: Key dates and when messages were sent
   - **Key Decisions**: Any agreements or conclusions reached
   - **Open Questions**: Unresolved items that need answers
   - **Action Items**: Tasks mentioned with assignees and deadlines if stated

Be concise but comprehensive. Focus on extracting actionable information.`,
            },
          },
        ],
      };
    },
  );

  // Prompt: smart-reply - Context-aware reply suggestions
  server.registerPrompt(
    'smart-reply',
    {
      title: 'Smart Reply',
      description:
        'Get AI-suggested replies based on email context. Offers multiple response options from brief to detailed.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID'),
        messageId: z.string().describe('The message ID to reply to'),
        tone: z
          .enum(['professional', 'friendly', 'brief'])
          .optional()
          .describe('Preferred tone for the reply'),
      },
    },
    async (args) => {
      const toneInstruction = args.tone
        ? `Use a ${args.tone} tone.`
        : 'Match the tone of the original message.';

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me reply to message ${args.messageId} from account ${args.accountId}.

Follow this workflow:
1. Fetch the message using gmail_get_message with format "full"
2. Also fetch the thread context using gmail_get_thread if it's part of a conversation
3. Analyze:
   - Sender's intent (question, request, FYI, complaint, etc.)
   - Questions asked that need answers
   - Action requested
   - Urgency level
4. ${toneInstruction}
5. Suggest 2-3 reply options:
   - **Brief**: Quick acknowledgment or short answer
   - **Standard**: Complete response addressing all points
   - **Detailed**: Comprehensive reply with additional context

For each option:
- Show the suggested reply text
- Explain when this response would be appropriate

After I choose, create a draft using gmail_create_draft with proper threading headers.
Show me the preview and ask for confirmation before any sending.`,
            },
          },
        ],
      };
    },
  );

  // Prompt: extract-action-items - Find TODOs and deadlines in emails
  server.registerPrompt(
    'extract-action-items',
    {
      title: 'Extract Action Items',
      description:
        'Scan emails to find tasks, deadlines, and commitments. Returns structured list of action items.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID'),
        query: z
          .string()
          .optional()
          .describe('Optional search query to filter messages (default: recent unread)'),
        maxMessages: z
          .number()
          .optional()
          .describe('Maximum messages to analyze (default: 20)'),
      },
    },
    async (args) => {
      const query = args.query || 'is:unread newer_than:7d';
      const maxMessages = args.maxMessages || 20;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Extract action items from my emails in account ${args.accountId}.

Follow this workflow:
1. Search for messages using gmail_search_messages with query: "${query}" (limit: ${maxMessages})
2. For each message, fetch full content with gmail_get_message
3. Analyze each message for:
   - Explicit requests ("Can you...", "Please...", "I need you to...")
   - Deadlines mentioned ("by Friday", "before the meeting", specific dates)
   - Commitments made by others that require follow-up
   - Questions that need your response
   - Meeting requests or scheduling needs

4. Return a structured list of action items:

| Task | Deadline | From | Priority | Message ID |
|------|----------|------|----------|------------|
| ... | ... | ... | High/Med/Low | ... |

5. For each action item, explain:
   - Why this is an action item
   - Suggested next step

Group items by priority (High > Medium > Low) where:
- High: Explicit deadline within 48 hours or urgent language
- Medium: Clear request but flexible timing
- Low: FYI items that may need future action`,
            },
          },
        ],
      };
    },
  );

  // Prompt: categorize-emails - Suggest labels for uncategorized messages
  server.registerPrompt(
    'categorize-emails',
    {
      title: 'Categorize Emails',
      description:
        'Analyze uncategorized emails and suggest appropriate labels based on content and sender patterns.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID'),
        maxMessages: z
          .number()
          .optional()
          .describe('Maximum messages to analyze (default: 25)'),
        applyAutomatically: z
          .boolean()
          .optional()
          .describe('If true, apply labels after confirmation. If false, just show suggestions.'),
      },
    },
    async (args) => {
      const maxMessages = args.maxMessages || 25;
      const autoApply = args.applyAutomatically ?? false;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me organize uncategorized emails in account ${args.accountId}.

Follow this workflow:
1. First, get my existing labels using gmail_list_labels
2. Search for unlabeled messages: gmail_search_messages with query "-has:userlabel newer_than:14d" (limit: ${maxMessages})
3. For each message, analyze:
   - Sender domain (work vs personal vs commercial)
   - Subject line patterns
   - Content keywords
   - Whether it's part of an ongoing thread
   - Time sensitivity

4. Suggest labels from my existing set. For each message show:

   **From**: sender
   **Subject**: subject
   **Suggested Label**: [label name]
   **Reason**: Brief explanation

5. Group suggestions by label for bulk application.

${autoApply ? `After I confirm, apply the labels using gmail_modify_labels for each message.` : `Show suggestions only - I'll apply labels manually.`}

Tips:
- Prefer existing labels over suggesting new ones
- Consider creating parent/child label structures if patterns emerge
- Flag messages that don't fit any category for manual review`,
            },
          },
        ],
      };
    },
  );

  // === MCP Resources for Inspection ===

  // Resource: accounts://list - List all connected accounts
  server.registerResource(
    'accounts',
    'accounts://list',
    {
      description: 'List all connected Google accounts with their scope tiers',
      mimeType: 'application/json',
    },
    async () => {
      const accounts = accountStore.listAccounts();
      const accountsData = accounts.map((account) => ({
        id: account.id,
        email: account.email,
        scopeTier: getScopeTier(account.scopes),
        labels: account.labels,
        addedAt: account.addedAt,
      }));

      return {
        contents: [
          {
            uri: 'accounts://list',
            mimeType: 'application/json',
            text: JSON.stringify({ accounts: accountsData, count: accountsData.length }, null, 2),
          },
        ],
      };
    },
  );

  // Resource: cache://stats - Cache statistics
  server.registerResource(
    'cache-stats',
    'cache://stats',
    {
      description: 'Cache statistics including hit rate, size, and eviction counts',
      mimeType: 'application/json',
    },
    async () => {
      const stats = cache.getStats();

      return {
        contents: [
          {
            uri: 'cache://stats',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                hits: stats.hits,
                misses: stats.misses,
                evictions: stats.evictions,
                size: stats.size,
                hitRate: `${(stats.hitRate * 100).toFixed(2)}%`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

export { SCOPE_TIERS };
