import { NextResponse, type NextRequest } from "next/server";
import { isMissingAuthSession } from "@/lib/auth/session-errors";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { CSRF_COOKIE_NAME, validateCsrfRequest } from "@/lib/security/csrf-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient({ writeCookies: true });
  const { data, error: userError } = await supabase.auth.getUser();

  if (userError && !isMissingAuthSession(userError)) {
    return NextResponse.json(
      { error: { code: "AUTH_SERVICE_UNAVAILABLE" } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (!data.user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const csrfResponse = validateCsrfRequest(request, data.user.id);
  if (csrfResponse) {
    return csrfResponse;
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    return NextResponse.json(
      { error: { code: "AUTH_SERVICE_UNAVAILABLE" } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
  response.cookies.set(CSRF_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
