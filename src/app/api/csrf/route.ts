import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isMissingAuthSession } from "@/lib/auth/session-errors";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createCsrfToken } from "@/lib/security/csrf";
import { CSRF_COOKIE_NAME } from "@/lib/security/csrf-request";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error && !isMissingAuthSession(error)) {
    return NextResponse.json(
      { error: { code: "AUTH_SERVICE_UNAVAILABLE" } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const secret = process.env.CSRF_SECRET;
  if (!secret) {
    throw new Error("CSRF_SECRET is required.");
  }

  const nonce = randomBytes(32).toString("hex");
  const token = createCsrfToken(data.user?.id ?? null, nonce, secret);
  const response = NextResponse.json(
    { token },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  response.cookies.set(CSRF_COOKIE_NAME, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60,
  });

  return response;
}
