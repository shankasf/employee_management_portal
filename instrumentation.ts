// This file runs before the app starts (Next.js instrumentation)
// Suppress specific Supabase warnings that are informational only

// Apply warning suppression immediately
const originalWarn = console.warn;
const originalError = console.error;

console.warn = (...args: unknown[]) => {
  const msg = String(args[0] || '');
  if (
    msg.includes('Node.js 18 and below are deprecated') ||
    msg.includes('Using the user object as returned from') ||
    msg.includes('supabase.auth.getSession()') ||
    msg.includes('supabase.auth.onAuthStateChange()')
  ) {
    return;
  }
  originalWarn.apply(console, args);
};

// Also suppress emoji warnings that go to stderr
console.error = (...args: unknown[]) => {
  const msg = String(args[0] || '');
  if (msg.includes('Node.js 18 and below are deprecated')) {
    return;
  }
  originalError.apply(console, args);
};

export async function register() {
  // Instrumentation hook - runs on server startup
}
