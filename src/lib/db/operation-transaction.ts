import "server-only";
import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { getPool } from "./pool";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OperationSuccessBody = {
  success: true;
  [key: string]: JsonValue;
};

export type TransactionOutcome = {
  status: number;
  body: OperationSuccessBody;
};

export type OperationResult = TransactionOutcome & { replayed: boolean };

type OperationRow = QueryResultRow & {
  method_route: string;
  request_hash: string;
  http_status: number | null;
  response_body: unknown;
};

export class OperationKeyReuseError extends Error {
  readonly status = 409;
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key was already used for a different request.");
    this.name = "OperationKeyReuseError";
  }
}

export class OperationAccessError extends Error {
  readonly status: 403;
  readonly code: "STAFF_PROFILE_INACTIVE" | "ROLE_FORBIDDEN";

  constructor(code: "STAFF_PROFILE_INACTIVE" | "ROLE_FORBIDDEN") {
    super("The current staff profile is not allowed to perform this operation.");
    this.name = "OperationAccessError";
    this.status = 403;
    this.code = code;
  }
}

export class OperationResourceNotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOT_FOUND";

  constructor() {
    super("The requested resource was not found.");
    this.name = "OperationResourceNotFoundError";
  }
}

export class InvalidOperationRequestError extends Error {
  readonly status = 400;
  readonly code = "INVALID_IDEMPOTENCY_KEY";

  constructor() {
    super("A valid UUID Idempotency-Key is required.");
    this.name = "InvalidOperationRequestError";
  }
}

export class RetryableTransactionError extends Error {
  readonly status = 503;
  readonly code = "TEMPORARY_DATABASE_FAILURE";
  readonly retryable = true;

  constructor(cause?: unknown) {
    super("The operation could not complete because of temporary database contention.", {
      cause,
    });
    this.name = "RetryableTransactionError";
  }
}

type OperationContext = { client: PoolClient };

type RunOperationOptions = {
  actorId: string;
  requestKey: string;
  methodRoute: string;
  resourceId?: string;
  requestBody: unknown;
  authorize: (context: OperationContext & { replayed: boolean }) => Promise<void>;
  execute: (context: OperationContext) => Promise<TransactionOutcome>;
  pool?: Pick<Pool, "connect">;
};

const maxAttempts = 3;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const transientSqlStates = new Set([
  "40001",
  "40P01",
  "55P03",
  "57014",
]);

function isTransientDatabaseError(code: string | undefined) {
  return code?.startsWith("08") === true || (code !== undefined && transientSqlStates.has(code));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJson(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Invalid JSON request body.");
    seen.add(value);
    const result = value.map((entry) => normalizeJson(entry, seen));
    seen.delete(value);
    return result;
  }

  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (
      seen.has(value) ||
      (prototype !== Object.prototype && prototype !== null)
    ) {
      throw new TypeError("Invalid JSON request body.");
    }

    seen.add(value);
    const result: { [key: string]: JsonValue } = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) throw new TypeError("Invalid JSON request body.");
      result[key] = normalizeJson(entry, seen);
    }
    seen.delete(value);
    return result;
  }

  throw new TypeError("Invalid JSON request body.");
}

function requestHash(
  methodRoute: string,
  resourceId: string | undefined,
  requestBody: unknown,
): string {
  if (
    !methodRoute.trim() ||
    methodRoute.length > 240 ||
    methodRoute !== methodRoute.trim()
  ) {
    throw new TypeError("Invalid operation identity.");
  }

  const identity = JSON.stringify({
    methodRoute,
    resourceId: resourceId ?? null,
    body: normalizeJson(requestBody),
  });
  return createHash("sha256").update(identity).digest("hex");
}

function parseSuccessBody(value: unknown): OperationSuccessBody | null {
  if (!isRecord(value) || value.success !== true) return null;
  try {
    const normalized = normalizeJson(value);
    if (
      isRecord(normalized) &&
      normalized.success === true &&
      Buffer.byteLength(JSON.stringify(normalized), "utf8") <= 65536
    ) {
      return normalized as OperationSuccessBody;
    }
  } catch {
    return null;
  }
  return null;
}

function sqlState(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function retryDelay(attempt: number) {
  const delay = 20 * attempt + Math.floor(Math.random() * 31);
  return new Promise<void>((resolve) => setTimeout(resolve, delay));
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK");
}

export async function runOperationTransaction({
  actorId,
  requestKey,
  methodRoute,
  resourceId,
  requestBody,
  authorize,
  execute,
  pool,
}: RunOperationOptions): Promise<OperationResult> {
  if (!uuidPattern.test(requestKey)) throw new InvalidOperationRequestError();
  const hash = requestHash(methodRoute, resourceId, requestBody);
  const database = pool ?? getPool();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let client: PoolClient | undefined;
    let transactionStarted = false;
    let shouldRetry = false;
    let discardConnection: Error | undefined;

    try {
      client = await database.connect();
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      transactionStarted = true;
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '5s'");

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO routebook.operations
           (actor_id, request_key, method_route, request_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (actor_id, request_key) DO NOTHING
         RETURNING id`,
        [actorId, requestKey, methodRoute, hash],
      );

      const replayed = inserted.rowCount === 0;
      let existing: OperationRow | undefined;
      if (replayed) {
        const result = await client.query<OperationRow>(
          `SELECT method_route, request_hash, http_status, response_body
             FROM routebook.operations
            WHERE actor_id = $1 AND request_key = $2
            FOR UPDATE`,
          [actorId, requestKey],
        );
        existing = result.rows[0];
        if (!existing) throw new Error("Operation receipt could not be loaded.");
        if (existing.method_route !== methodRoute || existing.request_hash !== hash) {
          throw new OperationKeyReuseError();
        }
      }

      await authorize({ client, replayed });

      if (replayed) {
        const body = parseSuccessBody(existing?.response_body);
        if (!body || existing?.http_status === null || existing?.http_status === undefined) {
          throw new Error("Stored operation receipt is invalid.");
        }
        await client.query("COMMIT");
        transactionStarted = false;
        return { status: existing.http_status, body, replayed: true };
      }

      const outcome = await execute({ client });
      const body = parseSuccessBody(outcome.body);
      if (
        !body ||
        !Number.isInteger(outcome.status) ||
        outcome.status < 200 ||
        outcome.status > 299
      ) {
        throw new Error("Operation response must be a bounded success envelope.");
      }

      const completed = await client.query(
        `UPDATE routebook.operations
            SET http_status = $1, response_body = $2::jsonb
          WHERE actor_id = $3 AND request_key = $4
            AND http_status IS NULL AND response_body IS NULL`,
        [outcome.status, JSON.stringify(body), actorId, requestKey],
      );
      if (completed.rowCount !== 1) {
        throw new Error("Operation receipt could not be completed.");
      }

      await client.query("COMMIT");
      transactionStarted = false;
      return { status: outcome.status, body, replayed: false };
    } catch (error) {
      const code = sqlState(error);
      if (code?.startsWith("08")) {
        discardConnection = error instanceof Error ? error : new Error("Database connection failed.");
      }

      if (client && transactionStarted) {
        try {
          await rollback(client);
        } catch (rollbackError) {
          discardConnection = rollbackError instanceof Error
            ? rollbackError
            : new Error("Database transaction rollback failed.");
        }
      }

      if (!isTransientDatabaseError(code)) throw error;
      if (attempt === maxAttempts) throw new RetryableTransactionError(error);
      shouldRetry = true;
    } finally {
      if (client) client.release(discardConnection);
    }

    if (shouldRetry) await retryDelay(attempt);
  }

  throw new RetryableTransactionError();
}
