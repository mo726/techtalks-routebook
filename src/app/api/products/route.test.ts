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
const product = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Water bottle",
  unit: "bottle",
  priceCents: "100",
  active: true,
  createdAt: "2026-11-24T10:00:00.000Z",
};

function postRequest(body: unknown, key = "44444444-4444-4444-8444-444444444444") {
  return new NextRequest("http://localhost/api/products", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      origin: "http://localhost:3000",
      "x-csrf-token": "signed-token",
    },
    body: JSON.stringify(body),
  });
}

describe("/api/products", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: supervisor });
    vi.mocked(getPool).mockReturnValue({ query } as never);
    vi.mocked(validateCsrfRequest).mockReturnValue(null);
  });

  it("lists products with deterministic indexed ordering and protected cache headers", async () => {
    query.mockResolvedValue({ rows: [product] });
    const response = await GET(new NextRequest("http://localhost/api/products"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY active, name, id");
    expect(query.mock.calls[0]?.[1]).toEqual([26]);
    await expect(response.json()).resolves.toEqual({ success: true, data: { items: [product], nextCursor: null } });
  });

  it("limits driver reads to active products in SQL", async () => {
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: driver });
    query.mockResolvedValue({ rows: [product] });
    const response = await GET(new NextRequest("http://localhost/api/products"));
    expect(response.status).toBe(200);
    expect(query.mock.calls[0]?.[0]).toContain("WHERE active = TRUE");
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY active, name, id");
  });

  it("creates products with cents preserved as decimal strings", async () => {
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      if (sql.includes("staff_profiles")) return { rows: [{ role: "SUPERVISOR", active: true }], rowCount: 1 };
      return { rows: [product], rowCount: 1 };
    });
    vi.mocked(runOperationTransaction).mockImplementation(async (options) => {
      const client = { query: clientQuery } as unknown as PoolClient;
      await options.authorize({ client, replayed: false });
      const outcome = await options.execute({ client });
      return { ...outcome, replayed: false };
    });

    const response = await POST(postRequest({ name: "Water bottle", unit: "bottle", priceCents: "100" }));
    expect(response.status).toBe(201);
    const insert = clientQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO routebook.products"));
    expect(insert?.[1]).toEqual(["Water bottle", "bottle", "100"]);
    await expect(response.json()).resolves.toEqual({ success: true, data: { product } });
  });

  it("rejects numeric, fractional, zero, negative and over-limit prices plus unknown fields", async () => {
    for (const priceCents of [100, "1.2", "0", "-1", "100000001"]) {
      const response = await POST(postRequest({ name: "Water", unit: "bottle", priceCents }));
      expect(response.status).toBe(422);
    }
    const unknown = await POST(postRequest({ name: "Water", unit: "bottle", priceCents: "100", openingBalanceCents: "0" }));
    expect(unknown.status).toBe(422);
    expect(runOperationTransaction).not.toHaveBeenCalled();
  });

  it("requires a supervisor, valid CSRF and an idempotency key for product writes", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "ROLE_FORBIDDEN" } }, { status: 403 }),
    });
    expect((await POST(postRequest({ name: "Water", unit: "bottle", priceCents: "100" }))).status).toBe(403);

    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: supervisor });
    vi.mocked(validateCsrfRequest).mockReturnValueOnce(
      NextResponse.json({ error: { code: "INVALID_CSRF_TOKEN" } }, { status: 403 }),
    );
    expect((await POST(postRequest({ name: "Water", unit: "bottle", priceCents: "100" }))).status).toBe(403);

    const missingKey = new NextRequest("http://localhost/api/products", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "x-csrf-token": "signed-token" },
      body: JSON.stringify({ name: "Water", unit: "bottle", priceCents: "100" }),
    });
    expect((await POST(missingKey)).status).toBe(400);
  });

  it("rejects NUL characters in product POST fields before starting a mutation", async () => {
    for (const body of [
      { name: "Water\0 bottle", unit: "bottle", priceCents: "100" },
      { name: "Water bottle", unit: "bot\0tle", priceCents: "100" },
    ]) {
      const response = await POST(postRequest(body));
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(runOperationTransaction).not.toHaveBeenCalled();
  });
});
