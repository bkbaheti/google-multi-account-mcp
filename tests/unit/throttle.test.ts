import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucket, withThrottle } from '../../src/utils/throttle.js';

describe('Throttle utilities', () => {
  describe('TokenBucket', () => {
    let bucket: TokenBucket;

    beforeEach(() => {
      bucket = new TokenBucket({
        tokensPerSecond: 10,
        bucketSize: 10,
      });
    });

    it('starts with full bucket', () => {
      expect(bucket.getTokenCount('account-1')).toBe(10);
    });

    it('tryConsume succeeds when tokens available', () => {
      expect(bucket.tryConsume('account-1')).toBe(true);
      expect(bucket.getTokenCount('account-1')).toBe(9);
    });

    it('tryConsume fails when bucket empty', () => {
      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        bucket.tryConsume('account-1');
      }

      expect(bucket.tryConsume('account-1')).toBe(false);
    });

    it('tryConsume respects cost parameter', () => {
      expect(bucket.tryConsume('account-1', 5)).toBe(true);
      // Use toBeCloseTo due to time-based token refill
      expect(bucket.getTokenCount('account-1')).toBeCloseTo(5, 0);

      // Can't consume 6 more (even with small refill)
      expect(bucket.tryConsume('account-1', 7)).toBe(false);

      // Can consume 5 more
      expect(bucket.tryConsume('account-1', 5)).toBe(true);
    });

    it('refills tokens over time', async () => {
      // Drain some tokens
      bucket.tryConsume('account-1', 5);
      expect(bucket.getTokenCount('account-1')).toBe(5);

      // Wait 500ms - should refill 5 tokens (10 tokens/sec)
      await new Promise((r) => setTimeout(r, 500));

      // Should have refilled ~5 tokens
      expect(bucket.getTokenCount('account-1')).toBeGreaterThanOrEqual(9);
    });

    it('caps refill at bucket size', async () => {
      // Start full
      expect(bucket.getTokenCount('account-1')).toBe(10);

      // Wait some time
      await new Promise((r) => setTimeout(r, 100));

      // Should still be capped at 10
      expect(bucket.getTokenCount('account-1')).toBe(10);
    });

    it('getWaitTime returns 0 when tokens available', () => {
      expect(bucket.getWaitTime('account-1')).toBe(0);
    });

    it('getWaitTime returns correct wait time when empty', () => {
      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        bucket.tryConsume('account-1');
      }

      // Should need to wait 100ms for 1 token (10 tokens/sec)
      const waitTime = bucket.getWaitTime('account-1');
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(100);
    });

    it('waitAndConsume waits for token', async () => {
      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        bucket.tryConsume('account-1');
      }

      const start = Date.now();
      await bucket.waitAndConsume('account-1');
      const elapsed = Date.now() - start;

      // Should have waited ~100ms
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('isolates buckets between accounts', () => {
      bucket.tryConsume('account-1', 10); // Drain account-1

      // account-2 should still have full bucket
      expect(bucket.getTokenCount('account-2')).toBe(10);
    });

    it('reset clears specific account', () => {
      bucket.tryConsume('account-1', 10);
      bucket.reset('account-1');

      // Should have full bucket again
      expect(bucket.getTokenCount('account-1')).toBe(10);
    });

    it('clear clears all accounts', () => {
      bucket.tryConsume('account-1', 10);
      bucket.tryConsume('account-2', 5);

      bucket.clear();

      // Both should have full buckets
      expect(bucket.getTokenCount('account-1')).toBe(10);
      expect(bucket.getTokenCount('account-2')).toBe(10);
    });

    it('configure updates settings', () => {
      bucket.configure({ bucketSize: 20 });
      bucket.clear(); // Reset to apply new bucket size

      expect(bucket.getTokenCount('account-1')).toBe(20);
    });
  });

  describe('withThrottle', () => {
    it('executes operation with available tokens', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      // Use global throttle but test the concept
      const result = await withThrottle('account-test', operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('returns operation result', async () => {
      const operation = vi.fn().mockResolvedValue({ data: 'value' });

      const result = await withThrottle('account-test', operation);

      expect(result).toEqual({ data: 'value' });
    });

    it('propagates operation errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('API error'));

      await expect(withThrottle('account-test', operation)).rejects.toThrow('API error');
    });
  });
});
