// Per-account request throttling using token bucket algorithm

import { logger } from './logger.js';

export interface ThrottleConfig {
  tokensPerSecond: number;
  bucketSize: number;
}

const DEFAULT_CONFIG: ThrottleConfig = {
  tokensPerSecond: 250, // Gmail API default quota per user
  bucketSize: 250, // Allow bursts up to bucket size
};

interface BucketState {
  tokens: number;
  lastRefill: number;
}

class TokenBucket {
  private buckets = new Map<string, BucketState>();
  private config: ThrottleConfig;
  private log = logger.child('Throttle');

  constructor(config: Partial<ThrottleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getBucket(accountId: string): BucketState {
    let bucket = this.buckets.get(accountId);
    if (!bucket) {
      bucket = {
        tokens: this.config.bucketSize,
        lastRefill: Date.now(),
      };
      this.buckets.set(accountId, bucket);
    }
    return bucket;
  }

  private refillTokens(bucket: BucketState): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000; // Convert to seconds
    const newTokens = elapsed * this.config.tokensPerSecond;

    bucket.tokens = Math.min(bucket.tokens + newTokens, this.config.bucketSize);
    bucket.lastRefill = now;
  }

  // Try to consume a token, returns true if successful
  tryConsume(accountId: string, cost = 1): boolean {
    const bucket = this.getBucket(accountId);
    this.refillTokens(bucket);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return true;
    }

    return false;
  }

  // Get time to wait until a token is available (in ms)
  getWaitTime(accountId: string, cost = 1): number {
    const bucket = this.getBucket(accountId);
    this.refillTokens(bucket);

    if (bucket.tokens >= cost) {
      return 0;
    }

    const tokensNeeded = cost - bucket.tokens;
    const waitSeconds = tokensNeeded / this.config.tokensPerSecond;
    return Math.ceil(waitSeconds * 1000);
  }

  // Wait for token availability, then consume
  async waitAndConsume(accountId: string, cost = 1): Promise<void> {
    const waitTime = this.getWaitTime(accountId, cost);

    if (waitTime > 0) {
      this.log.debug(`Throttling account ${accountId}, waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    // After waiting, try to consume (should succeed)
    const bucket = this.getBucket(accountId);
    this.refillTokens(bucket);
    bucket.tokens = Math.max(0, bucket.tokens - cost);
  }

  // Get current token count for an account
  getTokenCount(accountId: string): number {
    const bucket = this.getBucket(accountId);
    this.refillTokens(bucket);
    return bucket.tokens;
  }

  // Reset a specific account's bucket
  reset(accountId: string): void {
    this.buckets.delete(accountId);
  }

  // Clear all buckets
  clear(): void {
    this.buckets.clear();
  }

  // Update configuration
  configure(config: Partial<ThrottleConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance for global throttling
export const throttle = new TokenBucket();

// Export for testing and custom instances
export { TokenBucket };

// Higher-level wrapper that combines throttling with a request
export async function withThrottle<T>(
  accountId: string,
  operation: () => Promise<T>,
  cost = 1,
): Promise<T> {
  await throttle.waitAndConsume(accountId, cost);
  return operation();
}
