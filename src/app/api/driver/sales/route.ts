
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireStaff } from "@/lib/auth/require-staff";
import { validateCsrfRequest } from "@/lib/security/csrf-request";
import { getPool } from "@/lib/db/pool";

import {
  runVanDayOperation,
  OperationKeyReuseError,
  VanDayNotFoundError,
  RetryableTransactionError,
  InvalidOperationRequestError,
} from "@/lib/db/van-day-transaction";

export const runtime = "nodejs";

const saleRequestSchema = z.object({
  visitId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(1_000_000),
  requestKey: z.string().uuid(),
});

class SaleRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SaleRequestError";
  }
}

function getDatabaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

export async function POST(request: NextRequest) {
  // 1. Verify that the current user is a driver.
  const access = await requireStaff(["DRIVER"]);

  if (!access.ok) {
    return access.response;
  }

  // 2. Validate CSRF protection.
  const csrfError = validateCsrfRequest(request, access.profile.id);

  if (csrfError) {
    return csrfError;
  }

  // 3. Read and validate the request body.
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid JSON request body.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = saleRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid sale request data.",
        },
      },
      { status: 400 },
    );
  }

  const { visitId, productId, quantity, requestKey } = parsed.data;

  try {
    // 4. Find the driver's currently open van day.
    const dayResult = await getPool().query(
      `SELECT id
         FROM routebook.van_days
        WHERE driver_id = $1
          AND state = 'OPEN'
        LIMIT 1`,
      [access.profile.id],
    );

    if (dayResult.rows.length === 0) {
      throw new SaleRequestError(
        "No open van day was found for this driver.",
        404,
        "VAN_DAY_NOT_FOUND",
      );
    }

    const vanDayId = dayResult.rows[0].id as string;

    // 5. Execute the sale as an idempotent van-day operation.
    const result = await runVanDayOperation({
      actorId: access.profile.id,
      vanDayId,
      requestKey,
      methodRoute: "POST /api/driver/sales",

      requestBody: {
        visitId,
        productId,
        quantity,
      },

      // 6. Verify the driver, van day, and visit.
      authorize: async ({ client, vanDay, replayed }) => {
        if (vanDay.state !== "OPEN") {
          throw new SaleRequestError(
            "The van day is not open.",
            409,
            "VAN_DAY_NOT_OPEN",
          );
        }

        const dayAccess = await client.query(
          `SELECT id
             FROM routebook.van_days
            WHERE id = $1
              AND driver_id = $2
              AND state = 'OPEN'`,
          [vanDay.id, access.profile.id],
        );

        if (dayAccess.rows.length === 0) {
          throw new SaleRequestError(
            "This van day does not belong to the current driver.",
            403,
            "VAN_DAY_ACCESS_DENIED",
          );
        }

        const visitResult = await client.query(
          `SELECT id
             FROM routebook.visits
            WHERE id = $1
              AND day_id = $2`,
          [visitId, vanDay.id],
        );

        if (visitResult.rows.length === 0) {
          throw new SaleRequestError(
            "The visit was not found in this van day.",
            404,
            "VISIT_NOT_FOUND",
          );
        }

        // A replay is allowed to return its original successful result.
        // The invoice already exists when an operation is replayed.
        if (!replayed) {
          const invoiceResult = await client.query(
            `SELECT id
               FROM routebook.invoices
              WHERE visit_id = $1`,
            [visitId],
          );

          if (invoiceResult.rows.length > 0) {
            throw new SaleRequestError(
              "This visit already has an invoice.",
              409,
              "VISIT_ALREADY_INVOICED",
            );
          }
        }
      },

      // 7. Check stock, calculate the price, and create the invoice.
      execute: async ({ client, vanDay }) => {
        const productResult = await client.query(
          `SELECT
             product.id,
             product.price_cents::text AS price_cents,
             load_item.opening_qty::text AS opening_quantity,
             (
               SELECT COALESCE(SUM(invoice_line.quantity), 0)::text
                 FROM routebook.visits AS day_visit
                 JOIN routebook.invoices AS invoice
                   ON invoice.visit_id = day_visit.id
                 JOIN routebook.invoice_lines AS invoice_line
                   ON invoice_line.invoice_id = invoice.id
                WHERE day_visit.day_id = load_item.day_id
                  AND invoice_line.product_id = load_item.product_id
             ) AS sold_quantity
           FROM routebook.load_items AS load_item
           JOIN routebook.products AS product
             ON product.id = load_item.product_id
          WHERE load_item.day_id = $1
            AND product.id = $2
            AND product.active = TRUE`,
          [vanDay.id, productId],
        );

        if (productResult.rows.length === 0) {
          throw new SaleRequestError(
            "This product is not available in the van stock.",
            409,
            "PRODUCT_NOT_AVAILABLE",
          );
        }

        const product = productResult.rows[0];

        const priceCents = Number(product.price_cents);
        const openingQuantity = Number(product.opening_quantity);
        const soldQuantity = Number(product.sold_quantity);

        if (
          !Number.isSafeInteger(priceCents) ||
          !Number.isSafeInteger(openingQuantity) ||
          !Number.isSafeInteger(soldQuantity)
        ) {
          throw new Error("Invalid numeric values returned by the database.");
        }

        const availableQuantity = Math.max(
          0,
          openingQuantity - soldQuantity,
        );

        if (quantity > availableQuantity) {
          throw new SaleRequestError(
            `Insufficient stock. Available quantity: ${availableQuantity}.`,
            409,
            "INSUFFICIENT_STOCK",
          );
        }

        // The server calculates the total using the database price.
        const totalCents = priceCents * quantity;

        // 8. Create the invoice.
        const invoiceResult = await client.query(
          `INSERT INTO routebook.invoices
             (visit_id, created_by)
           VALUES ($1, $2)
           RETURNING id, number::text AS number`,
          [visitId, access.profile.id],
        );

        const invoice = invoiceResult.rows[0];

        // 9. Add the product line to the invoice.
        await client.query(
          `INSERT INTO routebook.invoice_lines
             (invoice_id, product_id, quantity, unit_price_cents)
           VALUES ($1, $2, $3, $4)`,
          [
            invoice.id,
            productId,
            quantity,
            priceCents,
          ],
        );

        // 10. Return the successful sale result.
        return {
          status: 201,
          body: {
            success: true,
            data: {
              invoice: {
                id: invoice.id,
                number: invoice.number,
              },
              sale: {
                productId,
                quantity,
                unitPriceCents: priceCents,
                totalCents,
              },
            },
          },
        };
      },
    });

    return NextResponse.json(result.body, {
      status: result.status,
    });
  } catch (error) {
    if (error instanceof SaleRequestError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    if (error instanceof OperationKeyReuseError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    if (error instanceof VanDayNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    if (error instanceof InvalidOperationRequestError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    if (error instanceof RetryableTransactionError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VISIT_ALREADY_INVOICED",
            message: "This visit already has an invoice.",
          },
        },
        { status: 409 },
      );
    }

    console.error("Driver sale API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred while creating the sale.",
        },
      },
      { status: 500 },
    );
  }
}
