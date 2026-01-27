// Rate limiting with exponential backoff retry logic

import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 32000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

// Error type for HTTP errors with status codes
export interface HttpError extends Error {
  status?: number;
  code?: number | string;
  response?: {
    status?: number;
  };
}

// Extract status code from various error formats
function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const err = error as HttpError;

  // Direct status property
  if (typeof err.status === 'number') {
    return err.status;
  }

  // Nested response status (axios-style)
  if (err.response && typeof err.response.status === 'number') {
    return err.response.status;
  }

  // Google API client error code
  if (typeof err.code === 'number') {
    return err.code;
  }

  return undefined;
}

// Check if error is retryable based on status code
function isRetryable(error: unknown, retryableStatusCodes: number[]): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode === undefined) {
    return false;
  }
  return retryableStatusCodes.includes(statusCode);
}

// Calculate delay with jitter to prevent thundering herd
function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
  const delay = Math.min(exponentialDelay, options.maxDelayMs);

  // Add jitter (±25%) to prevent synchronized retries
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main retry function
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const log = logger.child('Retry');

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= opts.maxRetries) {
        log.debug(`Max retries (${opts.maxRetries}) exceeded`);
        break;
      }

      if (!isRetryable(error, opts.retryableStatusCodes)) {
        log.debug('Error is not retryable', { statusCode: getStatusCode(error) });
        break;
      }

      // Calculate delay and wait
      const delayMs = calculateDelay(attempt, opts);
      const statusCode = getStatusCode(error);

      log.warn(`Retryable error (status ${statusCode}), attempt ${attempt + 1}/${opts.maxRetries + 1}, waiting ${delayMs}ms`);

      // Call optional retry callback
      if (opts.onRetry) {
        opts.onRetry(error, attempt + 1, delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

// Decorator-style wrapper for class methods
export function retryable(options: Partial<RetryOptions> = {}) {
  return function <T>(
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: unknown[]) => Promise<T>>,
  ): TypedPropertyDescriptor<(...args: unknown[]) => Promise<T>> {
    const originalMethod = descriptor.value;

    if (!originalMethod) {
      return descriptor;
    }

    descriptor.value = async function (...args: unknown[]): Promise<T> {
      return withRetry(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}

// Per-account rate limit state tracking
interface RateLimitState {
  lastError: Date | null;
  consecutiveErrors: number;
  backoffUntil: Date | null;
}

const accountRateLimitState = new Map<string, RateLimitState>();

export function getAccountRateLimitState(accountId: string): RateLimitState {
  let state = accountRateLimitState.get(accountId);
  if (!state) {
    state = {
      lastError: null,
      consecutiveErrors: 0,
      backoffUntil: null,
    };
    accountRateLimitState.set(accountId, state);
  }
  return state;
}

export function recordRateLimitError(accountId: string): void {
  const state = getAccountRateLimitState(accountId);
  state.lastError = new Date();
  state.consecutiveErrors++;

  // Set backoff based on consecutive errors
  const backoffMs = Math.min(
    DEFAULT_RETRY_OPTIONS.initialDelayMs * Math.pow(2, state.consecutiveErrors),
    DEFAULT_RETRY_OPTIONS.maxDelayMs,
  );
  state.backoffUntil = new Date(Date.now() + backoffMs);
}

export function recordSuccessfulRequest(accountId: string): void {
  const state = accountRateLimitState.get(accountId);
  if (state) {
    state.consecutiveErrors = 0;
    state.backoffUntil = null;
  }
}

export function isAccountInBackoff(accountId: string): boolean {
  const state = accountRateLimitState.get(accountId);
  if (!state?.backoffUntil) {
    return false;
  }
  return new Date() < state.backoffUntil;
}

export function getBackoffRemainingMs(accountId: string): number {
  const state = accountRateLimitState.get(accountId);
  if (!state?.backoffUntil) {
    return 0;
  }
  const remaining = state.backoffUntil.getTime() - Date.now();
  return Math.max(0, remaining);
}

// Clear rate limit state (useful for testing)
export function clearRateLimitState(): void {
  accountRateLimitState.clear();
}
