import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockLabelsList = vi.fn();
const mockMessagesModify = vi.fn();
const mockMessagesTrash = vi.fn();
const mockMessagesUntrash = vi.fn();

// Mock googleapis before importing GmailClient
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        labels: {
          list: mockLabelsList,
        },
        messages: {
          list: vi.fn(),
          get: vi.fn(),
          modify: mockMessagesModify,
          trash: mockMessagesTrash,
          untrash: mockMessagesUntrash,
        },
        drafts: {
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          get: vi.fn(),
          send: vi.fn(),
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

describe('GmailClient labels and inbox management', () => {
  let mockAccountStore: AccountStore;
  let client: GmailClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAccountStore = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;

    client = new GmailClient(mockAccountStore, 'test-account-id');
  });

  describe('listLabels', () => {
    it('returns all labels with their properties', async () => {
      const mockLabelsResponse = {
        data: {
          labels: [
            {
              id: 'INBOX',
              name: 'INBOX',
              type: 'system',
              messageListVisibility: 'show',
              labelListVisibility: 'labelShow',
            },
            {
              id: 'SENT',
              name: 'SENT',
              type: 'system',
              messageListVisibility: 'hide',
              labelListVisibility: 'labelHide',
            },
            {
              id: 'Label_1',
              name: 'Work',
              type: 'user',
              color: {
                textColor: '#ffffff',
                backgroundColor: '#4285f4',
              },
            },
          ],
        },
      };

      mockLabelsList.mockResolvedValue(mockLabelsResponse);

      const result = await client.listLabels();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: 'INBOX',
        name: 'INBOX',
        type: 'system',
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
      });
      expect(result[1]).toEqual({
        id: 'SENT',
        name: 'SENT',
        type: 'system',
        messageListVisibility: 'hide',
        labelListVisibility: 'labelHide',
      });
      expect(result[2]).toEqual({
        id: 'Label_1',
        name: 'Work',
        type: 'user',
        color: {
          textColor: '#ffffff',
          backgroundColor: '#4285f4',
        },
      });

      expect(mockLabelsList).toHaveBeenCalledWith({ userId: 'me' });
    });

    it('returns empty array when no labels', async () => {
      mockLabelsList.mockResolvedValue({ data: { labels: [] } });

      const result = await client.listLabels();

      expect(result).toEqual([]);
    });

    it('handles missing labels in response', async () => {
      mockLabelsList.mockResolvedValue({ data: {} });

      const result = await client.listLabels();

      expect(result).toEqual([]);
    });
  });

  describe('modifyLabels', () => {
    it('adds labels to a message', async () => {
      const mockModifyResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['INBOX', 'STARRED'],
        },
      };

      mockMessagesModify.mockResolvedValue(mockModifyResponse);

      const result = await client.modifyLabels('msg-123', ['STARRED'], []);

      expect(result).toEqual({
        id: 'msg-123',
        threadId: 'thread-456',
        labelIds: ['INBOX', 'STARRED'],
      });

      expect(mockMessagesModify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-123',
        requestBody: {
          addLabelIds: ['STARRED'],
          removeLabelIds: [],
        },
      });
    });

    it('removes labels from a message', async () => {
      const mockModifyResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['INBOX'],
        },
      };

      mockMessagesModify.mockResolvedValue(mockModifyResponse);

      const result = await client.modifyLabels('msg-123', [], ['UNREAD']);

      expect(result).toEqual({
        id: 'msg-123',
        threadId: 'thread-456',
        labelIds: ['INBOX'],
      });

      expect(mockMessagesModify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-123',
        requestBody: {
          addLabelIds: [],
          removeLabelIds: ['UNREAD'],
        },
      });
    });

    it('adds and removes labels simultaneously', async () => {
      const mockModifyResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['IMPORTANT'],
        },
      };

      mockMessagesModify.mockResolvedValue(mockModifyResponse);

      const result = await client.modifyLabels('msg-123', ['IMPORTANT'], ['INBOX', 'UNREAD']);

      expect(result.labelIds).toContain('IMPORTANT');

      expect(mockMessagesModify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-123',
        requestBody: {
          addLabelIds: ['IMPORTANT'],
          removeLabelIds: ['INBOX', 'UNREAD'],
        },
      });
    });
  });

  describe('trashMessage', () => {
    it('moves a message to trash', async () => {
      const mockTrashResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['TRASH'],
        },
      };

      mockMessagesTrash.mockResolvedValue(mockTrashResponse);

      const result = await client.trashMessage('msg-123');

      expect(result).toEqual({
        id: 'msg-123',
        threadId: 'thread-456',
        labelIds: ['TRASH'],
      });

      expect(mockMessagesTrash).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-123',
      });
    });
  });

  describe('untrashMessage', () => {
    it('restores a message from trash', async () => {
      const mockUntrashResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['INBOX'],
        },
      };

      mockMessagesUntrash.mockResolvedValue(mockUntrashResponse);

      const result = await client.untrashMessage('msg-123');

      expect(result).toEqual({
        id: 'msg-123',
        threadId: 'thread-456',
        labelIds: ['INBOX'],
      });

      expect(mockMessagesUntrash).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-123',
      });
    });
  });

  describe('archive operation (via modifyLabels)', () => {
    it('archives by removing INBOX label', async () => {
      const mockModifyResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['IMPORTANT'],
        },
      };

      mockMessagesModify.mockResolvedValue(mockModifyResponse);

      // Archive = remove INBOX label
      const result = await client.modifyLabels('msg-123', [], ['INBOX']);

      expect(result.labelIds).not.toContain('INBOX');

      expect(mockMessagesModify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-123',
        requestBody: {
          addLabelIds: [],
          removeLabelIds: ['INBOX'],
        },
      });
    });
  });

  describe('mark read/unread operation (via modifyLabels)', () => {
    it('marks as read by removing UNREAD label', async () => {
      const mockModifyResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['INBOX'],
        },
      };

      mockMessagesModify.mockResolvedValue(mockModifyResponse);

      // Mark as read = remove UNREAD label
      const result = await client.modifyLabels('msg-123', [], ['UNREAD']);

      expect(result.labelIds).not.toContain('UNREAD');
    });

    it('marks as unread by adding UNREAD label', async () => {
      const mockModifyResponse = {
        data: {
          id: 'msg-123',
          threadId: 'thread-456',
          labelIds: ['INBOX', 'UNREAD'],
        },
      };

      mockMessagesModify.mockResolvedValue(mockModifyResponse);

      // Mark as unread = add UNREAD label
      const result = await client.modifyLabels('msg-123', ['UNREAD'], []);

      expect(result.labelIds).toContain('UNREAD');
    });
  });
});
