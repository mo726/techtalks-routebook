import { describe, expect, it } from "vitest";
import { encodeCursor, parseListOptions } from "./pagination";

const customerCursor = {
  active: true,
  name: "Cedar Market",
  id: "11111111-1111-4111-8111-111111111111",
};

describe("cursor pagination", () => {
  it("uses the default limit, accepts a bounded custom limit and round-trips a typed cursor", () => {
    expect(parseListOptions(new URLSearchParams())).toEqual({ limit: 25, cursor: null });
    expect(parseListOptions(new URLSearchParams("limit=100"))).toEqual({ limit: 100, cursor: null });
    const query = new URLSearchParams({ cursor: encodeCursor(customerCursor), limit: "7" });
    expect(parseListOptions(query)).toEqual({ limit: 7, cursor: customerCursor });
  });

  it("rejects invalid limits, unknown parameters, duplicate parameters and malformed cursors", () => {
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=1%0A",
      "extra=1",
      "limit=1&limit=2",
      "cursor=not-base64!",
      `cursor=${Buffer.from(JSON.stringify({ name: "No UUID", id: "no" })).toString("base64url")}`,
    ]) {
      expect(() => parseListOptions(new URLSearchParams(query))).toThrow();
    }
  });

  it("accepts generated cursors for maximum-length names with escaped and Unicode characters", () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const names = [
      "\u0001".repeat(160), // JSON expands each valid database control character to six ASCII characters.
      '\\"\n\t'.repeat(40), // Backslashes, quotes and short escapes are JSON-escaped.
      `${"مرحبا😀".repeat(26)}عربي`, // Exactly 160 PostgreSQL characters, despite more UTF-16 code units.
    ];

    names.forEach((name, index) => {
      const cursor = encodeCursor({ active: true, name, id: ids[index] });
      expect(cursor.length).toBeLessThanOrEqual(2048);
      expect(parseListOptions(new URLSearchParams({ cursor }))).toEqual({
        limit: 25,
        cursor: { active: true, name, id: ids[index] },
      });
    });
  });

  it("rejects names beyond PostgreSQL character limits and NUL-containing cursor records", () => {
    const overlong = encodeCursor({ active: true, name: "😀".repeat(161), id: customerCursor.id });
    const withNul = encodeCursor({ active: true, name: "Shop\0Name", id: customerCursor.id });
    expect(() => parseListOptions(new URLSearchParams({ cursor: overlong }))).toThrow();
    expect(() => parseListOptions(new URLSearchParams({ cursor: withNul }))).toThrow();
  });
});
