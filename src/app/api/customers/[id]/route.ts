import { NextRequest, type NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, idempotencyKeyForApi, readJsonBody, requireStaffForApi, recheckSupervisor, transactionFailure, validateCsrfForApi, zodFailure } from "@/lib/api/route-utils";
import { customerMutationResponseSchema, customerSchema, patchCustomerSchema } from "@/lib/api/contracts/customer-product";
import { OperationResourceNotFoundError, runOperationTransaction } from "@/lib/db/operation-transaction";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const rowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  location: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});
const returningColumns = `id, name, location, active,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const access = await requireStaffForApi(["SUPERVISOR"]);
    if (!access.ok) return access.response;

    const csrfError = await validateCsrfForApi(request, access.profile.id);
    if (csrfError) return csrfError;

    const key = idempotencyKeyForApi(request);
    if (typeof key !== "string") return key;

    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return zodFailure(params.error);

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = patchCustomerSchema.safeParse(body.value);
    if (!parsed.success) return zodFailure(parsed.error);

    const customerId = params.data.id;
    const methodRoute = `${request.method} ${request.nextUrl.pathname}`;
    const operation = await runOperationTransaction({
      actorId: access.profile.id,
      requestKey: key,
      methodRoute,
      resourceId: customerId,
      requestBody: parsed.data,
      authorize: ({ client }) => recheckSupervisor(client, access.profile.id),
      execute: async ({ client }) => {
        const values: unknown[] = [customerId];
        const assignments: string[] = [];
        if (parsed.data.name !== undefined) {
          values.push(parsed.data.name);
          assignments.push(`name = $${values.length}`);
        }
        if (parsed.data.location !== undefined) {
          values.push(parsed.data.location);
          assignments.push(`location = $${values.length}`);
        }
        if (parsed.data.active !== undefined) {
          values.push(parsed.data.active);
          assignments.push(`active = $${values.length}`);
        }

        const result = await client.query(
          `UPDATE routebook.customers
              SET ${assignments.join(", ")}
            WHERE id = $1
            RETURNING ${returningColumns}`,
          values,
        );
        if (!result.rows[0]) throw new OperationResourceNotFoundError();

        const customer = customerSchema.parse(rowSchema.parse(result.rows[0]));
        const response = customerMutationResponseSchema.parse({
          success: true,
          data: { customer },
        });
        return { status: 200, body: response };
      },
    });

    return apiSuccess(operation.body.data, operation.status);
  } catch (error) {
    return transactionFailure(error);
  }
}
