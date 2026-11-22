import { describe, expect, it } from "vitest";
import {
  createCsrfToken,
  hasValidOrigin,
  verifyCsrfToken,
} from "./csrf";

const secret = "a".repeat(64);
const nonce = "ab".repeat(32);

describe("CSRF token", () => {
  it("accepts a token bound to the current session and cookie nonce", () => {
    const token = createCsrfToken("staff-123", nonce, secret);

    expect(
      verifyCsrfToken({
        token,
        cookieNonce: nonce,
        subjectId: "staff-123",
        secret,
      }),
    ).toBe(true);
  });

  it("rejects a token copied from another authenticated session", () => {
    const token = createCsrfToken("staff-123", nonce, secret);

    expect(
      verifyCsrfToken({
        token,
        cookieNonce: nonce,
        subjectId: "staff-456",
        secret,
      }),
    ).toBe(false);
  });

  it("rejects a missing or mismatched double-submit nonce", () => {
    const token = createCsrfToken(null, nonce, secret);

    expect(
      verifyCsrfToken({
        token,
        cookieNonce: "cd".repeat(32),
        subjectId: null,
        secret,
      }),
    ).toBe(false);
    expect(
      verifyCsrfToken({
        token,
        cookieNonce: null,
        subjectId: null,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects malformed or tampered tokens", () => {
    expect(
      verifyCsrfToken({
        token: "malformed",
        cookieNonce: nonce,
        subjectId: null,
        secret,
      }),
    ).toBe(false);
    expect(
      verifyCsrfToken({
        token: `${createCsrfToken(null, nonce, secret)}x`,
        cookieNonce: nonce,
        subjectId: null,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects a token with an invalid signing key", () => {
    expect(() => createCsrfToken(null, nonce, "short")).toThrow(
      "CSRF_SECRET must contain at least 32 bytes.",
    );
  });
});

describe("same-origin validation", () => {
  it("accepts only the configured origin", () => {
    expect(hasValidOrigin("https://routebook.example", "https://routebook.example")).toBe(
      true,
    );
    expect(hasValidOrigin("https://attacker.example", "https://routebook.example")).toBe(
      false,
    );
    expect(hasValidOrigin(null, "https://routebook.example")).toBe(false);
    expect(
      hasValidOrigin(
        "https://routebook.example.evil",
        "https://routebook.example",
      ),
    ).toBe(false);
  });
});
