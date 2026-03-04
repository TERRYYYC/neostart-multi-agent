// ============================================================
// chat/logger.ts — 结构化日志工具（零依赖）
// Structured logging helper (zero dependency)
// ============================================================
//
// 目标 / Goals:
//   - 统一日志格式（JSON line）
//   - Unified log format (JSON line)
//   - 支持日志级别（LOG_LEVEL）
//   - Support log levels (LOG_LEVEL)
//   - 支持上下文透传（requestId / conversationId / provider）
//   - Support context propagation (requestId / conversationId / provider)
//
// ============================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

interface LogRecord extends LogFields {
  ts: string;
  level: LogLevel;
  event: string;
}

interface Logger {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields, err?: unknown) => void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(raw: string | undefined): LogLevel {
  const normalized = (raw ?? '').toLowerCase();
  switch (normalized) {
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
}

const MIN_LEVEL = parseLevel(process.env.LOG_LEVEL);

function truncate(text: string, max = 500): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...<truncated>`;
}

function normalizeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      errorMessage: err.message,
      errorName: err.name,
      errorStack: truncate(err.stack ?? '', 1200),
    };
  }
  return { errorMessage: String(err) };
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[MIN_LEVEL];
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (!shouldLog(level)) {
    return;
  }

  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

function createLogger(baseFields: LogFields = {}): Logger {
  return {
    debug(event: string, fields: LogFields = {}): void {
      write('debug', event, { ...baseFields, ...fields });
    },
    info(event: string, fields: LogFields = {}): void {
      write('info', event, { ...baseFields, ...fields });
    },
    warn(event: string, fields: LogFields = {}): void {
      write('warn', event, { ...baseFields, ...fields });
    },
    error(event: string, fields: LogFields = {}, err?: unknown): void {
      const errorFields = err !== undefined ? normalizeError(err) : {};
      write('error', event, { ...baseFields, ...fields, ...errorFields });
    },
  };
}

/**
 * 创建子 Logger（自动附带上下文）
 * Create child logger with inherited context
 */
export function childLogger(baseFields: LogFields = {}): Logger {
  return createLogger(baseFields);
}

/**
 * 截断日志字段中的长文本
 * Truncate long text values for log fields
 */
export function truncateForLog(text: string, max = 500): string {
  return truncate(text, max);
}
