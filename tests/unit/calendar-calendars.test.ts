import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCalendarListList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: { list: mockCalendarListList },
      events: {
        list: vi.fn(),
        get: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        move: vi.fn(),
      },
      freebusy: { query: vi.fn() },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import { CalendarClient } from '../../src/calendar/index.js';

describe('CalendarClient — listCalendars', () => {
  let client: CalendarClient;

  beforeEach(() => {
    vi.clearAllMocks();
    const store = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;
    client = new CalendarClient(store, 'acct-1');
  });

  describe('access role', () => {
    it.each([
      ['owner', true],
      ['writer', true],
      ['reader', false],
      ['freeBusyReader', false],
    ])('derives canEdit=%s for accessRole %s', async (accessRole, canEdit) => {
      mockCalendarListList.mockResolvedValueOnce({
        data: { items: [{ id: 'cal-1', summary: 'Team', accessRole }] },
      });

      const { calendars } = await client.listCalendars();

      expect(calendars[0]?.accessRole).toBe(accessRole);
      expect(calendars[0]?.canEdit).toBe(canEdit);
    });

    it('omits canEdit when Google reports no accessRole', async () => {
      mockCalendarListList.mockResolvedValueOnce({
        data: { items: [{ id: 'cal-1', summary: 'Team' }] },
      });

      const { calendars } = await client.listCalendars();

      expect(calendars[0]).not.toHaveProperty('canEdit');
      expect(calendars[0]).not.toHaveProperty('accessRole');
    });
  });

  describe('pagination', () => {
    it('returns nextPageToken so a long calendar list is not silently truncated', async () => {
      mockCalendarListList.mockResolvedValueOnce({
        data: { items: [], nextPageToken: 'page-2' },
      });

      const result = await client.listCalendars();

      expect(result.nextPageToken).toBe('page-2');
    });

    it('omits nextPageToken on the last page', async () => {
      mockCalendarListList.mockResolvedValueOnce({ data: { items: [] } });

      expect(await client.listCalendars()).not.toHaveProperty('nextPageToken');
    });

    it('forwards pageToken', async () => {
      mockCalendarListList.mockResolvedValueOnce({ data: { items: [] } });

      await client.listCalendars({ pageToken: 'page-2' });

      expect(mockCalendarListList.mock.calls[0][0].pageToken).toBe('page-2');
    });

    it('clamps maxResults to the Google maximum of 250', async () => {
      mockCalendarListList.mockResolvedValueOnce({ data: { items: [] } });

      await client.listCalendars({ maxResults: 5000 });

      expect(mockCalendarListList.mock.calls[0][0].maxResults).toBe(250);
    });

    it('raises maxResults below 1 up to 1', async () => {
      mockCalendarListList.mockResolvedValueOnce({ data: { items: [] } });

      await client.listCalendars({ maxResults: 0 });

      expect(mockCalendarListList.mock.calls[0][0].maxResults).toBe(1);
    });

    it('sends no parameters when none were asked for, keeping Google defaults', async () => {
      mockCalendarListList.mockResolvedValueOnce({ data: { items: [] } });

      await client.listCalendars();

      expect(mockCalendarListList.mock.calls[0][0]).toEqual({});
    });
  });

  describe('visibility fields', () => {
    it('surfaces summaryOverride, selected, hidden and deleted', async () => {
      mockCalendarListList.mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'cal-1',
              summary: 'Engineering Team Calendar',
              summaryOverride: 'Team',
              selected: true,
              hidden: false,
              deleted: false,
            },
          ],
        },
      });

      const { calendars } = await client.listCalendars();

      expect(calendars[0]).toMatchObject({
        summary: 'Engineering Team Calendar',
        summaryOverride: 'Team',
        selected: true,
        hidden: false,
        deleted: false,
      });
    });

    it('forwards showHidden and showDeleted', async () => {
      mockCalendarListList.mockResolvedValueOnce({ data: { items: [] } });

      await client.listCalendars({ showHidden: true, showDeleted: true });

      expect(mockCalendarListList.mock.calls[0][0]).toMatchObject({
        showHidden: true,
        showDeleted: true,
      });
    });
  });
});
