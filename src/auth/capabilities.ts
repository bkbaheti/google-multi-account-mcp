/**
 * Per-service capabilities, replacing the old scope-tier model.
 *
 * A capability names one permission on one service. Operation gates ask for a
 * capability directly, so there is no tier-to-scope lookup that can be wrong —
 * the previous model claimed drive.file implied drive.readonly, which is false
 * and silently defeated the gate on reading Drive comments.
 */

export const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export const CAPABILITIES = [
  'mail:read',
  'mail:compose',
  'mail:modify',
  'mail:settings',
  'drive:read',
  'drive:appfiles',
  'calendar:read',
  'calendar:write',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_SCOPES: Record<Capability, readonly string[]> = {
  'mail:read': ['https://www.googleapis.com/auth/gmail.readonly'],
  'mail:compose': ['https://www.googleapis.com/auth/gmail.compose'],
  'mail:modify': [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
  ],
  'mail:settings': ['https://www.googleapis.com/auth/gmail.settings.basic'],
  'drive:read': ['https://www.googleapis.com/auth/drive.readonly'],
  'drive:appfiles': ['https://www.googleapis.com/auth/drive.file'],
  'calendar:read': ['https://www.googleapis.com/auth/calendar.readonly'],
  'calendar:write': ['https://www.googleapis.com/auth/calendar.events'],
};

/**
 * The implications that are actually true of Google's scopes, each checked against
 * a method-level scope list in Google's API reference:
 *
 * - gmail.modify implies mail:read: it is documented as "Read, compose, and send
 *   emails", so it subsumes gmail.readonly.
 * - gmail.modify implies mail:compose: both users.drafts.create and
 *   users.messages.send list mail.google.com, gmail.modify, and gmail.compose as
 *   accepted scopes (users.messages.send also accepts gmail.send), so gmail.modify
 *   alone authorizes every draft/send operation gmail.compose authorizes.
 *
 * Deliberately absent, and verified against Google's documentation:
 * - drive.file does NOT imply drive.readonly. drive.file grants per-file access to
 *   app-created files; drive.readonly reads everything. Asserting otherwise is the
 *   bug this model replaces.
 * - calendar.events does NOT imply calendar.readonly. It authorizes neither
 *   calendarList.list nor freebusy.query, both of which accept only
 *   calendar.readonly.
 *
 * Do not add entries here without checking the method-level scope list in Google's
 * API reference. A false entry silently disables a gate.
 */
const CAPABILITY_IMPLIES: Partial<Record<Capability, readonly Capability[]>> = {
  'mail:modify': ['mail:read', 'mail:compose'],
};

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Google scopes to request for a set of capabilities. Always includes userinfo.email. */
export function scopesFor(capabilities: Capability[]): string[] {
  const scopes = new Set<string>([USERINFO_EMAIL_SCOPE]);

  for (const capability of capabilities) {
    for (const scope of CAPABILITY_SCOPES[capability]) {
      scopes.add(scope);
    }
  }

  return Array.from(scopes);
}

/** Derive the capabilities an account holds from the scopes Google granted it. */
export function capabilitiesOf(scopes: string[]): Capability[] {
  const granted = new Set(scopes);
  const held = new Set<Capability>();

  for (const capability of CAPABILITIES) {
    const required = CAPABILITY_SCOPES[capability];
    if (required.every((scope) => granted.has(scope))) {
      held.add(capability);
    }
  }

  for (const capability of [...held]) {
    for (const implied of CAPABILITY_IMPLIES[capability] ?? []) {
      held.add(implied);
    }
  }

  return CAPABILITIES.filter((capability) => held.has(capability));
}

export function hasCapability(scopes: string[], capability: Capability): boolean {
  return capabilitiesOf(scopes).includes(capability);
}

/**
 * True when the account holds at least one of the listed capabilities. Needed
 * where more than one scope authorizes an operation — reading calendar events is
 * permitted by either calendar.readonly or calendar.events.
 */
export function hasAnyCapability(scopes: string[], capabilities: Capability[]): boolean {
  const held = new Set(capabilitiesOf(scopes));
  return capabilities.some((capability) => held.has(capability));
}

export function missingCapabilities(scopes: string[], required: Capability[]): Capability[] {
  const held = new Set(capabilitiesOf(scopes));
  return required.filter((capability) => !held.has(capability));
}

/**
 * An operation gate expressed as a record rather than a bare capability, for
 * operations Google authorizes under more than one capability (e.g.
 * events.list accepts either calendar.readonly or calendar.events).
 *
 * - `accept` mirrors the Google method's authorized-capability list.
 * - `remedy` is the narrowest member of `accept` — the only one that ever
 *   appears in the executable `google_reauth_account` line a gate failure
 *   suggests. Suggesting a broader member here would let the error message
 *   turn a read request into an unrequested write-scope escalation.
 * - `escalation`, when present, is a broader member of `accept`, offered
 *   separately together with the condition under which `remedy` alone will
 *   not suffice.
 *
 *   `escalation` exists ONLY for cases where the narrow remedy may genuinely
 *   be insufficient for the call being made right now - a property of THIS
 *   call, not of some future one. The real case is Drive: `drive:appfiles`
 *   authorizes `files.get`, but only reaches files this server created, so
 *   a user granting the narrow remedy may still fail on a file a client
 *   shared with them - that failure is about the file in front of them.
 *   "You might want broader access for a different call later" is never a
 *   valid `escalation` - that is an upsell, not a remedy, and a gate must
 *   not carry one. (calendar:read genuinely satisfies every read call
 *   calendar:write also would, so the calendar read gates below carry no
 *   escalation at all.)
 */
export interface CapabilityGate {
  accept: Capability[];
  remedy: Capability;
  escalation?: Capability;
}

/**
 * Normalize a bare Capability into the equivalent single-member gate, and
 * assert the one invariant a hand-written CapabilityGate must satisfy:
 * `remedy` has to be a member of `accept`. Violating it would let a gate
 * suggest a capability that doesn't even satisfy the operation it guards -
 * so this is a bug in the gate's definition, not a runtime/user condition,
 * and fails fast with a thrown error rather than a soft validation result.
 */
export function normalizeGate(required: Capability | CapabilityGate): CapabilityGate {
  const gate: CapabilityGate =
    typeof required === 'string' ? { accept: [required], remedy: required } : required;

  if (!gate.accept.includes(gate.remedy)) {
    throw new Error(
      `Invalid capability gate: remedy "${gate.remedy}" must be a member of accept [${gate.accept.join(', ')}].`,
    );
  }

  return gate;
}
