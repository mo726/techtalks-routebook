import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverStockClient } from "./stock-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriverStockClient", () => {
  it("shows product load and available quantities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          data: {
            vanDay: {
              id: "11111111-1111-4111-8111-111111111111",
              vanCode: "VAN-01",
              businessDate: "2026-11-23",
              state: "OPEN",
              revision: 4,
            },
            stock: [
              {
                product: {
                  id: "22222222-2222-4222-8222-222222222222",
                  name: "Water",
                  unit: "bottle",
                },
                openingQuantity: 100,
                availableQuantity: 85,
              },
            ],
          },
        }),
      ),
    );

    render(<DriverStockClient />);

    expect(
      await screen.findByRole("heading", { name: "Van stock" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("shows the no-open-day state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          data: { vanDay: null, stock: [] },
        }),
      ),
    );

    render(<DriverStockClient />);

    expect(
      await screen.findByText("No open van day is currently assigned to you."),
    ).toBeInTheDocument();
  });

  it("shows an error and allows retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "DATABASE_UNAVAILABLE" } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: { vanDay: null, stock: [] },
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    render(<DriverStockClient />);

    expect(
      await screen.findByText("Could not load van stock"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByText("No open van day is currently assigned to you."),
    ).toBeInTheDocument();
  });
});
