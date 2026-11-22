import { describe, expect, it } from "vitest";
import { isMissingAuthSession } from "./session-errors";

describe("isMissingAuthSession", () => {
  it("recognizes Supabase's no-session error and unauthorized responses", () => {
    expect(isMissingAuthSession({ name: "AuthSessionMissingError", status: 400 })).toBe(
      true,
    );
    expect(isMissingAuthSession({ status: 401 })).toBe(true);
    expect(isMissingAuthSession(null)).toBe(false);
  });

  it("does not treat unrelated Auth errors as an anonymous session", () => {
    expect(isMissingAuthSession({ name: "AuthRetryableFetchError" })).toBe(false);
    expect(isMissingAuthSession({ name: "AuthApiError", status: 503 })).toBe(false);
  });
});
