import "server-only";
import { z } from "zod";
import type { Pool } from "pg";
import { getPool } from "./pool";

const quantitySchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().safe().nonnegative());

const priceSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().safe().positive());

const stockRowSchema = z.object({
  day_id: z.string().uuid(),
  van_code: z.string(),
  business_date: z.string(),
  day_state: z.enum(["PREPARING", "OPEN", "CLOSED"]),
  day_revision: z.number().int().positive(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string().nullable(),
  product_unit: z.string().nullable(),
  product_price_cents: priceSchema.nullable(),
  opening_quantity: quantitySchema.nullable(),
  available_quantity: quantitySchema.nullable(),
});

export type VanDayStockData = {
  vanDay: {
    id: string;
    vanCode: string;
    businessDate: string;
    state: "PREPARING" | "OPEN" | "CLOSED";
    revision: number;
  };
  stock: Array<{
    product: { id: string; name: string; unit: string; unitPriceCents: number };
    openingQuantity: number;
    availableQuantity: number;
  }>;
};

type GetVanDayStockOptions = {
  vanDayId: string | null;
  staffId: string;
  canViewAll: boolean;
  pool?: Pick<Pool, "query">;
};

export async function getVanDayStock({
  vanDayId,
  staffId,
  canViewAll,
  pool,
}: GetVanDayStockOptions): Promise<VanDayStockData | null> {
  const result = await (pool ?? getPool()).query(
    `WITH selected_day AS (
       SELECT id, van_code, business_date, state, revision
         FROM routebook.van_days
        WHERE (
          $1::uuid IS NULL
          AND driver_id = $3::uuid
          AND state = 'OPEN'
        ) OR (
          $1::uuid IS NOT NULL
          AND id = $1::uuid
          AND ($2::boolean OR driver_id = $3::uuid)
        )
     )
     SELECT
       day.id::text AS day_id,
       day.van_code,
       day.business_date::text AS business_date,
       day.state AS day_state,
       day.revision AS day_revision,
       product.id::text AS product_id,
       product.name AS product_name,
       product.unit AS product_unit,
       product.price_cents AS product_price_cents,
       load_item.opening_qty AS opening_quantity,
       load_item.opening_qty::bigint
         - COALESCE(sales.sold_quantity, 0)::bigint AS available_quantity
     FROM selected_day AS day
     LEFT JOIN routebook.load_items AS load_item ON load_item.day_id = day.id
     LEFT JOIN routebook.products AS product ON product.id = load_item.product_id
     LEFT JOIN LATERAL (
       SELECT SUM(invoice_line.quantity)::bigint AS sold_quantity
         FROM routebook.visits AS visit
         JOIN routebook.invoices AS invoice ON invoice.visit_id = visit.id
         JOIN routebook.invoice_lines AS invoice_line
           ON invoice_line.invoice_id = invoice.id
        WHERE visit.day_id = day.id
          AND invoice_line.product_id = load_item.product_id
     ) AS sales ON true
     ORDER BY product.name NULLS LAST, product.id`,
    [vanDayId, canViewAll, staffId],
  );

  const rows = z.array(stockRowSchema).parse(result.rows);
  const first = rows[0];
  if (!first) return null;

  return {
    vanDay: {
      id: first.day_id,
      vanCode: first.van_code,
      businessDate: first.business_date,
      state: first.day_state,
      revision: first.day_revision,
    },
    stock: rows.flatMap((row) => {
      if (
        !row.product_id ||
        row.product_name === null ||
        row.product_unit === null ||
        row.product_price_cents === null ||
        row.opening_quantity === null ||
        row.available_quantity === null
      ) {
        return [];
      }

      return [{
        product: {
          id: row.product_id,
          name: row.product_name,
          unit: row.product_unit,
          unitPriceCents: row.product_price_cents,
        },
        openingQuantity: row.opening_quantity,
        availableQuantity: row.available_quantity,
      }];
    }),
  };
}
