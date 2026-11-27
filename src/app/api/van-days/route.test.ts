import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: vi.fn() }));
vi.mock("@/lib/db/pool", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/security/csrf-request", () => ({
  validateCsrfRequest: vi.fn(() => null),
}));
vi.mock("@/lib/db/van-day-transaction", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/van-day-transaction")>();
  return {
    ...actual,
    runStandaloneOperation: vi.fn(),
  };
});

import { POST, GET } from "./route";
import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import { runStandaloneOperation } from "@/lib/db/van-day-transaction";

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
const driverId = "44444444-4444-4444-8444-444444444444";
const query = vi.fn();

function makeRequest(
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(url, {
    headers: {
      origin: "http://localhost:3000",
      "x-csrf-token": "test-token",
      cookie: "routebook-csrf=test-nonce",
      ...init?.headers,
    },
    ...init,
  });
}

describe("/api/van-days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaff).mockResolvedValue({
      ok: true,
      profile: supervisor,
    });
    vi.mocked(getPool).mockReturnValue({
      query,
    } as unknown as ReturnType<typeof getPool>);
  });

  it("lists van days with assigned load and visits and supervisor driver choices", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: dayId,
          vanCode: "VAN-01",
          businessDate: "2026-11-25",
          state: "PREPARING",
          revision: 1,
          driver: { id: driverId, displayName: "Driver A" },
          load: [],
          visits: [],
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: driverId, display_name: "Driver A" }],
      });

    const response = await GET(
      makeRequest("http://localhost:3000/api/van-days?limit=10"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        vanDays: [{
          id: dayId,
          vanCode: "VAN-01",
          businessDate: "2026-11-25",
          state: "PREPARING",
          revision: 1,
          driver: { id: driverId, displayName: "Driver A" },
          load: [],
          visits: [],
        }],
        staff: [{ id: driverId, displayName: "Driver A" }],
        nextCursor: null,
      },
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("day.driver_id = $3::uuid"),
      [null, true, supervisor.id, 11],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("role = 'DRIVER' AND active = true"),
    );
  });

  it("limits driver reads to their own days and omits staff choices", async () => {
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: driver });
    query.mockResolvedValueOnce({ rows: [] });

    const response = await GET(
      makeRequest("http://localhost:3000/api/van-days?cursor=33333333-3333-4333-8333-333333333333"),
    );

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual([dayId, false, driver.id, 26]);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      data: { vanDays: [], nextCursor: null },
    });
    expect(body.data).not.toHaveProperty("staff");
  });

  it("rejects invalid pagination without querying the database", async () => {
    const response = await GET(
      makeRequest("http://localhost:3000/api/van-days?limit=101"),
    );

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("requires supervisor authorization before creating a van day", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "ROLE_FORBIDDEN" } }, { status: 403 }),
    });

    const response = await POST(
      makeRequest("http://localhost:3000/api/van-days", {
        method: "POST",
        headers: { "idempotency-key": "55555555-5555-4555-8555-555555555555" },
        body: JSON.stringify({
          vanCode: "VAN-04",
          businessDate: "2026-11-25",
          driverId,
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(runStandaloneOperation).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before creating a van day", async () => {
    const response = await POST(
      makeRequest("http://localhost:3000/api/van-days", {
        method: "POST",
        body: JSON.stringify({
          vanCode: "VAN-04",
          businessDate: "2026-11-25",
          driverId,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(runStandaloneOperation).not.toHaveBeenCalled();
  });

  it("submits a validated create operation with actor and idempotency key", async () => {
    vi.mocked(runStandaloneOperation).mockResolvedValue({
      status: 201,
      replayed: false,
      body: {
        success: true,
        data: { vanDay: { id: dayId } },
      },
    });

    const response = await POST(
      makeRequest("http://localhost:3000/api/van-days", {
        method: "POST",
        headers: { "idempotency-key": "55555555-5555-4555-8555-555555555555" },
        body: JSON.stringify({
          vanCode: "van-04",
          businessDate: "2026-11-25",
          driverId,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotency-Replayed")).toBe("false");
    expect(runStandaloneOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: supervisor.id,
        requestKey: "55555555-5555-4555-8555-555555555555",
        methodRoute: "POST /api/van-days",
        requestBody: {
          vanCode: "VAN-04",
          businessDate: "2026-11-25",
          driverId,
        },
      }),
    );
  });
});
