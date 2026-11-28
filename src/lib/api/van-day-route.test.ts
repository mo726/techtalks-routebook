import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { readJsonBody, operationErrorResponse } from "./van-day-route";

const requestSchema = z.object({ name: z.string() }).strict();

function makeRequest(body: string, headers?: HeadersInit) {
  return new NextRequest("http://localhost:3000/api/van-days", {
    method: "POST",
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
    body,
  });
}

describe("van-day API request helpers", () => {
  it("parses bounded JSON and applies strict Zod validation", async () => {
    const result = await readJsonBody(
      makeRequest(JSON.stringify({ name: "VAN-01" })),
      requestSchema,
    );

    expect(result).toEqual({ ok: true, data: { name: "VAN-01" } });
  });

  it("rejects malformed JSON and unknown request fields", async () => {
    const malformed = await readJsonBody(makeRequest("{"), requestSchema);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.response.status).toBe(400);

    const unknownField = await readJsonBody(
      makeRequest(JSON.stringify({ name: "VAN-01", actorId: "forged" })),
      requestSchema,
    );
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) expect(unknownField.response.status).toBe(422);
  });

  it("rejects oversized payloads based on declared size", async () => {
    const response = await readJsonBody(
      makeRequest("{}", { "content-length": String(65 * 1024) }),
      requestSchema,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.response.status).toBe(413);
  });

  it("maps duplicate visit assignment constraints to a conflict response", async () => {
    const response = operationErrorResponse({
      code: "23505",
      constraint: "visits_day_customer_key",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VISIT_ALREADY_ASSIGNED" },
    });
  });
});
