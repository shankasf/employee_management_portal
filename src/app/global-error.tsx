'use client';

import { useEffect, useState } from 'react';

function isChunkError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'ChunkLoadError') return true;
    const msg = error.message.toLowerCase();
    if (msg.includes('loading chunk') || msg.includes('failed to fetch dynamically imported module') || msg.includes('failed to fetch')) return true;
  }
  return false;
}

const STORAGE_KEY = 'chunk_error_reload';
const MAX_RELOADS = 3;
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

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const chunk = isChunkError(error);

  useEffect(() => {
    if (chunk && shouldReload()) {
      window.location.reload();
    }
  }, [error, chunk]);

  if (chunk) {
    return (
      <html lang="en">
        <body>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            fontFamily: 'system-ui, sans-serif',
            padding: '20px',
            textAlign: 'center',
          }}>
            <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: 16 }} />
            <style dangerouslySetInnerHTML={{ __html: '@keyframes spin{to{transform:rotate(360deg)}}' }} />
            <p style={{ color: '#666' }}>Updating to latest version...</p>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
          padding: '20px',
          textAlign: 'center',
        }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
            Something went wrong
          </h2>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            An unexpected error occurred. Please try again.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => reset()}
              style={{
                padding: '10px 24px',
                fontSize: '1rem',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 24px',
                fontSize: '1rem',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Reload Page
            </button>
          </div>
          <button
            onClick={() => setShowDetails(v => !v)}
            style={{
              marginTop: '24px',
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: '0.75rem',
              textDecoration: 'underline',
            }}
          >
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
          {showDetails && (
            <pre style={{
              marginTop: '12px',
              padding: '12px',
              background: '#f3f4f6',
              borderRadius: '6px',
              fontSize: '0.75rem',
              color: '#374151',
              maxWidth: '90vw',
              overflow: 'auto',
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {error.name}: {error.message}
              {error.digest ? `\nDigest: ${error.digest}` : ''}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
