import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-staff", () => ({
  requireStaff: vi.fn(),
}));
vi.mock("@/lib/db/pool", () => ({
  getPool: vi.fn(),
}));

import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import { GET } from "./route";

const driver = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Driver A",
  role: "DRIVER" as const,
  active: true,
};

describe("GET /api/driver/stock", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaff).mockResolvedValue({
      ok: true,
      profile: driver,
    });
    vi.mocked(getPool).mockReturnValue({
      query,
    } as unknown as ReturnType<typeof getPool>);
  });

  it("returns loaded and remaining product quantities for the signed-in driver's open day", async () => {
    query.mockResolvedValue({
      rows: [
        {
          day_id: "22222222-2222-4222-8222-222222222222",
          van_code: "VAN-01",
          business_date: "2026-11-23",
          day_state: "OPEN",
          day_revision: 4,
          product_id: "33333333-3333-4333-8333-333333333333",
          product_name: "Water",
          product_unit: "bottle",
          opening_quantity: 100,
          available_quantity: "85",
        },
      ],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        vanDay: {
          id: "22222222-2222-4222-8222-222222222222",
          vanCode: "VAN-01",
          businessDate: "2026-11-23",
          state: "OPEN",
          revision: 4,
        },
        stock: [
          {
            product: {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Water",
              unit: "bottle",
            },
            openingQuantity: 100,
            availableQuantity: 85,
          },
        ],
      },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("state = 'OPEN'"),
      [null, false, driver.id],
    );
    expect(query.mock.calls[0][0]).toContain(
      "SUM(invoice_line.quantity)::bigint AS sold_quantity",
    );
  });

  it("denies non-driver access without querying stock", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: { code: "ROLE_FORBIDDEN" } },
        { status: 403 },
      ),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns an explicit empty state when no open van day is assigned", async () => {
    query.mockResolvedValue({ rows: [] });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { vanDay: null, stock: [] },
    });
  });

  it("rejects inconsistent negative available stock instead of hiding it", async () => {
    query.mockResolvedValue({
      rows: [
        {
          day_id: "22222222-2222-4222-8222-222222222222",
          van_code: "VAN-01",
          business_date: "2026-11-23",
          day_state: "OPEN",
          day_revision: 4,
          product_id: "33333333-3333-4333-8333-333333333333",
          product_name: "Water",
          product_unit: "bottle",
          opening_quantity: 100,
          available_quantity: "-1",
        },
      ],
    });

    await expect(GET()).rejects.toThrow();
  });
});
