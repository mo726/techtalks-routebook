import { NextResponse, type NextRequest } from "next/server";
import { hasValidOrigin, verifyCsrfToken } from "./csrf";

export const CSRF_COOKIE_NAME = "routebook-csrf";

export function validateCsrfRequest(
  request: NextRequest,
  subjectId: string | null,
): NextResponse | null {
  const expectedOrigin = process.env.APP_ORIGIN;
  const secret = process.env.CSRF_SECRET;

  if (!expectedOrigin || !secret) {
    throw new Error("APP_ORIGIN and CSRF_SECRET are required.");
  }

  if (!hasValidOrigin(request.headers.get("origin"), expectedOrigin)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_ORIGIN",
          message: "The request origin is not allowed.",
          retryable: false,
        },
      },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const isValid = verifyCsrfToken({
    token: request.headers.get("x-csrf-token"),
    cookieNonce: request.cookies.get(CSRF_COOKIE_NAME)?.value ?? null,
    subjectId,
    secret,
  });

  if (!isValid) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_CSRF_TOKEN",
          message: "The CSRF token is missing or invalid.",
          retryable: false,
        },
      },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return null;
}
