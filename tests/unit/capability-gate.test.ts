import { describe, expect, it } from 'vitest';
import { capabilityGateError, insufficientCapability } from '../../src/errors/index.js';

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

describe('capabilityGateError', () => {
  it('names the account and the remedy capability, and reuses CAPABILITY_INSUFFICIENT', () => {
    const error = capabilityGateError(
      'Personal',
      { accept: ['drive:read'], remedy: 'drive:read' },
      [DRIVE_FILE],
    );

    expect(error.code).toBe('CAPABILITY_INSUFFICIENT');
    expect(error.message).toContain('Personal');
    expect(error.message).toContain('drive:read');
  });

  it('suggests only the remedy, keeping every capability the account already has, when there is no escalation', () => {
    const message = capabilityGateError(
      'Personal',
      { accept: ['drive:read'], remedy: 'drive:read' },
      [DRIVE_FILE, GMAIL_MODIFY, GMAIL_LABELS],
    ).message;

    expect(message).toContain('google_reauth_account');
    expect(message).toContain('drive:appfiles');
    expect(message).toContain('mail:modify');
    expect(message).toContain('drive:read');
  });

  it('omits the escalation clause entirely when the gate has none', () => {
    const message = capabilityGateError(
      'Personal',
      { accept: ['mail:settings'], remedy: 'mail:settings' },
      [],
    ).message;

    expect(message.split('\n\n')).toHaveLength(1);
  });

  // Regression case for the bug this record replaces: an account hitting an
  // any-of gate must be told to add only the narrow remedy, never the
  // broader escalation, in the line it would actually execute. Uses
  // drive:appfiles/drive:read as the example pair: drive:appfiles only
  // reaches files this server created, so a file someone else shared can
  // genuinely make it insufficient for the call being made — see the
  // `escalation` field's doc comment on CapabilityGate for why that's the
  // one case this field exists for.
  it('never puts the escalation capability in the primary remedy line', () => {
    const message = capabilityGateError(
      'Personal',
      { accept: ['drive:appfiles', 'drive:read'], remedy: 'drive:appfiles', escalation: 'drive:read' },
      [GMAIL_MODIFY, GMAIL_LABELS],
    ).message;

    const [primaryLine] = message.split('\n\n');
    expect(primaryLine).toContain('drive:appfiles');
    expect(primaryLine).not.toContain('drive:read');
    expect(primaryLine).toContain('mail:modify');
  });

  it('adds a second, separately executable line offering the escalation, preceded by the condition it applies under', () => {
    const message = capabilityGateError(
      'Personal',
      { accept: ['drive:appfiles', 'drive:read'], remedy: 'drive:appfiles', escalation: 'drive:read' },
      [GMAIL_MODIFY, GMAIL_LABELS],
    ).message;

    const lines = message.split('\n\n');
    expect(lines).toHaveLength(2);
    // Both lines are independently executable, and the account's existing
    // capabilities survive on the escalation line too.
    expect(message.match(/google_reauth_account/g)).toHaveLength(2);
    expect(lines[1]).toContain('drive:read');
    expect(lines[1]).toContain('mail:modify');
    // Explains why the broader grant might matter, not just that it exists.
    expect(lines[1]?.toLowerCase()).toContain('if ');
  });

  // The property this fix-round exists to pin: calendar:read genuinely
  // satisfies every read call calendar:write also would (verified against
  // Google's per-method scope reference), so the real calendar read-or-write
  // gate carries no escalation, and a failure must never mention
  // calendar:write anywhere — not even as an "if you also need to write"
  // upsell.
  it('never mentions calendar:write for the calendar read-or-write gate', () => {
    const message = capabilityGateError(
      'Personal',
      { accept: ['calendar:read', 'calendar:write'], remedy: 'calendar:read' },
      [],
    ).message;

    expect(message).not.toContain('calendar:write');
    expect(message).toContain('calendar:read');
  });

  // The one real escalation this codebase defines (Drive's app-created
  // reach) must explain the actual mechanism - a property of the file the
  // call names - and must not fall back to the generic "operations it does
  // not cover" wording, which reads as an upsell for unrelated future
  // calls rather than a reason THIS call could fail. Assert on the
  // mechanism, not the exact sentence, so a rewording doesn't spuriously
  // fail this test.
  it('explains the drive:appfiles escalation as a per-file reach limitation, not a future-operations upsell', () => {
    const message = capabilityGateError(
      'Personal',
      { accept: ['drive:appfiles', 'drive:read'], remedy: 'drive:appfiles', escalation: 'drive:read' },
      [],
    ).message;

    const [, escalationLine] = message.split('\n\n');
    expect(escalationLine).toBeDefined();
    expect(escalationLine?.toLowerCase()).toContain('created');
    expect(escalationLine?.toLowerCase()).not.toContain('does not cover');
    expect(escalationLine?.toLowerCase()).not.toContain('other operations');
  });
});
