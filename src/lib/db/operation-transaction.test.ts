import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OperationKeyReuseError,
  RetryableTransactionError,
  runOperationTransaction,
  type OperationSuccessBody,
} from "./operation-transaction";

type Receipt = {
  method_route: string;
  request_hash: string;
  http_status: number | null;
  response_body: unknown;
};

function makePool() {
  let receipt: Receipt | null = null;
  let receiptAtBegin: Receipt | null = null;
  let failMutation = 0;
  let failRollback = false;
  const statements: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (sql === "BEGIN ISOLATION LEVEL READ COMMITTED") receiptAtBegin = receipt;
    if (sql.startsWith("INSERT INTO routebook.operations")) {
      if (receipt) return { rows: [], rowCount: 0 };
      receipt = {
        method_route: String(values[2]),
        request_hash: String(values[3]),
        http_status: null,
        response_body: null,
      };
      return { rows: [{ id: "receipt-id" }], rowCount: 1 };
    }
    if (sql.includes("FROM routebook.operations")) {
      return { rows: receipt ? [{ ...receipt }] : [], rowCount: receipt ? 1 : 0 };
    }
    if (sql.includes("FROM routebook.staff_profiles")) {
      return { rows: [{ role: "SUPERVISOR", active: true }], rowCount: 1 };
    }
    if (sql.includes("MUTATE RESOURCE")) {
      if (failMutation > 0) {
        failMutation -= 1;
        throw { code: "40P01" };
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE routebook.operations")) {
      if (!receipt) return { rows: [], rowCount: 0 };
      receipt = {
        ...receipt,
        http_status: Number(values[0]),
        response_body: JSON.parse(String(values[1])),
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql === "ROLLBACK") {
      if (failRollback) throw new Error("rollback failed");
      receipt = receiptAtBegin;
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);

  return {
    pool: { connect } as unknown as Pick<Pool, "connect">,
    statements,
    connect,
    query,
    release,
    get receipt() {
      return receipt;
    },
    failNextMutation() {
      failMutation += 1;
    },
    failRollback() {
      failRollback = true;
    },
  };
}

const body: OperationSuccessBody = {
  success: true,
  data: { customer: { id: "customer-id" } },
};

function operation(pool: Pick<Pool, "connect">, overrides: Record<string, unknown> = {}) {
  return {
    actorId: "11111111-1111-4111-8111-111111111111",
    requestKey: "22222222-2222-4222-8222-222222222222",
    methodRoute: "POST /api/customers",
    requestBody: { name: "Cedar Market", location: "Beirut" },
    authorize: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({ status: 201, body })),
    pool,
    ...overrides,
  };
}

describe("runOperationTransaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("commits the resource mutation and bounded receipt in one timed transaction", async () => {
    const database = makePool();
    const request = operation(database.pool, {
      execute: vi.fn(async ({ client }: { client: PoolClient }) => {
        await client.query("MUTATE RESOURCE");
        return { status: 201, body };
      }),
    });

    await expect(runOperationTransaction(request)).resolves.toMatchObject({
      status: 201,
      body,
      replayed: false,
    });
    expect(database.statements).toContain("SET LOCAL lock_timeout = '2s'");
    expect(database.statements).toContain("SET LOCAL statement_timeout = '5s'");
    const mutationIndex = database.statements.findIndex((sql) => sql.includes("MUTATE RESOURCE"));
    const receiptIndex = database.statements.findIndex((sql) => sql.includes("UPDATE routebook.operations"));
    expect(mutationIndex).toBeGreaterThan(-1);
    expect(receiptIndex).toBeGreaterThan(mutationIndex);
    expect(database.statements.at(-1)).toBe("COMMIT");
    expect(database.receipt?.http_status).toBe(201);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("replays the original response, canonicalizes object keys and rechecks access", async () => {
    const database = makePool();
    const request = operation(database.pool);
    await runOperationTransaction(request);

    const replay = await runOperationTransaction({
      ...request,
      requestBody: { location: "Beirut", name: "Cedar Market" },
    });
    expect(replay).toEqual({ status: 201, body, replayed: true });
    expect(request.execute).toHaveBeenCalledOnce();
    expect(request.authorize).toHaveBeenCalledTimes(2);
  });

  it("rejects a reused key with a changed body", async () => {
    const database = makePool();
    const request = operation(database.pool);
    await runOperationTransaction(request);
    await expect(
      runOperationTransaction({ ...request, requestBody: { name: "Other", location: "Beirut" } }),
    ).rejects.toBeInstanceOf(OperationKeyReuseError);
    expect(request.execute).toHaveBeenCalledOnce();
  });

  it("rolls back a failed mutation and its provisional receipt", async () => {
    const database = makePool();
    const request = operation(database.pool, {
      execute: vi.fn(async () => {
        throw new Error("database failure");
      }),
    });
    await expect(runOperationTransaction(request)).rejects.toThrow("database failure");
    expect(database.statements).toContain("ROLLBACK");
    expect(database.statements).not.toContain("COMMIT");
    expect(database.receipt).toBeNull();
  });

  it("retries deadlocks with the same idempotency key and bounded attempts", async () => {
    const database = makePool();
    database.failNextMutation();
    const request = operation(database.pool, {
      execute: vi.fn(async ({ client }: { client: PoolClient }) => {
        await client.query("MUTATE RESOURCE");
        return { status: 201, body };
      }),
    });
    await expect(runOperationTransaction(request)).resolves.toMatchObject({ replayed: false });
    expect(database.connect).toHaveBeenCalledTimes(2);
    expect(database.release).toHaveBeenCalledTimes(2);
    expect(request.requestKey).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("returns a retryable error after three transient failures", async () => {
    const database = makePool();
    database.failNextMutation();
    database.failNextMutation();
    database.failNextMutation();
    const request = operation(database.pool, {
      execute: vi.fn(async ({ client }: { client: PoolClient }) => {
        await client.query("MUTATE RESOURCE");
        return { status: 201, body };
      }),
    });
    await expect(runOperationTransaction(request)).rejects.toBeInstanceOf(RetryableTransactionError);
    expect(database.connect).toHaveBeenCalledTimes(3);
  });

  it("discards a connection when rollback fails", async () => {
    const database = makePool();
    database.failRollback();
    const request = operation(database.pool, {
      execute: vi.fn(async () => {
        throw new Error("mutation failed");
      }),
    });
    await expect(runOperationTransaction(request)).rejects.toThrow("mutation failed");
    expect(database.release).toHaveBeenCalledWith(expect.any(Error));
  });
});
