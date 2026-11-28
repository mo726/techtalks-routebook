// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  InvalidOperationRequestError,
  OperationKeyReuseError,
  RetryableTransactionError,
} from "@/lib/db/van-day-transaction";
import { PaymentError } from "@/lib/payments/payment";
import { recordInvoicePayment } from "@/lib/payments/postgres-payment";
import { createCsrfToken } from "@/lib/security/csrf";
import { CSRF_COOKIE_NAME } from "@/lib/security/csrf-request";
import { POST } from "./route";

vi.mock("@/lib/auth/require-staff");
vi.mock("@/lib/payments/postgres-payment");

const origin = "https://routebook.test";
const csrfSecret = "a".repeat(64);
const csrfNonce = "b".repeat(64);
const actorId = "11111111-1111-4111-8111-111111111111";
const invoiceId = "22222222-2222-4222-8222-222222222222";
const requestKey = "33333333-3333-4333-8333-333333333333";
const paymentBody = { amountCents: "1000", expectedInvoiceVersion: 1 };
const paymentData = {
  paymentId: "44444444-4444-4444-8444-444444444444",
  amountCents: "1000",
  invoiceVersion: 2,
  totalPaidCents: "1000",
  balanceCents: "1000",
};

function postPayment({ body = paymentBody, rawBody, key = requestKey, csrf = true, id = invoiceId }: {
  body?: unknown;
  rawBody?: string;
  key?: string | null;
  csrf?: boolean;
  id?: string;
} = {}) {
  const headers = new Headers({
    origin,
    "content-type": "application/json",
    cookie: `${CSRF_COOKIE_NAME}=${csrfNonce}`,
  });
  if (key !== null) {
    headers.set("idempotency-key", key);
  }
  if (csrf) {
    headers.set("x-csrf-token", createCsrfToken(actorId, csrfNonce, csrfSecret));
  }
  const request = new NextRequest(`${origin}/api/invoices/${id}/payments`, {
    method: "POST",
    headers,
    body: rawBody ?? JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

describe("POST /api/invoices/{id}/payments", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("APP_ORIGIN", origin);
    vi.stubEnv("CSRF_SECRET", csrfSecret);
    vi.mocked(requireStaff).mockResolvedValue({
      ok: true,
      profile: { id: actorId, displayName: "Driver A", role: "DRIVER", active: true },
    });
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.unstubAllEnvs();
  });

  it("submits exact cents and the session actor, then returns the stored receipt", async () => {
    const body = { success: true as const, data: paymentData };
    vi.mocked(recordInvoicePayment).mockResolvedValue({ status: 201, body, replayed: true });

    const response = await postPayment();

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(body);
    expect(requireStaff).toHaveBeenCalledWith(["DRIVER"]);
    expect(recordInvoicePayment).toHaveBeenCalledWith(actorId, {
      invoiceId,
      idempotencyKey: requestKey,
      amountCents: 1000n,
      expectedInvoiceVersion: 1,
    });
  });

  it("rejects a request without a staff session", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Sign in to continue.",
            retryable: false,
          },
        },
        { status: 401 },
      ),
    });

    const response = await postPayment();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
        retryable: false,
      },
    });
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it("requires a session-bound CSRF token", async () => {
    const response = await postPayment({ csrf: false });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "INVALID_CSRF_TOKEN",
        message: "The CSRF token is missing or invalid.",
        retryable: false,
      },
    });
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it.each([
    [{ key: null }, "INVALID_IDEMPOTENCY_KEY"],
    [{ id: "invalid" }, "INVALID_REQUEST"],
    [{ body: { ...paymentBody, amountCents: 1000 } }, "INVALID_AMOUNT"],
    [{ body: { ...paymentBody, expectedInvoiceVersion: 0 } }, "INVALID_VERSION"],
    [{ body: { ...paymentBody, actorId } }, "INVALID_REQUEST"],
  ] as const)("rejects invalid input before writing (%j)", async (options, code) => {
    const response = await postPayment(options);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code, retryable: false } });
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before writing", async () => {
    const response = await postPayment({ rawBody: "{not json" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "INVALID_REQUEST_BODY",
        message: "Send a valid JSON request body.",
        retryable: false,
      },
    });
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it.each([
    [new PaymentError("STALE_VERSION", "Refresh the invoice."), 409, "STALE_VERSION"],
    [new PaymentError("NOT_FOUND", "Invoice was not found."), 404, "NOT_FOUND"],
    [new OperationKeyReuseError(), 409, "KEY_REUSED"],
    [new RetryableTransactionError(), 503, "TRANSACTION_RETRYABLE"],
    [new InvalidOperationRequestError(), 400, "INVALID_OPERATION_REQUEST"],
  ] as const)("maps %s to the documented response", async (error, status, code) => {
    vi.mocked(recordInvoicePayment).mockRejectedValue(error);

    const response = await postPayment();

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code, retryable: status === 503 },
    });
  });

  it.each([
    new PaymentError("INVALID_INVOICE_DATA", "Stored invoice amounts are invalid."),
    new Error("unexpected failure"),
  ])("hides internal failure %s behind a generic 500", async (error) => {
    vi.mocked(recordInvoicePayment).mockRejectedValue(error);

    const response = await postPayment();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The payment could not be recorded.",
        retryable: false,
        requestId: expect.any(String),
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Payment request failed",
      { requestId: expect.any(String) },
    );
  });
});
