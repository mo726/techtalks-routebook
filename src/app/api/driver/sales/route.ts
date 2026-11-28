import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  InvalidOperationRequestError,
  isOperationRequestKey,
  OperationKeyReuseError,
  RetryableTransactionError,
  VanDayNotFoundError,
  runVanDayOperation,
} from "@/lib/db/van-day-transaction";
import { validateCsrfRequest } from "@/lib/security/csrf-request";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    visitId: z.uuid(),
    productId: z.uuid(),
    quantity: z.number().int().positive().max(1_000_000),
  })
  .strict();

const privateHeaders = { "Cache-Control": "private, no-store" };

class SaleRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SaleRequestError";
  }
}

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, error: { code, message, retryable: status === 503 } },
    { status, headers: privateHeaders },
  );
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export async function POST(request: NextRequest) {
  const access = await requireStaff(["DRIVER"]);
  if (!access.ok) return access.response;

  const csrfError = validateCsrfRequest(request, access.profile.id);
  if (csrfError) return csrfError;

  const requestKey = request.headers.get("idempotency-key");
  if (!isOperationRequestKey(requestKey)) {
    return failure(400, "INVALID_IDEMPOTENCY_KEY", "A valid UUID Idempotency-Key is required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(400, "INVALID_REQUEST_BODY", "Send a valid JSON request body.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return failure(422, "INVALID_REQUEST", "Send a visit UUID, product UUID, and positive whole quantity.");
  }

  const { visitId, productId, quantity } = parsed.data;

  try {
    const result = await runVanDayOperation({
      actorId: access.profile.id,
      requestKey,
      methodRoute: "POST /api/driver/sales",
      resource: {
        id: visitId,
        async resolveVanDayId(client, id) {
          const visit = await client.query<{ day_id: string }>(
            `SELECT day_id
               FROM routebook.visits
              WHERE id = $1`,
            [id],
          );
          if (!visit.rows[0]) {
            throw new SaleRequestError(404, "VISIT_NOT_FOUND", "The visit was not found.");
          }
          return visit.rows[0].day_id;
        },
      },
      requestBody: { productId, quantity },
      authorize: async ({ client, vanDay, replayed }) => {
        const visit = await client.query(
          `SELECT 1
             FROM routebook.visits AS visit
             JOIN routebook.van_days AS day ON day.id = visit.day_id
            WHERE visit.id = $1 AND day.id = $2 AND day.driver_id = $3`,
          [visitId, vanDay.id, access.profile.id],
        );
        if (visit.rowCount !== 1) {
          throw new SaleRequestError(404, "VISIT_NOT_FOUND", "The visit was not found.");
        }

        if (!replayed && vanDay.state !== "OPEN") {
          throw new SaleRequestError(409, "VAN_DAY_NOT_OPEN", "Sales require an OPEN van day.");
        }

        if (!replayed) {
          const existingInvoice = await client.query(
            "SELECT 1 FROM routebook.invoices WHERE visit_id = $1",
            [visitId],
          );
          if (existingInvoice.rowCount !== 0) {
            throw new SaleRequestError(409, "VISIT_ALREADY_INVOICED", "This visit already has an invoice.");
          }
        }
      },
      execute: async ({ client, vanDay }) => {
        const productResult = await client.query<{
          id: string;
          price_cents: string;
          opening_quantity: string;
          sold_quantity: string;
        }>(
          `SELECT product.id,
                  product.price_cents::text AS price_cents,
                  load_item.opening_qty::text AS opening_quantity,
                  COALESCE((
                    SELECT SUM(invoice_line.quantity)
                      FROM routebook.visits AS day_visit
                      JOIN routebook.invoices AS invoice ON invoice.visit_id = day_visit.id
                      JOIN routebook.invoice_lines AS invoice_line ON invoice_line.invoice_id = invoice.id
                     WHERE day_visit.day_id = load_item.day_id
                       AND invoice_line.product_id = load_item.product_id
                  ), 0)::text AS sold_quantity
             FROM routebook.load_items AS load_item
             JOIN routebook.products AS product ON product.id = load_item.product_id
            WHERE load_item.day_id = $1
              AND product.id = $2
              AND product.active = TRUE`,
          [vanDay.id, productId],
        );
        const product = productResult.rows[0];
        if (!product) {
          throw new SaleRequestError(409, "PRODUCT_NOT_AVAILABLE", "This product is not available in van stock.");
        }

        const priceCents = Number(product.price_cents);
        const openingQuantity = Number(product.opening_quantity);
        const soldQuantity = Number(product.sold_quantity);
        if (
          !Number.isSafeInteger(priceCents) ||
          !Number.isSafeInteger(openingQuantity) ||
          !Number.isSafeInteger(soldQuantity)
        ) {
          throw new Error("The product or stock quantities are invalid.");
        }

        const availableQuantity = openingQuantity - soldQuantity;
        if (availableQuantity < 0 || quantity > availableQuantity) {
          throw new SaleRequestError(
            409,
            "INSUFFICIENT_STOCK",
            `Insufficient stock. Available quantity: ${Math.max(0, availableQuantity)}.`,
          );
        }

        const totalCents = priceCents * quantity;
        if (!Number.isSafeInteger(totalCents)) {
          throw new Error("The calculated invoice total is outside the supported range.");
        }

        const invoiceResult = await client.query<{ id: string; number: string }>(
          `INSERT INTO routebook.invoices (visit_id, created_by)
           VALUES ($1, $2)
           RETURNING id, number::text AS number`,
          [visitId, access.profile.id],
        );
        const invoice = invoiceResult.rows[0];
        if (!invoice) throw new Error("The invoice could not be created.");

        await client.query(
          `INSERT INTO routebook.invoice_lines
             (invoice_id, product_id, quantity, unit_price_cents)
           VALUES ($1, $2, $3, $4)`,
          [invoice.id, productId, quantity, product.price_cents],
        );
        await client.query(
          "UPDATE routebook.van_days SET revision = revision + 1 WHERE id = $1",
          [vanDay.id],
        );

        return {
          status: 201,
          body: {
            success: true,
            data: {
              invoice: { id: invoice.id, number: invoice.number },
              sale: { productId, quantity, unitPriceCents: priceCents, totalCents },
            },
          },
        };
      },
    });

    return NextResponse.json(result.body, { status: result.status, headers: privateHeaders });
  } catch (error) {
    if (error instanceof SaleRequestError) {
      return failure(error.status, error.code, error.message);
    }
    if (error instanceof OperationKeyReuseError) {
      return failure(error.status, error.code, error.message);
    }
    if (error instanceof RetryableTransactionError) {
      return failure(error.status, error.code, error.message);
    }
    if (error instanceof VanDayNotFoundError) {
      return failure(404, "VAN_DAY_NOT_FOUND", "The van day was not found.");
    }
    if (error instanceof InvalidOperationRequestError) {
      return failure(error.status, error.code, error.message);
    }
    if (databaseErrorCode(error) === "23505") {
      return failure(409, "VISIT_ALREADY_INVOICED", "This visit already has an invoice.");
    }

    const requestId = randomUUID();
    console.error("Driver sale request failed", { requestId });
    return failure(500, "INTERNAL_ERROR", `The sale could not be created. Reference: ${requestId}`);
  }
}
