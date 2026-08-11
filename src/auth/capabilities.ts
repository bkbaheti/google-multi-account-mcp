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

/** Human-facing description of a capability, for every surface a person or agent reads before granting or using it. */
export interface CapabilityInfo {
  /** A short human label. */
  name: string;
  /** What the capability permits, in plain language a non-developer can act on. */
  canDo: string;
  /** The limits, stated positively rather than as a list of missing scopes. */
  cannotDo: string;
  /** Which files/messages/events the capability applies to. */
  reach: string;
  /** The Google scopes requested for this capability. Checked in tests against CAPABILITY_SCOPES. */
  scopes: readonly string[];
}

/**
 * The single source of truth for every human-facing description of a capability.
 * The picker copy, README table, llms.txt and tool-description trailers are all
 * generated from this table — see docs/superpowers/specs/2026-08-11-capability-
 * correctness-and-ux-design.md, section B3.
 *
 * Two entries below encode facts verified against Google's per-method scope
 * reference and are easy to "correct" wrongly — do not:
 * - mail:modify genuinely includes compose/send: users.drafts.create and
 *   users.messages.send both accept gmail.modify.
 * - calendar:write genuinely cannot list calendars: calendarList.list and
 *   freebusy.query accept calendar.readonly but NOT calendar.events.
 */
export const CAPABILITY_INFO: Record<Capability, CapabilityInfo> = {
  'mail:read': {
    name: 'Read mail',
    canDo: 'Read and search your email, and list your labels.',
    cannotDo: 'Cannot send, reply, label, archive or delete anything.',
    reach: 'Every message and label in the mailbox.',
    scopes: CAPABILITY_SCOPES['mail:read'],
  },
  'mail:compose': {
    name: 'Compose mail',
    canDo:
      'Write drafts and send email. Despite the name, this capability sends — it does not only compose.',
    cannotDo: 'Cannot read any message already in your mailbox, not even replies to what it sends.',
    reach: 'Drafts and messages this capability creates.',
    scopes: CAPABILITY_SCOPES['mail:compose'],
  },
  'mail:modify': {
    name: 'Full mail',
    canDo:
      'Read, send, and organise mail: labels, archive, trash. Includes everything mail:read and mail:compose do — you do not need to grant those as well.',
    cannotDo: 'Cannot manage filters or the vacation auto-reply.',
    reach: 'Every message and label in the mailbox.',
    scopes: CAPABILITY_SCOPES['mail:modify'],
  },
  'mail:settings': {
    name: 'Mail settings',
    canDo: 'Manage filters and the vacation auto-reply.',
    cannotDo: 'Cannot read or send mail.',
    reach: 'Mailbox-wide filter and vacation-responder settings.',
    scopes: CAPABILITY_SCOPES['mail:settings'],
  },
  'drive:read': {
    name: 'Read Drive',
    canDo:
      'See and download every file in this Drive, read-only. Includes files other people shared with you, and every Shared Drive you belong to.',
    cannotDo: 'Cannot create, edit, move or share anything.',
    reach: 'Every file and Shared Drive the account can see.',
    scopes: CAPABILITY_SCOPES['drive:read'],
  },
  'drive:appfiles': {
    name: 'App-created Drive files',
    canDo: 'Create files and folders, and read, edit, share and delete the ones within its reach.',
    cannotDo:
      'Cannot see anything else in your Drive — searches return an empty list rather than an error.',
    reach: 'Files this server created, plus files you explicitly opened with it.',
    scopes: CAPABILITY_SCOPES['drive:appfiles'],
  },
  'calendar:read': {
    name: 'Read calendar',
    canDo:
      'See your calendars, your events, and when you are free or busy. Required to list which calendars exist.',
    cannotDo: 'Cannot create or change events.',
    reach: 'Every calendar the account can see.',
    scopes: CAPABILITY_SCOPES['calendar:read'],
  },
  'calendar:write': {
    name: 'Write calendar',
    canDo: 'Create, edit, move, delete events, and RSVP.',
    cannotDo:
      'Cannot list your calendars or check free/busy — grant calendar:read as well, or the agent can only reach the "primary" calendar.',
    reach: 'Events on calendars the account can write to.',
    scopes: CAPABILITY_SCOPES['calendar:write'],
  },
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

/**
 * Named bundles of capabilities, expanded to primitives before anything is
 * stored - a front door onto the vocabulary above, not a second vocabulary.
 * An account's stored scopes, gates, and errors only ever speak in
 * Capability names; a preset name never reaches storage.
 *
 * - `read-only` covers all three services at read-only, for someone who just
 *   wants their assistant to see things.
 * - `inbox-assistant` is `mail:modify` alone - it already includes
 *   mail:read and mail:compose (see CAPABILITY_IMPLIES), so listing them
 *   here too would be redundant, not more complete.
 * - `scheduler` grants BOTH calendar capabilities, always. calendar:write
 *   alone cannot list calendars or check free/busy (see CAPABILITY_INFO
 *   above), so a scheduler preset granting only write would leave the agent
 *   able to reach nothing but the "primary" calendar - a broken product,
 *   not a narrower one.
 *
 * Deliberately absent:
 * - No `full-access` preset. Bundling every capability into one name hides
 *   exactly the choice presets exist to make explicit elsewhere.
 * - No Drive preset beyond read-only's drive:read. drive:read means "read
 *   every file in this Drive, including everything anyone has shared with
 *   you" - the one grant broad enough that it must be chosen deliberately
 *   via `capabilities`, not folded into a convenience bundle.
 */
export const CAPABILITY_PRESETS = {
  'read-only': ['mail:read', 'drive:read', 'calendar:read'],
  'inbox-assistant': ['mail:modify'],
  scheduler: ['calendar:read', 'calendar:write'],
} as const satisfies Record<string, readonly Capability[]>;

export type PresetName = keyof typeof CAPABILITY_PRESETS;

export const PRESET_NAMES = Object.keys(CAPABILITY_PRESETS) as PresetName[];

export function isPreset(value: string): value is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(value);
}

/**
 * Capabilities whose gain via reauth warrants the same confirm: true
 * friction the narrowing gate already requires - see capabilitiesRemovedBy
 * in ../auth/account-store.ts and its mirror capabilitiesAddedBy.
 *
 * Only drive:read: gaining it means "read every file in this Drive,
 * including everything shared with the user" (CAPABILITY_INFO['drive:read']
 * above), the one grant where silently sliding into it on a reauth costs
 * real exposure. mail:read and calendar:read are deliberately excluded -
 * over-warning trains people to click through, which costs you the warning
 * that matters.
 */
export const CONFIRM_ON_WIDEN: readonly Capability[] = ['drive:read'];

/**
 * Old scope-tier names (removed in 0.5.0, commit 6387f1c) mapped to their
 * capability-model equivalent, derived from the scopes each tier used to
 * request (see SCOPE_TIERS as it stood at 6387f1c^:src/types/index.ts).
 * Used only to build an actionable error when a legacy `scopeTier` /
 * `scopeTiers` argument reaches google_add_account or google_reauth_account -
 * see rejectUnknownArgs in ../errors/index.ts.
 */
export const LEGACY_SCOPE_TIER_CAPABILITIES: Record<string, Capability[]> = {
  mail_readonly: ['mail:read'],
  readonly: ['mail:read'], // legacy short alias for mail_readonly
  mail_compose: ['mail:read', 'mail:compose'],
  compose: ['mail:read', 'mail:compose'], // legacy short alias for mail_compose
  mail_full: ['mail:modify'],
  full: ['mail:modify'], // legacy short alias for mail_full
  mail_settings: ['mail:read', 'mail:settings'],
  settings: ['mail:read', 'mail:settings'], // legacy short alias for mail_settings
  drive_readonly: ['drive:read'],
  drive_full: ['drive:appfiles'],
  calendar_readonly: ['calendar:read'],
  calendar_full: ['calendar:write'],
  all: [
    'mail:modify',
    'mail:settings',
    'drive:read',
    'drive:appfiles',
    'calendar:read',
    'calendar:write',
  ],
};

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
