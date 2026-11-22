import { describe, expect, it, vi } from "vitest";
import { ApiClientError, getDriverVisits } from "./client";

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
});
