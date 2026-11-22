import { describe, expect, it } from "vitest";
import { resolveStaffAccess, type StaffProfile } from "./authorization";

const activeDriver: StaffProfile = {
  id: "staff-123",
  displayName: "Driver A",
  role: "DRIVER",
  active: true,
};

describe("resolveStaffAccess", () => {
  it("allows an active profile when its role is permitted", () => {
    expect(resolveStaffAccess(activeDriver, ["DRIVER"])).toEqual({
      ok: true,
      profile: activeDriver,
    });
  });

  it("denies missing and inactive profiles", () => {
    expect(resolveStaffAccess(null, ["DRIVER"])).toEqual({
      ok: false,
      status: 403,
      code: "STAFF_PROFILE_REQUIRED",
    });
    expect(
      resolveStaffAccess({ ...activeDriver, active: false }, ["DRIVER"]),
    ).toEqual({
      ok: false,
      status: 403,
      code: "STAFF_PROFILE_INACTIVE",
    });
  });

  it("denies a role not explicitly permitted by the endpoint", () => {
    expect(resolveStaffAccess(activeDriver, ["SUPERVISOR"])).toEqual({
      ok: false,
      status: 403,
      code: "ROLE_FORBIDDEN",
    });
  });
});
