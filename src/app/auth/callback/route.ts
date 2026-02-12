import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // Use trusted origin from environment variable, not from request headers
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://admin.playfunia.com';

  if (code) {
    const cookieStore = await cookies();

    // Track cookies that need to be set on the response
    const cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[] = [];

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookies) {
            cookies.forEach((cookie) => {
              cookiesToSet.push(cookie);
            });
          },
        },
      }
    );

    const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code);

    console.log(`[${new Date().toISOString()}] [AUTH] Callback received | origin: ${origin} | user: ${session?.user?.email} | error: ${error?.message || 'none'} | cookies: ${cookiesToSet.length}`);

    if (error) {
      console.error(`[${new Date().toISOString()}] [AUTH] Callback error:`, error);
      return NextResponse.redirect(`${origin}/login?error=auth_failed`);
    }

    if (session?.user) {
      // Create service client for admin operations
      const serviceClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll() {
              // Service client doesn't need to set cookies
            },
          },
        }
      );

      if (!session.user.email) {
        console.error(`[${new Date().toISOString()}] [AUTH] User session has no email`);
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=no_email`);
      }

      const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('id, role')
        .eq('email', session.user.email)
        .single();

      if (profileError || !profile) {
        // User doesn't exist in the system - they're not an employee
        // Sign them out and redirect with error
        console.log(`[${new Date().toISOString()}] [AUTH] Google sign-in blocked - user not in system: ${session.user.email}`);

        await supabase.auth.signOut();

        // Delete the user from auth if they were just created via Google
        // This prevents orphan auth users
        try {
          await serviceClient.auth.admin.deleteUser(session.user.id);
        } catch (deleteErr) {
          console.error(`[${new Date().toISOString()}] [AUTH] Failed to delete non-employee user:`, deleteErr);
        }

        return NextResponse.redirect(`${origin}/login?error=not_existing_user`);
      }

      // User exists - redirect based on role
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profileData = profile as any;
      const redirectPath = profileData.role === 'admin' ? '/admin' : '/employee';
      console.log(`[${new Date().toISOString()}] [AUTH] Login successful | user: ${session.user.email} | role: ${profileData.role} | redirect: ${redirectPath}`);

      // Create response and set all accumulated cookies with proper options
      const response = NextResponse.redirect(`${origin}${redirectPath}`);
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, {
          ...options,
          path: '/',
          sameSite: 'lax',
          secure: origin.startsWith('https'),
        });
      });
      return response;
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
