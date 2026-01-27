// LRU cache with configurable TTLs for Gmail API responses

import { logger } from './logger.js';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheConfig {
  maxSize: number;
  defaultTtlMs: number;
}

export interface CacheTTLs {
  search: number;
  messageMetadata: number;
  messageBody: number;
  thread: number;
  labels: number;
  drafts: number;
}

// Default TTLs based on spec recommendations
export const DEFAULT_TTLS: CacheTTLs = {
  search: 30_000, // 30 seconds - search results change frequently
  messageMetadata: 300_000, // 5 minutes - metadata is fairly stable
  messageBody: 600_000, // 10 minutes - message bodies never change
  thread: 60_000, // 1 minute - threads may get new messages
  labels: 300_000, // 5 minutes - labels change infrequently
  drafts: 30_000, // 30 seconds - drafts may be edited
};

const DEFAULT_CONFIG: CacheConfig = {
  maxSize: 1000,
  defaultTtlMs: 60_000, // 1 minute default
};

export class LRUCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private config: CacheConfig;
  private log = logger.child('Cache');
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // Generate cache key from components
  static makeKey(accountId: string, method: string, params?: Record<string, unknown>): string {
    const paramStr = params ? JSON.stringify(params, Object.keys(params).sort()) : '';
    return `${accountId}:${method}:${paramStr}`;
  }

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;

    return entry;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.config.defaultTtlMs;
    const now = Date.now();

    // If key exists, delete it first (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.config.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
        this.log.debug(`Evicted cache entry: ${oldestKey}`);
      }
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + ttl,
      createdAt: now,
    };

    this.cache.set(key, entry);
  }

  // Get value with cache hit metadata
  getWithMeta(key: string): { value: T; cacheHit: true; ttlRemainingMs: number } | { cacheHit: false } {
    const entry = this.get(key);

    if (!entry) {
      return { cacheHit: false };
    }

    return {
      value: entry.value,
      cacheHit: true,
      ttlRemainingMs: Math.max(0, entry.expiresAt - Date.now()),
    };
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  // Invalidate all entries matching a pattern
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.log.debug(`Invalidated ${count} cache entries matching pattern`);
    }
    return count;
  }

  // Invalidate all entries for an account
  invalidateAccount(accountId: string): number {
    return this.invalidatePattern(new RegExp(`^${accountId}:`));
  }

  // Invalidate entries related to message modifications
  invalidateForMessageModification(accountId: string, messageId?: string): void {
    // Always invalidate search results and labels when messages are modified
    this.invalidatePattern(new RegExp(`^${accountId}:search:`));
    this.invalidatePattern(new RegExp(`^${accountId}:labels:`));

    if (messageId) {
      // Invalidate specific message and its thread
      this.invalidatePattern(new RegExp(`^${accountId}:message:.*${messageId}`));
      this.invalidatePattern(new RegExp(`^${accountId}:thread:`));
    }
  }

  // Invalidate drafts for an account
  invalidateDrafts(accountId: string): void {
    this.invalidatePattern(new RegExp(`^${accountId}:draft`));
  }

  clear(): void {
    this.cache.clear();
    this.log.debug('Cache cleared');
  }

  size(): number {
    return this.cache.size;
  }

  getStats(): { hits: number; misses: number; evictions: number; size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }
}

// Singleton cache instance
export const cache = new LRUCache();

// Helper to wrap an async function with caching
export async function withCache<T>(
  key: string,
  operation: () => Promise<T>,
  ttlMs?: number,
): Promise<{ value: T; cacheHit: boolean; ttlRemainingMs: number }> {
  const cached = cache.getWithMeta(key);

  if (cached.cacheHit) {
    return cached as { value: T; cacheHit: true; ttlRemainingMs: number };
  }

  const value = await operation();
  cache.set(key, value, ttlMs);

  return {
    value,
    cacheHit: false,
    ttlRemainingMs: ttlMs ?? DEFAULT_CONFIG.defaultTtlMs,
  };
}
