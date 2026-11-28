import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

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

describe("GET /api/driver/visits", () => {
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

  it("returns visits only from the authenticated driver's open van day", async () => {
    query.mockResolvedValue({
      rows: [
        {
          day_id: "22222222-2222-4222-8222-222222222222",
          van_code: "VAN-01",
          business_date: "2026-11-22",
          day_state: "OPEN",
          day_revision: 3,
          visit_id: "33333333-3333-4333-8333-333333333333",
          visit_position: 1,
          customer_id: "44444444-4444-4444-8444-444444444444",
          customer_name: "Cedar Market",
          customer_location: "Beirut",
          invoice_id: "55555555-5555-4555-8555-555555555555",
          invoice_number: "12",
          invoice_version: 2,
          total_cents: "1000",
          paid_cents: "200",
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
          businessDate: "2026-11-22",
          state: "OPEN",
          revision: 3,
        },
        visits: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            position: 1,
            customer: {
              id: "44444444-4444-4444-8444-444444444444",
              name: "Cedar Market",
              location: "Beirut",
            },
            invoice: {
              id: "55555555-5555-4555-8555-555555555555",
              number: "12",
              version: 2,
              totalCents: "1000",
              paidCents: "200",
              balanceCents: "800",
            },
          },
        ],
      },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE driver_id = $1 AND state = 'OPEN'"),
      [driver.id],
    );
  });

  it("denies access to non-drivers without querying visit data", async () => {
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

  it("returns a successful empty state when no open day is assigned", async () => {
    query.mockResolvedValue({ rows: [] });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { vanDay: null, visits: [] },
    });
  });
});
