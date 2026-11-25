import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { vanDayStockResponseSchema } from "@/lib/api/contracts/van-day-stock";
import { getVanDayStock } from "@/lib/db/van-day-stock";
import { requireStaff } from "@/lib/auth/require-staff";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const uuidSchema = z.string().uuid();

function apiError(status: number, code: string) {
  return NextResponse.json(
    { error: { code } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const access = await requireStaff(["DRIVER", "SUPERVISOR"]);
  if (!access.ok) return access.response;

  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return apiError(400, "INVALID_VAN_DAY_ID");

  const stock = await getVanDayStock({
    vanDayId: parsedId.data,
    staffId: access.profile.id,
    canViewAll: access.profile.role === "SUPERVISOR",
  });
  if (!stock) return apiError(404, "VAN_DAY_NOT_FOUND");

  const response = vanDayStockResponseSchema.parse({
    success: true,
    data: stock,
  });
  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
