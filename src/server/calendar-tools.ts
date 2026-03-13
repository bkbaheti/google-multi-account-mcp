import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AccountStore } from '../auth/index.js';
import {
  confirmationRequired,
  errorResponse,
  successResponse,
  toMcpError,
} from '../errors/index.js';
import { CalendarClient } from '../calendar/index.js';
import type { ScopeTier } from '../types/index.js';

export function registerCalendarTools(
  server: McpServer,
  accountStore: AccountStore,
  validateAccountScope: (accountId: string, requiredTier: ScopeTier) =>
    { error: ReturnType<typeof errorResponse> } | { account: any },
): void {
  // === Read tools (require calendar_readonly) ===

  // calendar_list_calendars - List all calendars
  server.registerTool(
    'calendar_list_calendars',
    {
      description: 'List all calendars for a Google account (primary, shared, subscribed).',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);
        const calendars = await client.listCalendars();

        return successResponse(calendars);
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
        accountId: z.string().describe('The Google account ID'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        timeMin: z.string().optional().describe('Start of time range (RFC3339, e.g., "2024-01-01T00:00:00Z")'),
        timeMax: z.string().optional().describe('End of time range (RFC3339, e.g., "2024-12-31T23:59:59Z")'),
        maxResults: z.number().optional().describe('Maximum number of events to return (default: 20)'),
        pageToken: z.string().optional().describe('Token for pagination'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
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
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
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
        accountId: z.string().describe('The Google account ID'),
        query: z.string().describe('Search text to find in events'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        timeMin: z.string().optional().describe('Start of time range (RFC3339)'),
        timeMax: z.string().optional().describe('End of time range (RFC3339)'),
        maxResults: z.number().optional().describe('Maximum number of events to return (default: 20)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
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
      description:
        'Check free/busy status for one or more Google Calendars within a time range.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        timeMin: z.string().describe('Start of time range (RFC3339)'),
        timeMax: z.string().describe('End of time range (RFC3339)'),
        calendarIds: z.array(z.string()).optional().describe('Calendar IDs to check (default: ["primary"])'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_readonly');
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

  // === Write tools (require calendar_full) ===

  // calendar_create_event - Create event (confirm required if attendees present)
  server.registerTool(
    'calendar_create_event',
    {
      description:
        'Create a new Google Calendar event. If attendees are included, requires confirm: true as a safety gate since it will send calendar invitations.',
      inputSchema: {
        accountId: z.string().describe('The Google account ID'),
        summary: z.string().describe('Event title/summary'),
        start: z.string().describe('Start time (RFC3339 for timed event, e.g., "2024-01-15T09:00:00-05:00") or date (YYYY-MM-DD for all-day event)'),
        end: z.string().describe('End time (RFC3339 for timed event) or date (YYYY-MM-DD for all-day event)'),
        description: z.string().optional().describe('Event description'),
        location: z.string().optional().describe('Event location'),
        attendees: z.array(z.string()).optional().describe('Email addresses of attendees'),
        timeZone: z.string().optional().describe('Time zone (e.g., "America/New_York"). Required for timed events without offset.'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        recurrence: z.array(z.string()).optional().describe('Recurrence rules (e.g., ["RRULE:FREQ=WEEKLY;COUNT=10"])'),
        confirm: z.boolean().optional().describe('Set to true to confirm creating event with attendees (sends invitations)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
      if ('error' in validation) return validation.error;

      // Conditional confirm gate: only if attendees present
      const hasAttendees = args.attendees && args.attendees.length > 0;
      if (hasAttendees && !args.confirm) {
        return errorResponse(
          confirmationRequired(
            `create event with ${args.attendees!.length} attendee(s)`,
            'This will send calendar invitations. Set confirm: true to proceed.',
          ).toResponse(),
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
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID to update'),
        summary: z.string().optional().describe('New event title/summary'),
        start: z.string().optional().describe('New start time (RFC3339) or date (YYYY-MM-DD for all-day)'),
        end: z.string().optional().describe('New end time (RFC3339) or date (YYYY-MM-DD for all-day)'),
        description: z.string().optional().describe('New event description'),
        location: z.string().optional().describe('New event location'),
        attendees: z.array(z.string()).optional().describe('New attendee email addresses (replaces existing attendees)'),
        timeZone: z.string().optional().describe('Time zone (e.g., "America/New_York")'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        confirm: z.boolean().optional().describe('Set to true to confirm updating event with attendees (sends notifications)'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
      if ('error' in validation) return validation.error;

      try {
        const client = new CalendarClient(accountStore, args.accountId);

        // Check if new attendees are being added
        const addingAttendees = args.attendees && args.attendees.length > 0;

        if (addingAttendees && !args.confirm) {
          return errorResponse(
            confirmationRequired(
              `update event with ${args.attendees!.length} attendee(s)`,
              'This will send calendar notifications to attendees. Set confirm: true to proceed.',
            ).toResponse(),
          );
        }

        // If no new attendees, check if existing event has attendees
        if (!addingAttendees && !args.confirm) {
          const existingEvent = await client.getEvent(args.eventId, args.calendarId);
          if (existingEvent.attendees && existingEvent.attendees.length > 0) {
            return errorResponse(
              confirmationRequired(
                `update event with ${existingEvent.attendees.length} existing attendee(s)`,
                'This event has attendees who will be notified of changes. Set confirm: true to proceed.',
              ).toResponse(),
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
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID to delete'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
        confirm: z.boolean().optional().describe('Set to true to confirm deleting event with attendees'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
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
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID to respond to'),
        response: z.enum(['accepted', 'declined', 'tentative']).describe('RSVP response'),
        calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
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
        accountId: z.string().describe('The Google account ID'),
        eventId: z.string().describe('The event ID to move'),
        destinationCalendarId: z.string().describe('The destination calendar ID'),
        sourceCalendarId: z.string().optional().describe('Source calendar ID (default: "primary")'),
      },
    },
    async (args) => {
      const validation = validateAccountScope(args.accountId, 'calendar_full');
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
