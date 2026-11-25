import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { idempotencyKeyForApi, readJsonBody } from "./route-utils";

describe("API request parsing", () => {
  it("rejects empty and malformed JSON bodies", async () => {
    const empty = await readJsonBody(new NextRequest("http://localhost/api/customers", { method: "POST", body: "" }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.response.status).toBe(422);

    const malformed = await readJsonBody(new NextRequest("http://localhost/api/customers", { method: "POST", body: "{" }));
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.response.status).toBe(400);
  });

  it("rejects request bodies over the bounded payload size", async () => {
    const body = JSON.stringify({ name: "x".repeat(17_000) });
    const parsed = await readJsonBody(new NextRequest("http://localhost/api/customers", { method: "POST", body }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(413);
  });

  it("requires a UUID idempotency key and rejects missing, empty or oversized values", () => {
    const valid = new NextRequest("http://localhost/api/customers", {
      headers: { "idempotency-key": "11111111-1111-4111-8111-111111111111" },
    });
    expect(idempotencyKeyForApi(valid)).toBe("11111111-1111-4111-8111-111111111111");

    for (const value of [undefined, "", "x".repeat(300)]) {
      const request = new NextRequest("http://localhost/api/customers", {
        headers: value === undefined ? {} : { "idempotency-key": value },
      });
      const result = idempotencyKeyForApi(request);
      expect(typeof result).not.toBe("string");
      if (typeof result !== "string") expect(result.status).toBe(400);
    }
  });
});
