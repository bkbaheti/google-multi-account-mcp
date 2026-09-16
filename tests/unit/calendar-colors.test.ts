import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventsInsert = vi.fn();
const mockEventsPatch = vi.fn();
const mockEventsGet = vi.fn();
const mockEventsList = vi.fn();
const mockColorsGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: { list: vi.fn() },
      colors: { get: mockColorsGet },
      events: {
        list: mockEventsList,
        get: mockEventsGet,
        insert: mockEventsInsert,
        update: vi.fn(),
        patch: mockEventsPatch,
        delete: vi.fn(),
        move: vi.fn(),
      },
      freebusy: { query: vi.fn() },
    })),
  },
}));

import type { AccountStore } from '../../src/auth/index.js';
import {
  CalendarClient,
  EVENT_COLOR_NAMES,
  resolveEventColorId,
} from '../../src/calendar/index.js';

const START = { dateTime: '2026-09-10T09:00:00Z' };
const END = { dateTime: '2026-09-10T10:00:00Z' };

function baseEvent(overrides: Record<string, unknown> = {}) {
  return { id: 'evt-1', summary: 'Standup', ...overrides };
}

/** The palette Google actually returns, captured from a live colors.get. */
const LIVE_PALETTE = {
  kind: 'calendar#colors',
  updated: '2012-02-14T00:00:00.000Z',
  event: {
    '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
    '2': { background: '#7ae7bf', foreground: '#1d1d1d' },
    '3': { background: '#dbadff', foreground: '#1d1d1d' },
    '4': { background: '#ff887c', foreground: '#1d1d1d' },
    '5': { background: '#fbd75b', foreground: '#1d1d1d' },
    '6': { background: '#ffb878', foreground: '#1d1d1d' },
    '7': { background: '#46d6db', foreground: '#1d1d1d' },
    '8': { background: '#e1e1e1', foreground: '#1d1d1d' },
    '9': { background: '#5484ed', foreground: '#1d1d1d' },
    '10': { background: '#51b749', foreground: '#1d1d1d' },
    '11': { background: '#dc2127', foreground: '#1d1d1d' },
  },
  calendar: {
    '1': { background: '#ac725e', foreground: '#1d1d1d' },
    '2': { background: '#d06b64', foreground: '#1d1d1d' },
  },
};

describe('Event colours', () => {
  let store: AccountStore;
  let client: CalendarClient;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;
    client = new CalendarClient(store, 'acct-1');
  });

  // === A. The read path ===
  //
  // Google has always returned colorId; convertCalendarEvent's field whitelist dropped it,
  // exactly as it dropped Cc (v0.8.0) and conferenceData (v0.9.0).

  describe('reading colorId', () => {
    it('surfaces colorId from a single event', async () => {
      mockEventsGet.mockResolvedValueOnce({ data: baseEvent({ colorId: '11' }) });

      const event = await client.getEvent('evt-1');

      expect(event.colorId).toBe('11');
    });

    it('omits colorId for an event using the calendar default', async () => {
      mockEventsGet.mockResolvedValueOnce({ data: baseEvent() });

      const event = await client.getEvent('evt-1');

      expect(event.colorId).toBeUndefined();
    });

    it('surfaces colorId on every event in a list', async () => {
      mockEventsList.mockResolvedValueOnce({
        data: { items: [baseEvent({ colorId: '5' }), baseEvent({ id: 'evt-2', colorId: '10' })] },
      });

      const { events } = await client.listEvents();

      expect(events.map((e) => e.colorId)).toEqual(['5', '10']);
    });
  });

  // === B. Creating a coloured event ===

  describe('createEvent', () => {
    it('sends colorId when one was requested', async () => {
      mockEventsInsert.mockResolvedValueOnce({ data: baseEvent({ colorId: '11' }) });

      const event = await client.createEvent({
        summary: 'Diwali',
        start: START,
        end: END,
        colorId: '11',
      });

      expect(mockEventsInsert.mock.calls[0]?.[0].requestBody.colorId).toBe('11');
      expect(event.colorId).toBe('11');
    });

    it('sends no colorId when none was requested', async () => {
      mockEventsInsert.mockResolvedValueOnce({ data: baseEvent() });

      await client.createEvent({ summary: 'Standup', start: START, end: END });

      expect(mockEventsInsert.mock.calls[0]?.[0].requestBody).not.toHaveProperty('colorId');
    });
  });

  // === C. Recolouring an existing event ===

  describe('updateEvent', () => {
    it('patches colorId', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent({ colorId: '7' }) });

      const event = await client.updateEvent('evt-1', { colorId: '7' });

      expect(mockEventsPatch.mock.calls[0]?.[0].requestBody.colorId).toBe('7');
      expect(event.colorId).toBe('7');
    });

    // Verified live: Google clears the field and the event falls back to the calendar's
    // colour. An empty string is rejected as an invalid colour id, so null is the only way.
    it('sends an explicit null to reset an event to the calendar default', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { colorId: null });

      expect(mockEventsPatch.mock.calls[0]?.[0].requestBody.colorId).toBeNull();
    });

    it('leaves colorId out of the patch body when the update does not mention colour', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { summary: 'Renamed' });

      expect(mockEventsPatch.mock.calls[0]?.[0].requestBody).not.toHaveProperty('colorId');
    });

    // === D. Notification suppression ===
    //
    // The whole point of the feature is recolouring a batch of existing events. A colour is
    // invisible to guests' own copies, so mailing every attendee about it would make the
    // tool unusable on any event with guests.

    it('does not notify attendees when only the colour changes', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent({ colorId: '11' }) });

      await client.updateEvent('evt-1', { colorId: '11' });

      expect(mockEventsPatch.mock.calls[0]?.[0].sendUpdates).toBe('none');
    });

    it('does not notify attendees when only the colour is reset', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { colorId: null });

      expect(mockEventsPatch.mock.calls[0]?.[0].sendUpdates).toBe('none');
    });

    it('still notifies attendees when a colour change accompanies a real change', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent({ colorId: '11' }) });

      await client.updateEvent('evt-1', { colorId: '11', start: START, end: END });

      expect(mockEventsPatch.mock.calls[0]?.[0].sendUpdates).toBe('all');
    });

    it('still notifies attendees on a non-colour update', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { summary: 'Moved to Thursday' });

      expect(mockEventsPatch.mock.calls[0]?.[0].sendUpdates).toBe('all');
    });
  });

  // === E. The palette ===

  describe('listColors', () => {
    it('returns the event palette with the Calendar UI name alongside each id', async () => {
      mockColorsGet.mockResolvedValueOnce({ data: LIVE_PALETTE });

      const palette = await client.listColors();

      expect(palette.event['11']).toEqual({
        background: '#dc2127',
        foreground: '#1d1d1d',
        name: 'Tomato',
      });
      expect(palette.event['10']?.name).toBe('Basil');
      expect(Object.keys(palette.event)).toHaveLength(11);
    });

    it('returns the calendar palette, which has no Calendar UI names', async () => {
      mockColorsGet.mockResolvedValueOnce({ data: LIVE_PALETTE });

      const palette = await client.listColors();

      expect(palette.calendar['1']).toEqual({ background: '#ac725e', foreground: '#1d1d1d' });
    });

    it('reports when Google last changed the palette', async () => {
      mockColorsGet.mockResolvedValueOnce({ data: LIVE_PALETTE });

      const palette = await client.listColors();

      expect(palette.updated).toBe('2012-02-14T00:00:00.000Z');
    });
  });

  // === F. Naming a colour ===
  //
  // Google's API never returns these names, but they are what the Calendar UI shows and
  // what a person asking for "the red one" means.

  describe('resolveEventColorId', () => {
    it('passes a valid numeric id through', () => {
      expect(resolveEventColorId('11')).toBe('11');
    });

    it('accepts a Calendar UI colour name', () => {
      expect(resolveEventColorId('Tomato')).toBe('11');
    });

    it('accepts a name regardless of case or surrounding space', () => {
      expect(resolveEventColorId('  bAsIl ')).toBe('10');
    });

    it('maps every documented name to the id whose hex Google returns for it', () => {
      expect(Object.entries(EVENT_COLOR_NAMES)).toHaveLength(11);
      for (const [id, name] of Object.entries(EVENT_COLOR_NAMES)) {
        expect(resolveEventColorId(name)).toBe(id);
      }
    });

    // Google answers an out-of-range id with a bare "Invalid color id value." 400, which
    // says nothing about what IS valid. Rejecting here costs no API call and can.
    it('rejects an id outside the event palette, naming the valid range', () => {
      expect(() => resolveEventColorId('24')).toThrow(/1-11/);
    });

    it('rejects a colour name Google does not define, listing the ones it does', () => {
      expect(() => resolveEventColorId('crimson')).toThrow(/Tomato/);
    });

    it.each(['0', '-1', '1.5', '', '   '])('rejects %o', (input) => {
      expect(() => resolveEventColorId(input)).toThrow(/Invalid event color/);
    });
  });
});
