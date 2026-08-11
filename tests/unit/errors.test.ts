import { describe, expect, it } from 'vitest';
import {
  accountNotFound,
  authNotConfigured,
  capabilityGateError,
  confirmationRequired,
  draftNotFound,
  driveFileNotVisible,
  ErrorCode,
  errorResponse,
  gmailApiError,
  internalError,
  McpToolError,
  messageNotFound,
  rateLimited,
  rejectUnknownArgs,
  successResponse,
  threadNotFound,
  toDriveMcpError,
  toMcpError,
  validationError,
} from '../../src/errors/index.js';
import type { Account } from '../../src/types/index.js';

/** Minimal fixture for an Account, filling in required fields the tests here don't care about. */
function account(overrides: Partial<Account> & Pick<Account, 'id' | 'scopes'>): Account {
  return {
    email: `${overrides.id}@example.com`,
    addedAt: '2026-01-01T00:00:00.000Z',
    labels: [],
    ...overrides,
  };
}

const APPFILES_ONLY_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const DRIVE_READ_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

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
      expect(error.details).toEqual({
        retryAfterMs: 5000,
        retryable: true,
        reauthHelps: false,
        requiresHumanApproval: false,
      });
    });

    it('rateLimited creates correct error without retry info', () => {
      const error = rateLimited();
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.message).toContain('later');
      expect(error.details).toEqual({
        retryable: true,
        reauthHelps: false,
        requiresHumanApproval: false,
      });
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

  describe('rejectUnknownArgs', () => {
    const KNOWN = ['accountId', 'capabilities', 'confirm'];

    it('returns null when every argument is known', () => {
      expect(rejectUnknownArgs({ accountId: 'a1', capabilities: ['mail:read'] }, KNOWN)).toBeNull();
    });

    it('returns null for an empty args object', () => {
      expect(rejectUnknownArgs({}, KNOWN)).toBeNull();
    });

    it('rejects a plain unknown key by name, listing the valid arguments', () => {
      const error = rejectUnknownArgs({ accountId: 'a1', foo: 'bar' }, KNOWN);
      expect(error).not.toBeNull();
      expect(error?.code).toBe('VALIDATION_ERROR');
      expect(error?.message).toContain('foo');
      expect(error?.message).toContain('accountId, capabilities, confirm');
      expect(error?.details).toEqual({ unknownArgs: ['foo'] });
    });

    // The scenario defect 2 exists for: a legacy scopeTier argument must be
    // rejected by name, not silently stripped by the SDK's zod parsing -
    // and the error must tell the caller exactly what to write instead.
    it('rejects a legacy scopeTier key and maps it to its capabilities equivalent', () => {
      const error = rejectUnknownArgs({ accountId: 'a1', scopeTier: 'drive_full' }, KNOWN);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('capabilities');
      expect(error?.message).toContain('0.5.0');
      expect(error?.message).toContain('drive_full');
      expect(error?.message).toContain('drive:appfiles');
    });

    it('rejects a legacy scopeTiers array and maps every tier it contains', () => {
      const error = rejectUnknownArgs({ scopeTiers: ['mail_full', 'calendar_readonly'] }, KNOWN);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('mail:modify');
      expect(error?.message).toContain('calendar:read');
    });

    it('maps a legacy short alias tier name (pre-namespacing) too', () => {
      const error = rejectUnknownArgs({ scopeTier: 'readonly' }, KNOWN);
      expect(error?.message).toContain('mail:read');
    });

    it('maps the "all" tier to every capability it used to grant', () => {
      const error = rejectUnknownArgs({ scopeTier: 'all' }, KNOWN);
      expect(error?.message).toContain(
        JSON.stringify([
          'mail:modify',
          'mail:settings',
          'drive:read',
          'drive:appfiles',
          'calendar:read',
          'calendar:write',
        ]),
      );
    });

    it('names an unrecognized tier value without crashing', () => {
      const error = rejectUnknownArgs({ scopeTier: 'not-a-real-tier' }, KNOWN);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('not-a-real-tier');
      expect(error?.message).toContain('not a recognized scope tier');
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

    it('converts 403 errors to CAPABILITY_INSUFFICIENT', () => {
      const error = new Error('403 forbidden - insufficient permissions');
      const result = toMcpError(error);

      expect(result.code).toBe('CAPABILITY_INSUFFICIENT');
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

  // Task 9 [B3]: telling "invisible to a drive:appfiles-only grant" apart
  // from "genuinely absent", plus machine-readable recovery hints on
  // permission-class errors. See docs/superpowers/specs/2026-08-11-
  // capability-correctness-and-ux-design.md, section B2.
  describe('toDriveMcpError - invisible-vs-absent', () => {
    it('retypes a 404 on an appfiles-only account as DRIVE_FILE_NOT_VISIBLE, ambiguous: true, and tells the reader not to conclude absence', () => {
      const result = toDriveMcpError(new Error('Request failed with status 404'), {
        accountRef: 'acc1',
        accountScopes: APPFILES_ONLY_SCOPES,
        otherAccounts: [],
      });

      expect(result.code).toBe('DRIVE_FILE_NOT_VISIBLE');
      expect(result.details?.ambiguous).toBe(true);
      expect(result.message.toLowerCase()).not.toContain('the file exists');
      expect(result.message.toLowerCase()).toContain('does not mean the file does not exist');
      expect(result.message).toContain('google_reauth_account');
      expect(result.message).toContain('drive:read');
    });

    // The unverified-code hedge this task exists to pin: the spec's working
    // assumption is that Drive 404s a file outside the drive.file corpus,
    // but that could not be confirmed against documentation, so a 403 must
    // get identical treatment or the feature is dead on arrival if Drive
    // actually 403s instead.
    it('retypes a 403 on an appfiles-only account the same way', () => {
      const result = toDriveMcpError(new Error('Request failed with status 403 forbidden'), {
        accountRef: 'acc1',
        accountScopes: APPFILES_ONLY_SCOPES,
        otherAccounts: [],
      });

      expect(result.code).toBe('DRIVE_FILE_NOT_VISIBLE');
      expect(result.details?.ambiguous).toBe(true);
    });

    it('leaves a 404 on a drive:read account as the ordinary not-found, tagged ambiguous: false', () => {
      const result = toDriveMcpError(new Error('Request failed with status 404'), {
        accountRef: 'acc1',
        accountScopes: DRIVE_READ_SCOPES,
        otherAccounts: [],
      });

      expect(result.code).not.toBe('DRIVE_FILE_NOT_VISIBLE');
      expect(result.details?.ambiguous).toBe(false);
    });

    it('passes McpToolError instances through unchanged, regardless of account scopes', () => {
      const original = new McpToolError(ErrorCode.VALIDATION_ERROR, 'bad input');
      const result = toDriveMcpError(original, {
        accountRef: 'acc1',
        accountScopes: APPFILES_ONLY_SCOPES,
        otherAccounts: [],
      });

      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.details?.ambiguous).toBeUndefined();
    });
  });

  describe('driveFileNotVisible', () => {
    it('never asserts the file exists', () => {
      const message = driveFileNotVisible('acc1', APPFILES_ONLY_SCOPES).message;

      expect(message).not.toMatch(/this file exists/i);
      expect(message).toMatch(/may exist/i);
    });

    it('names alternative accounts holding drive:read and omits ones that do not', () => {
      const withRead = account({ id: 'acc-read', alias: 'work', scopes: DRIVE_READ_SCOPES });
      const without = account({ id: 'acc-no-read', scopes: APPFILES_ONLY_SCOPES });

      const error = driveFileNotVisible('acc1', APPFILES_ONLY_SCOPES, [withRead, without]);

      expect(error.details?.alternativeAccounts).toEqual([{ id: 'acc-read', alias: 'work' }]);
      expect(error.message).toContain('work');
      expect(error.message).not.toContain('acc-no-read');
    });
  });

  describe('recovery hints', () => {
    it('differ between a capability gate refusal and a rate limit', () => {
      const gateError = capabilityGateError(
        'acc1',
        { accept: ['drive:read'], remedy: 'drive:read' },
        [],
      );
      const rateLimitError = rateLimited(5000);

      expect(gateError.details).toMatchObject({ retryable: false, reauthHelps: true });
      expect(rateLimitError.details).toMatchObject({ retryable: true, reauthHelps: false });
      // Neither error sets every flag true.
      expect(Object.values(gateError.details ?? {}).every((v) => v === true)).toBe(false);
      expect(Object.values(rateLimitError.details ?? {}).every((v) => v === true)).toBe(false);
    });

    it('capabilityGateError lists other configured accounts holding the missing capability', () => {
      const holder = account({ id: 'acc-drive', alias: 'personal', scopes: DRIVE_READ_SCOPES });
      const nonHolder = account({
        id: 'acc-mail',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      });

      const error = capabilityGateError(
        'acc1',
        { accept: ['drive:read'], remedy: 'drive:read' },
        [],
        [holder, nonHolder],
      );

      expect(error.details?.alternativeAccounts).toEqual([{ id: 'acc-drive', alias: 'personal' }]);
    });
  });
});
