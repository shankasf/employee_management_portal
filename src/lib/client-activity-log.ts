export function logClientActivity(entry: {
    action: string
    entityType: string
    entityId?: string
    entityName?: string
    details?: Record<string, unknown>
}): void {
    fetch('/api/activity-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
    }).catch(() => {})
}
