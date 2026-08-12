# Design: End-to-end test harness for the MCP

**Status:** Approved design, not yet implemented
**Date:** 2026-08-10
**Area:** Testing / tooling

## Problem

The unit suite (397 tests) mocks `googleapis` entirely. It cannot catch:

- A tool that fails to register, or registers with a broken input schema
- A tool description that misleads the caller
- Scope-gating that rejects (or wrongly admits) a real account
- Anything about real Google API responses — the shape we *assume* vs. what Drive/Gmail/Calendar actually return
- Binary handling against real payloads

Two recent bugs make the gap concrete. Google Drawing downloads were silently corrupted for the entire life of Drive support, because a Drawing's default export is `image/png` and the export path decoded it as UTF-8. And `supportsAllDrives` was specified for `comments.list` in a requirement doc despite not existing on that resource. Neither was reachable from a mocked test.

## Goal

A repeatable harness that exercises every MCP tool against real Google accounts, with real assertions, a bounded blast radius, and a clear pass/fail signal.

Non-goal: replacing unit tests. This layer exists for what mocks structurally cannot reach.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Test surface | Hybrid — scripted depth + MCP smoke | Scripted layer is deterministic, re-runnable and needs no restart; a thin MCP layer covers registration/schemas/gates that scripts skip entirely |
| Blast radius | Sandboxed, with opt-in `--destructive` tier | Keeps full coverage including the confirm-gate, without leaving out-of-office on or files shared externally |
| Skill shape | One phase-aware command + state file | The restart destroys the session, so continuity must live on disk regardless |
| Fixtures | Seeded via the Drive API directly | The MCP cannot create native Docs or write comments today (both now backlog items) |

## Architecture

```
scripts/e2e/
  run.ts             CLI + orchestration, exit code
  seed-fixtures.ts   one-off, idempotent fixture builder
  sandbox.ts         per-run setup / teardown / reap
  preflight.ts       scope matrix check
  report.ts          result collection, JSON + console table
  cases/
    account.ts  gmail.ts  drive.ts  calendar.ts

.claude/skills/e2e/SKILL.md   phase detection, MCP smoke layer, reporting

.e2e/                          gitignored
  state.json                   phase continuity
  reports/<runId>.json
e2e.config.json                gitignored — fixture IDs, account aliases
```

The scripted layer imports from `src/` exactly as the existing `scripts/test-*.ts` do, using the real `AccountStore` and the tokens in `~/.config/mcp-google/tokens`.

## Flow

The scripted layer needs no live server, so it runs *before* the build/restart. Most of the signal arrives first, and a failure there means the restart is never needed.

```
/e2e  (phase 1)
  preflight        scopes per account vs. required matrix
  pnpm build       first — tsc failures must surface before anything runs
  Layer 1          scripted sweep, real APIs, real asserts
  record           {version, commit} -> .e2e/state.json
  stop             "restart the session, then run /e2e again"
        |
        v   session dies
/e2e  (phase 2)
  version gate     google_version vs. recorded -> mismatch = STOP
  registration     tools/list contains every expected tool
  spot calls       ~6 tools: zod schema, coerceArgs, scope gate, confirm gate
  report           merged with the phase-1 results
```

A version mismatch is a hard stop, not a warning. It means a stale npx-cached install answered — the exact failure CLAUDE.md documents.

## Sandbox

One `runId` per run; everything created is tagged with it.

- **Drive** — `__mcp-e2e__/<runId>/` per account, removed in teardown.
- **Calendar** — the MCP has no `create_calendar` tool and `calendar.events` cannot create calendars, so the sandbox is the **primary** calendar: events prefixed `[MCP-E2E]`, placed in a far-future window, with **zero attendees** (attendees send real invites). Removed in teardown.
- **Gmail** — label `__mcp-e2e__`, subject prefix `[MCP-E2E <runId>]`, sends **self to self only**; the received copy is located and trashed.

Teardown runs in a `finally`. A separate `--reap` mode sweeps orphans from earlier failed runs by name/prefix. Cleanup must not depend on the happy path, because partial failures are expected.

## Fixtures

Persistent, seeded once, never torn down — distinct from the ephemeral sandbox so that a stray teardown bug cannot destroy them.

```
My Drive/
  __MCP-E2E-FIXTURES — DO NOT DELETE__/
    e2e-fixture-contract   Doc, dummy SOW text + seeded comments
    e2e-fixture-sheet      Sheet, exercises the default .csv export
    e2e-fixture-drawing    Drawing, exercises the default .png export (the binary path)
```

The folder name is deliberately shouty so it reads as off-limits when browsing Drive.

`seed-fixtures.ts` calls `drive.files.create` and `drive.comments.create` directly via `googleapis`, because the MCP cannot do either today (see the two new backlog entries in `docs/TASKS.md`). Test scaffolding calling the API directly is acceptable; it is not product surface. It is idempotent — it locates the folder by name and repairs rather than duplicating — and writes the resulting IDs to `e2e.config.json`.

Scope: `Procedure` holds `drive.file`, and the fixtures are app-created, so `drive.file` covers both creating and commenting on them.

### Spike outcomes — RESOLVED 2026-08-12 against a real account

Both were resolved by running the seeder against `Procedure`. Both went the good way, so neither
fallback is needed.

1. **Anchored comments — RESOLVED: they work.** An API-created comment carrying an `anchor` and
   `quotedFileContent` does come back with `quotedFileContent.value` intact. Confirmed by reading it
   back after creation rather than trusting the create call, and re-confirmed on a later run via
   `hasAnchoredComment`. The harness can therefore assert on `quotedText` — the field the whole
   Drive-comments feature exists to surface. The manual fallback (a human adding one comment by
   hand) is not required, though the seeder still detects one if it is ever added.

2. **Blank Drawing creation — RESOLVED: it works.** `files.create` with
   `application/vnd.google-apps.drawing` and no media produces a usable Drawing. The binary
   `image/png` default-export path therefore has a real fixture. That path silently corrupted every
   Drawing download for the entire life of Drive support in this project, and no mocked test could
   have caught it.

Fixture IDs live in the gitignored `e2e.config.json`; the folder is
`__MCP-E2E-FIXTURES — DO NOT DELETE__` in `Procedure`'s My Drive. Re-running the seeder reuses all
four fixtures with identical IDs — verified empirically, twice.

### What the fixtures do not prove

A fixture Doc we create is app-created, so it is reachable under `drive.file`. It therefore does **not** reproduce the condition that motivated the comments feature: a Doc shared with the user by a third party, which `drive.file` cannot reach.

Reproducing that properly needs `Personal` to create and share a commented Doc with `Procedure`. Deferred for now; until then the scope caveat is covered only by the negative test below.

## Accounts and scope preflight

Two accounts under test:

| Alias | Email | Drive tier | Role |
|---|---|---|---|
| `Procedure` | braj.b@… | `drive.readonly` + `drive.file` | primary — full coverage |
| `Personal` | bahetibraj@… | `drive.file` only | secondary + **negative fixture** |

`Personal` lacking `drive.readonly` is useful, not a problem: the suite asserts that `drive_get_comments` against `Personal` fails with a clear scope error rather than returning an empty list. That is the caveat documented in the comments requirement doc, verified against a real account.

Preflight compares stored scopes against a required matrix using the project's own `hasSufficientScope`. Insufficient scope marks affected groups **SKIPPED, never FAILED** — "could not test" and "is broken" must not look alike in the report.

OAuth needs a browser, so it is never triggered silently. When preflight finds a gap, phase 2 can drive re-auth interactively: `google_reauth_account`, hand the URL to the user, poll `google_check_pending_auth`.

## Coverage tiers

- **Default** (~55 tools) — all reads; create/update/delete confined to the sandbox; `gmail_send_draft` to self; confirm-gated tools asserted twice, once *without* `confirm: true` to prove the gate refuses, once with.
- **`--destructive`** (off by default) — `gmail_set_vacation` (reverted immediately), `gmail_create_filter` / `delete_filter`, `drive_share_file` to an external address.
- **Never** — `google_remove_account`.

## Reporting

Each case yields `{id, tool, account, status: pass|fail|skip, durationMs, detail}`. Console summary table plus `.e2e/reports/<runId>.json`. Non-zero exit on any failure. Skips are listed separately from failures, with the reason.

## Prerequisite cleanup

The phase-2 version gate is meaningless while two servers can answer. Before implementation:

- `.mcp.json` has a stale `proGoogleMCP` pointing at `/home/baheti/...`, a Linux path that does not exist on this machine — remove it.
- `~/.claude.json` has another `proGoogleMCP` pointing at the same local `dist/cli.js` as `localProGoogleMCP` — settle on one canonical local server name.

## Implementation sequencing

Larger than one sitting, so it lands in three stages, each independently useful:

1. **Fixtures + preflight** — `seed-fixtures.ts`, `preflight.ts`, `e2e.config.json`. Resolves both spikes early, since everything downstream depends on what the fixtures can actually express.
2. **Scripted layer** — `sandbox.ts`, `cases/*`, `report.ts`, `run.ts`. Delivers the bulk of the value on its own; usable via `npx tsx` with no skill at all.
3. **Skill + MCP smoke layer** — `.claude/skills/e2e/SKILL.md`, phase/state handling, version gate, registration and spot-call checks.

Stage 2 is worth having even if stage 3 is never built.

## Out of scope

- CI integration. The harness needs real credentials and an interactive browser for OAuth; it cannot run headless.
- Mocks of any kind. This layer exists precisely to catch what the mocked suite cannot.
- Performance or load testing.
