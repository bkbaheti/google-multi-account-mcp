import { describe, expect, it } from 'vitest';
import { capabilitiesRemovedBy } from '../../src/auth/account-store.js';

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const GMAIL_LABELS = 'https://www.googleapis.com/auth/gmail.labels';
const CAL_EVENTS = 'https://www.googleapis.com/auth/calendar.events';

describe('capabilitiesRemovedBy', () => {
  it('reports nothing removed when the request is a superset', () => {
    const removed = capabilitiesRemovedBy([DRIVE_FILE], ['drive:appfiles', 'drive:read']);

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
