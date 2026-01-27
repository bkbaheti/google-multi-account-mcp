import { describe, expect, it } from 'vitest';
import {
  getScopeTier,
  hasSufficientScope,
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

    it('full tier satisfies all requirements', () => {
      const scopes = SCOPE_TIERS.full;
      expect(hasSufficientScope([...scopes], 'readonly')).toBe(true);
      expect(hasSufficientScope([...scopes], 'compose')).toBe(true);
      expect(hasSufficientScope([...scopes], 'full')).toBe(true);
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
    });
  });
});
