/**
 * Global JSON logger for MCP Stdio-HTTP Proxy
 * Provides structured logging with timestamps and consistent format
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

// Global logging configuration
let currentLogLevel: LogLevel = 'info'; // Default to info level
let debugMode: boolean = false;
let loggingEnabled: boolean = true;

// Log level hierarchy (higher number = higher priority)
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Set the current log level - only messages at this level or higher will be logged
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Enable or disable debug mode - when enabled, shows all debug messages
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
  if (enabled) {
    currentLogLevel = 'debug';
    loggingEnabled = true;
  }
}

/**
 * Enable or disable all logging
 */
export function setLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
}

/**
 * Get current debug mode status
 */
export function isDebugMode(): boolean {
  return debugMode;
}

/**
 * Core logging function that outputs structured JSON
 */
function logJson(level: LogLevel, message: string, data?: any): void {
  // Don't log if logging is disabled (unless it's an error and not in debug mode)
  if (!loggingEnabled && !(level === 'error' && !debugMode)) {
    return;
  }

  // Don't log if the message level is below the current log level
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLogLevel]) {
    return;
  }

  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data && { data })
  };
  console.error(JSON.stringify(logEntry));
}

/**
 * Configure logging based on environment variables and command line arguments
 */
export function configureLogging(): void {
  const args = process.argv.slice(2);
  
  // Check for debug flag in command line arguments
  const debugFlag = args.includes('--debug') || args.includes('-d');
  const quietFlag = args.includes('--quiet') || args.includes('-q');
  
  // Check environment variables
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  const envDebug = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
  const envQuiet = process.env.QUIET === 'true' || process.env.QUIET === '1';
  
  // Set debug mode if flag is present or environment variable is set
  if (debugFlag || envDebug) {
    setDebugMode(true);
    return; // Debug mode overrides everything else
  }
  
  // Set quiet mode if flag is present or environment variable is set
  if (quietFlag || envQuiet) {
    setLoggingEnabled(false);
    return;
  }
  
  // Set log level from environment if provided
  if (envLogLevel && LOG_LEVELS[envLogLevel] !== undefined) {
    setLogLevel(envLogLevel);
  }
}

/**
 * Log an informational message
 */
export function logInfo(message: string, data?: any): void {
  logJson('info', message, data);
}

/**
 * Log an error message
 */
export function logError(message: string, data?: any): void {
  logJson('error', message, data);
}

/**
 * Log a warning message
 */
export function logWarn(message: string, data?: any): void {
  logJson('warn', message, data);
}

/**
 * Log a debug message
 */
export function logDebug(message: string, data?: any): void {
  logJson('debug', message, data);
}

/**
 * Helper function to format error objects for logging
 */
export function formatError(error: any): any {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
  }
  return error;
}
