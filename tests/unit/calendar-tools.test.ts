import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventsInsert = vi.fn();
const mockEventsPatch = vi.fn();
const mockEventsGet = vi.fn();
const mockColorsGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: { list: vi.fn() },
      colors: { get: mockColorsGet },
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
import {
  CHANGES_THE_EVENT as colorOnlyExemptFields,
  registerCalendarTools,
  resolveConferencing,
} from '../../src/server/calendar-tools.js';

describe('resolveConferencing', () => {
  it('returns undefined when no conferencing option was given', () => {
    expect(resolveConferencing({})).toBeUndefined();
  });

  it('maps addMeet to a new Google Meet conference', () => {
    expect(resolveConferencing({ addMeet: true })).toEqual({ type: 'googleMeet' });
  });

  it('maps meetingCode to an existing conference, normalising the input', () => {
    expect(resolveConferencing({ meetingCode: 'https://meet.google.com/ABC-DEFG-HIJ' })).toEqual({
      type: 'existing',
      meetingCode: 'abc-defg-hij',
    });
  });

  it('rejects a malformed meeting code here, rather than letting it reach the API', () => {
    const result = resolveConferencing({ meetingCode: 'nonsense' });

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/Invalid Google Meet meeting code/);
  });

  // An empty string is a code the caller meant to supply, not an absent option.
  it('rejects an empty meeting code rather than ignoring it', () => {
    const result = resolveConferencing({ meetingCode: '' });

    expect(result).toHaveProperty('error');
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

    it('reports a malformed meeting code as a validation error against the field', async () => {
      const result = await tool('calendar_create_event')({
        ...BASE_CREATE,
        meetingCode: 'nonsense',
        confirm: true,
      });

      expect(payload(result)).toMatchObject({ code: 'VALIDATION_ERROR' });
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

/**
 * Registers the tools with a recording capability gate, so a tool's required capability can
 * be asserted as well as its behaviour.
 */
function registerToolsRecordingGate(): {
  tool: (name: string) => ToolHandler;
  requiredFor: (name: string) => unknown;
} {
  const handlers = new Map<string, ToolHandler>();
  const required = new Map<string, unknown>();
  let current = '';

  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      handlers.set(name, async (args) => {
        current = name;
        return handler(args);
      });
    },
  } as unknown as McpServer;

  const accountStore = {
    getAuthenticatedClient: vi.fn().mockResolvedValue({}),
  } as unknown as AccountStore;

  registerCalendarTools(server, accountStore, (_accountId, requiredCapability) => {
    required.set(current, requiredCapability);
    return { account: { id: 'acct-1' } };
  });

  return {
    tool: (name) => {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Tool ${name} was never registered`);
      }
      return handler;
    },
    requiredFor: (name) => required.get(name),
  };
}

describe('calendar tool colours', () => {
  let tool: (name: string) => ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsInsert.mockResolvedValue({ data: { id: 'evt-1', colorId: '11' } });
    mockEventsPatch.mockResolvedValue({ data: { id: 'evt-1', colorId: '11' } });
    mockEventsGet.mockResolvedValue({ data: { id: 'evt-1' } });
    mockColorsGet.mockResolvedValue({
      data: {
        updated: '2012-02-14T00:00:00.000Z',
        event: { '11': { background: '#dc2127', foreground: '#1d1d1d' } },
        calendar: { '3': { background: '#dc2127', foreground: '#1d1d1d' } },
      },
    });
    tool = registerTools();
  });

  describe('calendar_create_event', () => {
    it('passes a colour id through to the new event', async () => {
      const result = await tool('calendar_create_event')({ ...BASE_CREATE, colorId: '11' });

      expect(result.isError).toBeFalsy();
      expect(mockEventsInsert.mock.calls[0][0].requestBody.colorId).toBe('11');
    });

    it('accepts a Calendar colour name in place of an id', async () => {
      const result = await tool('calendar_create_event')({ ...BASE_CREATE, colorId: 'Tomato' });

      expect(result.isError).toBeFalsy();
      expect(mockEventsInsert.mock.calls[0][0].requestBody.colorId).toBe('11');
    });

    it('rejects an unusable colour before calling Google, naming what is valid', async () => {
      const result = await tool('calendar_create_event')({ ...BASE_CREATE, colorId: '24' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Invalid event color/);
      expect(text(result)).toMatch(/Tomato/);
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });
  });

  describe('calendar_update_event', () => {
    const BASE_UPDATE = { accountId: 'acct-1', eventId: 'evt-1' };

    it('recolours an event', async () => {
      const result = await tool('calendar_update_event')({ ...BASE_UPDATE, colorId: 'Basil' });

      expect(result.isError).toBeFalsy();
      expect(mockEventsPatch.mock.calls[0][0].requestBody.colorId).toBe('10');
    });

    it('resets an event to its calendar default', async () => {
      const result = await tool('calendar_update_event')({ ...BASE_UPDATE, resetColor: true });

      expect(result.isError).toBeFalsy();
      expect(mockEventsPatch.mock.calls[0][0].requestBody.colorId).toBeNull();
    });

    it('accepts resetColor as a string, as loosely-typed MCP clients send it', async () => {
      const result = await tool('calendar_update_event')({ ...BASE_UPDATE, resetColor: 'true' });

      expect(result.isError).toBeFalsy();
      expect(mockEventsPatch.mock.calls[0][0].requestBody.colorId).toBeNull();
    });

    it('rejects colorId and resetColor together rather than picking one', async () => {
      const result = await tool('calendar_update_event')({
        ...BASE_UPDATE,
        colorId: '11',
        resetColor: true,
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/colorId and resetColor/);
      expect(mockEventsPatch).not.toHaveBeenCalled();
    });

    // The attendee confirm gate exists because guests get mailed. A colour-only change
    // mails nobody and is invisible in a guest's own copy, so gating it would make
    // recolouring a run of meetings impossible without confirming each one.
    it('recolours an event with attendees without asking for confirmation', async () => {
      mockEventsGet.mockResolvedValue({
        data: { id: 'evt-1', attendees: [{ email: 'a@example.test' }] },
      });

      const result = await tool('calendar_update_event')({ ...BASE_UPDATE, colorId: '11' });

      expect(result.isError).toBeFalsy();
      expect(mockEventsPatch.mock.calls[0][0].sendUpdates).toBe('none');
    });

    it('still gates a colour change bundled with a real change to the event', async () => {
      mockEventsGet.mockResolvedValue({
        data: { id: 'evt-1', attendees: [{ email: 'a@example.test' }] },
      });

      const result = await tool('calendar_update_event')({
        ...BASE_UPDATE,
        colorId: '11',
        summary: 'Renamed',
      });

      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(mockEventsPatch).not.toHaveBeenCalled();
    });
  });

  describe('calendar_list_colors', () => {
    it('returns the palette with Calendar UI names for event colours', async () => {
      const result = await tool('calendar_list_colors')({ accountId: 'acct-1' });

      expect(result.isError).toBeFalsy();
      expect(payload(result)).toMatchObject({
        event: { '11': { background: '#dc2127', name: 'Tomato' } },
      });
    });

    // colors.get accepts calendar and calendar.readonly but NOT calendar.events, so this
    // cannot be offered under the read-or-write gate the other read tools use.
    it('requires calendar:read, which is the only capability that satisfies colors.get', async () => {
      const { tool: gatedTool, requiredFor } = registerToolsRecordingGate();

      await gatedTool('calendar_list_colors')({ accountId: 'acct-1' });

      expect(requiredFor('calendar_list_colors')).toBe('calendar:read');
    });
  });
});

/**
 * Pins the field list that decides whether an update may skip the attendee confirm gate.
 *
 * `isColorOnlyUpdate` asks whether anything *other* than colour changed, from a list
 * maintained by hand. Add a field to the schema and forget the list, and a change a guest
 * can see silently skips the confirmation prompt — the same hand-maintained-whitelist
 * failure as the four copies of the Gmail header list and the dropped Cc.
 */
describe('calendar_update_event notification safety', () => {
  // Fields that cannot change what a guest sees: addressing, the confirm itself, and the
  // colour options whose whole point is that they are invisible to guests.
  const NOT_A_VISIBLE_CHANGE = new Set([
    'accountId',
    'eventId',
    'calendarId',
    'confirm',
    'colorId',
    'resetColor',
  ]);

  it('treats every schema field as a guest-visible change unless it is explicitly exempt', () => {
    const schemas = new Map<string, Record<string, unknown>>();
    const server = {
      registerTool: (name: string, def: { inputSchema: Record<string, unknown> }) => {
        schemas.set(name, def.inputSchema);
      },
    } as unknown as McpServer;

    registerCalendarTools(server, {} as unknown as AccountStore, () => ({
      account: { id: 'acct-1' },
    }));

    const fields = Object.keys(schemas.get('calendar_update_event') ?? {});
    expect(fields.length).toBeGreaterThan(0);

    const unaccounted = fields.filter(
      (field) => !NOT_A_VISIBLE_CHANGE.has(field) && !colorOnlyExemptFields.includes(field),
    );

    expect(unaccounted).toEqual([]);
  });
});
