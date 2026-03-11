import { describe, expect, it } from 'vitest';
import {
  getScopeTier,
  hasSufficientScope,
  mergeScopeTiers,
  OPERATION_SCOPE_REQUIREMENTS,
  SCOPE_TIERS,
} from '../../src/types/index.js';

describe('Scope Validation', () => {
  describe('getScopeTier', () => {
    it('returns mail_readonly for mail_readonly scopes', () => {
      const scopes = SCOPE_TIERS.mail_readonly;
      expect(getScopeTier([...scopes])).toBe('mail_readonly');
    });

    it('returns mail_compose for mail_compose scopes', () => {
      const scopes = SCOPE_TIERS.mail_compose;
      expect(getScopeTier([...scopes])).toBe('mail_compose');
    });

    it('returns mail_full for mail_full scopes', () => {
      const scopes = SCOPE_TIERS.mail_full;
      expect(getScopeTier([...scopes])).toBe('mail_full');
    });

    it('returns mail_full when gmail.modify is present', () => {
      const scopes = ['https://www.googleapis.com/auth/gmail.modify'];
      expect(getScopeTier(scopes)).toBe('mail_full');
    });

    it('returns mail_full when gmail.labels is present', () => {
      const scopes = ['https://www.googleapis.com/auth/gmail.labels'];
      expect(getScopeTier(scopes)).toBe('mail_full');
    });

    it('returns mail_compose when gmail.compose is present without modify/labels', () => {
      const scopes = [
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.readonly',
      ];
      expect(getScopeTier(scopes)).toBe('mail_compose');
    });

    it('returns mail_readonly for empty scopes', () => {
      expect(getScopeTier([])).toBe('mail_readonly');
    });

    it('returns mail_readonly for unknown scopes', () => {
      const scopes = ['https://www.googleapis.com/auth/userinfo.email'];
      expect(getScopeTier(scopes)).toBe('mail_readonly');
    });

    it('returns mail_settings when gmail.settings.basic is present', () => {
      const scopes = SCOPE_TIERS.mail_settings;
      expect(getScopeTier([...scopes])).toBe('mail_settings');
    });

    it('returns mail_settings for gmail.settings.basic scope alone', () => {
      const scopes = ['https://www.googleapis.com/auth/gmail.settings.basic'];
      expect(getScopeTier(scopes)).toBe('mail_settings');
    });

    it('returns all when both mail_full (modify/labels) and mail_settings are present', () => {
      const scopes = [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.settings.basic',
      ];
      expect(getScopeTier(scopes)).toBe('all');
    });

    it('returns all for all scope tier', () => {
      const scopes = SCOPE_TIERS.all;
      expect(getScopeTier([...scopes])).toBe('all');
    });

    it('returns drive_readonly for drive.readonly scope', () => {
      const scopes = SCOPE_TIERS.drive_readonly;
      expect(getScopeTier([...scopes])).toBe('drive_readonly');
    });

    it('returns drive_full for drive.file scope', () => {
      const scopes = SCOPE_TIERS.drive_full;
      expect(getScopeTier([...scopes])).toBe('drive_full');
    });

    it('returns calendar_readonly for calendar.readonly scope', () => {
      const scopes = SCOPE_TIERS.calendar_readonly;
      expect(getScopeTier([...scopes])).toBe('calendar_readonly');
    });

    it('returns calendar_full for calendar.events scope', () => {
      const scopes = SCOPE_TIERS.calendar_full;
      expect(getScopeTier([...scopes])).toBe('calendar_full');
    });
  });

  describe('hasSufficientScope', () => {
    it('mail_readonly tier satisfies mail_readonly requirement', () => {
      const scopes = SCOPE_TIERS.mail_readonly;
      expect(hasSufficientScope([...scopes], 'mail_readonly')).toBe(true);
    });

    it('mail_readonly tier does not satisfy mail_compose requirement', () => {
      const scopes = SCOPE_TIERS.mail_readonly;
      expect(hasSufficientScope([...scopes], 'mail_compose')).toBe(false);
    });

    it('mail_readonly tier does not satisfy mail_full requirement', () => {
      const scopes = SCOPE_TIERS.mail_readonly;
      expect(hasSufficientScope([...scopes], 'mail_full')).toBe(false);
    });

    it('mail_compose tier satisfies mail_readonly requirement', () => {
      const scopes = SCOPE_TIERS.mail_compose;
      expect(hasSufficientScope([...scopes], 'mail_readonly')).toBe(true);
    });

    it('mail_compose tier satisfies mail_compose requirement', () => {
      const scopes = SCOPE_TIERS.mail_compose;
      expect(hasSufficientScope([...scopes], 'mail_compose')).toBe(true);
    });

    it('mail_compose tier does not satisfy mail_full requirement', () => {
      const scopes = SCOPE_TIERS.mail_compose;
      expect(hasSufficientScope([...scopes], 'mail_full')).toBe(false);
    });

    // mail_full and mail_compose are independent: mail_full does NOT have
    // gmail.compose or gmail.readonly, so it cannot satisfy mail_compose.
    // mail_compose does NOT have gmail.modify or gmail.labels, so it cannot satisfy mail_full.
    it('mail_full tier satisfies mail_full requirement', () => {
      const scopes = SCOPE_TIERS.mail_full;
      expect(hasSufficientScope([...scopes], 'mail_full')).toBe(true);
    });

    it('mail_full tier does not satisfy mail_compose requirement (independent branches)', () => {
      const scopes = SCOPE_TIERS.mail_full;
      expect(hasSufficientScope([...scopes], 'mail_compose')).toBe(false);
    });

    it('mail_full tier does not satisfy mail_readonly requirement (no gmail.readonly URL)', () => {
      const scopes = SCOPE_TIERS.mail_full;
      expect(hasSufficientScope([...scopes], 'mail_readonly')).toBe(false);
    });

    it('mail_full tier does not satisfy mail_settings requirement', () => {
      const scopes = SCOPE_TIERS.mail_full;
      expect(hasSufficientScope([...scopes], 'mail_settings')).toBe(false);
    });

    // Settings tier tests (parallel branch)
    it('mail_settings tier satisfies mail_readonly requirement', () => {
      const scopes = SCOPE_TIERS.mail_settings;
      expect(hasSufficientScope([...scopes], 'mail_readonly')).toBe(true);
    });

    it('mail_settings tier satisfies mail_settings requirement', () => {
      const scopes = SCOPE_TIERS.mail_settings;
      expect(hasSufficientScope([...scopes], 'mail_settings')).toBe(true);
    });

    it('mail_settings tier does not satisfy mail_compose requirement', () => {
      const scopes = SCOPE_TIERS.mail_settings;
      expect(hasSufficientScope([...scopes], 'mail_compose')).toBe(false);
    });

    it('mail_settings tier does not satisfy mail_full requirement', () => {
      const scopes = SCOPE_TIERS.mail_settings;
      expect(hasSufficientScope([...scopes], 'mail_full')).toBe(false);
    });

    it('mail_compose tier does not satisfy mail_settings requirement', () => {
      const scopes = SCOPE_TIERS.mail_compose;
      expect(hasSufficientScope([...scopes], 'mail_settings')).toBe(false);
    });

    it('mail_readonly tier does not satisfy mail_settings requirement', () => {
      const scopes = SCOPE_TIERS.mail_readonly;
      expect(hasSufficientScope([...scopes], 'mail_settings')).toBe(false);
    });

    // 'all' tier tests
    // Note: the 'all' tier does NOT include gmail.readonly URL, so it cannot
    // satisfy mail_compose or mail_settings (which require gmail.readonly).
    // It does satisfy mail_full (gmail.modify + gmail.labels + userinfo.email).
    it('all tier satisfies mail_full and all requirements', () => {
      const scopes = SCOPE_TIERS.all;
      expect(hasSufficientScope([...scopes], 'mail_full')).toBe(true);
      expect(hasSufficientScope([...scopes], 'all')).toBe(true);
    });

    it('all tier does not satisfy mail_compose (missing gmail.readonly URL)', () => {
      const scopes = SCOPE_TIERS.all;
      expect(hasSufficientScope([...scopes], 'mail_compose')).toBe(false);
    });

    it('all tier does not satisfy mail_settings (missing gmail.readonly URL)', () => {
      const scopes = SCOPE_TIERS.all;
      expect(hasSufficientScope([...scopes], 'mail_settings')).toBe(false);
    });

    it('all tier satisfies drive and calendar requirements', () => {
      const scopes = SCOPE_TIERS.all;
      expect(hasSufficientScope([...scopes], 'drive_readonly')).toBe(true);
      expect(hasSufficientScope([...scopes], 'drive_full')).toBe(true);
      expect(hasSufficientScope([...scopes], 'calendar_readonly')).toBe(true);
      expect(hasSufficientScope([...scopes], 'calendar_full')).toBe(true);
    });

    it('mail_full tier does not satisfy all requirement', () => {
      const scopes = SCOPE_TIERS.mail_full;
      expect(hasSufficientScope([...scopes], 'all')).toBe(false);
    });

    it('mail_settings tier does not satisfy all requirement', () => {
      const scopes = SCOPE_TIERS.mail_settings;
      expect(hasSufficientScope([...scopes], 'all')).toBe(false);
    });
  });

  describe('Drive scope tiers', () => {
    it('drive_readonly tier has drive.readonly scope', () => {
      expect(SCOPE_TIERS.drive_readonly).toContain('https://www.googleapis.com/auth/drive.readonly');
    });
    it('drive_full tier has drive.file scope', () => {
      expect(SCOPE_TIERS.drive_full).toContain('https://www.googleapis.com/auth/drive.file');
    });
    it('drive_readonly account satisfies drive_readonly requirement', () => {
      expect(hasSufficientScope([...SCOPE_TIERS.drive_readonly], 'drive_readonly')).toBe(true);
    });
    it('drive_readonly account does not satisfy drive_full requirement', () => {
      expect(hasSufficientScope([...SCOPE_TIERS.drive_readonly], 'drive_full')).toBe(false);
    });
    it('drive_full account does not satisfy mail_readonly requirement', () => {
      expect(hasSufficientScope([...SCOPE_TIERS.drive_full], 'mail_readonly')).toBe(false);
    });
  });

  describe('Calendar scope tiers', () => {
    it('calendar_readonly tier has calendar.readonly scope', () => {
      expect(SCOPE_TIERS.calendar_readonly).toContain('https://www.googleapis.com/auth/calendar.readonly');
    });
    it('calendar_full tier has calendar.events scope', () => {
      expect(SCOPE_TIERS.calendar_full).toContain('https://www.googleapis.com/auth/calendar.events');
    });
    it('calendar_readonly satisfies calendar_readonly', () => {
      expect(hasSufficientScope([...SCOPE_TIERS.calendar_readonly], 'calendar_readonly')).toBe(true);
    });
    it('calendar_readonly does not satisfy calendar_full', () => {
      expect(hasSufficientScope([...SCOPE_TIERS.calendar_readonly], 'calendar_full')).toBe(false);
    });
  });

  describe('Cross-service isolation', () => {
    it('mail_full does not satisfy drive_readonly', () => {
      expect(hasSufficientScope([...SCOPE_TIERS.mail_full], 'drive_readonly')).toBe(false);
    });
    it('drive_full does not satisfy calendar_readonly', () => {
      expect(hasSufficientScope([...SCOPE_TIERS.drive_full], 'calendar_readonly')).toBe(false);
    });
    it('merged tiers satisfy both', () => {
      const scopes = mergeScopeTiers(['mail_full', 'drive_readonly']);
      expect(hasSufficientScope(scopes, 'mail_full')).toBe(true);
      expect(hasSufficientScope(scopes, 'drive_readonly')).toBe(true);
      expect(hasSufficientScope(scopes, 'calendar_readonly')).toBe(false);
    });
  });

  describe('OPERATION_SCOPE_REQUIREMENTS', () => {
    it('read operations require mail_readonly scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.search).toBe('mail_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.getMessage).toBe('mail_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.getThread).toBe('mail_readonly');
    });

    it('compose operations require mail_compose scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.createDraft).toBe('mail_compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.updateDraft).toBe('mail_compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.getDraft).toBe('mail_compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.sendDraft).toBe('mail_compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.deleteDraft).toBe('mail_compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.replyToThread).toBe('mail_compose');
    });

    it('modify operations require mail_full scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.listLabels).toBe('mail_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.modifyLabels).toBe('mail_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.markReadUnread).toBe('mail_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.archive).toBe('mail_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.trash).toBe('mail_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.untrash).toBe('mail_full');
    });

    it('settings operations require mail_settings scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.listFilters).toBe('mail_settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.createFilter).toBe('mail_settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.deleteFilter).toBe('mail_settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.getVacation).toBe('mail_settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.setVacation).toBe('mail_settings');
    });

    it('drive read operations require drive_readonly scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.driveSearch).toBe('drive_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveListFiles).toBe('drive_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveGetFile).toBe('drive_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveGetContent).toBe('drive_readonly');
    });

    it('drive write operations require drive_full scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.driveUpload).toBe('drive_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveCreateFolder).toBe('drive_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveMoveFile).toBe('drive_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveCopyFile).toBe('drive_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveRenameFile).toBe('drive_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveTrashFile).toBe('drive_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveShareFile).toBe('drive_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.driveUpdatePermissions).toBe('drive_full');
    });

    it('calendar read operations require calendar_readonly scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarListCalendars).toBe('calendar_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarListEvents).toBe('calendar_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarGetEvent).toBe('calendar_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarSearchEvents).toBe('calendar_readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarFreeBusy).toBe('calendar_readonly');
    });

    it('calendar write operations require calendar_full scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarCreateEvent).toBe('calendar_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarUpdateEvent).toBe('calendar_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarDeleteEvent).toBe('calendar_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarRsvp).toBe('calendar_full');
      expect(OPERATION_SCOPE_REQUIREMENTS.calendarMoveEvent).toBe('calendar_full');
    });
  });

  describe('SCOPE_TIERS', () => {
    it('mail_readonly tier has gmail.readonly', () => {
      expect(SCOPE_TIERS.mail_readonly).toContain(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
    });

    it('mail_compose tier has gmail.compose and gmail.readonly', () => {
      expect(SCOPE_TIERS.mail_compose).toContain(
        'https://www.googleapis.com/auth/gmail.compose',
      );
      expect(SCOPE_TIERS.mail_compose).toContain(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
    });

    it('mail_full tier has gmail.modify and gmail.labels', () => {
      expect(SCOPE_TIERS.mail_full).toContain(
        'https://www.googleapis.com/auth/gmail.modify',
      );
      expect(SCOPE_TIERS.mail_full).toContain(
        'https://www.googleapis.com/auth/gmail.labels',
      );
    });

    it('all mail tiers include userinfo.email', () => {
      const emailScope = 'https://www.googleapis.com/auth/userinfo.email';
      expect(SCOPE_TIERS.mail_readonly).toContain(emailScope);
      expect(SCOPE_TIERS.mail_compose).toContain(emailScope);
      expect(SCOPE_TIERS.mail_full).toContain(emailScope);
      expect(SCOPE_TIERS.mail_settings).toContain(emailScope);
      expect(SCOPE_TIERS.all).toContain(emailScope);
    });

    it('drive and calendar tiers include userinfo.email', () => {
      const emailScope = 'https://www.googleapis.com/auth/userinfo.email';
      expect(SCOPE_TIERS.drive_readonly).toContain(emailScope);
      expect(SCOPE_TIERS.drive_full).toContain(emailScope);
      expect(SCOPE_TIERS.calendar_readonly).toContain(emailScope);
      expect(SCOPE_TIERS.calendar_full).toContain(emailScope);
    });

    it('all tier has mail modify, labels, settings, compose, drive, and calendar scopes', () => {
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/gmail.modify',
      );
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/gmail.labels',
      );
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/gmail.settings.basic',
      );
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/gmail.compose',
      );
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/drive.readonly',
      );
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/drive.file',
      );
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/calendar.readonly',
      );
      expect(SCOPE_TIERS.all).toContain(
        'https://www.googleapis.com/auth/calendar.events',
      );
    });

    it('mail_settings tier has gmail.settings.basic and gmail.readonly', () => {
      expect(SCOPE_TIERS.mail_settings).toContain(
        'https://www.googleapis.com/auth/gmail.settings.basic',
      );
      expect(SCOPE_TIERS.mail_settings).toContain(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
    });
  });

  describe('mergeScopeTiers', () => {
    it('merges a single tier', () => {
      const scopes = mergeScopeTiers(['mail_readonly']);
      expect(scopes).toEqual(expect.arrayContaining([...SCOPE_TIERS.mail_readonly]));
      expect(scopes.length).toBe(SCOPE_TIERS.mail_readonly.length);
    });

    it('merges two independent mail tiers (mail_full + mail_settings)', () => {
      const scopes = mergeScopeTiers(['mail_full', 'mail_settings']);
      // Should include all scopes from both tiers, deduplicated
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.labels');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.settings.basic');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
    });

    it('merging mail_full + mail_settings is detected as all tier by getScopeTier', () => {
      const scopes = mergeScopeTiers(['mail_full', 'mail_settings']);
      expect(getScopeTier(scopes)).toBe('all');
    });

    it('deduplicates overlapping scopes', () => {
      const scopes = mergeScopeTiers(['mail_readonly', 'mail_compose']);
      // Both have gmail.readonly and userinfo.email, so no duplicates
      const readonlyCount = scopes.filter(
        (s) => s === 'https://www.googleapis.com/auth/gmail.readonly',
      ).length;
      expect(readonlyCount).toBe(1);
    });

    it('merges empty array to empty result', () => {
      const scopes = mergeScopeTiers([]);
      expect(scopes).toEqual([]);
    });

    it('merges cross-service tiers (mail_full + drive_readonly)', () => {
      const scopes = mergeScopeTiers(['mail_full', 'drive_readonly']);
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.labels');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
      // Should not contain calendar scopes
      expect(scopes).not.toContain('https://www.googleapis.com/auth/calendar.readonly');
    });

    it('merges three services (mail + drive + calendar)', () => {
      const scopes = mergeScopeTiers(['mail_readonly', 'drive_readonly', 'calendar_readonly']);
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
      // userinfo.email should be deduplicated
      const emailCount = scopes.filter(
        (s) => s === 'https://www.googleapis.com/auth/userinfo.email',
      ).length;
      expect(emailCount).toBe(1);
    });

    it('merging all mail + drive + calendar tiers includes all tier capabilities', () => {
      const merged = mergeScopeTiers([
        'mail_compose', 'mail_full', 'mail_settings',
        'drive_readonly', 'drive_full',
        'calendar_readonly', 'calendar_full',
      ]);
      // Should include all scopes from 'all' tier
      for (const scope of SCOPE_TIERS.all) {
        expect(merged).toContain(scope);
      }
      expect(getScopeTier(merged)).toBe('all');
    });
  });
});
