# Changelog

## v0.6.0 — BREAKING (August 2026)

OAuth hardening for the shipped public client. Prompted by a responsible-disclosure report from Francesco Martignoni (Politecnico di Milano) about the client secret committed at `src/auth/oauth-defaults.ts`.

**To be clear about that report, because scanners will keep filing it:** the embedded secret is intentional and was *not* rotated. It belongs to a Google "Desktop app" OAuth client, which is a public client under RFC 8252 — Google documents such secrets as not confidential, and the same pattern ships in `gcloud`, the GitHub CLI, and VS Code. Rotation is not a remediation: this server is distributed as an npm package, so any replacement would be published in the next release. **Your credentials were not exposed and no action is required of you.** See `SECURITY.md`.

What the report did surface is that the trade-off had been taken without the control that makes a public client safe. That is what this release fixes.

- **feat:** PKCE (RFC 7636, S256) on both OAuth flows. Previously the authorization code was protected only by the callback landing on a fixed local port. A process on the same machine that bound port 8089 first would receive the code, and the client secret needed to redeem it is published on npm — so an unprivileged local process could obtain full Gmail/Drive/Calendar access. The `code_verifier` never leaves the server process, so an intercepted code can no longer be exchanged. Exploitation required local code execution, so this was not remotely reachable.
- **BREAKING:** The OAuth callback server now binds an **OS-assigned ephemeral port** on `127.0.0.1` instead of a fixed `localhost:8089` (RFC 8252 §7.3, §8.3). There is no longer a predictable port to squat, concurrent auth flows no longer collide, and "port 8089 already in use" is gone as a failure mode. If you have a **firewall rule, proxy exception, or corporate policy pinned to port 8089 or to the hostname `localhost`**, it no longer applies and may need widening to the loopback interface. Bring-your-own-credentials users need no console change: Desktop-app clients have no redirect-URI allowlist. (If you created a *Web application* client instead, the loopback flow will not work — create a Desktop app client; the README's BYO steps were wrong about this and are corrected.)
- **BREAKING (library consumers only):** `AccountStore.startAddAccount()` and `AccountStore.startReauthAccount()` now return a `Promise` and must be awaited. The authorization URL cannot be built until the callback socket is listening, because `redirect_uri` has to name the assigned port. MCP tool users are unaffected — no tool signature or response shape changed.
- **docs:** New `SECURITY.md` — private reporting channel, plus an explicit statement of why the embedded secret is intentional and why rotation is not a remediation, so future scanner-driven reports are self-service. Records the accepted trade-offs of a shared public client that PKCE does *not* fix: anyone can build on this client ID and show users our verified consent screen, and third-party use consumes this project's API quota. Both are avoidable by bringing your own credentials.
- **docs:** `CLAUDE.md` and `docs/SPEC.md` had forbidden a shared OAuth client — `SPEC.md` §10 listed it under *non-reversible* decisions — while the code has shipped one since v0.4.x. The reversal and its costs are now recorded rather than contradicted, so the credential does not read as a mistake to be "fixed."

Unchanged because they were already correct: the `state` parameter is generated per flow and verified on callback in both paths, and tokens at rest continue to use the OS keychain with an AES-256-GCM encrypted-file fallback.

## v0.5.1 (August 2026)

**0.5.0 was never published to npm** — it was superseded before release, so this is the version in which the capability model below first reached users. Everything listed under v0.5.0 ships here, including the breaking change.

0.5.0 replaced scope tiers with the capability model described below, and in doing so was too strict: several gates refused calls Google's own scope reference pages say are authorized. This release corrects those gates and adds the permission UX the tightened model should have shipped with.

- **fix:** Eight of the nine Drive read tools (`drive_get_file`, `drive_get_file_content`, `drive_get_full_file_content`, `drive_download_file`, `drive_get_comments`, `drive_get_comment_replies`, `drive_search_files`, `drive_list_files`) now accept `drive:appfiles` as an alternative to `drive:read`, matching what `drive.file` actually authorizes on Google's per-method scope reference. Previously an account holding only `drive:appfiles` could upload a file and then be refused permission to read it back. Only `drive_list_shared_drives` still requires `drive:read` — `drives.list` rejects `drive.file`.
- **fix:** `mail:modify` now implies `mail:compose` as well as `mail:read` — `gmail.modify` authorizes `users.drafts.create` and `users.messages.send`, so an account with `mail:modify` no longer needs `mail:compose` granted separately to draft or send.
- **fix:** `gmail_list_labels` now accepts `mail:read` as well as `mail:modify` — `users.labels.list` accepts `gmail.readonly`, so listing labels never needed write access.
- **fix:** Any-of capability gates now suggest the single narrowest capability that would satisfy the call, instead of unioning every accepted alternative into the remedy — a request to read one calendar event no longer tells the user to grant `calendar:write`.
- **fix:** `capabilities: []` on `google_add_account` / `google_reauth_account` is now treated as "unspecified," matching an omitted field. Previously an empty array was truthy and silently stripped an account down to `userinfo.email` only.
- **fix:** A legacy `scopeTier` / `scopeTiers` argument is now rejected with a validation error naming its capability-model replacement, instead of being silently dropped (zod strips unknown keys) so the call appeared to succeed while granting nothing resembling the requested tier.
- **fix:** Accounts now store the scopes Google actually *granted* (from the token response), not just the scopes requested. Under granular consent a user can decline an individual scope and still complete OAuth; previously the account record kept the requested scope regardless, so gates could pass for a capability the account didn't actually hold.
- **fix:** Binary Workspace-file previews (e.g. Google Drawings) are now bounded by `maxChars` like every other preview, instead of ignoring it and returning the full base64 payload. An empty `exportMimeType` is treated as absent rather than falling through to the raw-media path Drive rejects, and misuse now raises a proper validation error instead of a bare `Error` that surfaced as `UNKNOWN_ERROR`.
- **feat:** Capability presets — `read-only` (`mail:read`, `drive:read`, `calendar:read`), `inbox-assistant` (`mail:modify`), `scheduler` (`calendar:read` + `calendar:write`) — for one-step account setup. `google_add_account` accepts `presets` alongside `capabilities`; both compose and are deduplicated. No preset is pre-selected, and there is no `full-access` or Drive-only preset — broad Drive access must still be chosen explicitly.
- **feat:** `google_reauth_account` now requires `confirm: true` when the new capability set would add `drive:read`, mirroring the existing confirmation for narrowing. Gaining `drive:read` means reading every file in the Drive, including everything shared with the user, so it gets the same friction as losing a capability.
- **feat:** Drive responses on an account holding `drive:appfiles` but not `drive:read` now carry a `coverage` annotation noting the view may be partial — on every response, including non-empty results, not just empty ones, so a partial-but-nonzero result isn't mistaken for a complete one.
- **feat:** A Drive not-found on an account lacking `drive:read` is now returned as `DRIVE_FILE_NOT_VISIBLE` with `ambiguous: true` (the file may exist but be outside the account's reach) rather than a plain `NOT_FOUND`, which is reserved for accounts holding `drive:read`, where not-found reliably means the file doesn't exist.
- **fix:** `gate-mapping.test.ts` now asserts against every registered tool handler rather than a hand-maintained list, so a tool registered without a capability gate fails the test instead of passing silently.

## v0.5.0 — BREAKING (never released; shipped as part of 0.5.1)

> Not published to npm. `npm view @procedure-tech/mcp-google@0.5.0` returns 404. The version was
> bumped, then the gates below were found to be too strict and corrected before any tag was pushed.
> Retained here because the migration table and the reasoning apply to 0.5.1.

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

  ~~One exception: an account holding only `drive.file` will now be correctly refused by the nine `drive:read` tools…~~

  **This was wrong, and 0.5.1 corrects it.** Google's per-method scope reference lists `drive.file` as
  authorized for `files.get`, `files.export`, `files.list`, `comments.list` and `replies.list`, so
  refusing those calls was a regression, not a fix. Eight of the nine Drive read tools accept
  `drive:appfiles` as of 0.5.1. Only `drive_list_shared_drives` still requires `drive:read`, because
  `drives.list` genuinely rejects `drive.file`.

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
