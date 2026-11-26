import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  InvalidOperationRequestError,
  isOperationRequestKey,
  OperationKeyReuseError,
  RetryableTransactionError,
  VanDayNotFoundError,
} from "@/lib/db/van-day-transaction";
import { recordPaymentInputSchema } from "@/lib/money";
import { isPaymentError } from "@/lib/payments/payment";
import { recordInvoicePayment } from "@/lib/payments/postgres-payment";
import { validateCsrfRequest } from "@/lib/security/csrf-request";

export const runtime = "nodejs";

const invoiceIdSchema = z.uuid();
const headers = { "Cache-Control": "private, no-store" };

function paymentError(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, error: { code, message, retryable: status === 503 } },
    { status, headers },
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireStaff(["DRIVER"]);
    if (!access.ok) {
      return access.response;
    }

    const csrfResponse = validateCsrfRequest(request, access.profile.id);
    if (csrfResponse) {
      return csrfResponse;
    }

    const invoiceId = invoiceIdSchema.safeParse((await params).id);
    if (!invoiceId.success) {
      return paymentError(422, "INVALID_REQUEST", "Invoice ID must be a valid UUID.");
    }

    const idempotencyKey = request.headers.get("idempotency-key");
    if (!isOperationRequestKey(idempotencyKey)) {
      return paymentError(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be a valid UUID.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return paymentError(400, "INVALID_REQUEST_BODY", "Send a valid JSON request body.");
    }

    const payment = recordPaymentInputSchema.safeParse(body);
    if (!payment.success) {
      const [issue] = payment.error.issues;
      if (issue.path[0] === "amountCents") {
        return paymentError(422, "INVALID_AMOUNT", "Send a positive whole number of cents as a decimal string.");
      }
      if (issue.path[0] === "expectedInvoiceVersion") {
        return paymentError(422, "INVALID_VERSION", "Expected invoice version must be a positive integer.");
      }
      return paymentError(422, "INVALID_REQUEST", "Send only amountCents and expectedInvoiceVersion.");
    }

    const result = await recordInvoicePayment(access.profile.id, {
      ...payment.data,
      invoiceId: invoiceId.data.toLowerCase(),
      idempotencyKey,
    });
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    if (isPaymentError(error) && error.httpStatus !== 500) {
      return paymentError(error.httpStatus, error.code, error.message);
    }
    if (error instanceof OperationKeyReuseError || error instanceof RetryableTransactionError) {
      return paymentError(error.status, error.code, error.message);
    }
    if (error instanceof VanDayNotFoundError) {
      return paymentError(404, "NOT_FOUND", "Invoice was not found.");
    }
    if (error instanceof InvalidOperationRequestError) {
      return paymentError(error.status, error.code, error.message);
    }

    const requestId = randomUUID();
    console.error("Payment request failed", { requestId });
    return NextResponse.json(
      {
        success: false,
        error: { code: "INTERNAL_ERROR", message: "The payment could not be recorded.", retryable: false, requestId },
      },
      { status: 500, headers },
    );
  }
}
