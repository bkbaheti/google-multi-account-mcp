import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMessagesGet = vi.fn();
const mockThreadsGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: {
          get: mockMessagesGet,
          list: vi.fn(),
        },
        threads: {
          get: mockThreadsGet,
        },
        drafts: {
          get: vi.fn(),
        },
      },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import { GmailClient, type Message } from '../../src/gmail/index.js';
import { extractMessageHeaders } from '../../src/server/gmail-tools.js';

function messageWith(headers: Array<[string, string]>): Message {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    payload: {
      headers: headers.map(([name, value]) => ({ name, value })),
    },
  };
}

describe('extractMessageHeaders', () => {
  it('returns the recipient headers that gmail_get_draft has always returned', () => {
    const message = messageWith([
      ['From', 'sender@example.com'],
      ['To', 'primary@example.com'],
      ['Cc', 'copied@example.com, second@example.com'],
      ['Bcc', 'blind@example.com'],
      ['Subject', 'Quarterly review'],
      ['Date', 'Thu, 3 Sep 2026 10:23:12 +0530'],
    ]);

    expect(extractMessageHeaders(message)).toEqual({
      from: 'sender@example.com',
      to: 'primary@example.com',
      cc: 'copied@example.com, second@example.com',
      bcc: 'blind@example.com',
      subject: 'Quarterly review',
      date: 'Thu, 3 Sep 2026 10:23:12 +0530',
    });
  });

  it('returns the threading headers', () => {
    const message = messageWith([
      ['Reply-To', 'replies@example.com'],
      ['Message-ID', '<abc123@mail.example.com>'],
      ['In-Reply-To', '<parent456@mail.example.com>'],
    ]);

    expect(extractMessageHeaders(message)).toEqual({
      replyTo: 'replies@example.com',
      messageId: '<abc123@mail.example.com>',
      inReplyTo: '<parent456@mail.example.com>',
    });
  });

  it('matches header names case-insensitively', () => {
    const message = messageWith([
      ['message-id', '<lower@mail.example.com>'],
      ['CC', 'shouty@example.com'],
      ['reply-to', 'mixed@example.com'],
    ]);

    expect(extractMessageHeaders(message)).toMatchObject({
      messageId: '<lower@mail.example.com>',
      cc: 'shouty@example.com',
      replyTo: 'mixed@example.com',
    });
  });

  it('omits headers the message does not carry', () => {
    const result = extractMessageHeaders(messageWith([['From', 'sender@example.com']]));

    expect(result).toEqual({ from: 'sender@example.com' });
    expect('cc' in result).toBe(false);
  });

  it('omits everything for a message with no payload', () => {
    expect(extractMessageHeaders({ id: 'm', threadId: 't' })).toEqual({});
  });

  it('does not return References, which grows quadratically across a thread', () => {
    const message = messageWith([
      ['References', '<a@x> <b@x> <c@x>'],
      ['From', 'sender@example.com'],
    ]);

    expect(extractMessageHeaders(message)).toEqual({ from: 'sender@example.com' });
  });
});

describe('metadataHeaders passthrough', () => {
  let client: GmailClient;

  beforeEach(() => {
    vi.clearAllMocks();
    const accountStore = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;
    client = new GmailClient(accountStore, 'test-account-id');
    mockMessagesGet.mockResolvedValue({ data: { id: 'msg-1', threadId: 'thread-1' } });
    mockThreadsGet.mockResolvedValue({ data: { id: 'thread-1', messages: [] } });
  });

  it('forwards metadataHeaders to messages.get when format is metadata', async () => {
    await client.getMessage('msg-1', 'metadata', ['From', 'Cc', 'List-Unsubscribe']);

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg-1',
      format: 'metadata',
      metadataHeaders: ['From', 'Cc', 'List-Unsubscribe'],
    });
  });

  it('forwards metadataHeaders to threads.get when format is metadata', async () => {
    await client.getThread('thread-1', 'metadata', ['Cc']);

    expect(mockThreadsGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'thread-1',
      format: 'metadata',
      metadataHeaders: ['Cc'],
    });
  });

  it('drops metadataHeaders for non-metadata formats, where Gmail ignores it', async () => {
    await client.getMessage('msg-1', 'full', ['Cc']);

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg-1',
      format: 'full',
    });
  });

  it('omits metadataHeaders entirely when the caller supplies none', async () => {
    await client.getMessage('msg-1', 'metadata');

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg-1',
      format: 'metadata',
    });
  });

  it('ignores an empty metadataHeaders array rather than requesting zero headers', async () => {
    await client.getMessage('msg-1', 'metadata', []);

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg-1',
      format: 'metadata',
    });
  });

  it('forwards metadataHeaders through the batch path', async () => {
    await client.getMessagesBatch(['msg-1', 'msg-2'], 'metadata', ['Cc']);

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg-1',
      format: 'metadata',
      metadataHeaders: ['Cc'],
    });
    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg-2',
      format: 'metadata',
      metadataHeaders: ['Cc'],
    });
  });
});
