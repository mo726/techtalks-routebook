
"use client";

import { useEffect, useState } from "react";

import {
  ApiClientError,
  createDriverSale,
  getDriverStock,
  getDriverVisits,
} from "@/lib/api/client";

import type { DriverVisitsResponse } from "@/lib/api/contracts/driver-visits";
import type { DriverStockResponse } from "@/lib/api/contracts/driver-stock";
import { Alert, EmptyState, ErrorState, LoadingState } from "@/components/ui";

type PageData = {
  visits: DriverVisitsResponse["data"];
  stock: DriverStockResponse["data"];
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PageData };

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your session has expired. Sign in again.";
    }

    if (error.status === 403) {
      return "This page is available to driver accounts.";
    }

    return error.message;
  }

  return "The requested operation could not be completed.";
}

export function DriverVisitsClient() {
  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

  const [reloadKey, setReloadKey] = useState(0);
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [saleMessage, setSaleMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all([
      getDriverVisits(controller.signal),
      getDriverStock(controller.signal),
    ]).then(
      ([visitsResponse, stockResponse]) => {
        setState({
          status: "ready",
          data: {
            visits: visitsResponse.data,
            stock: stockResponse.data,
          },
        });
      },
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState({
          status: "error",
          message: getErrorMessage(error),
        });
      },
    );

    return () => controller.abort();
  }, [reloadKey]);

  async function handleCreateSale(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!activeVisitId || submitting || state.status !== "ready") {
      return;
    }

    const selectedProduct = state.data.stock.stock.find(
      (item) => item.product.id === selectedProductId,
    );

    const parsedQuantity = Number(quantity);

    if (
      !selectedProduct ||
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity <= 0 ||
      parsedQuantity > selectedProduct.availableQuantity
    ) {
      setSaleMessage("Please select a valid product and quantity.");
      return;
    }

    setSubmitting(true);
    setSaleMessage("");

    try {
      const result = await createDriverSale({
        visitId: activeVisitId,
        productId: selectedProductId,
        quantity: parsedQuantity,
        requestKey: crypto.randomUUID(),
      });

      setSaleMessage(
        `Sale created successfully. Invoice RB-${result.data.invoice.number}. Total: ${result.data.sale.totalCents} cents.`,
      );

      setActiveVisitId(null);
      setSelectedProductId("");
      setQuantity("1");
      setReloadKey((key) => key + 1);
    } catch (error) {
      setSaleMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingState label="Loading your assigned visits…" />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        message={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          setReloadKey((key) => key + 1);
        }}
        title="Could not load driver data"
      />
    );
  }

  const { vanDay, visits } = state.data.visits;
  const stock = state.data.stock.stock;

  const activeProduct = stock.find(
    (item) => item.product.id === selectedProductId,
  );

  const parsedQuantity = Number(quantity);

  const totalCents =
    activeProduct &&
    Number.isSafeInteger(parsedQuantity) &&
    parsedQuantity > 0
      ? activeProduct.product.unitPriceCents * parsedQuantity
      : 0;

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
          Driver workspace
        </p>

        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
          Assigned visits
        </h1>

        {vanDay ? (
          <p className="mt-3 text-sm text-slate-600">
            {vanDay.vanCode} ·{" "}
            <time dateTime={vanDay.businessDate}>
              {vanDay.businessDate}
            </time>
          </p>
        ) : null}
      </header>

      {saleMessage && (
        <p
          aria-live="polite"
          className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700"
        >
          {saleMessage}
        </p>
      )}

      {!vanDay ? (
        <Alert title="No open van day" variant="info">
          No open van day is currently assigned to you.
        </Alert>
      ) : null}

      {vanDay && visits.length > 0 ? (
        <ol
          aria-label="Assigned customer visits"
          className="space-y-3"
        >
          {visits.map((visit) => (
            <li
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              key={visit.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Stop {visit.position}
                  </p>

                  <h2 className="mt-1 text-lg font-semibold text-slate-950">
                    {visit.customer.name}
                  </h2>

                  <p className="mt-1 text-sm text-slate-600">
                    {visit.customer.location}
                  </p>
                </div>

                {visit.invoice ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                    Invoice RB-{visit.invoice.number}
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
                    Not invoiced
                  </span>
                )}
              </div>

              {!visit.invoice && (
                <div className="mt-5">
                  {activeVisitId === visit.id ? (
                    <form
                      className="space-y-4 border-t border-slate-200 pt-5"
                      onSubmit={handleCreateSale}
                    >
                      <div>
                        <label
                          className="mb-1 block text-sm font-medium text-slate-700"
                          htmlFor={`product-${visit.id}`}
                        >
                          Product
                        </label>

                        <select
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          id={`product-${visit.id}`}
                          value={selectedProductId}
                          onChange={(event) => {
                            setSelectedProductId(event.target.value);
                          }}
                          required
                        >
                          <option value="">Select a product</option>

                          {stock.map((item) => (
                            <option
                              key={item.product.id}
                              value={item.product.id}
                              disabled={item.availableQuantity === 0}
                            >
                              {item.product.name} — Available:{" "}
                              {item.availableQuantity} {item.product.unit}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          className="mb-1 block text-sm font-medium text-slate-700"
                          htmlFor={`quantity-${visit.id}`}
                        >
                          Quantity
                        </label>

                        <input
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          id={`quantity-${visit.id}`}
                          type="number"
                          min="1"
                          max={activeProduct?.availableQuantity ?? 1}
                          step="1"
                          value={quantity}
                          onChange={(event) => {
                            setQuantity(event.target.value);
                          }}
                          required
                        />
                      </div>

                      <div className="rounded-lg bg-slate-50 p-4">
                        <p className="text-sm text-slate-600">
                          Unit price:{" "}
                          {activeProduct
                            ? `${activeProduct.product.unitPriceCents} cents`
                            : "—"}
                        </p>

                        <p className="mt-1 text-lg font-semibold text-slate-950">
                          Total: {totalCents} cents
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                          type="submit"
                          disabled={
                            submitting ||
                            !activeProduct ||
                            parsedQuantity <= 0 ||
                            parsedQuantity > activeProduct.availableQuantity
                          }
                        >
                          {submitting ? "Creating sale..." : "Confirm sale"}
                        </button>

                        <button
                          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            setActiveVisitId(null);
                            setSelectedProductId("");
                            setQuantity("1");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                      type="button"
                      onClick={() => {
                        setActiveVisitId(visit.id);
                        setSelectedProductId("");
                        setQuantity("1");
                        setSaleMessage("");
                      }}
                    >
                      Create sale
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : vanDay ? (
        <EmptyState
          description="No customer visits have been assigned to this van day yet."
          title="No assigned visits"
        />
      ) : null}

      {vanDay && stock.length === 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No products are currently available in your van stock.
        </p>
      )}
    </section>
  );
}
