# Design: capability gate correctness, permission UX, and the documentation surface

**Status:** Implemented 2026-08-11/12, shipped as 0.5.1 (all 12 plan tasks). Open items are the owner decisions in the handoff, not implementation work.
**Date:** 2026-08-11
**Area:** Auth / errors / docs / site
**Supersedes parts of:** `2026-08-11-capability-scope-model-design.md`

## Problem

The capability model shipped in 0.5.0 replaced scope tiers because the old model encoded false claims about Google's scopes. In fixing that it **over-corrected**: gates now refuse calls Google actually authorizes.

An `xhigh` multi-agent review found 15 defects, 9 of them correctness. A separate design panel then produced the permission-UX design below. Both are folded into this spec.

The root cause of the over-correction was a verification failure: scope *description* pages were checked ("View and download all your Drive files"), but per-method **authorized scopes** lists were not. Every claim in this spec cites the method reference page it came from.

## Verified scope matrix

Checked against Google's per-method reference pages on 2026-08-11. **This table is the authority. Do not extend it from reasoning — verify each addition against the method page.**

| Method | Accepts `drive.file`? | Accepts `drive.readonly`? |
|---|---|---|
| `files.get` | yes | yes |
| `files.export` | yes | yes |
| `files.list` | yes | yes |
| `comments.list` | yes | yes |
| `replies.list` | yes | yes |
| `drives.list` | **no** | yes |

| Method | Accepts `gmail.modify`? | Accepts `gmail.readonly`? |
|---|---|---|
| `users.drafts.create` | yes | no |
| `users.messages.send` | yes | no |
| `users.labels.list` | yes | yes |

| Method | Accepts `calendar.events`? | Accepts `calendar.readonly`? |
|---|---|---|
| `calendarList.list` | **no** | yes |
| `freebusy.query` | **no** | yes |
| `events.list` / `events.get` | yes | yes |

`drive.file` authorizes the *method* but only reaches files the app created or the user explicitly opened with it. Other files are invisible — Drive returns not-found rather than revealing existence.

A design panel guessed `drives.list` permissively; the method page says otherwise. That miss is why the rule above exists.

## Part A — gate correctness

### A1. Drive read gates

Eight of the nine loosen to any-of; one does not.

| Tool | New requirement |
|---|---|
| `drive_get_file`, `drive_get_file_content`, `drive_get_full_file_content`, `drive_download_file` | any-of `['drive:read','drive:appfiles']` |
| `drive_get_comments`, `drive_get_comment_replies` | any-of `['drive:read','drive:appfiles']` |
| `drive_search_files`, `drive_list_files` | any-of `['drive:read','drive:appfiles']` |
| `drive_list_shared_drives` | `drive:read` only — `drives.list` rejects `drive.file` |

This fixes the regression where a `drive:appfiles` account could upload a file and then be refused permission to read it back.

### A2. The `mail:modify ⇒ mail:compose` implication

`gmail.modify` authorizes `users.drafts.create` and `users.messages.send`. Add the implication so `CAPABILITY_IMPLIES` reads:

```
mail:modify -> [mail:read, mail:compose]
```

Still no drive or calendar implication.

### A3. `gmail_list_labels`

`users.labels.list` accepts `gmail.readonly`. Change from `mail:modify` to any-of `['mail:read','mail:modify']`.

### A4. Narrow remedy for any-of gates

`requireCapability` currently passes the whole `accept` array as `missing`, so the suggested remedy unions every alternative — telling a user who wants to read one meeting to grant `calendar.events` write access.

Each gate becomes `{ accept: Capability[], remedy: Capability, escalation?: Capability }`:

- `accept` mirrors the method's authorized-scope list.
- `remedy` is the narrowest member, and the only capability in the executable `google_reauth_account` line.
- `escalation` is the broader member, offered as a second line preceded by the condition under which the narrow one will not suffice.

### A5. Non-scope correctness bugs

- **`capabilities: []`** — `[]` is truthy, so `scopesFor([])` strips an account to `userinfo.email`. Treat empty as "unspecified" in `startReauthAccount` / `startAddAccount` / `addAccount`, matching what `google_add_account` already does.
- **Legacy `scopeTier`** — zod strips unknown keys, so a legacy call silently no-ops through a full OAuth round trip and reports success. Reject unknown keys explicitly with a validation error naming the replacement.
- **Requested vs granted scopes** — `account.scopes` stores what was *requested*, never what Google *granted*. With granular consent a user can decline a scope and still complete the flow, leaving gates passing for a scope the account lacks. Read `tokens.scope` from the token response and persist that.
- **Unbounded Drawing preview** — binary Workspace exports route into the base64 branch that ignores `maxChars`, so a preview tool can return megabytes. Truncate or refuse with a pointer to `drive_download_file`.
- **`exportMimeType: ''`** — clears validation then falls through `??`, routing a Doc to the raw-media path Drive rejects. Treat empty string as absent.
- **Raw `Error` for `exportMimeType` misuse** — use `validationError`, not a bare `Error` that surfaces as `UNKNOWN_ERROR`.
- **Barrel exports** — `src/index.ts` dropped `ScopeTier` without exporting `Capability`, so library consumers cannot name the type `addAccount` requires.
- **Fail-open gate test** — `gate-mapping.test.ts` asserts against a hand-listed set, so a tool registered with no gate produces no entry and no failure. Assert `Object.keys(gates)` equals `Object.keys(handlers)`.

## Part B — permission UX

Loosening the gates converts a hard refusal into a quieter partial result. The response layer carries that difference.

### B1. Coverage annotation

Every Drive response on an account holding `drive:appfiles` but not `drive:read` carries a `coverage` block — **always, including non-empty results**. Annotating only empty results teaches "warning means zero results" rather than "your view is partial", which is how three-of-four-thousand reads as complete.

List responses put a `warning` string as the literal first key so it survives client truncation.

### B2. Error taxonomy

A Drive not-found on an account lacking `drive:read` is retyped `DRIVE_FILE_NOT_VISIBLE` with `ambiguous: true`. The same not-found on an account holding `drive:read` stays `NOT_FOUND` with `ambiguous: false`, which licenses an agent to stop looking.

Permission errors carry `retryable`, `reauthHelps`, `requiresHumanApproval`, and `alternativeAccounts` — the last being the only recovery path that costs zero consent screens, and the reason a multi-account broker is an asset here.

**Known false positive:** a mistyped or deleted file ID 404s identically, so an `appfiles`-only account will sometimes be pointed at a consent flow it does not need. Accepted: a spurious consent prompt is visible, cheap and reversible; a confident "that contract doesn't exist" about a client's document is none of those.

### B3. Capability vocabulary and presets

Names stay as they are. Renaming `drive:appfiles` was proposed and rejected — it churns every stored account and published README, and understates that `drive.file` also writes.

One table in `src/auth/capabilities.ts` becomes the single source of truth, carrying per capability: `name`, `canDo`, `cannotDo`, `reach`, `scopes`. The picker copy, README table, `llms.txt` and tool-description trailers are generated from it, with a CI check that committed docs match. Three hand-maintained copies will disagree within a month, and the disagreement is invisible until someone is already confused.

Presets are a front door only, expanded to primitives before anything is stored. None pre-selected; no `full-access` preset; no Drive preset — the Drive choice is made explicitly from the two primitives.

- `read-only` → `[mail:read, drive:read, calendar:read]`
- `inbox-assistant` → `[mail:modify]`
- `scheduler` → `[calendar:read, calendar:write]` (both always — `calendar:write` alone cannot list calendars)

### B4. Friction on widening

Reauth already requires `confirm: true` to narrow. Add the mirror: widening into `drive:read` states that it grants read of every file in the Drive, including everything shared with the user, and requires `confirm: true`.

## Part C — documentation surface

Every user-facing surface still teaches the deleted vocabulary. Two audiences: the human choosing scopes at install, and the AI agent reading tool descriptions and `llms.txt` at runtime.

| Surface | Problem |
|---|---|
| `README.md` | "Scope Tiers" table; "Upgrade my account to `drive_full`"; claims re-adding is needed for compose |
| `site/index.html:198` | Feature card "Tiered Scopes — Start with read-only access. Upgrade to compose or full" — now false |
| `site/llms.txt:32` | "Tiered permission scopes (readonly, compose, full)" — the file agents read |
| `site/llms.txt` tool list | Omits `drive_get_comments` / `drive_get_comment_replies` |
| `docs/SPEC.md` | 2 stale references |
| `docs/demo-video-scripts.md` | 19 references |
| `docs/ARCHITECTURE.md:63` | Asserts the Drive lockout is correct — argues against fixing A1 |

**Release-history blocks stay untouched.** `site/index.html:357` ("feat Tiered permission scopes") describes what shipped in an earlier version and is accurate as history. Only present-tense claims about current behaviour change. A 0.5.0 entry is added alongside.

## Out of scope

- A ninth `mail:labels` capability. Deferred pending verification of `users.labels.create/patch/delete`.
- Requesting Google's broad `drive` scope.
- Incremental authorization (adding one scope without re-consenting to the rest).

## Verified 2026-08-12 (was "still unverified")

1. **`comments.list` returns 404, not 403, for a file outside the `drive.file` corpus. RESOLVED.**
   Probed with a real `drive:appfiles`-only token (`Personal`) against a Doc in another account's
   Drive that had never been shared with it:

   ```
   files.get      HTTP 404 — File not found: <id>
   comments.list  HTTP 404 — File not found: <id>
   files.list     HTTP 200 — 0 file(s) visible   (silently empty)
   ```

   So `DRIVE_FILE_NOT_VISIBLE` fires as designed for the motivating client-shared-Doc case. The
   taxonomy still handles 403 as well; that branch is now belt-and-braces rather than a hedge
   against not knowing, and can stay.

   The third line is the coverage annotation's justification, observed live: a search of a Drive
   provably containing four matching fixtures returned **HTTP 200 with zero results** — no error, no
   signal, indistinguishable from "no such file". That is the silent wrong answer the annotation
   exists to prevent, and it confirms annotating only empty responses would have been the wrong
   design.

## Still unverified

1. `users.drafts.get`, `users.settings.getVacation`, `users.settings.filters.list` — if any accepts `gmail.readonly`, those gates are over-demanding in the same family as A1/A3.
3. `users.labels.create/patch/delete` — determines whether `mail:modify` still needs `gmail.labels`, and whether `mail:labels` is worth adding.
4. Whether MCP clients surface a top-level `warning` key equivalently, and which truncate large results.
