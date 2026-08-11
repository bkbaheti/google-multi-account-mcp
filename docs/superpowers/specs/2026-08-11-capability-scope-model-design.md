# Design: per-service capability model replacing scope tiers

**Status:** Approved design, not yet implemented
**Date:** 2026-08-11
**Area:** Auth / scope validation
**Breaking:** yes — target version 0.5.0

## Problem

`SCOPE_IMPLIES` in `src/types/index.ts` declared `drive.file` implies `drive.readonly`, commented "drive.file includes all of drive.readonly permissions." That is false. Google scopes `drive.file` to app-created/app-opened files; `drive.readonly` grants read access to everything. Neither contains the other.

The consequence landed on the feature shipped 2026-08-07. `drive_get_comments` is gated on the `drive_readonly` tier *precisely because* a client-shared Doc is unreachable under `drive.file` — but the false implication let `drive.file`-only accounts through the gate. Worse, `drive_search_files` and `drive_list_files` then **succeed** under `drive.file`, returning only app-visible files. A search for a document that exists returns "no results", indistinguishable from the document not being there. The gate was a no-op for its own motivating case.

Found while building the E2E harness, before any real-account test ran.

### Three distinct flaws

1. **`drive_full` is a misnomer.** It grants `drive.file` — per-file write access — and is not a superset of `drive_readonly`. The two are parallel, like `mail_settings` and `mail_full`. The mail tiers *are* a real hierarchy, which makes the false analogy easy to draw.
2. **`getScopeTier()` returns one tier for a whole account.** An account spans three services. `Procedure` holds all nine scopes and reports `drive_full`. That string is shown by `google_list_accounts` and used in the reauth flow.
3. **Tiers do two incompatible jobs.** They are both the OAuth request bundle (per-account, must cover everything wanted) and the permission predicate (per-operation, needs one capability). The tier→scope indirection is where the lie could hide.

Flaw 3 is the root cause: a gate saying "I need the `drive_readonly` tier" must resolve a tier through a table, and the table lied.

## Model

Eight capabilities, `service:level`:

| Capability | Google scope(s) |
|---|---|
| `mail:read` | `gmail.readonly` |
| `mail:compose` | `gmail.compose` |
| `mail:modify` | `gmail.modify`, `gmail.labels` |
| `mail:settings` | `gmail.settings.basic` |
| `drive:read` | `drive.readonly` |
| `drive:appfiles` | `drive.file` |
| `calendar:read` | `calendar.readonly` |
| `calendar:write` | `calendar.events` |

`userinfo.email` is always requested and is not a capability.

**Implications — exactly one, verified against Google's documentation:**

- `mail:modify ⇒ mail:read`. Google describes `gmail.modify` as "Read, compose, and send emails from your Gmail account", so it genuinely subsumes `gmail.readonly`.

Nothing else nests:

- `drive:read` and `drive:appfiles` are independent. Google: `drive.file` is "Create new Drive files, or modify existing files, that you open with an app or that the user shares with an app"; `drive.readonly` is "View and download all your Drive files". Neither contains the other.
- **`calendar:write` does NOT imply `calendar:read`.** An earlier draft of this design asserted it did, repeating the same class of error being fixed. `calendar.events` authorizes neither `calendarList.list` nor `freebusy.query` — both accept only `calendar.readonly` (or the broader `calendar`, which this project does not request). So a `calendar.events`-only account cannot list calendars or query free/busy, and the old `SCOPE_IMPLIES` entry made those two tools pass their gate and then fail at Google.
- `mail:compose` and `mail:settings` are independent additions, not rungs on a ladder. `gmail.compose` grants **no** read access, which is why the old `mail_compose` tier had to list `gmail.readonly` explicitly.
- `mail:modify` does **not** cover label management — Google requires `gmail.labels` separately — which is why `mail:modify` maps to both scopes.

### Gates may require any-of

Reading calendar events is authorized by *either* calendar scope, so a single required capability cannot express it. A gate therefore takes either one capability or a list meaning **any of these suffices**:

| Tool | Requires |
|---|---|
| `calendar_list_calendars`, `calendar_freebusy` | `calendar:read` |
| `calendar_list_events`, `calendar_get_event`, `calendar_search_events` | any of `calendar:read`, `calendar:write` |
| `calendar_create_event`, `calendar_update_event`, `calendar_delete_event`, `calendar_rsvp`, `calendar_move_event` | `calendar:write` |

### One deliberate departure from raw authorization

Drive read tools require `drive:read` even though `files.list` technically succeeds under `drive.file`. Under `drive.file` it returns only app-created files, so a search for a document that exists comes back empty — a silent wrong answer. Requiring `drive:read` converts that into an actionable error. This is a product choice, not a claim about what Google authorizes, and is recorded here so it is not later "corrected" to any-of.

## Derived, never stored

`capabilitiesOf(scopes: string[]): Capability[]` computes the set from granted scopes. Accounts keep storing raw scopes exactly as today.

Consequences: no config migration for existing accounts; and if a user revokes a scope in their Google account settings, the derived view follows automatically. A stored copy would drift.

## Gates

Every operation declares the capability it needs:

```
validateAccountScope(id, 'drive_readonly')   ->   requireCapability(id, 'drive:read')
```

57 call sites: 29 in `gmail-tools.ts`, 17 in `drive-tools.ts`, 10 in `calendar-tools.ts`, 1 in `server/index.ts`.

The property that matters: there is no lookup table between a gate and a scope any more, so a gate cannot be wrong about what it is asking for. `OPERATION_SCOPE_REQUIREMENTS` and `SCOPE_IMPLIES` both disappear.

## Account description

`getScopeTier()` is removed. `google_list_accounts` reports a per-service view:

```json
{ "mail": ["read", "compose", "modify", "settings"],
  "drive": ["appfiles"],
  "calendar": ["read", "write"] }
```

## Reauth

Replace semantics are kept — what you ask for is what you get, and narrowing an account stays possible. But when the requested capability set would drop capabilities the account currently holds, the call refuses, names each one, and requires `confirm: true`. This mirrors the existing confirm gates on sending and sharing.

Motivation: reauthorizing `Personal` for Drive access alone would otherwise silently destroy its Gmail and Calendar access.

## Public API

Breaking. `scopeTier` and `scopeTiers` are removed from `google_add_account` and `google_reauth_account`; both take `capabilities: string[]`. Version 0.5.0, published under the existing `beta` dist-tag.

CHANGELOG carries the mapping:

| Old tier | New capabilities |
|---|---|
| `mail_readonly` | `mail:read` |
| `mail_compose` | `mail:read`, `mail:compose` |
| `mail_full` | `mail:modify` |
| `mail_settings` | `mail:read`, `mail:settings` |
| `drive_readonly` | `drive:read` |
| `drive_full` | `drive:appfiles` |
| `calendar_readonly` | `calendar:read` |
| `calendar_full` | `calendar:write` |
| `all` | all eight |

## Errors

A failed gate names the missing capability and the exact remedy, e.g.:

```
Account "Personal" is missing capability drive:read.
Re-authorize with: google_reauth_account accountId="Personal"
  capabilities=["mail:modify","mail:compose","mail:settings","drive:appfiles","drive:read","calendar:write"]
```

The suggested list is the account's current capabilities plus the missing one, so following it never narrows the account.

## Out of scope

- Requesting Google's broad `.../auth/drive` scope. The project deliberately avoids it.
- Any change to token storage or the OAuth flow itself beyond the capability→scope translation.
- Per-capability incremental authorization (asking Google for one more scope without re-consenting to the rest).

## Consequences for other work

The E2E harness plan (`2026-08-10-e2e-stage1-fixtures-and-preflight.md`) is paused. Tasks 1–2 are complete and unaffected. Task 3's preflight asserts on tier names that will no longer exist and must be rewritten against capabilities once this lands.

`Personal` will need `google_reauth_account` with the full capability list to regain Drive read access — it currently holds `drive.file` only.
