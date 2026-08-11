import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  type Capability,
  capabilitiesOf,
  hasAnyCapability,
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

  // calendar.events authorizes neither calendarList.list nor freebusy.query,
  // so it must NOT imply calendar:read. The old model claimed it did.
  it('does NOT derive calendar:read from calendar.events', () => {
    expect(capabilitiesOf([CAL_EVENTS])).toEqual(['calendar:write']);
  });

  it('does NOT derive calendar:write from calendar.readonly', () => {
    expect(capabilitiesOf([CAL_READONLY])).toEqual(['calendar:read']);
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
      GMAIL_MODIFY,
      GMAIL_LABELS,
      GMAIL_COMPOSE,
      'https://www.googleapis.com/auth/gmail.settings.basic',
      DRIVE_READONLY,
      DRIVE_FILE,
      CAL_READONLY,
      CAL_EVENTS,
      EMAIL,
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

describe('hasAnyCapability', () => {
  // Reading calendar events is authorized by either calendar scope.
  it('accepts an account holding only calendar:write for an event read', () => {
    expect(hasAnyCapability([CAL_EVENTS], ['calendar:read', 'calendar:write'])).toBe(true);
  });

  it('accepts an account holding only calendar:read for an event read', () => {
    expect(hasAnyCapability([CAL_READONLY], ['calendar:read', 'calendar:write'])).toBe(true);
  });

  it('rejects an account holding neither', () => {
    expect(hasAnyCapability([DRIVE_FILE], ['calendar:read', 'calendar:write'])).toBe(false);
  });

  it('rejects an empty requirement list', () => {
    expect(hasAnyCapability([CAL_EVENTS], [])).toBe(false);
  });
});
