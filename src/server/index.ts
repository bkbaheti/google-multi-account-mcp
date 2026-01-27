import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../auth/index.js';
import { AccountStore } from '../auth/index.js';
import { GmailClient, getHeader, getTextBody } from '../gmail/index.js';
import { SCOPE_TIERS, type ScopeTier } from '../types/index.js';

export interface ServerOptions {
  tokenStorage: TokenStorage;
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({
    name: 'mcp-google',
    version: '0.1.0',
  });

  const accountStore = new AccountStore(options.tokenStorage);

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

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Successfully added account ${account.email}`,
                  account: {
                    id: account.id,
                    email: account.email,
                    scopes: account.scopes,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Account removed' }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: 'Account not found' }, null, 2),
          },
        ],
        isError: true,
      };
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
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { success: true, message: 'Labels updated', labels: args.labels },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: 'Account not found' }, null, 2),
          },
        ],
        isError: true,
      };
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Draft created successfully',
                  draft: {
                    id: draft.id,
                    messageId: draft.message?.id,
                    threadId: draft.message?.threadId,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Draft updated successfully',
                  draft: {
                    id: draft.id,
                    messageId: draft.message?.id,
                    threadId: draft.message?.threadId,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      // Safety gate: require explicit confirmation
      if (args.confirm !== true) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error:
                    'Confirmation required. Set confirm: true to send this email. This safety gate prevents accidental sends.',
                  hint: 'Review the draft using gmail_get_draft first, then call gmail_send_draft with confirm: true',
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const client = new GmailClient(accountStore, args.accountId);
        const sent = await client.sendDraft(args.draftId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Email sent successfully',
                  sentMessage: {
                    id: sent.id,
                    threadId: sent.threadId,
                    labelIds: sent.labelIds,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      try {
        const client = new GmailClient(accountStore, args.accountId);
        await client.deleteDraft(args.draftId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Draft deleted successfully',
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      success: false,
                      error:
                        'Confirmation required to send immediately. Set confirm: true to send.',
                      hint: 'Draft was created but not sent. Use gmail_send_draft with confirm: true to send it.',
                      draft: {
                        id: draft.id,
                        messageId: draft.message?.id,
                        threadId: draft.message?.threadId,
                      },
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Send the draft
          const sent = await client.sendDraft(draft.id);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: true,
                    message: 'Reply sent successfully',
                    sentMessage: {
                      id: sent.id,
                      threadId: sent.threadId,
                      labelIds: sent.labelIds,
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Return draft info
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Reply draft created',
                  draft: {
                    id: draft.id,
                    messageId: draft.message?.id,
                    threadId: draft.message?.threadId,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      try {
        const client = new GmailClient(accountStore, args.accountId);
        const labels = await client.listLabels();

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  labels,
                  count: labels.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.modifyLabels(
          args.messageId,
          args.addLabelIds ?? [],
          args.removeLabelIds ?? [],
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Labels modified successfully',
                  updatedMessage: {
                    id: message.id,
                    threadId: message.threadId,
                    labelIds: message.labelIds,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      try {
        const client = new GmailClient(accountStore, args.accountId);

        const addLabelIds = args.markAsRead ? [] : ['UNREAD'];
        const removeLabelIds = args.markAsRead ? ['UNREAD'] : [];

        const message = await client.modifyLabels(args.messageId, addLabelIds, removeLabelIds);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: args.markAsRead ? 'Message marked as read' : 'Message marked as unread',
                  updatedMessage: {
                    id: message.id,
                    threadId: message.threadId,
                    labelIds: message.labelIds,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.modifyLabels(args.messageId, [], ['INBOX']);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Message archived (removed from INBOX)',
                  updatedMessage: {
                    id: message.id,
                    threadId: message.threadId,
                    labelIds: message.labelIds,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.trashMessage(args.messageId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Message moved to Trash',
                  updatedMessage: {
                    id: message.id,
                    threadId: message.threadId,
                    labelIds: message.labelIds,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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
      try {
        const client = new GmailClient(accountStore, args.accountId);
        const message = await client.untrashMessage(args.messageId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Message restored from Trash',
                  updatedMessage: {
                    id: message.id,
                    threadId: message.threadId,
                    labelIds: message.labelIds,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
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

  return server;
}

export { SCOPE_TIERS };
