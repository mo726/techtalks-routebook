"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  ApiClientError,
  getDriverVisits,
  getOperationReceipt,
  recordPayment,
} from "@/lib/api/client";

import type {
  DriverVisit,
  DriverVisitsResponse,
} from "@/lib/api/contracts/driver-visits";

import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";

type LoadState =
  | { status: "loading" }
  | { status: "success"; data: DriverVisitsResponse }
  | { status: "error"; message: string };

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
      error.status === 502 ||
      error.status === 503)
  );
}

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
    [finishPayment],
  );

  useEffect(() => {
    if (!initialRequest) return;

    let cancelled = false;

    void getOperationReceipt(initialRequest.requestKey).then(
      (receipt) => {
        if (cancelled) return;

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
  }, [initialRequest, finishPayment]);

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

export function DriverVisitsClient() {
  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

 const reloadVisits = useCallback(async () => {
  try {
    const data = await getDriverVisits();
    setState({ status: "success", data });
  } catch (error) {
    setState({
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to load visits.",
    });
  }
}, []);

useEffect(() => {
  let cancelled = false;

  getDriverVisits().then(
    (data) => {
      if (!cancelled) {
        setState({ status: "success", data });
      }
    },
    (error: unknown) => {
      if (!cancelled) {
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load visits.",
        });
      }
    },
  );

  return () => {
    cancelled = true;
  };
}, []);

 if (state.status === "loading") {
  return <LoadingState label="Loading driver visits..." />;
}

if (state.status === "error") {
  return (
    <ErrorState
      title="Unable to load visits"
      message={state.message}
    />
  );
}

const { visits } = state.data.data;

if (visits.length === 0) {
  return (
    <EmptyState
      title="No assigned visits"
      description="There are currently no visits assigned to you."
    />
  );
}

  return (
    <div className="space-y-4">
      {visits.map((visit) => (
        <div
          key={visit.id}
          className="rounded-lg border p-4"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h2 className="font-semibold">
                {visit.position}. {visit.customer.name}
              </h2>
              <p className="text-sm text-gray-500">
                {visit.customer.location}
              </p>
            </div>
            <span className="text-sm text-gray-500">
              Visit #{visit.position}
            </span>
          </div>

          {visit.invoice ? (
            <div className="mt-3 border-t pt-3">
              <p className="text-sm">
                Invoice #{visit.invoice.number}
              </p>

              <PaymentForm
                invoice={visit.invoice}
                onPaid={reloadVisits}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              No invoice available for this visit.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
