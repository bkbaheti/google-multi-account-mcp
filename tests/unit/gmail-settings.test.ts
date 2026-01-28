import { beforeEach, describe, expect, it, vi } from 'vitest';

// Define mock functions at module level
const mockFiltersCreate = vi.fn();
const mockFiltersDelete = vi.fn();
const mockFiltersList = vi.fn();
const mockGetVacation = vi.fn();
const mockUpdateVacation = vi.fn();

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        settings: {
          filters: {
            list: mockFiltersList,
            create: mockFiltersCreate,
            delete: mockFiltersDelete,
          },
          getVacation: mockGetVacation,
          updateVacation: mockUpdateVacation,
        },
        messages: {
          list: vi.fn(),
          get: vi.fn(),
        },
      },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import { GmailClient } from '../../src/gmail/client.js';

describe('GmailClient - Settings Methods', () => {
  let client: GmailClient;
  let mockAccountStore: AccountStore;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock account store
    mockAccountStore = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;

    client = new GmailClient(mockAccountStore, 'test-account-id');
  });

  describe('listFilters', () => {
    it('returns empty array when no filters exist', async () => {
      mockFiltersList.mockResolvedValue({
        data: { filter: [] },
      });

      const filters = await client.listFilters();

      expect(filters).toEqual([]);
      expect(mockFiltersList).toHaveBeenCalledWith({
        userId: 'me',
      });
    });

    it('returns filters with criteria and action', async () => {
      mockFiltersList.mockResolvedValue({
        data: {
          filter: [
            {
              id: 'filter-1',
              criteria: {
                from: 'newsletter@example.com',
                hasAttachment: false,
              },
              action: {
                addLabelIds: ['Label_1'],
                removeLabelIds: ['INBOX'],
              },
            },
          ],
        },
      });

      const filters = await client.listFilters();

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        id: 'filter-1',
        criteria: {
          from: 'newsletter@example.com',
          hasAttachment: false,
        },
        action: {
          addLabelIds: ['Label_1'],
          removeLabelIds: ['INBOX'],
        },
      });
    });

    it('handles null filter array', async () => {
      mockFiltersList.mockResolvedValue({
        data: { filter: null },
      });

      const filters = await client.listFilters();

      expect(filters).toEqual([]);
    });
  });

  describe('createFilter', () => {
    it('creates filter with basic criteria', async () => {
      mockFiltersCreate.mockResolvedValue({
        data: {
          id: 'new-filter-1',
          criteria: { from: 'boss@work.com' },
          action: { addLabelIds: ['IMPORTANT'] },
        },
      });

      const filter = await client.createFilter(
        { from: 'boss@work.com' },
        { addLabelIds: ['IMPORTANT'] },
      );

      expect(filter).toEqual({
        id: 'new-filter-1',
        criteria: { from: 'boss@work.com' },
        action: { addLabelIds: ['IMPORTANT'] },
      });
      expect(mockFiltersCreate).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          criteria: { from: 'boss@work.com' },
          action: { addLabelIds: ['IMPORTANT'] },
        },
      });
    });

    it('creates filter with all criteria fields', async () => {
      const criteria = {
        from: 'sender@example.com',
        to: 'me@example.com',
        subject: 'Important',
        query: 'has:attachment',
        negatedQuery: 'is:spam',
        hasAttachment: true,
        excludeChats: true,
        size: 10000,
        sizeComparison: 'larger' as const,
      };

      mockFiltersCreate.mockResolvedValue({
        data: {
          id: 'filter-with-all-criteria',
          criteria,
          action: { forward: 'backup@example.com' },
        },
      });

      const filter = await client.createFilter(criteria, { forward: 'backup@example.com' });

      expect(filter.id).toBe('filter-with-all-criteria');
      expect(mockFiltersCreate).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          criteria,
          action: { forward: 'backup@example.com' },
        },
      });
    });
  });

  describe('deleteFilter', () => {
    it('deletes filter by ID', async () => {
      mockFiltersDelete.mockResolvedValue({
        data: {},
      });

      await client.deleteFilter('filter-to-delete');

      expect(mockFiltersDelete).toHaveBeenCalledWith({
        userId: 'me',
        id: 'filter-to-delete',
      });
    });
  });

  describe('getVacation', () => {
    it('returns vacation settings when disabled', async () => {
      mockGetVacation.mockResolvedValue({
        data: {
          enableAutoReply: false,
        },
      });

      const vacation = await client.getVacation();

      expect(vacation).toEqual({
        enableAutoReply: false,
      });
    });

    it('returns full vacation settings when enabled', async () => {
      mockGetVacation.mockResolvedValue({
        data: {
          enableAutoReply: true,
          responseSubject: 'Out of Office',
          responseBodyPlainText: 'I am currently out of the office.',
          responseBodyHtml: '<p>I am currently out of the office.</p>',
          restrictToContacts: true,
          restrictToDomain: false,
          startTime: '1704067200000',
          endTime: '1704672000000',
        },
      });

      const vacation = await client.getVacation();

      expect(vacation).toEqual({
        enableAutoReply: true,
        responseSubject: 'Out of Office',
        responseBodyPlainText: 'I am currently out of the office.',
        responseBodyHtml: '<p>I am currently out of the office.</p>',
        restrictToContacts: true,
        restrictToDomain: false,
        startTime: 1704067200000,
        endTime: 1704672000000,
      });
    });
  });

  describe('setVacation', () => {
    it('enables vacation responder', async () => {
      mockUpdateVacation.mockResolvedValue({
        data: {
          enableAutoReply: true,
          responseSubject: 'On Vacation',
          responseBodyPlainText: 'I will respond when I return.',
        },
      });

      const vacation = await client.setVacation({
        enableAutoReply: true,
        responseSubject: 'On Vacation',
        responseBodyPlainText: 'I will respond when I return.',
      });

      expect(vacation.enableAutoReply).toBe(true);
      expect(mockUpdateVacation).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          enableAutoReply: true,
          responseSubject: 'On Vacation',
          responseBodyPlainText: 'I will respond when I return.',
        },
      });
    });

    it('disables vacation responder', async () => {
      mockUpdateVacation.mockResolvedValue({
        data: {
          enableAutoReply: false,
        },
      });

      const vacation = await client.setVacation({
        enableAutoReply: false,
      });

      expect(vacation.enableAutoReply).toBe(false);
      expect(mockUpdateVacation).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          enableAutoReply: false,
        },
      });
    });

    it('sets vacation with time range', async () => {
      const startTime = Date.now();
      const endTime = startTime + 7 * 24 * 60 * 60 * 1000; // 1 week

      mockUpdateVacation.mockResolvedValue({
        data: {
          enableAutoReply: true,
          startTime: String(startTime),
          endTime: String(endTime),
        },
      });

      await client.setVacation({
        enableAutoReply: true,
        startTime,
        endTime,
      });

      expect(mockUpdateVacation).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          enableAutoReply: true,
          startTime: String(startTime),
          endTime: String(endTime),
        },
      });
    });
  });
});
