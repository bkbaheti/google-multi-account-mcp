# Changelog

## v0.3.3 (April 2026)

- **fix:** Attachment downloads now work reliably — fixed a bug where Gmail's ephemeral attachment IDs caused every download to fail with "Attachment not found"
- **fix:** `gmail_get_attachment` now saves files directly to disk and identifies attachments by filename instead of unstable internal IDs
- **fix:** `gmail_bulk_save_attachments` no longer fails due to the same stale ID issue
