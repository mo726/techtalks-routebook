import "server-only";
import { NextResponse } from "next/server";
import type { StaffRole } from "./authorization";
import { resolveStaffAccess } from "./authorization";
import { isMissingAuthSession } from "./session-errors";
import { createSupabaseServerClient } from "./supabase-server";
import { findStaffProfile } from "./staff-profiles";

function apiError(status: number, code: string) {
  return NextResponse.json(
    { error: { code } },
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
