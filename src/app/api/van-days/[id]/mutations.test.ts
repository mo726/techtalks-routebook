import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";

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
    runVanDayOperation: vi.fn(),
  };
});

import { GET as getVisits, POST as assignVisit } from "./visits/route";
import { PUT as replaceLoad } from "./load/route";
import { POST as openDay } from "./open/route";
import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import {
  runVanDayOperation,
  type LockedVanDay,
} from "@/lib/db/van-day-transaction";

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
const customerId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const visitId = "66666666-6666-4666-8666-666666666666";
const requestKey = "77777777-7777-4777-8777-777777777777";
const query = vi.fn();
let lockedDay: LockedVanDay;
let transactionQuery: ReturnType<typeof vi.fn>;

function request(
  path: string,
  method: string,
  body?: unknown,
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      origin: "http://localhost:3000",
      "x-csrf-token": "test-token",
      cookie: "routebook-csrf=test-nonce",
      "idempotency-key": requestKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: dayId }) };
}

describe("van-day detail mutations and assigned visits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockedDay = { id: dayId, state: "PREPARING", revision: 1 };
    vi.mocked(requireStaff).mockResolvedValue({
      ok: true,
      profile: supervisor,
    });
    vi.mocked(getPool).mockReturnValue({
      query,
    } as unknown as ReturnType<typeof getPool>);
    transactionQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM routebook.customers")) {
        return {
          rows: [{ id: customerId, name: "Cedar Market", location: "Beirut" }],
          rowCount: 1,
        };
      }
      if (sql.includes("MAX(position)")) {
        return { rows: [{ position: 2 }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO routebook.visits")) {
        return { rows: [{ id: visitId }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT 1")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (sql.includes("FROM routebook.products")) {
        return { rows: [{ id: productId }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE routebook.van_days")) {
        return {
          rows: [{ revision: lockedDay.revision + 1 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    vi.mocked(runVanDayOperation).mockImplementation(async (options) => {
      const context = {
        client: { query: transactionQuery } as unknown as PoolClient,
        vanDay: lockedDay,
      };
      await options.authorize({ ...context, replayed: false });
      return { ...(await options.execute(context)), replayed: false };
    });
  });

  it("returns visits for a requested day only when the supervisor or assigned driver can read it", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: true,
      profile: driver,
    });
    query.mockResolvedValueOnce({
      rows: [{
        id: dayId,
        state: "OPEN",
        revision: 2,
        visit_id: visitId,
        position: 1,
        customer_id: customerId,
        customer_name: "Cedar Market",
        customer_location: "Beirut",
        invoice_id: null,
        invoice_number: null,
      }],
    });

    const response = await getVisits(
      request(`/api/van-days/${dayId}/visits`, "GET"),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("OR day.driver_id = $3"),
      [dayId, false, driver.id],
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        vanDay: { id: dayId, state: "OPEN", revision: 2 },
        visits: [{
          id: visitId,
          position: 1,
          customer: { id: customerId, name: "Cedar Market", location: "Beirut" },
          invoice: null,
        }],
      },
    });
  });

  it("appends an active customer as a visit and advances the day revision", async () => {
    const response = await assignVisit(
      request(`/api/van-days/${dayId}/visits`, "POST", { customerId }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expect(runVanDayOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: supervisor.id,
        vanDayId: dayId,
        methodRoute: "POST /api/van-days/:id/visits",
        requestKey,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        visit: { id: visitId, position: 2, customer: { id: customerId } },
        vanDayRevision: 2,
      },
    });
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE routebook.van_days"),
      [dayId],
    );
  });

  it("rejects visit assignments when the van day is no longer preparing", async () => {
    lockedDay = { ...lockedDay, state: "OPEN" };

    const response = await assignVisit(
      request(`/api/van-days/${dayId}/visits`, "POST", { customerId }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "DAY_NOT_PREPARING" },
    });
    expect(transactionQuery).not.toHaveBeenCalled();
  });

  it("replaces a load only with active products and the expected revision", async () => {
    const response = await replaceLoad(
      request(`/api/van-days/${dayId}/load`, "PUT", {
        expectedRevision: 1,
        items: [{ productId, quantity: 100 }],
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(runVanDayOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: supervisor.id,
        vanDayId: dayId,
        methodRoute: "PUT /api/van-days/:id/load",
        requestBody: { expectedRevision: 1, items: [{ productId, quantity: 100 }] },
      }),
    );
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM routebook.load_items"),
      [dayId],
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { vanDayId: dayId, revision: 2, load: [{ productId, quantity: 100 }] },
    });
  });

  it("rejects stale load revisions without mutating load rows", async () => {
    lockedDay = { ...lockedDay, revision: 3 };

    const response = await replaceLoad(
      request(`/api/van-days/${dayId}/load`, "PUT", {
        expectedRevision: 1,
        items: [{ productId, quantity: 100 }],
      }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "STALE_REVISION" },
    });
    expect(transactionQuery).not.toHaveBeenCalled();
  });

  it("opens a preparing day only when it has an active driver and loaded stock", async () => {
    const response = await openDay(
      request(`/api/van-days/${dayId}/open`, "POST", {
        expectedRevision: 1,
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(runVanDayOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: supervisor.id,
        vanDayId: dayId,
        methodRoute: "POST /api/van-days/:id/open",
      }),
    );
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("driver.active = true"),
      [dayId],
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: dayId, state: "OPEN", revision: 2 },
    });
  });

  it("rejects an open request when the day has no active driver or load", async () => {
    transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT 1")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const response = await openDay(
      request(`/api/van-days/${dayId}/open`, "POST", {
        expectedRevision: 1,
      }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "DAY_REQUIRES_ACTIVE_DRIVER_AND_LOAD" },
    });
  });

  it("rejects invalid route IDs before querying or mutating data", async () => {
    const response = await replaceLoad(
      request("/api/van-days/not-a-uuid/load", "PUT", {
        expectedRevision: 1,
        items: [],
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(runVanDayOperation).not.toHaveBeenCalled();
  });

  it("denies non-supervisors from changing load or opening days", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "ROLE_FORBIDDEN" } }, { status: 403 }),
    });

    const response = await openDay(
      request(`/api/van-days/${dayId}/open`, "POST", {
        expectedRevision: 1,
      }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(runVanDayOperation).not.toHaveBeenCalled();
  });
});
