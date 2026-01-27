// MIME utilities for building multipart email messages

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: string; // base64-encoded
}

export interface MimeMessageOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  attachments?: MimeAttachment[] | undefined;
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

// Build a simple text message (no attachments)
function buildSimpleMessage(options: MimeMessageOptions): string {
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
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('Content-Transfer-Encoding: 7bit');
  lines.push('');
  lines.push(options.body);

  return lines.join('\r\n');
}

// Build a multipart message with attachments
function buildMultipartMessage(options: MimeMessageOptions): string {
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

  // Text body part
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('Content-Transfer-Encoding: 7bit');
  lines.push('');
  lines.push(options.body);
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
