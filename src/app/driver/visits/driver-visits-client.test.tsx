import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverVisitsClient } from "./driver-visits-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriverVisitsClient", () => {
  it("renders the assigned visits and invoice status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
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
        }),
      ),
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
      vi.fn(async () =>
        Response.json({
          success: true,
          data: { vanDay: null, visits: [] },
        }),
      ),
    );

    render(<DriverVisitsClient />);

    expect(
      await screen.findByText("No open van day is currently assigned to you."),
    ).toBeInTheDocument();
  });

  it("shows an error and retries rather than displaying an empty list", async () => {
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
          data: { vanDay: null, visits: [] },
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    render(<DriverVisitsClient />);

    expect(await screen.findByText("Could not load visits")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByText("No open van day is currently assigned to you."),
    ).toBeInTheDocument();
  });
});
