#!/usr/bin/env npx tsx

/**
 * Seed the persistent E2E fixtures in Drive. Idempotent: re-running reuses
 * whatever already exists and only creates what is missing. Never deletes.
 *
 * Usage: pnpm e2e:seed [accountAlias]
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { google } from 'googleapis';
import { AccountStore, createTokenStorage } from '../../src/index.js';
import { type FixtureSet, loadE2eConfig, saveE2eConfig } from './config.js';
import {
  CONTRACT_DOC_NAME,
  CONTRACT_DOC_TEXT,
  createNativeDoc,
  createNativeSheet,
  DRAWING_NAME,
  FIXTURE_FOLDER_NAME,
  findChildByName,
  findOrCreateFolder,
  QUOTED_SENTENCE,
  readBackQuotedText,
  SHEET_CSV,
  SHEET_NAME,
  seedAnchoredComment,
  tryCreateDrawing,
} from './drive-fixtures.js';

const TOKENS_DIR = path.join(os.homedir(), '.config', 'mcp-google', 'tokens');

async function main(): Promise<void> {
  const config = loadE2eConfig();
  const alias = process.argv[2] ?? config.accounts.primary;

  const tokenStorage = await createTokenStorage(TOKENS_DIR, process.env['MCP_GOOGLE_PASSPHRASE']);
  const accountStore = new AccountStore(tokenStorage);

  const account = accountStore.resolveAccount(alias);
  if (!account) {
    throw new Error(`No account matches "${alias}". Run: npx tsx scripts/test-oauth.ts list`);
  }

  const auth = await accountStore.getAuthenticatedClient(account.id);
  const drive = google.drive({ version: 'v3', auth });

  console.log(`Seeding fixtures for ${alias} (${account.email})`);

  const folder = await findOrCreateFolder(drive, FIXTURE_FOLDER_NAME);
  console.log(`  folder    ${folder.created ? 'created' : 'reused '}  ${folder.id}`);

  const fixtures: FixtureSet = { folderId: folder.id };

  // Doc + comment
  let docId = await findChildByName(drive, folder.id, CONTRACT_DOC_NAME);
  if (docId) {
    console.log(`  doc       reused   ${docId}`);
  } else {
    docId = await createNativeDoc(drive, folder.id, CONTRACT_DOC_NAME, CONTRACT_DOC_TEXT);
    console.log(`  doc       created  ${docId}`);

    const commentId = await seedAnchoredComment(
      drive,
      docId,
      QUOTED_SENTENCE,
      'Cap this at fees paid in the preceding 12 months.',
    );
    const quoted = await readBackQuotedText(drive, docId, commentId);
    fixtures.anchoredCommentSupported = quoted === QUOTED_SENTENCE;

    console.log(
      fixtures.anchoredCommentSupported
        ? '  comment   created  anchored, quotedText confirmed'
        : '  comment   created  UNANCHORED — quotedText not returned by Drive',
    );
  }
  fixtures.contractDocId = docId;

  // Sheet
  const existingSheet = await findChildByName(drive, folder.id, SHEET_NAME);
  fixtures.sheetId =
    existingSheet ?? (await createNativeSheet(drive, folder.id, SHEET_NAME, SHEET_CSV));
  console.log(`  sheet     ${existingSheet ? 'reused ' : 'created'}  ${fixtures.sheetId}`);

  // Drawing — may legitimately fail
  const existingDrawing = await findChildByName(drive, folder.id, DRAWING_NAME);
  const drawingId = existingDrawing ?? (await tryCreateDrawing(drive, folder.id, DRAWING_NAME));
  if (drawingId) {
    fixtures.drawingId = drawingId;
    console.log(`  drawing   ${existingDrawing ? 'reused ' : 'created'}  ${drawingId}`);
  } else {
    console.log('  drawing   FAILED   create one by hand in the fixtures folder:');
    console.log('            Drive > New > More > Google Drawings, then re-run this script.');
  }

  config.fixtures[alias] = fixtures;
  saveE2eConfig(config);
  console.log('\nWrote e2e.config.json');

  if (fixtures.anchoredCommentSupported === false) {
    console.log('\nACTION NEEDED: open the fixture Doc, highlight the sentence containing');
    console.log(`"${QUOTED_SENTENCE}", and add a comment by hand. The suite needs one`);
    console.log('anchored comment to assert quotedText against.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
