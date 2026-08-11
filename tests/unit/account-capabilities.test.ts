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

  // mail:modify implies both mail:read and mail:compose: both users.drafts.create
  // and users.messages.send accept gmail.modify as a scope. Requesting mail:modify
  // must not report mail:read (or mail:compose) as being removed, since
  // scopesFor(['mail:modify']) grants gmail.modify, from which both are derived.
  it('does not flag mail:read as removed when re-requesting mail:modify', () => {
    const removed = capabilitiesRemovedBy([GMAIL_MODIFY, GMAIL_LABELS], ['mail:modify']);

    expect(removed).toEqual([]);
  });

  it('flags both mail:modify and mail:compose as removed when narrowing to mail:read alone', () => {
    const removed = capabilitiesRemovedBy([GMAIL_MODIFY, GMAIL_LABELS], ['mail:read']);

    expect([...removed].sort()).toEqual(['mail:compose', 'mail:modify']);
  });
});
