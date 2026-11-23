"use client";

import { useEffect, useState } from "react";
import { ApiClientError, getDriverStock } from "@/lib/api/client";
import type { DriverStockResponse } from "@/lib/api/contracts/driver-stock";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DriverStockResponse["data"] };

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 401) {
    return "Your session has expired. Sign in again to view van stock.";
  }
  if (error instanceof ApiClientError && error.status === 403) {
    return "This page is available to driver accounts.";
  }
  return "Van stock could not be loaded. Please try again.";
}

export function DriverStockClient() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getDriverStock(controller.signal).then(
      (response) => setState({ status: "ready", data: response.data }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({ status: "error", message: getErrorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [reloadKey]);

  if (state.status === "loading") {
    return (
      <section aria-live="polite" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">Loading your van stock…</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section
        aria-live="polite"
        className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-slate-950">
          Could not load van stock
        </h1>
        <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        <button
          className="mt-5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          onClick={() => {
            setState({ status: "loading" });
            setReloadKey((key) => key + 1);
          }}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  const { vanDay, stock } = state.data;

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
          Driver workspace
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
          Van stock
        </h1>
        {vanDay ? (
          <p className="mt-3 text-sm text-slate-600">
            {vanDay.vanCode} ·{" "}
            <time dateTime={vanDay.businessDate}>{vanDay.businessDate}</time>
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No open van day is currently assigned to you.
          </p>
        )}
      </header>

      {vanDay && stock.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Available van stock by product</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold" scope="col">Product</th>
                <th className="px-5 py-3 font-semibold" scope="col">Loaded</th>
                <th className="px-5 py-3 font-semibold" scope="col">Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stock.map((item) => (
                <tr key={item.product.id}>
                  <th className="px-5 py-4 font-medium text-slate-950" scope="row">
                    {item.product.name}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      ({item.product.unit})
                    </span>
                  </th>
                  <td className="px-5 py-4 text-slate-700">
                    {item.openingQuantity}
                  </td>
                  <td className="px-5 py-4 font-semibold text-slate-900">
                    {item.availableQuantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : vanDay ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No products have been loaded for this van day.
        </p>
      ) : null}
    </section>
  );
}
