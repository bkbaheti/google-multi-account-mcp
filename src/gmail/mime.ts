// MIME utilities for building multipart email messages

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: string; // base64-encoded
}

export type BodyFormat = 'text' | 'html';

export interface MimeMessageOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  attachments?: MimeAttachment[] | undefined;
  bodyFormat?: BodyFormat | undefined;
}

// Generate a unique boundary string for MIME multipart
function generateBoundary(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let boundary = '----=_Part_';
  for (let i = 0; i < 24; i++) {
    boundary += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return boundary;
}

// Encode non-ASCII characters in headers using RFC 2047 encoded-word syntax
export function encodeMimeHeader(value: string): string {
  // Check if encoding is needed (non-ASCII characters)
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }

  // Use UTF-8 Base64 encoding
  const encoded = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

// Chunk base64 data into 76-character lines per MIME spec
function chunkBase64(data: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < data.length; i += lineLength) {
    lines.push(data.slice(i, i + lineLength));
  }
  return lines.join('\r\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Split a body into paragraphs on blank lines, discarding empty ones.
function paragraphsOf(body: string): string[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ''))
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => paragraph.split('\n'));
}

// MIME bodies use CRLF line endings.
function toCrlf(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
}

/**
 * Render a plain-text body as minimal HTML, preserving the author's line
 * breaks: a single newline becomes <br>, a blank line starts a new <p>.
 *
 * This exists because text/plain cannot express the difference between an
 * intentional line break and a soft wrap in a way Gmail's web client honours —
 * it ignores RFC 3676 format=flowed. The previous approach joined every line
 * within a paragraph so that nothing wrapped mid-sentence, which silently
 * destroyed lists, postal addresses, sign-offs and pasted code. Emitting an
 * HTML alternative alongside the untouched plain text gives web clients
 * something they will reflow to the viewport with the breaks intact.
 *
 * Body text is agent-authored and may contain markup characters, so it is
 * escaped rather than interpolated. No Markdown is rendered: silently
 * transforming ** or # would surprise callers, and a bullet written as "- item"
 * already reads correctly once its line break survives.
 */
export function textToHtml(body: string): string {
  return paragraphsOf(body)
    .map((lines) => `<p>${lines.map(escapeHtml).join('<br>')}</p>`)
    .join('\r\n');
}

// The two alternative parts, least-preferred first: a client picks the last
// part it understands, so text/html must come after text/plain.
function alternativeParts(body: string, boundary: string): string[] {
  return [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    toCrlf(body),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    textToHtml(body),
    '',
    `--${boundary}--`,
  ];
}

// Build a simple text message (no attachments)
function buildSimpleMessage(options: MimeMessageOptions): string {
  const bodyFormat: BodyFormat = options.bodyFormat ?? 'text';
  const lines: string[] = [];

  lines.push(`To: ${options.to}`);
  if (options.cc) {
    lines.push(`Cc: ${options.cc}`);
  }
  if (options.bcc) {
    lines.push(`Bcc: ${options.bcc}`);
  }
  lines.push(`Subject: ${encodeMimeHeader(options.subject)}`);
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
  }
  if (options.references) {
    lines.push(`References: ${options.references}`);
  }
  lines.push('MIME-Version: 1.0');

  if (bodyFormat === 'html') {
    lines.push('Content-Type: text/html; charset=utf-8');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(options.body);
  } else {
    const altBoundary = generateBoundary();
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push('');
    lines.push(...alternativeParts(options.body, altBoundary));
  }

  return lines.join('\r\n');
}

// Build a multipart message with attachments
function buildMultipartMessage(options: MimeMessageOptions): string {
  const bodyFormat: BodyFormat = options.bodyFormat ?? 'text';
  const boundary = generateBoundary();
  const lines: string[] = [];

  // Main headers
  lines.push(`To: ${options.to}`);
  if (options.cc) {
    lines.push(`Cc: ${options.cc}`);
  }
  if (options.bcc) {
    lines.push(`Bcc: ${options.bcc}`);
  }
  lines.push(`Subject: ${encodeMimeHeader(options.subject)}`);
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
  }
  if (options.references) {
    lines.push(`References: ${options.references}`);
  }
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');

  // Body part. For plain text this is itself a multipart/alternative, so the
  // structure is multipart/mixed > multipart/alternative + attachments. The
  // inner boundary must differ from the outer one or parsers cannot tell the
  // nested part from the enclosing one.
  lines.push(`--${boundary}`);
  if (bodyFormat === 'html') {
    lines.push('Content-Type: text/html; charset=utf-8');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(options.body);
  } else {
    const altBoundary = generateBoundary();
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push('');
    lines.push(...alternativeParts(options.body, altBoundary));
  }
  lines.push('');

  // Attachment parts
  for (const attachment of options.attachments ?? []) {
    lines.push(`--${boundary}`);
    lines.push(
      `Content-Type: ${attachment.mimeType}; name="${encodeMimeHeader(attachment.filename)}"`,
    );
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(
      `Content-Disposition: attachment; filename="${encodeMimeHeader(attachment.filename)}"`,
    );
    lines.push('');
    lines.push(chunkBase64(attachment.data));
    lines.push('');
  }

  // Closing boundary
  lines.push(`--${boundary}--`);

  return lines.join('\r\n');
}

// Build a MIME message and return as base64url-encoded string for Gmail API
export function buildRawMessage(options: MimeMessageOptions): string {
  const hasAttachments = options.attachments && options.attachments.length > 0;

  const rawMessage = hasAttachments ? buildMultipartMessage(options) : buildSimpleMessage(options);

  // Gmail API requires base64url encoding
  return Buffer.from(rawMessage, 'utf-8').toString('base64url');
}

// Helper to create a draft request body with attachments
export function buildDraftWithAttachments(
  options: MimeMessageOptions,
  threadId?: string,
): { message: { raw: string; threadId?: string } } {
  const raw = buildRawMessage(options);

  const requestBody: { message: { raw: string; threadId?: string } } = {
    message: { raw },
  };

  if (threadId) {
    requestBody.message.threadId = threadId;
  }

  return requestBody;
}
