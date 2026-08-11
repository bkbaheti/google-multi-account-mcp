import {
  CAPABILITY_INFO,
  type Capability,
  type CapabilityGate,
  capabilitiesOf,
  hasAnyCapability,
  hasCapability,
  LEGACY_SCOPE_TIER_CAPABILITIES,
} from '../auth/capabilities.js';
import type { Account } from '../types/index.js';

// Error codes following the pattern: CATEGORY_SPECIFIC
export const ErrorCode = {
  // Authentication errors
  AUTH_NOT_CONFIGURED: 'AUTH_NOT_CONFIGURED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  AUTH_REVOKED: 'AUTH_REVOKED',

  // Account errors
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_ALREADY_EXISTS: 'ACCOUNT_ALREADY_EXISTS',
  ALIAS_DUPLICATE: 'ALIAS_DUPLICATE',

  // Scope/permission errors
  CAPABILITY_INSUFFICIENT: 'CAPABILITY_INSUFFICIENT',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // Resource errors
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  LABEL_NOT_FOUND: 'LABEL_NOT_FOUND',
  FILTER_NOT_FOUND: 'FILTER_NOT_FOUND',
  FILTER_LIMIT_EXCEEDED: 'FILTER_LIMIT_EXCEEDED',

  // Drive resource errors
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FOLDER_NOT_FOUND: 'FOLDER_NOT_FOUND',
  DRIVE_API_ERROR: 'DRIVE_API_ERROR',
  DRIVE_QUOTA_EXCEEDED: 'DRIVE_QUOTA_EXCEEDED',
  // A not-found/forbidden that is genuinely ambiguous because the account's
  // only Drive read access is drive:appfiles (drive.file) - see
  // driveFileNotVisible's doc comment below.
  DRIVE_FILE_NOT_VISIBLE: 'DRIVE_FILE_NOT_VISIBLE',

  // Calendar resource errors
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  CALENDAR_NOT_FOUND: 'CALENDAR_NOT_FOUND',
  CALENDAR_API_ERROR: 'CALENDAR_API_ERROR',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',

  // External service errors
  GMAIL_API_ERROR: 'GMAIL_API_ERROR',
  OAUTH_ERROR: 'OAUTH_ERROR',

  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// Structured error response type
export interface McpError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Custom error class for structured errors
export class McpToolError extends Error {
  readonly code: ErrorCodeType;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCodeType, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.details = details ?? undefined;
  }

  toResponse(): McpError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

// Factory functions for common errors
export function accountNotFound(accountId: string): McpToolError {
  return new McpToolError(ErrorCode.ACCOUNT_NOT_FOUND, `Account not found: ${accountId}`, {
    accountId,
  });
}

export function aliasDuplicate(alias: string, existingAccountId: string): McpToolError {
  return new McpToolError(
    ErrorCode.ALIAS_DUPLICATE,
    `Alias "${alias}" is already assigned to account ${existingAccountId}. Each alias must be unique.`,
    { alias, existingAccountId },
  );
}

export function authNotConfigured(accountId: string): McpToolError {
  return new McpToolError(
    ErrorCode.AUTH_NOT_CONFIGURED,
    `OAuth authentication failed. Try re-adding the account with google_add_account.`,
    { accountId },
  );
}

/**
 * A gate refused because the account lacks a capability. The suggested remedy is
 * the account's current capabilities plus the missing ones, so following it never
 * narrows the account — reauth replaces the scope set rather than adding to it.
 */
export function insufficientCapability(
  accountRef: string,
  missing: Capability[],
  currentScopes: string[],
): McpToolError {
  const current = capabilitiesOf(currentScopes);
  const suggested = Array.from(new Set([...current, ...missing]));

  return new McpToolError(
    ErrorCode.CAPABILITY_INSUFFICIENT,
    `Account "${accountRef}" is missing capabilit${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}. ` +
      `Use google_reauth_account accountId="${accountRef}" capabilities=${JSON.stringify(suggested)} ` +
      `to add ${missing.length === 1 ? 'it' : 'them'} without losing existing access.`,
    { accountRef, missing, currentCapabilities: current, suggestedCapabilities: suggested },
  );
}

/**
 * Human-readable reason the escalation half of a gate might be needed,
 * keyed by remedy then escalation capability. Each entry must name a
 * condition under which the narrow remedy is insufficient for the call
 * being made right now — not a reason some other, future call might need
 * more (see the `escalation` field's doc comment on CapabilityGate for why
 * that distinction matters). Add an entry here whenever a new gate is given
 * an `escalation`; the generic fallback below exists only for a gate that
 * hasn't been given a specific entry yet, and reads as exactly the
 * "you might want more for later" upsell this field must never be.
 *
 * - drive:appfiles → drive:read: drive.file grants access only to files
 *   this server created (or that the user explicitly opened with it via a
 *   picker) — verified against Google's drive.file scope description. A
 *   file someone else shared with the account was reached neither way, so
 *   it is invisible to drive:appfiles regardless of how many other files
 *   the account has touched through this server. That is a property of
 *   the file the current call names, not of some future call.
 */
const ESCALATION_CONDITIONS: Partial<Record<Capability, Partial<Record<Capability, string>>>> = {
  'drive:appfiles': {
    'drive:read':
      'the file was not created by this server and was not explicitly opened with it (for example, it was shared with the account by someone else)',
  },
};

function escalationCondition(remedy: Capability, escalation: Capability): string {
  return (
    ESCALATION_CONDITIONS[remedy]?.[escalation] ??
    `this account will also need ${escalation} for operations ${remedy} does not cover`
  );
}

/** An account named in a `alternativeAccounts` recovery hint - just enough to act on (id, and alias when set), not the full account record. */
export interface AlternativeAccount {
  id: string;
  alias?: string;
}

/**
 * Other configured accounts that already hold at least one of the given
 * capabilities - the only recovery path from a permission error that costs
 * the caller zero consent screens, and the reason a multi-account broker has
 * an edge here over a single-account client. `otherAccounts` must already
 * exclude the account the error is about; this function does not know which
 * account that is, only what it's missing.
 */
function alternativeAccountsHolding(
  capabilities: Capability[],
  otherAccounts: Account[],
): AlternativeAccount[] {
  return otherAccounts
    .filter((account) => hasAnyCapability(account.scopes, capabilities))
    .map((account) =>
      account.alias ? { id: account.id, alias: account.alias } : { id: account.id },
    );
}

/**
 * A gate refused because the account lacks a capability. Bare-capability
 * callers are normalized to a single-member gate (see `normalizeGate`), so
 * this always has a `remedy` and, sometimes, an `escalation`.
 *
 * The executable `google_reauth_account` line contains the account's current
 * capabilities plus `gate.remedy` only — the narrowest capability that
 * satisfies the operation — so following it can never over-grant. When the
 * gate also has an `escalation` (a broader capability that satisfies the
 * same operation, or ones like it), a second, separately executable line
 * offers it, preceded by the condition under which the narrow remedy will
 * not be enough.
 *
 * `otherAccounts` (defaulting to none) must already exclude the account this
 * error is about; any of them holding a member of `gate.accept` is surfaced
 * as `alternativeAccounts` — see alternativeAccountsHolding's doc comment
 * for why that's worth surfacing at all. The recovery-hint booleans are set
 * for what a capability gate refusal actually is: reauth can fix it
 * (`reauthHelps: true`), completing reauth needs a human at an OAuth
 * consent screen (`requiresHumanApproval: true`), and simply retrying the
 * same call again will not (`retryable: false`) — contrast `rateLimited`
 * below, where retrying *is* the fix and reauth is not.
 */
export function capabilityGateError(
  accountRef: string,
  gate: CapabilityGate,
  currentScopes: string[],
  otherAccounts: Account[] = [],
): McpToolError {
  const current = capabilitiesOf(currentScopes);
  const remedyCapabilities = Array.from(new Set([...current, gate.remedy]));
  const alternativeAccounts = alternativeAccountsHolding(gate.accept, otherAccounts);

  let message =
    `Account "${accountRef}" is missing capability: ${gate.remedy}. ` +
    `Use google_reauth_account accountId="${accountRef}" capabilities=${JSON.stringify(remedyCapabilities)} ` +
    `to add it without losing existing access.`;

  let escalationCapabilities: Capability[] | undefined;
  if (gate.escalation) {
    escalationCapabilities = Array.from(new Set([...current, gate.escalation]));
    message +=
      `\n\nIf ${escalationCondition(gate.remedy, gate.escalation)}, ${gate.remedy} alone will not be enough. ` +
      `Use google_reauth_account accountId="${accountRef}" capabilities=${JSON.stringify(escalationCapabilities)} instead.`;
  }

  if (alternativeAccounts.length > 0) {
    const names = alternativeAccounts.map((a) => a.alias ?? a.id).join(', ');
    message +=
      `\n\nAlternatively, these already-connected account(s) already hold ${gate.remedy} and could be ` +
      `used for this call directly, at no cost of a new consent screen: ${names}.`;
  }

  return new McpToolError(ErrorCode.CAPABILITY_INSUFFICIENT, message, {
    accountRef,
    missing: [gate.remedy],
    currentCapabilities: current,
    suggestedCapabilities: remedyCapabilities,
    ...(gate.escalation && { escalation: gate.escalation, escalationCapabilities }),
    retryable: false,
    reauthHelps: true,
    requiresHumanApproval: true,
    alternativeAccounts,
  });
}

export function confirmationRequired(operation: string, hint?: string): McpToolError {
  return new McpToolError(
    ErrorCode.CONFIRMATION_REQUIRED,
    `Confirmation required. Set confirm: true to ${operation}.`,
    { operation, ...(hint && { hint }) },
  );
}

// The contrast case for capabilityGateError's recovery hints above: a rate
// limit is the mirror image of a capability gate. Waiting and retrying the
// same call again is the actual fix (`retryable: true`), no human needs to
// touch an OAuth consent screen (`requiresHumanApproval: false`), and adding
// capabilities via reauth does nothing for it (`reauthHelps: false`).
export function rateLimited(retryAfterMs?: number): McpToolError {
  return new McpToolError(
    ErrorCode.RATE_LIMITED,
    retryAfterMs
      ? `Rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`
      : 'Rate limited. Please try again later.',
    {
      ...(retryAfterMs !== undefined && { retryAfterMs }),
      retryable: true,
      reauthHelps: false,
      requiresHumanApproval: false,
    },
  );
}

export function gmailApiError(originalMessage: string, statusCode?: number): McpToolError {
  return new McpToolError(ErrorCode.GMAIL_API_ERROR, `Gmail API error: ${originalMessage}`, {
    originalMessage,
    ...(statusCode && { statusCode }),
  });
}

export function messageNotFound(messageId: string): McpToolError {
  return new McpToolError(ErrorCode.MESSAGE_NOT_FOUND, `Message not found: ${messageId}`, {
    messageId,
  });
}

export function threadNotFound(threadId: string): McpToolError {
  return new McpToolError(ErrorCode.THREAD_NOT_FOUND, `Thread not found: ${threadId}`, {
    threadId,
  });
}

export function draftNotFound(draftId: string): McpToolError {
  return new McpToolError(ErrorCode.DRAFT_NOT_FOUND, `Draft not found: ${draftId}`, { draftId });
}

export function validationError(message: string, field?: string): McpToolError {
  return new McpToolError(ErrorCode.VALIDATION_ERROR, message, field ? { field } : undefined);
}

/**
 * Reject arguments a tool's schema doesn't declare. The MCP SDK's default
 * (non-strict) zod object parsing silently STRIPS unknown keys before a
 * handler ever runs - harmless for a stray typo, but dangerous for
 * `scopeTier` / `scopeTiers`, the pre-0.5.0 google_add_account /
 * google_reauth_account arguments removed in commit 6387f1c: a saved
 * workflow, an older client with a cached tool schema, or a user following
 * the still-current README calls the tool with `scopeTier`, the key is
 * stripped, and (for reauth) the account is silently re-granted its
 * *existing* scopes - a completed OAuth round trip and a success message
 * for a call that changed nothing.
 *
 * For this to see anything, the tool's inputSchema must be built with
 * `.passthrough()` - a plain raw-shape schema (the object-literal shorthand
 * used elsewhere in this file) strips unknown keys before the handler is
 * even invoked, so there would be nothing left here to check. A `.strict()`
 * schema was considered instead: it does make the SDK reject the call, but
 * only with a generic "Unrecognized key" message thrown before the handler
 * runs, in the SDK's own error envelope rather than this codebase's
 * `{code, message, details}` shape - and it cannot name which capabilities
 * a given legacy tier string maps to, which is the whole point here.
 */
export function rejectUnknownArgs(
  rawArgs: Record<string, unknown>,
  knownKeys: readonly string[],
): McpToolError | null {
  const unknown = Object.keys(rawArgs).filter((key) => !knownKeys.includes(key));
  if (unknown.length === 0) return null;

  const legacyTierKeys = unknown.filter((key) => key === 'scopeTier' || key === 'scopeTiers');
  if (legacyTierKeys.length > 0) {
    const hints = legacyTierKeys.flatMap((key) => {
      const raw = rawArgs[key];
      const tiers = (Array.isArray(raw) ? raw : [raw]).filter(
        (value): value is string => typeof value === 'string',
      );
      return tiers.map((tier) => {
        const mapped = LEGACY_SCOPE_TIER_CAPABILITIES[tier];
        return mapped
          ? `"${tier}" -> capabilities: ${JSON.stringify(mapped)}`
          : `"${tier}" is not a recognized scope tier`;
      });
    });
    return new McpToolError(
      ErrorCode.VALIDATION_ERROR,
      `${legacyTierKeys.join('/')} ${legacyTierKeys.length === 1 ? 'was' : 'were'} removed in 0.5.0. Use capabilities instead.` +
        (hints.length > 0 ? ` ${hints.join('; ')}.` : ''),
      { unknownArgs: unknown },
    );
  }

  return new McpToolError(
    ErrorCode.VALIDATION_ERROR,
    `Unknown argument(s): ${unknown.join(', ')}. Valid arguments are: ${knownKeys.join(', ')}.`,
    { unknownArgs: unknown },
  );
}

export function filterNotFound(filterId: string): McpToolError {
  return new McpToolError(ErrorCode.FILTER_NOT_FOUND, `Filter not found: ${filterId}`, {
    filterId,
  });
}

export function filterLimitExceeded(): McpToolError {
  return new McpToolError(
    ErrorCode.FILTER_LIMIT_EXCEEDED,
    'Gmail filter limit exceeded. Maximum 1000 filters allowed per account.',
    { limit: 1000 },
  );
}

export function fileNotFound(fileId: string): McpToolError {
  return new McpToolError(ErrorCode.FILE_NOT_FOUND, `File not found: ${fileId}`, { fileId });
}

export function folderNotFound(folderId: string): McpToolError {
  return new McpToolError(ErrorCode.FOLDER_NOT_FOUND, `Folder not found: ${folderId}`, {
    folderId,
  });
}

export function driveApiError(originalMessage: string, statusCode?: number): McpToolError {
  return new McpToolError(ErrorCode.DRIVE_API_ERROR, `Drive API error: ${originalMessage}`, {
    originalMessage,
    ...(statusCode && { statusCode }),
  });
}

export function driveQuotaExceeded(): McpToolError {
  return new McpToolError(ErrorCode.DRIVE_QUOTA_EXCEEDED, 'Drive storage quota exceeded.');
}

/**
 * A Drive not-found/forbidden that is genuinely ambiguous because the
 * account's only Drive read access is drive:appfiles (drive.file): that
 * scope's reach is per-file (see CAPABILITY_INFO['drive:appfiles'].reach),
 * so a failure here means either "this file does not exist" or "this file
 * exists but was never created by, or explicitly opened with, this server"
 * — and Drive's API gives an appfiles-only caller no way to tell those
 * apart. See toDriveMcpError below for where this gets selected instead of
 * a plain not-found.
 *
 * Known false positive, accepted deliberately: a genuinely mistyped or
 * already-deleted file ID fails identically, so this will sometimes point
 * an account at a reauth it doesn't actually need. That trade is
 * intentional — a spurious reauth hint is visible, cheap, and reversible;
 * a confident "that file/document doesn't exist" about something a client
 * actually shared is none of those, and is the exact failure mode this
 * whole feature exists to prevent (see the design doc, section B2). The
 * message below is worded to match: it never asserts the file exists, only
 * that its absence is unproven.
 */
export function driveFileNotVisible(
  accountRef: string,
  currentScopes: string[],
  otherAccounts: Account[] = [],
): McpToolError {
  const current = capabilitiesOf(currentScopes);
  const suggested = Array.from(new Set<Capability>([...current, 'drive:read']));
  const alternativeAccounts = alternativeAccountsHolding(['drive:read'], otherAccounts);
  const reach = CAPABILITY_INFO['drive:appfiles'].reach;

  let message =
    `Account "${accountRef}" holds only drive:appfiles for Drive, which reaches ${reach.toLowerCase()} ` +
    `This call failed, but that does NOT mean the file does not exist — it may exist and simply sit ` +
    `outside this grant's reach. Do not report it as missing or nonexistent; say the view from this ` +
    `account is inconclusive. Use google_reauth_account accountId="${accountRef}" ` +
    `capabilities=${JSON.stringify(suggested)} to add drive:read, which can see every file the account ` +
    `can see, and check again.`;

  if (alternativeAccounts.length > 0) {
    const names = alternativeAccounts.map((a) => a.alias ?? a.id).join(', ');
    message +=
      `\n\nAlternatively, these already-connected account(s) already hold drive:read and may be able ` +
      `to see this file directly, at no cost of a new consent screen: ${names}.`;
  }

  return new McpToolError(ErrorCode.DRIVE_FILE_NOT_VISIBLE, message, {
    accountRef,
    ambiguous: true,
    currentCapabilities: current,
    suggestedCapabilities: suggested,
    retryable: false,
    reauthHelps: true,
    requiresHumanApproval: true,
    alternativeAccounts,
  });
}

export function eventNotFound(eventId: string): McpToolError {
  return new McpToolError(ErrorCode.EVENT_NOT_FOUND, `Event not found: ${eventId}`, { eventId });
}

export function calendarNotFound(calendarId: string): McpToolError {
  return new McpToolError(ErrorCode.CALENDAR_NOT_FOUND, `Calendar not found: ${calendarId}`, {
    calendarId,
  });
}

export function calendarApiError(originalMessage: string, statusCode?: number): McpToolError {
  return new McpToolError(ErrorCode.CALENDAR_API_ERROR, `Calendar API error: ${originalMessage}`, {
    originalMessage,
    ...(statusCode && { statusCode }),
  });
}

export function internalError(message: string): McpToolError {
  return new McpToolError(ErrorCode.INTERNAL_ERROR, message);
}

// Convert any error to a structured McpError
export function toMcpError(error: unknown): McpError {
  if (error instanceof McpToolError) {
    return error.toResponse();
  }

  if (error instanceof Error) {
    // Check for common Google API error patterns
    const message = error.message;

    if (message.includes('404') || message.includes('not found')) {
      return {
        code: ErrorCode.MESSAGE_NOT_FOUND,
        message: message,
        details: { originalError: message },
      };
    }

    if (message.includes('401') || message.includes('unauthorized')) {
      return {
        code: ErrorCode.AUTH_EXPIRED,
        message: 'Authentication expired or invalid. Try re-adding the account.',
        details: { originalError: message },
      };
    }

    if (message.includes('403') || message.includes('forbidden')) {
      return {
        code: ErrorCode.CAPABILITY_INSUFFICIENT,
        message: 'Permission denied. The account may need additional capabilities.',
        details: { originalError: message },
      };
    }

    if (message.includes('429') || message.includes('quota') || message.includes('rate')) {
      return {
        code: ErrorCode.RATE_LIMITED,
        message: 'Rate limited. Please try again later.',
        details: { originalError: message },
      };
    }

    return {
      code: ErrorCode.UNKNOWN_ERROR,
      message: message,
    };
  }

  return {
    code: ErrorCode.UNKNOWN_ERROR,
    message: String(error),
  };
}

/** Context a Drive read tool has on hand at its catch block, needed to tell an invisible-to-this-grant failure apart from a genuine one. */
export interface DriveReadErrorContext {
  /** The accountId/alias/email as the caller passed it, reused verbatim in the executable google_reauth_account line. */
  accountRef: string;
  /** Scopes currently granted to the account the failing call was made against. */
  accountScopes: string[];
  /** Every other configured account, already including (or excluding, doesn't matter) the failing one — alternativeAccountsHolding only needs it to look up capabilities, and the failing account's own capabilities are already known not to satisfy the gate that let this call through drive:appfiles. */
  otherAccounts: Account[];
}

/**
 * Same conversion as toMcpError, with one retype: on an account whose only
 * Drive read access is drive:appfiles (not drive:read), a not-found/
 * forbidden is genuinely ambiguous (see driveFileNotVisible's doc comment)
 * and becomes DRIVE_FILE_NOT_VISIBLE with `ambiguous: true` instead of a
 * bare not-found. An account holding drive:read gets the ordinary
 * classification, now tagged `ambiguous: false` — for that account a
 * not-found is real information, and `false` (not just the field's
 * absence) licenses an agent to actually rely on that and stop looking.
 *
 * UNVERIFIED, read before touching this branch: the design doc's working
 * assumption is that Drive hides existence and returns 404 for a file
 * outside the drive.file corpus, but that could not be confirmed against
 * documentation — it needs a live drive:appfiles-only token, which is what
 * the (still in progress) E2E harness exists to provide. So this checks
 * for EITHER 404 or 403 rather than only 404. Getting this wrong in the
 * permissive direction (treating a 403 as ambiguous when Drive never
 * actually sends one here) costs an occasionally-unneeded reauth hint.
 * Getting it wrong in the strict direction (404-only, when Drive actually
 * 403s) would silently disable this entire feature for the exact case it
 * was built for. Handling both is the deliberately cheaper mistake.
 */
export function toDriveMcpError(error: unknown, context: DriveReadErrorContext): McpError {
  if (error instanceof McpToolError) {
    return error.toResponse();
  }

  const appfilesOnly =
    hasCapability(context.accountScopes, 'drive:appfiles') &&
    !hasCapability(context.accountScopes, 'drive:read');

  if (appfilesOnly && error instanceof Error) {
    const message = error.message;
    const looksNotFoundOrForbidden =
      message.includes('404') ||
      message.includes('not found') ||
      message.includes('403') ||
      message.includes('forbidden');

    if (looksNotFoundOrForbidden) {
      return driveFileNotVisible(
        context.accountRef,
        context.accountScopes,
        context.otherAccounts,
      ).toResponse();
    }
  }

  const result = toMcpError(error);
  if (
    result.code === ErrorCode.MESSAGE_NOT_FOUND ||
    result.code === ErrorCode.CAPABILITY_INSUFFICIENT
  ) {
    return { ...result, details: { ...result.details, ambiguous: false } };
  }
  return result;
}

// Helper to create MCP tool error response content
export function errorResponse(error: McpError): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(error, null, 2),
      },
    ],
    isError: true,
  };
}

// Helper to create successful response content
export function successResponse(data: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
