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

export type VanDayState = "PREPARING" | "OPEN" | "CLOSED";

export type LockedVanDay = {
  id: string;
  state: VanDayState;
  revision: number;
};

export type TransactionOutcome = {
  status: number;
  body: OperationSuccessBody;
};

export type VanDayOperationResult = TransactionOutcome & {
  replayed: boolean;
};

type OperationRow = QueryResultRow & {
  method_route: string;
  request_hash: string;
  http_status: number | null;
  response_body: unknown;
};

type VanDayRow = QueryResultRow & LockedVanDay;

export class OperationKeyReuseError extends Error {
  readonly status = 409;
  readonly code = "KEY_REUSED";

  constructor() {
    super("The idempotency key was already used for a different request.");
    this.name = "OperationKeyReuseError";
  }
}

export class VanDayNotFoundError extends Error {
  readonly status = 404;
  readonly code = "VAN_DAY_NOT_FOUND";

  constructor() {
    super("The requested van day was not found.");
    this.name = "VanDayNotFoundError";
  }
}

export class RetryableTransactionError extends Error {
  readonly status = 503;
  readonly code = "TRANSACTION_RETRYABLE";
  readonly retryable = true;

  constructor(cause?: unknown) {
    super(
      "The operation could not be confirmed. Retry with the same idempotency key.",
      { cause },
    );
    this.name = "RetryableTransactionError";
  }
}

export class InvalidOperationRequestError extends Error {
  readonly status = 400;
  readonly code = "INVALID_OPERATION_REQUEST";

  constructor() {
    super("The operation request must contain valid JSON data.");
    this.name = "InvalidOperationRequestError";
  }
}

type OperationContext = {
  client: PoolClient;
  vanDay: LockedVanDay;
};

type VanDayTarget =
  | { vanDayId: string; resource?: never }
  | {
      vanDayId?: never;
      resource: {
        id: string;
        resolveVanDayId: (client: PoolClient, resourceId: string) => Promise<string>;
      };
    };

type RunVanDayOperationOptions = {
  actorId: string;
  requestKey: string;
  methodRoute: string;
  requestBody: unknown;
  authorize: (
    context: OperationContext & { replayed: boolean },
  ) => Promise<void>;
  execute: (context: OperationContext) => Promise<TransactionOutcome>;
  pool?: Pick<Pool, "connect">;
} & VanDayTarget;

type StandaloneOperationContext = {
  client: PoolClient;
  replayed: boolean;
};

type RunStandaloneOperationOptions = {
  actorId: string;
  requestKey: string;
  methodRoute: string;
  requestBody: unknown;
  authorize: (context: StandaloneOperationContext) => Promise<void>;
  execute: (context: StandaloneOperationContext) => Promise<TransactionOutcome>;
  pool?: Pick<Pool, "connect">;
};

const maxAttempts = 3;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOperationRequestKey(value: string | null): value is string {
  return value !== null && uuidPattern.test(value);
}

const retryableTransactionCodes = new Set([
  "40001",
  "40P01",
  "55P03",
  "57014",
]);

const retryableConnectionCodes = new Set([
  "08003",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

const pgDisconnectMessages = new Set([
  "Connection terminated",
  "Connection terminated unexpectedly",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJson(
  value: unknown,
  seen = new WeakSet<object>(),
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new InvalidOperationRequestError();
    }
    seen.add(value);
    const normalized = value.map((item) => normalizeJson(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (
      seen.has(value) ||
      (prototype !== Object.prototype && prototype !== null)
    ) {
      throw new InvalidOperationRequestError();
    }

    seen.add(value);
    const normalized = Object.create(null) as {
      [key: string]: JsonValue;
    };
    for (const key of Object.keys(value).sort()) {
      const property = value[key];
      if (property === undefined) {
        throw new InvalidOperationRequestError();
      }
      normalized[key] = normalizeJson(property, seen);
    }
    seen.delete(value);
    return normalized;
  }

  throw new InvalidOperationRequestError();
}

function hashRequest(
  methodRoute: string,
  targetId: string,
  requestBody: unknown,
): string {
  if (
    !methodRoute.trim() ||
    methodRoute.length > 240 ||
    methodRoute !== methodRoute.trim()
  ) {
    throw new InvalidOperationRequestError();
  }

  const canonicalBody = JSON.stringify(normalizeJson(requestBody));
  return createHash("sha256")
    .update(`${methodRoute}\n${targetId}\n${canonicalBody}`)
    .digest("hex");
}

function parseSuccessBody(value: unknown): OperationSuccessBody | null {
  if (!isRecord(value) || value.success !== true) {
    return null;
  }

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

function validateOutcome(outcome: TransactionOutcome): OperationSuccessBody {
  if (
    !Number.isInteger(outcome.status) ||
    outcome.status < 200 ||
    outcome.status > 299
  ) {
    throw new Error("Idempotent operations must store a successful HTTP outcome.");
  }

  const body = parseSuccessBody(outcome.body);
  if (!body) {
    throw new Error("Idempotent operations must store a bounded success envelope.");
  }

  return body;
}

function databaseErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function isDatabaseConnectionError(
  error: unknown,
  code: string | undefined,
): boolean {
  return (
    (code !== undefined && retryableConnectionCodes.has(code)) ||
    (error instanceof Error && pgDisconnectMessages.has(error.message))
  );
}

function retryDelay(attempt: number): Promise<void> {
  const delayMs = 20 * attempt + Math.floor(Math.random() * 31);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function lockVanDay(
  client: PoolClient,
  vanDayId: string,
): Promise<LockedVanDay> {
  const result = await client.query<VanDayRow>(
    `SELECT id, state, revision
       FROM routebook.van_days
      WHERE id = $1
      FOR UPDATE`,
    [vanDayId],
  );
  const vanDay = result.rows[0];

  if (!vanDay) {
    throw new VanDayNotFoundError();
  }

  return vanDay;
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK");
}

export async function runVanDayOperation({
  actorId,
  vanDayId,
  resource,
  requestKey,
  methodRoute,
  requestBody,
  authorize,
  execute,
  pool,
}: RunVanDayOperationOptions): Promise<VanDayOperationResult> {
  if (!isOperationRequestKey(requestKey)) {
    throw new InvalidOperationRequestError();
  }

  const database = pool ?? getPool();
  const requestHash = hashRequest(
    methodRoute,
    resource ? resource.id : vanDayId,
    requestBody,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let client: PoolClient | undefined;
    let transactionStarted = false;
    let discardConnection = false;
    const onConnectionError = () => {
      discardConnection = true;
    };

    try {
      client = await database.connect();
      // The pool delegates error handling while the client is checked out.
      client.on("error", onConnectionError);
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
        [actorId, requestKey, methodRoute, requestHash],
      );

      const replayed = inserted.rowCount === 0;
      let existingOperation: OperationRow | undefined;

      if (replayed) {
        const existing = await client.query<OperationRow>(
          `SELECT method_route, request_hash, http_status, response_body
             FROM routebook.operations
            WHERE actor_id = $1 AND request_key = $2
            FOR UPDATE`,
          [actorId, requestKey],
        );
        existingOperation = existing.rows[0];

        if (!existingOperation) {
          throw new Error("The operation receipt could not be read after a key conflict.");
        }

        if (
          existingOperation.method_route !== methodRoute ||
          existingOperation.request_hash !== requestHash
        ) {
          throw new OperationKeyReuseError();
        }
      }

      const dayId = resource
        ? await resource.resolveVanDayId(client, resource.id)
        : vanDayId;
      const vanDay = await lockVanDay(client, dayId);
      const context = { client, vanDay };
      await authorize({ ...context, replayed });

      if (replayed) {
        const body = parseSuccessBody(existingOperation?.response_body);
        const status = existingOperation?.http_status;
        if (!body || status === null || status === undefined) {
          throw new Error("The completed operation receipt is invalid.");
        }

        await client.query("COMMIT");
        transactionStarted = false;
        return { status, body, replayed: true };
      }

      const outcome = await execute(context);
      const body = validateOutcome(outcome);
      const completed = await client.query(
        `UPDATE routebook.operations
            SET http_status = $1, response_body = $2::jsonb
          WHERE actor_id = $3 AND request_key = $4
            AND http_status IS NULL
            AND response_body IS NULL`,
        [
          outcome.status,
          JSON.stringify(body),
          actorId,
          requestKey,
        ],
      );

      if (completed.rowCount !== 1) {
        throw new Error("The operation receipt could not be completed.");
      }

      await client.query("COMMIT");
      transactionStarted = false;
      return { status: outcome.status, body, replayed: false };
    } catch (error) {
      const code = databaseErrorCode(error);
      discardConnection ||= isDatabaseConnectionError(error, code);
      const retryable =
        discardConnection ||
        (code !== undefined && retryableTransactionCodes.has(code));

      if (client && transactionStarted && !discardConnection) {
        try {
          await rollback(client);
        } catch {
          discardConnection = true;
        }
      }

      if (!retryable) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new RetryableTransactionError(error);
      }
    } finally {
      if (client) {
        client.removeListener("error", onConnectionError);
        client.release(discardConnection);
      }
    }

    // Reuse the same key to recover the receipt if COMMIT succeeded before disconnecting.
    await retryDelay(attempt);
  }

  throw new RetryableTransactionError();
}

export async function runStandaloneOperation({
  actorId,
  requestKey,
  methodRoute,
  requestBody,
  authorize,
  execute,
  pool,
}: RunStandaloneOperationOptions): Promise<VanDayOperationResult> {
  if (!uuidPattern.test(requestKey)) {
    throw new InvalidOperationRequestError();
  }

  const database = pool ?? getPool();
  const requestHash = hashRequest(methodRoute, "standalone", requestBody);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await database.connect();
    let transactionStarted = false;
    let shouldRetry = false;

    try {
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
        [actorId, requestKey, methodRoute, requestHash],
      );

      const replayed = inserted.rowCount === 0;
      let existingOperation: OperationRow | undefined;

      if (replayed) {
        const existing = await client.query<OperationRow>(
          `SELECT method_route, request_hash, http_status, response_body
             FROM routebook.operations
            WHERE actor_id = $1 AND request_key = $2
            FOR UPDATE`,
          [actorId, requestKey],
        );
        existingOperation = existing.rows[0];

        if (!existingOperation) {
          throw new Error("The operation receipt could not be read after a key conflict.");
        }

        if (
          existingOperation.method_route !== methodRoute ||
          existingOperation.request_hash !== requestHash
        ) {
          throw new OperationKeyReuseError();
        }
      }

      const context = { client, replayed };
      await authorize(context);

      if (replayed) {
        const body = parseSuccessBody(existingOperation?.response_body);
        const status = existingOperation?.http_status;
        if (!body || status === null || status === undefined) {
          throw new Error("The completed operation receipt is invalid.");
        }

        await client.query("COMMIT");
        transactionStarted = false;
        return { status, body, replayed: true };
      }

      const outcome = await execute(context);
      const body = validateOutcome(outcome);
      const completed = await client.query(
        `UPDATE routebook.operations
            SET http_status = $1, response_body = $2::jsonb
          WHERE actor_id = $3 AND request_key = $4
            AND http_status IS NULL
            AND response_body IS NULL`,
        [outcome.status, JSON.stringify(body), actorId, requestKey],
      );

      if (completed.rowCount !== 1) {
        throw new Error("The operation receipt could not be completed.");
      }

      await client.query("COMMIT");
      transactionStarted = false;
      return { status: outcome.status, body, replayed: false };
    } catch (error) {
      if (transactionStarted) {
        try {
          await rollback(client);
        } catch {
          // Preserve the transaction error; releasing the connection discards its state.
        }
      }

      if (!isTransientDatabaseError(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new RetryableTransactionError(error);
      }
      shouldRetry = true;
    } finally {
      client.release();
    }

    if (shouldRetry) {
      await retryDelay(attempt);
    }
  }

  throw new RetryableTransactionError();
}
