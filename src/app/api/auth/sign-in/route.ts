import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { resolveStaffAccess } from "@/lib/auth/authorization";
import { isMissingAuthSession } from "@/lib/auth/session-errors";
import { findStaffProfile } from "@/lib/auth/staff-profiles";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { validateCsrfRequest } from "@/lib/security/csrf-request";

export const runtime = "nodejs";

const signInSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

async function readSignInBody(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return { ok: false as const, response: NextResponse.json(
      { error: { code: "UNSUPPORTED_MEDIA_TYPE" } },
      { status: 415 },
    ) };
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 8192)
  ) {
    return { ok: false as const, response: NextResponse.json(
      { error: { code: "PAYLOAD_TOO_LARGE" } },
      { status: 413 },
    ) };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false as const, response: NextResponse.json(
      { error: { code: "INVALID_REQUEST_BODY" } },
      { status: 400 },
    ) };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > 8192) {
      await reader.cancel();
      return { ok: false as const, response: NextResponse.json(
        { error: { code: "PAYLOAD_TOO_LARGE" } },
        { status: 413 },
      ) };
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false as const, response: NextResponse.json(
        { error: { code: "INVALID_REQUEST_BODY" } },
        { status: 400 },
      ) };
    }

    throw error;
  }

  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false as const, response: NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS_FORMAT" } },
      { status: 422 },
    ) };
  }

  return { ok: true as const, credentials: parsed.data };
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient({ writeCookies: true });
  const {
    data: currentSession,
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError && !isMissingAuthSession(sessionError)) {
    return NextResponse.json(
      { error: { code: "AUTH_SERVICE_UNAVAILABLE" } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const csrfResponse = validateCsrfRequest(
    request,
    currentSession.user?.id ?? null,
  );
  if (csrfResponse) {
    return csrfResponse;
  }

  const body = await readSignInBody(request);
  if (!body.ok) {
    return body.response;
  }

  const { data, error } = await supabase.auth.signInWithPassword(
    body.credentials,
  );

  if (error || !data.user) {
    const status = error?.status === 400 || error?.status === 401 ? 401 : 503;
    return NextResponse.json(
      {
        error: {
          code: status === 401 ? "INVALID_CREDENTIALS" : "AUTH_SERVICE_UNAVAILABLE",
        },
      },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const profile = await findStaffProfile(data.user.id);
  const access = resolveStaffAccess(profile, ["DRIVER", "SUPERVISOR"]);

  if (!access.ok) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      return NextResponse.json(
        { error: { code: "SIGN_OUT_FAILED" } },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    return NextResponse.json(
      { error: { code: "STAFF_ACCESS_DENIED" } },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { profile: access.profile },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
