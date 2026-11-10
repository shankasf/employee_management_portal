'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { RichTextDisplay } from '@/components/RichTextEditor'
import { VideoPlayer } from '@/components/VideoPlayer'
import { getMediaSrc } from '@/lib/storage-path'

interface Policy {
  id: string
  title: string
  content: string
  category: string | null
  image_url: string | null
  video_url: string | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ policy: Policy }>
}

export default function PolicyViewerPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const { data, error, isLoading } = useSWR(
    id ? `/api/knowledge/policy/${id}` : null,
    fetcher
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !data?.policy) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md mb-4">
          {error instanceof Error ? error.message : 'Policy not found'}
        </div>
        <Link href="/employee/knowledge" className="text-primary">← Back to search</Link>
      </div>
    )
  }

  const p = data.policy
  const imageSrc = getMediaSrc('policy-media', p.image_url)
  const videoSrc = getMediaSrc('policy-media', p.video_url)

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/employee/knowledge" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
        ← Back to search
      </Link>

      <div className="bg-card border border-border rounded-lg p-5 sm:p-6">
        <div className="mb-3">
          {p.category && (
            <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded">
              {p.category}
            </span>
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">{p.title}</h1>

        {/* policy-media is a private bucket - render through the authenticated
            media proxy; externally pasted links pass through unchanged. */}
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt={p.title} className="w-full max-h-[60vh] object-contain rounded-md mb-4" />
        )}

        {videoSrc && (
          <VideoPlayer src={videoSrc} className="w-full max-h-[60vh] mb-4" />
        )}

        <div className="prose prose-sm sm:prose dark:prose-invert max-w-none">
          <RichTextDisplay content={p.content} />
        </div>
      </div>
    </div>
  )
}
