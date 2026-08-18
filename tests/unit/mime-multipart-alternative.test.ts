import { describe, expect, it } from 'vitest';
import { buildRawMessage, textToHtml } from '../../src/gmail/mime.js';

// A plain-text body cannot express the difference between an intentional line
// break and a soft wrap in a way Gmail's web client honours — it ignores RFC
// 3676 format=flowed. The previous approach joined every line within a
// paragraph so nothing broke mid-sentence, which silently destroyed lists,
// addresses, signatures and code. Sending multipart/alternative lets the
// text/plain part stay verbatim while the generated text/html part gives web
// clients something they will reflow correctly.

function decode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf-8');
}

function partBetween(message: string, contentType: string): string {
  const start = message.indexOf(contentType);
  if (start === -1) return '';
  const afterHeaders = message.indexOf('\r\n\r\n', start);
  const nextBoundary = message.indexOf('\r\n--', afterHeaders);
  return message.slice(afterHeaders + 4, nextBoundary === -1 ? undefined : nextBoundary);
}

const BULLETS = [
  'Fixed and released:',
  '',
  '- First bullet that is quite long and would previously have been joined.',
  '- Second bullet.',
  '- Third bullet.',
  '',
  'Best regards,',
  'Braj',
].join('\n');

describe('textToHtml', () => {
  it('turns a single newline into <br> so intentional breaks survive', () => {
    expect(textToHtml('Best regards,\nBraj')).toBe('<p>Best regards,<br>Braj</p>');
  });

  it('turns a blank line into a paragraph break', () => {
    expect(textToHtml('one\n\ntwo')).toBe('<p>one</p>\r\n<p>two</p>');
  });

  it('escapes HTML so body text cannot inject markup', () => {
    // Bodies are agent-authored and may contain <, > or & from code or URLs.
    expect(textToHtml('a < b & c > d')).toBe('<p>a &lt; b &amp; c &gt; d</p>');
  });

  it('escapes quotes as well', () => {
    expect(textToHtml('say "hi"')).toBe('<p>say &quot;hi&quot;</p>');
  });

  it('collapses runs of blank lines into a single paragraph break', () => {
    expect(textToHtml('one\n\n\n\ntwo')).toBe('<p>one</p>\r\n<p>two</p>');
  });

  it('normalises CRLF and bare CR before converting', () => {
    expect(textToHtml('a\r\nb')).toBe('<p>a<br>b</p>');
  });
});

describe('plain-text bodies are sent as multipart/alternative', () => {
  it('declares multipart/alternative with both parts', () => {
    const msg = decode(buildRawMessage({ to: 'a@b.com', subject: 's', body: BULLETS }));
    expect(msg).toContain('Content-Type: multipart/alternative; boundary=');
    expect(msg).toContain('Content-Type: text/plain; charset=utf-8');
    expect(msg).toContain('Content-Type: text/html; charset=utf-8');
  });

  it('keeps the text/plain part byte-for-byte as the caller wrote it', () => {
    // This is the regression: three bullets and a two-line sign-off were
    // previously joined into one run-on line.
    const msg = decode(buildRawMessage({ to: 'a@b.com', subject: 's', body: BULLETS }));
    const plain = partBetween(msg, 'Content-Type: text/plain');
    expect(plain).toContain(
      '- First bullet that is quite long and would previously have been joined.\r\n- Second bullet.',
    );
    expect(plain).toContain('- Second bullet.\r\n- Third bullet.');
    expect(plain).toContain('Best regards,\r\nBraj');
  });

  it('no longer declares format=flowed, which Gmail ignores anyway', () => {
    const msg = decode(buildRawMessage({ to: 'a@b.com', subject: 's', body: BULLETS }));
    expect(msg).not.toContain('format=flowed');
  });

  it('gives the html part <br>-separated bullets rather than a run-on line', () => {
    const msg = decode(buildRawMessage({ to: 'a@b.com', subject: 's', body: BULLETS }));
    const html = partBetween(msg, 'Content-Type: text/html');
    expect(html).toContain(
      '- First bullet that is quite long and would previously have been joined.<br>- Second bullet.<br>- Third bullet.',
    );
    expect(html).toContain('Best regards,<br>Braj');
  });

  it('puts text/plain before text/html, since clients pick the last part they support', () => {
    const msg = decode(buildRawMessage({ to: 'a@b.com', subject: 's', body: 'hi' }));
    expect(msg.indexOf('text/plain')).toBeLessThan(msg.indexOf('text/html'));
  });
});

describe('explicit html bodyFormat is unchanged', () => {
  it('sends a single text/html part with the caller markup untouched', () => {
    const body = '<p>Hand written <b>markup</b></p>';
    const msg = decode(buildRawMessage({ to: 'a@b.com', subject: 's', body, bodyFormat: 'html' }));
    expect(msg).toContain('Content-Type: text/html; charset=utf-8');
    expect(msg).not.toContain('multipart/alternative');
    expect(msg).toContain(body);
  });
});

describe('attachments still work alongside the alternative parts', () => {
  const withAttachment = {
    to: 'a@b.com',
    subject: 's',
    body: BULLETS,
    attachments: [{ filename: 'a.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }],
  };

  it('nests multipart/alternative inside multipart/mixed', () => {
    const msg = decode(buildRawMessage(withAttachment));
    expect(msg).toContain('Content-Type: multipart/mixed; boundary=');
    expect(msg).toContain('Content-Type: multipart/alternative; boundary=');
    expect(msg.indexOf('multipart/mixed')).toBeLessThan(msg.indexOf('multipart/alternative'));
  });

  it('uses a different boundary for the inner part so parsing is unambiguous', () => {
    const msg = decode(buildRawMessage(withAttachment));
    const outer = /multipart\/mixed; boundary="([^"]+)"/.exec(msg)?.[1];
    const inner = /multipart\/alternative; boundary="([^"]+)"/.exec(msg)?.[1];
    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
    expect(outer).not.toBe(inner);
  });

  it('still carries the attachment', () => {
    const msg = decode(buildRawMessage(withAttachment));
    expect(msg).toContain('Content-Disposition: attachment; filename="a.txt"');
    expect(msg).toContain('aGVsbG8=');
  });

  it('preserves the caller line breaks in the attached message text part too', () => {
    const msg = decode(buildRawMessage(withAttachment));
    expect(msg).toContain('Best regards,\r\nBraj');
  });
});
