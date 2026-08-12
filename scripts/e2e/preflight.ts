import type { Capability, CapabilityGate } from '../../src/auth/capabilities.js';
import { hasAnyCapability, hasCapability, normalizeGate } from '../../src/auth/capabilities.js';

/** Which capability (or gate) a group of e2e tests needs to run at all. */
export interface GroupRequirement {
  group: string;
  requires: Capability | CapabilityGate;
}

export interface PreflightResult {
  account: string;
  group: string;
  status: 'ok' | 'skip';
  reason?: string;
}

/**
 * Which capability each e2e test group needs, mirroring the real tool gates
 * in src/server/drive-tools.ts and src/server/calendar-tools.ts — not
 * reimplemented satisfaction logic, just the same requirement restated per
 * group so a spec drift between the two would show up as a failing test here.
 *
 * drive-read and drive-comments accept either drive:read or drive:appfiles:
 * files.get, files.list, files.export, comments.list and replies.list all
 * authorize drive.file, so an app-created-files-only account can still run
 * them. drive-shared-drives stays on bare drive:read — drives.list rejects
 * drive.file, so it's the one Drive read group that did not loosen.
 * calendar-read stays on bare calendar:read — calendarList.list and
 * freebusy.query reject calendar.events. calendar-events-read accepts
 * either calendar capability, mirroring events.list/events.get.
 */
export const REQUIRED_CAPABILITIES: GroupRequirement[] = [
  { group: 'mail-read', requires: 'mail:read' },
  { group: 'mail-compose', requires: 'mail:compose' },
  { group: 'mail-modify', requires: 'mail:modify' },
  { group: 'mail-settings', requires: 'mail:settings' },
  {
    group: 'drive-read',
    requires: {
      accept: ['drive:read', 'drive:appfiles'],
      remedy: 'drive:appfiles',
      escalation: 'drive:read',
    },
  },
  {
    group: 'drive-comments',
    requires: {
      accept: ['drive:read', 'drive:appfiles'],
      remedy: 'drive:appfiles',
      escalation: 'drive:read',
    },
  },
  { group: 'drive-shared-drives', requires: 'drive:read' },
  { group: 'drive-write', requires: 'drive:appfiles' },
  { group: 'calendar-read', requires: 'calendar:read' },
  {
    group: 'calendar-events-read',
    requires: { accept: ['calendar:read', 'calendar:write'], remedy: 'calendar:read' },
  },
  { group: 'calendar-write', requires: 'calendar:write' },
];

/**
 * Check which test groups an account's granted scopes can run. A missing
 * capability always yields `skip`, never `fail` — this is a preflight, not a
 * test outcome, and "could not test this" must never be mistaken for "this
 * is broken" in a report.
 */
export function checkAccount(
  alias: string,
  scopes: string[],
  requirements: GroupRequirement[] = REQUIRED_CAPABILITIES,
): PreflightResult[] {
  return requirements.map(({ group, requires }) => {
    const satisfied =
      typeof requires === 'string'
        ? hasCapability(scopes, requires)
        : hasAnyCapability(scopes, requires.accept);

    if (satisfied) {
      return { account: alias, group, status: 'ok' };
    }

    const remedy = normalizeGate(requires).remedy;

    return {
      account: alias,
      group,
      status: 'skip',
      reason: `needs ${remedy} — re-authorize with google_reauth_account`,
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
