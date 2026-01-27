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

  return server;
}

export { SCOPE_TIERS };
