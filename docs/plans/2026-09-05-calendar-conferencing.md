# Requirement: Google Meet conferencing + calendar discovery

**Status:** Implemented (2026-09-05) — see `docs/TASKS.md` for the shipped checklist
**Date:** 2026-09-05
**Area:** Calendar

Five related changes. (A) and (D) fix behaviour that is wrong today; (B), (C) and (E)
add capability. They are ordered so each one is safe to ship on its own.

---

## Motivating use-case

Meetings are the point of a calendar integration, and a meeting without its join link is
not actionable. Today this server cannot produce a Meet link, and — more surprisingly —
cannot even *read* one off an event that already has it. A user asking "what's the link
for my 3pm?" gets an event with no answer in it.

Alongside that: the Google Calendar UI lets a user replace an event's auto-generated
meeting code with an existing one (expand **View conference details** → hover the
**Meeting ID** → pencil → paste → Save). Users who rely on a standing meeting code expect
the same from the API.

---

## Current behaviour (with code citations)

### Conference data is dropped on every read path

`convertCalendarEvent` (`src/calendar/client.ts:452`) whitelists 15 fields:

```ts
const result: CalendarEvent = { id: e.id ?? '' };
if (e.summary) { result.summary = e.summary; }
// ... description, location, start, end, status, creator, organizer,
//     attendees, recurrence, recurringEventId, htmlLink, created, updated
```

Neither `hangoutLink` nor `conferenceData` is among them. Google returns both; we discard
them. Every read tool is affected at once, because all of them funnel through this one
converter — `calendar_list_events`, `calendar_get_event`, `calendar_search_events`, and
the events echoed back by the write tools.

This is structurally the same defect as the dropped `Cc` header (see `docs/TASKS.md`):
the data was in the API response the whole time, and a hand-maintained field whitelist
was the thing that lost it.

### No way to request a conference

`createEvent` (`src/calendar/client.ts:232`) builds a request body from summary, start,
end, description, location, attendees and recurrence, and never sets the
`conferenceDataVersion` query parameter. Without that parameter set to `1`, Google
**ignores conference data in the request body entirely** — so there is no partial support
here to extend; there is none.

### `updateEvent` round-trips an entire event body

`updateEvent` (`src/calendar/client.ts:263`) does `events.get`, spreads the raw response
into a new body, applies the caller's changes, and calls `events.update`:

```ts
const existing = await calendar.events.get({ calendarId: calId, eventId });
const requestBody: calendar_v3.Schema$Event = { ...existing.data };
// ...apply updates...
const response = await calendar.events.update({ calendarId: calId, eventId, requestBody, ... });
```

`events.update` is full replacement. This works today only because `conferenceDataVersion`
defaults to `0`, which makes Google ignore conference data in the body and preserve what
the event already has. Google warns about exactly this shape:

> You must perform a full sync of all events before enabling conference data support (by
> setting the `conferenceDataVersion` request parameter to `1` for event modifications)
> when adding conference support into your existing app that stores events locally. If you
> don't perform a sync first, you may inadvertently remove existing conferences from users'
> events.

We do not store events locally, but a get-then-full-replace is equivalent in effect: the
moment we send `conferenceDataVersion: 1`, whatever conference data sits in our request
body becomes authoritative. This makes the update path the riskiest part of the change,
and it is a latent hazard for every other field we do not model as well.

### Calendar discovery is thin

`listCalendars` (`src/calendar/client.ts:82`) calls `calendarList.list()` with no
parameters. Google caps that at 100 entries and returns a `nextPageToken` we discard, so
an account subscribed to more than 100 calendars silently loses the tail.
`convertCalendarInfo` (`src/calendar/client.ts:394`) does pass `accessRole` through, so
read-only vs editable *is* discoverable — but only as a raw Google enum
(`owner` / `writer` / `reader` / `freeBusyReader`) with nothing naming the consequence.
`summaryOverride` — the user's own rename of a shared calendar, often the only name they
would recognise — is not surfaced at all.

---

## API facts this design rests on

Verified against Google's reference, not memory. Each is a thing that would be easy to get
wrong in the opposite direction.

1. **`calendar.events` is sufficient.** `events.insert` accepts `calendar`,
   `calendar.events`, `calendar.app.created` and `calendar.events.owned`. Our
   `calendar:write` capability requests `calendar.events` (`src/auth/capabilities.ts:35`),
   so conferencing needs **no new scope and no re-auth**.
2. **`conferenceDataVersion: 1` is mandatory** on any request that creates, copies, or
   clears conference data. Version 0 "assumes no conference data support and ignores
   conference data in the event's body".
3. **Two mutually exclusive ways to populate `conferenceData`.** The reference states:
   "Either `conferenceSolution` and at least one `entryPoint`, or `createRequest` is
   required."
   - `createRequest` mints a **new** conference. Its only fields are `requestId` (an
     idempotency key) and `conferenceSolutionKey`. **There is no field for a desired
     meeting code** — you cannot ask Google for a specific one.
   - `conferenceSolution` + `entryPoints` **attaches an existing** conference. This is the
     documented "copy the entire `conferenceData` from one event to another" path, and it
     is the API equivalent of the UI's paste-a-meeting-ID pencil.
4. **Conference creation is asynchronous.** The insert response may carry
   `conferenceData.status.statusCode === 'pending'` with no `entryPoints` yet. A caller
   that returns the insert response verbatim hands back an event with no join link even
   though one was requested.
5. **Only `meetingCode`** of `{meetingCode, accessCode, passcode, password, pin}` applies
   to Meet: "populate only the subset ... that match the terminology that the conference
   provider uses."
6. **The docs contradict themselves on writability.** The field table marks
   `conferenceId`, `conferenceSolution`, `signature` and `entryPoints[].iconLink`
   read-only, while requirement (3) demands sending `conferenceSolution` and
   `entryPoints`. Working rule: send the whole blob minus `signature`. **This is the one
   claim here that must be confirmed against live Calendar before release** — mocks prove
   nothing about what Google accepts.
7. **Reusing a meeting code has a real cost, and it is not ours to hide.** Google:
   permissions and access stay tied to the *original* event's guest list; participants of
   the original event may reach the new meeting's recordings and chat; new guests may have
   to ask to join.

---

## Design

### A. Surface conference data on reads

Add to `CalendarEvent`:

```ts
hangoutLink?: string;
conferenceData?: ConferenceData;   // solution name/type, conferenceId, entryPoints[], status, notes
```

Extend `convertCalendarEvent` and add a `convertConferenceData` alongside the existing
private converters. One converter change reaches every read tool — the same property that
made the `Cc` fix a one-line-list change.

`entryPoints[]` keeps `entryPointType` (`video` / `phone` / `sip` / `more`), `uri`,
`label`, `pin`, `meetingCode`, `accessCode`, `passcode`, `password`, and `regionCode`,
each omitted when absent, matching the existing converters' style.

### B. Create a new Meet conference

`EventInput` gains `conferencing?: { type: 'googleMeet' }`. `createEvent` translates it to
a `createRequest` with a `randomUUID()` `requestId` and sets `conferenceDataVersion: 1`.

If the insert response comes back `pending`, re-`get` the event **once** and return that
instead, so a caller who asked for Meet never receives an event without it. One retry, not
a poll loop: the pending window is short, and an MCP tool call is not the place to block.

Tool surface: `addMeet: boolean` on `calendar_create_event`.

### C. Attach a specific existing Meet link

`EventInput` gains `conferencing?: { type: 'existing', meetingCode: string }`, translated
to `conferenceSolution: { key: { type: 'hangoutsMeet' } }` plus a single `video`
`entryPoint` carrying both `uri` and `meetingCode`.

Input accepts either a full `https://meet.google.com/abc-defg-hij` URL or a bare
`abc-defg-hij` code, normalised to both forms. Codes are validated against Meet's
`xxx-xxxx-xxx` shape — an unvalidated typo produces an event with a dead join button,
which is worse than an error.

**Gated behind `confirm: true`,** with fact (7) stated in the gate message. This is the
only operation in the set that can expose one meeting's recordings and chat to a different
set of people; the repo already gates outward-visible actions (sends, shares) this way.

`addMeet` and `meetingCode` are mutually exclusive — passing both is an input error rather
than a silent precedence rule.

Available on create **and** update; attaching a standing code to an existing meeting is the
more common case and is what the UI pencil does.

### D. `updateEvent`: `events.update` → `events.patch`

Prerequisite for (C), and correct independently. Patch sends only the fields the caller
actually changed, which:

- removes the get-then-replace round trip (one fewer API call per update),
- makes `conferenceDataVersion: 1` safe, since we no longer echo back a whole event body we
  do not fully model,
- eliminates a class of "field this server has never heard of gets clobbered on update"
  bugs — today an update silently rewrites every field of the event, including ones added
  to the Calendar API after this code was written.

The one behaviour that genuinely needs the existing event is the attendee confirm gate, and
that already fetches separately in the tool layer (`src/server/calendar-tools.ts:396`).

Conference removal (`conferenceData: null`, `conferenceDataVersion: 1`) rides on this, via
`removeConferencing: true`.

### E. Calendar discovery

- `canEdit: boolean` derived from `accessRole ∈ {owner, writer}`, alongside the raw
  `accessRole` — the raw enum stays, since it distinguishes `reader` from
  `freeBusyReader`, which `canEdit` cannot.
- Pagination: `maxResults` / `pageToken` in, `nextPageToken` out.
- `showHidden` / `showDeleted` passthrough; surface `summaryOverride`, `selected`,
  `hidden`, `deleted`.

Deliberately **not** in scope: resolving a calendar *name* to an ID inside the write tools,
and pre-flighting `accessRole` before a write to turn Google's 403 into a friendlier error.
Both cost an extra API call on every write and want a cache to be worth it. Listed as
follow-ups.

---

## Testing

Unit tests per section, written against mocked `googleapis` in the style of
`tests/unit/drive-comments.test.ts`:

- **A**: event with a Meet link; event with none; `pending` conference with no entry points;
  phone plus video entry points; absent optional subfields omitted rather than emitted as
  `undefined`.
- **B**: `conferenceDataVersion: 1` forwarded; `requestId` present and unique across calls;
  `pending` triggers exactly one re-get; `success` triggers none.
- **C**: URL and bare-code inputs both normalise to the same body; malformed code rejected;
  `conferenceSolution` + `entryPoints` sent and `createRequest` absent; both-options input
  error; confirm gate fires without `confirm` and passes with it.
- **D**: patch called instead of update; unspecified fields absent from the patch body;
  `conferenceData: null` sent on removal.
- **E**: `nextPageToken` returned; `canEdit` true for owner/writer and false for
  reader/freeBusyReader.

**Live verification before release** (mocks establish nothing about Google's acceptance):
create an event with a new Meet link and read the join URL back; attach an existing code to
an existing event and confirm fact (6) holds; update an event's summary and confirm its
conference survives; remove a conference.
