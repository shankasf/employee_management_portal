import { createBrowserClient } from "@supabase/ssr";
import { Database } from "@/types/supabase";

// Suppress specific Supabase warnings that are informational only
if (typeof window === 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0] || '');
    // Skip Supabase getSession() and Node.js deprecation warnings
    if (
      msg.includes('supabase.auth.getSession()') ||
      msg.includes('supabase.auth.onAuthStateChange()') ||
      msg.includes('Node.js 18 and below are deprecated')
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
}

// Single shared client instance to ensure auth state is consistent everywhere
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      }
    );
  }
  return client;
}

// Untyped client - returns the SAME client instance as createClient()
// This ensures auth state is shared across all usages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createUntypedClient(): any {
  return createClient();
}

// Helper to check if an error is an auth error
export function isAuthError(error: unknown): boolean {
  if (!error) return false;
  const errMessage = String((error as { message?: string })?.message || error).toLowerCase();
  const errCode = String((error as { code?: string })?.code || '');
  return (
    errMessage.includes('jwt expired') ||
    errMessage.includes('invalid jwt') ||
    errMessage.includes('not authenticated') ||
    errMessage.includes('session expired') ||
    errMessage.includes('refresh_token_not_found') ||
    errCode === 'PGRST301' || // PostgREST auth error
    errCode === '401'
  );
}

// Attempt to refresh the session
export async function refreshSession(): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      console.warn('Session refresh failed:', error?.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error refreshing session:', err);
    return false;
  }
}
