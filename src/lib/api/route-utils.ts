import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodError } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import type { StaffRole } from "@/lib/auth/authorization";
import { validateCsrfRequest } from "@/lib/security/csrf-request";
import {
  InvalidOperationRequestError,
  OperationAccessError,
  OperationKeyReuseError,
  OperationResourceNotFoundError,
  RetryableTransactionError,
} from "@/lib/db/operation-transaction";
import { InvalidListQueryError } from "@/lib/api/pagination";

const privateHeaders = { "Cache-Control": "private, no-store" };

export function apiSuccess(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status, headers: privateHeaders });
}

export function apiFailure(
  status: number,
  code: string,
  message: string,
  options: { retryable?: boolean; details?: unknown; requestId?: string } = {},
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        retryable: options.retryable ?? status === 503,
        ...(options.details === undefined ? {} : { details: options.details }),
        ...(options.requestId ? { requestId: options.requestId } : {}),
      },
    },
    { status, headers: privateHeaders },
  );
}

const authMessages: Record<string, string> = {
  UNAUTHENTICATED: "Sign in to continue.",
  AUTH_SERVICE_UNAVAILABLE: "Authentication is temporarily unavailable.",
  STAFF_PROFILE_REQUIRED: "An active staff profile is required.",
  STAFF_PROFILE_INACTIVE: "This staff profile is inactive.",
  ROLE_FORBIDDEN: "You are not allowed to perform this action.",
};

export async function requireStaffForApi(roles: readonly StaffRole[]) {
  const access = await requireStaff(roles);
  if (access.ok) return { ok: true as const, profile: access.profile };

  return {
    ok: false as const,
    response: await normalizeHelperError(access.response),
  };
}

export async function normalizeHelperError(response: NextResponse) {
  let code = "REQUEST_REJECTED";
  try {
    const body: unknown = await response.clone().json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "code" in body.error &&
      typeof body.error.code === "string"
    ) {
      code = body.error.code;
    }
  } catch {
    // Replace short or invalid helper envelopes with the shared API envelope.
  }

  return apiFailure(
    response.status,
    code,
    authMessages[code] ?? "The request was rejected.",
  );
}

export async function validateCsrfForApi(request: NextRequest, actorId: string) {
  const response = validateCsrfRequest(request, actorId);
  return response ? normalizeHelperError(response) : null;
}

export function zodFailure(error: ZodError) {
  const details = error.issues.map((issue) => ({
    path: issue.path.map(String),
    code: issue.code,
    message: issue.message,
  }));
  return apiFailure(422, "VALIDATION_ERROR", "The request contains invalid fields.", {
    details,
  });
}

export async function readJsonBody(request: NextRequest) {
  const maxBytes = 16 * 1024;
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    return {
      ok: false as const,
      response: apiFailure(413, "PAYLOAD_TOO_LARGE", "The request body is too large."),
    };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return {
      ok: false as const,
      response: apiFailure(400, "INVALID_JSON", "The request body must contain valid JSON."),
    };
  }

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return {
      ok: false as const,
      response: apiFailure(413, "PAYLOAD_TOO_LARGE", "The request body is too large."),
    };
  }

  if (!text.trim()) {
    return {
      ok: false as const,
      response: apiFailure(422, "VALIDATION_ERROR", "The request body cannot be empty."),
    };
  }

  try {
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false as const,
      response: apiFailure(400, "INVALID_JSON", "The request body must contain valid JSON."),
    };
  }
}

export function idempotencyKeyForApi(request: NextRequest) {
  const value = request.headers.get("idempotency-key");
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    return apiFailure(400, "INVALID_IDEMPOTENCY_KEY", "A valid UUID Idempotency-Key is required.");
  }
  return parsed.data;
}

export function transactionFailure(error: unknown) {
  if (error instanceof InvalidListQueryError) {
    return apiFailure(422, error.code, error.message);
  }
  if (error instanceof OperationKeyReuseError) {
    return apiFailure(409, error.code, error.message);
  }
  if (error instanceof OperationAccessError) {
    return apiFailure(error.status, error.code, error.message);
  }
  if (error instanceof OperationResourceNotFoundError) {
    return apiFailure(error.status, error.code, error.message);
  }
  if (error instanceof InvalidOperationRequestError) {
    return apiFailure(error.status, error.code, error.message);
  }
  if (error instanceof RetryableTransactionError) {
    return apiFailure(error.status, error.code, error.message, { retryable: true });
  }

  const requestId = randomUUID();
  return apiFailure(500, "INTERNAL_ERROR", "The request could not be completed.", {
    requestId,
  });
}

export async function recheckSupervisor(client: import("pg").PoolClient, actorId: string) {
  const result = await client.query<{ role: string; active: boolean }>(
    `SELECT role, active
       FROM routebook.staff_profiles
      WHERE id = $1`,
    [actorId],
  );
  const profile = result.rows[0];
  if (!profile || !profile.active) {
    throw new OperationAccessError("STAFF_PROFILE_INACTIVE");
  }
  if (profile.role !== "SUPERVISOR") {
    throw new OperationAccessError("ROLE_FORBIDDEN");
  }
}
