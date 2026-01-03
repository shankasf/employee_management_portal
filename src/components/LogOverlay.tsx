'use client'

import { LogEntry } from '@/lib/logger'

const levelStyles: Record<LogEntry['level'], string> = {
    info: 'text-emerald-200',
    warn: 'text-amber-200',
    error: 'text-rose-300',
}

export default function LogOverlay({ logs }: { logs: LogEntry[] }) {
    if (!logs.length) return null

    const recent = [...logs].slice(-8).reverse()

    return (
        <div className="pointer-events-none fixed bottom-4 right-4 max-w-sm rounded-xl border border-white/10 bg-black/70 p-3 text-xs text-white shadow-2xl backdrop-blur">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">Realtime Logs</div>
            <div className="mt-2 space-y-1">
                {recent.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[11px] text-white/60">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="flex-1 truncate text-[11px]" title={entry.message}>
                            <span className={levelStyles[entry.level]}>[{entry.level}]</span> {entry.message}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
