
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import { getPool } from "@/lib/db/pool";

export const runtime = "nodejs";

const noStore = {
  "Cache-Control": "private, no-store",
};

function errorResponse(status: number, code: string) {
  return NextResponse.json(
    { error: { code } },
    { status, headers: noStore },
  );
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
  const access = await requireStaff(["DRIVER"]);

  if (!access.ok) {
    return access.response;
  }

  const { key } = await context.params;

  if (!z.string().uuid().safeParse(key).success) {
    return errorResponse(404, "OPERATION_NOT_FOUND");
  }

  try {
    const result = await getPool().query<{
      method_route: string;
      http_status: number | null;
      response_body: unknown;
      created_at: Date;
    }>(
      `SELECT method_route, http_status, response_body, created_at
         FROM routebook.operations
        WHERE actor_id = $1
          AND request_key = $2
        LIMIT 1`,
      [access.profile.id, key],
    );

    const operation = result.rows[0];

    if (!operation) {
      return errorResponse(404, "OPERATION_NOT_FOUND");
    }

    if (operation.http_status === null || operation.response_body === null) {
      return errorResponse(409, "OPERATION_NOT_FINALIZED");
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          requestKey: key,
          methodRoute: operation.method_route,
          originalStatus: operation.http_status,
          originalResponse: operation.response_body,
          createdAt: operation.created_at,
        },
      },
      {
        status: 200,
        headers: noStore,
      },
    );
  } catch {
    return errorResponse(500, "INTERNAL_ERROR");
  }
}
