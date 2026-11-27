import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  InvalidOperationRequestError,
  OperationKeyReuseError,
  RetryableTransactionError,
  VanDayNotFoundError,
  type VanDayOperationResult,
} from "@/lib/db/van-day-transaction";
import { validateCsrfRequest } from "@/lib/security/csrf-request";

const maxRequestBytes = 64 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VanDayMutationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "VanDayMutationError";
  }
}

export function apiError(status: number, code: string) {
  return NextResponse.json(
    { error: { code } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function validateMutationRequest(
  request: NextRequest,
  actorId: string,
): NextResponse | null {
  const csrfResponse = validateCsrfRequest(request, actorId);
  if (csrfResponse) return csrfResponse;

  const requestKey = request.headers.get("idempotency-key");
  if (!requestKey) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED");
  if (!uuidPattern.test(requestKey)) return apiError(400, "INVALID_IDEMPOTENCY_KEY");
  return null;
}

export async function readJsonBody<T extends z.ZodType>(
  request: NextRequest,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return { ok: false, response: apiError(413, "REQUEST_TOO_LARGE") };
  }

  if (!request.body) {
    return { ok: false, response: apiError(400, "INVALID_JSON") };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxRequestBytes) {
      await reader.cancel();
      return { ok: false, response: apiError(413, "REQUEST_TOO_LARGE") };
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, response: apiError(400, "INVALID_JSON") };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: apiError(422, "INVALID_REQUEST") };
  }

  return { ok: true, data: parsed.data };
}

export function operationResponse(result: VanDayOperationResult) {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      "Cache-Control": "private, no-store",
      "Idempotency-Replayed": String(result.replayed),
    },
  });
}

export function operationErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof OperationKeyReuseError ||
    error instanceof VanDayNotFoundError ||
    error instanceof RetryableTransactionError
  ) {
    return apiError(error.status, error.code);
  }

  if (error instanceof VanDayMutationError) {
    return apiError(error.status, error.code);
  }

  if (isRecord(error) && error.code === "23505") {
    return apiError(
      409,
      error.constraint === "visits_day_customer_key"
        ? "VISIT_ALREADY_ASSIGNED"
        : "VAN_DAY_CONFLICT",
    );
  }

  if (error instanceof InvalidOperationRequestError) {
    return apiError(400, error.code);
  }

  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
