import { NextRequest, type NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffForApi, apiFailure, apiSuccess, zodFailure, readJsonBody, idempotencyKeyForApi, validateCsrfForApi, transactionFailure, recheckSupervisor } from "@/lib/api/route-utils";
import { encodeCursor, parseListOptions } from "@/lib/api/pagination";
import {
  createCustomerSchema,
  customerMutationResponseSchema,
  customerSchema,
  customersListResponseSchema,
} from "@/lib/api/contracts/customer-product";
import { getPool } from "@/lib/db/pool";
import { runOperationTransaction } from "@/lib/db/operation-transaction";

export const runtime = "nodejs";

const customerRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  location: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});

const selectColumns = `id, name, location, active,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;

const driverCustomerScope = `c.active = TRUE
  AND EXISTS (
    SELECT 1
      FROM routebook.visits AS visit
      JOIN routebook.van_days AS day ON day.id = visit.day_id
     WHERE visit.customer_id = c.id
       AND day.driver_id = $1
       AND day.state = 'OPEN'
  )`;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const access = await requireStaffForApi(["DRIVER", "SUPERVISOR"]);
    if (!access.ok) return access.response;

    const options = parseListOptions(request.nextUrl.searchParams);
    const isDriver = access.profile.role === "DRIVER";

    if (options.cursor) {
      if (isDriver && !options.cursor.active) {
        return apiFailure(422, "INVALID_CURSOR", "Cursor is not valid for this customer list.");
      }
      const cursorValues: unknown[] = isDriver
        ? [access.profile.id, options.cursor.id, options.cursor.name]
        : [options.cursor.id, options.cursor.name, options.cursor.active];
      const scope = isDriver
        ? `AND ${driverCustomerScope}`
        : "";
      const idParameter = isDriver ? "$2" : "$1";
      const nameParameter = isDriver ? "$3" : "$2";
      const activeCondition = isDriver ? "AND c.active = TRUE" : `AND c.active = $3`;
      const cursorResult = await getPool().query(
        `SELECT 1
           FROM routebook.customers AS c
          WHERE c.id = ${idParameter}::uuid AND c.name = ${nameParameter} ${activeCondition} ${scope}
          LIMIT 1`,
        cursorValues,
      );
      if (cursorResult.rowCount !== 1) {
        return apiFailure(422, "INVALID_CURSOR", "Cursor is not valid for this customer list.");
      }
    }

    const values: unknown[] = [];
    const where: string[] = [];
    if (isDriver) {
      values.push(access.profile.id);
      where.push(driverCustomerScope);
    }
    if (options.cursor) {
      values.push(options.cursor.active, options.cursor.name, options.cursor.id);
      where.push(`(c.active, c.name, c.id) > ($${values.length - 2}, $${values.length - 1}, $${values.length}::uuid)`);
    }
    values.push(options.limit + 1);
    const result = await getPool().query(
      `SELECT ${selectColumns}
         FROM routebook.customers AS c
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY c.active, c.name, c.id
        LIMIT $${values.length}`,
      values,
    );

    const rows = z.array(customerRowSchema).parse(result.rows);
    const hasMore = rows.length > options.limit;
    const items = rows.slice(0, options.limit).map((row) => customerSchema.parse(row));
    const response = customersListResponseSchema.parse({
      success: true,
      data: {
        items,
        nextCursor:
          hasMore && items.length > 0
            ? encodeCursor({ active: items[items.length - 1].active, name: items[items.length - 1].name, id: items[items.length - 1].id })
            : null,
      },
    });
    return apiSuccess(response.data);
  } catch (error) {
    if (error instanceof z.ZodError) return zodFailure(error);
    return transactionFailure(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const access = await requireStaffForApi(["SUPERVISOR"]);
    if (!access.ok) return access.response;

    const csrfError = await validateCsrfForApi(request, access.profile.id);
    if (csrfError) return csrfError;

    const key = idempotencyKeyForApi(request);
    if (typeof key !== "string") return key;

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = createCustomerSchema.safeParse(body.value);
    if (!parsed.success) return zodFailure(parsed.error);

    const methodRoute = `${request.method} ${request.nextUrl.pathname}`;
    const operation = await runOperationTransaction({
      actorId: access.profile.id,
      requestKey: key,
      methodRoute,
      requestBody: parsed.data,
      authorize: ({ client }) => recheckSupervisor(client, access.profile.id),
      execute: async ({ client }) => {
        const result = await client.query(
          `INSERT INTO routebook.customers (name, location)
           VALUES ($1, $2)
           RETURNING ${selectColumns}`,
          [parsed.data.name, parsed.data.location],
        );
        const customer = customerSchema.parse(customerRowSchema.parse(result.rows[0]));
        const response = customerMutationResponseSchema.parse({
          success: true,
          data: { customer },
        });
        return { status: 201, body: response };
      },
    });

    return apiSuccess(operation.body.data, operation.status);
  } catch (error) {
    return transactionFailure(error);
  }
}
