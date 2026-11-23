import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import { driverStockResponseSchema } from "@/lib/api/contracts/driver-stock";

export const runtime = "nodejs";

const quantitySchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().safe().nonnegative());

const stockRowSchema = z.object({
  day_id: z.string().uuid(),
  van_code: z.string(),
  business_date: z.string(),
  day_state: z.literal("OPEN"),
  day_revision: z.number().int().positive(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string().nullable(),
  product_unit: z.string().nullable(),
  opening_quantity: quantitySchema.nullable(),
  available_quantity: quantitySchema.nullable(),
});

export async function GET() {
  const access = await requireStaff(["DRIVER"]);
  if (!access.ok) {
    return access.response;
  }

  const result = await getPool().query(
    `WITH driver_day AS (
       SELECT id, van_code, business_date, state, revision
         FROM routebook.van_days
        WHERE driver_id = $1 AND state = 'OPEN'
        LIMIT 1
     )
     SELECT
       day.id AS day_id,
       day.van_code,
       day.business_date::text AS business_date,
       day.state AS day_state,
       day.revision AS day_revision,
       product.id AS product_id,
       product.name AS product_name,
       product.unit AS product_unit,
       load_item.opening_qty AS opening_quantity,
       load_item.opening_qty::bigint
         - COALESCE(SUM(invoice_line.quantity), 0)::bigint
         AS available_quantity
     FROM driver_day AS day
     LEFT JOIN routebook.load_items AS load_item ON load_item.day_id = day.id
     LEFT JOIN routebook.products AS product ON product.id = load_item.product_id
     LEFT JOIN routebook.visits AS visit ON visit.day_id = day.id
     LEFT JOIN routebook.invoices AS invoice ON invoice.visit_id = visit.id
     LEFT JOIN routebook.invoice_lines AS invoice_line
       ON invoice_line.invoice_id = invoice.id
      AND invoice_line.product_id = load_item.product_id
     GROUP BY
       day.id, day.van_code, day.business_date, day.state, day.revision,
       product.id, product.name, product.unit, load_item.opening_qty
     ORDER BY product.name NULLS LAST, product.id`,
    [access.profile.id],
  );

  const rows = z.array(stockRowSchema).parse(result.rows);
  const first = rows[0];
  const stock = rows.flatMap((row) => {
    if (
      !row.product_id ||
      row.product_name === null ||
      row.product_unit === null ||
      row.opening_quantity === null ||
      row.available_quantity === null
    ) {
      return [];
    }

    return [
      {
        product: {
          id: row.product_id,
          name: row.product_name,
          unit: row.product_unit,
        },
        openingQuantity: row.opening_quantity,
        availableQuantity: row.available_quantity,
      },
    ];
  });

  const response = driverStockResponseSchema.parse({
    success: true,
    data: {
      vanDay: first
        ? {
            id: first.day_id,
            vanCode: first.van_code,
            businessDate: first.business_date,
            state: first.day_state,
            revision: first.day_revision,
          }
        : null,
      stock,
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
