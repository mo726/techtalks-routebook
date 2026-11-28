// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  OperationKeyReuseError,
  RetryableTransactionError,
} from "@/lib/db/van-day-transaction";
import {
  correctInvoiceQuantity,
  InvoiceCorrectionError,
} from "@/lib/invoices/postgres-correction";
import { createCsrfToken } from "@/lib/security/csrf";
import { CSRF_COOKIE_NAME } from "@/lib/security/csrf-request";
import { POST } from "./route";

vi.mock("@/lib/auth/require-staff");
vi.mock("@/lib/invoices/postgres-correction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invoices/postgres-correction")>()),
  correctInvoiceQuantity: vi.fn(),
}));

const origin = "https://routebook.test";
const secret = "a".repeat(64);
const nonce = "b".repeat(64);
const supervisorId = "11111111-1111-4111-8111-111111111111";
const invoiceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const lineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestKey = "22222222-2222-4222-8222-222222222222";
const input = {
  lineId,
  newQuantity: 15,
  expectedInvoiceVersion: 2,
  reason: "Only 15 bottles were delivered",
};

function postCorrection(
  { id = invoiceId, key = requestKey, csrf = true, body = JSON.stringify(input) }: {
    id?: string;
    key?: string | null;
    csrf?: boolean;
    body?: string;
  } = {},
) {
  const headers = new Headers({
    origin,
    "content-type": "application/json",
    cookie: `${CSRF_COOKIE_NAME}=${nonce}`,
  });
  if (key !== null) {
    headers.set("idempotency-key", key);
  }
  if (csrf) {
    headers.set("x-csrf-token", createCsrfToken(supervisorId, nonce, secret));
  }
  return POST(
    new NextRequest(`${origin}/api/invoices/${id}/corrections`, { method: "POST", headers, body }),
    { params: Promise.resolve({ id }) },
  );
}

describe("POST /api/invoices/{id}/corrections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APP_ORIGIN", origin);
    vi.stubEnv("CSRF_SECRET", secret);
    vi.mocked(requireStaff).mockResolvedValue({
      ok: true,
      profile: { id: supervisorId, displayName: "Supervisor", role: "SUPERVISOR", active: true },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the supervisor's identity and returns the correction receipt with the signed balance", async () => {
    const body = {
      success: true as const,
      data: {
        correctionId: "33333333-3333-4333-8333-333333333333",
        invoiceVersion: 3,
        invoiceTotalCents: "1500",
        invoiceBalanceCents: "-500",
        availableQuantity: 85,
        totalPaidCents: "2000",
        outstandingCents: "0",
        excessPaymentCents: "500",
        reviewRequired: true,
      },
    };
    vi.mocked(correctInvoiceQuantity).mockResolvedValue({ status: 200, body, replayed: true });

    const response = await postCorrection({
      id: invoiceId.toUpperCase(),
      body: JSON.stringify({ ...input, lineId: lineId.toUpperCase(), reason: ` ${input.reason} ` }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(body);
    expect(requireStaff).toHaveBeenCalledWith(["SUPERVISOR"]);
    expect(correctInvoiceQuantity).toHaveBeenCalledWith(supervisorId, {
      ...input,
      invoiceId,
      idempotencyKey: requestKey,
    });
  });

  it("denies a driver before calling the correction service", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "ROLE_FORBIDDEN" } }, { status: 403 }),
    });

    expect((await postCorrection()).status).toBe(403);
    expect(requireStaff).toHaveBeenCalledWith(["SUPERVISOR"]);
    expect(correctInvoiceQuantity).not.toHaveBeenCalled();
  });

  it.each([
    [{ csrf: false }, 403, "INVALID_CSRF_TOKEN"],
    [{ key: null }, 422, "INVALID_IDEMPOTENCY_KEY"],
    [{ id: "invalid" }, 422, "INVALID_REQUEST"],
    [{ body: "{" }, 400, "INVALID_REQUEST_BODY"],
    [{ body: JSON.stringify({ ...input, newQuantity: 0 }) }, 422, "INVALID_REQUEST"],
    [{ body: JSON.stringify({ ...input, expectedInvoiceVersion: 0 }) }, 422, "INVALID_REQUEST"],
    [{ body: JSON.stringify({ ...input, actorId: supervisorId }) }, 422, "INVALID_REQUEST"],
  ] as const)("rejects invalid requests before writing (%j)", async (options, status, code) => {
    const response = await postCorrection(options);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code } });
    expect(correctInvoiceQuantity).not.toHaveBeenCalled();
  });

  it.each([
    [new InvoiceCorrectionError("NOT_FOUND"), 404, "NOT_FOUND"],
    [new InvoiceCorrectionError("NO_CHANGE"), 422, "NO_CHANGE"],
    [new InvoiceCorrectionError("INSUFFICIENT_STOCK"), 409, "INSUFFICIENT_STOCK"],
    [new InvoiceCorrectionError("STALE_VERSION"), 409, "STALE_VERSION"],
    [new InvoiceCorrectionError("DAY_CLOSED"), 409, "DAY_CLOSED"],
    [new OperationKeyReuseError(), 409, "KEY_REUSED"],
    [new RetryableTransactionError(), 503, "TRANSACTION_RETRYABLE"],
  ] as const)("returns the documented error for %s", async (error, status, code) => {
    vi.mocked(correctInvoiceQuantity).mockRejectedValue(error);

    const response = await postCorrection();
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code, retryable: status === 503 },
    });
  });

  it("returns a support ID for an unexpected failure without exposing database details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(correctInvoiceQuantity).mockRejectedValue(new Error("private database details"));

    const response = await postCorrection();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The invoice correction could not be recorded.",
        retryable: false,
        requestId: expect.any(String),
      },
    });
  });
});
