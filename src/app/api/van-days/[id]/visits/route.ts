import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  assignVanDayVisitRequestSchema,
  vanDayVisitsResponseSchema,
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
import { runVanDayOperation } from "@/lib/db/van-day-transaction";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const uuidSchema = z.string().uuid();
const dayRowSchema = z.object({
  id: uuidSchema,
  state: z.enum(["PREPARING", "OPEN", "CLOSED"]),
  revision: z.number().int().positive(),
  visit_id: uuidSchema.nullable(),
  position: z.number().int().positive().nullable(),
  customer_id: uuidSchema.nullable(),
  customer_name: z.string().nullable(),
  customer_location: z.string().nullable(),
  invoice_id: uuidSchema.nullable(),
  invoice_number: z.string().nullable(),
});

export async function GET(request: NextRequest, { params }: RouteContext) {
  const access = await requireStaff(["DRIVER", "SUPERVISOR"]);
  if (!access.ok) return access.response;

  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return apiError(400, "INVALID_VAN_DAY_ID");

  const isSupervisor = access.profile.role === "SUPERVISOR";
  const result = await getPool().query(
    `SELECT
       day.id::text AS id,
       day.state,
       day.revision,
       visit.id::text AS visit_id,
       visit.position,
       customer.id::text AS customer_id,
       customer.name AS customer_name,
       customer.location AS customer_location,
       invoice.id::text AS invoice_id,
       invoice.number::text AS invoice_number
     FROM routebook.van_days AS day
     LEFT JOIN routebook.visits AS visit ON visit.day_id = day.id
     LEFT JOIN routebook.customers AS customer ON customer.id = visit.customer_id
     LEFT JOIN routebook.invoices AS invoice ON invoice.visit_id = visit.id
     WHERE day.id = $1
       AND (
         $2::boolean
         OR day.driver_id = $3
       )
     ORDER BY visit.position NULLS LAST, visit.id`,
    [parsedId.data, isSupervisor, access.profile.id],
  );
  const rows = z.array(dayRowSchema).parse(result.rows);
  if (rows.length === 0) return apiError(404, "VAN_DAY_NOT_FOUND");
  const first = rows[0];
  const visits = rows.flatMap((row) => {
    if (
      !row.visit_id ||
      row.position === null ||
      !row.customer_id ||
      row.customer_name === null ||
      row.customer_location === null
    ) {
      return [];
    }

    return [{
      id: row.visit_id,
      position: row.position,
      customer: {
        id: row.customer_id,
        name: row.customer_name,
        location: row.customer_location,
      },
      invoice:
        row.invoice_id && row.invoice_number
          ? { id: row.invoice_id, number: row.invoice_number }
          : null,
    }];
  });
  const response = vanDayVisitsResponseSchema.parse({
    success: true,
    data: {
      vanDay: { id: first.id, state: first.state, revision: first.revision },
      visits,
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const access = await requireStaff(["SUPERVISOR"]);
  if (!access.ok) return access.response;

  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return apiError(400, "INVALID_VAN_DAY_ID");

  const mutationResponse = validateMutationRequest(request, access.profile.id);
  if (mutationResponse) return mutationResponse;

  const parsed = await readJsonBody(request, assignVanDayVisitRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const operation = await runVanDayOperation({
      actorId: access.profile.id,
      vanDayId: parsedId.data,
      requestKey: request.headers.get("idempotency-key")!,
      methodRoute: "POST /api/van-days/:id/visits",
      requestBody: parsed.data,
      authorize: async ({ vanDay, replayed }) => {
        if (!replayed && vanDay.state !== "PREPARING") {
          throw new VanDayMutationError(409, "DAY_NOT_PREPARING");
        }
      },
      execute: async ({ client, vanDay }) => {
        const customer = await client.query(
          `SELECT id::text AS id, name, location
             FROM routebook.customers
            WHERE id = $1 AND active = true`,
          [parsed.data.customerId],
        );
        const customerRow = customer.rows[0];
        if (!customerRow) {
          throw new VanDayMutationError(422, "CUSTOMER_NOT_AVAILABLE");
        }

        const positionResult = await client.query<{ position: number }>(
          `SELECT COALESCE(MAX(position), 0)::integer + 1 AS position
             FROM routebook.visits
            WHERE day_id = $1`,
          [vanDay.id],
        );
        const position = positionResult.rows[0]?.position;
        if (!position || position < 1) {
          throw new Error("The next visit position could not be calculated.");
        }

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO routebook.visits (day_id, customer_id, position)
           VALUES ($1, $2, $3)
           RETURNING id::text AS id`,
          [vanDay.id, parsed.data.customerId, position],
        );
        const visitId = inserted.rows[0]?.id;
        if (!visitId) throw new Error("The assigned visit could not be read.");

        const updated = await client.query<{ revision: number }>(
          `UPDATE routebook.van_days
              SET revision = revision + 1
            WHERE id = $1
            RETURNING revision`,
          [vanDay.id],
        );
        const revision = updated.rows[0]?.revision;
        if (!revision) throw new Error("The updated van-day revision is missing.");

        return {
          status: 201,
          body: {
            success: true,
            data: {
              visit: {
                id: visitId,
                position,
                customer: {
                  id: parsed.data.customerId,
                  name: customerRow.name,
                  location: customerRow.location,
                },
              },
              vanDayRevision: revision,
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
