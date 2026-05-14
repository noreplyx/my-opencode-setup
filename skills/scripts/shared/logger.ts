export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

export class Logger {
  private entries: LogEntry[] = [];
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  private log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
    };
    this.entries.push(entry);
    this.output(entry);
  }

  private output(entry: LogEntry): void {
    if (entry.level === 'debug' && !this.verbose) return;
    
    const icons: Record<LogLevel, string> = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      debug: '🔍',
      success: '✅',
    };
    
    const icon = icons[entry.level] || '•';
    const details = entry.details ? ` ${JSON.stringify(entry.details)}` : '';
    console.log(`${icon} ${entry.message}${details}`);
  }

  info(message: string, details?: Record<string, unknown>): void { this.log('info', message, details); }
  warn(message: string, details?: Record<string, unknown>): void { this.log('warn', message, details); }
  error(message: string, details?: Record<string, unknown>): void { this.log('error', message, details); }
  debug(message: string, details?: Record<string, unknown>): void { this.log('debug', message, details); }
  success(message: string, details?: Record<string, unknown>): void { this.log('success', message, details); }

  getReport(): LogEntry[] {
    return this.entries;
  }

  getSummary(): { total: number; errors: number; warnings: number; success: number } {
    return {
      total: this.entries.length,
      errors: this.entries.filter(e => e.level === 'error').length,
      warnings: this.entries.filter(e => e.level === 'warn').length,
      success: this.entries.filter(e => e.level === 'success').length,
    };
  }
}
