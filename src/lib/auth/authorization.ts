export const STAFF_ROLES = ["DRIVER", "SUPERVISOR"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffProfile = {
  id: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
};

export type StaffAccessResult =
  | { ok: true; profile: StaffProfile }
  | {
      ok: false;
      status: 403;
      code:
        | "STAFF_PROFILE_REQUIRED"
        | "STAFF_PROFILE_INACTIVE"
        | "ROLE_FORBIDDEN";
    };

export function resolveStaffAccess(
  profile: StaffProfile | null,
  allowedRoles: readonly StaffRole[],
): StaffAccessResult {
  if (!profile) {
    return { ok: false, status: 403, code: "STAFF_PROFILE_REQUIRED" };
  }

  if (!profile.active) {
    return { ok: false, status: 403, code: "STAFF_PROFILE_INACTIVE" };
  }

  if (!allowedRoles.includes(profile.role)) {
    return { ok: false, status: 403, code: "ROLE_FORBIDDEN" };
  }

  return { ok: true, profile };
}
