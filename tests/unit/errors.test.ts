import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  McpToolError,
  accountNotFound,
  authNotConfigured,
  confirmationRequired,
  draftNotFound,
  errorResponse,
  gmailApiError,
  internalError,
  messageNotFound,
  rateLimited,
  scopeInsufficient,
  successResponse,
  threadNotFound,
  toMcpError,
  validationError,
} from '../../src/errors/index.js';

describe('Error Model', () => {
  describe('McpToolError class', () => {
    it('should create error with code and message', () => {
      const error = new McpToolError(ErrorCode.ACCOUNT_NOT_FOUND, 'Account not found');
      expect(error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(error.message).toBe('Account not found');
      expect(error.details).toBeUndefined();
    });

    it('should create error with details', () => {
      const error = new McpToolError(ErrorCode.ACCOUNT_NOT_FOUND, 'Account not found', {
        accountId: 'abc123',
      });
      expect(error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(error.details).toEqual({ accountId: 'abc123' });
    });

    it('should convert to response format', () => {
      const error = new McpToolError(ErrorCode.RATE_LIMITED, 'Too many requests', {
        retryAfterMs: 5000,
      });
      const response = error.toResponse();

      expect(response).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        details: { retryAfterMs: 5000 },
      });
    });

    it('should omit details if undefined', () => {
      const error = new McpToolError(ErrorCode.INTERNAL_ERROR, 'Something went wrong');
      const response = error.toResponse();

      expect(response).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      });
      expect('details' in response).toBe(false);
    });
  });

  describe('Factory functions', () => {
    it('accountNotFound creates correct error', () => {
      const error = accountNotFound('acc-123');
      expect(error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(error.message).toContain('acc-123');
      expect(error.details).toEqual({ accountId: 'acc-123' });
    });

    it('authNotConfigured creates correct error', () => {
      const error = authNotConfigured('acc-123');
      expect(error.code).toBe('AUTH_NOT_CONFIGURED');
      expect(error.message).toContain('OAuth');
      expect(error.details).toEqual({ accountId: 'acc-123' });
    });

    it('scopeInsufficient creates correct error with upgrade hint', () => {
      const error = scopeInsufficient('compose', 'readonly', 'acc-123');
      expect(error.code).toBe('SCOPE_INSUFFICIENT');
      expect(error.message).toContain("'compose' scope");
      expect(error.message).toContain("'readonly'");
      expect(error.message).toContain('google_add_account');
      expect(error.details).toEqual({
        requiredTier: 'compose',
        currentTier: 'readonly',
        accountId: 'acc-123',
      });
    });

    it('confirmationRequired creates correct error', () => {
      const error = confirmationRequired('send this email', 'Review the draft first');
      expect(error.code).toBe('CONFIRMATION_REQUIRED');
      expect(error.message).toContain('confirm: true');
      expect(error.details).toEqual({
        operation: 'send this email',
        hint: 'Review the draft first',
      });
    });

    it('rateLimited creates correct error with retry info', () => {
      const error = rateLimited(5000);
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.message).toContain('5 seconds');
      expect(error.details).toEqual({ retryAfterMs: 5000 });
    });

    it('rateLimited creates correct error without retry info', () => {
      const error = rateLimited();
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.message).toContain('later');
      expect(error.details).toBeUndefined();
    });

    it('messageNotFound creates correct error', () => {
      const error = messageNotFound('msg-456');
      expect(error.code).toBe('MESSAGE_NOT_FOUND');
      expect(error.details).toEqual({ messageId: 'msg-456' });
    });

    it('threadNotFound creates correct error', () => {
      const error = threadNotFound('thread-789');
      expect(error.code).toBe('THREAD_NOT_FOUND');
      expect(error.details).toEqual({ threadId: 'thread-789' });
    });

    it('draftNotFound creates correct error', () => {
      const error = draftNotFound('draft-abc');
      expect(error.code).toBe('DRAFT_NOT_FOUND');
      expect(error.details).toEqual({ draftId: 'draft-abc' });
    });

    it('gmailApiError creates correct error', () => {
      const error = gmailApiError('Request failed', 500);
      expect(error.code).toBe('GMAIL_API_ERROR');
      expect(error.message).toContain('Gmail API error');
      expect(error.details).toEqual({ originalMessage: 'Request failed', statusCode: 500 });
    });

    it('validationError creates correct error', () => {
      const error = validationError('Invalid email format', 'to');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({ field: 'to' });
    });

    it('internalError creates correct error', () => {
      const error = internalError('Unexpected failure');
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.message).toBe('Unexpected failure');
    });
  });

  describe('toMcpError conversion', () => {
    it('converts McpToolError directly', () => {
      const error = accountNotFound('acc-123');
      const result = toMcpError(error);

      expect(result.code).toBe('ACCOUNT_NOT_FOUND');
      expect(result.details).toEqual({ accountId: 'acc-123' });
    });

    it('converts 404 errors to MESSAGE_NOT_FOUND', () => {
      const error = new Error('Request failed with status 404');
      const result = toMcpError(error);

      expect(result.code).toBe('MESSAGE_NOT_FOUND');
      expect(result.details?.originalError).toBe('Request failed with status 404');
    });

    it('converts 401 errors to AUTH_EXPIRED', () => {
      const error = new Error('Request failed: 401 unauthorized');
      const result = toMcpError(error);

      expect(result.code).toBe('AUTH_EXPIRED');
    });

    it('converts 403 errors to SCOPE_INSUFFICIENT', () => {
      const error = new Error('403 forbidden - insufficient permissions');
      const result = toMcpError(error);

      expect(result.code).toBe('SCOPE_INSUFFICIENT');
    });

    it('converts 429 errors to RATE_LIMITED', () => {
      const error = new Error('429 rate limit exceeded');
      const result = toMcpError(error);

      expect(result.code).toBe('RATE_LIMITED');
    });

    it('converts quota errors to RATE_LIMITED', () => {
      const error = new Error('User quota exceeded');
      const result = toMcpError(error);

      expect(result.code).toBe('RATE_LIMITED');
    });

    it('converts unknown errors to UNKNOWN_ERROR', () => {
      const error = new Error('Something unexpected happened');
      const result = toMcpError(error);

      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.message).toBe('Something unexpected happened');
    });

    it('converts non-Error values to UNKNOWN_ERROR', () => {
      const result = toMcpError('string error');

      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.message).toBe('string error');
    });
  });

  describe('Response helpers', () => {
    it('errorResponse creates correct MCP error response', () => {
      const mcpError = { code: 'TEST_ERROR', message: 'Test message' };
      const response = errorResponse(mcpError);

      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(JSON.parse(response.content[0].text)).toEqual(mcpError);
    });

    it('successResponse creates correct MCP success response', () => {
      const data = { success: true, value: 42 };
      const response = successResponse(data);

      expect('isError' in response).toBe(false);
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(JSON.parse(response.content[0].text)).toEqual(data);
    });
  });

  describe('Error codes are unique', () => {
    it('all error codes are distinct', () => {
      const codes = Object.values(ErrorCode);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });

    it('error codes follow naming convention', () => {
      const codes = Object.values(ErrorCode);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
      }
    });
  });
});
