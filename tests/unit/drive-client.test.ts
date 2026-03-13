import { describe, expect, it } from 'vitest';

describe('DriveClient', () => {
  it('exists and can be imported', async () => {
    const { DriveClient } = await import('../../src/drive/index.js');
    expect(DriveClient).toBeDefined();
  }, 30_000);
});
