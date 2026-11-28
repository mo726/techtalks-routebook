import { z } from "zod";
import { isPostgresTextWithinLimit } from "@/lib/api/contracts/customer-product";

// A 160-character PostgreSQL name can expand to six ASCII characters per
// escaped control character in JSON. 2048 also leaves room for JSON and
// base64url overhead, so every cursor from a valid row fits.
const MAX_CURSOR_LENGTH = 2048;

export type ListCursor = { active: boolean; name: string; id: string };
export type ListOptions = { limit: number; cursor: ListCursor | null };

const querySchema = z
  .object({
    limit: z.string().regex(/^\d{1,3}$/).refine((value) => value === value.trim()).optional(),
    cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
  })
  .strict();

const cursorSchema = z
  .object({
    name: z.string().min(1).refine((name) => isPostgresTextWithinLimit(name, 160)),
    id: z.string().uuid(),
  })
  .extend({ active: z.boolean() })
  .strict();

export class InvalidListQueryError extends Error {
  readonly code = "INVALID_QUERY";
  constructor(message = "The cursor or limit query parameter is invalid.") {
    super(message);
    this.name = "InvalidListQueryError";
  }
}

export function parseListOptions(searchParams: URLSearchParams): ListOptions {
  const allowedKeys = new Set(["limit", "cursor"]);
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key) || searchParams.getAll(key).length !== 1) {
      throw new InvalidListQueryError();
    }
  }

  const query = querySchema.safeParse({
    ...(searchParams.has("limit") ? { limit: searchParams.get("limit") } : {}),
    ...(searchParams.has("cursor") ? { cursor: searchParams.get("cursor") } : {}),
  });
  if (!query.success) throw new InvalidListQueryError();

  const limit = query.data.limit === undefined ? 25 : Number(query.data.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidListQueryError("Limit must be between 1 and 100.");
  }

  return {
    limit,
    cursor: query.data.cursor ? decodeCursor(query.data.cursor) : null,
  };
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): ListCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor encoding.");
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) {
      throw new Error("Invalid cursor encoding.");
    }
    const parsedJson: unknown = JSON.parse(decoded);
    const parsed = cursorSchema.safeParse(parsedJson);
    if (!parsed.success) throw new Error("Invalid cursor data.");
    return parsed.data;
  } catch {
    throw new InvalidListQueryError("Cursor is invalid.");
  }
}
