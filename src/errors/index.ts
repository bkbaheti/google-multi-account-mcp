// Error codes following the pattern: CATEGORY_SPECIFIC
export const ErrorCode = {
  // Authentication errors
  AUTH_NOT_CONFIGURED: 'AUTH_NOT_CONFIGURED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  AUTH_REVOKED: 'AUTH_REVOKED',

  // Account errors
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_ALREADY_EXISTS: 'ACCOUNT_ALREADY_EXISTS',

  // Scope/permission errors
  SCOPE_INSUFFICIENT: 'SCOPE_INSUFFICIENT',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // Resource errors
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  LABEL_NOT_FOUND: 'LABEL_NOT_FOUND',
  FILTER_NOT_FOUND: 'FILTER_NOT_FOUND',
  FILTER_LIMIT_EXCEEDED: 'FILTER_LIMIT_EXCEEDED',

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

export function authNotConfigured(accountId: string): McpToolError {
  return new McpToolError(
    ErrorCode.AUTH_NOT_CONFIGURED,
    `OAuth credentials not configured. Please set clientId and clientSecret in config.`,
    { accountId },
  );
}

export function scopeInsufficient(
  requiredTier: string,
  currentTier: string,
  accountId: string,
): McpToolError {
  return new McpToolError(
    ErrorCode.SCOPE_INSUFFICIENT,
    `This operation requires '${requiredTier}' scope. Current account has '${currentTier}'. Use google_add_account with scopeTier='${requiredTier}' to upgrade.`,
    { requiredTier, currentTier, accountId },
  );
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

export function filterNotFound(filterId: string): McpToolError {
  return new McpToolError(ErrorCode.FILTER_NOT_FOUND, `Filter not found: ${filterId}`, { filterId });
}

export function filterLimitExceeded(): McpToolError {
  return new McpToolError(
    ErrorCode.FILTER_LIMIT_EXCEEDED,
    'Gmail filter limit exceeded. Maximum 1000 filters allowed per account.',
    { limit: 1000 },
  );
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
        code: ErrorCode.SCOPE_INSUFFICIENT,
        message: 'Permission denied. The account may need additional scopes.',
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
