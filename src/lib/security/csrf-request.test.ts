import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createCsrfToken } from "./csrf";
import {
  CSRF_COOKIE_NAME,
  validateCsrfRequest,
} from "./csrf-request";

const secret = "a".repeat(64);
const nonce = "ab".repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest({
  origin = "https://routebook.example",
  token = createCsrfToken(null, nonce, secret),
}: {
  origin?: string;
  token?: string;
} = {}) {
  return new NextRequest("https://routebook.example/api/auth/sign-in", {
    method: "POST",
    headers: {
      origin,
      "x-csrf-token": token,
      cookie: `${CSRF_COOKIE_NAME}=${nonce}`,
    },
  });
}

describe("validateCsrfRequest", () => {
  it("accepts a valid session-bound same-origin request", () => {
    vi.stubEnv("APP_ORIGIN", "https://routebook.example");
    vi.stubEnv("CSRF_SECRET", secret);

    expect(validateCsrfRequest(makeRequest(), null)).toBeNull();
  });

  it("rejects cross-origin requests", () => {
    vi.stubEnv("APP_ORIGIN", "https://routebook.example");
    vi.stubEnv("CSRF_SECRET", secret);

    const response = validateCsrfRequest(
      makeRequest({ origin: "https://attacker.example" }),
      null,
    );

    expect(response?.status).toBe(403);
  });

  it("rejects a missing token and a missing CSRF cookie", () => {
    vi.stubEnv("APP_ORIGIN", "https://routebook.example");
    vi.stubEnv("CSRF_SECRET", secret);

    const missingToken = validateCsrfRequest(makeRequest({ token: "" }), null);
    const noCookie = new NextRequest("https://routebook.example/api/customers", {
      method: "POST",
      headers: { origin: "https://routebook.example", "x-csrf-token": createCsrfToken(null, nonce, secret) },
    });

    expect(missingToken?.status).toBe(403);
    expect(validateCsrfRequest(noCookie, null)?.status).toBe(403);
  });

  it("rejects tokens bound to a different authenticated identity", () => {
    vi.stubEnv("APP_ORIGIN", "https://routebook.example");
    vi.stubEnv("CSRF_SECRET", secret);

    const response = validateCsrfRequest(makeRequest(), "staff-123");

    expect(response?.status).toBe(403);
  });
});
