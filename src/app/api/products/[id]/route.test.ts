import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: vi.fn() }));
vi.mock("@/lib/security/csrf-request", () => ({ validateCsrfRequest: vi.fn(() => null) }));
vi.mock("@/lib/db/operation-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/operation-transaction")>();
  return { ...actual, runOperationTransaction: vi.fn() };
});

import { requireStaff } from "@/lib/auth/require-staff";
import { validateCsrfRequest } from "@/lib/security/csrf-request";
import { OperationResourceNotFoundError, runOperationTransaction } from "@/lib/db/operation-transaction";
import { PATCH } from "./route";

const supervisor = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Supervisor A",
  role: "SUPERVISOR" as const,
  active: true,
};
const productId = "22222222-2222-4222-8222-222222222222";
const product = {
  id: productId,
  name: "Water bottle",
  unit: "bottle",
  priceCents: "125",
  active: true,
  createdAt: "2026-11-24T10:00:00.000Z",
};

function patchRequest(body: unknown, id = productId) {
  return new NextRequest(`http://localhost/api/products/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "44444444-4444-4444-8444-444444444444",
      origin: "http://localhost:3000",
      "x-csrf-token": "signed-token",
    },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/products/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaff).mockResolvedValue({ ok: true, profile: supervisor });
    vi.mocked(validateCsrfRequest).mockReturnValue(null);
  });

  it("updates price without changing invoice line snapshots and archives through active=false", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      void _values;
      if (sql.includes("staff_profiles")) return { rows: [{ role: "SUPERVISOR", active: true }], rowCount: 1 };
      return { rows: [product], rowCount: 1 };
    });
    vi.mocked(runOperationTransaction).mockImplementation(async (options) => {
      const client = { query } as unknown as PoolClient;
      await options.authorize({ client, replayed: false });
      const outcome = await options.execute({ client });
      return { ...outcome, replayed: false };
    });

    const response = await PATCH(patchRequest({ priceCents: "125" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(200);
    const updateCall = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE routebook.products"));
    expect(updateCall?.[0]).toContain("price_cents = $2");
    expect(updateCall?.[0]).not.toContain("invoice_lines");
    expect(updateCall?.[1]).toEqual([productId, "125"]);
    await expect(response.json()).resolves.toEqual({ success: true, data: { product } });
  });

  it("archives a product through a parameterized active flag", async () => {
    const archived = { ...product, active: false };
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      void _values;
      if (sql.includes("staff_profiles")) return { rows: [{ role: "SUPERVISOR", active: true }], rowCount: 1 };
      return { rows: [archived], rowCount: 1 };
    });
    vi.mocked(runOperationTransaction).mockImplementation(async (options) => {
      const client = { query } as unknown as PoolClient;
      await options.authorize({ client, replayed: false });
      const outcome = await options.execute({ client });
      return { ...outcome, replayed: false };
    });
    const response = await PATCH(patchRequest({ active: false }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(200);
    expect(query.mock.calls.find(([sql]) => sql.startsWith("UPDATE routebook.products"))?.[1]).toEqual([productId, false]);
    await expect(response.json()).resolves.toMatchObject({ data: { product: { active: false } } });
  });

  it("rejects invalid UUID, empty patch, invalid price and unknown fields", async () => {
    const patch = (body: unknown, id = productId) =>
      PATCH(patchRequest(body, id), { params: Promise.resolve({ id }) });
    expect((await patch({ name: "Changed" }, "bad-id")).status).toBe(422);
    expect((await patch({})).status).toBe(422);
    expect((await patch({ priceCents: "100000001" })).status).toBe(422);
    expect((await patch({ name: "Changed", actorId: supervisor.id })).status).toBe(422);
    expect(runOperationTransaction).not.toHaveBeenCalled();

    vi.mocked(validateCsrfRequest).mockReturnValueOnce(
      NextResponse.json({ error: { code: "INVALID_CSRF_TOKEN" } }, { status: 403 }),
    );
    expect((await patch({ name: "Changed" })).status).toBe(403);
  });

  it("returns 404 when the product does not exist", async () => {
    vi.mocked(runOperationTransaction).mockRejectedValueOnce(new OperationResourceNotFoundError());
    const response = await PATCH(patchRequest({ name: "Changed" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  it("rejects NUL characters in product PATCH fields before starting a mutation", async () => {
    for (const body of [{ name: "Water\0 bottle" }, { unit: "bot\0tle" }]) {
      const response = await PATCH(patchRequest(body), { params: Promise.resolve({ id: productId }) });
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(runOperationTransaction).not.toHaveBeenCalled();
  });
});
