import { describe, expect, it } from 'vitest';
import { insufficientCapability } from '../../src/errors/index.js';

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const GMAIL_LABELS = 'https://www.googleapis.com/auth/gmail.labels';

describe('insufficientCapability', () => {
  it('names the account and the missing capability', () => {
    const message = insufficientCapability('Personal', ['drive:read'], [DRIVE_FILE]).message;

    expect(message).toContain('Personal');
    expect(message).toContain('drive:read');
  });

  it('suggests a remedy that keeps every capability the account already has', () => {
    const message = insufficientCapability(
      'Personal',
      ['drive:read'],
      [DRIVE_FILE, GMAIL_MODIFY, GMAIL_LABELS],
    ).message;

    expect(message).toContain('google_reauth_account');
    expect(message).toContain('drive:appfiles');
    expect(message).toContain('mail:modify');
    expect(message).toContain('drive:read');
  });

  it('lists every missing capability when more than one is absent', () => {
    const message = insufficientCapability(
      'Personal',
      ['drive:read', 'mail:settings'],
      [DRIVE_FILE],
    ).message;

    expect(message).toContain('drive:read');
    expect(message).toContain('mail:settings');
  });
});
