# E2E Harness Stage 1: Fixtures & Preflight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persistent Drive fixtures and the scope-preflight check that stages 2–3 of the E2E harness depend on, and resolve the two open unknowns about what the Drive API will actually let us seed.

**Architecture:** Standalone TypeScript run through `tsx`, following the existing `scripts/test-*.ts` pattern: real `AccountStore`, real tokens from `~/.config/mcp-google/tokens`, real Google APIs. Pure logic (config I/O, scope matching, fixture-presence decisions) is split into its own modules so it can be unit-tested with vitest; only the thin API-calling layer is untestable offline. The seeder is **verify-or-create**: it never assumes it is running for the first time.

**Tech Stack:** TypeScript (ES2022/NodeNext), `tsx`, vitest, `googleapis` (Drive v3), Biome.

**Spec:** `docs/superpowers/specs/2026-08-10-mcp-e2e-test-harness-design.md`

## Global Constraints

- Never invoke `google_remove_account`, and never call `drive.files.delete` on anything outside the fixture folder.
- Fixtures are **persistent**. Nothing in this stage may delete a fixture; the seeder only creates what is missing.
- The fixture folder is named exactly `__MCP-E2E-FIXTURES — DO NOT DELETE__` (note the em-dash and the double underscores).
- Accounts under test are addressed by alias: `Procedure` (primary), `Personal` (secondary). Never hardcode account IDs or email addresses in source.
- `e2e.config.json` and `.e2e/` are gitignored and must never be committed.
- Follow the codebase's conditional-assignment idiom for optional properties — `exactOptionalPropertyTypes` is on, so never assign `undefined` to an optional field.
- All new code must pass `pnpm biome check` and the new `pnpm typecheck:e2e`.

---

### Task 1: Repo plumbing — server cleanup, gitignore, typechecking

**Files:**
- Modify: `.mcp.json`
- Modify: `.gitignore`
- Create: `tsconfig.e2e.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm typecheck:e2e` — the command every later task uses to verify types.

- [ ] **Step 1: Remove the dead MCP server entry**

`.mcp.json` contains a `proGoogleMCP` entry pointing at `/home/baheti/projects/google-multi-account-mcp/dist/cli.js` — a Linux path that does not exist on this machine. Two servers answering as "the local build" makes the stage-3 version gate meaningless. Delete the whole `proGoogleMCP` block, keeping `localProGoogleMCP`.

- [ ] **Step 2: Verify only one local server remains**

Run: `python3 -c "import json;d=json.load(open('.mcp.json'));print([k for k in d['mcpServers'] if 'oogle' in k])"`
Expected: `['localProGoogleMCP']`

Also check `~/.claude.json` for a `proGoogleMCP` entry pointing at this repo's `dist/cli.js`. If present, report it to the user — it is outside the repo, so do not edit it without asking.

- [ ] **Step 3: Gitignore the E2E working files**

Append to `.gitignore`:

```
# E2E harness — local machine state, never commit
.e2e/
e2e.config.json
```

- [ ] **Step 4: Add a typecheck config for the harness**

`tsconfig.json` only includes `src/**/*`, so nothing under `scripts/` is typechecked today. Create `tsconfig.e2e.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false
  },
  "include": ["scripts/e2e/**/*", "src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Scope it to `scripts/e2e/**/*` only — widening it to all of `scripts/` or `tests/` would surface pre-existing errors unrelated to this work.

- [ ] **Step 5: Add the script**

In `package.json` `"scripts"`, after `"typecheck"`:

```json
"typecheck:e2e": "tsc -p tsconfig.e2e.json --noEmit",
```

- [ ] **Step 6: Verify it runs clean on an empty harness**

Run: `pnpm typecheck:e2e`
Expected: exits 0 with no output (no `scripts/e2e/` files exist yet, so only `src/` is checked).

- [ ] **Step 7: Commit**

```bash
git add .mcp.json .gitignore tsconfig.e2e.json package.json
git commit -m "chore(e2e): add harness typecheck config, gitignore, drop dead MCP server entry"
```

---

### Task 2: E2E config module

**Files:**
- Create: `scripts/e2e/config.ts`
- Test: `tests/unit/e2e-config.test.ts`

**Interfaces:**
- Consumes: `pnpm typecheck:e2e` from Task 1.
- Produces:
  - `E2E_CONFIG_PATH: string`
  - `interface FixtureSet { folderId: string; contractDocId?: string; sheetId?: string; drawingId?: string; anchoredCommentSupported?: boolean }`
  - `interface E2eConfig { accounts: { primary: string; secondary: string }; fixtures: Record<string, FixtureSet> }`
  - `defaultE2eConfig(): E2eConfig`
  - `loadE2eConfig(path?: string): E2eConfig`
  - `saveE2eConfig(config: E2eConfig, path?: string): void`

`fixtures` is keyed by account alias. Every field except `folderId` is optional because a spike may fail and leave a fixture unseeded — the config must be able to represent partial success.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/e2e-config.test.ts`:

```typescript
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultE2eConfig,
  loadE2eConfig,
  saveE2eConfig,
} from '../../scripts/e2e/config.js';

describe('e2e config', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-config-'));
    path = join(dir, 'e2e.config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to the Procedure and Personal aliases with no fixtures', () => {
    const config = defaultE2eConfig();

    expect(config.accounts.primary).toBe('Procedure');
    expect(config.accounts.secondary).toBe('Personal');
    expect(config.fixtures).toEqual({});
  });

  it('returns the default config when the file does not exist', () => {
    const config = loadE2eConfig(path);

    expect(config).toEqual(defaultE2eConfig());
  });

  it('round-trips a saved config', () => {
    const config = defaultE2eConfig();
    config.fixtures.Procedure = { folderId: 'fold-1', contractDocId: 'doc-1' };

    saveE2eConfig(config, path);

    expect(loadE2eConfig(path)).toEqual(config);
  });

  it('writes readable indented JSON', () => {
    saveE2eConfig(defaultE2eConfig(), path);

    expect(readFileSync(path, 'utf-8')).toContain('\n  "accounts"');
  });

  it('throws a clear error when the file is not valid JSON', () => {
    writeFileSync(path, '{ not json');

    expect(() => loadE2eConfig(path)).toThrow(/e2e.config.json/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/e2e-config.test.ts`
Expected: FAIL — cannot resolve `../../scripts/e2e/config.js`.

- [ ] **Step 3: Write the implementation**

Create `scripts/e2e/config.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Fixture IDs for one account. Only folderId is guaranteed — a spike may leave the rest unseeded. */
export interface FixtureSet {
  folderId: string;
  contractDocId?: string;
  sheetId?: string;
  drawingId?: string;
  /** Whether an API-created anchored comment returned quotedFileContent (spike 1) */
  anchoredCommentSupported?: boolean;
}

export interface E2eConfig {
  accounts: { primary: string; secondary: string };
  /** Keyed by account alias */
  fixtures: Record<string, FixtureSet>;
}

export const E2E_CONFIG_PATH = join(process.cwd(), 'e2e.config.json');

export function defaultE2eConfig(): E2eConfig {
  return {
    accounts: { primary: 'Procedure', secondary: 'Personal' },
    fixtures: {},
  };
}

export function loadE2eConfig(path: string = E2E_CONFIG_PATH): E2eConfig {
  if (!existsSync(path)) {
    return defaultE2eConfig();
  }

  const raw = readFileSync(path, 'utf-8');

  try {
    return JSON.parse(raw) as E2eConfig;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse e2e.config.json at ${path}: ${detail}`);
  }
}

export function saveE2eConfig(config: E2eConfig, path: string = E2E_CONFIG_PATH): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/e2e-config.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck:e2e && pnpm biome check scripts/e2e/config.ts tests/unit/e2e-config.test.ts`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e/config.ts tests/unit/e2e-config.test.ts
git commit -m "feat(e2e): add config module for fixture IDs and account aliases"
```

---

### Task 3: Preflight scope matrix

**Files:**
- Create: `scripts/e2e/preflight.ts`
- Test: `tests/unit/e2e-preflight.test.ts`

**Interfaces:**
- Consumes: `hasSufficientScope`, `ScopeTier` from `src/types/index.ts`.
- Produces:
  - `interface ScopeRequirement { group: string; tier: ScopeTier }`
  - `interface PreflightResult { account: string; group: string; status: 'ok' | 'skip'; reason?: string }`
  - `REQUIRED_SCOPES: ScopeRequirement[]`
  - `checkAccount(alias: string, scopes: string[], requirements?: ScopeRequirement[]): PreflightResult[]`
  - `formatPreflight(results: PreflightResult[]): string`

The point of this module: an account missing a scope produces `skip`, never `fail`. "Could not test" and "is broken" must never look alike.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/e2e-preflight.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { REQUIRED_SCOPES, checkAccount, formatPreflight } from '../../scripts/e2e/preflight.js';

const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const EMAIL = 'https://www.googleapis.com/auth/userinfo.email';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

describe('e2e preflight', () => {
  it('marks a group ok when the account satisfies the tier', () => {
    const results = checkAccount('Procedure', [DRIVE_READONLY, EMAIL], [
      { group: 'drive-read', tier: 'drive_readonly' },
    ]);

    expect(results).toEqual([{ account: 'Procedure', group: 'drive-read', status: 'ok' }]);
  });

  it('marks a group skip — never fail — when a scope is missing', () => {
    const results = checkAccount('Personal', [DRIVE_FILE, EMAIL], [
      { group: 'drive-read', tier: 'drive_readonly' },
    ]);

    expect(results[0]?.status).toBe('skip');
    expect(results.some((r) => r.status === ('fail' as string))).toBe(false);
  });

  it('names the missing tier in the skip reason', () => {
    const results = checkAccount('Personal', [DRIVE_FILE, EMAIL], [
      { group: 'drive-read', tier: 'drive_readonly' },
    ]);

    expect(results[0]?.reason).toContain('drive_readonly');
  });

  it('honours the implied-scope hierarchy so gmail.modify satisfies mail_readonly', () => {
    const results = checkAccount('Personal', [GMAIL_MODIFY, EMAIL], [
      { group: 'mail-read', tier: 'mail_readonly' },
    ]);

    expect(results[0]?.status).toBe('ok');
  });

  it('checks every requirement, not just the first failing one', () => {
    const results = checkAccount('Personal', [DRIVE_FILE, EMAIL], [
      { group: 'drive-read', tier: 'drive_readonly' },
      { group: 'drive-write', tier: 'drive_full' },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status)).toEqual(['skip', 'ok']);
  });

  it('requires drive_readonly for the comments group', () => {
    const comments = REQUIRED_SCOPES.find((r) => r.group === 'drive-comments');

    expect(comments?.tier).toBe('drive_readonly');
  });

  it('renders a summary naming each skipped group', () => {
    const output = formatPreflight([
      { account: 'Procedure', group: 'drive-comments', status: 'ok' },
      { account: 'Personal', group: 'drive-comments', status: 'skip', reason: 'needs drive_readonly' },
    ]);

    expect(output).toContain('Personal');
    expect(output).toContain('drive-comments');
    expect(output).toContain('needs drive_readonly');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/e2e-preflight.test.ts`
Expected: FAIL — cannot resolve `../../scripts/e2e/preflight.js`.

- [ ] **Step 3: Write the implementation**

Create `scripts/e2e/preflight.ts`:

```typescript
import { type ScopeTier, hasSufficientScope } from '../../src/types/index.js';

export interface ScopeRequirement {
  group: string;
  tier: ScopeTier;
}

export interface PreflightResult {
  account: string;
  group: string;
  status: 'ok' | 'skip';
  reason?: string;
}

/**
 * Which scope tier each test group needs. drive-comments sits on drive_readonly
 * deliberately: drive.file only covers app-created files, so it cannot read
 * comments on a Doc shared by a third party.
 */
export const REQUIRED_SCOPES: ScopeRequirement[] = [
  { group: 'mail-read', tier: 'mail_readonly' },
  { group: 'mail-compose', tier: 'mail_compose' },
  { group: 'mail-modify', tier: 'mail_full' },
  { group: 'mail-settings', tier: 'mail_settings' },
  { group: 'drive-read', tier: 'drive_readonly' },
  { group: 'drive-comments', tier: 'drive_readonly' },
  { group: 'drive-write', tier: 'drive_full' },
  { group: 'calendar-read', tier: 'calendar_readonly' },
  { group: 'calendar-write', tier: 'calendar_full' },
];

export function checkAccount(
  alias: string,
  scopes: string[],
  requirements: ScopeRequirement[] = REQUIRED_SCOPES,
): PreflightResult[] {
  return requirements.map((requirement) => {
    if (hasSufficientScope(scopes, requirement.tier)) {
      return { account: alias, group: requirement.group, status: 'ok' };
    }

    return {
      account: alias,
      group: requirement.group,
      status: 'skip',
      reason: `needs ${requirement.tier} — re-authorize with google_reauth_account`,
    };
  });
}

export function formatPreflight(results: PreflightResult[]): string {
  const skipped = results.filter((r) => r.status === 'skip');

  const lines = [
    `Preflight: ${results.length - skipped.length}/${results.length} groups available`,
  ];

  for (const result of skipped) {
    lines.push(`  SKIP  ${result.account}  ${result.group}  ${result.reason ?? ''}`.trimEnd());
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/e2e-preflight.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck, lint, and confirm the full suite is still green**

Run: `pnpm typecheck:e2e && pnpm biome check scripts/e2e tests/unit/e2e-preflight.test.ts && pnpm test`
Expected: all exit 0; the full suite is green.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e/preflight.ts tests/unit/e2e-preflight.test.ts
git commit -m "feat(e2e): add scope preflight that skips rather than fails on missing scopes"
```

---

### Task 4: Drive fixture helpers — folder and child lookup

**Files:**
- Create: `scripts/e2e/drive-fixtures.ts`
- Test: `tests/unit/e2e-drive-fixtures.test.ts`

**Interfaces:**
- Consumes: `drive_v3.Drive` from `googleapis`.
- Produces:
  - `FIXTURE_FOLDER_NAME: string`
  - `findFolderByName(drive, name): Promise<string | null>`
  - `createFolder(drive, name): Promise<string>`
  - `findOrCreateFolder(drive, name): Promise<{ id: string; created: boolean }>`
  - `findChildByName(drive, folderId, name): Promise<string | null>`

Mock `googleapis` exactly as `tests/unit/drive-shared-drives.test.ts` does — same style, so the codebase stays consistent.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/e2e-drive-fixtures.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { drive_v3 } from 'googleapis';
import {
  FIXTURE_FOLDER_NAME,
  findChildByName,
  findFolderByName,
  findOrCreateFolder,
} from '../../scripts/e2e/drive-fixtures.js';

const mockFilesList = vi.fn();
const mockFilesCreate = vi.fn();

function fakeDrive(): drive_v3.Drive {
  return {
    files: { list: mockFilesList, create: mockFilesCreate },
  } as unknown as drive_v3.Drive;
}

describe('e2e drive fixtures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a fixture folder name that reads as off-limits', () => {
    expect(FIXTURE_FOLDER_NAME).toBe('__MCP-E2E-FIXTURES — DO NOT DELETE__');
  });

  it('finds an existing folder by exact name, excluding trashed ones', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [{ id: 'fold-1' }] } });

    const id = await findFolderByName(fakeDrive(), FIXTURE_FOLDER_NAME);

    expect(id).toBe('fold-1');
    const query = mockFilesList.mock.calls[0][0].q as string;
    expect(query).toContain('trashed = false');
    expect(query).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(query).toContain(FIXTURE_FOLDER_NAME);
  });

  it('returns null when no folder matches', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

    expect(await findFolderByName(fakeDrive(), FIXTURE_FOLDER_NAME)).toBeNull();
  });

  it('reuses an existing folder rather than creating a duplicate', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [{ id: 'fold-1' }] } });

    const result = await findOrCreateFolder(fakeDrive(), FIXTURE_FOLDER_NAME);

    expect(result).toEqual({ id: 'fold-1', created: false });
    expect(mockFilesCreate).not.toHaveBeenCalled();
  });

  it('creates the folder when it is missing', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'fold-new' } });

    const result = await findOrCreateFolder(fakeDrive(), FIXTURE_FOLDER_NAME);

    expect(result).toEqual({ id: 'fold-new', created: true });
    expect(mockFilesCreate.mock.calls[0][0].requestBody).toEqual({
      name: FIXTURE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    });
  });

  it('escapes single quotes in names so the Drive query cannot break', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

    await findFolderByName(fakeDrive(), "Bob's Folder");

    expect(mockFilesList.mock.calls[0][0].q as string).toContain("Bob\\'s Folder");
  });

  it('scopes a child lookup to the parent folder', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [{ id: 'doc-1' }] } });

    const id = await findChildByName(fakeDrive(), 'fold-1', 'e2e-fixture-contract');

    expect(id).toBe('doc-1');
    expect(mockFilesList.mock.calls[0][0].q as string).toContain("'fold-1' in parents");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/e2e-drive-fixtures.test.ts`
Expected: FAIL — cannot resolve `../../scripts/e2e/drive-fixtures.js`.

- [ ] **Step 3: Write the implementation**

Create `scripts/e2e/drive-fixtures.ts`:

```typescript
import type { drive_v3 } from 'googleapis';

/** Deliberately shouty so it reads as off-limits when browsing Drive. */
export const FIXTURE_FOLDER_NAME = '__MCP-E2E-FIXTURES — DO NOT DELETE__';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Drive query strings are single-quoted, so a literal quote has to be escaped. */
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function findFolderByName(
  drive: drive_v3.Drive,
  name: string,
): Promise<string | null> {
  const response = await drive.files.list({
    q: `name = '${escapeQueryValue(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  return response.data.files?.[0]?.id ?? null;
}

export async function createFolder(drive: drive_v3.Drive, name: string): Promise<string> {
  const response = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: 'id',
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating folder "${name}"`);
  }

  return id;
}

export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findFolderByName(drive, name);
  if (existing) {
    return { id: existing, created: false };
  }

  return { id: await createFolder(drive, name), created: true };
}

export async function findChildByName(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
): Promise<string | null> {
  const response = await drive.files.list({
    q: `name = '${escapeQueryValue(name)}' and '${folderId}' in parents and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  return response.data.files?.[0]?.id ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/e2e-drive-fixtures.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck:e2e && pnpm biome check scripts/e2e tests/unit/e2e-drive-fixtures.test.ts`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e/drive-fixtures.ts tests/unit/e2e-drive-fixtures.test.ts
git commit -m "feat(e2e): add idempotent Drive folder and child lookup helpers"
```

---

### Task 5: Doc fixture and comment seeding (resolves spike 1)

**Files:**
- Modify: `scripts/e2e/drive-fixtures.ts`
- Test: `tests/unit/e2e-drive-fixtures.test.ts`

**Interfaces:**
- Consumes: `findChildByName`, `escapeQueryValue` behaviour from Task 4.
- Produces:
  - `CONTRACT_DOC_NAME: string`
  - `CONTRACT_DOC_TEXT: string`
  - `QUOTED_SENTENCE: string`
  - `createNativeDoc(drive, folderId, name, text): Promise<string>`
  - `seedAnchoredComment(drive, fileId, quoted, body): Promise<string>`
  - `readBackQuotedText(drive, fileId, commentId): Promise<string | undefined>`

**Why this cannot go through the MCP:** `drive_upload_file` sets `requestBody.mimeType` and `media.mimeType` to the same value, so Drive's convert-on-upload never triggers and a native Doc cannot be produced. Comment writing is not exposed at all. Both are recorded as backlog items in `docs/TASKS.md`. Calling the Drive API directly from test scaffolding is acceptable — it is not product surface.

- [ ] **Step 1: Write the failing test**

First extend the harness at the top of `tests/unit/e2e-drive-fixtures.test.ts`. Add these two mocks beside the existing ones:

```typescript
const mockCommentsCreate = vi.fn();
const mockCommentsList = vi.fn();
```

and replace `fakeDrive()` with:

```typescript
function fakeDrive(): drive_v3.Drive {
  return {
    files: { list: mockFilesList, create: mockFilesCreate },
    comments: { create: mockCommentsCreate, list: mockCommentsList },
  } as unknown as drive_v3.Drive;
}
```

Extend the import from `../../scripts/e2e/drive-fixtures.js` with `CONTRACT_DOC_TEXT`, `QUOTED_SENTENCE`, `createNativeDoc`, `readBackQuotedText`, `seedAnchoredComment`. Then append:

```typescript
describe('doc and comment seeding', () => {
  it('creates a native Google Doc by converting uploaded plain text', async () => {
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'doc-1' } });

    const id = await createNativeDoc(fakeDrive(), 'fold-1', 'e2e-fixture-contract', 'body text');

    expect(id).toBe('doc-1');
    const params = mockFilesCreate.mock.calls[0][0];
    // The conversion only happens when the two MIME types differ.
    expect(params.requestBody.mimeType).toBe('application/vnd.google-apps.document');
    expect(params.media.mimeType).toBe('text/plain');
    expect(params.requestBody.parents).toEqual(['fold-1']);
  });

  it('quotes a sentence that actually appears in the fixture body', () => {
    expect(CONTRACT_DOC_TEXT).toContain(QUOTED_SENTENCE);
  });

  it('sends both an anchor and quotedFileContent when seeding a comment', async () => {
    mockCommentsCreate.mockResolvedValueOnce({ data: { id: 'c1' } });

    const id = await seedAnchoredComment(fakeDrive(), 'doc-1', 'unlimited liability', 'Too broad.');

    expect(id).toBe('c1');
    const params = mockCommentsCreate.mock.calls[0][0];
    expect(params.fileId).toBe('doc-1');
    expect(params.requestBody.content).toBe('Too broad.');
    expect(params.requestBody.quotedFileContent.value).toBe('unlimited liability');
    expect(params.requestBody.anchor).toBeTypeOf('string');
    expect(params.fields).toContain('id');
  });

  it('reads back the quoted text Drive actually stored', async () => {
    mockCommentsList.mockResolvedValueOnce({
      data: {
        comments: [{ id: 'c1', quotedFileContent: { value: 'unlimited liability' } }],
      },
    });

    const quoted = await readBackQuotedText(fakeDrive(), 'doc-1', 'c1');

    expect(quoted).toBe('unlimited liability');
    expect(mockCommentsList.mock.calls[0][0].fields).toContain('quotedFileContent');
  });

  it('reports undefined when Drive dropped the quoted text', async () => {
    mockCommentsList.mockResolvedValueOnce({ data: { comments: [{ id: 'c1' }] } });

    expect(await readBackQuotedText(fakeDrive(), 'doc-1', 'c1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/e2e-drive-fixtures.test.ts`
Expected: FAIL — `createNativeDoc` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `scripts/e2e/drive-fixtures.ts`:

```typescript
export const CONTRACT_DOC_NAME = 'e2e-fixture-contract';

/** The sentence a seeded comment anchors to. Must appear verbatim in CONTRACT_DOC_TEXT. */
export const QUOTED_SENTENCE = 'unlimited liability';

export const CONTRACT_DOC_TEXT = [
  'STATEMENT OF WORK (E2E FIXTURE — DO NOT EDIT)',
  '',
  '1. Scope. Supplier will deliver the services described in Schedule A.',
  `2. Liability. Supplier accepts ${QUOTED_SENTENCE} for any loss arising from the services.`,
  '3. Term. This agreement runs for twelve months from the effective date.',
  '',
  'This document exists only to exercise the MCP end-to-end suite.',
].join('\n');

/**
 * Create a native Google Doc. Drive converts on upload only when the target type
 * (requestBody.mimeType) differs from the uploaded media type — which is exactly
 * what drive_upload_file cannot express today.
 */
export async function createNativeDoc(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
  text: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    media: { mimeType: 'text/plain', body: text },
    fields: 'id',
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating Doc "${name}"`);
  }

  return id;
}

/**
 * Attempt an anchored comment. Whether Drive honours an API-supplied anchor and
 * returns quotedFileContent is the open question this fixture resolves — always
 * confirm with readBackQuotedText rather than trusting the create call.
 */
export async function seedAnchoredComment(
  drive: drive_v3.Drive,
  fileId: string,
  quoted: string,
  body: string,
): Promise<string> {
  const response = await drive.comments.create({
    fileId,
    fields: 'id, quotedFileContent(value)',
    requestBody: {
      content: body,
      anchor: JSON.stringify({ r: 'head', a: [{ txt: { o: 0, l: quoted.length } }] }),
      quotedFileContent: { mimeType: 'text/plain', value: quoted },
    },
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating a comment on ${fileId}`);
  }

  return id;
}

export async function readBackQuotedText(
  drive: drive_v3.Drive,
  fileId: string,
  commentId: string,
): Promise<string | undefined> {
  const response = await drive.comments.list({
    fileId,
    fields: 'comments(id,quotedFileContent(value))',
    includeDeleted: false,
    pageSize: 100,
  });

  const match = response.data.comments?.find((c) => c.id === commentId);
  return match?.quotedFileContent?.value ?? undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/e2e-drive-fixtures.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck:e2e && pnpm biome check scripts/e2e tests/unit/e2e-drive-fixtures.test.ts
git add scripts/e2e/drive-fixtures.ts tests/unit/e2e-drive-fixtures.test.ts
git commit -m "feat(e2e): seed a native Doc fixture with an anchored comment"
```

---

### Task 6: Sheet and Drawing fixtures (resolves spike 2)

**Files:**
- Modify: `scripts/e2e/drive-fixtures.ts`
- Test: `tests/unit/e2e-drive-fixtures.test.ts`

**Interfaces:**
- Produces:
  - `SHEET_NAME: string`, `DRAWING_NAME: string`
  - `createNativeSheet(drive, folderId, name, csv): Promise<string>`
  - `tryCreateDrawing(drive, folderId, name): Promise<string | null>`

The Drawing matters because its default export is `image/png` — the binary path that was silently corrupting downloads until the 2026-08-07 fix. `tryCreateDrawing` returns `null` rather than throwing if Drive refuses to create a blank Drawing, so a refusal degrades the fixture set instead of failing the seeder.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/e2e-drive-fixtures.test.ts` (extend the import with `createNativeSheet`, `tryCreateDrawing`):

```typescript
describe('sheet and drawing fixtures', () => {
  it('creates a native Sheet by converting uploaded CSV', async () => {
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'sheet-1' } });

    const id = await createNativeSheet(fakeDrive(), 'fold-1', 'e2e-fixture-sheet', 'a,b\n1,2');

    expect(id).toBe('sheet-1');
    const params = mockFilesCreate.mock.calls[0][0];
    expect(params.requestBody.mimeType).toBe('application/vnd.google-apps.spreadsheet');
    expect(params.media.mimeType).toBe('text/csv');
  });

  it('creates a blank Drawing with no media body', async () => {
    mockFilesCreate.mockResolvedValueOnce({ data: { id: 'draw-1' } });

    const id = await tryCreateDrawing(fakeDrive(), 'fold-1', 'e2e-fixture-drawing');

    expect(id).toBe('draw-1');
    const params = mockFilesCreate.mock.calls[0][0];
    expect(params.requestBody.mimeType).toBe('application/vnd.google-apps.drawing');
    expect(params.media).toBeUndefined();
  });

  it('returns null instead of throwing when Drive refuses to create a Drawing', async () => {
    mockFilesCreate.mockRejectedValueOnce(new Error('Bad Request'));

    expect(await tryCreateDrawing(fakeDrive(), 'fold-1', 'e2e-fixture-drawing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/e2e-drive-fixtures.test.ts`
Expected: FAIL — `createNativeSheet` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `scripts/e2e/drive-fixtures.ts`:

```typescript
export const SHEET_NAME = 'e2e-fixture-sheet';
export const DRAWING_NAME = 'e2e-fixture-drawing';

export const SHEET_CSV = 'item,qty,unit_price\nwidget,4,25\ngadget,2,60\n';

export async function createNativeSheet(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
  csv: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    media: { mimeType: 'text/csv', body: csv },
    fields: 'id',
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Drive returned no id when creating Sheet "${name}"`);
  }

  return id;
}

/**
 * A Drawing exports to image/png by default, making it the only fixture that
 * exercises the binary export path. Whether Drive will create a blank one via the
 * API is unverified — return null on refusal so the caller can fall back to asking
 * the user to create it by hand once.
 */
export async function tryCreateDrawing(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
): Promise<string | null> {
  try {
    const response = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId],
        mimeType: 'application/vnd.google-apps.drawing',
      },
      fields: 'id',
    });

    return response.data.id ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/e2e-drive-fixtures.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck:e2e && pnpm biome check scripts/e2e tests/unit/e2e-drive-fixtures.test.ts
git add scripts/e2e/drive-fixtures.ts tests/unit/e2e-drive-fixtures.test.ts
git commit -m "feat(e2e): add Sheet and Drawing fixtures for the export-format paths"
```

---

### Task 7: Seeder CLI — wire it together and run it for real

**Files:**
- Create: `scripts/e2e/seed-fixtures.ts`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-10-mcp-e2e-test-harness-design.md`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `pnpm e2e:seed`, and a populated `e2e.config.json`.

This is the first task that touches real Google accounts. It only ever creates; it never deletes.

- [ ] **Step 1: Write the CLI**

Create `scripts/e2e/seed-fixtures.ts`:

```typescript
#!/usr/bin/env npx tsx

/**
 * Seed the persistent E2E fixtures in Drive. Idempotent: re-running reuses
 * whatever already exists and only creates what is missing. Never deletes.
 *
 * Usage: pnpm e2e:seed [accountAlias]
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { google } from 'googleapis';
import { AccountStore, createTokenStorage } from '../../src/index.js';
import { type FixtureSet, loadE2eConfig, saveE2eConfig } from './config.js';
import {
  CONTRACT_DOC_NAME,
  CONTRACT_DOC_TEXT,
  DRAWING_NAME,
  FIXTURE_FOLDER_NAME,
  QUOTED_SENTENCE,
  SHEET_CSV,
  SHEET_NAME,
  createNativeDoc,
  createNativeSheet,
  findChildByName,
  findOrCreateFolder,
  readBackQuotedText,
  seedAnchoredComment,
  tryCreateDrawing,
} from './drive-fixtures.js';

const TOKENS_DIR = path.join(os.homedir(), '.config', 'mcp-google', 'tokens');

async function main(): Promise<void> {
  const config = loadE2eConfig();
  const alias = process.argv[2] ?? config.accounts.primary;

  const tokenStorage = await createTokenStorage(TOKENS_DIR, process.env.MCP_GOOGLE_PASSPHRASE);
  const accountStore = new AccountStore(tokenStorage);

  const account = accountStore.resolveAccount(alias);
  if (!account) {
    throw new Error(`No account matches "${alias}". Run: npx tsx scripts/test-oauth.ts list`);
  }

  const auth = await accountStore.getAuthenticatedClient(account.id);
  const drive = google.drive({ version: 'v3', auth });

  console.log(`Seeding fixtures for ${alias} (${account.email})`);

  const folder = await findOrCreateFolder(drive, FIXTURE_FOLDER_NAME);
  console.log(`  folder    ${folder.created ? 'created' : 'reused '}  ${folder.id}`);

  const fixtures: FixtureSet = { folderId: folder.id };

  // Doc + comment
  let docId = await findChildByName(drive, folder.id, CONTRACT_DOC_NAME);
  if (docId) {
    console.log(`  doc       reused   ${docId}`);
  } else {
    docId = await createNativeDoc(drive, folder.id, CONTRACT_DOC_NAME, CONTRACT_DOC_TEXT);
    console.log(`  doc       created  ${docId}`);

    const commentId = await seedAnchoredComment(
      drive,
      docId,
      QUOTED_SENTENCE,
      'Cap this at fees paid in the preceding 12 months.',
    );
    const quoted = await readBackQuotedText(drive, docId, commentId);
    fixtures.anchoredCommentSupported = quoted === QUOTED_SENTENCE;

    console.log(
      fixtures.anchoredCommentSupported
        ? '  comment   created  anchored, quotedText confirmed'
        : '  comment   created  UNANCHORED — quotedText not returned by Drive',
    );
  }
  fixtures.contractDocId = docId;

  // Sheet
  const existingSheet = await findChildByName(drive, folder.id, SHEET_NAME);
  fixtures.sheetId =
    existingSheet ?? (await createNativeSheet(drive, folder.id, SHEET_NAME, SHEET_CSV));
  console.log(`  sheet     ${existingSheet ? 'reused ' : 'created'}  ${fixtures.sheetId}`);

  // Drawing — may legitimately fail
  const existingDrawing = await findChildByName(drive, folder.id, DRAWING_NAME);
  const drawingId = existingDrawing ?? (await tryCreateDrawing(drive, folder.id, DRAWING_NAME));
  if (drawingId) {
    fixtures.drawingId = drawingId;
    console.log(`  drawing   ${existingDrawing ? 'reused ' : 'created'}  ${drawingId}`);
  } else {
    console.log('  drawing   FAILED   create one by hand in the fixtures folder:');
    console.log('            Drive > New > More > Google Drawings, then re-run this script.');
  }

  config.fixtures[alias] = fixtures;
  saveE2eConfig(config);
  console.log('\nWrote e2e.config.json');

  if (fixtures.anchoredCommentSupported === false) {
    console.log('\nACTION NEEDED: open the fixture Doc, highlight the sentence containing');
    console.log(`"${QUOTED_SENTENCE}", and add a comment by hand. The suite needs one`);
    console.log('anchored comment to assert quotedText against.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script**

In `package.json` `"scripts"`:

```json
"e2e:seed": "tsx scripts/e2e/seed-fixtures.ts",
```

- [ ] **Step 3: Typecheck and lint before touching a real account**

Run: `pnpm typecheck:e2e && pnpm biome check scripts/e2e`
Expected: both exit 0. Do not run against Drive until this is clean.

- [ ] **Step 4: Run it for real — this is the spike**

Run: `pnpm e2e:seed Procedure`

Expected: a new folder `__MCP-E2E-FIXTURES — DO NOT DELETE__` in Procedure's My Drive containing a Doc, a Sheet, and probably a Drawing. Record two things from the output:

1. Did `comment` report `quotedText confirmed` or `UNANCHORED`? — **spike 1**
2. Did `drawing` report an ID or `FAILED`? — **spike 2**

- [ ] **Step 5: Verify idempotency**

Run: `pnpm e2e:seed Procedure` a second time.
Expected: every line reads `reused`, no duplicates appear in Drive, and `e2e.config.json` is unchanged apart from formatting.

- [ ] **Step 6: Record the spike outcomes in the spec**

Replace the "Known unknowns, to resolve by spike during implementation" section of `docs/superpowers/specs/2026-08-10-mcp-e2e-test-harness-design.md` with what actually happened — for each spike, state the observed result and, if it failed, the manual step now required and what stage 2 can therefore assert. Do not leave the section reading as unresolved once it is resolved.

- [ ] **Step 7: Confirm the full suite is green, then commit**

```bash
pnpm test
git add scripts/e2e/seed-fixtures.ts package.json docs/superpowers/specs/2026-08-10-mcp-e2e-test-harness-design.md
git commit -m "feat(e2e): add idempotent fixture seeder and record spike outcomes"
```

Do **not** commit `e2e.config.json` — Task 1 gitignored it. Verify with `git status --short` that it does not appear.

---

## Stage 1 Done When

- `pnpm e2e:seed Procedure` is idempotent and populates `e2e.config.json`.
- The fixtures folder exists in Drive with an obviously off-limits name.
- Both spikes have recorded outcomes in the spec, with manual fallbacks written down where the API refused.
- `pnpm test`, `pnpm typecheck`, `pnpm typecheck:e2e` and `pnpm biome check scripts/e2e` all pass.
- `git status --short` shows no `e2e.config.json` and no `.e2e/`.

Stage 2 (sandbox + scripted tool sweep) and stage 3 (skill + MCP smoke layer) each get their own plan.
