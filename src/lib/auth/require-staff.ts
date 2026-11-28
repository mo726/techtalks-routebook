import "server-only";
import { NextResponse } from "next/server";
import type { StaffRole } from "./authorization";
import { resolveStaffAccess } from "./authorization";
import { isMissingAuthSession } from "./session-errors";
import { createSupabaseServerClient } from "./supabase-server";
import { findStaffProfile } from "./staff-profiles";

const errorMessages: Record<string, string> = {
  AUTH_SERVICE_UNAVAILABLE: "Authentication is temporarily unavailable.",
  UNAUTHENTICATED: "Sign in to continue.",
  STAFF_PROFILE_REQUIRED: "A staff profile is required.",
  STAFF_PROFILE_INACTIVE: "This staff profile is inactive.",
  ROLE_FORBIDDEN: "This role is not allowed.",
};

function apiError(status: number, code: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message: errorMessages[code] ?? "The request could not be authorized.",
        retryable: status === 503,
      },
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function requireStaff(
  allowedRoles: readonly StaffRole[],
): Promise<
  | { ok: true; profile: NonNullable<Awaited<ReturnType<typeof findStaffProfile>>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error && !isMissingAuthSession(error)) {
    return {
      ok: false,
      response: apiError(503, "AUTH_SERVICE_UNAVAILABLE"),
    };
  }

  if (!data.user) {
    return { ok: false, response: apiError(401, "UNAUTHENTICATED") };
  }

  const profile = await findStaffProfile(data.user.id);
  const access = resolveStaffAccess(profile, allowedRoles);

  if (!access.ok) {
    return {
      ok: false,
      response: apiError(access.status, access.code),
    };
  }

  return { ok: true, profile: access.profile };
}
