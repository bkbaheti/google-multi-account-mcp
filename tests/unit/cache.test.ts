import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LRUCache, withCache } from '../../src/utils/cache.js';

describe('Cache utilities', () => {
  describe('LRUCache', () => {
    let cache: LRUCache<string>;

    beforeEach(() => {
      cache = new LRUCache({ maxSize: 5, defaultTtlMs: 1000 });
    });

    afterEach(() => {
      cache.clear();
    });

    describe('basic operations', () => {
      it('stores and retrieves values', () => {
        cache.set('key1', 'value1');
        const entry = cache.get('key1');

        expect(entry).toBeDefined();
        expect(entry?.value).toBe('value1');
      });

      it('returns undefined for missing keys', () => {
        expect(cache.get('nonexistent')).toBeUndefined();
      });

      it('deletes entries', () => {
        cache.set('key1', 'value1');
        expect(cache.delete('key1')).toBe(true);
        expect(cache.get('key1')).toBeUndefined();
      });

      it('tracks cache size', () => {
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');

        expect(cache.size()).toBe(2);
      });

      it('clears all entries', () => {
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        cache.clear();

        expect(cache.size()).toBe(0);
      });
    });

    describe('TTL expiration', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('returns entry before TTL expires', () => {
        cache.set('key1', 'value1', 1000);

        vi.advanceTimersByTime(500);

        expect(cache.get('key1')?.value).toBe('value1');
      });

      it('returns undefined after TTL expires', () => {
        cache.set('key1', 'value1', 1000);

        vi.advanceTimersByTime(1001);

        expect(cache.get('key1')).toBeUndefined();
      });

      it('tracks TTL remaining in getWithMeta', () => {
        cache.set('key1', 'value1', 1000);

        vi.advanceTimersByTime(300);

        const result = cache.getWithMeta('key1');
        expect(result.cacheHit).toBe(true);
        if (result.cacheHit) {
          expect(result.ttlRemainingMs).toBeLessThanOrEqual(700);
          expect(result.ttlRemainingMs).toBeGreaterThan(600);
        }
      });

      it('returns cacheHit false for missing keys', () => {
        const result = cache.getWithMeta('nonexistent');
        expect(result.cacheHit).toBe(false);
      });
    });

    describe('LRU eviction', () => {
      it('evicts oldest entries when at capacity', () => {
        // Fill the cache (maxSize = 5)
        for (let i = 0; i < 5; i++) {
          cache.set(`key${i}`, `value${i}`);
        }

        // Add one more - should evict key0
        cache.set('key5', 'value5');

        expect(cache.get('key0')).toBeUndefined();
        expect(cache.get('key5')?.value).toBe('value5');
        expect(cache.size()).toBe(5);
      });

      it('updates LRU order on access', () => {
        // Fill the cache
        for (let i = 0; i < 5; i++) {
          cache.set(`key${i}`, `value${i}`);
        }

        // Access key0 to make it most recently used
        cache.get('key0');

        // Add new entry - should evict key1 (now oldest)
        cache.set('key5', 'value5');

        expect(cache.get('key0')?.value).toBe('value0');
        expect(cache.get('key1')).toBeUndefined();
      });

      it('updates LRU order on set of existing key', () => {
        // Fill the cache
        for (let i = 0; i < 5; i++) {
          cache.set(`key${i}`, `value${i}`);
        }

        // Update key0
        cache.set('key0', 'updated');

        // Add new entry - should evict key1
        cache.set('key5', 'value5');

        expect(cache.get('key0')?.value).toBe('updated');
        expect(cache.get('key1')).toBeUndefined();
      });
    });

    describe('cache statistics', () => {
      it('tracks hits and misses', () => {
        cache.set('key1', 'value1');

        cache.get('key1'); // hit
        cache.get('key1'); // hit
        cache.get('key2'); // miss

        const stats = cache.getStats();
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBeCloseTo(0.667, 2);
      });

      it('tracks evictions', () => {
        // Fill and overflow
        for (let i = 0; i < 7; i++) {
          cache.set(`key${i}`, `value${i}`);
        }

        const stats = cache.getStats();
        expect(stats.evictions).toBe(2);
      });

      it('resets statistics', () => {
        cache.set('key1', 'value1');
        cache.get('key1');
        cache.resetStats();

        const stats = cache.getStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
      });
    });

    describe('pattern invalidation', () => {
      it('invalidates entries matching pattern', () => {
        cache.set('account1:message:1', 'msg1');
        cache.set('account1:message:2', 'msg2');
        cache.set('account1:search:query1', 'results1');
        cache.set('account2:message:1', 'msg3');

        const count = cache.invalidatePattern(/^account1:message:/);

        expect(count).toBe(2);
        expect(cache.get('account1:message:1')).toBeUndefined();
        expect(cache.get('account1:message:2')).toBeUndefined();
        expect(cache.get('account1:search:query1')?.value).toBe('results1');
        expect(cache.get('account2:message:1')?.value).toBe('msg3');
      });

      it('invalidates all entries for an account', () => {
        cache.set('account1:message:1', 'msg1');
        cache.set('account1:search:query1', 'results1');
        cache.set('account2:message:1', 'msg2');

        cache.invalidateAccount('account1');

        expect(cache.get('account1:message:1')).toBeUndefined();
        expect(cache.get('account1:search:query1')).toBeUndefined();
        expect(cache.get('account2:message:1')?.value).toBe('msg2');
      });

      it('invalidates for message modification', () => {
        cache.set('account1:search:query1', 'results1');
        cache.set('account1:labels:list', 'labels');
        cache.set('account1:message:msg123', 'message');
        cache.set('account1:thread:thread1', 'thread');
        cache.set('account1:other:data', 'other');

        cache.invalidateForMessageModification('account1', 'msg123');

        expect(cache.get('account1:search:query1')).toBeUndefined();
        expect(cache.get('account1:labels:list')).toBeUndefined();
        expect(cache.get('account1:message:msg123')).toBeUndefined();
        expect(cache.get('account1:thread:thread1')).toBeUndefined();
        expect(cache.get('account1:other:data')?.value).toBe('other');
      });

      it('invalidates drafts', () => {
        cache.set('account1:drafts:list', 'drafts');
        cache.set('account1:draft:123', 'draft');
        cache.set('account1:message:1', 'message');

        cache.invalidateDrafts('account1');

        expect(cache.get('account1:drafts:list')).toBeUndefined();
        expect(cache.get('account1:draft:123')).toBeUndefined();
        expect(cache.get('account1:message:1')?.value).toBe('message');
      });
    });

    describe('key generation', () => {
      it('creates consistent keys', () => {
        const key1 = LRUCache.makeKey('account1', 'getMessage', { id: '123' });
        const key2 = LRUCache.makeKey('account1', 'getMessage', { id: '123' });

        expect(key1).toBe(key2);
      });

      it('creates different keys for different accounts', () => {
        const key1 = LRUCache.makeKey('account1', 'getMessage', { id: '123' });
        const key2 = LRUCache.makeKey('account2', 'getMessage', { id: '123' });

        expect(key1).not.toBe(key2);
      });

      it('creates different keys for different params', () => {
        const key1 = LRUCache.makeKey('account1', 'getMessage', { id: '123' });
        const key2 = LRUCache.makeKey('account1', 'getMessage', { id: '456' });

        expect(key1).not.toBe(key2);
      });

      it('normalizes param order', () => {
        const key1 = LRUCache.makeKey('account1', 'search', { a: 1, b: 2 });
        const key2 = LRUCache.makeKey('account1', 'search', { b: 2, a: 1 });

        expect(key1).toBe(key2);
      });
    });
  });

  describe('withCache', () => {
    let cache: LRUCache;

    beforeEach(() => {
      cache = new LRUCache({ maxSize: 10, defaultTtlMs: 1000 });
    });

    afterEach(() => {
      cache.clear();
    });

    it('caches operation result', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result1 = await withCache('key1', operation, 1000);
      const result2 = await withCache('key1', operation, 1000);

      expect(result1.value).toBe('result');
      expect(result1.cacheHit).toBe(false);
      expect(result2.value).toBe('result');
      expect(result2.cacheHit).toBe(true);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('returns ttlRemainingMs', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await withCache('key1', operation, 1000);

      expect(result.ttlRemainingMs).toBeLessThanOrEqual(1000);
      expect(result.ttlRemainingMs).toBeGreaterThan(900);
    });

    it('calls operation on cache miss', async () => {
      const operation = vi.fn().mockResolvedValue('fresh');

      const result = await withCache('new-key', operation);

      expect(result.value).toBe('fresh');
      expect(result.cacheHit).toBe(false);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});
