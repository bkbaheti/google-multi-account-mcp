import { describe, expect, it } from 'vitest';
import {
  checkAccount,
  formatPreflight,
  REQUIRED_CAPABILITIES,
} from '../../scripts/e2e/preflight.js';

const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const EMAIL = 'https://www.googleapis.com/auth/userinfo.email';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const GMAIL_LABELS = 'https://www.googleapis.com/auth/gmail.labels';

// Personal's exact granted scopes, per the e2e fixture account.
const PERSONAL_SCOPES = [DRIVE_FILE, EMAIL];

describe('e2e preflight', () => {
  it('marks a group ok when the account holds the required capability', () => {
    const results = checkAccount(
      'Procedure',
      [DRIVE_READONLY, EMAIL],
      [
        {
          group: 'drive-read',
          requires: { accept: ['drive:read', 'drive:appfiles'], remedy: 'drive:appfiles' },
        },
      ],
    );

    expect(results).toEqual([{ account: 'Procedure', group: 'drive-read', status: 'ok' }]);
  });

  it('marks a group skip — never fail — when the capability is missing', () => {
    const results = checkAccount('Personal', PERSONAL_SCOPES, [
      { group: 'drive-shared-drives', requires: 'drive:read' },
    ]);

    expect(results[0]?.status).toBe('skip');
    expect(results.some((r) => r.status === ('fail' as string))).toBe(false);
  });

  it('names the missing capability in the skip reason', () => {
    const results = checkAccount('Personal', PERSONAL_SCOPES, [
      { group: 'drive-shared-drives', requires: 'drive:read' },
    ]);

    expect(results[0]?.reason).toContain('drive:read');
  });

  it('satisfies a gate requirement via either member — appfiles alone passes drive-read', () => {
    const results = checkAccount(
      'Personal',
      [DRIVE_FILE, EMAIL],
      [
        {
          group: 'drive-read',
          requires: { accept: ['drive:read', 'drive:appfiles'], remedy: 'drive:appfiles' },
        },
      ],
    );

    expect(results[0]?.status).toBe('ok');
  });

  it("matches Personal's corrected behaviour: skip drive-shared-drives, ok drive-read and drive-comments", () => {
    const results = checkAccount('Personal', PERSONAL_SCOPES, REQUIRED_CAPABILITIES);
    const byGroup = new Map(results.map((r) => [r.group, r]));

    expect(byGroup.get('drive-shared-drives')?.status).toBe('skip');
    expect(byGroup.get('drive-read')?.status).toBe('ok');
    expect(byGroup.get('drive-comments')?.status).toBe('ok');
  });

  it('honours the mail:modify implication so it satisfies both mail-read and mail-compose', () => {
    const results = checkAccount(
      'Personal',
      [GMAIL_MODIFY, GMAIL_LABELS, EMAIL],
      [
        { group: 'mail-read', requires: 'mail:read' },
        { group: 'mail-compose', requires: 'mail:compose' },
      ],
    );

    expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('checks every requirement, not just the first failing one', () => {
    const results = checkAccount('Personal', PERSONAL_SCOPES, [
      { group: 'drive-shared-drives', requires: 'drive:read' },
      { group: 'drive-write', requires: 'drive:appfiles' },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status)).toEqual(['skip', 'ok']);
  });

  it('renders a summary naming each skipped group and its reason', () => {
    const output = formatPreflight([
      { account: 'Procedure', group: 'drive-comments', status: 'ok' },
      {
        account: 'Personal',
        group: 'drive-shared-drives',
        status: 'skip',
        reason: 'needs drive:read — re-authorize with google_reauth_account',
      },
    ]);

    expect(output).toContain('Personal');
    expect(output).toContain('drive-shared-drives');
    expect(output).toContain('needs drive:read');
  });

  describe('REQUIRED_CAPABILITIES', () => {
    it('mirrors the real gates for every group', () => {
      const byGroup = new Map(REQUIRED_CAPABILITIES.map((r) => [r.group, r.requires]));

      expect(byGroup.get('mail-read')).toBe('mail:read');
      expect(byGroup.get('mail-compose')).toBe('mail:compose');
      expect(byGroup.get('mail-modify')).toBe('mail:modify');
      expect(byGroup.get('mail-settings')).toBe('mail:settings');
      expect(byGroup.get('drive-read')).toEqual({
        accept: ['drive:read', 'drive:appfiles'],
        remedy: 'drive:appfiles',
        escalation: 'drive:read',
      });
      expect(byGroup.get('drive-comments')).toEqual({
        accept: ['drive:read', 'drive:appfiles'],
        remedy: 'drive:appfiles',
        escalation: 'drive:read',
      });
      expect(byGroup.get('drive-shared-drives')).toBe('drive:read');
      expect(byGroup.get('drive-write')).toBe('drive:appfiles');
      expect(byGroup.get('calendar-read')).toBe('calendar:read');
      expect(byGroup.get('calendar-events-read')).toEqual({
        accept: ['calendar:read', 'calendar:write'],
        remedy: 'calendar:read',
      });
      expect(byGroup.get('calendar-write')).toBe('calendar:write');
    });
  });
});
