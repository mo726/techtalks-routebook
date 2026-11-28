import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: vi.fn() }));
vi.mock("@/lib/db/pool", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/security/csrf-request", () => ({ validateCsrfRequest: vi.fn(() => null) }));
vi.mock("@/lib/db/operation-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/operation-transaction")>();
  return { ...actual, runOperationTransaction: vi.fn() };
});

import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import { validateCsrfRequest } from "@/lib/security/csrf-request";
import { runOperationTransaction } from "@/lib/db/operation-transaction";
import { GET, POST } from "./route";

const supervisor = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Supervisor A",
  role: "SUPERVISOR" as const,
  active: true,
};
const driver = { ...supervisor, role: "DRIVER" as const, displayName: "Driver A" };
const customer = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Cedar Market",
  location: "Beirut",
  active: true,
  createdAt: "2026-11-24T10:00:00.000Z",
};

function makeRequest(url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/customers", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: supervisor });
    vi.mocked(getPool).mockReturnValue({ query } as never);
  });

  it("lists customers with private caching and stable pagination", async () => {
    query.mockResolvedValue({ rows: [customer, { ...customer, id: "33333333-3333-4333-8333-333333333333", name: "Elm Shop" }] });
    const response = await GET(new NextRequest("http://localhost/api/customers?limit=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY c.active, c.name, c.id");
    expect(query.mock.calls[0]?.[0]).toContain("LIMIT $1");
    expect(query.mock.calls[0]?.[1]).toEqual([2]);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { items: [customer], nextCursor: expect.any(String) },
    });
  });

  it("enforces driver customer visibility in SQL through the current OPEN-day assignment", async () => {
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: driver });
    query.mockResolvedValue({ rows: [customer] });
    const response = await GET(new NextRequest("http://localhost/api/customers"));
    expect(response.status).toBe(200);
    expect(query.mock.calls[0]?.[0]).toContain("JOIN routebook.van_days AS day");
    expect(query.mock.calls[0]?.[0]).toContain("day.driver_id = $1");
    expect(query.mock.calls[0]?.[0]).toContain("day.state = 'OPEN'");
    expect(query.mock.calls[0]?.[0]).toContain("c.active = TRUE");
    expect(query.mock.calls[0]?.[1]).toEqual([driver.id, 26]);
  });

  it("does not list an out-of-scope cursor and rejects invalid pagination without querying", async () => {
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: driver });
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const cursor = Buffer.from(JSON.stringify({ active: true, name: "Elsewhere", id: customer.id })).toString("base64url");
    const deniedCursor = await GET(new NextRequest(`http://localhost/api/customers?cursor=${cursor}`));
    expect(deniedCursor.status).toBe(422);
    expect(query.mock.calls[0]?.[0]).toContain("day.driver_id = $1");

    query.mockClear();
    const invalid = await GET(new NextRequest("http://localhost/api/customers?limit=101&extra=1"));
    expect(invalid.status).toBe(422);
    expect(query).not.toHaveBeenCalled();
  });

  it("normalizes missing and inactive staff errors without querying customer data", async () => {
    for (const [code, status] of [["UNAUTHENTICATED", 401], ["STAFF_PROFILE_INACTIVE", 403]] as const) {
      vi.mocked(requireStaff).mockResolvedValueOnce({
        ok: false,
        response: NextResponse.json({ error: { code } }, { status }),
      });
      const response = await GET(new NextRequest("http://localhost/api/customers"));
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(response.json()).resolves.toMatchObject({ success: false, error: { code } });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("creates a customer with the database zero-balance default and an atomic receipt", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes("staff_profiles")) return { rows: [{ role: "SUPERVISOR", active: true }], rowCount: 1 };
      return { rows: [customer], rowCount: 1 };
    });
    vi.mocked(runOperationTransaction).mockImplementation(async (options) => {
      const client = { query: clientQuery } as unknown as PoolClient;
      await options.authorize({ client, replayed: false });
      const outcome = await options.execute({ client });
      return { ...outcome, replayed: false };
    });

    const response = await POST(
      makeRequest("http://localhost/api/customers", { name: "Cedar Market", location: "Beirut" }, {
        "idempotency-key": "44444444-4444-4444-8444-444444444444",
        origin: "http://localhost:3000",
        "x-csrf-token": "signed-token",
      }),
    );
    expect(response.status).toBe(201);
    expect(clientQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO routebook.customers (name, location)"))).toBe(true);
    expect(vi.mocked(runOperationTransaction).mock.calls[0]?.[0]).toMatchObject({
      actorId: supervisor.id,
      methodRoute: "POST /api/customers",
    });
    expect(validateCsrfRequest).toHaveBeenCalledWith(expect.anything(), supervisor.id);
    await expect(response.json()).resolves.toEqual({ success: true, data: { customer } });
  });

  it("rejects driver writes, missing keys, invalid CSRF and forbidden opening-balance fields", async () => {
    const request = () => makeRequest("http://localhost/api/customers", { name: "Cedar", location: "Beirut" }, {
      "idempotency-key": "44444444-4444-4444-8444-444444444444",
      origin: "http://localhost:3000",
      "x-csrf-token": "signed-token",
    });

    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "ROLE_FORBIDDEN" } }, { status: 403 }),
    });
    expect((await POST(request())).status).toBe(403);
    expect(vi.mocked(runOperationTransaction)).not.toHaveBeenCalled();

    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: supervisor });
    expect((await POST(makeRequest("http://localhost/api/customers", { name: "Cedar", location: "Beirut" }))).status).toBe(400);

    vi.mocked(validateCsrfRequest).mockReturnValueOnce(
      NextResponse.json({ error: { code: "INVALID_CSRF_TOKEN" } }, { status: 403 }),
    );
    expect((await POST(request())).status).toBe(403);

    const invalidBody = makeRequest("http://localhost/api/customers", {
      name: "Cedar", location: "Beirut", openingBalanceCents: "3000",
    }, {
      "idempotency-key": "44444444-4444-4444-8444-444444444444",
      origin: "http://localhost:3000",
      "x-csrf-token": "signed-token",
    });
    expect((await POST(invalidBody)).status).toBe(422);
  });

  it("rejects NUL characters in customer POST fields before starting a mutation", async () => {
    const headers = {
      "idempotency-key": "44444444-4444-4444-8444-444444444444",
      origin: "http://localhost:3000",
      "x-csrf-token": "signed-token",
    };
    for (const body of [
      { name: "Cedar\0 Market", location: "Beirut" },
      { name: "Cedar Market", location: "Bei\0rut" },
    ]) {
      const response = await POST(makeRequest("http://localhost/api/customers", body, headers));
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(runOperationTransaction).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
