import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Capability, CapabilityGate } from '../auth/capabilities.js';
import type { AccountStore } from '../auth/index.js';
import {
  CalendarClient,
  type ConferencingRequest,
  normalizeMeetingCode,
  resolveEventColorId,
} from '../calendar/index.js';
import {
  confirmationRequired,
  errorResponse,
  successResponse,
  toMcpError,
  validationError,
} from '../errors/index.js';
import { coerceArgs } from '../utils/index.js';

// events.list, events.get, and events.search all accept either
// calendar.readonly or calendar.events (verified against Google's
// per-method scope reference), so calendar:read alone fully satisfies these
// calls and is the narrowest capability to suggest. No escalation: unlike
// Drive's drive:appfiles, there is no file/event this account can reach
// with calendar:write that calendar:read can't reach for a read call, so
// there is no condition under which calendar:read would be insufficient
// for THIS call - offering calendar:write here would just be an upsell
// toward write authority the caller never asked for. See the `escalation`
// field's doc comment on CapabilityGate.
const CALENDAR_READ_OR_WRITE_GATE: CapabilityGate = {
  accept: ['calendar:read', 'calendar:write'],
  remedy: 'calendar:read',
};

/**
 * Why attaching an existing meeting code needs a confirm gate.
 *
 * Google's own guidance: permissions and access stay tied to the ORIGINAL event's guest
 * list, so participants of that event may reach this meeting's recordings and chat, and
 * this event's new guests may have to ask to join. That is a data-exposure consequence
 * the caller should see stated before it happens, in the same spirit as the send and
 * share gates elsewhere in this server.
 */
const MEETING_CODE_REUSE_WARNING =
  "Reusing an existing meeting code keeps the conference's access bound to the original event's guest list: people from that event may reach this meeting's recordings and chat, and guests of this event may have to request to join. Set confirm: true to proceed.";

/**
 * Resolves the three mutually exclusive conferencing inputs into one request.
 *
 * Mutually exclusive by design: silently letting one win would leave a caller who asked
 * for both with an event they did not describe.
 */
export function resolveConferencing(args: {
  addMeet?: boolean | undefined;
  meetingCode?: string | undefined;
  removeConferencing?: boolean | undefined;
}): ConferencingRequest | undefined | { error: string } {
  const requested = [
    args.addMeet ? 'addMeet' : null,
    // Presence, not truthiness: meetingCode: "" is a malformed code the caller meant to
    // supply, and must be rejected rather than silently ignored.
    args.meetingCode !== undefined ? 'meetingCode' : null,
    args.removeConferencing ? 'removeConferencing' : null,
  ].filter((v): v is string => v !== null);

  if (requested.length > 1) {
    return {
      error: `Only one conferencing option may be set, but ${requested.join(' and ')} were given.`,
    };
  }

  if (args.addMeet) {
    return { type: 'googleMeet' };
  }
  if (args.meetingCode !== undefined) {
    // Validated here rather than only in the client so a typo surfaces as a validation
    // error naming the field, instead of an UNKNOWN_ERROR from a bare throw deeper down.
    try {
      return { type: 'existing', meetingCode: normalizeMeetingCode(args.meetingCode) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (args.removeConferencing) {
    return { type: 'none' };
  }

  return undefined;
}

/**
 * Resolves the two colour inputs into what the client should send.
 *
 * `undefined` leaves the event's colour alone, a string sets it, and `null` resets it to
 * the calendar default. Mutually exclusive for the same reason as the conferencing
 * options: a caller who asks for two things should not silently get one.
 */
export function resolveEventColor(args: {
  colorId?: string | undefined;
  resetColor?: boolean | undefined;
}): string | null | undefined | { error: string } {
  if (args.colorId !== undefined && args.resetColor) {
    return { error: 'Only one of colorId and resetColor may be set, but both were given.' };
  }

  if (args.resetColor) {
    return null;
  }

  if (args.colorId !== undefined) {
    // Resolved here so a bad colour is a validation error naming the field and the valid
    // values, rather than Google's bare "Invalid color id value." 400.
    try {
      return resolveEventColorId(args.colorId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  return undefined;
}

/**
 * Whether an update changes nothing but the event's colour.
 *
 * A colour-only update notifies nobody (see `updateEvent`), so the attendee confirm gate —
 * which exists because guests get mailed — has nothing to warn about. Gating it anyway
 * would mean confirming once per event when recolouring a run of meetings.
 */
function isColorOnlyUpdate(
  args: Record<string, unknown>,
  color: string | null | undefined,
): boolean {
  if (color === undefined) {
    return false;
  }

  const CHANGES_THE_EVENT = [
    'summary',
    'start',
    'end',
    'description',
    'location',
    'attendees',
    'timeZone',
    'recurrence',
    'addMeet',
    'meetingCode',
    'removeConferencing',
  ];

  return CHANGES_THE_EVENT.every((field) => args[field] === undefined);
}

export function registerCalendarTools(
  server: McpServer,
  accountStore: AccountStore,
  validateAccountScope: (
    accountId: string,
    required: Capability | CapabilityGate,
  ) => { error: ReturnType<typeof errorResponse> } | { account: any },
): void {
  // === Read tools (require calendar:read, unless noted) ===

  // calendar_list_calendars - List all calendars
  server.registerTool(
    'calendar_list_calendars',
    {
      description:
        'List all calendars for a Google account (primary, shared, subscribed). Each entry reports accessRole ("owner", "writer", "writerWithoutPrivateAccess", "reader", "freeBusyReader") and a derived canEdit flag saying whether events can be created or changed on it.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        maxResults: z
          .number()
          .optional()
          .describe('Calendars per page (Google defaults to 100, maximum 250)'),
        pageToken: z.string().optional().describe('Token for pagination'),
        showHidden: z.boolean().optional().describe('Include calendars hidden in the Calendar UI'),
        showDeleted: z.boolean().optional().describe('Include deleted calendar list entries'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, {
        maxResults: 'number',
        showHidden: 'boolean',
        showDeleted: 'boolean',
      });
      const validation = validateAccountScope(args.accountId, 'calendar:read');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const options: {
          maxResults?: number;
          pageToken?: string;
          showHidden?: boolean;
          showDeleted?: boolean;
        } = {};
        if (args.maxResults !== undefined) {
          options.maxResults = args.maxResults;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        if (args.showHidden !== undefined) {
          options.showHidden = args.showHidden;
        }
        if (args.showDeleted !== undefined) {
          options.showDeleted = args.showDeleted;
        }
        const result = await client.listCalendars(options);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_list_colors - The event and calendar colour palettes
  //
  // calendar:read, not the read-or-write gate the other read tools use: Google's
  // per-method scope list for colors.get accepts calendar and calendar.readonly but NOT
  // calendar.events, so an account holding only calendar:write cannot make this call.
  server.registerTool(
    'calendar_list_colors',
    {
      description:
        'List the Google Calendar colour palettes. Returns the 11 event colours (the ids accepted by calendar_create_event and calendar_update_event) with their hex values and Calendar UI names, plus the 24 calendar colours. Event and calendar palettes are separate: the same name has a different id in each.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, {});
      const validation = validateAccountScope(args.accountId, 'calendar:read');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        return successResponse(await client.listColors());
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_list_events - List events in time range
  server.registerTool(
    'calendar_list_events',
    {
      description:
        'List events from a Google Calendar within a time range. Defaults to primary calendar.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        timeMin: z
          .string()
          .optional()
          .describe('Start of time range (RFC3339, e.g., "2024-01-01T00:00:00Z")'),
        timeMax: z
          .string()
          .optional()
          .describe('End of time range (RFC3339, e.g., "2024-12-31T23:59:59Z")'),
        maxResults: z
          .number()
          .optional()
          .describe('Maximum number of events to return (default: 20)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { maxResults: 'number' });
      const validation = validateAccountScope(args.accountId, CALENDAR_READ_OR_WRITE_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const options: {
          calendarId?: string;
          timeMin?: string;
          timeMax?: string;
          maxResults?: number;
          pageToken?: string;
        } = {};
        if (args.calendarId !== undefined) {
          options.calendarId = args.calendarId;
        }
        if (args.timeMin !== undefined) {
          options.timeMin = args.timeMin;
        }
        if (args.timeMax !== undefined) {
          options.timeMax = args.timeMax;
        }
        if (args.maxResults !== undefined) {
          options.maxResults = args.maxResults;
        }
        if (args.pageToken !== undefined) {
          options.pageToken = args.pageToken;
        }
        const result = await client.listEvents(options);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_get_event - Get full event details
  server.registerTool(
    'calendar_get_event',
    {
      description: 'Get full details for a specific Google Calendar event.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        eventId: z.string().describe('The event ID'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, CALENDAR_READ_OR_WRITE_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const event = await client.getEvent(args.eventId, args.calendarId);

        return successResponse(event);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_search_events - Search events by text
  server.registerTool(
    'calendar_search_events',
    {
      description:
        'Search for Google Calendar events by text query. Searches summary, description, location, and attendees.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        query: z.string().describe('Search text to find in events'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        timeMin: z.string().optional().describe('Start of time range (RFC3339)'),
        timeMax: z.string().optional().describe('End of time range (RFC3339)'),
        maxResults: z
          .number()
          .optional()
          .describe('Maximum number of events to return (default: 20)'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { maxResults: 'number' });
      const validation = validateAccountScope(args.accountId, CALENDAR_READ_OR_WRITE_GATE);
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const options: {
          calendarId?: string;
          timeMin?: string;
          timeMax?: string;
          maxResults?: number;
        } = {};
        if (args.calendarId !== undefined) {
          options.calendarId = args.calendarId;
        }
        if (args.timeMin !== undefined) {
          options.timeMin = args.timeMin;
        }
        if (args.timeMax !== undefined) {
          options.timeMax = args.timeMax;
        }
        if (args.maxResults !== undefined) {
          options.maxResults = args.maxResults;
        }
        const result = await client.searchEvents(args.query, options);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_freebusy - Check free/busy status
  server.registerTool(
    'calendar_freebusy',
    {
      description: 'Check free/busy status for one or more Google Calendars within a time range.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        timeMin: z.string().describe('Start of time range (RFC3339)'),
        timeMax: z.string().describe('End of time range (RFC3339)'),
        calendarIds: z
          .array(z.string())
          .optional()
          .describe('Calendar IDs to check (default: ["primary"])'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar:read');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const options: {
          timeMin: string;
          timeMax: string;
          calendarIds?: string[];
        } = {
          timeMin: args.timeMin,
          timeMax: args.timeMax,
        };
        if (args.calendarIds !== undefined) {
          options.calendarIds = args.calendarIds;
        }
        const result = await client.freeBusy(options);

        return successResponse(result);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // === Write tools (require calendar:write) ===

  // calendar_create_event - Create event (confirm required if attendees present)
  server.registerTool(
    'calendar_create_event',
    {
      description:
        'Create a new Google Calendar event. If attendees are included, requires confirm: true as a safety gate since it will send calendar invitations.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        summary: z.string().describe('Event title/summary'),
        start: z
          .string()
          .describe(
            'Start time (RFC3339 for timed event, e.g., "2024-01-15T09:00:00-05:00") or date (YYYY-MM-DD for all-day event)',
          ),
        end: z
          .string()
          .describe('End time (RFC3339 for timed event) or date (YYYY-MM-DD for all-day event)'),
        description: z.string().optional().describe('Event description'),
        location: z.string().optional().describe('Event location'),
        attendees: z.array(z.string()).optional().describe('Email addresses of attendees'),
        timeZone: z
          .string()
          .optional()
          .describe(
            'Time zone (e.g., "America/New_York"). Required for timed events without offset.',
          ),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        recurrence: z
          .array(z.string())
          .optional()
          .describe('Recurrence rules (e.g., ["RRULE:FREQ=WEEKLY;COUNT=10"])'),
        addMeet: z
          .boolean()
          .optional()
          .describe('Generate a new Google Meet conference and attach it to the event'),
        meetingCode: z
          .string()
          .optional()
          .describe(
            'Attach an EXISTING Google Meet conference instead of generating one. Accepts a code ("abc-defg-hij") or a https://meet.google.com/... URL. Requires confirm: true — access stays tied to the original event\'s guest list. Cannot be combined with addMeet.',
          ),
        colorId: z
          .string()
          .optional()
          .describe(
            "Event colour: an id 1-11, or a Calendar colour name (Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato). Omit to inherit the calendar's colour. Use calendar_list_colors to see the palette.",
          ),
        confirm: z
          .boolean()
          .optional()
          .describe(
            'Set to true to confirm creating an event with attendees (sends invitations) or reusing an existing meeting code',
          ),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { confirm: 'boolean', addMeet: 'boolean' });
      const validation = validateAccountScope(args.accountId, 'calendar:write');
      if ('error' in validation) return validation.error;

      const conferencing = resolveConferencing(args);
      if (conferencing && 'error' in conferencing) {
        return errorResponse(validationError(conferencing.error, 'conferencing').toResponse());
      }

      const color = resolveEventColor(args);
      if (color !== null && typeof color === 'object') {
        return errorResponse(validationError(color.error, 'colorId').toResponse());
      }

      // Conditional confirm gate: attendees get invited, and a reused meeting code carries
      // the original event's access with it. Both consequences are reported together so a
      // caller sees everything one confirm authorises.
      const hasAttendees = args.attendees && args.attendees.length > 0;
      if ((hasAttendees || args.meetingCode !== undefined) && !args.confirm) {
        const operations: string[] = [];
        const hints: string[] = [];
        if (hasAttendees) {
          operations.push(`create event with ${args.attendees!.length} attendee(s)`);
          hints.push('This will send calendar invitations.');
        }
        if (args.meetingCode !== undefined) {
          operations.push('attach an existing meeting code');
          hints.push(MEETING_CODE_REUSE_WARNING);
        }
        return errorResponse(
          confirmationRequired(operations.join(' and '), hints.join(' ')).toResponse(),
        );
      }

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        // Parse start/end: if no 'T', use date (all-day); otherwise dateTime
        const isAllDayStart = !args.start.includes('T');
        const isAllDayEnd = !args.end.includes('T');

        const input: {
          summary: string;
          start: { date?: string; dateTime?: string; timeZone?: string };
          end: { date?: string; dateTime?: string; timeZone?: string };
          description?: string;
          location?: string;
          attendees?: Array<{ email: string }>;
          recurrence?: string[];
          timeZone?: string;
          conferencing?: ConferencingRequest;
          colorId?: string;
        } = {
          summary: args.summary,
          start: isAllDayStart
            ? { date: args.start }
            : args.timeZone
              ? { dateTime: args.start, timeZone: args.timeZone }
              : { dateTime: args.start },
          end: isAllDayEnd
            ? { date: args.end }
            : args.timeZone
              ? { dateTime: args.end, timeZone: args.timeZone }
              : { dateTime: args.end },
        };
        if (args.description !== undefined) {
          input.description = args.description;
        }
        if (args.location !== undefined) {
          input.location = args.location;
        }
        if (hasAttendees) {
          input.attendees = args.attendees!.map((email) => ({ email }));
        }
        if (args.recurrence !== undefined) {
          input.recurrence = args.recurrence;
        }
        if (args.timeZone !== undefined) {
          input.timeZone = args.timeZone;
        }
        if (conferencing !== undefined) {
          input.conferencing = conferencing;
        }
        // A create has nothing to reset, so only a real colour reaches the body. resetColor
        // is an update-only option and is not in this tool's schema.
        if (typeof color === 'string') {
          input.colorId = color;
        }

        const event = await client.createEvent(input, args.calendarId);

        return successResponse(event);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_update_event - Update event (confirm required if attendees present or being added)
  server.registerTool(
    'calendar_update_event',
    {
      description:
        'Update an existing Google Calendar event. Requires confirm: true if the event has attendees or attendees are being added, since it will send update notifications.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        eventId: z.string().describe('The event ID to update'),
        summary: z.string().optional().describe('New event title/summary'),
        start: z
          .string()
          .optional()
          .describe('New start time (RFC3339) or date (YYYY-MM-DD for all-day)'),
        end: z
          .string()
          .optional()
          .describe('New end time (RFC3339) or date (YYYY-MM-DD for all-day)'),
        description: z.string().optional().describe('New event description'),
        location: z.string().optional().describe('New event location'),
        attendees: z
          .array(z.string())
          .optional()
          .describe('New attendee email addresses (replaces existing attendees)'),
        timeZone: z.string().optional().describe('Time zone (e.g., "America/New_York")'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        addMeet: z
          .boolean()
          .optional()
          .describe('Generate a new Google Meet conference and attach it to the event'),
        meetingCode: z
          .string()
          .optional()
          .describe(
            'Attach an EXISTING Google Meet conference. Accepts a code ("abc-defg-hij") or a https://meet.google.com/... URL. Requires confirm: true — access stays tied to the original event\'s guest list. Cannot be combined with addMeet or removeConferencing.',
          ),
        removeConferencing: z
          .boolean()
          .optional()
          .describe('Remove the video conference currently attached to the event'),
        colorId: z
          .string()
          .optional()
          .describe(
            'New event colour: an id 1-11, or a Calendar colour name (Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato). A colour-only update notifies no attendees and needs no confirm. Use calendar_list_colors to see the palette.',
          ),
        resetColor: z
          .boolean()
          .optional()
          .describe(
            "Reset the event to its calendar's default colour. Cannot be combined with colorId.",
          ),
        confirm: z
          .boolean()
          .optional()
          .describe(
            'Set to true to confirm updating an event with attendees (sends notifications) or reusing an existing meeting code',
          ),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, {
        confirm: 'boolean',
        addMeet: 'boolean',
        removeConferencing: 'boolean',
        resetColor: 'boolean',
      });
      const validation = validateAccountScope(args.accountId, 'calendar:write');
      if ('error' in validation) return validation.error;

      const conferencing = resolveConferencing(args);
      if (conferencing && 'error' in conferencing) {
        return errorResponse(validationError(conferencing.error, 'conferencing').toResponse());
      }

      const color = resolveEventColor(args);
      if (color !== null && typeof color === 'object') {
        return errorResponse(validationError(color.error, 'colorId').toResponse());
      }
      const colorOnly = isColorOnlyUpdate(args, color);

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        // Check if new attendees are being added
        const addingAttendees = args.attendees && args.attendees.length > 0;

        // A colour-only update mails nobody and is invisible in a guest's own copy, so
        // there is no consequence for a confirm to authorise — and skipping the gate also
        // skips the attendee lookup below, which is the only read left on this path.
        if (!args.confirm && !colorOnly) {
          // Reasons this update needs confirming, collected so one gate reports everything
          // a single confirm would authorise.
          const operations: string[] = [];
          const hints: string[] = [];

          if (addingAttendees) {
            operations.push(`update event with ${args.attendees!.length} attendee(s)`);
            hints.push('This will send calendar notifications to attendees.');
          } else {
            // No new attendee list given, so the existing one decides whether anybody is
            // notified. This read is the only reason the update path still fetches.
            const existingEvent = await client.getEvent(args.eventId, args.calendarId);
            if (existingEvent.attendees && existingEvent.attendees.length > 0) {
              operations.push(
                `update event with ${existingEvent.attendees.length} existing attendee(s)`,
              );
              hints.push('This event has attendees who will be notified of changes.');
            }
          }

          if (args.meetingCode !== undefined) {
            operations.push('attach an existing meeting code');
            hints.push(MEETING_CODE_REUSE_WARNING);
          }

          if (operations.length > 0) {
            return errorResponse(
              confirmationRequired(operations.join(' and '), hints.join(' ')).toResponse(),
            );
          }
        }

        // Build updates object conditionally to avoid passing undefined
        const updates: {
          summary?: string;
          description?: string;
          location?: string;
          start?: { date?: string; dateTime?: string; timeZone?: string };
          end?: { date?: string; dateTime?: string; timeZone?: string };
          attendees?: Array<{ email: string }>;
          recurrence?: string[];
          timeZone?: string;
          conferencing?: ConferencingRequest;
          colorId?: string | null;
        } = {};

        if (args.summary !== undefined) {
          updates.summary = args.summary;
        }
        if (args.description !== undefined) {
          updates.description = args.description;
        }
        if (args.location !== undefined) {
          updates.location = args.location;
        }
        if (args.start !== undefined) {
          const isAllDay = !args.start.includes('T');
          updates.start = isAllDay
            ? { date: args.start }
            : args.timeZone
              ? { dateTime: args.start, timeZone: args.timeZone }
              : { dateTime: args.start };
        }
        if (args.end !== undefined) {
          const isAllDay = !args.end.includes('T');
          updates.end = isAllDay
            ? { date: args.end }
            : args.timeZone
              ? { dateTime: args.end, timeZone: args.timeZone }
              : { dateTime: args.end };
        }
        if (args.attendees !== undefined) {
          updates.attendees = args.attendees.map((email) => ({ email }));
        }
        if (args.timeZone !== undefined) {
          updates.timeZone = args.timeZone;
        }
        if (conferencing !== undefined) {
          updates.conferencing = conferencing;
        }
        // null is meaningful here — it resets the event to its calendar's colour — so this
        // tests against undefined rather than truthiness.
        if (color !== undefined) {
          updates.colorId = color;
        }

        const event = await client.updateEvent(args.eventId, updates, args.calendarId);

        return successResponse(event);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_delete_event - Delete event (confirm required if event has attendees)
  server.registerTool(
    'calendar_delete_event',
    {
      description:
        'Delete a Google Calendar event. Requires confirm: true if the event has attendees, since they will be notified of the cancellation.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        eventId: z.string().describe('The event ID to delete'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        confirm: z
          .boolean()
          .optional()
          .describe('Set to true to confirm deleting event with attendees'),
      },
    },
    async (rawArgs) => {
      const args = coerceArgs(rawArgs, { confirm: 'boolean' });
      const validation = validateAccountScope(args.accountId, 'calendar:write');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        // Fetch event first to check for attendees
        const existingEvent = await client.getEvent(args.eventId, args.calendarId);
        const hasAttendees = existingEvent.attendees && existingEvent.attendees.length > 0;

        if (hasAttendees && !args.confirm) {
          return errorResponse(
            confirmationRequired(
              `delete event with ${existingEvent.attendees!.length} attendee(s)`,
              'Attendees will be notified of the cancellation. Set confirm: true to proceed.',
            ).toResponse(),
          );
        }

        await client.deleteEvent(args.eventId, args.calendarId);

        return successResponse({ success: true, message: 'Event deleted' });
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_rsvp - Respond to invitation (no confirm gate)
  server.registerTool(
    'calendar_rsvp',
    {
      description:
        'Respond to a Google Calendar invitation (accept, decline, or tentatively accept).',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        eventId: z.string().describe('The event ID to respond to'),
        response: z.enum(['accepted', 'declined', 'tentative']).describe('RSVP response'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar:write');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const event = await client.rsvp(args.eventId, args.response, args.calendarId);

        return successResponse(event);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );

  // calendar_move_event - Move event to different calendar (no confirm gate)
  server.registerTool(
    'calendar_move_event',
    {
      description: 'Move a Google Calendar event to a different calendar.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID, alias, or email'),
        eventId: z.string().describe('The event ID to move'),
        destinationCalendarId: z.string().describe('The destination calendar ID'),
        sourceCalendarId: z.string().optional().describe('Source calendar ID (default: "primary")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar:write');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const event = await client.moveEvent(
          args.eventId,
          args.destinationCalendarId,
          args.sourceCalendarId,
        );

        return successResponse(event);
      } catch (error) {
        return errorResponse(toMcpError(error));
      }
    },
  );
}
