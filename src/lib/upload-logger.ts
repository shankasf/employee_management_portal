'use client'

// Upload logging - batched client-side logger for file uploads
// Mirrors the usage-log.ts pattern: batch queue -> flush -> API

export type UploadStatus = 'attempt' | 'success' | 'failure' | 'validation_rejected'

export type UploadContext =
    | 'employee_task_photo'
    | 'employee_task_video'
    | 'admin_ref_image'
    | 'admin_ref_video'
    | 'admin_id_doc'
    | 'admin_profile_pic'
    | 'admin_policy_media'
    | 'self_profile_pic'

export interface UploadLogEntry {
    status: UploadStatus
    bucket: string
    fileName: string
    fileSize: number
    mimeType: string
    filePath?: string
    uploadContext: UploadContext
    entityId?: string
    errorMessage?: string
    errorCode?: string
    deviceName?: string
    durationMs?: number
}

// Queue for batching logs
let logQueue: UploadLogEntry[] = []
let flushTimeout: NodeJS.Timeout | null = null
const FLUSH_INTERVAL = 2000 // 2 seconds
const MAX_QUEUE_SIZE = 5

function getDeviceNameFromUA(): string {
    if (typeof navigator === 'undefined') return 'Unknown'
    const ua = navigator.userAgent
    if (/iPhone/.test(ua)) return 'iPhone'
    if (/iPad/.test(ua)) return 'iPad'
    if (/Android/.test(ua)) {
        const match = ua.match(/Android.*?;\s*([^;)]+)/)
        if (match?.[1]) return match[1].replace(/Build\/.*/, '').trim() || 'Android Device'
        return 'Android Device'
    }
    if (/Windows/.test(ua)) return 'Windows PC'
    if (/Macintosh/.test(ua)) return 'Mac'
    if (/Linux/.test(ua)) return 'Linux PC'
    if (/CrOS/.test(ua)) return 'Chromebook'
    return 'Unknown Device'
}

/**
 * Queue an upload log entry (batched for performance)
 */
function queueLog(entry: UploadLogEntry): void {
    if (typeof window === 'undefined') return

    // Enrich with device name if not provided
    const enrichedEntry: UploadLogEntry = {
        ...entry,
        deviceName: entry.deviceName || getDeviceNameFromUA(),
    }

    logQueue.push(enrichedEntry)

    if (logQueue.length >= MAX_QUEUE_SIZE) {
        flushLogs()
    } else if (!flushTimeout) {
        flushTimeout = setTimeout(flushLogs, FLUSH_INTERVAL)
    }
}

/**
 * Flush all queued logs to the server
 */
async function flushLogs(): Promise<void> {
    if (flushTimeout) {
        clearTimeout(flushTimeout)
        flushTimeout = null
    }

    if (logQueue.length === 0) return

    const logsToSend = [...logQueue]
    logQueue = []

    try {
        await fetch('/api/upload-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logs: logsToSend }),
            keepalive: true,
        })
    } catch {
        // Silently fail - never block uploads
        console.debug('[UploadLog] Failed to send logs')
    }
}

// Flush on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        if (logQueue.length > 0) {
            navigator.sendBeacon(
                '/api/upload-logs',
                new Blob([JSON.stringify({ logs: logQueue })], { type: 'application/json' })
            )
        }
    })

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushLogs()
        }
    })
}

/**
 * Log a validation rejection (file rejected before upload attempt)
 */
export function logValidationRejection(
    file: File,
    reason: string,
    context: UploadContext,
    bucket: string
): void {
    queueLog({
        status: 'validation_rejected',
        bucket,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        uploadContext: context,
        errorMessage: reason,
    })
}

/**
 * Start tracking an upload. Returns success/failure callbacks with timing.
 */
export function startUpload(
    file: File,
    bucket: string,
    context: UploadContext,
    entityId?: string
): { success: (filePath: string) => void; failure: (error: unknown) => void } {
    const startTime = Date.now()

    // Log the attempt
    queueLog({
        status: 'attempt',
        bucket,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        uploadContext: context,
        entityId,
    })

    return {
        success(filePath: string) {
            queueLog({
                status: 'success',
                bucket,
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type,
                filePath,
                uploadContext: context,
                entityId,
                durationMs: Date.now() - startTime,
            })
        },
        failure(error: unknown) {
            const errMsg = error instanceof Error ? error.message :
                (typeof error === 'object' && error !== null && 'message' in error)
                    ? String((error as { message: unknown }).message)
                    : String(error)
            const errCode = (typeof error === 'object' && error !== null && 'statusCode' in error)
                ? String((error as { statusCode: unknown }).statusCode)
                : undefined

            queueLog({
                status: 'failure',
                bucket,
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type,
                uploadContext: context,
                entityId,
                errorMessage: errMsg,
                errorCode: errCode,
                durationMs: Date.now() - startTime,
            })
        },
    }
}
