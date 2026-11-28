
import { describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  createDriverSale,
  getDriverStock,
  getDriverVisits,
} from "./client";

const responseBody = {
  success: true,
  data: {
    vanDay: {
      id: "11111111-1111-4111-8111-111111111111",
      vanCode: "VAN-01",
      businessDate: "2026-11-22",
      state: "OPEN",
      revision: 1,
    },
    visits: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        position: 1,
        customer: {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Cedar Market",
          location: "Beirut",
        },
        invoice: null,
      },
    ],
  },
};

describe("getDriverVisits", () => {
  it("requests a private no-store response and validates its shape", async () => {
    const fetcher = vi.fn(async () => Response.json(responseBody));

    await expect(getDriverVisits(undefined, fetcher)).resolves.toEqual(
      responseBody,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/driver/visits",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
  });

  describe("getDriverStock", () => {
    it("requests and validates the current driver's stock", async () => {
      const payload = {
        success: true,
        data: {
          vanDay: null,
          stock: [
            {
              product: {
                id: "44444444-4444-4444-8444-444444444444",
                name: "Water",
                unit: "bottle",
                unitPriceCents: 150,
              },
              openingQuantity: 100,
              availableQuantity: 85,
            },
          ],
        },
      };
      const fetcher = vi.fn(async () => Response.json(payload));

      await expect(getDriverStock(undefined, fetcher)).resolves.toEqual(payload);
      expect(fetcher).toHaveBeenCalledWith(
        "/api/driver/stock",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    it("reports failed stock reads instead of using an empty fallback", async () => {
      const fetcher = vi.fn(async () =>
        Response.json(
          { error: { code: "DATABASE_UNAVAILABLE" } },
          { status: 503 },
        ),
      );

      await expect(getDriverStock(undefined, fetcher)).rejects.toMatchObject({
        status: 503,
        code: "DATABASE_UNAVAILABLE",
      });
    });
  });

  it("surfaces API errors without treating them as empty visits", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
    );

    await expect(getDriverVisits(undefined, fetcher)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("rejects malformed success payloads", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ success: true, data: { visits: [] } }),
    );

    await expect(getDriverVisits(undefined, fetcher)).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it("normalizes network errors for the page", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(getDriverVisits(undefined, fetcher)).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("sends sales with a CSRF token and an idempotency header", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: "csrf-token" }))
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: {
            invoice: {
              id: "55555555-5555-4555-8555-555555555555",
              number: "12",
            },
            sale: {
              productId: "44444444-4444-4444-8444-444444444444",
              quantity: 2,
              unitPriceCents: 150,
              totalCents: 300,
            },
          },
        }),
      );

    await expect(
      createDriverSale(
        {
          visitId: "22222222-2222-4222-8222-222222222222",
          productId: "44444444-4444-4444-8444-444444444444",
          quantity: 2,
          requestKey: "33333333-3333-4333-8333-333333333333",
        },
        fetcher,
      ),
    ).resolves.toMatchObject({ success: true });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/driver/sales",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-CSRF-Token": "csrf-token",
          "Idempotency-Key": "33333333-3333-4333-8333-333333333333",
        }),
        body: JSON.stringify({
          visitId: "22222222-2222-4222-8222-222222222222",
          productId: "44444444-4444-4444-8444-444444444444",
          quantity: 2,
        }),
      }),
    );
  });
});
