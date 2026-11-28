import { NextRequest, type NextResponse } from "next/server";
import { z } from "zod";
import { encodeCursor, parseListOptions } from "@/lib/api/pagination";
import { createProductSchema, productMutationResponseSchema, productSchema, productsListResponseSchema } from "@/lib/api/contracts/customer-product";
import { apiFailure, apiSuccess, idempotencyKeyForApi, readJsonBody, requireStaffForApi, recheckSupervisor, transactionFailure, validateCsrfForApi, zodFailure } from "@/lib/api/route-utils";
import { getPool } from "@/lib/db/pool";
import { runOperationTransaction } from "@/lib/db/operation-transaction";

export const runtime = "nodejs";

const productRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  priceCents: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});

const selectColumns = `id, name, unit, price_cents AS "priceCents", active,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const access = await requireStaffForApi(["DRIVER", "SUPERVISOR"]);
    if (!access.ok) return access.response;

    const options = parseListOptions(request.nextUrl.searchParams);
    const isDriver = access.profile.role === "DRIVER";

    if (options.cursor) {
      if (isDriver && !options.cursor.active) {
        return apiFailure(422, "INVALID_CURSOR", "Cursor is not valid for this product list.");
      }
      const cursorValues: unknown[] = isDriver
        ? [options.cursor.id, options.cursor.name]
        : [options.cursor.id, options.cursor.name, options.cursor.active];
      const scope = isDriver ? "AND active = TRUE" : "";
      const cursorResult = await getPool().query(
        `SELECT 1 FROM routebook.products
          WHERE id = $1::uuid AND name = $2
            ${isDriver ? "AND active = TRUE" : "AND active = $3"} ${scope}
          LIMIT 1`,
        cursorValues,
      );
      if (cursorResult.rowCount !== 1) {
        return apiFailure(422, "INVALID_CURSOR", "Cursor is not valid for this product list.");
      }
    }

    const values: unknown[] = [];
    const where: string[] = [];
    if (isDriver) where.push("active = TRUE");
    if (options.cursor) {
      values.push(options.cursor.active, options.cursor.name, options.cursor.id);
      where.push(`(active, name, id) > ($${values.length - 2}, $${values.length - 1}, $${values.length}::uuid)`);
    }
    values.push(options.limit + 1);
    const result = await getPool().query(
      `SELECT ${selectColumns}
         FROM routebook.products
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY active, name, id
        LIMIT $${values.length}`,
      values,
    );

    const rows = z.array(productRowSchema).parse(result.rows);
    const hasMore = rows.length > options.limit;
    const items = rows.slice(0, options.limit).map((row) => productSchema.parse(row));
    const response = productsListResponseSchema.parse({
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
    const parsed = createProductSchema.safeParse(body.value);
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
          `INSERT INTO routebook.products (name, unit, price_cents)
           VALUES ($1, $2, $3)
           RETURNING ${selectColumns}`,
          [parsed.data.name, parsed.data.unit, parsed.data.priceCents],
        );
        const product = productSchema.parse(productRowSchema.parse(result.rows[0]));
        const response = productMutationResponseSchema.parse({
          success: true,
          data: { product },
        });
        return { status: 201, body: response };
      },
    });

    return apiSuccess(operation.body.data, operation.status);
  } catch (error) {
    return transactionFailure(error);
  }
}
