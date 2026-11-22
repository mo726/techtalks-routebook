import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";

export const runtime = "nodejs";

export async function GET() {
  const result = await requireStaff(["DRIVER", "SUPERVISOR"]);
  if (!result.ok) {
    return result.response;
  }

  return NextResponse.json(
    { profile: result.profile },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
