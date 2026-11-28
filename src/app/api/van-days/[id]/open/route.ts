import { type NextRequest } from "next/server";
import { z } from "zod";
import { openVanDayRequestSchema } from "@/lib/api/contracts/van-days";
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

export async function POST(request: NextRequest, { params }: RouteContext) {
  const access = await requireStaff(["SUPERVISOR"]);
  if (!access.ok) return access.response;

  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return apiError(400, "INVALID_VAN_DAY_ID");

  const mutationResponse = validateMutationRequest(request, access.profile.id);
  if (mutationResponse) return mutationResponse;

  const parsed = await readJsonBody(request, openVanDayRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const operation = await runVanDayOperation({
      actorId: access.profile.id,
      vanDayId: parsedId.data,
      requestKey: request.headers.get("idempotency-key")!,
      methodRoute: "POST /api/van-days/:id/open",
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
        const driver = await client.query(
          `SELECT 1
             FROM routebook.van_days AS day
             JOIN routebook.staff_profiles AS driver ON driver.id = day.driver_id
            WHERE day.id = $1
              AND driver.role = 'DRIVER'
              AND driver.active = true
              AND EXISTS (
                SELECT 1
                  FROM routebook.load_items
                 WHERE day_id = day.id
              )`,
          [vanDay.id],
        );
        if (driver.rowCount !== 1) {
          throw new VanDayMutationError(409, "DAY_REQUIRES_ACTIVE_DRIVER_AND_LOAD");
        }

        const updated = await client.query<{ revision: number }>(
          `UPDATE routebook.van_days
              SET state = 'OPEN', revision = revision + 1
            WHERE id = $1
            RETURNING revision`,
          [vanDay.id],
        );
        const revision = updated.rows[0]?.revision;
        if (!revision) throw new Error("The opened van-day revision is missing.");

        return {
          status: 200,
          body: {
            success: true,
            data: { id: vanDay.id, state: "OPEN", revision },
          },
        };
      },
    });

    return operationResponse(operation);
  } catch (error) {
    return operationErrorResponse(error);
  }
}
