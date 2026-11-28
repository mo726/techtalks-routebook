import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  InvalidOperationRequestError,
  OperationKeyReuseError,
  RetryableTransactionError,
  runStandaloneOperation,
  runVanDayOperation,
  type OperationSuccessBody,
} from "./van-day-transaction";

type StoredReceipt = {
  method_route: string;
  request_hash: string;
  http_status: number | null;
  response_body: unknown;
};

function createDatabase() {
  const statements: string[] = [];
  let receipt: StoredReceipt | null = null;
  let receiptAtTransactionStart: StoredReceipt | null = null;
  let failingStatement: { fragment: string; remaining: number } | null = null;
  let commitDisconnect: {
    committed: boolean;
    emitError: boolean;
    remaining: number;
  } | null = null;
  const release = vi.fn();

  const query = vi.fn(
    async (sql: string, values?: unknown[]) => {
      statements.push(sql);

      if (sql === "BEGIN ISOLATION LEVEL READ COMMITTED") {
        receiptAtTransactionStart = receipt;
      }

      if (
        failingStatement &&
        failingStatement.remaining > 0 &&
        sql.includes(failingStatement.fragment)
      ) {
        failingStatement.remaining -= 1;
        throw { code: "40P01" };
      }

      if (sql.startsWith("INSERT INTO routebook.operations")) {
        if (receipt) {
          return { rows: [], rowCount: 0 };
        }
        receipt = {
          method_route: values?.[2] as string,
          request_hash: values?.[3] as string,
          http_status: null,
          response_body: null,
        };
        return { rows: [{ id: "operation-1" }], rowCount: 1 };
      }

      if (sql.includes("FROM routebook.operations")) {
        return {
          rows: receipt ? [{ ...receipt }] : [],
          rowCount: receipt ? 1 : 0,
        };
      }

      if (sql.startsWith("SELECT id, state, revision")) {
        return {
          rows: [{ id: "day-1", state: "OPEN", revision: 1 }],
          rowCount: 1,
        };
      }

      if (sql.startsWith("UPDATE routebook.operations")) {
        if (!receipt) {
          return { rows: [], rowCount: 0 };
        }
        receipt = {
          ...receipt,
          http_status: values?.[0] as number,
          response_body: JSON.parse(values?.[1] as string),
        };
        return { rows: [], rowCount: 1 };
      }

      if (sql === "ROLLBACK") {
        receipt = receiptAtTransactionStart;
      }

      if (sql === "COMMIT" && commitDisconnect && commitDisconnect.remaining > 0) {
        commitDisconnect.remaining -= 1;
        if (!commitDisconnect.committed) {
          receipt = receiptAtTransactionStart;
        }
        const error = new Error("Connection terminated unexpectedly");
        if (commitDisconnect.emitError) {
          client.emit("error", error);
        }
        throw error;
      }

      return { rows: [], rowCount: 1 };
    },
  );
  const client = Object.assign(new EventEmitter(), { query, release });
  const connect = vi.fn(async () => client as unknown as PoolClient);
  const pool = { connect } as unknown as Pick<Pool, "connect">;

  return {
    statements,
    query,
    release,
    connect,
    client,
    pool,
    failStatement(statement: string, times = 1) {
      failingStatement = { fragment: statement, remaining: times };
    },
    disconnectOnCommit({ committed, emitError = true, times = 1 }: {
      committed: boolean;
      emitError?: boolean;
      times?: number;
    }) {
      commitDisconnect = { committed, emitError, remaining: times };
    },
  };
}

const successBody: OperationSuccessBody = {
  success: true,
  data: { id: "result-1" },
};

function makeOperation(
  pool: Pick<Pool, "connect">,
  overrides: Partial<Extract<Parameters<typeof runVanDayOperation>[0], { vanDayId: string }>> = {},
) {
  return {
    actorId: "staff-1",
    vanDayId: "day-1",
    requestKey: "11111111-1111-4111-8111-111111111111",
    methodRoute: "POST /api/van-days/day-1/visits",
    requestBody: { customerId: "customer-1", quantity: 3 },
    authorize: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({ status: 201, body: successBody })),
    pool,
    ...overrides,
  };
}

describe("runVanDayOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the day and commits the business result with its receipt", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool);

    await expect(runVanDayOperation(operation)).resolves.toEqual({
      status: 201,
      body: successBody,
      replayed: false,
    });

    const lockIndex = database.statements.findIndex((statement) =>
      statement.startsWith("SELECT id, state, revision"),
    );
    const executeIndex = database.statements.findIndex((statement) =>
      statement.startsWith("UPDATE routebook.operations"),
    );
    const commitIndex = database.statements.indexOf("COMMIT");

    expect(database.statements).toContain("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(database.statements).toContain("SET LOCAL lock_timeout = '2s'");
    expect(database.statements).toContain("SET LOCAL statement_timeout = '5s'");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(executeIndex).toBeGreaterThan(lockIndex);
    expect(commitIndex).toBeGreaterThan(executeIndex);
    expect(operation.execute).toHaveBeenCalledOnce();
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("replays the stored response without running the mutation again", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool);

    await runVanDayOperation(operation);
    const replay = await runVanDayOperation({
      ...operation,
      requestBody: { quantity: 3, customerId: "customer-1" },
    });

    expect(replay).toEqual({ status: 201, body: successBody, replayed: true });
    expect(operation.execute).toHaveBeenCalledOnce();
    expect(operation.authorize).toHaveBeenCalledTimes(2);
  });

  it("rejects a reused key when the request body differs", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool);

    await runVanDayOperation(operation);

    await expect(
      runVanDayOperation({
        ...operation,
        requestBody: { customerId: "customer-1", quantity: 4 },
      }),
    ).rejects.toBeInstanceOf(OperationKeyReuseError);
    expect(database.statements).toContain("ROLLBACK");
  });

  it("distinguishes resources on the same van day when comparing request keys", async () => {
    const database = createDatabase();
    const { vanDayId, ...operation } = makeOperation(database.pool);
    const resolveVanDayId = vi.fn(async () => vanDayId);
    const firstTarget = { id: "invoice-1", resolveVanDayId };

    await runVanDayOperation({ ...operation, resource: firstTarget });
    await expect(runVanDayOperation({ ...operation, resource: firstTarget })).resolves.toMatchObject({
      status: 201,
      replayed: true,
    });
    await expect(runVanDayOperation({
      ...operation,
      resource: { id: "invoice-2", resolveVanDayId },
    })).rejects.toBeInstanceOf(OperationKeyReuseError);
    expect(resolveVanDayId).toHaveBeenCalledWith(expect.anything(), "invoice-1");
    expect(resolveVanDayId).toHaveBeenCalledTimes(2);
    expect(operation.execute).toHaveBeenCalledOnce();
  });

  it("rolls back when the business operation fails", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool, {
      execute: vi.fn(async () => {
        throw new Error("business failure");
      }),
    });

    await expect(runVanDayOperation(operation)).rejects.toThrow(
      "business failure",
    );
    expect(database.statements).toContain("ROLLBACK");
    expect(database.statements).not.toContain("COMMIT");
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("retries transient transaction failures with the same operation key", async () => {
    const database = createDatabase();
    database.failStatement("statement_timeout", 1);
    const operation = makeOperation(database.pool);

    await expect(runVanDayOperation(operation)).resolves.toMatchObject({
      status: 201,
      replayed: false,
    });

    expect(database.connect).toHaveBeenCalledTimes(2);
    expect(database.release).toHaveBeenCalledTimes(2);
    expect(operation.execute).toHaveBeenCalledOnce();
  });

  it("returns a retryable error after exhausting transient retries", async () => {
    const database = createDatabase();
    database.failStatement("statement_timeout", 3);
    const operation = makeOperation(database.pool);

    await expect(runVanDayOperation(operation)).rejects.toBeInstanceOf(
      RetryableTransactionError,
    );
    expect(database.connect).toHaveBeenCalledTimes(3);
    expect(database.release).toHaveBeenCalledTimes(3);
    expect(operation.execute).not.toHaveBeenCalled();
  });

  it("reconnects and replays the receipt when the commit succeeded before the connection dropped", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool);
    database.disconnectOnCommit({ committed: true });

    await expect(runVanDayOperation(operation)).resolves.toEqual({
      status: 201,
      body: successBody,
      replayed: true,
    });
    expect(database.connect).toHaveBeenCalledTimes(2);
    expect(database.release).toHaveBeenNthCalledWith(1, true);
    expect(database.release).toHaveBeenNthCalledWith(2, false);
    expect(database.client.listenerCount("error")).toBe(0);
    expect(database.statements).not.toContain("ROLLBACK");
    expect(operation.execute).toHaveBeenCalledOnce();
  });

  it("uses the same key to try the mutation again when the disconnect prevented the commit", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool);
    database.disconnectOnCommit({ committed: false, emitError: false });

    await expect(runVanDayOperation(operation)).resolves.toEqual({
      status: 201,
      body: successBody,
      replayed: false,
    });
    expect(database.release).toHaveBeenNthCalledWith(1, true);
    expect(operation.execute).toHaveBeenCalledTimes(2);
    const receiptClaims = database.query.mock.calls.filter(([sql]) =>
      sql.startsWith("INSERT INTO routebook.operations"),
    );
    expect(receiptClaims).toHaveLength(2);
    expect(receiptClaims[1]).toEqual(receiptClaims[0]);
  });

  it("directs the caller to retry with the original key if it cannot confirm a commit", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool);
    database.disconnectOnCommit({ committed: true, times: 3 });

    await expect(runVanDayOperation(operation)).rejects.toMatchObject({
      code: "TRANSACTION_RETRYABLE",
      status: 503,
      retryable: true,
      message: expect.stringContaining("same idempotency key"),
    });
    expect(database.connect).toHaveBeenCalledTimes(3);
    await expect(runVanDayOperation(operation)).resolves.toEqual({
      status: 201,
      body: successBody,
      replayed: true,
    });
    expect(operation.execute).toHaveBeenCalledOnce();
  });

  it("rejects request bodies that cannot be represented as JSON", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool, {
      requestBody: { invalid: undefined },
    });

    await expect(runVanDayOperation(operation)).rejects.toBeInstanceOf(
      InvalidOperationRequestError,
    );
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID idempotency key before opening a transaction", async () => {
    const database = createDatabase();
    const operation = makeOperation(database.pool, { requestKey: "not-a-uuid" });

    await expect(runVanDayOperation(operation)).rejects.toBeInstanceOf(
      InvalidOperationRequestError,
    );
    expect(database.connect).not.toHaveBeenCalled();
  });
});

describe("runStandaloneOperation", () => {
  it("commits create operations with a durable idempotency receipt", async () => {
    const database = createDatabase();
    const execute = vi.fn(async () => ({ status: 201, body: successBody }));
    const operation = {
      actorId: "staff-1",
      requestKey: "11111111-1111-4111-8111-111111111111",
      methodRoute: "POST /api/van-days",
      requestBody: { vanCode: "VAN-01" },
      authorize: vi.fn(async () => undefined),
      execute,
      pool: database.pool,
    };

    await expect(runStandaloneOperation(operation)).resolves.toMatchObject({
      status: 201,
      replayed: false,
    });
    expect(
      database.statements.some((statement) =>
        statement.startsWith("SELECT id, state, revision"),
      ),
    ).toBe(false);
    expect(database.statements).toContain("COMMIT");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("replays successful standalone operations without repeating their effect", async () => {
    const database = createDatabase();
    const execute = vi.fn(async () => ({ status: 201, body: successBody }));
    const operation = {
      actorId: "staff-1",
      requestKey: "11111111-1111-4111-8111-111111111111",
      methodRoute: "POST /api/van-days",
      requestBody: { vanCode: "VAN-01" },
      authorize: vi.fn(async () => undefined),
      execute,
      pool: database.pool,
    };

    await runStandaloneOperation(operation);
    await expect(runStandaloneOperation(operation)).resolves.toMatchObject({
      status: 201,
      replayed: true,
      body: successBody,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(operation.authorize).toHaveBeenCalledTimes(2);
  });

  it("rejects standalone key reuse when the request body changes", async () => {
    const database = createDatabase();
    const operation = {
      actorId: "staff-1",
      requestKey: "11111111-1111-4111-8111-111111111111",
      methodRoute: "POST /api/van-days",
      requestBody: { vanCode: "VAN-01" },
      authorize: vi.fn(async () => undefined),
      execute: vi.fn(async () => ({ status: 201, body: successBody })),
      pool: database.pool,
    };

    await runStandaloneOperation(operation);
    await expect(
      runStandaloneOperation({
        ...operation,
        requestBody: { vanCode: "VAN-02" },
      }),
    ).rejects.toBeInstanceOf(OperationKeyReuseError);
  });

  it("reconnects and replays standalone receipts when commit succeeds before a disconnect", async () => {
    const database = createDatabase();
    const execute = vi.fn(async () => ({ status: 201, body: successBody }));
    const operation = {
      actorId: "staff-1",
      requestKey: "11111111-1111-4111-8111-111111111111",
      methodRoute: "POST /api/van-days",
      requestBody: { vanCode: "VAN-01" },
      authorize: vi.fn(async () => undefined),
      execute,
      pool: database.pool,
    };
    database.disconnectOnCommit({ committed: true });

    await expect(runStandaloneOperation(operation)).resolves.toEqual({
      status: 201,
      body: successBody,
      replayed: true,
    });
    expect(database.connect).toHaveBeenCalledTimes(2);
    expect(database.release).toHaveBeenNthCalledWith(1, true);
    expect(database.release).toHaveBeenNthCalledWith(2, false);
    expect(database.client.listenerCount("error")).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
  });
});
