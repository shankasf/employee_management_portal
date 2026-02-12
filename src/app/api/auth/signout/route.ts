import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST() {
  console.log(`[${new Date().toISOString()}] [AUTH] Sign out request received`);
  let response = NextResponse.json({ success: true });

  try {
    const cookieStore = await cookies();
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
    console.log(`[${new Date().toISOString()}] [AUTH] Sign out successful - clearing cookies`);

    // Clear all cached cookies used by middleware
    response.cookies.delete("user_role");
    response.cookies.delete("user_role_id");
    response.cookies.delete("session_validated");
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [AUTH] Sign out error:`, err);
    response = NextResponse.json(
      { success: false, error: "signout_failed" },
      { status: 500 }
    );
  }

  return response;
}
