# Changelog

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
