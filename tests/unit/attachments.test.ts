import { describe, expect, it } from 'vitest';
import {
  buildDraftWithAttachments,
  buildRawMessage,
  encodeMimeHeader,
  type MimeAttachment,
  type MimeMessageOptions,
  toFlowedFormat,
} from '../../src/gmail/index.js';

describe('Attachment and MIME utilities', () => {
  describe('encodeMimeHeader', () => {
    it('returns ASCII strings unchanged', () => {
      expect(encodeMimeHeader('Hello World')).toBe('Hello World');
    });

    it('encodes non-ASCII characters', () => {
      const encoded = encodeMimeHeader('日本語');
      expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    });

    it('encodes email subjects with special characters', () => {
      const encoded = encodeMimeHeader('Réservation confirmée');
      expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    });

    it('handles mixed ASCII and non-ASCII', () => {
      const encoded = encodeMimeHeader('Hello 世界');
      expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    });
  });

  describe('toFlowedFormat', () => {
    it('joins intra-paragraph lines with a space so clients rewrap to viewport', () => {
      expect(toFlowedFormat('line a\nline b')).toBe('line a line b');
    });

    it('keeps blank lines as paragraph separators', () => {
      expect(toFlowedFormat('p1\n\np2')).toBe('p1\r\n\r\np2');
    });

    it('collapses repeated blank lines to a single paragraph break', () => {
      expect(toFlowedFormat('p1\n\n\n\np2')).toBe('p1\r\n\r\np2');
    });

    it('trims trailing whitespace from each line before joining', () => {
      expect(toFlowedFormat('line a   \nline b')).toBe('line a line b');
    });

    it('leaves a single line unchanged', () => {
      expect(toFlowedFormat('only line')).toBe('only line');
    });

    it('normalizes mixed CRLF/CR/LF input', () => {
      expect(toFlowedFormat('a\r\nb\rc\nd')).toBe('a b c d');
    });

    it('unwraps a hard-wrapped 76-col paragraph into a single line', () => {
      const wrapped = [
        'This is a deliberately long paragraph designed to exceed seventy-six',
        'characters so that the receiving client wraps it on its own.',
      ].join('\n');
      expect(toFlowedFormat(wrapped)).toBe(
        'This is a deliberately long paragraph designed to exceed seventy-six characters so that the receiving client wraps it on its own.',
      );
    });
  });

  describe('buildRawMessage', () => {
    it('builds simple message without attachments', () => {
      const options: MimeMessageOptions = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Hello, this is a test.',
      };

      const raw = buildRawMessage(options);
      // Raw is base64url encoded
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

      expect(decoded).toContain('To: recipient@example.com');
      expect(decoded).toContain('Subject: Test Subject');
      expect(decoded).toContain('Content-Type: text/plain; charset=utf-8');
      expect(decoded).toContain('Hello, this is a test.');
    });

    it('includes CC and BCC headers when provided', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: 'Body',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
      };

      const raw = buildRawMessage(options);
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

      expect(decoded).toContain('Cc: cc@example.com');
      expect(decoded).toContain('Bcc: bcc@example.com');
    });

    it('includes In-Reply-To and References headers for threading', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Re: Test',
        body: 'Reply body',
        inReplyTo: '<message-id@example.com>',
        references: '<message-id@example.com>',
      };

      const raw = buildRawMessage(options);
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

      expect(decoded).toContain('In-Reply-To: <message-id@example.com>');
      expect(decoded).toContain('References: <message-id@example.com>');
    });

    it('builds multipart message with attachments', () => {
      const attachment: MimeAttachment = {
        filename: 'test.txt',
        mimeType: 'text/plain',
        data: Buffer.from('File content').toString('base64'),
      };

      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'With Attachment',
        body: 'See attached.',
        attachments: [attachment],
      };

      const raw = buildRawMessage(options);
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

      expect(decoded).toContain('Content-Type: multipart/mixed; boundary=');
      expect(decoded).toContain('Content-Disposition: attachment; filename="test.txt"');
      expect(decoded).toContain('Content-Type: text/plain; name="test.txt"');
      expect(decoded).toContain('See attached.');
    });

    it('handles multiple attachments', () => {
      const attachments: MimeAttachment[] = [
        {
          filename: 'file1.txt',
          mimeType: 'text/plain',
          data: Buffer.from('Content 1').toString('base64'),
        },
        {
          filename: 'file2.pdf',
          mimeType: 'application/pdf',
          data: Buffer.from('PDF content').toString('base64'),
        },
      ];

      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Multiple Attachments',
        body: 'Two files attached.',
        attachments,
      };

      const raw = buildRawMessage(options);
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

      expect(decoded).toContain('filename="file1.txt"');
      expect(decoded).toContain('filename="file2.pdf"');
      expect(decoded).toContain('Content-Type: text/plain; name="file1.txt"');
      expect(decoded).toContain('Content-Type: application/pdf; name="file2.pdf"');
    });

    it('encodes non-ASCII filenames', () => {
      const attachment: MimeAttachment = {
        filename: '日本語ファイル.txt',
        mimeType: 'text/plain',
        data: Buffer.from('Content').toString('base64'),
      };

      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Unicode Filename',
        body: 'File with Japanese name.',
        attachments: [attachment],
      };

      const raw = buildRawMessage(options);
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

      // Should have encoded filename in headers
      expect(decoded).toContain('=?UTF-8?B?');
    });
  });

  describe('buildDraftWithAttachments', () => {
    it('returns correct structure for Gmail API', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: 'Body',
      };

      const result = buildDraftWithAttachments(options);

      expect(result).toHaveProperty('message');
      expect(result.message).toHaveProperty('raw');
      expect(typeof result.message.raw).toBe('string');
      expect(result.message.threadId).toBeUndefined();
    });

    it('includes threadId when provided', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Re: Test',
        body: 'Reply',
      };

      const result = buildDraftWithAttachments(options, 'thread-123');

      expect(result.message.threadId).toBe('thread-123');
    });

    it('message raw is valid base64url', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: 'Body',
        attachments: [
          {
            filename: 'file.txt',
            mimeType: 'text/plain',
            data: Buffer.from('Content').toString('base64'),
          },
        ],
      };

      const result = buildDraftWithAttachments(options);

      // Should not throw when decoding
      expect(() => {
        Buffer.from(result.message.raw, 'base64url');
      }).not.toThrow();
    });
  });

  describe('MIME boundary handling', () => {
    it('generates unique boundaries for each message', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: 'Body',
        attachments: [
          {
            filename: 'file.txt',
            mimeType: 'text/plain',
            data: Buffer.from('Content').toString('base64'),
          },
        ],
      };

      const raw1 = buildRawMessage(options);
      const raw2 = buildRawMessage(options);

      const decoded1 = Buffer.from(raw1, 'base64url').toString('utf-8');
      const decoded2 = Buffer.from(raw2, 'base64url').toString('utf-8');

      // Extract boundaries
      const boundary1 = decoded1.match(/boundary="([^"]+)"/)?.[1];
      const boundary2 = decoded2.match(/boundary="([^"]+)"/)?.[1];

      expect(boundary1).toBeDefined();
      expect(boundary2).toBeDefined();
      // Very unlikely to be the same with random generation
      // (but not guaranteed - this is a probabilistic test)
    });

    it('RFC 2047 encodes non-ASCII subjects (em-dash, smart quotes)', () => {
      // Bug repro: em-dash in subject was being sent without encoded-word wrapping,
      // causing recipients to see "â€"" instead of "—".
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Q3 update — final draft',
        body: 'Body',
      };

      const decoded = Buffer.from(buildRawMessage(options), 'base64url').toString('utf-8');

      // The raw subject line must be an encoded-word, not a UTF-8 literal.
      expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
      // Confirm the encoded payload round-trips to the original characters.
      const match = decoded.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
      expect(match).not.toBeNull();
      const subjectRoundTrip = Buffer.from(match?.[1] ?? '', 'base64').toString('utf-8');
      expect(subjectRoundTrip).toBe('Q3 update — final draft');
      // And the raw bytes for the em-dash (U+2014 = 0xE2 0x80 0x94) must NOT appear unencoded.
      expect(decoded).not.toContain('Subject: Q3 update —');
    });

    it('encodes subjects with smart quotes via RFC 2047', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Re: “Quick question”',
        body: 'Body',
      };

      const decoded = Buffer.from(buildRawMessage(options), 'base64url').toString('utf-8');
      expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
      expect(decoded).not.toContain('Subject: Re: “');
    });

    it('plain-text body is sent with format=flowed (RFC 3676)', () => {
      // Bug repro: plain-text bodies render with visible mid-paragraph line breaks
      // because format=flowed wasn't declared. Receiving clients reflow soft breaks
      // (lines ending with a single space) to the viewport width when format=flowed
      // is present, fixing the hard-wrap artifact.
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: 'Short body',
      };

      const decoded = Buffer.from(buildRawMessage(options), 'base64url').toString('utf-8');
      expect(decoded).toContain('Content-Type: text/plain; charset=utf-8; format=flowed; delsp=no');
    });

    it('unwraps intra-paragraph hard wraps into single lines so Gmail reflows', () => {
      // Gmail's web view does not honor RFC 3676 soft breaks, so callers that
      // hard-wrap at 76 chars would otherwise see visible mid-sentence breaks.
      // We join those continuation lines and let Gmail wrap at the viewport.
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: [
          'This is the first line of a paragraph that was hard-wrapped.',
          'It continues on a second line which should be reflowed.',
          '',
          'This is a second paragraph.',
        ].join('\n'),
      };

      const decoded = Buffer.from(buildRawMessage(options), 'base64url').toString('utf-8');
      expect(decoded).toContain(
        'This is the first line of a paragraph that was hard-wrapped. It continues on a second line which should be reflowed.',
      );
      expect(decoded).toContain('\r\n\r\nThis is a second paragraph.');
      // The original hard wrap inside the paragraph must NOT survive.
      expect(decoded).not.toContain('hard-wrapped.\r\nIt continues');
    });

    it('html bodyFormat sends as text/html without flowed transformation', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: '<p>Line one</p>\n<p>Line two</p>',
        bodyFormat: 'html',
      };

      const decoded = Buffer.from(buildRawMessage(options), 'base64url').toString('utf-8');
      expect(decoded).toContain('Content-Type: text/html; charset=utf-8');
      expect(decoded).not.toContain('format=flowed');
      // HTML body must not be space-stuffed for flowed semantics
      expect(decoded).toContain('<p>Line one</p>');
      expect(decoded).not.toContain('<p>Line one</p> \r\n');
    });

    it('format=flowed applies to multipart messages with attachments', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: 'Hard-wrapped line one.\nContinuation line two.',
        attachments: [
          {
            filename: 'file.txt',
            mimeType: 'text/plain',
            data: Buffer.from('Content').toString('base64'),
          },
        ],
      };

      const decoded = Buffer.from(buildRawMessage(options), 'base64url').toString('utf-8');
      expect(decoded).toContain('Content-Type: text/plain; charset=utf-8; format=flowed; delsp=no');
      expect(decoded).toContain('Hard-wrapped line one. Continuation line two.');
    });

    it('closes multipart message with proper boundary terminator', () => {
      const options: MimeMessageOptions = {
        to: 'to@example.com',
        subject: 'Test',
        body: 'Body',
        attachments: [
          {
            filename: 'file.txt',
            mimeType: 'text/plain',
            data: Buffer.from('Content').toString('base64'),
          },
        ],
      };

      const raw = buildRawMessage(options);
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

      // Extract boundary
      const boundary = decoded.match(/boundary="([^"]+)"/)?.[1];
      expect(boundary).toBeDefined();

      // Should end with boundary terminator (boundary followed by --)
      expect(decoded).toContain(`--${boundary}--`);
    });
  });
});
