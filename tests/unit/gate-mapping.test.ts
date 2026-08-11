import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import type { Capability, CapabilityGate } from '../../src/auth/capabilities.js';
import type { AccountStore } from '../../src/auth/index.js';
import { registerCalendarTools } from '../../src/server/calendar-tools.js';
import { registerDriveTools } from '../../src/server/drive-tools.js';
import { registerGmailTools } from '../../src/server/gmail-tools.js';

/** Register a tool family against fakes and record which capability each tool demands. */
function captureGates(
  register: (s: McpServer, a: AccountStore, gate: never) => void,
): Record<string, string> {
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: never) => {
      handlers[name] = handler as unknown as (a: Record<string, unknown>) => unknown;
    },
  } as unknown as McpServer;

  const demanded: Record<string, string> = {};
  let current = '';

  // A bare Capability records as itself. A CapabilityGate records its full
  // accept set plus which member is the remedy (and, if any, the
  // escalation) - so a test can catch not just "which capabilities satisfy
  // this gate" but "which one the error message would actually suggest".
  const gate = ((_accountRef: string, required: Capability | CapabilityGate) => {
    demanded[current] =
      typeof required === 'string'
        ? required
        : `${[...required.accept].sort().join('|')} remedy=${required.remedy} escalation=${required.escalation ?? 'none'}`;
    // Stop the handler before it touches the network.
    return { error: { isError: true, content: [] } };
  }) as never;

  register(server, {} as AccountStore, gate);

  for (const [name, handler] of Object.entries(handlers)) {
    current = name;
    try {
      void handler({
        accountId: 'acct',
        fileId: 'f',
        calendarId: 'c',
        eventId: 'e',
        messageId: 'm',
        draftId: 'd',
        threadId: 't',
        labelId: 'l',
        filterId: 'flt',
        query: 'q',
      });
    } catch {
      // A handler may throw on the stub args; the gate already recorded what we need.
    }
  }

  // A handler that never calls the gate callback leaves no entry in `demanded`
  // and so is invisible to every `it.each` list below - a tool could be
  // registered with no capability check at all and this suite would stay
  // green. Fail closed: every registered handler must have recorded a gate.
  const ungated = Object.keys(handlers).filter((name) => !(name in demanded));
  if (ungated.length > 0) {
    throw new Error(
      `Tool(s) registered with no captured capability gate (handler never called the gate callback): ${ungated.join(', ')}`,
    );
  }

  return demanded;
}

describe('Drive gate mapping', () => {
  const gates = captureGates(registerDriveTools as never);

  // drives.list does NOT accept drive.file (verified against Google's
  // per-method scope reference), so this is the one Drive read tool that
  // must demand bare drive:read rather than the any-of gate below.
  it.each(['drive_list_shared_drives'])('%s requires drive:read', (tool) => {
    expect(gates[tool]).toBe('drive:read');
  });

  // files.get, files.export, files.list, comments.list, and replies.list all
  // accept either drive.readonly or drive.file, so these eight must be
  // any-of gates remedying to the narrower drive:appfiles - demanding bare
  // drive:read here is the regression this suite exists to catch: it would
  // force a drive.file-only account (e.g. one that just uploaded a file) to
  // grant read access to the user's entire Drive just to read its own
  // upload back. The escalation to drive:read covers the one real gap:
  // drive:appfiles only reaches files this server created.
  it.each([
    'drive_search_files',
    'drive_list_files',
    'drive_get_file',
    'drive_get_file_content',
    'drive_get_full_file_content',
    'drive_get_comments',
    'drive_get_comment_replies',
    'drive_download_file',
  ])('%s accepts either drive capability, remedying to drive:appfiles with a drive:read escalation', (tool) => {
    expect(gates[tool]).toBe(
      'drive:appfiles|drive:read remedy=drive:appfiles escalation=drive:read',
    );
  });

  it.each([
    'drive_upload_file',
    'drive_create_folder',
    'drive_move_file',
    'drive_copy_file',
    'drive_rename_file',
    'drive_trash_file',
    'drive_share_file',
    'drive_update_permissions',
  ])('%s requires drive:appfiles', (tool) => {
    expect(gates[tool]).toBe('drive:appfiles');
  });
});

describe('Calendar gate mapping', () => {
  const gates = captureGates(registerCalendarTools as never);

  // calendar.events authorizes neither calendarList.list nor freebusy.query.
  it.each(['calendar_list_calendars', 'calendar_freebusy'])('%s requires calendar:read', (tool) => {
    expect(gates[tool]).toBe('calendar:read');
  });

  // events.list / events.get accept either scope, so these must be any-of -
  // but the remedy a failure suggests must still be the narrower one
  // (calendar:read). No escalation: calendar:read fully satisfies these
  // read calls, so calendar:write must never appear in the gate at all -
  // offering it here would be an unrequested write-scope upsell.
  it.each([
    'calendar_list_events',
    'calendar_get_event',
    'calendar_search_events',
  ])('%s accepts either calendar capability, remedying to calendar:read with no escalation', (tool) => {
    expect(gates[tool]).toBe('calendar:read|calendar:write remedy=calendar:read escalation=none');
  });

  it.each([
    'calendar_create_event',
    'calendar_update_event',
    'calendar_delete_event',
    'calendar_rsvp',
    'calendar_move_event',
  ])('%s requires calendar:write', (tool) => {
    expect(gates[tool]).toBe('calendar:write');
  });
});

describe('Gmail gate mapping', () => {
  const gates = captureGates(registerGmailTools as never);

  it.each([
    'gmail_search_messages',
    'gmail_get_message',
    'gmail_get_messages_batch',
    'gmail_get_thread',
    'gmail_get_attachment',
    'gmail_list_attachments',
    'gmail_bulk_save_attachments',
  ])('%s requires mail:read', (tool) => {
    expect(gates[tool]).toBe('mail:read');
  });

  it.each([
    'gmail_create_draft',
    'gmail_create_draft_with_attachment',
    'gmail_update_draft',
    'gmail_get_draft',
    'gmail_delete_draft',
    'gmail_send_draft',
    'gmail_reply_in_thread',
  ])('%s requires mail:compose', (tool) => {
    expect(gates[tool]).toBe('mail:compose');
  });

  it.each([
    'gmail_create_label',
    'gmail_update_label',
    'gmail_delete_label',
    'gmail_modify_labels',
    'gmail_batch_modify_labels',
    'gmail_mark_read_unread',
    'gmail_archive',
    'gmail_trash',
    'gmail_untrash',
  ])('%s requires mail:modify', (tool) => {
    expect(gates[tool]).toBe('mail:modify');
  });

  // users.labels.list accepts gmail.readonly, so this must be an any-of gate
  // remedying to mail:read - demanding mail:modify here is the regression
  // this suite exists to catch: it would force a read-only account to grant
  // write access just to list labels. No escalation: mail:read fully
  // satisfies users.labels.list, so mail:modify must never appear in a
  // failure message for this tool.
  it.each(['gmail_list_labels'])(
    '%s accepts either mail capability, remedying to mail:read with no escalation',
    (tool) => {
      expect(gates[tool]).toBe('mail:modify|mail:read remedy=mail:read escalation=none');
    },
  );

  it.each([
    'gmail_list_filters',
    'gmail_create_filter',
    'gmail_delete_filter',
    'gmail_get_vacation',
    'gmail_set_vacation',
  ])('%s requires mail:settings', (tool) => {
    expect(gates[tool]).toBe('mail:settings');
  });
});
