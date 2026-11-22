import "server-only";
import { isMissingAuthSession } from "./session-errors";
import { createSupabaseServerClient } from "./supabase-server";
import { findStaffProfile } from "./staff-profiles";

export async function getCurrentStaffProfile() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (isMissingAuthSession(error)) {
      return null;
    }

    throw new Error("Unable to verify the current staff session.", {
      cause: error,
    });
  }

  if (!data.user) {
    return null;
  }

  const profile = await findStaffProfile(data.user.id);
  return profile?.active ? profile : null;
}
