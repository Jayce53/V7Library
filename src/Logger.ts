type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  metadata?: unknown;
  timestamp: Date;
}

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
export class Logger {
  private static transport: LogTransport = defaultTransport;

  constructor(private readonly context: string) {}

  static setTransport(transport: LogTransport): void {
    this.transport = transport;
  }

  debug(message: string, metadata?: unknown): void {
    this.log("debug", message, metadata);
  }

  info(message: string, metadata?: unknown): void {
    this.log("info", message, metadata);
  }

  warn(message: string, metadata?: unknown): void {
    this.log("warn", message, metadata);
  }

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
