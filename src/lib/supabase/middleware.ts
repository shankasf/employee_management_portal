import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Suppress Supabase getSession() warnings - we validate in middleware
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] || '');
  if (msg.includes('Using the user object as returned from')) return;
  if (msg.includes('Node.js 18 and below are deprecated')) return;
  originalWarn.apply(console, args);
};

// Logging helper for middleware - always log for PM2 visibility
const log = (step: string, data?: Record<string, unknown>) => {
  const ts = new Date().toISOString();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [MIDDLEWARE] ${step}${dataStr}`);
};

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // PERFORMANCE: Skip middleware for static files and API routes that handle their own auth
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname === '/manifest.webmanifest' || // PWA manifest must never redirect to /login
    /\.\w{2,4}$/.test(pathname) // Static files (.ico, .png, .js, .css, etc.)
  ) {
    return NextResponse.next();
  }

  log('START', { path: pathname, method: request.method });

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Inventory the auth-related cookies we received (names + sizes only — never values)
  const incomingCookies = request.cookies.getAll();
  const sbCookies = incomingCookies
    .filter((c) => c.name.startsWith('sb-') || c.name.toLowerCase().includes('supabase'))
    .map((c) => ({ name: c.name, len: c.value?.length ?? 0 }));
  log('incoming cookies', {
    total: incomingCookies.length,
    sbCount: sbCookies.length,
    sb: sbCookies,
    hasSessionValidated: !!request.cookies.get('session_validated'),
    hasUserRole: !!request.cookies.get('user_role'),
  });

  // PERFORMANCE: Try getSession() first (reads from cookie, no network call)
  // Only call getUser() if session needs validation
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  const nowSec = Math.floor(Date.now() / 1000);
  log('getSession', {
    hasSession: !!session,
    email: session?.user?.email,
    expiresAt: session?.expires_at,
    secondsUntilExpiry: session?.expires_at ? session.expires_at - nowSec : null,
    isExpired: session?.expires_at ? session.expires_at <= nowSec : null,
    hasRefreshToken: !!session?.refresh_token,
    refreshTokenLen: session?.refresh_token?.length ?? 0,
    error: sessionError?.message,
  });

  // Check if we have a cached session validation timestamp
  // The cookie stores "timestamp:tokenPrefix" to prevent spoofing
  const lastValidatedRaw = request.cookies.get("session_validated")?.value;
  const now = Date.now();
  const VALIDATION_INTERVAL = 5 * 60 * 1000; // 5 minutes

  let user = session?.user ?? null;

  // Parse cached validation — must match current session's access token
  let lastValidated: number | null = null;
  if (lastValidatedRaw && session?.access_token) {
    const [tsStr, tokenPrefix] = lastValidatedRaw.split(':');
    const currentTokenPrefix = session.access_token.slice(-16);
    if (tokenPrefix === currentTokenPrefix) {
      lastValidated = parseInt(tsStr);
    }
  }

  // Only validate with server if session exists and hasn't been validated recently
  if (session && (!lastValidated || now - lastValidated > VALIDATION_INTERVAL)) {
    const ageMs = lastValidated ? now - lastValidated : null;
    log('getUser', {
      reason: lastValidated ? 'cache stale' : 'no cache',
      cacheAgeMs: ageMs,
      sessionExpiredBeforeCall: session.expires_at ? session.expires_at <= nowSec : null,
    });
    const preAccessToken = session.access_token;
    const t0 = Date.now();
    const { data: { user: validatedUser }, error: userError } = await supabase.auth.getUser();
    const elapsedMs = Date.now() - t0;
    user = validatedUser;

    // Re-read session after getUser — if SDK refreshed, this will show new tokens
    const { data: { session: postSession } } = await supabase.auth.getSession();
    const tokenChanged = !!postSession?.access_token && postSession.access_token !== preAccessToken;
    log('getUser result', {
      valid: !!validatedUser,
      elapsedMs,
      errorMessage: userError?.message,
      errorStatus: (userError as { status?: number } | null)?.status,
      errorCode: (userError as { code?: string } | null)?.code,
      tokenRefreshed: tokenChanged,
      newExpiresAt: postSession?.expires_at,
      newSecondsUntilExpiry: postSession?.expires_at ? postSession.expires_at - Math.floor(Date.now() / 1000) : null,
    });

    // Cache validation timestamp tied to the access token
    if (validatedUser && session.access_token) {
      const tokenPrefix = session.access_token.slice(-16);
      supabaseResponse.cookies.set("session_validated", `${now}:${tokenPrefix}`, {
        maxAge: 300, // 5 minutes
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
    }
  } else if (session) {
    log('getUser', { reason: 'skipped - recently validated' });
  } else {
    log('getUser', { reason: 'skipped - no session at all (cookies missing or unparseable)' });
  }

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/auth/callback", "/", "/forgot-password", "/reset-password"];
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith("/auth/") || pathname.startsWith("/api/")
  );

  // If not logged in and trying to access protected route
  if (!user && !isPublicRoute) {
    log('REDIRECT', {
      reason: 'no user on protected route',
      to: '/login',
      hadSessionCookie: sbCookies.length > 0,
      hadSessionInStorage: !!session,
      sessionWasExpired: session?.expires_at ? session.expires_at <= nowSec : null,
    });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If logged in, check role-based access
  if (user) {
    log('User authenticated', { id: user.id, email: user.email });
    // Check for cached role in cookie (expires after 5 minutes)
    const cachedRole = request.cookies.get("user_role")?.value;
    const cachedUserId = request.cookies.get("user_role_id")?.value;
    const cachedScoped = request.cookies.get("user_admin_scoped")?.value;

    let role = "employee";
    let adminScoped = false;

    // Use cached role if valid (same user and cache exists)
    if (cachedRole && cachedUserId === user.id) {
      role = cachedRole;
      adminScoped = cachedScoped === "1";
      log('Role from cache', { role, adminScoped });
    } else {
      // Fetch fresh role from database
      log('Fetching role from DB');
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, admin_scoped")
        .eq("id", user.id)
        .single();

      role = profile?.role || "employee";
      adminScoped = role === "admin" && !!(profile as { admin_scoped?: boolean } | null)?.admin_scoped;
      log('Role from DB', { role, adminScoped, profile: !!profile });

      // Cache role in cookie for 5 minutes
      supabaseResponse.cookies.set("user_role", role, {
        maxAge: 300, // 5 minutes
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
      supabaseResponse.cookies.set("user_role_id", user.id, {
        maxAge: 300,
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
      supabaseResponse.cookies.set("user_admin_scoped", adminScoped ? "1" : "0", {
        maxAge: 300,
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
    }

    const isAdmin = role === "admin";
    const isEmployee = role === "employee";
    log('Access check', { role, isAdmin, isEmployee, adminScoped, path: pathname });

    // Redirect logged-in users from login page
    if (pathname === "/login") {
      const dest = isAdmin ? "/admin" : "/employee";
      log('REDIRECT', { reason: 'logged in user on login page', to: dest });
      const url = request.nextUrl.clone();
      url.pathname = dest;
      return NextResponse.redirect(url);
    }

    // Protect admin routes
    if (pathname.startsWith("/admin") && !isAdmin) {
      log('REDIRECT', { reason: 'non-admin on admin route', to: '/employee' });
      const url = request.nextUrl.clone();
      url.pathname = "/employee";
      return NextResponse.redirect(url);
    }

    // Scoped (location) admins cannot access company-wide admin sections.
    if (isAdmin && adminScoped) {
      const scopedBlockedPrefixes = [
        "/admin/events",
        "/admin/reports",
        "/admin/policies",
        "/admin/activity-logs",
        "/admin/clock-debug-logs",
        "/admin/assistant",
      ];
      if (scopedBlockedPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        log('REDIRECT', { reason: 'scoped admin on restricted section', to: '/admin' });
        const url = request.nextUrl.clone();
        url.pathname = "/admin";
        return NextResponse.redirect(url);
      }
    }

    // Protect employee routes (admins can access everything)
    if (pathname.startsWith("/employee") && !isAdmin && !isEmployee) {
      log('REDIRECT', { reason: 'unauthorized on employee route', to: '/login' });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  log('ALLOW', { path: pathname });
  return supabaseResponse;
}
