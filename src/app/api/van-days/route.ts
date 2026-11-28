import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createVanDayRequestSchema,
  vanDaysResponseSchema,
} from "@/lib/api/contracts/van-days";
import {
  apiError,
  operationErrorResponse,
  operationResponse,
  readJsonBody,
  VanDayMutationError,
  validateMutationRequest,
} from "@/lib/api/van-day-route";
import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";
import { runStandaloneOperation } from "@/lib/db/van-day-transaction";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();
const vanDayListRowSchema = z.object({
  id: uuidSchema,
  vanCode: z.string(),
  businessDate: z.string(),
  state: z.enum(["PREPARING", "OPEN", "CLOSED"]),
  revision: z.number().int().positive(),
  driver: z.object({ id: uuidSchema, displayName: z.string() }),
  load: z.array(
    z.object({
      productId: uuidSchema,
      productName: z.string(),
      unit: z.string(),
      quantity: z.number().int().positive(),
    }),
  ),
  visits: z.array(
    z.object({
      id: uuidSchema,
      position: z.number().int().positive(),
      customer: z.object({
        id: uuidSchema,
        name: z.string(),
        location: z.string(),
      }),
      invoice: z
        .object({ id: uuidSchema, number: z.string() })
        .nullable(),
    }),
  ),
});
const staffRowSchema = z.object({
  id: uuidSchema,
  display_name: z.string(),
});
const createdDaySchema = z.object({
  id: uuidSchema,
  van_code: z.string(),
  business_date: z.string(),
  revision: z.number().int().positive(),
  driver_id: uuidSchema,
  driver_name: z.string(),
});

export async function GET(request: NextRequest) {
  const access = await requireStaff(["DRIVER", "SUPERVISOR"]);
  if (!access.ok) return access.response;

  const params = request.nextUrl.searchParams;
  const cursorValue = params.get("cursor");
  const limitValue = params.get("limit");
  const cursor = cursorValue === null ? null : uuidSchema.safeParse(cursorValue);
  const limit = limitValue === null ? 25 : Number(limitValue);
  if (
    (cursorValue !== null && (!cursor || !cursor.success)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return apiError(400, "INVALID_QUERY");
  }

  const isSupervisor = access.profile.role === "SUPERVISOR";
  const result = await getPool().query(
    `WITH page AS (
       SELECT day.id, day.van_code, day.business_date, day.state, day.revision,
              day.driver_id
         FROM routebook.van_days AS day
        WHERE ($1::uuid IS NULL OR day.id > $1::uuid)
          AND ($2::boolean OR day.driver_id = $3::uuid)
        ORDER BY day.id
        LIMIT $4
     )
     SELECT
       page.id::text AS id,
       page.van_code AS "vanCode",
       page.business_date::text AS "businessDate",
       page.state,
       page.revision,
       jsonb_build_object(
         'id', driver.id,
         'displayName', driver.display_name
       ) AS driver,
       COALESCE(load_items.items, '[]'::jsonb) AS load,
       COALESCE(assigned_visits.items, '[]'::jsonb) AS visits
     FROM page
     JOIN routebook.staff_profiles AS driver ON driver.id = page.driver_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'productId', product.id,
           'productName', product.name,
           'unit', product.unit,
           'quantity', item.opening_qty
         ) ORDER BY product.name, product.id
       ) AS items
       FROM routebook.load_items AS item
       JOIN routebook.products AS product ON product.id = item.product_id
       WHERE item.day_id = page.id
     ) AS load_items ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'id', visit.id,
           'position', visit.position,
           'customer', jsonb_build_object(
             'id', customer.id,
             'name', customer.name,
             'location', customer.location
           ),
           'invoice', CASE
             WHEN invoice.id IS NULL THEN NULL
             ELSE jsonb_build_object(
               'id', invoice.id,
               'number', invoice.number::text
             )
           END
         ) ORDER BY visit.position, visit.id
       ) AS items
       FROM routebook.visits AS visit
       JOIN routebook.customers AS customer ON customer.id = visit.customer_id
       LEFT JOIN routebook.invoices AS invoice ON invoice.visit_id = visit.id
       WHERE visit.day_id = page.id
     ) AS assigned_visits ON true
     ORDER BY page.id`,
    [cursor?.success ? cursor.data : null, isSupervisor, access.profile.id, limit + 1],
  );

  const rows = z.array(vanDayListRowSchema).parse(result.rows);
  const hasMore = rows.length > limit;
  const vanDays = rows.slice(0, limit);
  const staffResult = isSupervisor
    ? await getPool().query(
        `SELECT id::text AS id, display_name
           FROM routebook.staff_profiles
          WHERE role = 'DRIVER' AND active = true
          ORDER BY display_name, id`,
      )
    : null;
  const staff = staffResult
    ? z.array(staffRowSchema).parse(staffResult.rows).map(({ id, display_name }) => ({
        id,
        displayName: display_name,
      }))
    : undefined;

  const response = vanDaysResponseSchema.parse({
    success: true,
    data: {
      vanDays,
      ...(staff ? { staff } : {}),
      nextCursor: hasMore ? vanDays[vanDays.length - 1]?.id ?? null : null,
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  const access = await requireStaff(["SUPERVISOR"]);
  if (!access.ok) return access.response;

  const mutationResponse = validateMutationRequest(request, access.profile.id);
  if (mutationResponse) return mutationResponse;

  const parsed = await readJsonBody(request, createVanDayRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const operation = await runStandaloneOperation({
      actorId: access.profile.id,
      requestKey: request.headers.get("idempotency-key")!,
      methodRoute: "POST /api/van-days",
      requestBody: parsed.data,
      authorize: async () => undefined,
      execute: async ({ client }) => {
        const driver = await client.query(
          `SELECT id::text AS id, display_name
             FROM routebook.staff_profiles
            WHERE id = $1 AND role = 'DRIVER' AND active = true`,
          [parsed.data.driverId],
        );
        const driverRow = staffRowSchema.safeParse(driver.rows[0]);
        if (!driverRow.success) {
          throw new VanDayMutationError(422, "DRIVER_NOT_AVAILABLE");
        }

        const inserted = await client.query(
          `INSERT INTO routebook.van_days
             (van_code, business_date, driver_id, created_by)
           VALUES ($1, $2::date, $3, $4)
           RETURNING id::text AS id, van_code, business_date::text AS business_date,
                     revision, driver_id::text AS driver_id`,
          [
            parsed.data.vanCode,
            parsed.data.businessDate,
            parsed.data.driverId,
            access.profile.id,
          ],
        );
        const created = createdDaySchema.parse({
          ...inserted.rows[0],
          driver_name: driverRow.data.display_name,
        });

        return {
          status: 201,
          body: {
            success: true,
            data: {
              vanDay: {
                id: created.id,
                vanCode: created.van_code,
                businessDate: created.business_date,
                state: "PREPARING",
                revision: created.revision,
                driver: {
                  id: created.driver_id,
                  displayName: created.driver_name,
                },
              },
            },
          },
        };
      },
    });

    return operationResponse(operation);
  } catch (error) {
    return operationErrorResponse(error);
  }
}
