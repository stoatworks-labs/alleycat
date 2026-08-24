import { EventEmitter } from 'node:events'

export interface LogLine {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

/**
 * A tiny in-memory ring the config window can render.
 *
 * Deliberately not pino-to-file: the thing an operator needs at a show is the
 * last thirty lines visible in the window, not a log they have to go find.
 */
class Logger extends EventEmitter {
  private lines: LogLine[] = []
  private readonly max = 500

  private push(level: LogLine['level'], message: string): void {
    const line: LogLine = { at: Date.now(), level, message }
    this.lines.push(line)
    if (this.lines.length > this.max) this.lines.shift()
    this.emit('line', line)
    const stamp = new Date(line.at).toISOString()
    console[level === 'error' ? 'error' : 'log'](`[${stamp}] ${level}: ${message}`)
  }

  info(message: string): void {
    this.push('info', message)
  }
  warn(message: string): void {
    this.push('warn', message)
  }
  error(message: string): void {
    this.push('error', message)
  }
  history(): LogLine[] {
    return [...this.lines]
  }
}

export const log = new Logger()
