import { type calendar_v3, google } from 'googleapis';
import type { AccountStore } from '../auth/index.js';

export interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  status?: string;
  creator?: { email?: string; displayName?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: EventAttendee[];
  recurrence?: string[];
  recurringEventId?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
}

export interface EventDateTime {
  dateTime?: string; // RFC3339 timestamp
  date?: string; // YYYY-MM-DD for all-day events
  timeZone?: string;
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
}

export interface EventList {
  events: CalendarEvent[];
  nextPageToken?: string;
}

export interface FreeBusyResult {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

export interface EventInput {
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Array<{ email: string }>;
  recurrence?: string[];
  timeZone?: string;
}

export class CalendarClient {
  private readonly accountStore: AccountStore;
  private readonly accountId: string;
  private calendar: calendar_v3.Calendar | null = null;

  constructor(accountStore: AccountStore, accountId: string) {
    this.accountStore = accountStore;
    this.accountId = accountId;
  }

  private async getCalendar(): Promise<calendar_v3.Calendar> {
    if (!this.calendar) {
      const auth = await this.accountStore.getAuthenticatedClient(this.accountId);
      this.calendar = google.calendar({ version: 'v3', auth });
    }
    return this.calendar;
  }

  // === Read methods ===

  async listCalendars(): Promise<CalendarInfo[]> {
    const calendar = await this.getCalendar();

    const response = await calendar.calendarList.list();

    return (response.data.items ?? []).map((c) => this.convertCalendarInfo(c));
  }

  async listEvents(
    options: {
      calendarId?: string;
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
      pageToken?: string;
      singleEvents?: boolean;
      orderBy?: string;
    } = {},
  ): Promise<EventList> {
    const calendar = await this.getCalendar();

    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId: options.calendarId ?? 'primary',
      singleEvents: options.singleEvents ?? true,
      orderBy: options.orderBy ?? 'startTime',
      maxResults: options.maxResults ?? 20,
    };

    if (options.timeMin) {
      params.timeMin = options.timeMin;
    }
    if (options.timeMax) {
      params.timeMax = options.timeMax;
    }
    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }

    const response = await calendar.events.list(params);

    const events: CalendarEvent[] = (response.data.items ?? []).map((e) =>
      this.convertCalendarEvent(e),
    );

    const result: EventList = { events };

    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }

    return result;
  }

  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();

    const response = await calendar.events.get({
      calendarId: calendarId ?? 'primary',
      eventId,
    });

    return this.convertCalendarEvent(response.data);
  }

  async searchEvents(
    query: string,
    options: {
      calendarId?: string;
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
      pageToken?: string;
      singleEvents?: boolean;
      orderBy?: string;
    } = {},
  ): Promise<EventList> {
    const calendar = await this.getCalendar();

    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId: options.calendarId ?? 'primary',
      q: query,
      singleEvents: options.singleEvents ?? true,
      orderBy: options.orderBy ?? 'startTime',
      maxResults: options.maxResults ?? 20,
    };

    if (options.timeMin) {
      params.timeMin = options.timeMin;
    }
    if (options.timeMax) {
      params.timeMax = options.timeMax;
    }
    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }

    const response = await calendar.events.list(params);

    const events: CalendarEvent[] = (response.data.items ?? []).map((e) =>
      this.convertCalendarEvent(e),
    );

    const result: EventList = { events };

    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }

    return result;
  }

  async freeBusy(options: {
    timeMin: string;
    timeMax: string;
    calendarIds?: string[];
  }): Promise<FreeBusyResult> {
    const calendar = await this.getCalendar();

    const calendarIds = options.calendarIds ?? ['primary'];

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const calendars: FreeBusyResult['calendars'] = {};

    const responseCalendars = response.data.calendars;
    if (responseCalendars) {
      for (const [calId, calData] of Object.entries(responseCalendars)) {
        calendars[calId] = {
          busy: (calData.busy ?? []).map((b) => ({
            start: b.start ?? '',
            end: b.end ?? '',
          })),
        };
      }
    }

    return { calendars };
  }

  // === Write methods ===

  async createEvent(input: EventInput, calendarId?: string): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();

    const requestBody: calendar_v3.Schema$Event = {
      summary: input.summary,
      start: this.buildEventDateTime(input.start),
      end: this.buildEventDateTime(input.end),
    };

    if (input.description) {
      requestBody.description = input.description;
    }
    if (input.location) {
      requestBody.location = input.location;
    }
    if (input.attendees) {
      requestBody.attendees = input.attendees.map((a) => ({ email: a.email }));
    }
    if (input.recurrence) {
      requestBody.recurrence = input.recurrence;
    }

    const hasAttendees = input.attendees && input.attendees.length > 0;

    const response = await calendar.events.insert({
      calendarId: calendarId ?? 'primary',
      requestBody,
      sendUpdates: hasAttendees ? 'all' : 'none',
    });

    return this.convertCalendarEvent(response.data);
  }

  async updateEvent(
    eventId: string,
    updates: Partial<EventInput>,
    calendarId?: string,
  ): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();
    const calId = calendarId ?? 'primary';

    // Get existing event first
    const existing = await calendar.events.get({
      calendarId: calId,
      eventId,
    });

    const requestBody: calendar_v3.Schema$Event = { ...existing.data };

    if (updates.summary !== undefined) {
      requestBody.summary = updates.summary;
    }
    if (updates.description !== undefined) {
      requestBody.description = updates.description;
    }
    if (updates.location !== undefined) {
      requestBody.location = updates.location;
    }
    if (updates.start !== undefined) {
      requestBody.start = this.buildEventDateTime(updates.start);
    }
    if (updates.end !== undefined) {
      requestBody.end = this.buildEventDateTime(updates.end);
    }
    if (updates.attendees !== undefined) {
      requestBody.attendees = updates.attendees.map((a) => ({ email: a.email }));
    }
    if (updates.recurrence !== undefined) {
      requestBody.recurrence = updates.recurrence;
    }

    const hasAttendees =
      (requestBody.attendees && requestBody.attendees.length > 0) ||
      (updates.attendees && updates.attendees.length > 0);

    const response = await calendar.events.update({
      calendarId: calId,
      eventId,
      requestBody,
      sendUpdates: hasAttendees ? 'all' : 'none',
    });

    return this.convertCalendarEvent(response.data);
  }

  async deleteEvent(
    eventId: string,
    calendarId?: string,
    sendUpdates?: 'all' | 'externalOnly' | 'none',
  ): Promise<void> {
    const calendar = await this.getCalendar();

    await calendar.events.delete({
      calendarId: calendarId ?? 'primary',
      eventId,
      sendUpdates: sendUpdates ?? 'all',
    });
  }

  async rsvp(
    eventId: string,
    response: 'needsAction' | 'declined' | 'tentative' | 'accepted',
    calendarId?: string,
  ): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();
    const calId = calendarId ?? 'primary';

    // Get the existing event
    const existing = await calendar.events.get({
      calendarId: calId,
      eventId,
    });

    const attendees = existing.data.attendees ?? [];

    // Find self in attendees and update response status
    const updatedAttendees = attendees.map((a) => {
      if (a.self) {
        return { ...a, responseStatus: response };
      }
      return a;
    });

    const patchResponse = await calendar.events.patch({
      calendarId: calId,
      eventId,
      requestBody: {
        attendees: updatedAttendees,
      },
      sendUpdates: 'all',
    });

    return this.convertCalendarEvent(patchResponse.data);
  }

  async moveEvent(
    eventId: string,
    destinationCalendarId: string,
    sourceCalendarId?: string,
  ): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();

    const response = await calendar.events.move({
      calendarId: sourceCalendarId ?? 'primary',
      eventId,
      destination: destinationCalendarId,
    });

    return this.convertCalendarEvent(response.data);
  }

  // === Private converter methods ===

  private buildEventDateTime(dt: EventDateTime): calendar_v3.Schema$EventDateTime {
    const result: calendar_v3.Schema$EventDateTime = {};

    if (dt.dateTime) {
      result.dateTime = dt.dateTime;
    }
    if (dt.date) {
      result.date = dt.date;
    }
    if (dt.timeZone) {
      result.timeZone = dt.timeZone;
    }

    return result;
  }

  private convertCalendarInfo(c: calendar_v3.Schema$CalendarListEntry): CalendarInfo {
    const result: CalendarInfo = {
      id: c.id ?? '',
      summary: c.summary ?? '',
    };

    if (c.description) {
      result.description = c.description;
    }
    if (c.timeZone) {
      result.timeZone = c.timeZone;
    }
    if (c.primary !== undefined && c.primary !== null) {
      result.primary = c.primary;
    }
    if (c.accessRole) {
      result.accessRole = c.accessRole;
    }
    if (c.backgroundColor) {
      result.backgroundColor = c.backgroundColor;
    }

    return result;
  }

  private convertCalendarEvent(e: calendar_v3.Schema$Event): CalendarEvent {
    const result: CalendarEvent = {
      id: e.id ?? '',
    };

    if (e.summary) {
      result.summary = e.summary;
    }
    if (e.description) {
      result.description = e.description;
    }
    if (e.location) {
      result.location = e.location;
    }
    if (e.start) {
      result.start = this.convertEventDateTime(e.start);
    }
    if (e.end) {
      result.end = this.convertEventDateTime(e.end);
    }
    if (e.status) {
      result.status = e.status;
    }
    if (e.creator) {
      const creator: { email?: string; displayName?: string } = {};
      if (e.creator.email) {
        creator.email = e.creator.email;
      }
      if (e.creator.displayName) {
        creator.displayName = e.creator.displayName;
      }
      result.creator = creator;
    }
    if (e.organizer) {
      const organizer: { email?: string; displayName?: string } = {};
      if (e.organizer.email) {
        organizer.email = e.organizer.email;
      }
      if (e.organizer.displayName) {
        organizer.displayName = e.organizer.displayName;
      }
      result.organizer = organizer;
    }
    if (e.attendees && e.attendees.length > 0) {
      result.attendees = e.attendees.map((a) => this.convertEventAttendee(a));
    }
    if (e.recurrence && e.recurrence.length > 0) {
      result.recurrence = e.recurrence;
    }
    if (e.recurringEventId) {
      result.recurringEventId = e.recurringEventId;
    }
    if (e.htmlLink) {
      result.htmlLink = e.htmlLink;
    }
    if (e.created) {
      result.created = e.created;
    }
    if (e.updated) {
      result.updated = e.updated;
    }

    return result;
  }

  private convertEventDateTime(dt: calendar_v3.Schema$EventDateTime): EventDateTime {
    const result: EventDateTime = {};

    if (dt.dateTime) {
      result.dateTime = dt.dateTime;
    }
    if (dt.date) {
      result.date = dt.date;
    }
    if (dt.timeZone) {
      result.timeZone = dt.timeZone;
    }

    return result;
  }

  private convertEventAttendee(a: calendar_v3.Schema$EventAttendee): EventAttendee {
    const result: EventAttendee = {
      email: a.email ?? '',
    };

    if (a.displayName) {
      result.displayName = a.displayName;
    }
    if (a.responseStatus) {
      result.responseStatus = a.responseStatus as EventAttendee['responseStatus'];
    }
    if (a.organizer !== undefined && a.organizer !== null) {
      result.organizer = a.organizer;
    }
    if (a.self !== undefined && a.self !== null) {
      result.self = a.self;
    }

    return result;
  }
}
