import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: vi.fn() }));
vi.mock("@/lib/db/van-day-stock", () => ({ getVanDayStock: vi.fn() }));

import { requireStaff } from "@/lib/auth/require-staff";
import { getVanDayStock } from "@/lib/db/van-day-stock";
import { GET } from "./route";

const supervisor = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Supervisor A",
  role: "SUPERVISOR" as const,
  active: true,
};
const driver = {
  id: "22222222-2222-4222-8222-222222222222",
  displayName: "Driver A",
  role: "DRIVER" as const,
  active: true,
};
const dayId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const stockData = {
  vanDay: {
    id: dayId,
    vanCode: "VAN-01",
    businessDate: "2026-11-25",
    state: "OPEN" as const,
    revision: 3,
  },
  stock: [{
    product: { id: productId, name: "Water", unit: "bottle", unitPriceCents: 150 },
    openingQuantity: 100,
    availableQuantity: 85,
  }],
};

function routeContext(id = dayId) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/van-days/[id]/stock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaff).mockResolvedValue({
      ok: true,
      profile: supervisor,
    });
    vi.mocked(getVanDayStock).mockResolvedValue(stockData);
  });

  it("returns invoice-derived stock to a supervisor for any van day", async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/van-days/${dayId}/stock`),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getVanDayStock).toHaveBeenCalledWith({
      vanDayId: dayId,
      staffId: supervisor.id,
      canViewAll: true,
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        ...stockData,
        stock: [{
          product: { id: productId, name: "Water", unit: "bottle" },
          openingQuantity: 100,
          availableQuantity: 85,
        }],
      },
    });
  });

  it("limits driver stock reads to the authenticated driver's day", async () => {
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: driver });

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/van-days/${dayId}/stock`),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(getVanDayStock).toHaveBeenCalledWith({
      vanDayId: dayId,
      staffId: driver.id,
      canViewAll: false,
    });
  });

  it("hides missing and unassigned days behind the same 404 response", async () => {
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: driver });
    vi.mocked(getVanDayStock).mockResolvedValue(null);

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/van-days/${dayId}/stock`),
      routeContext(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VAN_DAY_NOT_FOUND" },
    });
  });

  it("rejects malformed day IDs before reading stock", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/van-days/not-a-uuid/stock"),
      routeContext("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(getVanDayStock).not.toHaveBeenCalled();
  });

  it("denies guests before querying stock", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
    });

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/van-days/${dayId}/stock`),
      routeContext(),
    );

    expect(response.status).toBe(401);
    expect(getVanDayStock).not.toHaveBeenCalled();
  });
});
