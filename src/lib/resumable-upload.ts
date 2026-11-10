import * as tus from 'tus-js-client'
import { createClient } from '@/lib/supabase/client'

const TUS_THRESHOLD = 20 * 1024 * 1024 // 20MB
const CHUNK_SIZE = 6 * 1024 * 1024 // 6MB - Supabase recommended

/**
 * Returns true if the file should use TUS resumable upload (video > 20MB).
 */
export function shouldUseTus(file: File): boolean {
  return file.type.startsWith('video/') && file.size > TUS_THRESHOLD
}

interface ResumableUploadOptions {
  bucketName: string
  objectName: string
  file: File
  /**
   * Cache-Control max-age in seconds. Defaults to 31536000 (1 year) since
   * uploaded objects are content-addressed by timestamp and never overwritten,
   * so they're effectively immutable. Pass a smaller value for short-lived
   * media if needed.
   */
  cacheControl?: string
  onProgress?: (percentage: number) => void
  onOffline?: (percentage: number) => void
  onOnline?: (percentage: number) => void
}

interface ResumableUploadResult {
  promise: Promise<void>
  abort: () => void
}

/**
 * Performs a TUS resumable upload to Supabase Storage.
 * Returns a promise that resolves on success, and an abort function.
 * Detects offline/online transitions and notifies via callbacks.
 */
export function resumableUpload({
  bucketName,
  objectName,
  file,
  cacheControl = '31536000',
  onProgress,
  onOffline,
  onOnline,
}: ResumableUploadOptions): ResumableUploadResult {
  let abortFn: (() => void) | null = null

  const promise = new Promise<void>(async (resolve, reject) => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.refreshSession()
      if (!session?.access_token) {
        reject(new Error('Not authenticated'))
        return
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      let lastPercent = 0

      // Listen for online/offline events
      const handleOffline = () => onOffline?.(lastPercent)
      const handleOnline = () => onOnline?.(lastPercent)
      window.addEventListener('offline', handleOffline)
      window.addEventListener('online', handleOnline)

      const cleanup = () => {
        window.removeEventListener('offline', handleOffline)
        window.removeEventListener('online', handleOnline)
      }

      const upload = new tus.Upload(file, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000, 10000, 15000, 30000],
        chunkSize: CHUNK_SIZE,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'x-upsert': 'false',
        },
        metadata: {
          bucketName,
          objectName,
          contentType: file.type,
          cacheControl,
        },
        onShouldRetry(err) {
          const status = err.originalResponse ? err.originalResponse.getStatus() : 0
          // Retry on network errors (status 0) and server errors (5xx)
          // Don't retry on client errors (4xx) except 408/429
          if (status === 0 || status >= 500 || status === 408 || status === 429) {
            return true
          }
          return false
        },
        onError(error) {
          cleanup()
          reject(error)
        },
        onProgress(bytesUploaded, bytesTotal) {
          lastPercent = Math.round((bytesUploaded / bytesTotal) * 100)
          onProgress?.(lastPercent)
        },
        onSuccess() {
          cleanup()
          resolve()
        },
      })

      abortFn = () => {
        cleanup()
        upload.abort()
      }

      // Check for previous uploads to resume
      // Only resume if the previous upload used the same objectName,
      // otherwise we'd complete the old file but return the new path (mismatch)
      const previousUploads = await upload.findPreviousUploads()
      if (previousUploads.length > 0) {
        const prev = previousUploads[0]
        if (prev.metadata?.objectName === objectName) {
          upload.resumeFromPreviousUpload(prev)
        }
      }

      upload.start()
    } catch (err) {
      reject(err)
    }
  })

  return {
    promise,
    abort: () => abortFn?.(),
  }
}
