'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'chunk_error_reload';
const MAX_RELOADS = 3;
const WINDOW_MS = 30_000;

function isChunkError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'ChunkLoadError') return true;
    const msg = error.message.toLowerCase();
    if (msg.includes('loading chunk') || msg.includes('failed to fetch dynamically imported module') || msg.includes('failed to fetch')) return true;
  }
  return false;
}

function shouldReload(): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const now = Date.now();
    if (raw) {
      const data = JSON.parse(raw) as { c: number; t: number };
      if (now - data.t > WINDOW_MS) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ c: 1, t: now }));
        return true;
      }
      if (data.c >= MAX_RELOADS) return false;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ c: data.c + 1, t: data.t }));
      return true;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ c: 1, t: now }));
    return true;
  } catch {
    return false;
  }
}

export default function EmployeeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkError(error);

  useEffect(() => {
    if (chunk && shouldReload()) {
      window.location.reload();
    }
  }, [error, chunk]);

  if (chunk) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
        <p className="text-muted-foreground">Updating to latest version...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
      <p className="text-muted-foreground mb-4">An unexpected error occurred.</p>
      <div className="flex gap-3">
        <button className="btn-secondary" onClick={() => reset()}>
          Try Again
        </button>
        <button className="btn-primary" onClick={() => window.location.reload()}>
          Reload Page
        </button>
      </div>
    </div>
  );
}
