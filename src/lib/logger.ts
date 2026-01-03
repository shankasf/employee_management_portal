import { useSyncExternalStore } from 'react'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  level: LogLevel
  message: string
  timestamp: number
}

const MAX_LOGS = 25
let logs: LogEntry[] = []
const subscribers = new Set<() => void>()

function publish(entry: LogEntry) {
  logs = [...logs, entry].slice(-MAX_LOGS)
  subscribers.forEach((listener) => listener())
}

function createMessage(level: LogLevel, message: string) {
  const entry: LogEntry = {
    id: Date.now() + Math.random(),
    level,
    message,
    timestamp: Date.now(),
  }
  publish(entry)
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  consoleFn(`[${level.toUpperCase()}]`, message)
}

export const logger = {
  log(message: string) {
    createMessage('info', message)
  },
  warn(message: string) {
    createMessage('warn', message)
  },
  error(message: string) {
    createMessage('error', message)
  },
  subscribe(callback: () => void) {
    subscribers.add(callback)
    return () => subscribers.delete(callback)
  },
  getLogs() {
    return logs
  },
}

export function useLogStream() {
  return useSyncExternalStore(logger.subscribe, () => logger.getLogs(), () => logger.getLogs())
}
