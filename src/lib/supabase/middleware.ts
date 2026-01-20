import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // PERFORMANCE: Skip middleware for static files and API routes that handle their own auth
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname.includes('.') // Static files (.ico, .png, etc.)
  ) {
    return NextResponse.next();
  }

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

  // Check if we have a cached session validation timestamp
  const lastValidated = request.cookies.get("session_validated")?.value;
  const now = Date.now();
  const VALIDATION_INTERVAL = 5 * 60 * 1000; // 5 minutes

  let user = session?.user ?? null;

  // Only validate with server if session exists and hasn't been validated recently
  if (session && (!lastValidated || now - parseInt(lastValidated) > VALIDATION_INTERVAL)) {
    const { data: { user: validatedUser } } = await supabase.auth.getUser();
    user = validatedUser;

    // Cache validation timestamp
    if (validatedUser) {
      supabaseResponse.cookies.set("session_validated", now.toString(), {
        maxAge: 300, // 5 minutes
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
  }

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/auth/callback", "/", "/forgot-password", "/reset-password"];
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith("/auth/") || pathname.startsWith("/api/")
  );

  // If not logged in and trying to access protected route
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If logged in, check role-based access
  if (user) {
    // Check for cached role in cookie (expires after 5 minutes)
    const cachedRole = request.cookies.get("user_role")?.value;
    const cachedUserId = request.cookies.get("user_role_id")?.value;

    let role = "employee";

    // Use cached role if valid (same user and cache exists)
    if (cachedRole && cachedUserId === user.id) {
      role = cachedRole;
    } else {
      // Fetch fresh role from database
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      role = profile?.role || "employee";

      // Cache role in cookie for 30 minutes
      supabaseResponse.cookies.set("user_role", role, {
        maxAge: 1800, // 30 minutes
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      supabaseResponse.cookies.set("user_role_id", user.id, {
        maxAge: 1800,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }

    const isAdmin = role === "admin";
    const isEmployee = role === "employee";

    // Redirect logged-in users from login page
    if (pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = isAdmin ? "/admin" : "/employee";
      return NextResponse.redirect(url);
    }

    // Protect admin routes
    if (pathname.startsWith("/admin") && !isAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = "/employee";
      return NextResponse.redirect(url);
    }

    // Protect employee routes (admins can access everything)
    if (pathname.startsWith("/employee") && !isAdmin && !isEmployee) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
