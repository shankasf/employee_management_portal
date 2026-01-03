import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST() {
  let response = NextResponse.json({ success: true });

  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    await supabase.auth.signOut();

    // Clear the cached user role cookie
    response.cookies.delete("user_role");
  } catch (err) {
    console.error("Server signout error:", err);
    response = NextResponse.json(
      { success: false, error: "signout_failed" },
      { status: 500 }
    );
  }

  return response;
}
