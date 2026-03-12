import { describe, expect, it } from 'vitest';

describe('CalendarClient', () => {
  it('exists and can be imported', async () => {
    const { CalendarClient } = await import('../../src/calendar/index.js');
    expect(CalendarClient).toBeDefined();
  }, 30_000);
});
