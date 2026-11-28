
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverVisitsClient } from "./driver-visits-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const visitsResponse = {
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

const emptyVisitsResponse = {
  success: true,
  data: {
    vanDay: null,
    visits: [],
  },
};

const stockResponse = {
  success: true,
  data: {
    vanDay: {
      id: "11111111-1111-4111-8111-111111111111",
      vanCode: "VAN-01",
      businessDate: "2026-11-22",
      state: "OPEN",
      revision: 1,
    },
    stock: [
      {
        product: {
          id: "44444444-4444-4444-8444-444444444444",
          name: "Water",
          unit: "bottle",
          unitPriceCents: 150,
        },
        openingQuantity: 100,
        availableQuantity: 100,
      },
    ],
  },
};

const emptyStockResponse = {
  success: true,
  data: {
    vanDay: null,
    stock: [],
  },
};

describe("DriverVisitsClient", () => {
  it("renders the assigned visits and invoice status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/api/driver/stock")) {
          return Response.json(stockResponse);
        }

        return Response.json(visitsResponse);
      }),
    );

    render(<DriverVisitsClient />);

    expect(
      await screen.findByRole("heading", { name: "Assigned visits" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Cedar Market")).toBeInTheDocument();
    expect(screen.getByText("Beirut")).toBeInTheDocument();
    expect(screen.getByText("Not invoiced")).toBeInTheDocument();
  });

  it("shows a clear empty state when the driver has no open van day", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/api/driver/stock")) {
          return Response.json(emptyStockResponse);
        }

        return Response.json(emptyVisitsResponse);
      }),
    );

    render(<DriverVisitsClient />);

    expect(
      await screen.findByText("No open van day is currently assigned to you."),
    ).toBeInTheDocument();
  });

  it("shows an error and retries rather than displaying an empty list", async () => {
    let visitsRequestCount = 0;

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/driver/stock")) {
        return Response.json(stockResponse);
      }

      visitsRequestCount += 1;

      if (visitsRequestCount === 1) {
        return Response.json(
          { error: { code: "DATABASE_UNAVAILABLE" } },
          { status: 503 },
        );
      }

      return Response.json(emptyVisitsResponse);
    });

    vi.stubGlobal("fetch", fetcher);

    render(<DriverVisitsClient />);

    expect(await screen.findByText("Could not load driver data")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(visitsRequestCount).toBe(2);
    });

    expect(
      await screen.findByText("No open van day is currently assigned to you."),
    ).toBeInTheDocument();
  });
});
