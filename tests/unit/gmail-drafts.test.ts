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

  describe('updateDraft', () => {
    it('updates an existing draft with new content', async () => {
      const mockDraftResponse = {
        data: {
          id: 'draft-123',
          message: {
            id: 'msg-456',
            threadId: 'thread-789',
          },
        },
      };

      mockDraftsUpdate.mockResolvedValue(mockDraftResponse);

      const result = await client.updateDraft('draft-123', {
        to: 'new-recipient@example.com',
        subject: 'Updated Subject',
        body: 'Updated body content',
      });

      expect(result).toEqual({
        id: 'draft-123',
        message: {
          id: 'msg-456',
          threadId: 'thread-789',
        },
      });

      // Verify the API was called with correct parameters
      expect(mockDraftsUpdate).toHaveBeenCalledWith({
        userId: 'me',
        id: 'draft-123',
        requestBody: {
          message: {
            raw: expect.any(String),
          },
        },
      });

      // Verify the raw message contains updated headers
      const callArgs = mockDraftsUpdate.mock.calls[0][0];
      const rawMessage = Buffer.from(callArgs.requestBody.message.raw, 'base64url').toString(
        'utf-8',
      );
      expect(rawMessage).toContain('To: new-recipient@example.com');
      expect(rawMessage).toContain('Subject: Updated Subject');
      expect(rawMessage).toContain('Updated body content');
    });

    it('preserves threadId when updating a draft in a thread', async () => {
      const mockDraftResponse = {
        data: {
          id: 'draft-123',
          message: { id: 'msg-456', threadId: 'thread-existing' },
        },
      };

      mockDraftsUpdate.mockResolvedValue(mockDraftResponse);

      await client.updateDraft('draft-123', {
        to: 'recipient@example.com',
        subject: 'Re: Original Subject',
        body: 'Updated reply content',
        threadId: 'thread-existing',
      });

      const callArgs = mockDraftsUpdate.mock.calls[0][0];
      expect(callArgs.requestBody.message.threadId).toBe('thread-existing');
    });
  });

  describe('getDraft', () => {
    it('retrieves a draft by ID', async () => {
      const mockDraftResponse = {
        data: {
          id: 'draft-123',
          message: {
            id: 'msg-456',
            threadId: 'thread-789',
            labelIds: ['DRAFT'],
            snippet: 'This is a preview...',
            payload: {
              headers: [
                { name: 'To', value: 'recipient@example.com' },
                { name: 'Subject', value: 'Test Subject' },
                { name: 'From', value: 'sender@example.com' },
              ],
              body: {
                data: Buffer.from('Test body content', 'utf-8').toString('base64url'),
              },
            },
          },
        },
      };

      mockDraftsGet.mockResolvedValue(mockDraftResponse);

      const result = await client.getDraft('draft-123');

      expect(result.id).toBe('draft-123');
      expect(result.message?.id).toBe('msg-456');
      expect(result.message?.threadId).toBe('thread-789');
      expect(result.message?.snippet).toBe('This is a preview...');
      expect(result.message?.labelIds).toContain('DRAFT');

      expect(mockDraftsGet).toHaveBeenCalledWith({
        userId: 'me',
        id: 'draft-123',
        format: 'full',
      });
    });
  });

  describe('sendDraft', () => {
    it('sends a draft and returns the sent message', async () => {
      const mockSendResponse = {
        data: {
          id: 'sent-msg-123',
          threadId: 'thread-456',
          labelIds: ['SENT'],
        },
      };

      mockDraftsSend.mockResolvedValue(mockSendResponse);

      const result = await client.sendDraft('draft-123');

      expect(result).toEqual({
        id: 'sent-msg-123',
        threadId: 'thread-456',
        labelIds: ['SENT'],
      });

      expect(mockDraftsSend).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          id: 'draft-123',
        },
      });
    });
  });

  describe('deleteDraft', () => {
    it('deletes a draft', async () => {
      mockDraftsDelete.mockResolvedValue({});

      await client.deleteDraft('draft-123');

      expect(mockDraftsDelete).toHaveBeenCalledWith({
        userId: 'me',
        id: 'draft-123',
      });
    });
  });
});
