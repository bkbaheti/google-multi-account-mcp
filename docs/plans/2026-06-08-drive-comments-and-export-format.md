# Requirement: Read Google Doc comments + choose export format on download

**Status:** Proposed (not yet scheduled)
**Date:** 2026-06-08
**Area:** Drive

These are two related, complementary capabilities. They can ship independently — (A)
delivers the core missing functionality; (B) is a smaller, useful companion that also
unblocks the same use-case via a different route.

---

## Motivating use-case

A client left **review comments** on a shared contract Doc (an SOW) in Google Drive. We
needed to read those comments through this MCP and could not. Today the only workarounds
are a human manually doing **File → Download → .docx** in the Google Docs UI, or using a
different MCP. Reviewer comments on shared contract/spec Docs are a recurring,
high-value workflow, so the MCP should support reading them directly.

---

## Current behaviour (with code citations)

### Google Workspace Docs export to plain text only

`drive_get_file_content`, `drive_get_full_file_content`, and `drive_download_file` all
route Google Workspace files through a single hardcoded export-MIME-type table:

`src/drive/client.ts:50-56`

```ts
// Google Workspace MIME type export mappings
const EXPORT_MIME_TYPES: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'text/plain', extension: 'txt' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'text/csv', extension: 'csv' },
  'application/vnd.google-apps.presentation': { mimeType: 'text/plain', extension: 'txt' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: 'png' },
};
```

A Google Doc (`application/vnd.google-apps.document`) is therefore **always** exported as
`text/plain`. The export call itself has no way to override the target MIME type:

- `DriveClient.getFileContent` — `src/drive/client.ts:200-203`:
  ```ts
  const response = await drive.files.export({
    fileId,
    mimeType: exportMapping.mimeType, // always text/plain for a Doc
  });
  ```
- `DriveClient.downloadFileToLocal` — `src/drive/client.ts:280-288`: same pattern; the
  output filename is derived as `${file.name}.${exportMapping.extension}` (i.e. `.txt`).

`text/plain` export **strips all comments and all formatting**. There is no parameter on
any tool to choose a different export format. Confirmed at the tool layer too — the
`drive_download_file` input schema (`src/server/drive-tools.ts:277-289`) exposes only
`accountId`, `fileId`, `outputDir`, `fileName`; there is no `exportMimeType`.

### No tool reads Drive comments at all

There is no `drive_get_comments` / `drive_get_comment_replies` tool, and `DriveClient`
makes no call to the Drive `comments` resource (`grep "comments" src/drive/client.ts`
returns nothing). So comments are unreachable through this MCP by any route.

### Scope caveat discovered in the code (important)

The Drive scope tiers are defined in `src/types/index.ts:39-46`:

```ts
drive_readonly: [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
],
drive_full: [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
],
```

- `drive_readonly` grants `drive.readonly` — broad read access to all of the user's files.
- `drive_full` grants **only** `drive.file` — per-file access limited to files the app
  itself created or that the user explicitly opened with this app.

`comments.list` returns comments for a file the caller can read, but `drive.file` only
covers app-created/app-opened files — a Doc *shared with the user by a client* is
generally **not** accessible under `drive.file`. So reading comments on an
externally-shared contract Doc requires `drive.readonly` (the `drive_readonly` tier),
**not** `drive.file`. The new comment tools should therefore be gated on
`drive_readonly` (consistent with the existing read tools, which all use `drive_readonly`
— see `src/types/index.ts:236-240` and `drive_download_file`'s
`validateAccountScope(args.accountId, 'drive_readonly')` at
`src/server/drive-tools.ts:292`).

Note this is a real limitation worth surfacing to users: an account authorized only at
the `drive_full` (`drive.file`) tier will not be able to read comments on Docs it did not
create, even though it can write files. Reading reviewer comments on a client-shared Doc
needs the `drive_readonly` tier.

---

## (A) Read Google Doc comments

### Desired behaviour

A new tool returns the comments thread on a Drive file (Doc/Sheet/Slide), including the
anchored/quoted text the comment refers to, the author, content, timestamps, resolved
status, and replies — without exporting or downloading the file.

Backed by the Drive API `comments.list` endpoint
(`drive.comments.list`). Required call shape:

- `fileId`
- `fields`: must explicitly request comment fields, e.g.
  `comments(id,author/displayName,author/emailAddress,content,htmlContent,quotedFileContent/value,anchor,createdTime,modifiedTime,resolved,deleted,replies(id,author/displayName,content,createdTime,modifiedTime)),nextPageToken`
  (Drive's `comments` resource returns nothing useful without an explicit `fields` mask.)
- `includeDeleted: false`
- pagination via `pageToken` / `pageSize` (Drive max page size for comments is 100).

### Proposed API

**`drive_get_comments`**

| Param | Type | Required | Description |
|---|---|---|---|
| `accountId` | string | yes | Account ID, alias, or email |
| `fileId` | string | yes | The Drive file ID |
| `pageToken` | string | no | Continuation token from a previous call |
| `pageSize` | number | no | Max comments per page (default 20, max 100) |
| `includeResolved` | boolean | no | Default `true`. When `false`, omit comments whose `resolved === true` (filtered client-side; Drive's API has no server-side resolved filter) |

Output: `{ comments: Comment[], nextPageToken?: string }` where each `Comment` is:

```ts
interface DriveComment {
  id: string;
  author: { displayName?: string; emailAddress?: string };
  content: string;            // plain-text comment body
  htmlContent?: string;       // formatted body if present
  quotedText?: string;        // quotedFileContent.value — the anchored doc text
  anchor?: string;            // opaque Drive anchor region, if any
  createdTime: string;        // RFC 3339
  modifiedTime: string;       // RFC 3339
  resolved: boolean;
  replies: DriveCommentReply[];
}

interface DriveCommentReply {
  id: string;
  author: { displayName?: string; emailAddress?: string };
  content: string;
  createdTime: string;
  modifiedTime: string;
}
```

**`drive_get_comment_replies`** (optional companion; `comments.list` already inlines
replies via the `replies(...)` field, so this is only needed if a comment's replies are
paginated separately or to fetch replies for a single comment without re-listing all
comments). Backed by `drive.replies.list`.

| Param | Type | Required | Description |
|---|---|---|---|
| `accountId` | string | yes | Account ID, alias, or email |
| `fileId` | string | yes | The Drive file ID |
| `commentId` | string | yes | The parent comment ID |
| `pageToken` | string | no | Continuation token |
| `pageSize` | number | no | Default 20, max 100 |

### Scope / permissions

- Gate both tools on the **`drive_readonly`** tier (`drive.readonly` scope), consistent
  with existing read tools. `drive.file` (`drive_full`) is **insufficient** for
  client-shared Docs — see the scope caveat above.
- Add a `comments`-specific entry to the read-operation tier map in `src/types/index.ts`
  (e.g. `driveGetComments: 'drive_readonly'`) for consistency with the existing
  `driveSearch` / `driveGetFile` / `driveGetContent` entries (`src/types/index.ts:236-240`).

### Acceptance criteria (A)

- [ ] `drive_get_comments` returns all top-level comments for a readable Doc, including
      `quotedText` (the anchored doc text), author, content, created/modified times,
      `resolved` flag, and inline `replies`.
- [ ] Deleted comments are excluded (`includeDeleted: false`).
- [ ] `includeResolved: false` omits resolved comments.
- [ ] Pagination: a file with > `pageSize` comments returns a `nextPageToken`, and
      passing it back returns the next page with no duplicates.
- [ ] An account authorized only at `drive_full` (`drive.file`) on a Doc shared by a third
      party returns a clear scope/permission error, not an empty list, where the API makes
      that distinguishable; otherwise the tool description documents the `drive_readonly`
      requirement.
- [ ] Unit tests assert the `fields` mask, `includeDeleted: false`, and
      `supportsAllDrives: true` are forwarded, mirroring the existing Drive client tests.

---

## (B) Choose export format on download/export

### Desired behaviour

Let `drive_download_file` (and, where it makes sense, the content-getter tools) accept an
optional `exportMimeType` for Google Workspace files, so a Doc can be exported as `.docx`
(`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) — which
**preserves both comments and formatting** — instead of being forced to `text/plain`.

### Proposed API

Add an optional `exportMimeType` parameter:

- **`drive_download_file`** — new optional `exportMimeType: string`. When the target is a
  Google Workspace file and `exportMimeType` is provided, pass it straight to
  `drive.files.export({ fileId, mimeType: exportMimeType })` instead of the default from
  `EXPORT_MIME_TYPES`. Derive the output extension from a small MIME→extension map (e.g.
  `...wordprocessingml.document` → `docx`, `...spreadsheetml.sheet` → `xlsx`,
  `application/pdf` → `pdf`), falling back to the table default when omitted.
- The `EXPORT_MIME_TYPES` default table (`src/drive/client.ts:50-56`) stays as the
  fallback for callers that don't pass `exportMimeType`, so behaviour is unchanged unless
  the new param is supplied (non-breaking).
- `downloadFileToLocal` (`src/drive/client.ts:255-313`) gains an optional
  `exportMimeType` argument threaded through to the `files.export` call and used for the
  filename extension.
- Optionally extend `getFileContent` similarly, but a `.docx` export is binary, so
  content-getter tools would return it base64-encoded — `drive_download_file` is the
  natural primary surface.

Common export MIME types to document in the tool description:

| Source | exportMimeType | Preserves comments? |
|---|---|---|
| Doc | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx) | Yes |
| Doc | `application/pdf` | No (rendered) |
| Sheet | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx) | n/a |

### Acceptance criteria (B)

- [ ] `drive_download_file` accepts an optional `exportMimeType`; when supplied for a
      Workspace file it is forwarded to `files.export` and the saved file has the correct
      extension (`.docx` for the wordprocessing MIME type).
- [ ] Omitting `exportMimeType` preserves today's behaviour exactly (Doc → `.txt`), so the
      change is non-breaking.
- [ ] Exporting a Doc with `.docx` produces a file that, when reopened, contains the
      document's comments and formatting.
- [ ] An `exportMimeType` that Drive doesn't support for that file type surfaces a clear
      error.
- [ ] Unit test asserts `exportMimeType` is forwarded to `files.export` and drives the
      output extension.

---

## Out of scope

- Writing/replying to comments (`comments.create`, `replies.create`), resolving comments.
- Parsing `.docx` server-side to extract comments — (B) hands the binary to the caller;
  comment extraction from `.docx` is the caller's concern. (A) is the structured route.
- Broadening default scopes. If users need comment access, they authorize the
  `drive_readonly` tier (already supported via `google_reauth_account`).
