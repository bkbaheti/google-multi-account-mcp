# Capability Correctness & Permission UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop the capability gates refusing calls Google authorizes, make a partial-access account's results honestly self-describing, and bring every user-facing surface — including the hosted site — in line with the shipped model.

**Architecture:** Gates become `{ accept, remedy, escalation? }` records mirroring each Google method's authorized-scope list. A single capability metadata table in `src/auth/capabilities.ts` becomes the source of truth that generates picker copy, README and `llms.txt`. Drive responses on partial-access accounts carry a `coverage` block; permission errors carry machine-readable recovery hints.

**Tech Stack:** TypeScript (ES2022/NodeNext, strict), vitest, zod, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-11-capability-correctness-and-ux-design.md`

## Global Constraints

- **The verified scope matrix in the spec is the authority.** Never extend it by reasoning. If a task needs a scope fact not in it, stop and ask — that exact shortcut caused both the original bug and the over-correction being fixed here.
- Capabilities remain the eight existing strings. No renames.
- Only one implication is real, now two entries: `mail:modify → [mail:read, mail:compose]`. Never a drive or calendar implication.
- `drives.list` does **not** accept `drive.file` — `drive_list_shared_drives` stays `drive:read` only. It is the one Drive read tool that does not loosen.
- Capabilities stay **derived** from stored scopes. Never persist a capability list.
- Release-history blocks in `site/index.html`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` describe what shipped and stay untouched. Only present-tense claims change.
- Never `git add -f`. Never amend/reset/rebase a commit you did not create. Do not touch `scripts/e2e/`.
- Every task ends green on `pnpm test`, `pnpm typecheck`, and `pnpm biome check` for files it touched.

---

## Part A — correctness

### Task 1: [A1] Add the `mail:modify ⇒ mail:compose` implication

**Files:** Modify `src/auth/capabilities.ts`; Test `tests/unit/capabilities.test.ts`

**Justification (verified):** `users.drafts.create` accepts `gmail.modify`; `users.messages.send` accepts `gmail.modify`.

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/capabilities.test.ts`:

```typescript
it('derives mail:compose from gmail.modify', () => {
  const caps = capabilitiesOf([GMAIL_MODIFY, GMAIL_LABELS]);
  expect(caps).toContain('mail:compose');
});

it('still derives mail:read from gmail.modify', () => {
  expect(capabilitiesOf([GMAIL_MODIFY, GMAIL_LABELS])).toContain('mail:read');
});

it('does not derive mail:modify from gmail.compose', () => {
  expect(capabilitiesOf([GMAIL_COMPOSE])).toEqual(['mail:compose']);
});
```

- [ ] **Step 2: Run, confirm the first fails** — `pnpm vitest run tests/unit/capabilities.test.ts`

- [ ] **Step 3: Implement** — in `CAPABILITY_IMPLIES`, change the single entry to:

```typescript
  'mail:modify': ['mail:read', 'mail:compose'],
```

Update the block comment above it to cite both method pages (`users.drafts.create`, `users.messages.send`) as the evidence, and keep the warning against adding drive/calendar entries.

- [ ] **Step 4: Verify** — `pnpm test && pnpm typecheck`
- [ ] **Step 5: Commit** — `fix(auth): gmail.modify authorizes compose and send`

---

### Task 2: [A2] Gate records with a narrow remedy

**Files:** Modify `src/server/index.ts`, `src/errors/index.ts`; Test `tests/unit/capability-gate.test.ts`

**Produces:** `interface CapabilityGate { accept: Capability[]; remedy: Capability; escalation?: Capability }` and `requireCapability(accountRef, gate: Capability | CapabilityGate)`.

A bare `Capability` keeps working (accept `[c]`, remedy `c`). An array is no longer accepted — every any-of site becomes an explicit record, so the remedy is always deliberate.

**The defect:** today `requireCapability` passes the whole array as `missing`, so `insufficientCapability` suggests granting every alternative. A user wanting to read one meeting is told to grant `calendar.events` write.

- [ ] **Step 1: Write failing tests** in `tests/unit/capability-gate.test.ts`:

```typescript
it('suggests only the narrow remedy, not every alternative', () => {
  const gate = { accept: ['calendar:read', 'calendar:write'] as Capability[],
                 remedy: 'calendar:read' as Capability,
                 escalation: 'calendar:write' as Capability };
  const message = capabilityGateError('Personal', gate, [GMAIL_MODIFY, GMAIL_LABELS]).message;

  expect(message).toContain('calendar:read');
  expect(message).not.toMatch(/capabilities=\[[^\]]*calendar:write/);
});

it('mentions the escalation and the condition it applies under', () => {
  const gate = { accept: ['drive:read', 'drive:appfiles'] as Capability[],
                 remedy: 'drive:appfiles' as Capability,
                 escalation: 'drive:read' as Capability };
  const message = capabilityGateError('Personal', gate, []).message;

  expect(message).toContain('drive:appfiles');
  expect(message).toContain('drive:read');
  expect(message).toMatch(/did not create|not created by/i);
});

it('preserves capabilities the account already holds in the remedy', () => {
  const gate = { accept: ['drive:read'] as Capability[], remedy: 'drive:read' as Capability };
  const message = capabilityGateError('Personal', gate, [GMAIL_MODIFY, GMAIL_LABELS]).message;

  expect(message).toContain('mail:modify');
});
```

- [ ] **Step 2: Run, confirm failure**
- [ ] **Step 3: Implement** `capabilityGateError` in `src/errors/index.ts` alongside `insufficientCapability`, and rework `requireCapability` in `src/server/index.ts` to satisfy via `gate.accept.some(...)` and construct the error from `gate.remedy` / `gate.escalation`. The remedy line remains current-capabilities ∪ remedy, so following it never narrows.
- [ ] **Step 4: Verify + commit** — `feat(errors): suggest the narrowest sufficient capability`

---

### Task 3: [A3] Apply the corrected gates

**Files:** Modify `src/server/drive-tools.ts`, `src/server/gmail-tools.ts`; Test `tests/unit/gate-mapping.test.ts`

Apply per the spec's Part A1/A3 tables. Eight Drive read tools become records with `remedy: 'drive:appfiles'`, `escalation: 'drive:read'`. `drive_list_shared_drives` stays bare `'drive:read'` — `drives.list` rejects `drive.file`. `gmail_list_labels` becomes `{ accept: ['mail:read','mail:modify'], remedy: 'mail:read' }`.

- [ ] **Step 1: Close the fail-open hole first.** In `captureGates`, after invoking handlers, add:

```typescript
  const ungated = Object.keys(handlers).filter((name) => !(name in demanded));
  if (ungated.length > 0) {
    throw new Error(`Tools registered with no capability gate: ${ungated.join(', ')}`);
  }
```

Run the suite and confirm it still passes — proving no tool is currently ungated.

- [ ] **Step 2: Update the expected mappings** in `gate-mapping.test.ts` to the new values, then run and watch them fail against the old gates.
- [ ] **Step 3: Apply the gates.**
- [ ] **Step 4: Mutation-proof.** Flip `drive_get_comments`'s remedy to `drive:read` and confirm exactly one failure; revert. Paste the output into the report.
- [ ] **Step 5: Verify + commit** — `fix(gates): accept drive:appfiles where Google authorizes it`

---

### Task 4: [A4] Reauth and scope-storage bugs

**Files:** Modify `src/auth/account-store.ts`, `src/auth/oauth.ts`, `src/server/index.ts`; Test `tests/unit/account-capabilities.test.ts`

Three defects from the spec's A5:

1. **`capabilities: []`** strips an account to `userinfo.email` because `[]` is truthy. Treat empty as unspecified everywhere (`startReauthAccount`, `startAddAccount`, `addAccount`), matching `google_add_account`.
2. **Legacy `scopeTier`** is silently stripped by zod, so a legacy call no-ops through a full OAuth round trip and reports success. Add `.strict()` (or an explicit unknown-key check) on both account tools, with an error naming `capabilities` as the replacement and giving the old→new mapping.
3. **Requested vs granted scopes** — `account.scopes` stores what was requested. Read `tokens.scope` (space-delimited) from the token response in `oauth.ts` and persist the granted set; fall back to the requested set only if the response omits it, and note that fallback in a comment.

Tests: empty array reuses current scopes; a legacy `scopeTier` key is rejected by name; a token response granting a subset persists the subset.

- [ ] Steps: failing tests → run → implement → verify → commit `fix(auth): store granted scopes and reject legacy tier args`

---

### Task 5: [A5] Drive export and barrel-export bugs

**Files:** Modify `src/drive/client.ts`, `src/index.ts`; Test `tests/unit/drive-content.test.ts`, `tests/unit/drive-export-format.test.ts`

1. **Unbounded preview** — binary Workspace exports (a Drawing exports to `image/png`) bypass `maxChars`. `drive_get_file_content` must not return an unbounded payload; refuse with a pointer to `drive_download_file`, and update the test that currently pins the unbounded behaviour.
2. **`exportMimeType: ''`** — treat empty string as absent so a Doc takes the default export path rather than the raw-media path Drive rejects.
3. **Raw `Error`** — use `validationError` for `exportMimeType` misuse.
4. **Barrel** — export `Capability`, `CAPABILITIES`, `capabilitiesOf`, `scopesFor`, `isCapability` from `src/index.ts`.

- [ ] Steps: failing tests → run → implement → verify → commit `fix(drive): bound binary previews and export capability types`

---

### Task 6: [A6] Fix the flaky exponential-backoff assertion

**Files:** Modify `tests/unit/retry.test.ts`

`tests/unit/retry.test.ts` (~line 99) asserts `delays[1]/delays[0]` is `> 1.2` and `< 3`. Each delay carries independent jitter of ±25%, so the true ratio range is `[1.5/1.25, 2.5/0.75]` = `[1.2, 3.33]`. Both asserted bounds sit inside the legitimate range, so the test fails at random. It has done so three times in one working session, each time costing a re-run and a moment of doubt about whether real work broke.

A flaky test in a suite used as a merge gate is worse than no test: it trains everyone to re-run rather than investigate.

- [ ] **Step 1:** Derive the correct bounds from the jitter factor actually used in `src/utils/retry.ts` — read it, do not assume ±25%. State the derivation in a comment above the assertion so the next reader can check it rather than trust it.
- [ ] **Step 2:** Assert the property that matters — that the second delay is meaningfully larger than the first (exponential growth happened) — within bounds that cannot fail for a correct implementation. Do not simply widen the numbers until it passes; the comment must show why the new bounds are exhaustive.
- [ ] **Step 3:** Run the file 20 times in a row and confirm zero failures: `for i in $(seq 20); do pnpm vitest run tests/unit/retry.test.ts 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)"; done`. Paste the output.
- [ ] **Step 4:** Commit — `test(retry): fix jitter bounds that could fail for a correct implementation`

---

## Part B — permission UX

### Task 7: [B1] Capability metadata table

**Files:** Modify `src/auth/capabilities.ts`; Test `tests/unit/capabilities.test.ts`

Add `CAPABILITY_INFO: Record<Capability, { name: string; canDo: string; cannotDo: string; reach: string }>` using the copy in the spec's B3. Test that every capability has an entry and none is empty. This is the source Part C generates from.

- [ ] Steps: failing test → implement → verify → commit `feat(auth): add capability metadata as the docs source of truth`

---

### Task 8: [B2] Coverage annotation on Drive responses

**Files:** Modify `src/server/drive-tools.ts`; Test `tests/unit/drive-coverage.test.ts` (new)

When an account holds `drive:appfiles` but not `drive:read`, every Drive response carries `coverage: { scope: 'app-created-only', explanation: ... }`, and list/search responses put `warning` as the **first key**. Emit on non-empty results too — annotating only empty results teaches "warning means zero results".

- [ ] Steps: failing tests → implement → verify → commit `feat(drive): annotate partial-visibility responses`

---

### Task 9: [B3] Error taxonomy

**Files:** Modify `src/errors/index.ts`, `src/server/drive-tools.ts`; Test `tests/unit/errors.test.ts`

Retype a Drive not-found on an account lacking `drive:read` as `DRIVE_FILE_NOT_VISIBLE` with `ambiguous: true`; keep `NOT_FOUND` with `ambiguous: false` otherwise. Add `retryable`, `reauthHelps`, `requiresHumanApproval`, `alternativeAccounts` to permission errors — `alternativeAccounts` listing other configured accounts that hold the needed capability.

Message must not assert the file exists. Document the known false positive (a mistyped ID 404s identically) in a comment.

- [ ] Steps: failing tests → implement → verify → commit `feat(errors): distinguish invisible-file from not-found`

---

### Task 10: [B4] Presets and widening confirmation

**Files:** Modify `src/server/index.ts`; Test `tests/unit/capability-presets.test.ts` (new)

Three presets expanded to primitives before storage: `read-only`, `inbox-assistant`, `scheduler` (both calendar capabilities — `calendar:write` alone cannot list calendars). None pre-selected, no `full-access`, no Drive preset.

Widening into `drive:read` requires `confirm: true` and states it grants read of every file including everything shared with the user — mirroring the existing narrowing gate.

- [ ] Steps: failing tests → implement → verify → commit `feat(server): add capability presets and widening confirmation`

---

## Part C — documentation surface

### Task 11: [C1] Generate docs from the metadata table

**Files:** Create `scripts/generate-capability-docs.ts`; Modify `package.json`; Test `tests/unit/capability-docs.test.ts` (new)

Generate the capability table for `README.md` and the permission line in `site/llms.txt` from `CAPABILITY_INFO`, between marker comments. Add `pnpm docs:capabilities` and a test asserting the committed files match regenerated output, so drift fails CI.

- [ ] Steps: failing test → implement → verify → commit `build: generate capability docs from the metadata table`

---

### Task 12: [C2] Update every user-facing surface

**Files:** Modify `README.md`, `site/index.html`, `site/llms.txt`, `docs/SPEC.md`, `docs/demo-video-scripts.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `package.json`

- `README.md` — replace the "Scope Tiers" table with generated capability content; fix "Upgrade my account to `drive_full`"; remove the false claim that re-adding is needed for compose.
- `site/index.html:198` — the "Tiered Scopes" feature card is now false. Rewrite for capabilities. **Leave the release-history entry at :357 alone** — it accurately describes an earlier version.
- `site/llms.txt:32` — replace the tiered-scopes claim; add `drive_get_comments` / `drive_get_comment_replies` to the Drive tool list, which currently omits them.
- `docs/SPEC.md`, `docs/demo-video-scripts.md` — update stale references.
- `docs/ARCHITECTURE.md:63` — delete the false claim that a `drive.file` account "never should have had" the read tools; it argues against Task A3. Replace with the verified matrix and a pointer to the spec.
- `CHANGELOG.md` — add 0.5.1 covering the gate corrections, the implication, and the UX additions. Say plainly that 0.5.0's gates were too strict.
- `package.json` — bump to 0.5.1. Do **not** run `pnpm build`.

- [ ] **Verify:** `grep -rnE "mail_readonly|mail_compose|mail_full|mail_settings|drive_readonly|drive_full|calendar_readonly|calendar_full|scopeTier" README.md site/ docs/SPEC.md docs/demo-video-scripts.md` returns only release-history lines, and report each one with why it is acceptable.
- [ ] Commit — `docs: bring README, site and llms.txt onto the capability model`

---

## Done When

- Every gate matches the spec's verified matrix; `drive_list_shared_drives` is the only Drive read tool still requiring `drive:read`.
- A `drive:appfiles` account can upload a file and read it back.
- An any-of gate's remedy names one capability, never the union.
- `gate-mapping.test.ts` throws if any registered tool has no gate.
- No user-facing surface teaches tier vocabulary outside release history.
- `pnpm test`, `pnpm typecheck`, `pnpm biome check src` green; `package.json` at 0.5.1.
