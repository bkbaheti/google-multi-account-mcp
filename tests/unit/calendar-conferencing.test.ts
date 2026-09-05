import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventsInsert = vi.fn();
const mockEventsPatch = vi.fn();
const mockEventsGet = vi.fn();
const mockEventsUpdate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: { list: vi.fn() },
      events: {
        list: vi.fn(),
        get: mockEventsGet,
        insert: mockEventsInsert,
        update: mockEventsUpdate,
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
  buildConferenceData,
  CalendarClient,
  normalizeMeetingCode,
} from '../../src/calendar/index.js';

const START = { dateTime: '2026-09-10T09:00:00Z' };
const END = { dateTime: '2026-09-10T10:00:00Z' };

function baseEvent(overrides: Record<string, unknown> = {}) {
  return { id: 'evt-1', summary: 'Standup', ...overrides };
}

describe('Calendar conferencing', () => {
  let store: AccountStore;
  let client: CalendarClient;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      getAuthenticatedClient: vi.fn().mockResolvedValue({}),
    } as unknown as AccountStore;
    client = new CalendarClient(store, 'acct-1');
  });

  // === A. Conference data on the read path ===

  describe('reading conference data', () => {
    it('surfaces hangoutLink and the video entry point from a Meet event', async () => {
      mockEventsGet.mockResolvedValueOnce({
        data: baseEvent({
          hangoutLink: 'https://meet.google.com/abc-defg-hij',
          conferenceData: {
            conferenceId: 'abc-defg-hij',
            conferenceSolution: {
              name: 'Google Meet',
              key: { type: 'hangoutsMeet' },
              iconUri: 'https://example.test/icon.png',
            },
            entryPoints: [
              {
                entryPointType: 'video',
                uri: 'https://meet.google.com/abc-defg-hij',
                label: 'meet.google.com/abc-defg-hij',
                meetingCode: 'abc-defg-hij',
              },
            ],
          },
        }),
      });

      const event = await client.getEvent('evt-1');

      expect(event.hangoutLink).toBe('https://meet.google.com/abc-defg-hij');
      expect(event.conferenceData?.conferenceId).toBe('abc-defg-hij');
      expect(event.conferenceData?.conferenceSolution).toEqual({
        name: 'Google Meet',
        type: 'hangoutsMeet',
        iconUri: 'https://example.test/icon.png',
      });
      expect(event.conferenceData?.entryPoints).toEqual([
        {
          entryPointType: 'video',
          uri: 'https://meet.google.com/abc-defg-hij',
          label: 'meet.google.com/abc-defg-hij',
          meetingCode: 'abc-defg-hij',
        },
      ]);
    });

    it('keeps phone entry points alongside video, with their pin', async () => {
      mockEventsGet.mockResolvedValueOnce({
        data: baseEvent({
          conferenceData: {
            entryPoints: [
              { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
              {
                entryPointType: 'phone',
                uri: 'tel:+1-234-567-8900',
                pin: '123456',
                regionCode: 'US',
              },
            ],
          },
        }),
      });

      const event = await client.getEvent('evt-1');

      expect(event.conferenceData?.entryPoints).toHaveLength(2);
      expect(event.conferenceData?.entryPoints?.[1]).toEqual({
        entryPointType: 'phone',
        uri: 'tel:+1-234-567-8900',
        pin: '123456',
        regionCode: 'US',
      });
    });

    it('reports a pending conference status rather than an empty conference', async () => {
      mockEventsGet.mockResolvedValueOnce({
        data: baseEvent({
          conferenceData: {
            createRequest: {
              requestId: 'req-1',
              conferenceSolutionKey: { type: 'hangoutsMeet' },
              status: { statusCode: 'pending' },
            },
          },
        }),
      });

      const event = await client.getEvent('evt-1');

      expect(event.conferenceData?.status).toBe('pending');
      expect(event.conferenceData?.entryPoints).toBeUndefined();
    });

    it('omits conference fields entirely for an event without a conference', async () => {
      mockEventsGet.mockResolvedValueOnce({ data: baseEvent() });

      const event = await client.getEvent('evt-1');

      expect(event).not.toHaveProperty('hangoutLink');
      expect(event).not.toHaveProperty('conferenceData');
    });
  });

  // === B. Creating a new Meet conference ===

  describe('createEvent with a new Meet conference', () => {
    it('sends a createRequest and conferenceDataVersion 1', async () => {
      mockEventsInsert.mockResolvedValueOnce({
        data: baseEvent({ hangoutLink: 'https://meet.google.com/abc-defg-hij' }),
      });

      await client.createEvent({
        summary: 'Standup',
        start: START,
        end: END,
        conferencing: { type: 'googleMeet' },
      });

      const params = mockEventsInsert.mock.calls[0][0];
      expect(params.conferenceDataVersion).toBe(1);
      expect(params.requestBody.conferenceData.createRequest.conferenceSolutionKey).toEqual({
        type: 'hangoutsMeet',
      });
      expect(params.requestBody.conferenceData.createRequest.requestId).toEqual(expect.any(String));
    });

    it('uses a fresh requestId per call, so two events never share a conference', async () => {
      mockEventsInsert.mockResolvedValue({ data: baseEvent() });

      const input = {
        summary: 'Standup',
        start: START,
        end: END,
        conferencing: { type: 'googleMeet' as const },
      };
      await client.createEvent(input);
      await client.createEvent(input);

      const first = mockEventsInsert.mock.calls[0][0].requestBody.conferenceData.createRequest;
      const second = mockEventsInsert.mock.calls[1][0].requestBody.conferenceData.createRequest;
      expect(first.requestId).not.toBe(second.requestId);
    });

    it('omits conferenceDataVersion when no conferencing was requested', async () => {
      mockEventsInsert.mockResolvedValueOnce({ data: baseEvent() });

      await client.createEvent({ summary: 'Standup', start: START, end: END });

      const params = mockEventsInsert.mock.calls[0][0];
      expect(params.conferenceDataVersion).toBeUndefined();
      expect(params.requestBody.conferenceData).toBeUndefined();
    });

    it('re-reads the event once when the conference comes back pending', async () => {
      mockEventsInsert.mockResolvedValueOnce({
        data: baseEvent({
          conferenceData: { createRequest: { status: { statusCode: 'pending' } } },
        }),
      });
      mockEventsGet.mockResolvedValueOnce({
        data: baseEvent({
          hangoutLink: 'https://meet.google.com/abc-defg-hij',
          conferenceData: {
            entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }],
            createRequest: { status: { statusCode: 'success' } },
          },
        }),
      });

      const event = await client.createEvent({
        summary: 'Standup',
        start: START,
        end: END,
        conferencing: { type: 'googleMeet' },
      });

      expect(mockEventsGet).toHaveBeenCalledTimes(1);
      expect(mockEventsGet.mock.calls[0][0]).toMatchObject({ eventId: 'evt-1' });
      expect(event.hangoutLink).toBe('https://meet.google.com/abc-defg-hij');
    });

    it('does not re-read when the conference is already successful', async () => {
      mockEventsInsert.mockResolvedValueOnce({
        data: baseEvent({
          conferenceData: { createRequest: { status: { statusCode: 'success' } } },
        }),
      });

      await client.createEvent({
        summary: 'Standup',
        start: START,
        end: END,
        conferencing: { type: 'googleMeet' },
      });

      expect(mockEventsGet).not.toHaveBeenCalled();
    });

    it('re-reads the calendar the event was created on, not always primary', async () => {
      mockEventsInsert.mockResolvedValueOnce({
        data: baseEvent({
          conferenceData: { createRequest: { status: { statusCode: 'pending' } } },
        }),
      });
      mockEventsGet.mockResolvedValueOnce({ data: baseEvent() });

      await client.createEvent(
        { summary: 'Standup', start: START, end: END, conferencing: { type: 'googleMeet' } },
        'team@group.calendar.google.com',
      );

      expect(mockEventsGet.mock.calls[0][0].calendarId).toBe('team@group.calendar.google.com');
    });
  });

  // === C. Attaching an existing Meet conference ===

  describe('normalizeMeetingCode', () => {
    it('accepts a bare meeting code', () => {
      expect(normalizeMeetingCode('abc-defg-hij')).toBe('abc-defg-hij');
    });

    it('extracts the code from a full Meet URL', () => {
      expect(normalizeMeetingCode('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
    });

    it('ignores query strings and trailing paths on the URL', () => {
      expect(normalizeMeetingCode('https://meet.google.com/abc-defg-hij?authuser=0')).toBe(
        'abc-defg-hij',
      );
    });

    it('lowercases and trims', () => {
      expect(normalizeMeetingCode('  ABC-DEFG-HIJ  ')).toBe('abc-defg-hij');
    });

    it.each([
      ['abcdefghij', 'no separators'],
      ['ab-defg-hij', 'wrong first group length'],
      ['abc-def-hij', 'wrong middle group length'],
      ['abc-defg-hi', 'wrong last group length'],
      ['abc-1234-hij', 'digits'],
      ['', 'empty'],
      ['https://zoom.us/j/123456', 'a non-Meet URL'],
    ])('rejects %s (%s)', (input) => {
      expect(() => normalizeMeetingCode(input)).toThrow(/Invalid Google Meet meeting code/);
    });
  });

  describe('buildConferenceData', () => {
    it('builds the copy shape — solution plus entry point, and no createRequest', () => {
      const data = buildConferenceData({ type: 'existing', meetingCode: 'abc-defg-hij' });

      expect(data).toEqual({
        conferenceSolution: { key: { type: 'hangoutsMeet' } },
        entryPoints: [
          {
            entryPointType: 'video',
            uri: 'https://meet.google.com/abc-defg-hij',
            meetingCode: 'abc-defg-hij',
          },
        ],
      });
      expect(data).not.toHaveProperty('createRequest');
    });

    it('normalises a URL and a bare code to the same body', () => {
      expect(
        buildConferenceData({
          type: 'existing',
          meetingCode: 'https://meet.google.com/abc-defg-hij',
        }),
      ).toEqual(buildConferenceData({ type: 'existing', meetingCode: 'abc-defg-hij' }));
    });

    it('populates meetingCode only — not accessCode, passcode, password or pin', () => {
      const data = buildConferenceData({ type: 'existing', meetingCode: 'abc-defg-hij' });
      const entryPoint = data?.entryPoints?.[0] ?? {};

      expect(Object.keys(entryPoint).sort()).toEqual(['entryPointType', 'meetingCode', 'uri']);
    });

    it('returns null for removal', () => {
      expect(buildConferenceData({ type: 'none' })).toBeNull();
    });
  });

  describe('createEvent with an existing meeting code', () => {
    it('attaches the conference and sets conferenceDataVersion 1', async () => {
      mockEventsInsert.mockResolvedValueOnce({ data: baseEvent() });

      await client.createEvent({
        summary: 'Standup',
        start: START,
        end: END,
        conferencing: { type: 'existing', meetingCode: 'abc-defg-hij' },
      });

      const params = mockEventsInsert.mock.calls[0][0];
      expect(params.conferenceDataVersion).toBe(1);
      expect(params.requestBody.conferenceData.entryPoints[0].uri).toBe(
        'https://meet.google.com/abc-defg-hij',
      );
      expect(params.requestBody.conferenceData.createRequest).toBeUndefined();
    });

    it('never re-reads, since attaching an existing conference is not asynchronous', async () => {
      mockEventsInsert.mockResolvedValueOnce({
        data: baseEvent({
          conferenceData: { createRequest: { status: { statusCode: 'pending' } } },
        }),
      });

      await client.createEvent({
        summary: 'Standup',
        start: START,
        end: END,
        conferencing: { type: 'existing', meetingCode: 'abc-defg-hij' },
      });

      expect(mockEventsGet).not.toHaveBeenCalled();
    });

    it('rejects a malformed code before calling the API at all', async () => {
      await expect(
        client.createEvent({
          summary: 'Standup',
          start: START,
          end: END,
          conferencing: { type: 'existing', meetingCode: 'not-a-code' },
        }),
      ).rejects.toThrow(/Invalid Google Meet meeting code/);

      expect(mockEventsInsert).not.toHaveBeenCalled();
    });
  });

  // === D. updateEvent patches instead of replacing ===

  describe('updateEvent', () => {
    it('patches rather than replacing the whole event', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { summary: 'Renamed' });

      expect(mockEventsPatch).toHaveBeenCalledTimes(1);
      expect(mockEventsUpdate).not.toHaveBeenCalled();
    });

    it('does not read the event first — a patch needs no prior state', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { summary: 'Renamed' });

      expect(mockEventsGet).not.toHaveBeenCalled();
    });

    it('sends only the fields the caller changed', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { summary: 'Renamed' });

      expect(mockEventsPatch.mock.calls[0][0].requestBody).toEqual({ summary: 'Renamed' });
    });

    it('leaves conference data alone when conferencing was not mentioned', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { summary: 'Renamed' });

      const params = mockEventsPatch.mock.calls[0][0];
      expect(params.requestBody).not.toHaveProperty('conferenceData');
      expect(params.conferenceDataVersion).toBeUndefined();
    });

    it('notifies guests, so a time change reaches the people attending', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { start: START, end: END });

      expect(mockEventsPatch.mock.calls[0][0].sendUpdates).toBe('all');
    });

    it('adds a Meet conference to an existing event', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { conferencing: { type: 'googleMeet' } });

      const params = mockEventsPatch.mock.calls[0][0];
      expect(params.conferenceDataVersion).toBe(1);
      expect(params.requestBody.conferenceData.createRequest.conferenceSolutionKey.type).toBe(
        'hangoutsMeet',
      );
    });

    it('attaches an existing meeting code to an existing event', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', {
        conferencing: { type: 'existing', meetingCode: 'https://meet.google.com/abc-defg-hij' },
      });

      const params = mockEventsPatch.mock.calls[0][0];
      expect(params.conferenceDataVersion).toBe(1);
      expect(params.requestBody.conferenceData.entryPoints[0].meetingCode).toBe('abc-defg-hij');
    });

    it('clears a conference with an explicit null', async () => {
      mockEventsPatch.mockResolvedValueOnce({ data: baseEvent() });

      await client.updateEvent('evt-1', { conferencing: { type: 'none' } });

      const params = mockEventsPatch.mock.calls[0][0];
      expect(params.conferenceDataVersion).toBe(1);
      expect(params.requestBody.conferenceData).toBeNull();
    });

    it('re-reads once when a conference added on update comes back pending', async () => {
      mockEventsPatch.mockResolvedValueOnce({
        data: baseEvent({
          conferenceData: { createRequest: { status: { statusCode: 'pending' } } },
        }),
      });
      mockEventsGet.mockResolvedValueOnce({
        data: baseEvent({ hangoutLink: 'https://meet.google.com/abc-defg-hij' }),
      });

      const event = await client.updateEvent('evt-1', { conferencing: { type: 'googleMeet' } });

      expect(mockEventsGet).toHaveBeenCalledTimes(1);
      expect(event.hangoutLink).toBe('https://meet.google.com/abc-defg-hij');
    });
  });
});
