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
    it('returns readonly for readonly scopes', () => {
      const scopes = SCOPE_TIERS.readonly;
      expect(getScopeTier([...scopes])).toBe('readonly');
    });

    it('returns compose for compose scopes', () => {
      const scopes = SCOPE_TIERS.compose;
      expect(getScopeTier([...scopes])).toBe('compose');
    });

    it('returns full for full scopes', () => {
      const scopes = SCOPE_TIERS.full;
      expect(getScopeTier([...scopes])).toBe('full');
    });

    it('returns full when gmail.modify is present', () => {
      const scopes = ['https://www.googleapis.com/auth/gmail.modify'];
      expect(getScopeTier(scopes)).toBe('full');
    });

    it('returns full when gmail.labels is present', () => {
      const scopes = ['https://www.googleapis.com/auth/gmail.labels'];
      expect(getScopeTier(scopes)).toBe('full');
    });

    it('returns compose when gmail.compose is present without modify/labels', () => {
      const scopes = [
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.readonly',
      ];
      expect(getScopeTier(scopes)).toBe('compose');
    });

    it('returns readonly for empty scopes', () => {
      expect(getScopeTier([])).toBe('readonly');
    });

    it('returns readonly for unknown scopes', () => {
      const scopes = ['https://www.googleapis.com/auth/userinfo.email'];
      expect(getScopeTier(scopes)).toBe('readonly');
    });

    it('returns settings when gmail.settings.basic is present', () => {
      const scopes = SCOPE_TIERS.settings;
      expect(getScopeTier([...scopes])).toBe('settings');
    });

    it('returns settings for gmail.settings.basic scope alone', () => {
      const scopes = ['https://www.googleapis.com/auth/gmail.settings.basic'];
      expect(getScopeTier(scopes)).toBe('settings');
    });

    it('returns all when both full (modify/labels) and settings are present', () => {
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
  });

  describe('hasSufficientScope', () => {
    it('readonly tier satisfies readonly requirement', () => {
      const scopes = SCOPE_TIERS.readonly;
      expect(hasSufficientScope([...scopes], 'readonly')).toBe(true);
    });

    it('readonly tier does not satisfy compose requirement', () => {
      const scopes = SCOPE_TIERS.readonly;
      expect(hasSufficientScope([...scopes], 'compose')).toBe(false);
    });

    it('readonly tier does not satisfy full requirement', () => {
      const scopes = SCOPE_TIERS.readonly;
      expect(hasSufficientScope([...scopes], 'full')).toBe(false);
    });

    it('compose tier satisfies readonly requirement', () => {
      const scopes = SCOPE_TIERS.compose;
      expect(hasSufficientScope([...scopes], 'readonly')).toBe(true);
    });

    it('compose tier satisfies compose requirement', () => {
      const scopes = SCOPE_TIERS.compose;
      expect(hasSufficientScope([...scopes], 'compose')).toBe(true);
    });

    it('compose tier does not satisfy full requirement', () => {
      const scopes = SCOPE_TIERS.compose;
      expect(hasSufficientScope([...scopes], 'full')).toBe(false);
    });

    it('full tier satisfies all requirements except settings', () => {
      const scopes = SCOPE_TIERS.full;
      expect(hasSufficientScope([...scopes], 'readonly')).toBe(true);
      expect(hasSufficientScope([...scopes], 'compose')).toBe(true);
      expect(hasSufficientScope([...scopes], 'full')).toBe(true);
      expect(hasSufficientScope([...scopes], 'settings')).toBe(false);
    });

    // Settings tier tests (parallel branch)
    it('settings tier satisfies readonly requirement', () => {
      const scopes = SCOPE_TIERS.settings;
      expect(hasSufficientScope([...scopes], 'readonly')).toBe(true);
    });

    it('settings tier satisfies settings requirement', () => {
      const scopes = SCOPE_TIERS.settings;
      expect(hasSufficientScope([...scopes], 'settings')).toBe(true);
    });

    it('settings tier does not satisfy compose requirement', () => {
      const scopes = SCOPE_TIERS.settings;
      expect(hasSufficientScope([...scopes], 'compose')).toBe(false);
    });

    it('settings tier does not satisfy full requirement', () => {
      const scopes = SCOPE_TIERS.settings;
      expect(hasSufficientScope([...scopes], 'full')).toBe(false);
    });

    it('compose tier does not satisfy settings requirement', () => {
      const scopes = SCOPE_TIERS.compose;
      expect(hasSufficientScope([...scopes], 'settings')).toBe(false);
    });

    it('readonly tier does not satisfy settings requirement', () => {
      const scopes = SCOPE_TIERS.readonly;
      expect(hasSufficientScope([...scopes], 'settings')).toBe(false);
    });

    // 'all' tier tests
    it('all tier satisfies all requirements', () => {
      const scopes = SCOPE_TIERS.all;
      expect(hasSufficientScope([...scopes], 'readonly')).toBe(true);
      expect(hasSufficientScope([...scopes], 'compose')).toBe(true);
      expect(hasSufficientScope([...scopes], 'full')).toBe(true);
      expect(hasSufficientScope([...scopes], 'settings')).toBe(true);
      expect(hasSufficientScope([...scopes], 'all')).toBe(true);
    });

    it('full tier does not satisfy all requirement', () => {
      const scopes = SCOPE_TIERS.full;
      expect(hasSufficientScope([...scopes], 'all')).toBe(false);
    });

    it('settings tier does not satisfy all requirement', () => {
      const scopes = SCOPE_TIERS.settings;
      expect(hasSufficientScope([...scopes], 'all')).toBe(false);
    });
  });

  describe('OPERATION_SCOPE_REQUIREMENTS', () => {
    it('read operations require readonly scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.search).toBe('readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.getMessage).toBe('readonly');
      expect(OPERATION_SCOPE_REQUIREMENTS.getThread).toBe('readonly');
    });

    it('compose operations require compose scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.createDraft).toBe('compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.updateDraft).toBe('compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.getDraft).toBe('compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.sendDraft).toBe('compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.deleteDraft).toBe('compose');
      expect(OPERATION_SCOPE_REQUIREMENTS.replyToThread).toBe('compose');
    });

    it('modify operations require full scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.listLabels).toBe('full');
      expect(OPERATION_SCOPE_REQUIREMENTS.modifyLabels).toBe('full');
      expect(OPERATION_SCOPE_REQUIREMENTS.markReadUnread).toBe('full');
      expect(OPERATION_SCOPE_REQUIREMENTS.archive).toBe('full');
      expect(OPERATION_SCOPE_REQUIREMENTS.trash).toBe('full');
      expect(OPERATION_SCOPE_REQUIREMENTS.untrash).toBe('full');
    });

    it('settings operations require settings scope', () => {
      expect(OPERATION_SCOPE_REQUIREMENTS.listFilters).toBe('settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.createFilter).toBe('settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.deleteFilter).toBe('settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.getVacation).toBe('settings');
      expect(OPERATION_SCOPE_REQUIREMENTS.setVacation).toBe('settings');
    });
  });

  describe('SCOPE_TIERS', () => {
    it('readonly tier has gmail.readonly', () => {
      expect(SCOPE_TIERS.readonly).toContain(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
    });

    it('compose tier has gmail.compose and gmail.readonly', () => {
      expect(SCOPE_TIERS.compose).toContain(
        'https://www.googleapis.com/auth/gmail.compose',
      );
      expect(SCOPE_TIERS.compose).toContain(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
    });

    it('full tier has gmail.modify and gmail.labels', () => {
      expect(SCOPE_TIERS.full).toContain(
        'https://www.googleapis.com/auth/gmail.modify',
      );
      expect(SCOPE_TIERS.full).toContain(
        'https://www.googleapis.com/auth/gmail.labels',
      );
    });

    it('all tiers include userinfo.email', () => {
      const emailScope = 'https://www.googleapis.com/auth/userinfo.email';
      expect(SCOPE_TIERS.readonly).toContain(emailScope);
      expect(SCOPE_TIERS.compose).toContain(emailScope);
      expect(SCOPE_TIERS.full).toContain(emailScope);
      expect(SCOPE_TIERS.settings).toContain(emailScope);
      expect(SCOPE_TIERS.all).toContain(emailScope);
    });

    it('all tier has modify, labels, settings, and compose', () => {
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
    });

    it('settings tier has gmail.settings.basic and gmail.readonly', () => {
      expect(SCOPE_TIERS.settings).toContain(
        'https://www.googleapis.com/auth/gmail.settings.basic',
      );
      expect(SCOPE_TIERS.settings).toContain(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
    });
  });

  describe('mergeScopeTiers', () => {
    it('merges a single tier', () => {
      const scopes = mergeScopeTiers(['readonly']);
      expect(scopes).toEqual(expect.arrayContaining(SCOPE_TIERS.readonly));
      expect(scopes.length).toBe(SCOPE_TIERS.readonly.length);
    });

    it('merges two independent tiers (full + settings)', () => {
      const scopes = mergeScopeTiers(['full', 'settings']);
      // Should include all scopes from both tiers, deduplicated
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.labels');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.settings.basic');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
    });

    it('merging full + settings is detected as all tier', () => {
      const scopes = mergeScopeTiers(['full', 'settings']);
      expect(getScopeTier(scopes)).toBe('all');
    });

    it('deduplicates overlapping scopes', () => {
      const scopes = mergeScopeTiers(['readonly', 'compose']);
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

    it('merging compose + full + settings includes all tier capabilities', () => {
      const merged = mergeScopeTiers(['compose', 'full', 'settings']);
      // Should include all scopes from 'all' tier
      for (const scope of SCOPE_TIERS.all) {
        expect(merged).toContain(scope);
      }
      // May also include gmail.readonly from compose/settings tiers
      // (which is redundant with gmail.modify but not harmful)
      expect(getScopeTier(merged)).toBe('all');
    });
  });
});
