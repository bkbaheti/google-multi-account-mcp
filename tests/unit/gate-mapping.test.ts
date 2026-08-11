import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import type { Capability } from '../../src/auth/capabilities.js';
import type { AccountStore } from '../../src/auth/index.js';
import { registerCalendarTools } from '../../src/server/calendar-tools.js';
import { registerDriveTools } from '../../src/server/drive-tools.js';

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

  const gate = ((_accountRef: string, required: Capability | Capability[]) => {
    demanded[current] = Array.isArray(required) ? [...required].sort().join('|') : required;
    // Stop the handler before it touches the network.
    return { error: { isError: true, content: [] } };
  }) as never;

  register(server, {} as AccountStore, gate);

  for (const [name, handler] of Object.entries(handlers)) {
    current = name;
    try {
      void handler({ accountId: 'acct', fileId: 'f', calendarId: 'c', eventId: 'e' });
    } catch {
      // A handler may throw on the stub args; the gate already recorded what we need.
    }
  }

  return demanded;
}

describe('Drive gate mapping', () => {
  const gates = captureGates(registerDriveTools as never);

  // drive.file does NOT grant drive.readonly. These nine must demand drive:read,
  // or a drive.file-only account silently gets empty results instead of an error.
  it.each([
    'drive_list_shared_drives',
    'drive_search_files',
    'drive_list_files',
    'drive_get_file',
    'drive_get_file_content',
    'drive_get_full_file_content',
    'drive_get_comments',
    'drive_get_comment_replies',
    'drive_download_file',
  ])('%s requires drive:read', (tool) => {
    expect(gates[tool]).toBe('drive:read');
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

  // events.list / events.get accept either scope, so these must be any-of.
  it.each([
    'calendar_list_events',
    'calendar_get_event',
    'calendar_search_events',
  ])('%s accepts either calendar capability', (tool) => {
    expect(gates[tool]).toBe('calendar:read|calendar:write');
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
