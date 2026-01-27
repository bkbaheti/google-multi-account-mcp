import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRateLimitState,
  getAccountRateLimitState,
  getBackoffRemainingMs,
  isAccountInBackoff,
  recordRateLimitError,
  recordSuccessfulRequest,
  withRetry,
} from '../../src/utils/retry.js';

describe('Retry utilities', () => {
  beforeEach(() => {
    clearRateLimitState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withRetry', () => {
    it('returns result on successful call', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await withRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('throws immediately on non-retryable error', async () => {
      const error = Object.assign(new Error('Bad request'), { status: 400 });
      const operation = vi.fn().mockRejectedValue(error);

      await expect(withRetry(operation)).rejects.toThrow('Bad request');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 rate limit error', async () => {
      const error = Object.assign(new Error('Rate limited'), { status: 429 });
      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const resultPromise = withRetry(operation, { initialDelayMs: 100 });

      // Fast-forward through the retry delay
      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 server error', async () => {
      const error = Object.assign(new Error('Server error'), { status: 500 });
      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('recovered');

      const resultPromise = withRetry(operation, { initialDelayMs: 100 });
      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('recovered');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('respects maxRetries limit', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const error = Object.assign(new Error('Always fails'), { status: 503 });
      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 10, // Short delays for testing
        }),
      ).rejects.toThrow('Always fails');

      expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('applies exponential backoff', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const error = Object.assign(new Error('Rate limited'), { status: 429 });
      const delays: number[] = [];

      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(operation, {
          maxRetries: 2,
          initialDelayMs: 10, // Very short delays for testing
          backoffMultiplier: 2,
          onRetry: (_err, _attempt, delayMs) => {
            delays.push(delayMs);
          },
        }),
      ).rejects.toThrow();

      // Verify exponential growth (with jitter tolerance)
      expect(delays).toHaveLength(2);
      // Second delay should be roughly double the first (±25% jitter)
      expect(delays[1]! / delays[0]!).toBeGreaterThan(1.2);
      expect(delays[1]! / delays[0]!).toBeLessThan(3);
    });

    it('caps delay at maxDelayMs', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const error = Object.assign(new Error('Rate limited'), { status: 429 });
      const delays: number[] = [];

      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 50,
          maxDelayMs: 60, // Very short for testing
          backoffMultiplier: 2,
          onRetry: (_err, _attempt, delayMs) => {
            delays.push(delayMs);
          },
        }),
      ).rejects.toThrow();

      // All delays should be capped at maxDelayMs (±25% jitter)
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(60 * 1.25);
      }
    });

    it('handles Google API error format with code property', async () => {
      const error = Object.assign(new Error('Quota exceeded'), { code: 429 });
      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const resultPromise = withRetry(operation, { initialDelayMs: 100 });
      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('success');
    });

    it('handles axios-style error with response.status', async () => {
      const error = Object.assign(new Error('Service unavailable'), {
        response: { status: 503 },
      });
      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('recovered');

      const resultPromise = withRetry(operation, { initialDelayMs: 100 });
      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('recovered');
    });

    it('calls onRetry callback with correct arguments', async () => {
      const error = Object.assign(new Error('Rate limited'), { status: 429 });
      const onRetry = vi.fn();
      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const resultPromise = withRetry(operation, {
        initialDelayMs: 100,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(200);
      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(error, 1, expect.any(Number));
    });
  });

  describe('per-account rate limit state', () => {
    it('initializes state for new account', () => {
      const state = getAccountRateLimitState('account-1');

      expect(state.lastError).toBeNull();
      expect(state.consecutiveErrors).toBe(0);
      expect(state.backoffUntil).toBeNull();
    });

    it('records rate limit error', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      recordRateLimitError('account-1');

      const state = getAccountRateLimitState('account-1');
      expect(state.lastError).toEqual(new Date('2024-01-01T12:00:00Z'));
      expect(state.consecutiveErrors).toBe(1);
      expect(state.backoffUntil).not.toBeNull();
    });

    it('increases backoff on consecutive errors', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      recordRateLimitError('account-1');
      const state1 = getAccountRateLimitState('account-1');
      const backoff1 = state1.backoffUntil!.getTime() - Date.now();

      recordRateLimitError('account-1');
      const state2 = getAccountRateLimitState('account-1');
      const backoff2 = state2.backoffUntil!.getTime() - Date.now();

      expect(backoff2).toBeGreaterThan(backoff1);
    });

    it('clears consecutive errors on success', () => {
      recordRateLimitError('account-1');
      recordRateLimitError('account-1');
      recordSuccessfulRequest('account-1');

      const state = getAccountRateLimitState('account-1');
      expect(state.consecutiveErrors).toBe(0);
      expect(state.backoffUntil).toBeNull();
    });

    it('isAccountInBackoff returns true during backoff', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      recordRateLimitError('account-1');

      expect(isAccountInBackoff('account-1')).toBe(true);
    });

    it('isAccountInBackoff returns false after backoff expires', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      recordRateLimitError('account-1');

      // Advance past the backoff period
      vi.setSystemTime(new Date('2024-01-01T12:01:00Z'));

      expect(isAccountInBackoff('account-1')).toBe(false);
    });

    it('getBackoffRemainingMs returns correct value', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      recordRateLimitError('account-1');

      const state = getAccountRateLimitState('account-1');
      const expectedRemaining = state.backoffUntil!.getTime() - Date.now();

      expect(getBackoffRemainingMs('account-1')).toBe(expectedRemaining);
    });

    it('getBackoffRemainingMs returns 0 for account not in backoff', () => {
      expect(getBackoffRemainingMs('new-account')).toBe(0);
    });

    it('clearRateLimitState clears all state', () => {
      recordRateLimitError('account-1');
      recordRateLimitError('account-2');

      clearRateLimitState();

      expect(getAccountRateLimitState('account-1').consecutiveErrors).toBe(0);
      expect(getAccountRateLimitState('account-2').consecutiveErrors).toBe(0);
    });

    it('isolates state between accounts', () => {
      recordRateLimitError('account-1');
      recordRateLimitError('account-1');
      recordRateLimitError('account-2');

      expect(getAccountRateLimitState('account-1').consecutiveErrors).toBe(2);
      expect(getAccountRateLimitState('account-2').consecutiveErrors).toBe(1);
    });
  });
});
