# Changelog

## v0.5.0 (August 2026) — BREAKING

- **BREAKING:** Scope tiers (`mail_readonly`, `drive_full`, etc.) are replaced by eight per-service capabilities: `mail:read`, `mail:compose`, `mail:modify`, `mail:settings`, `drive:read`, `drive:appfiles`, `calendar:read`, `calendar:write`. `google_add_account` and `google_reauth_account` now take a `capabilities` array instead of a `scopeTier` string.

  This is a fix, not just a rename. The old tier model asserted two implications about Google's OAuth scopes that are false:
  - `drive.file` does **not** imply `drive.readonly` — `drive.file` grants per-file access to app-created files, `drive.readonly` reads everything, and neither contains the other. This defeated the scope gate on `drive_get_comments` for exactly the case it was built to protect, and made `drive_search_files` silently return an empty list instead of an error.
  - `calendar.events` does **not** imply `calendar.readonly` — it authorizes neither `calendarList.list` nor `freebusy.query`. Accounts with only `calendar.events` passed the old gate on `calendar_list_calendars` and `calendar_freebusy` and then failed at Google.

  Capabilities are checked directly against the scopes an operation actually needs, so there is no tier-to-scope lookup left to be wrong. The only real implication that exists in the new model is `mail:modify` ⇒ `mail:read` (Google documents `gmail.modify` as including read access).

  **Migration:** no config migration is required — capabilities are derived from each account's already-stored scopes, so existing accounts keep working under their old tier's equivalent capabilities:

  | Old tier | New capabilities |
  |---|---|
  | `mail_readonly` | `mail:read` |
  | `mail_compose` | `mail:read`, `mail:compose` |
  | `mail_full` | `mail:modify` |
  | `mail_settings` | `mail:read`, `mail:settings` |
  | `drive_readonly` | `drive:read` |
  | `drive_full` | `drive:appfiles` |
  | `calendar_readonly` | `calendar:read` |
  | `calendar_full` | `calendar:write` |
  | `all` | all eight |

  One exception: an account holding only `drive.file` will now be correctly refused by the nine `drive:read` tools and must be re-authorized with `google_reauth_account` to add `drive:read`. That's the fix working as intended, not a regression — those tools never should have worked on a `drive.file`-only grant.

## v0.4.2 (May 2026)

- **feat:** New `google_reauth_account` tool for re-running OAuth on an existing account. Use when a refresh token is invalidated (password change, revoked access, expired grant) or to upgrade/change scope tiers without losing the account ID, alias, description, or labels. Verifies the authorized Google account matches the existing email so reauth can't accidentally swap accounts.

## v0.4.1 (May 2026)

- **fix:** Subjects with non-ASCII characters (em-dash, smart quotes, accents, etc.) are now RFC 2047 encoded so Gmail and other clients display them correctly instead of mojibake like `â€"`. Previously only the attachment-bearing path encoded subjects; the plain draft/send/reply path sent raw UTF-8.
- **fix:** Plain-text bodies are now sent with `Content-Type: text/plain; format=flowed; delsp=no` (RFC 3676) and internal paragraph lines get soft-break markers, so receiving clients reflow long paragraphs to the viewport instead of rendering visible mid-paragraph line breaks from 76-char hard wraps.
- **feat:** `gmail_create_draft`, `gmail_update_draft`, `gmail_create_draft_with_attachment`, and `gmail_reply_in_thread` accept a new `bodyFormat: "text" | "html"` parameter. Use `"html"` to send bodies as `text/html`.

## v0.3.3 (April 2026)

- **fix:** Attachment downloads now work reliably — fixed a bug where Gmail's ephemeral attachment IDs caused every download to fail with "Attachment not found"
- **fix:** `gmail_get_attachment` now saves files directly to disk and identifies attachments by filename instead of unstable internal IDs
- **fix:** `gmail_bulk_save_attachments` no longer fails due to the same stale ID issue
