import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: vi.fn() }));
vi.mock("@/lib/security/csrf-request", () => ({ validateCsrfRequest: vi.fn(() => null) }));
vi.mock("@/lib/db/van-day-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/van-day-transaction")>();
  return { ...actual, runVanDayOperation: vi.fn() };
});

import { requireStaff } from "@/lib/auth/require-staff";
import { runVanDayOperation } from "@/lib/db/van-day-transaction";
import { POST } from "./route";

const driver = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Driver A",
  role: "DRIVER" as const,
  active: true,
};
const visitId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const requestKey = "44444444-4444-4444-8444-444444444444";

function request(body: unknown = { visitId, productId, quantity: 3 }, key: string | null = requestKey) {
  const headers = new Headers({
    origin: "http://localhost:3000",
    "content-type": "application/json",
    "x-csrf-token": "signed-token",
  });
  if (key) headers.set("idempotency-key", key);
  return new NextRequest("http://localhost/api/driver/sales", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/driver/sales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: driver });
  });

  it("locks the visit's assigned open van day, writes a priced invoice, and records the day revision", async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("SELECT day_id")) return { rows: [{ day_id: "55555555-5555-4555-8555-555555555555" }], rowCount: 1 };
      if (sql.includes("SELECT 1") && sql.includes("routebook.visits")) return { rows: [{}], rowCount: 1 };
      if (sql.includes("FROM routebook.invoices WHERE visit_id")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT product.id")) {
        return { rows: [{ id: productId, price_cents: "125", opening_quantity: "10", sold_quantity: "2" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO routebook.invoices")) {
        return { rows: [{ id: "66666666-6666-4666-8666-666666666666", number: "12" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    vi.mocked(runVanDayOperation).mockImplementation(async (options) => {
      const client = { query } as unknown as PoolClient;
      const context = {
        client,
        vanDay: { id: "55555555-5555-4555-8555-555555555555", state: "OPEN" as const, revision: 1 },
      };
      await options.authorize({ ...context, replayed: false });
      const outcome = await options.execute(context);
      return { ...outcome, replayed: false };
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        invoice: { id: "66666666-6666-4666-8666-666666666666", number: "12" },
        sale: { productId, quantity: 3, unitPriceCents: 125, totalCents: 375 },
      },
    });
    expect(runVanDayOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: driver.id,
        requestKey,
        resource: expect.objectContaining({ id: visitId }),
        requestBody: { productId, quantity: 3 },
      }),
    );
    expect(queries.some((sql) => sql.includes("UPDATE routebook.van_days SET revision = revision + 1"))).toBe(true);
  });

  it("rejects a missing idempotency key before starting a transaction", async () => {
    const response = await POST(request({ visitId, productId, quantity: 1 }, null));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INVALID_IDEMPOTENCY_KEY" },
    });
    expect(runVanDayOperation).not.toHaveBeenCalled();
  });

  it("returns a private error when the visit has no accessible van day", async () => {
    vi.mocked(runVanDayOperation).mockImplementation(async (options) => {
      if (!("resource" in options) || !options.resource) {
        throw new Error("A visit resource is required.");
      }
      const client = {
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as PoolClient;
      await options.resource.resolveVanDayId(client, visitId);
      throw new Error("The missing visit should have been rejected.");
    });
    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VISIT_NOT_FOUND" },
    });
  });

  it("returns a staff authorization response without attempting a sale", async () => {
    vi.mocked(requireStaff).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: { code: "ROLE_FORBIDDEN" } }, { status: 403 }),
    });

    expect((await POST(request())).status).toBe(403);
    expect(runVanDayOperation).not.toHaveBeenCalled();
  });
});
