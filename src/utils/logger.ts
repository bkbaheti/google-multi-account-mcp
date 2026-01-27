// Configurable logging with sensitive data redaction

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// Patterns for sensitive data that should always be redacted
const ALWAYS_REDACT_PATTERNS = [
  // Authorization headers with Bearer token (match the full header value)
  /Authorization:\s*Bearer\s+[^\s]+/gi,
  // Authorization headers with other schemes
  /Authorization:\s*Basic\s+[^\s]+/gi,
  // JWT tokens (three base64url parts separated by dots)
  /[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g,
  // OAuth tokens
  /access_token['":\s]+[^'"\s,}]+/gi,
  /refresh_token['":\s]+[^'"\s,}]+/gi,
  // API keys
  /api[_-]?key['":\s]+[^'"\s,}]+/gi,
];

// Patterns for email content (redacted unless explicitly allowed)
const EMAIL_CONTENT_PATTERNS = [
  // Email body content
  /body['":\s]+['"][^'"]{50,}['"]/gi,
  /snippet['":\s]+['"][^'"]{100,}['"]/gi,
  // Subject lines (partial redaction)
  /subject['":\s]+['"]([^'"]+)['"]/gi,
];

// Email address pattern for recipient redaction
const EMAIL_ADDRESS_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

interface LoggerConfig {
  level: LogLevel;
  redactEmailContent: boolean;
  redactRecipients: boolean;
}

class Logger {
  private config: LoggerConfig;

  constructor() {
    this.config = {
      level: this.getLogLevelFromEnv(),
      redactEmailContent: process.env['MCP_GOOGLE_LOG_EMAIL_CONTENT'] !== 'true',
      redactRecipients: process.env['MCP_GOOGLE_LOG_RECIPIENTS'] !== 'true',
    };
  }

  private getLogLevelFromEnv(): LogLevel {
    const envLevel = process.env['MCP_GOOGLE_LOG_LEVEL']?.toLowerCase();
    if (envLevel && envLevel in LOG_LEVELS) {
      return envLevel as LogLevel;
    }
    return 'info'; // Default level
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private redact(message: string): string {
    let redacted = message;

    // Always redact sensitive auth data
    for (const pattern of ALWAYS_REDACT_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED_AUTH]');
    }

    // Redact email content unless explicitly allowed
    if (this.config.redactEmailContent) {
      for (const pattern of EMAIL_CONTENT_PATTERNS) {
        redacted = redacted.replace(pattern, (match) => {
          // Keep the key but redact the value
          const keyMatch = match.match(/^([a-z]+)['":\s]+/i);
          if (keyMatch) {
            return `${keyMatch[1]}: "[REDACTED_CONTENT]"`;
          }
          return '[REDACTED_CONTENT]';
        });
      }
    }

    // Redact email addresses unless explicitly allowed
    if (this.config.redactRecipients) {
      redacted = redacted.replace(EMAIL_ADDRESS_PATTERN, (email) => {
        const parts = email.split('@');
        if (parts.length === 2 && parts[0] && parts[1]) {
          const domain = parts[1];
          return `[REDACTED]@${domain}`;
        }
        return '[REDACTED_EMAIL]';
      });
    }

    return redacted;
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    let fullMessage = `${prefix} ${message}`;

    if (data !== undefined) {
      try {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        fullMessage += ` ${dataStr}`;
      } catch {
        fullMessage += ' [unserializable data]';
      }
    }

    return this.redact(fullMessage);
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, data));
    }
  }

  // Configure the logger at runtime
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Get current configuration
  getConfig(): Readonly<LoggerConfig> {
    return { ...this.config };
  }

  // Create a child logger with a prefix
  child(prefix: string): ChildLogger {
    return new ChildLogger(this, prefix);
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private prefix: string,
  ) {}

  private prefixMessage(message: string): string {
    return `[${this.prefix}] ${message}`;
  }

  debug(message: string, data?: unknown): void {
    this.parent.debug(this.prefixMessage(message), data);
  }

  info(message: string, data?: unknown): void {
    this.parent.info(this.prefixMessage(message), data);
  }

  warn(message: string, data?: unknown): void {
    this.parent.warn(this.prefixMessage(message), data);
  }

  error(message: string, data?: unknown): void {
    this.parent.error(this.prefixMessage(message), data);
  }
}

// Singleton instance
export const logger = new Logger();

// Export for testing
export { Logger, ChildLogger };
