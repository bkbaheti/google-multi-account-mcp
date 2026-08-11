# Capability Scope Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scope-tier model with eight per-service capabilities, so an operation gate names the permission it needs instead of resolving a tier through a lookup table that could lie.

**Architecture:** A new `src/auth/capabilities.ts` owns the vocabulary, the scope mapping, the two true implications, and derivation from granted scopes. `SCOPE_TIERS`, `SCOPE_IMPLIES`, `OPERATION_SCOPE_REQUIREMENTS`, `getScopeTier` and `hasSufficientScope` are deleted. All 57 gates migrate from a tier string to a capability string. The account store and OAuth flow take capability lists; reauth refuses to narrow without confirmation.

**Tech Stack:** TypeScript (ES2022/NodeNext, strict), vitest, zod, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-11-capability-scope-model-design.md`

## Global Constraints

- Capabilities are the exact strings `mail:read`, `mail:compose`, `mail:modify`, `mail:settings`, `drive:read`, `drive:appfiles`, `calendar:read`, `calendar:write`. No others exist.
- Only two implications are real: `mail:modify ⇒ mail:read`, `calendar:write ⇒ calendar:read`. Never add a drive implication — `drive:read` and `drive:appfiles` are independent. This is the bug the whole change exists to fix.
- `userinfo.email` (`https://www.googleapis.com/auth/userinfo.email`) is always requested and is never a capability.
- Capabilities are **derived** from an account's stored scopes on every read. Never persist a capability list; `Account.scopes` stays the only stored form, so no config migration is needed.
- Strict TypeScript: `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Never assign `undefined` to an optional property.
- Every task ends green on `pnpm test`, `pnpm typecheck` and `pnpm biome check` for the files it touched.
- Never `git add -f`. Never amend, reset or rebase a commit you did not create in your own task. `.mcp.json`, `.e2e/` and `e2e.config.json` are gitignored and must never be committed.
- Do not touch `scripts/e2e/` or `tests/unit/e2e-*.test.ts`. That work is paused and handled separately.

## Scope-to-capability reference

Used by several tasks; the single source of truth is Task 1's `CAPABILITY_SCOPES`.

| Capability | Google scope(s) |
|---|---|
| `mail:read` | `https://www.googleapis.com/auth/gmail.readonly` |
| `mail:compose` | `https://www.googleapis.com/auth/gmail.compose` |
| `mail:modify` | `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.labels` |
| `mail:settings` | `https://www.googleapis.com/auth/gmail.settings.basic` |
| `drive:read` | `https://www.googleapis.com/auth/drive.readonly` |
| `drive:appfiles` | `https://www.googleapis.com/auth/drive.file` |
| `calendar:read` | `https://www.googleapis.com/auth/calendar.readonly` |
| `calendar:write` | `https://www.googleapis.com/auth/calendar.events` |

---

### Task 1: Capability vocabulary, scope mapping and derivation

**Files:**
- Create: `src/auth/capabilities.ts`
- Test: `tests/unit/capabilities.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Capability` — union of the eight literal strings
  - `CAPABILITIES: readonly Capability[]`
  - `CAPABILITY_SCOPES: Record<Capability, readonly string[]>`
  - `USERINFO_EMAIL_SCOPE: string`
  - `isCapability(value: string): value is Capability`
  - `scopesFor(capabilities: Capability[]): string[]` — deduped, always includes `USERINFO_EMAIL_SCOPE`
  - `capabilitiesOf(scopes: string[]): Capability[]` — derived, implications applied
  - `hasCapability(scopes: string[], capability: Capability): boolean`
  - `missingCapabilities(scopes: string[], required: Capability[]): Capability[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/capabilities.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  type Capability,
  capabilitiesOf,
  hasCapability,
  isCapability,
  missingCapabilities,
  scopesFor,
} from '../../src/auth/capabilities.js';

const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const GMAIL_LABELS = 'https://www.googleapis.com/auth/gmail.labels';
const GMAIL_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const CAL_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
const CAL_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const EMAIL = 'https://www.googleapis.com/auth/userinfo.email';

describe('capability vocabulary', () => {
  it('has exactly the eight documented capabilities', () => {
    expect([...CAPABILITIES].sort()).toEqual([
      'calendar:read',
      'calendar:write',
      'drive:appfiles',
      'drive:read',
      'mail:compose',
      'mail:modify',
      'mail:read',
      'mail:settings',
    ]);
  });

  it('recognises valid capability strings and rejects invented ones', () => {
    expect(isCapability('drive:appfiles')).toBe(true);
    expect(isCapability('drive_full')).toBe(false);
    expect(isCapability('drive:write')).toBe(false);
  });
});

describe('scopesFor', () => {
  it('always includes userinfo.email', () => {
    expect(scopesFor(['mail:read'])).toContain(EMAIL);
  });

  it('expands mail:modify to both modify and labels', () => {
    const scopes = scopesFor(['mail:modify']);
    expect(scopes).toContain(GMAIL_MODIFY);
    expect(scopes).toContain(GMAIL_LABELS);
  });

  it('deduplicates when capabilities overlap', () => {
    const scopes = scopesFor(['mail:read', 'mail:modify']);
    expect(scopes.filter((s) => s === EMAIL)).toHaveLength(1);
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it('returns only userinfo.email for an empty capability list', () => {
    expect(scopesFor([])).toEqual([EMAIL]);
  });
});

describe('capabilitiesOf', () => {
  it('derives mail:read from gmail.readonly', () => {
    expect(capabilitiesOf([GMAIL_READONLY])).toEqual(['mail:read']);
  });

  it('treats mail:modify as implying mail:read', () => {
    const caps = capabilitiesOf([GMAIL_MODIFY, GMAIL_LABELS]);
    expect(caps).toContain('mail:modify');
    expect(caps).toContain('mail:read');
  });

  it('treats calendar:write as implying calendar:read', () => {
    const caps = capabilitiesOf([CAL_EVENTS]);
    expect(caps).toContain('calendar:write');
    expect(caps).toContain('calendar:read');
  });

  // The bug this whole change exists to fix.
  it('does NOT derive drive:read from drive.file', () => {
    expect(capabilitiesOf([DRIVE_FILE])).toEqual(['drive:appfiles']);
  });

  it('does NOT derive drive:appfiles from drive.readonly', () => {
    expect(capabilitiesOf([DRIVE_READONLY])).toEqual(['drive:read']);
  });

  it('derives both drive capabilities when both scopes are granted', () => {
    const caps = capabilitiesOf([DRIVE_READONLY, DRIVE_FILE]);
    expect(caps).toContain('drive:read');
    expect(caps).toContain('drive:appfiles');
  });

  it('does not derive mail:read from gmail.compose alone', () => {
    expect(capabilitiesOf([GMAIL_COMPOSE])).toEqual(['mail:compose']);
  });

  it('ignores userinfo.email and unknown scopes', () => {
    expect(capabilitiesOf([EMAIL, 'https://example.com/nonsense'])).toEqual([]);
  });

  it('derives every capability for a fully authorized account', () => {
    const caps = capabilitiesOf([
      GMAIL_MODIFY, GMAIL_LABELS, GMAIL_COMPOSE,
      'https://www.googleapis.com/auth/gmail.settings.basic',
      DRIVE_READONLY, DRIVE_FILE, CAL_READONLY, CAL_EVENTS, EMAIL,
    ]);
    expect([...caps].sort()).toEqual([...CAPABILITIES].sort());
  });
});

describe('hasCapability and missingCapabilities', () => {
  it('reports a granted capability as present', () => {
    expect(hasCapability([DRIVE_READONLY], 'drive:read')).toBe(true);
  });

  it('reports drive:read as absent for a drive.file-only account', () => {
    expect(hasCapability([DRIVE_FILE, EMAIL], 'drive:read')).toBe(false);
  });

  it('honours implication when checking', () => {
    expect(hasCapability([GMAIL_MODIFY, GMAIL_LABELS], 'mail:read')).toBe(true);
  });

  it('lists only the capabilities actually missing', () => {
    const missing = missingCapabilities([DRIVE_FILE], [
      'drive:appfiles',
      'drive:read',
      'mail:read',
    ] as Capability[]);
    expect([...missing].sort()).toEqual(['drive:read', 'mail:read']);
  });

  it('returns an empty list when everything is granted', () => {
    expect(missingCapabilities([DRIVE_FILE], ['drive:appfiles'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/capabilities.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/capabilities.js`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/capabilities.ts`:

```typescript
/**
 * Per-service capabilities, replacing the old scope-tier model.
 *
 * A capability names one permission on one service. Operation gates ask for a
 * capability directly, so there is no tier-to-scope lookup that can be wrong —
 * the previous model claimed drive.file implied drive.readonly, which is false
 * and silently defeated the gate on reading Drive comments.
 */

export const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export const CAPABILITIES = [
  'mail:read',
  'mail:compose',
  'mail:modify',
  'mail:settings',
  'drive:read',
  'drive:appfiles',
  'calendar:read',
  'calendar:write',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_SCOPES: Record<Capability, readonly string[]> = {
  'mail:read': ['https://www.googleapis.com/auth/gmail.readonly'],
  'mail:compose': ['https://www.googleapis.com/auth/gmail.compose'],
  'mail:modify': [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
  ],
  'mail:settings': ['https://www.googleapis.com/auth/gmail.settings.basic'],
  'drive:read': ['https://www.googleapis.com/auth/drive.readonly'],
  'drive:appfiles': ['https://www.googleapis.com/auth/drive.file'],
  'calendar:read': ['https://www.googleapis.com/auth/calendar.readonly'],
  'calendar:write': ['https://www.googleapis.com/auth/calendar.events'],
};

/**
 * The only two implications that are actually true of Google's scopes:
 * gmail.modify includes gmail.readonly, and calendar.events includes
 * calendar.readonly.
 *
 * There is deliberately NO drive entry. drive.file grants per-file access to
 * app-created files; drive.readonly grants read access to everything. Neither
 * contains the other, and asserting otherwise is the bug this model replaces.
 */
const CAPABILITY_IMPLIES: Partial<Record<Capability, readonly Capability[]>> = {
  'mail:modify': ['mail:read'],
  'calendar:write': ['calendar:read'],
};

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Google scopes to request for a set of capabilities. Always includes userinfo.email. */
export function scopesFor(capabilities: Capability[]): string[] {
  const scopes = new Set<string>([USERINFO_EMAIL_SCOPE]);

  for (const capability of capabilities) {
    for (const scope of CAPABILITY_SCOPES[capability]) {
      scopes.add(scope);
    }
  }

  return Array.from(scopes);
}

/** Derive the capabilities an account holds from the scopes Google granted it. */
export function capabilitiesOf(scopes: string[]): Capability[] {
  const granted = new Set(scopes);
  const held = new Set<Capability>();

  for (const capability of CAPABILITIES) {
    const required = CAPABILITY_SCOPES[capability];
    if (required.every((scope) => granted.has(scope))) {
      held.add(capability);
    }
  }

  for (const capability of [...held]) {
    for (const implied of CAPABILITY_IMPLIES[capability] ?? []) {
      held.add(implied);
    }
  }

  return CAPABILITIES.filter((capability) => held.has(capability));
}

export function hasCapability(scopes: string[], capability: Capability): boolean {
  return capabilitiesOf(scopes).includes(capability);
}

export function missingCapabilities(scopes: string[], required: Capability[]): Capability[] {
  const held = new Set(capabilitiesOf(scopes));
  return required.filter((capability) => !held.has(capability));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/capabilities.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm biome check src/auth/capabilities.ts tests/unit/capabilities.test.ts
git add src/auth/capabilities.ts tests/unit/capabilities.test.ts
git commit -m "feat(auth): add per-service capability model"
```

Note `pnpm test` will still pass here — nothing consumes the new module yet.

---

### Task 2: Capability gate and error message

**Files:**
- Modify: `src/errors/index.ts`
- Test: `tests/unit/capability-gate.test.ts`

**Interfaces:**
- Consumes: `Capability`, `capabilitiesOf`, `missingCapabilities` from Task 1.
- Produces: `insufficientCapability(accountRef: string, missing: Capability[], currentScopes: string[]): McpError` — the error a failed gate returns.

The message must name the missing capability AND give a remedy that does not narrow the account: the account's current capabilities plus the missing ones.

- [ ] **Step 1: Read the existing error module**

Read `src/errors/index.ts` and find the existing scope error (it currently talks about tiers). Match its construction style, error code and `toResponse()` shape exactly — this task adds a sibling, it does not invent a new error shape.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/capability-gate.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { insufficientCapability } from '../../src/errors/index.js';

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const GMAIL_LABELS = 'https://www.googleapis.com/auth/gmail.labels';

describe('insufficientCapability', () => {
  it('names the account and the missing capability', () => {
    const message = insufficientCapability('Personal', ['drive:read'], [DRIVE_FILE]).message;

    expect(message).toContain('Personal');
    expect(message).toContain('drive:read');
  });

  it('suggests a remedy that keeps every capability the account already has', () => {
    const message = insufficientCapability(
      'Personal',
      ['drive:read'],
      [DRIVE_FILE, GMAIL_MODIFY, GMAIL_LABELS],
    ).message;

    expect(message).toContain('google_reauth_account');
    expect(message).toContain('drive:appfiles');
    expect(message).toContain('mail:modify');
    expect(message).toContain('drive:read');
  });

  it('lists every missing capability when more than one is absent', () => {
    const message = insufficientCapability('Personal', ['drive:read', 'mail:settings'], [
      DRIVE_FILE,
    ]).message;

    expect(message).toContain('drive:read');
    expect(message).toContain('mail:settings');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-gate.test.ts`
Expected: FAIL — `insufficientCapability` is not exported.

- [ ] **Step 4: Implement**

Add to `src/errors/index.ts`, following the existing error helpers' style:

```typescript
import { type Capability, capabilitiesOf } from '../auth/capabilities.js';

/**
 * A gate refused because the account lacks a capability. The suggested remedy is
 * the account's current capabilities plus the missing ones, so following it never
 * narrows the account — reauth replaces the scope set rather than adding to it.
 */
export function insufficientCapability(
  accountRef: string,
  missing: Capability[],
  currentScopes: string[],
): McpError {
  const suggested = Array.from(new Set([...capabilitiesOf(currentScopes), ...missing]));

  return new McpError(
    'INSUFFICIENT_CAPABILITY',
    `Account "${accountRef}" is missing capability ${missing.join(', ')}. ` +
      `Re-authorize with: google_reauth_account accountId="${accountRef}" ` +
      `capabilities=${JSON.stringify(suggested)}`,
  );
}
```

Adjust the constructor call to match the real `McpError` signature in that file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-gate.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm biome check src/errors/index.ts tests/unit/capability-gate.test.ts
git add src/errors/index.ts tests/unit/capability-gate.test.ts
git commit -m "feat(errors): add capability gate error with non-narrowing remedy"
```

---

### Task 3: Migrate the gate helper and Gmail tools

**Files:**
- Modify: `src/server/index.ts` (the `validateAccountScope` helper and its one call site)
- Modify: `src/server/gmail-tools.ts` (29 gate call sites)
- Test: `tests/unit/scope-validation.test.ts`

**Interfaces:**
- Consumes: `Capability`, `hasCapability`, `missingCapabilities` (Task 1); `insufficientCapability` (Task 2).
- Produces: `requireCapability(accountRef: string, capability: Capability)` — same return shape as today's `validateAccountScope`, i.e. `{ error }` on failure or `{ account }` on success, so tool bodies keep their `if ('error' in validation) return validation.error;` line unchanged.

- [ ] **Step 1: Rename the helper, keeping its return shape**

In `src/server/index.ts`, replace `validateAccountScope(accountId, requiredTier)` with `requireCapability(accountId, capability)`. Look up the account exactly as the old helper did; on missing capability return `{ error: errorResponse(insufficientCapability(accountRef, [capability], account.scopes).toResponse()) }`. Keep the account-not-found path byte-identical to today's.

Update the signature threaded into `registerGmailTools`, `registerDriveTools` and `registerCalendarTools` — all three take this helper as a parameter.

- [ ] **Step 2: Migrate the Gmail gates**

In `src/server/gmail-tools.ts`, replace every `validateAccountScope(args.accountId, '<tier>')` with `requireCapability(args.accountId, '<capability>')` using this mapping:

| Old tier | New capability |
|---|---|
| `mail_readonly` | `mail:read` |
| `mail_compose` | `mail:compose` |
| `mail_full` | `mail:modify` |
| `mail_settings` | `mail:settings` |

Change only the call and its argument. Do not restructure tool bodies, rename variables, or alter any tool description in this step.

- [ ] **Step 3: Update the scope test suite**

`tests/unit/scope-validation.test.ts` tests `getScopeTier`, `hasSufficientScope`, `SCOPE_TIERS` and `OPERATION_SCOPE_REQUIREMENTS`, all of which are being deleted. Delete the describe blocks covering those four, keeping any test that covers behaviour still present after this change. Task 1's `tests/unit/capabilities.test.ts` already covers the replacement logic — do not duplicate it here.

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm typecheck`
Expected: green. Gmail tool behaviour is unchanged for accounts that hold the equivalent scopes; only the vocabulary moved.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts src/server/gmail-tools.ts tests/unit/scope-validation.test.ts
git commit -m "refactor(gmail): gate tools on capabilities instead of scope tiers"
```

---

### Task 4: Migrate Drive and Calendar tools

**Files:**
- Modify: `src/server/drive-tools.ts` (17 gate call sites)
- Modify: `src/server/calendar-tools.ts` (10 gate call sites)

**Interfaces:**
- Consumes: `requireCapability` from Task 3.
- Produces: nothing new.

**This is the task that fixes the original bug.** `drive_full` mapped to `drive.file`, which the old model wrongly treated as satisfying `drive_readonly`. Under capabilities the two are independent, so a `drive.file`-only account is now correctly refused by every `drive:read` gate.

- [ ] **Step 1: Migrate the Drive gates**

In `src/server/drive-tools.ts`, apply this mapping to every `validateAccountScope` call:

| Old tier | New capability |
|---|---|
| `drive_readonly` | `drive:read` |
| `drive_full` | `drive:appfiles` |

The nine read tools (`drive_list_shared_drives`, `drive_search_files`, `drive_list_files`, `drive_get_file`, `drive_get_file_content`, `drive_get_full_file_content`, `drive_get_comments`, `drive_get_comment_replies`, `drive_download_file`) take `drive:read`. The eight write tools (`drive_upload_file`, `drive_create_folder`, `drive_move_file`, `drive_copy_file`, `drive_rename_file`, `drive_trash_file`, `drive_share_file`, `drive_update_permissions`) take `drive:appfiles`.

- [ ] **Step 2: Migrate the Calendar gates**

In `src/server/calendar-tools.ts`:

| Old tier | New capability |
|---|---|
| `calendar_readonly` | `calendar:read` |
| `calendar_full` | `calendar:write` |

- [ ] **Step 3: Update the two comment tool descriptions**

`drive_get_comments` and `drive_get_comment_replies` currently say "Requires the drive_readonly scope tier: an account authorized only at drive_full (drive.file) cannot read comments...". Rewrite in capability vocabulary: they require `drive:read`, and an account holding only `drive:appfiles` cannot read comments on documents it did not create. Keep the guidance to re-authorize with `google_reauth_account`.

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm typecheck && pnpm biome check src/server`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/server/drive-tools.ts src/server/calendar-tools.ts
git commit -m "refactor(drive,calendar): gate tools on capabilities, fixing the drive.file gate"
```

---

### Task 5: Account store and OAuth take capabilities

**Files:**
- Modify: `src/auth/account-store.ts`
- Test: `tests/unit/account-capabilities.test.ts`

**Interfaces:**
- Consumes: `Capability`, `scopesFor`, `capabilitiesOf`, `missingCapabilities` (Task 1).
- Produces:
  - account-creation and reauth methods taking `capabilities: Capability[]` where they took `scopeTierOrTiers`
  - `capabilitiesRemovedBy(currentScopes: string[], requested: Capability[]): Capability[]` — what a reauth would drop

`src/auth/account-store.ts` currently resolves tiers in three places (`mergeScopeTiers(...)` / `[...SCOPE_TIERS[...]]`). Each becomes `scopesFor(capabilities)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/account-capabilities.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { capabilitiesRemovedBy } from '../../src/auth/account-store.js';

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const GMAIL_LABELS = 'https://www.googleapis.com/auth/gmail.labels';
const CAL_EVENTS = 'https://www.googleapis.com/auth/calendar.events';

describe('capabilitiesRemovedBy', () => {
  it('reports nothing removed when the request is a superset', () => {
    const removed = capabilitiesRemovedBy(
      [DRIVE_FILE],
      ['drive:appfiles', 'drive:read'],
    );

    expect(removed).toEqual([]);
  });

  it('lists capabilities a narrowing reauth would destroy', () => {
    const removed = capabilitiesRemovedBy(
      [DRIVE_FILE, GMAIL_MODIFY, GMAIL_LABELS, CAL_EVENTS],
      ['drive:read'],
    );

    expect(removed).toContain('drive:appfiles');
    expect(removed).toContain('mail:modify');
    expect(removed).toContain('mail:read');
    expect(removed).toContain('calendar:write');
  });

  it('accounts for implication — requesting calendar:write keeps calendar:read', () => {
    const removed = capabilitiesRemovedBy([CAL_EVENTS], ['calendar:write']);

    expect(removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/account-capabilities.test.ts`
Expected: FAIL — `capabilitiesRemovedBy` is not exported.

- [ ] **Step 3: Implement**

Add to `src/auth/account-store.ts`:

```typescript
/**
 * Capabilities an account holds today that the requested set would not grant.
 * Reauth replaces the scope set wholesale, so this is what a narrowing reauth
 * would silently destroy.
 */
export function capabilitiesRemovedBy(
  currentScopes: string[],
  requested: Capability[],
): Capability[] {
  const wouldHold = new Set(capabilitiesOf(scopesFor(requested)));
  return capabilitiesOf(currentScopes).filter((capability) => !wouldHold.has(capability));
}
```

Then replace the three tier-resolution sites with `scopesFor(capabilities)` and change the corresponding parameter types from the tier union to `Capability[]`. Delete the `mergeScopeTiers` / `SCOPE_TIERS` imports once unused.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run tests/unit/account-capabilities.test.ts && pnpm typecheck`
Expected: the new file passes. `pnpm test` and the full typecheck may still fail here because `src/server/index.ts` has not been updated to pass capabilities — that is Task 6. Note it in your report rather than fixing it here.

- [ ] **Step 5: Commit**

```bash
git add src/auth/account-store.ts tests/unit/account-capabilities.test.ts
git commit -m "feat(auth): account store takes capabilities, detects narrowing reauth"
```

---

### Task 6: Tool surface — capabilities in, per-service view out

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/types/index.ts`
- Test: `tests/unit/scope-validation.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 2 and 5.
- Produces: `google_add_account` and `google_reauth_account` taking `capabilities: string[]`; `google_list_accounts` reporting a per-service capability view.

- [ ] **Step 1: Replace the tool inputs**

In `src/server/index.ts`, remove the `scopeTier` and `scopeTiers` zod fields from `google_add_account` and `google_reauth_account`. Add:

```typescript
capabilities: z
  .array(z.string())
  .describe(
    'Capabilities to authorize, as service:level strings. Valid values: mail:read, mail:compose, mail:modify, mail:settings, drive:read, drive:appfiles, calendar:read, calendar:write. Note drive:read (read all files) and drive:appfiles (per-file access to files this app created) are independent — grant both for full Drive access.',
  ),
```

Validate each entry with `isCapability`; on an unknown string return a validation error naming the offending value and listing the eight valid ones.

- [ ] **Step 2: Add the narrowing confirm gate to reauth**

In the `google_reauth_account` handler, before starting the OAuth flow, call `capabilitiesRemovedBy(account.scopes, requested)`. If it returns anything and `confirm !== true`, return a confirmation-required error naming every capability that would be lost. Add a `confirm: z.boolean().optional()` field, matching how `drive_share_file` does it.

- [ ] **Step 3: Replace the account tier view**

`src/server/index.ts` calls `getScopeTier(account.scopes)` in two places (the reauth flow and the `google_list_accounts` output). Replace the output field with a per-service view built from `capabilitiesOf`:

```typescript
function capabilityView(scopes: string[]): Record<string, string[]> {
  const view: Record<string, string[]> = {};

  for (const capability of capabilitiesOf(scopes)) {
    const [service, level] = capability.split(':') as [string, string];
    (view[service] ??= []).push(level);
  }

  return view;
}
```

- [ ] **Step 4: Delete the tier model**

From `src/types/index.ts` remove `SCOPE_TIERS`, `ScopeTier`, `mergeScopeTiers`, `getScopeTier`, `hasSufficientScope`, `SCOPE_IMPLIES` and `OPERATION_SCOPE_REQUIREMENTS`. Update `src/index.ts` exports accordingly. If anything outside `scripts/e2e/` still imports them, migrate it; `scripts/e2e/` is out of scope and handled separately.

- [ ] **Step 5: Finish updating the scope test suite**

Remove any remaining tests in `tests/unit/scope-validation.test.ts` that reference the deleted symbols. If the file ends up empty, delete it — `tests/unit/capabilities.test.ts` is its replacement.

- [ ] **Step 6: Verify**

Run: `pnpm test && pnpm typecheck && pnpm biome check src`
Expected: all green. This is the first point since Task 5 where the whole tree compiles.

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts src/types/index.ts src/index.ts tests/unit/scope-validation.test.ts
git commit -m "feat!: replace scope tiers with capabilities across the tool surface"
```

---

### Task 7: Version, changelog and documentation

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md` (create if absent)
- Modify: `CLAUDE.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Bump the version**

Set `"version": "0.5.0"` in `package.json`. Do not run `pnpm build` — release builds are CI's job, and building before a version bump is the documented cause of stale `google_version` output.

- [ ] **Step 2: Write the changelog entry**

Add a `## 0.5.0` section marked **BREAKING**, explaining that scope tiers are replaced by capabilities, and carrying this table verbatim:

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

State the reason plainly: the old model asserted that `drive.file` implied `drive.readonly`, which is false, and that defeated the scope gate protecting Drive comment reads. Note that existing accounts need no config migration because capabilities are derived from stored scopes, but an account holding only `drive.file` must be re-authorized to regain Drive read tools.

- [ ] **Step 3: Update CLAUDE.md**

Replace the "Tiered scopes with explicit upgrade (mail_readonly, mail_compose, ...)" line under Non-Negotiable Constraints with the capability vocabulary, and note the two real implications plus the deliberate absence of a drive implication.

- [ ] **Step 4: Update ARCHITECTURE.md**

Add a decision entry recording the move from tiers to capabilities, the false-implication bug that caused it, and the choice to derive capabilities rather than store them.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck
git add package.json CHANGELOG.md CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs!: document the capability model and bump to 0.5.0"
```

---

## Done When

- No file outside `scripts/e2e/` references `ScopeTier`, `SCOPE_TIERS`, `getScopeTier`, `hasSufficientScope`, `SCOPE_IMPLIES` or `OPERATION_SCOPE_REQUIREMENTS`.
- `capabilitiesOf(['https://www.googleapis.com/auth/drive.file'])` returns exactly `['drive:appfiles']`.
- `pnpm test`, `pnpm typecheck` and `pnpm biome check src` are green.
- `package.json` reads 0.5.0 and the changelog carries the migration table.

The E2E harness plan resumes afterwards, with Task 3's preflight rewritten against capabilities.
