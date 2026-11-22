import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import { driverVisitsResponseSchema } from "@/lib/api/contracts/driver-visits";

export const runtime = "nodejs";

const visitRowSchema = z.object({
  day_id: z.string().uuid(),
  van_code: z.string(),
  business_date: z.string(),
  day_state: z.literal("OPEN"),
  day_revision: z.number().int().positive(),
  visit_id: z.string().uuid().nullable(),
  visit_position: z.number().int().positive().nullable(),
  customer_id: z.string().uuid().nullable(),
  customer_name: z.string().nullable(),
  customer_location: z.string().nullable(),
  invoice_id: z.string().uuid().nullable(),
  invoice_number: z.string().nullable(),
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
       visit.id AS visit_id,
       visit.position AS visit_position,
       customer.id AS customer_id,
       customer.name AS customer_name,
       customer.location AS customer_location,
       invoice.id AS invoice_id,
       invoice.number::text AS invoice_number
     FROM driver_day AS day
     LEFT JOIN routebook.visits AS visit ON visit.day_id = day.id
     LEFT JOIN routebook.customers AS customer ON customer.id = visit.customer_id
     LEFT JOIN routebook.invoices AS invoice ON invoice.visit_id = visit.id
     ORDER BY visit.position NULLS LAST, visit.id`,
    [access.profile.id],
  );

  const rows = z.array(visitRowSchema).parse(result.rows);
  const first = rows[0];
  const visits = rows.flatMap((row) => {
    if (
      !row.visit_id ||
      row.visit_position === null ||
      !row.customer_id ||
      row.customer_name === null ||
      row.customer_location === null
    ) {
      return [];
    }

    return [
      {
        id: row.visit_id,
        position: row.visit_position,
        customer: {
          id: row.customer_id,
          name: row.customer_name,
          location: row.customer_location,
        },
        invoice:
          row.invoice_id && row.invoice_number
            ? { id: row.invoice_id, number: row.invoice_number }
            : null,
      },
    ];
  });

  const response = driverVisitsResponseSchema.parse({
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
      visits,
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
