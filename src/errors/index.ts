import {
  type Capability,
  type CapabilityGate,
  capabilitiesOf,
  LEGACY_SCOPE_TIER_CAPABILITIES,
} from '../auth/capabilities.js';

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
 */
export function capabilityGateError(
  accountRef: string,
  gate: CapabilityGate,
  currentScopes: string[],
): McpToolError {
  const current = capabilitiesOf(currentScopes);
  const remedyCapabilities = Array.from(new Set([...current, gate.remedy]));

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

  return new McpToolError(ErrorCode.CAPABILITY_INSUFFICIENT, message, {
    accountRef,
    missing: [gate.remedy],
    currentCapabilities: current,
    suggestedCapabilities: remedyCapabilities,
    ...(gate.escalation && { escalation: gate.escalation, escalationCapabilities }),
  });
}

export function confirmationRequired(operation: string, hint?: string): McpToolError {
  return new McpToolError(
    ErrorCode.CONFIRMATION_REQUIRED,
    `Confirmation required. Set confirm: true to ${operation}.`,
    { operation, ...(hint && { hint }) },
  );
}

export function rateLimited(retryAfterMs?: number): McpToolError {
  return new McpToolError(
    ErrorCode.RATE_LIMITED,
    retryAfterMs
      ? `Rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`
      : 'Rate limited. Please try again later.',
    retryAfterMs ? { retryAfterMs } : undefined,
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
