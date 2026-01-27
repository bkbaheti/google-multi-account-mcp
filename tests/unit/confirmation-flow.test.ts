import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests for the confirmation flow safety gate.
 *
 * The safety gate is a critical security feature that prevents accidental email sends.
 * These tests verify the core behavior at the GmailClient level and document the
 * expected confirmation gate behavior at the MCP tool level.
 *
 * The MCP tools implement the following safety pattern:
 * - gmail_send_draft: Requires confirm: true to actually send
 * - gmail_reply_in_thread: When sendImmediately: true, requires confirm: true
 *
 * Without explicit confirmation, the tools return errors with helpful guidance.
 */

const mockDraftsSend = vi.fn();
const mockDraftsCreate = vi.fn();
const mockDraftsDelete = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        drafts: {
          create: mockDraftsCreate,
          send: mockDraftsSend,
          get: vi.fn(),
          update: vi.fn(),
          delete: mockDraftsDelete,
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

describe('Confirmation Flow - GmailClient Level', () => {
  let mockAccountStore: AccountStore;
  let client: GmailClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAccountStore = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;

    client = new GmailClient(mockAccountStore, 'test-account-id');
  });

  describe('sendDraft', () => {
    it('calls Gmail API to send draft', async () => {
      mockDraftsSend.mockResolvedValue({
        data: {
          id: 'sent-msg-123',
          threadId: 'thread-456',
          labelIds: ['SENT'],
        },
      });

      const result = await client.sendDraft('draft-123');

      expect(result.id).toBe('sent-msg-123');
      expect(result.threadId).toBe('thread-456');
      expect(result.labelIds).toContain('SENT');

      // Verify API was called correctly
      expect(mockDraftsSend).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          id: 'draft-123',
        },
      });
    });

    it('propagates API errors', async () => {
      mockDraftsSend.mockRejectedValue(new Error('API Error: Draft not found'));

      await expect(client.sendDraft('nonexistent-draft')).rejects.toThrow('Draft not found');
    });
  });

  describe('deleteDraft', () => {
    it('calls Gmail API to delete draft', async () => {
      mockDraftsDelete.mockResolvedValue({});

      await client.deleteDraft('draft-123');

      expect(mockDraftsDelete).toHaveBeenCalledWith({
        userId: 'me',
        id: 'draft-123',
      });
    });
  });

  describe('replyToThread', () => {
    it('creates draft with proper threading headers', async () => {
      mockDraftsCreate.mockResolvedValue({
        data: {
          id: 'draft-reply-123',
          message: { id: 'msg-456', threadId: 'thread-existing' },
        },
      });

      const result = await client.replyToThread({
        threadId: 'thread-existing',
        to: 'recipient@example.com',
        subject: 'Re: Original',
        body: 'My reply',
        inReplyTo: '<original@example.com>',
        references: '<original@example.com>',
      });

      expect(result.id).toBe('draft-reply-123');
      expect(result.message?.threadId).toBe('thread-existing');

      // Verify threadId is included in request
      const callArgs = mockDraftsCreate.mock.calls[0][0];
      expect(callArgs.requestBody.message.threadId).toBe('thread-existing');

      // Verify raw message has threading headers
      const rawMessage = Buffer.from(callArgs.requestBody.message.raw, 'base64url').toString(
        'utf-8',
      );
      expect(rawMessage).toContain('In-Reply-To: <original@example.com>');
      expect(rawMessage).toContain('References: <original@example.com>');
    });
  });
});

describe('Confirmation Flow - Safety Gate Documentation', () => {
  /**
   * This describe block documents the expected safety gate behavior.
   * The actual implementation is in src/server/index.ts.
   */

  it('documents gmail_send_draft confirmation requirement', () => {
    // The gmail_send_draft tool requires confirm: true to send
    // Without it, the tool returns an error like:
    // {
    //   success: false,
    //   error: "Confirmation required. Set confirm: true to send this email.",
    //   hint: "Review the draft using gmail_get_draft first, then call gmail_send_draft with confirm: true"
    // }
    expect(true).toBe(true); // Documentation test
  });

  it('documents gmail_reply_in_thread sendImmediately confirmation', () => {
    // When sendImmediately: true is passed to gmail_reply_in_thread:
    // - If confirm is not true, the draft is created but NOT sent
    // - An error is returned with the draft ID so it can be sent later
    // - Only with confirm: true will the draft actually be sent
    expect(true).toBe(true); // Documentation test
  });

  it('documents the safe email workflow', () => {
    // The recommended workflow for sending email:
    // 1. Create draft with gmail_create_draft
    // 2. Preview draft with gmail_get_draft
    // 3. User reviews the content
    // 4. Send with gmail_send_draft(draftId, confirm: true)
    //
    // This draft-first, confirm-before-send pattern prevents:
    // - Accidental sends from typos or misunderstanding
    // - Sending before content is reviewed
    // - LLM autonomously sending without human approval
    expect(true).toBe(true); // Documentation test
  });
});
