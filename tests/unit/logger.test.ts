import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, type LogLevel } from '../../src/utils/logger.js';

describe('Logger', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleSpies: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
    consoleSpies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('respects debug level - logs everything', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleSpies.debug).toHaveBeenCalled();
      expect(consoleSpies.info).toHaveBeenCalled();
      expect(consoleSpies.warn).toHaveBeenCalled();
      expect(consoleSpies.error).toHaveBeenCalled();
    });

    it('respects info level - skips debug', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'info';
      const logger = new Logger();

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).toHaveBeenCalled();
      expect(consoleSpies.warn).toHaveBeenCalled();
    });

    it('respects warn level - skips debug and info', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'warn';
      const logger = new Logger();

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.warn).toHaveBeenCalled();
      expect(consoleSpies.error).toHaveBeenCalled();
    });

    it('respects error level - only errors', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'error';
      const logger = new Logger();

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.warn).not.toHaveBeenCalled();
      expect(consoleSpies.error).toHaveBeenCalled();
    });

    it('respects silent level - logs nothing', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'silent';
      const logger = new Logger();

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.warn).not.toHaveBeenCalled();
      expect(consoleSpies.error).not.toHaveBeenCalled();
    });

    it('defaults to info level when env not set', () => {
      delete process.env['MCP_GOOGLE_LOG_LEVEL'];
      const logger = new Logger();

      logger.debug('debug message');
      logger.info('info message');

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).toHaveBeenCalled();
    });

    it('defaults to info level for invalid env value', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'invalid';
      const logger = new Logger();

      logger.debug('debug message');
      logger.info('info message');

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).toHaveBeenCalled();
    });
  });

  describe('sensitive data redaction', () => {
    it('redacts Authorization headers', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.debug('Request with Authorization: Bearer abc123.def456.ghi789');

      expect(consoleSpies.debug).toHaveBeenCalled();
      const loggedMessage = consoleSpies.debug.mock.calls[0]?.[0] as string;
      expect(loggedMessage).not.toContain('abc123');
      expect(loggedMessage).toContain('[REDACTED_AUTH]');
    });

    it('redacts access_token in JSON', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.debug('Token response', { access_token: 'secret-token-value' });

      const loggedMessage = consoleSpies.debug.mock.calls[0]?.[0] as string;
      expect(loggedMessage).not.toContain('secret-token-value');
      expect(loggedMessage).toContain('[REDACTED_AUTH]');
    });

    it('redacts refresh_token in JSON', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.debug('Token data: refresh_token: "my-refresh-token"');

      const loggedMessage = consoleSpies.debug.mock.calls[0]?.[0] as string;
      expect(loggedMessage).not.toContain('my-refresh-token');
      expect(loggedMessage).toContain('[REDACTED_AUTH]');
    });

    it('redacts email addresses by default', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.debug('Sending to user@example.com and admin@company.org');

      const loggedMessage = consoleSpies.debug.mock.calls[0]?.[0] as string;
      expect(loggedMessage).not.toContain('user@');
      expect(loggedMessage).not.toContain('admin@');
      expect(loggedMessage).toContain('[REDACTED]@example.com');
      expect(loggedMessage).toContain('[REDACTED]@company.org');
    });

    it('does not redact email addresses when MCP_GOOGLE_LOG_RECIPIENTS=true', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      process.env['MCP_GOOGLE_LOG_RECIPIENTS'] = 'true';
      const logger = new Logger();

      logger.debug('Sending to user@example.com');

      const loggedMessage = consoleSpies.debug.mock.calls[0]?.[0] as string;
      expect(loggedMessage).toContain('user@example.com');
    });

    it('redacts long email body content', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      const longBody = 'A'.repeat(100);
      logger.debug(`Message body: "${longBody}"`);

      const loggedMessage = consoleSpies.debug.mock.calls[0]?.[0] as string;
      expect(loggedMessage).not.toContain('AAAA');
      expect(loggedMessage).toContain('[REDACTED_CONTENT]');
    });
  });

  describe('message formatting', () => {
    it('includes timestamp in log messages', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.info('test message');

      const loggedMessage = consoleSpies.info.mock.calls[0]?.[0] as string;
      // Check for ISO timestamp pattern
      expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('includes level in log messages', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.info('test message');

      const loggedMessage = consoleSpies.info.mock.calls[0]?.[0] as string;
      expect(loggedMessage).toContain('[INFO]');
    });

    it('serializes data objects', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      logger.info('data test', { key: 'value', count: 42 });

      const loggedMessage = consoleSpies.info.mock.calls[0]?.[0] as string;
      expect(loggedMessage).toContain('"key"');
      expect(loggedMessage).toContain('"value"');
      expect(loggedMessage).toContain('42');
    });

    it('handles unserializable data gracefully', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();

      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      logger.info('circular test', circular);

      const loggedMessage = consoleSpies.info.mock.calls[0]?.[0] as string;
      expect(loggedMessage).toContain('[unserializable data]');
    });
  });

  describe('configuration', () => {
    it('allows runtime configuration', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'info';
      const logger = new Logger();

      logger.debug('should not log');
      expect(consoleSpies.debug).not.toHaveBeenCalled();

      logger.configure({ level: 'debug' as LogLevel });
      logger.debug('should log now');
      expect(consoleSpies.debug).toHaveBeenCalled();
    });

    it('returns current configuration', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'warn';
      const logger = new Logger();

      const config = logger.getConfig();
      expect(config.level).toBe('warn');
      expect(config.redactEmailContent).toBe(true);
      expect(config.redactRecipients).toBe(true);
    });
  });

  describe('child logger', () => {
    it('creates child logger with prefix', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'debug';
      const logger = new Logger();
      const child = logger.child('GmailClient');

      child.info('fetching message');

      const loggedMessage = consoleSpies.info.mock.calls[0]?.[0] as string;
      expect(loggedMessage).toContain('[GmailClient]');
      expect(loggedMessage).toContain('fetching message');
    });

    it('child logger respects parent log level', () => {
      process.env['MCP_GOOGLE_LOG_LEVEL'] = 'warn';
      const logger = new Logger();
      const child = logger.child('Test');

      child.debug('debug message');
      child.info('info message');
      child.warn('warn message');

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.warn).toHaveBeenCalled();
    });
  });
});
