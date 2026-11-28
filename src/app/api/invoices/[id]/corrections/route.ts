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
import {
  correctInvoiceQuantity,
  InvoiceCorrectionError,
} from "@/lib/invoices/postgres-correction";
import { correctInvoiceInputSchema } from "@/lib/money";
import { validateCsrfRequest } from "@/lib/security/csrf-request";

export const runtime = "nodejs";

const invoiceIdSchema = z.uuid();
const headers = { "Cache-Control": "private, no-store" };

function correctionError(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, error: { code, message, retryable: status === 503 } },
    { status, headers },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireStaff(["SUPERVISOR"]);
    if (!access.ok) {
      return access.response;
    }

    const csrfResponse = validateCsrfRequest(request, access.profile.id);
    if (csrfResponse) {
      return csrfResponse;
    }

    const invoiceId = invoiceIdSchema.safeParse((await params).id);
    if (!invoiceId.success) {
      return correctionError(422, "INVALID_REQUEST", "Invoice ID must be a valid UUID.");
    }

    const idempotencyKey = request.headers.get("idempotency-key");
    if (!isOperationRequestKey(idempotencyKey)) {
      return correctionError(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be a valid UUID.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return correctionError(400, "INVALID_REQUEST_BODY", "Send a valid JSON request body.");
    }

    const correction = correctInvoiceInputSchema.safeParse(body);
    if (!correction.success) {
      return correctionError(
        422,
        "INVALID_REQUEST",
        "Send a line UUID, a whole quantity from 1 to 1,000,000, a positive invoice version, and a reason of 5 to 500 characters.",
      );
    }

    const result = await correctInvoiceQuantity(access.profile.id, {
      ...correction.data,
      lineId: correction.data.lineId.toLowerCase(),
      invoiceId: invoiceId.data.toLowerCase(),
      idempotencyKey,
    });
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    if (
      error instanceof InvoiceCorrectionError ||
      error instanceof InvalidOperationRequestError ||
      error instanceof OperationKeyReuseError ||
      error instanceof RetryableTransactionError
    ) {
      return correctionError(error.status, error.code, error.message);
    }
    if (error instanceof VanDayNotFoundError) {
      return correctionError(404, "NOT_FOUND", "The invoice or invoice line was not found.");
    }

    const requestId = randomUUID();
    console.error("Invoice correction failed", { requestId });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "The invoice correction could not be recorded.",
          retryable: false,
          requestId,
        },
      },
      { status: 500, headers },
    );
  }
}
