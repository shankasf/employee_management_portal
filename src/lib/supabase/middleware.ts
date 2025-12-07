import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Cookie name for caching user role
const ROLE_COOKIE_NAME = "user_role";
const ROLE_COOKIE_MAX_AGE = 60 * 5; // 5 minutes cache

export async function updateSession(request: NextRequest) {
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

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/auth/callback", "/"];
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith("/auth/")
  );

  // If not logged in and trying to access protected route
  if (!user && !isPublicRoute) {
    // Clear role cookie when user is not logged in
    supabaseResponse.cookies.delete(ROLE_COOKIE_NAME);
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If logged in, check role-based access
  if (user) {
    // Try to get role from cookie first (faster)
    let role = request.cookies.get(ROLE_COOKIE_NAME)?.value;

    // If no cached role, fetch from database and cache it
    if (!role) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      role = profile?.role || "employee";

      // Cache the role in a cookie
      supabaseResponse.cookies.set(ROLE_COOKIE_NAME, role as string, {
        path: "/",
        maxAge: ROLE_COOKIE_MAX_AGE,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
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
