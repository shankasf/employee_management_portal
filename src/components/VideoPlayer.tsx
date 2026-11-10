'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'

interface VideoPlayerProps {
  src: string
  className?: string
  poster?: string
  controls?: boolean
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
  playsInline?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  onTimeUpdate?: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onEnded?: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onError?: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void
}

/**
 * Video player with a loading spinner overlay during initial load,
 * buffering, or seeking. Forwards a ref to the underlying <video> element
 * so callers can read `currentTime`, `duration`, etc.
 */
export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  function VideoPlayer(
    {
      src,
      className = '',
      poster,
      controls = true,
      autoPlay = false,
      muted = false,
      loop = false,
      playsInline = true,
      preload = 'metadata',
      onTimeUpdate,
      onEnded,
      onError,
      onLoadedMetadata,
    },
    forwardedRef
  ) {
    const innerRef = useRef<HTMLVideoElement>(null)
    const [loading, setLoading] = useState(true)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    // Bridge the forwarded ref to our local ref
    useEffect(() => {
      if (!forwardedRef) return
      const node = innerRef.current
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else {
        forwardedRef.current = node
      }
    }, [forwardedRef])

    // Reset state when the source changes
    useEffect(() => {
      setLoading(true)
      setErrorMsg(null)
    }, [src])

    return (
      <div className={`relative ${className}`}>
        <video
          ref={innerRef}
          src={src}
          poster={poster}
          controls={controls}
          autoPlay={autoPlay}
          muted={muted}
          loop={loop}
          playsInline={playsInline}
          preload={preload}
          className="w-full h-full bg-black rounded-md"
          onLoadStart={() => setLoading(true)}
          onWaiting={() => setLoading(true)}
          onSeeking={() => setLoading(true)}
          onCanPlay={() => setLoading(false)}
          onPlaying={() => setLoading(false)}
          onLoadedData={() => setLoading(false)}
          onLoadedMetadata={(e) => { setLoading(false); onLoadedMetadata?.(e) }}
          onError={(e) => {
            setLoading(false)
            setErrorMsg('Could not load video. Please refresh and try again.')
            onError?.(e)
          }}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
        />

        {loading && !errorMsg && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-md">
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-4 border-white/30 border-t-white animate-spin" />
              <span className="text-white/90 text-xs sm:text-sm font-medium">Loading video…</span>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 rounded-md">
            <div className="text-center px-4">
              <div className="text-3xl mb-2">⚠️</div>
              <p className="text-white/90 text-sm">{errorMsg}</p>
            </div>
          </div>
        )}
      </div>
    )
  }
)
