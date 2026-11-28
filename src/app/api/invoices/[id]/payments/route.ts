import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import {
  runVanDayOperation,
  OperationKeyReuseError,
  RetryableTransactionError,
  VanDayNotFoundError,
} from "@/lib/db/van-day-transaction";
import { validateCsrfRequest } from "@/lib/security/csrf-request";

export const runtime = "nodejs";

const requestSchema = z.object({
  amountCents: z.number().int().positive().safe(),
  expectedInvoiceVersion: z.number().int().positive(),
});

const METHOD_ROUTE = "POST /api/invoices/{id}/payments";

function errorResponse(status: number, code: string) {
  return NextResponse.json(
    { error: { code } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStaff(["DRIVER"]);
  if (!access.ok) return access.response;

  const csrfError = validateCsrfRequest(request, access.profile.id);
  if (csrfError) return csrfError;

  const { id: invoiceId } = await context.params;

  if (!z.string().uuid().safeParse(invoiceId).success) {
    return errorResponse(404, "INVOICE_NOT_FOUND");
  }

  const requestKey = request.headers.get("Idempotency-Key");

  if (!requestKey || !z.string().uuid().safeParse(requestKey).success) {
    return errorResponse(422, "INVALID_IDEMPOTENCY_KEY");
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse(422, "INVALID_REQUEST");
  }

  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return errorResponse(422, "INVALID_REQUEST");
  }

  const { amountCents, expectedInvoiceVersion } = parsed.data;
  const pool = getPool();

  try {
    const lookup = await pool.query<{ day_id: string }>(
      `SELECT visit.day_id
         FROM routebook.invoices AS invoice
         JOIN routebook.visits AS visit
           ON visit.id = invoice.visit_id
        WHERE invoice.id = $1
        LIMIT 1`,
      [invoiceId],
    );

    const vanDayId = lookup.rows[0]?.day_id;

    if (!vanDayId) {
      return errorResponse(404, "INVOICE_NOT_FOUND");
    }

    const result = await runVanDayOperation({
      actorId: access.profile.id,
      vanDayId,
      requestKey,
      methodRoute: METHOD_ROUTE,
      requestBody: {
        invoiceId,
        amountCents,
        expectedInvoiceVersion,
      },
      pool,

      authorize: async ({ client, vanDay, replayed }) => {
        const ownership = await client.query(
          `SELECT 1
             FROM routebook.van_days
            WHERE id = $1
              AND driver_id = $2`,
          [vanDay.id, access.profile.id],
        );

        if (ownership.rowCount !== 1) {
          throw new Error("FORBIDDEN");
        }

        if (!replayed && vanDay.state !== "OPEN") {
          throw new Error("DAY_NOT_OPEN");
        }
      },

      execute: async ({ client, vanDay }) => {
        const invoiceResult = await client.query<{
          version: number;
          total_cents: string;
          paid_cents: string;
        }>(
          `SELECT
             invoice.version,
             COALESCE(lines.total_cents, 0)::text AS total_cents,
             COALESCE(payments.paid_cents, 0)::text AS paid_cents
           FROM routebook.invoices AS invoice
           JOIN routebook.visits AS visit
             ON visit.id = invoice.visit_id
           LEFT JOIN LATERAL (
             SELECT SUM(quantity::numeric * unit_price_cents) AS total_cents
               FROM routebook.invoice_lines
              WHERE invoice_id = invoice.id
           ) AS lines ON true
           LEFT JOIN LATERAL (
             SELECT SUM(amount_cents) AS paid_cents
               FROM routebook.payments
              WHERE invoice_id = invoice.id
           ) AS payments ON true
           WHERE invoice.id = $1
             AND visit.day_id = $2
           FOR UPDATE OF invoice`,
          [invoiceId, vanDay.id],
        );

        const invoice = invoiceResult.rows[0];

        if (!invoice) {
          throw new Error("INVOICE_NOT_FOUND");
        }

        if (invoice.version !== expectedInvoiceVersion) {
          throw new Error("STALE_VERSION");
        }

        const totalCents = BigInt(invoice.total_cents);
        const paidCents = BigInt(invoice.paid_cents);
        const paymentCents = BigInt(amountCents);

        if (totalCents <= 0n) {
          throw new Error("INVALID_INVOICE");
        }

        const balanceCents = totalCents - paidCents;

        if (paymentCents > balanceCents) {
          throw new Error("PAYMENT_EXCEEDS_BALANCE");
        }

        const totalPaidCents = paidCents + paymentCents;
        const newBalanceCents = totalCents - totalPaidCents;

        const paymentId = randomUUID();

        await client.query(
          `INSERT INTO routebook.payments
             (id, invoice_id, amount_cents, received_by)
           VALUES ($1, $2, $3, $4)`,
          [paymentId, invoiceId, amountCents, access.profile.id],
        );

        const updatedInvoice = await client.query<{ version: number }>(
          `UPDATE routebook.invoices
              SET version = version + 1
            WHERE id = $1 AND version = $2
          RETURNING version`,
          [invoiceId, expectedInvoiceVersion],
        );

        if (!updatedInvoice.rows[0]) {
          throw new Error("STALE_VERSION");
        }

        await client.query(
          `UPDATE routebook.van_days
              SET revision = revision + 1
            WHERE id = $1 AND state = 'OPEN'`,
          [vanDay.id],
        );

        return {
          status: 201,
          body: {
            success: true,
            data: {
              paymentId,
              amountCents,
              invoiceVersion: updatedInvoice.rows[0].version,
              totalPaidCents: totalPaidCents.toString(),
              balanceCents: newBalanceCents.toString(),
            },
          },
        };
      },
    });

    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof OperationKeyReuseError) {
      return errorResponse(409, "KEY_REUSED");
    }

    if (error instanceof RetryableTransactionError) {
      return errorResponse(503, "TRANSACTION_RETRYABLE");
    }

    if (error instanceof VanDayNotFoundError) {
      return errorResponse(404, "VAN_DAY_NOT_FOUND");
    }

    const code = error instanceof Error ? error.message : "";

    const knownErrors: Record<string, [number, string]> = {
      FORBIDDEN: [403, "FORBIDDEN"],
      DAY_NOT_OPEN: [409, "DAY_NOT_OPEN"],
      INVOICE_NOT_FOUND: [404, "INVOICE_NOT_FOUND"],
      INVALID_INVOICE: [409, "INVALID_INVOICE"],
      STALE_VERSION: [409, "STALE_VERSION"],
      PAYMENT_EXCEEDS_BALANCE: [409, "PAYMENT_EXCEEDS_BALANCE"],
    };

    const mapped = knownErrors[code];

    if (mapped) {
      return errorResponse(mapped[0], mapped[1]);
    }

    return errorResponse(500, "INTERNAL_ERROR");
  }
}