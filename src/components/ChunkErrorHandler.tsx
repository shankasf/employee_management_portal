'use client';

import { useEffect } from 'react';

function isChunkError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'ChunkLoadError') return true;
    const msg = error.message.toLowerCase();
    if (msg.includes('loading chunk') || msg.includes('failed to fetch dynamically imported module')) return true;
  }
  return false;
}

function isStaleScriptError(event: Event): boolean {
  // Script/link elements that fail to load (400, 404, MIME mismatch)
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tagName = target.tagName?.toLowerCase();
  if (tagName === 'script' || tagName === 'link') {
    const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';
    // Only auto-reload for Next.js chunk files
    if (src.includes('/_next/')) return true;
  }
  return false;
}

const STORAGE_KEY = 'chunk_error_reload';
const MAX_RELOADS = 2;
const WINDOW_MS = 30_000;

function shouldReload(): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const now = Date.now();

    if (raw) {
      const data = JSON.parse(raw) as { count: number; timestamp: number };
      if (now - data.timestamp > WINDOW_MS) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ count: 1, timestamp: now }));
        return true;
      }
      if (data.count >= MAX_RELOADS) return false;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ count: data.count + 1, timestamp: data.timestamp }));
      return true;
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ count: 1, timestamp: now }));
    return true;
  } catch {
    return false;
  }
}

export default function ChunkErrorHandler() {
  useEffect(() => {
    // Catches JS-level ChunkLoadError (dynamic imports)
    function handleError(event: ErrorEvent) {
      if (isChunkError(event.error) && shouldReload()) {
        window.location.reload();
      }
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (isChunkError(event.reason) && shouldReload()) {
        window.location.reload();
      }
    }

    // Catches network-level script/link load failures (400, 404, MIME mismatch)
    // Must use capture phase since these don't bubble
    function handleResourceError(event: Event) {
      if (isStaleScriptError(event) && shouldReload()) {
        window.location.reload();
      }
    }

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    document.addEventListener('error', handleResourceError, true);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      document.removeEventListener('error', handleResourceError, true);
    };
  }, []);

  return null;
}
