import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDraftsCreate = vi.fn();
const mockDraftsUpdate = vi.fn();
const mockDraftsDelete = vi.fn();
const mockDraftsGet = vi.fn();
const mockDraftsSend = vi.fn();

// Mock googleapis before importing GmailClient
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        drafts: {
          create: mockDraftsCreate,
          update: mockDraftsUpdate,
          delete: mockDraftsDelete,
          get: mockDraftsGet,
          send: mockDraftsSend,
        },
        messages: {
          list: vi.fn(),
          get: vi.fn(),
        },
        threads: {
          get: vi.fn(),
        },
      },
    })),
  },
}));

import { GmailClient } from '../../src/gmail/client.js';
import type { AccountStore } from '../../src/auth/index.js';

describe('GmailClient drafts', () => {
  let mockAccountStore: AccountStore;
  let client: GmailClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAccountStore = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;

    client = new GmailClient(mockAccountStore, 'test-account-id');
  });

  describe('createDraft', () => {
    it('creates a draft with to, subject, and body', async () => {
      const mockDraftResponse = {
        data: {
          id: 'draft-123',
          message: {
            id: 'msg-456',
            threadId: 'thread-789',
          },
        },
      };

      mockDraftsCreate.mockResolvedValue(mockDraftResponse);

      const result = await client.createDraft({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test body content',
      });

      expect(result).toEqual({
        id: 'draft-123',
        message: {
          id: 'msg-456',
          threadId: 'thread-789',
        },
      });

      // Verify the API was called with correct parameters
      expect(mockDraftsCreate).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          message: {
            raw: expect.any(String),
          },
        },
      });

      // Verify the raw message contains expected headers
      const callArgs = mockDraftsCreate.mock.calls[0][0];
      const rawMessage = Buffer.from(callArgs.requestBody.message.raw, 'base64url').toString(
        'utf-8',
      );
      expect(rawMessage).toContain('To: recipient@example.com');
      expect(rawMessage).toContain('Subject: Test Subject');
      expect(rawMessage).toContain('Test body content');
    });

    it('creates a draft with cc and bcc', async () => {
      const mockDraftResponse = {
        data: {
          id: 'draft-123',
          message: { id: 'msg-456', threadId: 'thread-789' },
        },
      };

      mockDraftsCreate.mockResolvedValue(mockDraftResponse);

      await client.createDraft({
        to: 'recipient@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        subject: 'Test Subject',
        body: 'Test body',
      });

      const callArgs = mockDraftsCreate.mock.calls[0][0];
      const rawMessage = Buffer.from(callArgs.requestBody.message.raw, 'base64url').toString(
        'utf-8',
      );
      expect(rawMessage).toContain('Cc: cc@example.com');
      expect(rawMessage).toContain('Bcc: bcc@example.com');
    });

    it('creates a draft in reply to a thread', async () => {
      const mockDraftResponse = {
        data: {
          id: 'draft-123',
          message: { id: 'msg-456', threadId: 'thread-existing' },
        },
      };

      mockDraftsCreate.mockResolvedValue(mockDraftResponse);

      const result = await client.createDraft({
        to: 'recipient@example.com',
        subject: 'Re: Original Subject',
        body: 'Reply content',
        threadId: 'thread-existing',
        inReplyTo: '<original-message-id@example.com>',
        references: '<original-message-id@example.com>',
      });

      expect(result.message?.threadId).toBe('thread-existing');

      const callArgs = mockDraftsCreate.mock.calls[0][0];
      expect(callArgs.requestBody.message.threadId).toBe('thread-existing');

      const rawMessage = Buffer.from(callArgs.requestBody.message.raw, 'base64url').toString(
        'utf-8',
      );
      expect(rawMessage).toContain('In-Reply-To: <original-message-id@example.com>');
      expect(rawMessage).toContain('References: <original-message-id@example.com>');
    });
  });
});
