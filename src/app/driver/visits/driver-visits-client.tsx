
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  ApiClientError,
  createDriverSale,
  getOperationReceipt,
  getDriverStock,
  getDriverVisits,
  recordPayment,
} from "@/lib/api/client";

import type { DriverVisit, DriverVisitsResponse } from "@/lib/api/contracts/driver-visits";
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

type PendingPayment = {
  requestKey: string;
  amountCents: number;
  expectedInvoiceVersion: number;
};

type PaymentStatus =
  | "idle"
  | "submitting"
  | "pending"
  | "success"
  | "error";

function formatMoney(cents: string | number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(cents) / 100);
}

function getStorageKey(invoiceId: string) {
  return `routebook:pending-payment:${invoiceId}`;
}

function parsePendingPayment(value: string | null): PendingPayment | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("requestKey" in parsed) ||
      !("amountCents" in parsed) ||
      !("expectedInvoiceVersion" in parsed)
    ) {
      return null;
    }

    const request = parsed as Record<string, unknown>;

    if (
      typeof request.requestKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.requestKey,
      ) ||
      typeof request.amountCents !== "number" ||
      !Number.isSafeInteger(request.amountCents) ||
      request.amountCents <= 0 ||
      typeof request.expectedInvoiceVersion !== "number" ||
      !Number.isInteger(request.expectedInvoiceVersion) ||
      request.expectedInvoiceVersion <= 0
    ) {
      return null;
    }

    return {
      requestKey: request.requestKey,
      amountCents: request.amountCents,
      expectedInvoiceVersion: request.expectedInvoiceVersion,
    };
  } catch {
    return null;
  }
}

function isUncertainPaymentError(error: unknown) {
  return (
    error instanceof ApiClientError &&
    (error.status === 0 ||
      error.status === 500 ||
      error.status === 502 ||
      error.status === 503)
  );
}

const PAYMENT_METHOD_ROUTE = "POST /api/invoices/{id}/payments";

function PaymentForm({
  invoice,
  onPaid,
}: {
  invoice: NonNullable<DriverVisit["invoice"]>;
  onPaid: () => void;
}) {
  const [initialRequest] = useState<PendingPayment | null>(() =>
    parsePendingPayment(
      typeof window === "undefined"
        ? null
        : localStorage.getItem(getStorageKey(invoice.id)),
    ),
  );

  const [amount, setAmount] = useState(() =>
    initialRequest
      ? (initialRequest.amountCents / 100).toFixed(2)
      : "",
  );

  const [status, setStatus] = useState<PaymentStatus>(
    initialRequest ? "pending" : "idle",
  );

  const [message, setMessage] = useState(
    initialRequest
      ? "Checking the original payment after reopening the page..."
      : "",
  );

  const [pendingRequest, setPendingRequest] =
    useState<PendingPayment | null>(initialRequest);

  const finishPayment = useCallback(() => {
    localStorage.removeItem(getStorageKey(invoice.id));
    setPendingRequest(null);
    setStatus("success");
    setMessage("Payment confirmed successfully.");
    onPaid();
  }, [invoice.id, onPaid]);

  const verifyPayment = useCallback(
    async (request: PendingPayment) => {
      setStatus("pending");
      setMessage("Checking the original payment result...");

      try {
        const receipt = await getOperationReceipt(request.requestKey);

        if (receipt.data.methodRoute !== PAYMENT_METHOD_ROUTE) {
          localStorage.removeItem(getStorageKey(invoice.id));
          setPendingRequest(null);
          setStatus("error");
          setMessage("The saved request does not belong to this payment.");
          return;
        }

        if (receipt.data.originalStatus === 201) {
          finishPayment();
          return;
        }

        setMessage(
          "The original operation has not returned a final confirmation. Keep this request and check again.",
        );
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          (error.status === 404 ||
            error.code === "OPERATION_NOT_FINALIZED")
        ) {
          setMessage(
            "No committed payment was found yet. You can safely retry using the same request key.",
          );
          return;
        }

        setMessage(
          "Payment status could not be verified. Keep this request and check again.",
        );
      }

      setStatus("pending");
    },
    [finishPayment, invoice.id],
  );

  useEffect(() => {
    if (!initialRequest) return;

    let cancelled = false;

    void getOperationReceipt(initialRequest.requestKey).then(
      (receipt) => {
        if (cancelled) return;

        if (receipt.data.methodRoute !== PAYMENT_METHOD_ROUTE) {
          localStorage.removeItem(getStorageKey(invoice.id));
          setPendingRequest(null);
          setStatus("error");
          setMessage("The saved request does not belong to this payment.");
          return;
        }

        if (receipt.data.originalStatus === 201) {
          finishPayment();
        } else {
          setStatus("pending");
          setMessage("The original payment is awaiting verification.");
        }
      },
      (error: unknown) => {
        if (cancelled) return;

        setStatus("pending");

        if (
          error instanceof ApiClientError &&
          (error.status === 404 ||
            error.code === "OPERATION_NOT_FINALIZED")
        ) {
          setMessage(
            "No committed payment was found yet. You can safely retry using the same request key.",
          );
        } else {
          setMessage(
            "Payment status could not be verified. Keep this request and check again.",
          );
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [initialRequest, finishPayment, invoice.id]);

  const submitPayment = useCallback(
    async (request: PendingPayment) => {
      setStatus("submitting");
      setMessage("Submitting payment...");

      try {
        await recordPayment(
          invoice.id,
          request.amountCents,
          request.expectedInvoiceVersion,
          request.requestKey,
        );

        finishPayment();
      } catch (error) {
        if (isUncertainPaymentError(error)) {
          setPendingRequest(request);
          setStatus("pending");
          setMessage(
            "Confirmation may have been interrupted. Check the original operation before retrying.",
          );
          return;
        }

        localStorage.removeItem(getStorageKey(invoice.id));
        setPendingRequest(null);
        setStatus("error");

        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to record payment.",
        );
      }
    },
    [invoice.id, finishPayment],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (status === "submitting" || pendingRequest) return;

    const normalizedAmount = amount.trim();

    if (!/^\d+(\.\d{1,2})?$/.test(normalizedAmount)) {
      setStatus("error");
      setMessage("Enter a valid payment amount.");
      return;
    }

    const [wholePart, decimalPart = ""] = normalizedAmount.split(".");
    const amountCents =
      Number(wholePart) * 100 +
      Number(decimalPart.padEnd(2, "0"));

    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0
    ) {
      setStatus("error");
      setMessage("Enter a valid payment amount.");
      return;
    }

    const balanceCents = BigInt(invoice.balanceCents);

    if (BigInt(amountCents) > balanceCents) {
      setStatus("error");
      setMessage("Payment cannot exceed the outstanding balance.");
      return;
    }

    const request: PendingPayment = {
      requestKey: crypto.randomUUID(),
      amountCents,
      expectedInvoiceVersion: invoice.version,
    };

    localStorage.setItem(
      getStorageKey(invoice.id),
      JSON.stringify(request),
    );

    setPendingRequest(request);
    await submitPayment(request);
  };

  const handleRetry = async () => {
    if (!pendingRequest || status === "submitting") return;

    await verifyPayment(pendingRequest);
  };

  const handleConfirmRetry = async () => {
    if (!pendingRequest || status === "submitting") return;

    await submitPayment(pendingRequest);
  };

  const balance = BigInt(invoice.balanceCents);

  if (balance <= 0n) {
    return (
      <div className="mt-4">
        <p className="text-sm font-medium text-green-700">
          Invoice fully paid
        </p>
        {balance < 0n && (
          <p className="text-sm text-amber-700">
            Excess payment requires review.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span>Total: {formatMoney(invoice.totalCents)}</span>
        <span>Paid: {formatMoney(invoice.paidCents)}</span>
        <span className="font-semibold">
          Balance: {formatMoney(invoice.balanceCents)}
        </span>
      </div>

      {message && (
        <Alert
          variant={
            status === "error"
              ? "error"
              : status === "success"
                ? "success"
                : "info"
          }
        >
          {message}
        </Alert>
      )}

      {status === "pending" && pendingRequest && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRetry}
            className="rounded border px-3 py-2 text-sm"
          >
            Check payment status
          </button>

          <button
            type="button"
            onClick={handleConfirmRetry}
            className="rounded border px-3 py-2 text-sm"
          >
            Retry same payment
          </button>
        </div>
      )}

      {status !== "success" && !pendingRequest && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm font-medium">
            Payment amount (USD)
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={(Number(invoice.balanceCents) / 100).toFixed(2)}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={status === "submitting"}
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="Enter payment amount"
              required
            />
          </label>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {status === "submitting"
              ? "Recording payment..."
              : "Record payment"}
          </button>
        </form>
      )}
    </div>
  );
}


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
    return <LoadingState label="Loading your assigned visitsâ€¦" />;
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
            {vanDay.vanCode} Â·{" "}
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

              {visit.invoice && (
                <PaymentForm
                  invoice={visit.invoice}
                  onPaid={() => setReloadKey((key) => key + 1)}
                />
              )}

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
                              {item.product.name} â€” Available:{" "}
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
                            : "â€”"}
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
