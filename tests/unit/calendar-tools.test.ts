import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventsInsert = vi.fn();
const mockEventsPatch = vi.fn();
const mockEventsGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: { list: vi.fn() },
      events: {
        list: vi.fn(),
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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AccountStore } from '../../src/auth/index.js';
import { registerCalendarTools, resolveConferencing } from '../../src/server/calendar-tools.js';

describe('resolveConferencing', () => {
  it('returns undefined when no conferencing option was given', () => {
    expect(resolveConferencing({})).toBeUndefined();
  });

  it('maps addMeet to a new Google Meet conference', () => {
    expect(resolveConferencing({ addMeet: true })).toEqual({ type: 'googleMeet' });
  });

  it('maps meetingCode to an existing conference, passing the raw input through', () => {
    expect(resolveConferencing({ meetingCode: 'abc-defg-hij' })).toEqual({
      type: 'existing',
      meetingCode: 'abc-defg-hij',
    });
  });

  it('maps removeConferencing to a clear', () => {
    expect(resolveConferencing({ removeConferencing: true })).toEqual({ type: 'none' });
  });

  it('ignores options explicitly set false', () => {
    expect(resolveConferencing({ addMeet: false, removeConferencing: false })).toBeUndefined();
  });

  // Mutually exclusive rather than precedence-ordered: a caller who asks for two things
  // should not silently get one of them.
  it.each([
    [{ addMeet: true, meetingCode: 'abc-defg-hij' }],
    [{ addMeet: true, removeConferencing: true }],
    [{ meetingCode: 'abc-defg-hij', removeConferencing: true }],
    [{ addMeet: true, meetingCode: 'abc-defg-hij', removeConferencing: true }],
  ])('rejects combined options %o', (args) => {
    const result = resolveConferencing(args);

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/Only one conferencing option/);
  });
});

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}>;

/**
 * Registers the calendar tools against a stub server and returns a lookup for the
 * handlers, so the confirm gates can be exercised as an MCP caller actually hits them.
 */
function registerTools(): (name: string) => ToolHandler {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;

  const accountStore = {
    getAuthenticatedClient: vi.fn().mockResolvedValue({}),
  } as unknown as AccountStore;

  registerCalendarTools(server, accountStore, () => ({ account: { id: 'acct-1' } }));

  return (name) => {
    const handler = handlers.get(name);
    if (!handler) {
      throw new Error(`Tool ${name} was never registered`);
    }
    return handler;
  };
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

function payload(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(text(result));
}

const BASE_CREATE = {
  accountId: 'acct-1',
  summary: 'Standup',
  start: '2026-09-10T09:00:00Z',
  end: '2026-09-10T10:00:00Z',
};

describe('calendar tool conferencing gates', () => {
  let tool: (name: string) => ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsInsert.mockResolvedValue({ data: { id: 'evt-1' } });
    mockEventsPatch.mockResolvedValue({ data: { id: 'evt-1' } });
    mockEventsGet.mockResolvedValue({ data: { id: 'evt-1' } });
    tool = registerTools();
  });

  describe('calendar_create_event', () => {
    it('creates a new Meet link without any confirmation', async () => {
      const result = await tool('calendar_create_event')({ ...BASE_CREATE, addMeet: true });

      expect(result.isError).toBeFalsy();
      expect(mockEventsInsert.mock.calls[0][0].conferenceDataVersion).toBe(1);
    });

    it('refuses to reuse a meeting code without confirm, and explains the consequence', async () => {
      const result = await tool('calendar_create_event')({
        ...BASE_CREATE,
        meetingCode: 'abc-defg-hij',
      });

      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(text(result)).toMatch(/original event's guest list/);
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });

    it('reuses a meeting code once confirmed', async () => {
      const result = await tool('calendar_create_event')({
        ...BASE_CREATE,
        meetingCode: 'abc-defg-hij',
        confirm: true,
      });

      expect(result.isError).toBeFalsy();
      expect(mockEventsInsert.mock.calls[0][0].requestBody.conferenceData.entryPoints[0].uri).toBe(
        'https://meet.google.com/abc-defg-hij',
      );
    });

    it('reports the attendee and meeting-code consequences together in one gate', async () => {
      const result = await tool('calendar_create_event')({
        ...BASE_CREATE,
        attendees: ['a@example.test'],
        meetingCode: 'abc-defg-hij',
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/calendar invitations/);
      expect(text(result)).toMatch(/original event's guest list/);
    });

    it('rejects addMeet and meetingCode together', async () => {
      const result = await tool('calendar_create_event')({
        ...BASE_CREATE,
        addMeet: true,
        meetingCode: 'abc-defg-hij',
        confirm: true,
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Only one conferencing option/);
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });

    it('surfaces a malformed meeting code as an error, not a dead join link', async () => {
      const result = await tool('calendar_create_event')({
        ...BASE_CREATE,
        meetingCode: 'nonsense',
        confirm: true,
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Invalid Google Meet meeting code/);
    });
  });

  describe('calendar_update_event', () => {
    it('adds a Meet link to an event with no attendees without confirmation', async () => {
      const result = await tool('calendar_update_event')({
        accountId: 'acct-1',
        eventId: 'evt-1',
        addMeet: true,
      });

      expect(result.isError).toBeFalsy();
      expect(mockEventsPatch.mock.calls[0][0].conferenceDataVersion).toBe(1);
    });

    it('refuses to reuse a meeting code without confirm', async () => {
      const result = await tool('calendar_update_event')({
        accountId: 'acct-1',
        eventId: 'evt-1',
        meetingCode: 'abc-defg-hij',
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/original event's guest list/);
      expect(mockEventsPatch).not.toHaveBeenCalled();
    });

    it('still gates on the attendees the event already has', async () => {
      mockEventsGet.mockResolvedValueOnce({
        data: { id: 'evt-1', attendees: [{ email: 'a@example.test' }] },
      });

      const result = await tool('calendar_update_event')({
        accountId: 'acct-1',
        eventId: 'evt-1',
        summary: 'Renamed',
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/existing attendee/);
    });

    it('removes a conference when asked', async () => {
      const result = await tool('calendar_update_event')({
        accountId: 'acct-1',
        eventId: 'evt-1',
        removeConferencing: true,
      });

      expect(result.isError).toBeFalsy();
      expect(mockEventsPatch.mock.calls[0][0].requestBody.conferenceData).toBeNull();
    });

    it('rejects meetingCode and removeConferencing together', async () => {
      const result = await tool('calendar_update_event')({
        accountId: 'acct-1',
        eventId: 'evt-1',
        meetingCode: 'abc-defg-hij',
        removeConferencing: true,
        confirm: true,
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Only one conferencing option/);
    });
  });
});
