import { describe, expect, it } from 'vitest';
import { coerceArgs, coerceBoolean, coerceNumber } from '../../src/utils/coerce.js';

describe('coerceNumber', () => {
  it('converts string integers to numbers', () => {
    expect(coerceNumber('10')).toBe(10);
    expect(coerceNumber('0')).toBe(0);
    expect(coerceNumber('-5')).toBe(-5);
  });

  it('converts string floats to numbers', () => {
    expect(coerceNumber('3.14')).toBe(3.14);
  });

  it('passes through actual numbers unchanged', () => {
    expect(coerceNumber(42)).toBe(42);
  });

  it('passes through non-numeric strings unchanged', () => {
    expect(coerceNumber('abc')).toBe('abc');
    expect(coerceNumber('')).toBe('');
  });

  it('passes through undefined and null unchanged', () => {
    expect(coerceNumber(undefined)).toBe(undefined);
    expect(coerceNumber(null)).toBe(null);
  });
});

describe('coerceBoolean', () => {
  it('converts string "true" to true', () => {
    expect(coerceBoolean('true')).toBe(true);
  });

  it('converts string "false" to false', () => {
    expect(coerceBoolean('false')).toBe(false);
  });

  it('passes through actual booleans unchanged', () => {
    expect(coerceBoolean(true)).toBe(true);
    expect(coerceBoolean(false)).toBe(false);
  });

  it('passes through other strings unchanged', () => {
    expect(coerceBoolean('yes')).toBe('yes');
    expect(coerceBoolean('1')).toBe('1');
    expect(coerceBoolean('')).toBe('');
  });

  it('passes through undefined and null unchanged', () => {
    expect(coerceBoolean(undefined)).toBe(undefined);
    expect(coerceBoolean(null)).toBe(null);
  });
});

describe('coerceArgs', () => {
  it('coerces number fields from string to number', () => {
    const args = { maxResults: '20' as unknown as number, query: 'test' };
    const result = coerceArgs(args, { maxResults: 'number' });
    expect(result.maxResults).toBe(20);
    expect(typeof result.maxResults).toBe('number');
    expect(result.query).toBe('test');
  });

  it('coerces boolean fields from string to boolean', () => {
    const args = { confirm: 'true' as unknown as boolean, id: 'abc' };
    const result = coerceArgs(args, { confirm: 'boolean' });
    expect(result.confirm).toBe(true);
    expect(typeof result.confirm).toBe('boolean');
  });

  it('coerces "false" string to boolean false', () => {
    const args = { confirm: 'false' as unknown as boolean };
    const result = coerceArgs(args, { confirm: 'boolean' });
    expect(result.confirm).toBe(false);
    expect(typeof result.confirm).toBe('boolean');
  });

  it('handles multiple fields with mixed types', () => {
    const args = {
      maxResults: '10' as unknown as number,
      confirm: 'true' as unknown as boolean,
      markAsRead: 'false' as unknown as boolean,
      query: 'hello',
    };
    const result = coerceArgs(args, {
      maxResults: 'number',
      confirm: 'boolean',
      markAsRead: 'boolean',
    });
    expect(result.maxResults).toBe(10);
    expect(result.confirm).toBe(true);
    expect(result.markAsRead).toBe(false);
    expect(result.query).toBe('hello');
  });

  it('leaves already-correct types unchanged', () => {
    const args = { maxResults: 20, confirm: true };
    const result = coerceArgs(args, { maxResults: 'number', confirm: 'boolean' });
    expect(result.maxResults).toBe(20);
    expect(result.confirm).toBe(true);
  });

  it('skips undefined fields', () => {
    const args = { maxResults: undefined, query: 'test' };
    const result = coerceArgs(args, { maxResults: 'number' });
    expect(result.maxResults).toBe(undefined);
  });

  it('skips fields not in spec', () => {
    const args = { query: 'test', extra: 'value' };
    const result = coerceArgs(args, { maxResults: 'number' });
    expect(result.query).toBe('test');
    expect(result.extra).toBe('value');
  });

  it('mutates args in place', () => {
    const args = { maxResults: '5' as unknown as number };
    const result = coerceArgs(args, { maxResults: 'number' });
    expect(result).toBe(args);
    expect(args.maxResults).toBe(5);
  });

  it('handles real-world MCP scenario: gmail_search_messages', () => {
    // MCP client sends all params as strings
    const args = {
      accountId: 'acc-123',
      query: 'from:user@example.com',
      maxResults: '10' as unknown as number,
    };
    coerceArgs(args, { maxResults: 'number' });
    expect(args.maxResults).toBe(10);
    expect(typeof args.maxResults).toBe('number');
  });

  it('handles real-world MCP scenario: gmail_send_draft confirm gate', () => {
    // MCP client sends boolean as string "true"
    const args = {
      accountId: 'acc-123',
      draftId: 'draft-456',
      confirm: 'true' as unknown as boolean,
    };
    coerceArgs(args, { confirm: 'boolean' });
    expect(args.confirm).toBe(true);
    // This should now pass the confirm !== true check
    expect(args.confirm === true).toBe(true);
  });
});
