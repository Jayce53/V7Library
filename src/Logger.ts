/**
 * Minimal structured logging facade with pluggable transports.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured log entry passed to transports.
 */
export interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  metadata?: unknown;
  timestamp: Date;
}

/**
 * Function invoked for each log entry.
 */
export type LogTransport = (entry: LogEntry) => void;

const defaultTransport: LogTransport = (entry) => {
  const payload = {
    context: entry.context,
    message: entry.message,
    metadata: entry.metadata,
  };

  switch (entry.level) {
    case "debug":
      console.debug(entry.timestamp.toISOString(), payload);
      break;
    case "info":
      console.info(entry.timestamp.toISOString(), payload);
      break;
    case "warn":
      console.warn(entry.timestamp.toISOString(), payload);
      break;
    case "error":
      console.error(entry.timestamp.toISOString(), payload);
      break;
    default:
      console.log(entry.timestamp.toISOString(), payload);
  }
};

/**
 * Lightweight logger facade that can be swapped for a real backend later.
 */
/**
 * Simple structured logger with pluggable transport.
 */
export class Logger {
  private static transport: LogTransport = defaultTransport;

  constructor(private readonly context: string) {}

  /**
   * Overrides the transport function.
   */
  static setTransport(transport: LogTransport): void {
    this.transport = transport;
  }

  /**
   * Logs a debug entry.
   */
  debug(message: string, metadata?: unknown): void {
    this.log("debug", message, metadata);
  }

  /**
   * Logs an informational entry.
   */
  info(message: string, metadata?: unknown): void {
    this.log("info", message, metadata);
  }

  /**
   * Logs a warning entry.
   */
  warn(message: string, metadata?: unknown): void {
    this.log("warn", message, metadata);
  }

  /**
   * Logs an error entry.
   */
  error(message: string, metadata?: unknown): void {
    this.log("error", message, metadata);
  }

  private log(level: LogLevel, message: string, metadata?: unknown): void {
    Logger.transport({
      level,
      context: this.context,
      message,
      metadata,
      timestamp: new Date(),
    });
  }
}
