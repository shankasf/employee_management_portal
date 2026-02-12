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

  // PERFORMANCE: Try getSession() first (reads from cookie, no network call)
  // Only call getUser() if session needs validation
  const { data: { session } } = await supabase.auth.getSession();
  log('getSession', { hasSession: !!session, email: session?.user?.email });

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
    log('getUser', { reason: 'validation needed' });
    const { data: { user: validatedUser } } = await supabase.auth.getUser();
    user = validatedUser;
    log('getUser result', { valid: !!validatedUser });

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
  }

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/auth/callback", "/", "/forgot-password", "/reset-password"];
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith("/auth/") || pathname.startsWith("/api/")
  );

  // If not logged in and trying to access protected route
  if (!user && !isPublicRoute) {
    log('REDIRECT', { reason: 'no user on protected route', to: '/login' });
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

    let role = "employee";

    // Use cached role if valid (same user and cache exists)
    if (cachedRole && cachedUserId === user.id) {
      role = cachedRole;
      log('Role from cache', { role });
    } else {
      // Fetch fresh role from database
      log('Fetching role from DB');
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      role = profile?.role || "employee";
      log('Role from DB', { role, profile: !!profile });

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
    }

    const isAdmin = role === "admin";
    const isEmployee = role === "employee";
    log('Access check', { role, isAdmin, isEmployee, path: pathname });

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
