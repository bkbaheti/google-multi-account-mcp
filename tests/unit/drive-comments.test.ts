import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCommentsList = vi.fn();
const mockRepliesList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      files: {
        get: vi.fn(),
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        copy: vi.fn(),
        export: vi.fn(),
      },
      drives: { list: vi.fn() },
      permissions: { create: vi.fn(), update: vi.fn() },
      comments: { list: mockCommentsList },
      replies: { list: mockRepliesList },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import { DriveClient } from '../../src/drive/client.js';

describe('DriveClient — Drive comments', () => {
  let store: AccountStore;
  let client: DriveClient;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;
    client = new DriveClient(store, 'acct-1');
  });

  describe('getComments', () => {
    it('requests an explicit fields mask covering quoted text, resolved state, and replies', async () => {
      mockCommentsList.mockResolvedValueOnce({ data: { comments: [] } });

      await client.getComments('doc-1');

      expect(mockCommentsList).toHaveBeenCalledTimes(1);
      const params = mockCommentsList.mock.calls[0][0];
      expect(params.fileId).toBe('doc-1');
      expect(params.fields).toContain('quotedFileContent');
      expect(params.fields).toContain('resolved');
      expect(params.fields).toContain('replies');
      expect(params.fields).toContain('nextPageToken');
    });

    it('excludes deleted comments', async () => {
      mockCommentsList.mockResolvedValueOnce({ data: { comments: [] } });

      await client.getComments('doc-1');

      expect(mockCommentsList.mock.calls[0][0].includeDeleted).toBe(false);
    });

    it('defaults to a page size of 20', async () => {
      mockCommentsList.mockResolvedValueOnce({ data: { comments: [] } });

      await client.getComments('doc-1');

      expect(mockCommentsList.mock.calls[0][0].pageSize).toBe(20);
      expect(mockCommentsList.mock.calls[0][0].pageToken).toBeUndefined();
    });

    it('clamps page size to the Drive maximum of 100', async () => {
      mockCommentsList.mockResolvedValueOnce({ data: { comments: [] } });

      await client.getComments('doc-1', { pageSize: 500 });

      expect(mockCommentsList.mock.calls[0][0].pageSize).toBe(100);
    });

    it('raises a page size below 1 up to 1', async () => {
      mockCommentsList.mockResolvedValueOnce({ data: { comments: [] } });

      await client.getComments('doc-1', { pageSize: 0 });

      expect(mockCommentsList.mock.calls[0][0].pageSize).toBe(1);
    });

    it('raises a negative page size up to 1', async () => {
      mockCommentsList.mockResolvedValueOnce({ data: { comments: [] } });

      await client.getComments('doc-1', { pageSize: -5 });

      expect(mockCommentsList.mock.calls[0][0].pageSize).toBe(1);
    });

    it('converts a comment into the structured shape including quoted text and replies', async () => {
      mockCommentsList.mockResolvedValueOnce({
        data: {
          comments: [
            {
              id: 'c1',
              author: { displayName: 'Client Reviewer', emailAddress: 'review@client.com' },
              content: 'Please cap liability at fees paid.',
              htmlContent: '<p>Please cap liability at fees paid.</p>',
              quotedFileContent: { mimeType: 'text/html', value: 'unlimited liability' },
              anchor: 'kix.abc123',
              createdTime: '2026-06-01T10:00:00Z',
              modifiedTime: '2026-06-02T11:30:00Z',
              resolved: false,
              replies: [
                {
                  id: 'r1',
                  author: { displayName: 'Braj' },
                  content: 'Agreed, updating clause 7.',
                  createdTime: '2026-06-02T11:30:00Z',
                  modifiedTime: '2026-06-02T11:30:00Z',
                },
              ],
            },
          ],
        },
      });

      const result = await client.getComments('doc-1');

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]).toEqual({
        id: 'c1',
        author: { displayName: 'Client Reviewer', emailAddress: 'review@client.com' },
        content: 'Please cap liability at fees paid.',
        htmlContent: '<p>Please cap liability at fees paid.</p>',
        quotedText: 'unlimited liability',
        anchor: 'kix.abc123',
        createdTime: '2026-06-01T10:00:00Z',
        modifiedTime: '2026-06-02T11:30:00Z',
        resolved: false,
        replies: [
          {
            id: 'r1',
            author: { displayName: 'Braj' },
            content: 'Agreed, updating clause 7.',
            createdTime: '2026-06-02T11:30:00Z',
            modifiedTime: '2026-06-02T11:30:00Z',
          },
        ],
      });
    });

    it('treats a comment with no resolved field as unresolved and with no replies as empty', async () => {
      mockCommentsList.mockResolvedValueOnce({
        data: { comments: [{ id: 'c1', content: 'hi' }] },
      });

      const result = await client.getComments('doc-1');

      expect(result.comments[0]?.resolved).toBe(false);
      expect(result.comments[0]?.replies).toEqual([]);
      expect(result.comments[0]?.quotedText).toBeUndefined();
    });

    it('keeps resolved comments by default', async () => {
      mockCommentsList.mockResolvedValueOnce({
        data: {
          comments: [
            { id: 'c1', content: 'open', resolved: false },
            { id: 'c2', content: 'done', resolved: true },
          ],
        },
      });

      const result = await client.getComments('doc-1');

      expect(result.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    it('omits resolved comments when includeResolved is false', async () => {
      mockCommentsList.mockResolvedValueOnce({
        data: {
          comments: [
            { id: 'c1', content: 'open', resolved: false },
            { id: 'c2', content: 'done', resolved: true },
          ],
        },
      });

      const result = await client.getComments('doc-1', { includeResolved: false });

      expect(result.comments.map((c) => c.id)).toEqual(['c1']);
    });

    // Resolved comments are filtered after Drive has already paginated, so a page can
    // come back empty while unresolved comments still wait on later pages.
    it('returns an empty page but keeps nextPageToken when every comment on the page is resolved', async () => {
      mockCommentsList.mockResolvedValueOnce({
        data: {
          comments: [
            { id: 'c1', content: 'done', resolved: true },
            { id: 'c2', content: 'also done', resolved: true },
          ],
          nextPageToken: 'tok-2',
        },
      });

      const result = await client.getComments('doc-1', { includeResolved: false });

      expect(result.comments).toEqual([]);
      expect(result.nextPageToken).toBe('tok-2');
    });

    it('forwards a page token and returns the next one', async () => {
      mockCommentsList.mockResolvedValueOnce({
        data: { comments: [{ id: 'c3', content: 'page 2' }], nextPageToken: 'tok-2' },
      });

      const result = await client.getComments('doc-1', { pageToken: 'tok-1' });

      expect(mockCommentsList.mock.calls[0][0].pageToken).toBe('tok-1');
      expect(result.nextPageToken).toBe('tok-2');
    });

    it('omits nextPageToken on the last page', async () => {
      mockCommentsList.mockResolvedValueOnce({ data: { comments: [] } });

      const result = await client.getComments('doc-1');

      expect(result.nextPageToken).toBeUndefined();
    });
  });

  describe('getCommentReplies', () => {
    it('calls replies.list scoped to the parent comment, excluding deleted replies', async () => {
      mockRepliesList.mockResolvedValueOnce({ data: { replies: [] } });

      await client.getCommentReplies('doc-1', 'c1');

      expect(mockRepliesList).toHaveBeenCalledTimes(1);
      const params = mockRepliesList.mock.calls[0][0];
      expect(params.fileId).toBe('doc-1');
      expect(params.commentId).toBe('c1');
      expect(params.includeDeleted).toBe(false);
      expect(params.pageSize).toBe(20);
      expect(params.fields).toContain('replies');
      expect(params.fields).toContain('nextPageToken');
    });

    it('clamps page size to the Drive maximum of 100', async () => {
      mockRepliesList.mockResolvedValueOnce({ data: { replies: [] } });

      await client.getCommentReplies('doc-1', 'c1', { pageSize: 500 });

      expect(mockRepliesList.mock.calls[0][0].pageSize).toBe(100);
    });

    it('converts replies and returns the next page token', async () => {
      mockRepliesList.mockResolvedValueOnce({
        data: {
          replies: [
            {
              id: 'r1',
              author: { displayName: 'Braj', emailAddress: 'braj@example.com' },
              content: 'Fixed in v2.',
              createdTime: '2026-06-02T11:30:00Z',
              modifiedTime: '2026-06-02T11:31:00Z',
            },
          ],
          nextPageToken: 'tok-9',
        },
      });

      const result = await client.getCommentReplies('doc-1', 'c1', { pageToken: 'tok-8' });

      expect(mockRepliesList.mock.calls[0][0].pageToken).toBe('tok-8');
      expect(result.replies).toEqual([
        {
          id: 'r1',
          author: { displayName: 'Braj', emailAddress: 'braj@example.com' },
          content: 'Fixed in v2.',
          createdTime: '2026-06-02T11:30:00Z',
          modifiedTime: '2026-06-02T11:31:00Z',
        },
      ]);
      expect(result.nextPageToken).toBe('tok-9');
    });
  });
});
