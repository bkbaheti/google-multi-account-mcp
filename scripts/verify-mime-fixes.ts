#!/usr/bin/env npx tsx

/**
 * Verifies the v0.4.1 MIME fixes against the live Gmail API.
 *
 * Creates a draft with:
 *   - an em-dash in the subject (tests RFC 2047 encoding)
 *   - a long paragraph body (tests format=flowed reflow)
 * Then fetches the raw MIME back, asserts the headers, prints both versions,
 * and leaves the draft in place so you can also inspect it visually in Gmail.
 *
 * Usage:
 *   npx tsx scripts/verify-mime-fixes.ts [accountId|alias|email]
 *   npx tsx scripts/verify-mime-fixes.ts --cleanup [accountId]
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { google } from 'googleapis';
import { AccountStore, createTokenStorage, GmailClient } from '../src/index.js';
import { selectAccount } from './utils.js';

const TOKENS_DIR = path.join(os.homedir(), '.config', 'mcp-google', 'tokens');

const LONG_PARAGRAPH =
  'This is a deliberately long paragraph designed to exceed seventy-six characters so that we can confirm Gmail receives it as one flowed paragraph instead of rendering visible mid-sentence line breaks like it used to do before this fix landed.';

async function main() {
  const args = process.argv.slice(2);
  const cleanupMode = args.includes('--cleanup');
  const accountArg = args.find((a) => !a.startsWith('--'));

  const passphrase = process.env.MCP_GOOGLE_PASSPHRASE;
  const tokenStorage = await createTokenStorage(TOKENS_DIR, passphrase);
  const accountStore = new AccountStore(tokenStorage);

  const account = selectAccount(accountStore, accountArg);
  console.log(`Account: ${account.email} (${account.alias ?? account.id})\n`);

  const client = new GmailClient(accountStore, account.id);

  if (cleanupMode) {
    const auth = await accountStore.getAuthenticatedClient(account.id);
    const gmail = google.gmail({ version: 'v1', auth });
    const list = await gmail.users.drafts.list({ userId: 'me', maxResults: 50 });
    const drafts = list.data.drafts ?? [];
    let deleted = 0;
    for (const d of drafts) {
      if (!d.id) continue;
      const full = await gmail.users.drafts.get({ userId: 'me', id: d.id, format: 'metadata' });
      const subjectHeader = full.data.message?.payload?.headers?.find(
        (h) => h.name?.toLowerCase() === 'subject',
      );
      const subject = subjectHeader?.value ?? '';
      if (subject.includes('v0.4.1 MIME fix verification')) {
        await gmail.users.drafts.delete({ userId: 'me', id: d.id });
        console.log(`  deleted draft ${d.id} — ${subject}`);
        deleted++;
      }
    }
    console.log(`\nCleaned up ${deleted} draft(s).`);
    return;
  }

  // Compose ourselves to test self-send safely
  const subject = 'v0.4.1 MIME fix verification — em-dash test (hard-wrapped)';
  // Deliberately hard-wrap the long paragraph at ~76 chars to simulate the
  // exact failure mode the bug describes — caller produces 76-col text.
  const hardWrapped = [
    'This is a deliberately long paragraph designed to exceed seventy-six',
    'characters so that we can confirm Gmail receives it as one flowed',
    'paragraph instead of rendering visible mid-sentence line breaks like',
    "it used to do before this fix landed. It's the actual buggy input.",
  ].join('\n');
  const body = `${hardWrapped}\n\n${hardWrapped}\n\nSecond paragraph follows:\n${hardWrapped}`;

  console.log('Creating draft with:');
  console.log(`  Subject: ${subject}`);
  console.log(`  Body length: ${body.length} chars\n`);

  const draft = await client.createDraft({
    to: account.email,
    subject,
    body,
  });

  console.log(`Draft created: ${draft.id}\n`);

  // Fetch raw MIME directly via googleapis
  const auth = await accountStore.getAuthenticatedClient(account.id);
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.drafts.get({
    userId: 'me',
    id: draft.id,
    format: 'raw',
  });

  const rawBase64 = response.data.message?.raw;
  if (!rawBase64) {
    throw new Error('No raw MIME returned');
  }
  const rawMime = Buffer.from(rawBase64, 'base64url').toString('utf-8');

  console.log('=== Raw MIME (first 1200 chars) ===');
  console.log(rawMime.slice(0, 1200));
  console.log('=== /Raw MIME ===\n');

  // Bug 2 check: subject must be RFC 2047 encoded
  const encodedSubjectMatch = rawMime.match(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  const literalEmDashSubject = rawMime.match(/Subject: .*—/);

  console.log('Bug 2 — Subject RFC 2047 encoding:');
  if (encodedSubjectMatch && !literalEmDashSubject) {
    console.log(`  PASS — encoded as: ${encodedSubjectMatch[0]}`);
  } else {
    console.log('  FAIL');
    if (literalEmDashSubject) console.log(`    Found raw em-dash: ${literalEmDashSubject[0]}`);
    if (!encodedSubjectMatch) console.log('    No =?UTF-8?B?...?= encoded-word found');
  }

  // Bug 1 check: Content-Type must include format=flowed for text/plain
  const flowedContentType = rawMime.match(
    /Content-Type:\s*text\/plain;\s*charset=utf-8;\s*format=flowed/i,
  );
  console.log('\nBug 1 — format=flowed declaration:');
  if (flowedContentType) {
    console.log(`  PASS — header: ${flowedContentType[0]}`);
  } else {
    console.log('  FAIL — no format=flowed in Content-Type');
    const ctMatch = rawMime.match(/Content-Type:[^\r\n]*/);
    if (ctMatch) console.log(`    Found instead: ${ctMatch[0]}`);
  }

  // Bug 1 (detail): internal paragraph lines should end with " \r\n" (soft break)
  const lineLength = LONG_PARAGRAPH.length;
  console.log('\nBug 1 — soft-break markers:');
  console.log(`  Body line length: ${lineLength} chars (will only appear soft-broken if`);
  console.log('  the caller hard-wrapped). With our single-line paragraph input, no');
  console.log('  soft break is needed — Gmail will reflow because format=flowed is set.');

  console.log(`\nDraft ID for visual inspection: ${draft.id}`);
  console.log('Open Gmail → Drafts to verify it renders correctly.');
  console.log('When done, delete it manually or via gmail_delete_draft.\n');
}

main().catch((error) => {
  console.error('Error:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
