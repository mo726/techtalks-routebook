import { type NextRequest } from "next/server";
import { z } from "zod";
import { replaceVanDayLoadRequestSchema } from "@/lib/api/contracts/van-days";
import {
  apiError,
  operationErrorResponse,
  operationResponse,
  readJsonBody,
  VanDayMutationError,
  validateMutationRequest,
} from "@/lib/api/van-day-route";
import { requireStaff } from "@/lib/auth/require-staff";
import { runVanDayOperation } from "@/lib/db/van-day-transaction";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const uuidSchema = z.string().uuid();

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const access = await requireStaff(["SUPERVISOR"]);
  if (!access.ok) return access.response;

  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return apiError(400, "INVALID_VAN_DAY_ID");

  const mutationResponse = validateMutationRequest(request, access.profile.id);
  if (mutationResponse) return mutationResponse;

  const parsed = await readJsonBody(request, replaceVanDayLoadRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const operation = await runVanDayOperation({
      actorId: access.profile.id,
      vanDayId: parsedId.data,
      requestKey: request.headers.get("idempotency-key")!,
      methodRoute: "PUT /api/van-days/:id/load",
      requestBody: parsed.data,
      authorize: async ({ vanDay, replayed }) => {
        if (replayed) return;
        if (vanDay.state !== "PREPARING") {
          throw new VanDayMutationError(409, "DAY_NOT_PREPARING");
        }
        if (vanDay.revision !== parsed.data.expectedRevision) {
          throw new VanDayMutationError(409, "STALE_REVISION");
        }
      },
      execute: async ({ client, vanDay }) => {
        const productIds = parsed.data.items.map((item) => item.productId);
        if (productIds.length > 0) {
          const products = await client.query<{ id: string }>(
            `SELECT id::text AS id
               FROM routebook.products
              WHERE active = true AND id = ANY($1::uuid[])`,
            [productIds],
          );
          if (products.rows.length !== productIds.length) {
            throw new VanDayMutationError(422, "PRODUCT_NOT_AVAILABLE");
          }
        }

        await client.query(
          "DELETE FROM routebook.load_items WHERE day_id = $1",
          [vanDay.id],
        );
        for (const item of parsed.data.items) {
          await client.query(
            `INSERT INTO routebook.load_items (day_id, product_id, opening_qty)
             VALUES ($1, $2, $3)`,
            [vanDay.id, item.productId, item.quantity],
          );
        }
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
          status: 200,
          body: {
            success: true,
            data: {
              vanDayId: vanDay.id,
              revision,
              load: parsed.data.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
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
