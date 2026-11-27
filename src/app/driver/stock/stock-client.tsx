"use client";

import { useEffect, useState } from "react";
import { ApiClientError, getDriverStock } from "@/lib/api/client";
import type { DriverStockResponse } from "@/lib/api/contracts/driver-stock";
import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";

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
    return <LoadingState label="Loading your van stock…" />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        message={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          setReloadKey((key) => key + 1);
        }}
        title="Could not load van stock"
      />
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
        ) : null}
      </header>

      {!vanDay ? (
        <Alert title="No open van day" variant="info">
          No open van day is currently assigned to you.
        </Alert>
      ) : null}

      {vanDay && stock.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Table caption="Available van stock by product">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Product</TableHeaderCell>
                <TableHeaderCell>Loaded</TableHeaderCell>
                <TableHeaderCell>Available</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stock.map((item) => (
                <TableRow key={item.product.id}>
                  <TableHeaderCell
                    className="font-medium normal-case tracking-normal text-slate-950"
                    scope="row"
                  >
                    {item.product.name}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      ({item.product.unit})
                    </span>
                  </TableHeaderCell>
                  <TableCell>
                    {item.openingQuantity}
                  </TableCell>
                  <TableCell className="font-semibold text-slate-900">
                    {item.availableQuantity}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : vanDay ? (
        <EmptyState
          description="No products have been loaded for this van day."
          title="No van stock"
        />
      ) : null}
    </section>
  );
}
