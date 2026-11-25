import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { driverStockResponseSchema } from "@/lib/api/contracts/driver-stock";
import { getVanDayStock } from "@/lib/db/van-day-stock";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireStaff(["DRIVER"]);
  if (!access.ok) {
    return access.response;
  }

  const stock = await getVanDayStock({
    vanDayId: null,
    staffId: access.profile.id,
    canViewAll: false,
  });

  const response = driverStockResponseSchema.parse({
    success: true,
    data: {
      vanDay: stock?.vanDay ?? null,
      stock: stock?.stock ?? [],
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
