import "server-only";
import { z } from "zod";
import { getPool } from "@/lib/db/pool";
import type { StaffProfile } from "./authorization";

const staffProfileRowSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1).max(120),
  role: z.enum(["DRIVER", "SUPERVISOR"]),
  active: z.boolean(),
});

export async function findStaffProfile(
  authUserId: string,
): Promise<StaffProfile | null> {
  const result = await getPool().query(
    `SELECT id, display_name, role, active
       FROM routebook.staff_profiles
      WHERE id = $1
      LIMIT 1`,
    [authUserId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const parsed = staffProfileRowSchema.parse(row);

  return {
    id: parsed.id,
    displayName: parsed.display_name,
    role: parsed.role,
    active: parsed.active,
  };
}
