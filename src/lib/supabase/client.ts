import { createBrowserClient } from "@supabase/ssr";
import { Database } from "@/types/supabase";

// Singleton instances to avoid creating new clients on every call
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;
let untypedClient: ReturnType<typeof createBrowserClient> | null = null;

// Auth configuration for proper session management
const authConfig = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
};

export function createClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      authConfig
    );
  }
  return client;
}

// Untyped client for flexibility until database types are regenerated
export function createUntypedClient() {
  if (!untypedClient) {
    untypedClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      authConfig
    );
  }
  return untypedClient;
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
