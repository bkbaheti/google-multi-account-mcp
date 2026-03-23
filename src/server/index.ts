import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../auth/index.js';
import { AccountStore } from '../auth/index.js';
import {
  accountNotFound,
  aliasDuplicate,
  errorResponse,
  scopeInsufficient,
  successResponse,
  toMcpError,
} from '../errors/index.js';
import { getScopeTier, hasSufficientScope, SCOPE_TIERS, type ScopeTier } from '../types/index.js';
import { cache, coerceArgs } from '../utils/index.js';
import { registerCalendarTools } from './calendar-tools.js';
import { registerDriveTools } from './drive-tools.js';
import { registerGmailTools } from './gmail-tools.js';

// Load build info (generated at build time)
interface BuildInfo {
  version: string;
  commit: string;
  buildDate: string;
}

function loadBuildInfo(): BuildInfo {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const buildInfoPath = join(__dirname, '..', 'build-info.json');
    const content = readFileSync(buildInfoPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    // Fallback if build-info.json doesn't exist (dev mode)
    return {
      version: '0.1.0',
      commit: 'dev',
      buildDate: new Date().toISOString(),
    };
  }
}

const buildInfo = loadBuildInfo();

export interface ServerOptions {
  tokenStorage: TokenStorage;
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({
    name: 'mcp-google',
    version: buildInfo.version,
  });

  const accountStore = new AccountStore(options.tokenStorage);

  // Helper to validate account exists and has sufficient scope.
  // Accepts account ID, alias, or email address.
  function validateAccountScope(
    accountIdOrAlias: string,
    requiredTier: ScopeTier,
  ):
    | { error: ReturnType<typeof errorResponse> }
    | { account: NonNullable<ReturnType<typeof accountStore.getAccount>> } {
    const account = accountStore.resolveAccount(accountIdOrAlias);
    if (!account) {
      return { error: errorResponse(accountNotFound(accountIdOrAlias).toResponse()) };
    }

    if (!hasSufficientScope(account.scopes, requiredTier)) {
      const currentTier = getScopeTier(account.scopes);
      return {
        error: errorResponse(scopeInsufficient(requiredTier, currentTier, account.id).toResponse()),
      };
    }

    return { account };
  }

  // google_version - Get server version and build info
  server.registerTool(
    'google_version',
    {
      description:
        'Get the MCP Google server version, git commit, and build date. Use this to verify which version is running.',
    },
    async () => {
      return successResponse({
        name: 'mcp-google',
        version: buildInfo.version,
        commit: buildInfo.commit,
        buildDate: buildInfo.buildDate,
      });
    },
  );

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
        alias: account.alias,
        description: account.description,
        labels: account.labels,
        scopes: account.scopes,
        addedAt: account.addedAt,
        lastUsedAt: account.lastUsedAt,
      }));

      return successResponse(result);
    },
  );

  // Helper to migrate legacy tier names to new namespaced names
  function migrateTierName(tier: string): ScopeTier {
    const LEGACY_MAP: Record<string, ScopeTier> = {
      readonly: 'mail_readonly',
      compose: 'mail_compose',
      full: 'mail_full',
      settings: 'mail_settings',
    };
    return (LEGACY_MAP[tier] ?? tier) as ScopeTier;
  }

  // google_add_account - Add a new Google account via OAuth (async flow)
  server.registerTool(
    'google_add_account',
    {
      description:
        'Add a new Google account via OAuth. Returns an authorization URL that you must show to the user. The user opens this URL in their browser to authorize. After authorization, use google_check_pending_auth to complete the process. Tiers: mail_readonly (default), mail_compose, mail_full, mail_settings, drive_readonly, drive_full, calendar_readonly, calendar_full, or all.',
      inputSchema: {
        scopeTier: z
          .enum([
            'mail_readonly',
            'mail_compose',
            'mail_full',
            'mail_settings',
            'drive_readonly',
            'drive_full',
            'calendar_readonly',
            'calendar_full',
            'all',
            // Legacy aliases
            'readonly',
            'compose',
            'full',
            'settings',
          ])
          .optional()
          .describe('Single permission tier (use scopeTiers for multiple)'),
        scopeTiers: z
          .array(
            z.enum([
              'mail_readonly',
              'mail_compose',
              'mail_full',
              'mail_settings',
              'drive_readonly',
              'drive_full',
              'calendar_readonly',
              'calendar_full',
              'all',
              // Legacy aliases
              'readonly',
              'compose',
              'full',
              'settings',
            ]),
          )
          .optional()
          .describe('Combine multiple tiers (e.g., ["mail_full", "drive_readonly"])'),
      },
    },
    async (args) => {
      // If no scope specified, prompt for selection
      if (!args.scopeTier && !args.scopeTiers) {
        return successResponse({
          needsScopeSelection: true,
          message: 'Which permissions would you like for this account?',
          options: [
            { tier: 'mail_readonly', description: 'Read and search emails only' },
            { tier: 'mail_compose', description: 'Also compose and send emails' },
            { tier: 'mail_full', description: 'Also manage labels, archive, trash' },
            { tier: 'mail_settings', description: 'Also manage filters and vacation responder' },
            { tier: 'drive_readonly', description: 'Read Google Drive files' },
            { tier: 'drive_full', description: 'Read and write Google Drive files' },
            { tier: 'calendar_readonly', description: 'Read Google Calendar events' },
            { tier: 'calendar_full', description: 'Read and write Google Calendar events' },
            { tier: 'all', description: 'All permissions across all services' },
          ],
        });
      }

      // scopeTiers takes precedence if provided; migrate any legacy tier names
      const scopeTierOrTiers: ScopeTier | ScopeTier[] = args.scopeTiers
        ? ((args.scopeTiers as string[]).map(migrateTierName) as ScopeTier[])
        : migrateTierName(args.scopeTier as string);

      try {
        // Start async auth flow - returns immediately with auth URL
        const session = accountStore.startAddAccount(scopeTierOrTiers);

        // Auto-open browser, best-effort (ignore errors for headless/SSH environments)
        open(session.authUrl).catch(() => {});

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                'Authorization required. Opening your browser...',
                'If it didn\'t open, use this URL:',
                '',
                session.authUrl,
                '',
                `Session ID: ${session.sessionId}`,
                '',
                'After authorizing, call google_check_pending_auth with the sessionId above.',
                'This session expires in 5 minutes.',
              ].join('\n'),
            },
          ],
        };
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // google_check_pending_auth - Check status of pending authorization
  server.registerTool(
    'google_check_pending_auth',
    {
      description:
        'Check the status of a pending Google account authorization. Call this after the user has completed the OAuth flow in their browser. Returns the connected account info if successful.',
      inputSchema: {
        sessionId: z.string().describe('The session ID returned by google_add_account'),
      },
    },
    async (args) => {
      const result = accountStore.checkPendingAuth(args.sessionId);

      if (result.status === 'not_found') {
        return errorResponse({
          code: 'SESSION_NOT_FOUND',
          message:
            'Authorization session not found or expired. Please start a new authorization with google_add_account.',
        });
      }

      if (result.status === 'pending') {
        return successResponse({
          status: 'pending',
          message:
            'Authorization still pending. The user needs to complete the OAuth flow in their browser.',
          instructions: 'If the user has already authorized, wait a moment and check again.',
        });
      }

      if (result.status === 'failed') {
        return errorResponse({
          code: 'AUTH_FAILED',
          message: result.error ?? 'Authorization failed',
        });
      }

      if (result.status === 'completed' && result.account) {
        return successResponse({
          status: 'completed',
          message: `Successfully connected account ${result.account.email}`,
          account: {
            id: result.account.id,
            email: result.account.email,
            scopes: result.account.scopes,
          },
        });
      }

      return errorResponse({
        code: 'UNKNOWN_ERROR',
        message: 'Unknown error checking authorization status',
      });
    },
  );

  // google_remove_account - Remove a Google account
  server.registerTool(
    'google_remove_account',
    {
      description: 'Remove a Google account and revoke its tokens',
      inputSchema: {
        accountId: z.string().describe('The account ID, alias, or email to remove'),
      },
    },
    async (args) => {
      const account = accountStore.resolveAccount(args.accountId);
      if (!account) {
        return errorResponse(accountNotFound(args.accountId).toResponse());
      }

      const removed = await accountStore.removeAccount(account.id);

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
        accountId: z.string().describe('The account ID, alias, or email to update'),
        labels: z.array(z.string()).describe('Labels to set on the account'),
      },
    },
    async (args) => {
      const account = accountStore.resolveAccount(args.accountId);
      if (!account) {
        return errorResponse(accountNotFound(args.accountId).toResponse());
      }

      const updated = accountStore.setAccountLabels(account.id, args.labels);

      if (updated) {
        return successResponse({ success: true, message: 'Labels updated', labels: args.labels });
      }

      return errorResponse(accountNotFound(args.accountId).toResponse());
    },
  );

  // google_set_account_alias - Set a friendly alias on an account
  server.registerTool(
    'google_set_account_alias',
    {
      description:
        'Set a friendly alias on a Google account (e.g., "work", "personal"). Once set, you can use the alias instead of the account ID in all tool calls. Set to empty string to remove.',
      inputSchema: {
        accountId: z.string().describe('The account ID, existing alias, or email to update'),
        alias: z
          .string()
          .describe('The alias to assign (e.g., "work", "personal"). Empty string to remove.'),
      },
    },
    async (args) => {
      const account = accountStore.resolveAccount(args.accountId);
      if (!account) {
        return errorResponse(accountNotFound(args.accountId).toResponse());
      }

      const aliasValue = args.alias.trim() === '' ? null : args.alias.trim();
      const result = accountStore.setAccountAlias(account.id, aliasValue);

      if (!result.success) {
        if (result.existingAccountId) {
          return errorResponse(
            aliasDuplicate(args.alias, result.existingAccountId).toResponse(),
          );
        }
        return errorResponse(accountNotFound(args.accountId).toResponse());
      }

      return successResponse({
        success: true,
        message: aliasValue
          ? `Alias "${aliasValue}" set for account ${account.email}`
          : `Alias removed from account ${account.email}`,
        accountId: account.id,
        alias: aliasValue,
      });
    },
  );

  // google_set_account_description - Set a human-readable description on an account
  server.registerTool(
    'google_set_account_description',
    {
      description:
        'Set a human-readable description on a Google account (e.g., "Work - engineering team", "Personal Gmail"). This description appears in google_list_accounts output to help identify accounts. Set to empty string to remove.',
      inputSchema: {
        accountId: z.string().describe('The account ID, alias, or email to update'),
        description: z
          .string()
          .describe(
            'Human-readable description (e.g., "Work - engineering team"). Empty string to remove.',
          ),
      },
    },
    async (args) => {
      const account = accountStore.resolveAccount(args.accountId);
      if (!account) {
        return errorResponse(accountNotFound(args.accountId).toResponse());
      }

      const descValue = args.description.trim() === '' ? null : args.description.trim();
      const updated = accountStore.setAccountDescription(account.id, descValue);

      if (updated) {
        return successResponse({
          success: true,
          message: descValue
            ? `Description set for account ${account.email}`
            : `Description removed from account ${account.email}`,
          accountId: account.id,
          description: descValue,
        });
      }

      return errorResponse(accountNotFound(args.accountId).toResponse());
    },
  );

  // Register all Gmail tools (gmail_search_messages, gmail_get_message, etc.)
  registerGmailTools(server, accountStore, validateAccountScope);

  // Register all Drive tools (drive_search_files, drive_get_file, etc.)
  registerDriveTools(server, accountStore, validateAccountScope);

  // Register all Calendar tools (calendar_list_calendars, calendar_create_event, etc.)
  registerCalendarTools(server, accountStore, validateAccountScope);

  // === MCP Prompts for Safe Email Workflows ===

  // Prompt: compose-email - Guided workflow for composing and sending email
  server.registerPrompt(
    'compose-email',
    {
      title: 'Compose Email',
      description:
        'Guided workflow for composing an email safely. Creates a draft, shows preview, and requires confirmation before sending.',
      argsSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
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
        maxMessages: z.number().optional().describe('Maximum messages to analyze (default: 20)'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { maxMessages: 'number' });
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
        maxMessages: z.number().optional().describe('Maximum messages to analyze (default: 25)'),
        applyAutomatically: z
          .boolean()
          .optional()
          .describe('If true, apply labels after confirmation. If false, just show suggestions.'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { maxMessages: 'number', applyAutomatically: 'boolean' });
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
        alias: account.alias,
        description: account.description,
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
