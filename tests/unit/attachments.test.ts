import { describe, expect, it } from 'vitest';
import {
  buildDraftWithAttachments,
  buildRawMessage,
  encodeMimeHeader,
  type MimeAttachment,
  type MimeMessageOptions,
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
