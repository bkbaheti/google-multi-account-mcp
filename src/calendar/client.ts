import { randomUUID } from 'node:crypto';
import { type calendar_v3, google } from 'googleapis';
import type { AccountStore } from '../auth/index.js';

export interface CalendarInfo {
  id: string;
  summary: string;
  /** The user's own rename of a shared calendar — often the only name they recognise. */
  summaryOverride?: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  /**
   * Raw Google role: 'owner' | 'writer' | 'writerWithoutPrivateAccess' | 'reader' |
   * 'freeBusyReader'.
   */
  accessRole?: string;
  /**
   * Whether events can be created or changed on this calendar. Derived from accessRole,
   * and kept alongside it rather than replacing it: `canEdit` cannot distinguish a
   * `reader` (sees event details) from a `freeBusyReader` (sees only busy blocks).
   */
  canEdit?: boolean;
  backgroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
}

export interface CalendarList {
  calendars: CalendarInfo[];
  nextPageToken?: string;
}

/**
 * Roles that permit writing events. Google's other roles are 'reader' and 'freeBusyReader'.
 *
 * `writerWithoutPrivateAccess` belongs here: Google documents it as "read and write access
 * to the calendar", differing from `writer` only in that private events' details stay
 * hidden. Omitting it reports a calendar the account can genuinely write to as read-only,
 * which is the failure direction that matters — an agent picking a target calendar would
 * silently skip it.
 */
const EDITABLE_ACCESS_ROLES = new Set(['owner', 'writer', 'writerWithoutPrivateAccess']);

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
  hangoutLink?: string;
  conferenceData?: ConferenceData;
}

/**
 * A conference attached to an event (Google Meet, or a third-party solution added
 * through a Calendar add-on).
 *
 * `status` is worth surfacing rather than hiding: Google creates conferences
 * asynchronously, so a freshly created event can legitimately come back with a
 * `pending` conference and no `entryPoints` yet.
 */
export interface ConferenceData {
  conferenceId?: string;
  conferenceSolution?: { name?: string; type?: string; iconUri?: string };
  entryPoints?: ConferenceEntryPoint[];
  status?: string;
  notes?: string;
}

export interface ConferenceEntryPoint {
  entryPointType?: string; // 'video' | 'phone' | 'sip' | 'more'
  uri?: string;
  label?: string;
  pin?: string;
  meetingCode?: string;
  accessCode?: string;
  passcode?: string;
  password?: string;
  regionCode?: string;
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
  conferencing?: ConferencingRequest;
}

/**
 * How an event should be conferenced.
 *
 * The two variants map to the two mutually exclusive ways Google accepts conference
 * data — the reference states "Either conferenceSolution and at least one entryPoint,
 * or createRequest is required":
 *
 * - `googleMeet` sends a `createRequest`, which mints a NEW conference. There is no
 *   field for a desired meeting code; you cannot ask Google for a specific one.
 * - `existing` sends `conferenceSolution` + `entryPoints`, which ATTACHES an
 *   already-existing conference. This is the documented "copy conferenceData from one
 *   event to another" path and the API equivalent of the Calendar UI's
 *   paste-a-meeting-ID pencil. Access stays bound to the original event's guest list,
 *   which is why the tool layer gates it behind an explicit confirm.
 * - `none` clears any conference on the event.
 */
export type ConferencingRequest =
  | { type: 'googleMeet' }
  | { type: 'existing'; meetingCode: string }
  | { type: 'none' };

/** Meet meeting codes are three-four-three lowercase letters, e.g. `abc-defg-hij`. */
const MEET_CODE_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/**
 * Accepts a full Meet URL or a bare meeting code and returns the normalised code.
 *
 * Validated rather than passed through: an unchecked typo produces an event whose join
 * button leads nowhere, which is a worse outcome than a rejected call.
 */
export function normalizeMeetingCode(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/^(?:https?:\/\/)?meet\.google\.com\/([^?#/]+)/i);
  const code = (fromUrl?.[1] ?? trimmed).toLowerCase();

  if (!MEET_CODE_PATTERN.test(code)) {
    throw new Error(
      `Invalid Google Meet meeting code: "${input}". Expected a code like "abc-defg-hij" or a https://meet.google.com/... URL.`,
    );
  }

  return code;
}

/**
 * Writes a conferencing request onto an event body.
 *
 * Clearing a conference is an explicit `null`, which the generated googleapis types do not
 * model (`conferenceData?: Schema$ConferenceData`, no null), hence the narrow cast.
 */
function applyConferenceData(
  requestBody: calendar_v3.Schema$Event,
  request: ConferencingRequest,
): void {
  const conferenceData = buildConferenceData(request);

  if (conferenceData === null) {
    (requestBody as { conferenceData?: unknown }).conferenceData = null;
    return;
  }

  requestBody.conferenceData = conferenceData;
}

/**
 * Translates a conferencing request into Google's `conferenceData` body.
 *
 * Returns `null` for `none`, which is how a conference is cleared — the caller sends that
 * null through, together with `conferenceDataVersion: 1`.
 */
export function buildConferenceData(
  request: ConferencingRequest,
): calendar_v3.Schema$ConferenceData | null {
  switch (request.type) {
    case 'none':
      return null;

    case 'googleMeet':
      // createRequest mints a NEW conference. requestId is an idempotency key, not a
      // meeting code — Google offers no way to request a specific code.
      return {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };

    case 'existing': {
      const code = normalizeMeetingCode(request.meetingCode);

      // The "copy conferenceData between events" shape: conferenceSolution plus at least
      // one entryPoint, and deliberately no createRequest. `meetingCode` is the only one
      // of {meetingCode, accessCode, passcode, password, pin} that matches Meet's
      // terminology, and Google asks that only the matching subset be populated.
      return {
        // For hangoutsMeet, Google defines conferenceId as the meeting code itself. Sent
        // because the documented path is copying a whole conferenceData block, and every
        // worked example of that carries the id.
        conferenceId: code,
        conferenceSolution: { key: { type: 'hangoutsMeet' } },
        entryPoints: [
          {
            entryPointType: 'video',
            uri: `https://meet.google.com/${code}`,
            meetingCode: code,
          },
        ],
      };
    }
  }
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

  async listCalendars(
    options: {
      maxResults?: number;
      pageToken?: string;
      showHidden?: boolean;
      showDeleted?: boolean;
    } = {},
  ): Promise<CalendarList> {
    const calendar = await this.getCalendar();

    // Google caps a page at 250 and defaults to 100. The previous implementation passed
    // nothing and dropped nextPageToken, so an account with more than 100 calendars
    // silently lost the tail.
    const params: calendar_v3.Params$Resource$Calendarlist$List = {};
    if (options.maxResults !== undefined) {
      params.maxResults = Math.min(Math.max(Math.round(options.maxResults), 1), 250);
    }
    if (options.pageToken !== undefined) {
      params.pageToken = options.pageToken;
    }
    if (options.showHidden !== undefined) {
      params.showHidden = options.showHidden;
    }
    if (options.showDeleted !== undefined) {
      params.showDeleted = options.showDeleted;
    }

    const response = await calendar.calendarList.list(params);

    const result: CalendarList = {
      calendars: (response.data.items ?? []).map((c) => this.convertCalendarInfo(c)),
    };

    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }

    return result;
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
    const calId = calendarId ?? 'primary';

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

    const conferencing = input.conferencing;
    if (conferencing) {
      applyConferenceData(requestBody, conferencing);
    }

    const hasAttendees = input.attendees && input.attendees.length > 0;

    const params: calendar_v3.Params$Resource$Events$Insert = {
      calendarId: calId,
      requestBody,
      sendUpdates: hasAttendees ? 'all' : 'none',
    };
    // Only sent when conferencing was actually requested. Google ignores body conference
    // data at version 0, so sending version 1 unconditionally would make our request body
    // authoritative over conference data we do not model.
    if (conferencing) {
      params.conferenceDataVersion = 1;
    }

    const response = await calendar.events.insert(params);

    return this.convertCalendarEvent(
      await this.settleConference(response.data, calId, conferencing),
    );
  }

  /**
   * Google creates conferences asynchronously, so an insert that requested one can return
   * with `status.statusCode === 'pending'` and no entry points. Re-read the event once so
   * a caller who asked for a Meet link does not get an event without one.
   *
   * Once, not a poll loop: the pending window is short, and an MCP tool call is the wrong
   * place to block. A conference still pending after the re-read comes back with its
   * status intact, which is honest about what happened.
   */
  private async settleConference(
    event: calendar_v3.Schema$Event,
    calendarId: string,
    conferencing: ConferencingRequest | undefined,
  ): Promise<calendar_v3.Schema$Event> {
    if (conferencing?.type !== 'googleMeet') {
      return event;
    }
    if (event.conferenceData?.createRequest?.status?.statusCode !== 'pending') {
      return event;
    }
    if (!event.id) {
      return event;
    }

    try {
      const calendar = await this.getCalendar();
      const refreshed = await calendar.events.get({ calendarId, eventId: event.id });

      return refreshed.data;
    } catch {
      // The write already succeeded — the event exists and its invitations have gone out.
      // Letting a failed convenience read propagate would report that write as failed, and
      // a caller retrying a non-idempotent create would produce a second event, a second
      // conference and a second round of invitations to real people. Return what the write
      // returned; its status still says the conference is pending.
      return event;
    }
  }

  /**
   * Patches an event.
   *
   * `events.patch`, not `events.update`: update is full replacement, so the previous
   * implementation had to read the whole event and echo every field back — silently
   * rewriting fields this server does not model, including any added to the Calendar API
   * since this code was written. Patch also removes the extra read, and it is what makes
   * `conferenceDataVersion: 1` safe here: with a full-body update, any conference data we
   * failed to round-trip would be authoritative and would wipe the event's conference.
   */
  async updateEvent(
    eventId: string,
    updates: Partial<EventInput>,
    calendarId?: string,
  ): Promise<CalendarEvent> {
    const calendar = await this.getCalendar();
    const calId = calendarId ?? 'primary';

    const requestBody: calendar_v3.Schema$Event = {};

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
      requestBody.start = this.buildEventDateTimeForPatch(updates.start);
    }
    if (updates.end !== undefined) {
      requestBody.end = this.buildEventDateTimeForPatch(updates.end);
    }
    if (updates.attendees !== undefined) {
      requestBody.attendees = updates.attendees.map((a) => ({ email: a.email }));
    }
    if (updates.recurrence !== undefined) {
      requestBody.recurrence = updates.recurrence;
    }

    const conferencing = updates.conferencing;
    if (conferencing) {
      applyConferenceData(requestBody, conferencing);
    }

    const params: calendar_v3.Params$Resource$Events$Patch = {
      calendarId: calId,
      eventId,
      requestBody,
      // 'all' unconditionally: Google notifies guests, and an event with no guests has
      // nobody to notify, so this needs no attendee lookup. The previous code read the
      // event first purely to decide this, and a change of time on a meeting with guests
      // must reach them.
      sendUpdates: 'all',
    };
    if (conferencing) {
      params.conferenceDataVersion = 1;
    }

    const response = await calendar.events.patch(params);

    return this.convertCalendarEvent(
      await this.settleConference(response.data, calId, conferencing),
    );
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

  /**
   * Builds a `start`/`end` for a patch, nulling the variant that must not survive.
   *
   * Patch merges nested objects rather than replacing them, so sending only `dateTime` at
   * an event that currently has `date` leaves BOTH set — a combination Google rejects, so
   * converting an all-day event to a timed one (or back) fails outright. The mutually
   * exclusive sibling has to be nulled explicitly.
   *
   * `timeZone` is nulled only when converting to all-day, where it is meaningless. On a
   * timed event it is left alone unless the caller supplied one: a caller changing just the
   * start time should not silently lose the event's time zone.
   */
  private buildEventDateTimeForPatch(dt: EventDateTime): calendar_v3.Schema$EventDateTime {
    if (dt.date) {
      return { date: dt.date, dateTime: null, timeZone: dt.timeZone ?? null };
    }

    const result: calendar_v3.Schema$EventDateTime = {
      dateTime: dt.dateTime ?? null,
      date: null,
    };
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
    if (c.summaryOverride) {
      result.summaryOverride = c.summaryOverride;
    }
    if (c.accessRole) {
      result.accessRole = c.accessRole;
      result.canEdit = EDITABLE_ACCESS_ROLES.has(c.accessRole);
    }
    if (c.backgroundColor) {
      result.backgroundColor = c.backgroundColor;
    }
    if (c.selected !== undefined && c.selected !== null) {
      result.selected = c.selected;
    }
    if (c.hidden !== undefined && c.hidden !== null) {
      result.hidden = c.hidden;
    }
    if (c.deleted !== undefined && c.deleted !== null) {
      result.deleted = c.deleted;
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
    if (e.hangoutLink) {
      result.hangoutLink = e.hangoutLink;
    }
    if (e.conferenceData) {
      result.conferenceData = this.convertConferenceData(e.conferenceData);
    }

    return result;
  }

  private convertConferenceData(c: calendar_v3.Schema$ConferenceData): ConferenceData {
    const result: ConferenceData = {};

    if (c.conferenceId) {
      result.conferenceId = c.conferenceId;
    }
    if (c.conferenceSolution) {
      const solution: { name?: string; type?: string; iconUri?: string } = {};
      if (c.conferenceSolution.name) {
        solution.name = c.conferenceSolution.name;
      }
      if (c.conferenceSolution.key?.type) {
        solution.type = c.conferenceSolution.key.type;
      }
      if (c.conferenceSolution.iconUri) {
        solution.iconUri = c.conferenceSolution.iconUri;
      }
      result.conferenceSolution = solution;
    }
    if (c.entryPoints && c.entryPoints.length > 0) {
      result.entryPoints = c.entryPoints.map((ep) => this.convertEntryPoint(ep));
    }
    // A conference created in the same request is asynchronous: the status distinguishes
    // "no link yet, ask again" from "this conference has no video entry point".
    if (c.createRequest?.status?.statusCode) {
      result.status = c.createRequest.status.statusCode;
    }
    if (c.notes) {
      result.notes = c.notes;
    }

    return result;
  }

  private convertEntryPoint(ep: calendar_v3.Schema$EntryPoint): ConferenceEntryPoint {
    const result: ConferenceEntryPoint = {};

    if (ep.entryPointType) {
      result.entryPointType = ep.entryPointType;
    }
    if (ep.uri) {
      result.uri = ep.uri;
    }
    if (ep.label) {
      result.label = ep.label;
    }
    if (ep.pin) {
      result.pin = ep.pin;
    }
    if (ep.meetingCode) {
      result.meetingCode = ep.meetingCode;
    }
    if (ep.accessCode) {
      result.accessCode = ep.accessCode;
    }
    if (ep.passcode) {
      result.passcode = ep.passcode;
    }
    if (ep.password) {
      result.password = ep.password;
    }
    if (ep.regionCode) {
      result.regionCode = ep.regionCode;
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
    if (
      a.responseStatus &&
      ['needsAction', 'declined', 'tentative', 'accepted'].includes(a.responseStatus)
    ) {
      result.responseStatus = a.responseStatus as
        | 'needsAction'
        | 'declined'
        | 'tentative'
        | 'accepted';
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
