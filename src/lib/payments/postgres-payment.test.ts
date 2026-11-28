// @vitest-environment node
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPool } from "@/lib/db/pool";
import { recordInvoicePayment } from "./postgres-payment";

vi.mock("@/lib/db/pool");

const actorId = "11111111-1111-4111-8111-111111111111";
const dayId = "22222222-2222-4222-8222-222222222222";
const input = {
  invoiceId: "33333333-3333-4333-8333-333333333333",
  idempotencyKey: "44444444-4444-4444-8444-444444444444",
  amountCents: 1000n,
  expectedInvoiceVersion: 2,
};

type MockOptions = {
  dayState?: "PREPARING" | "OPEN" | "CLOSED";
  totalCents?: string;
  paidCents?: string;
  visitFound?: boolean;
};

describe("PostgreSQL payment transaction", () => {
  const query = vi.fn();

  function mockInvoiceVersion(
    version: number,
    {
      dayState = "OPEN",
      totalCents = "2500",
      paidCents = "750",
      visitFound = true,
    }: MockOptions = {},
  ) {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT visit.day_id")) {
        return visitFound ? { rows: [{ day_id: dayId }] } : { rows: [] };
      }
      if (sql.startsWith("SELECT id, state, revision")) {
        return { rows: [{ id: dayId, state: dayState, revision: 3 }] };
      }
      if (sql.startsWith("SELECT invoice.version")) {
        return { rows: [{ version, total_cents: totalCents, paid_cents: paidCents }] };
      }
      return { rowCount: 1, rows: [] };
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPool).mockReturnValue({
      connect: async () => Object.assign(new EventEmitter(), { query, release: vi.fn() }),
    } as unknown as ReturnType<typeof getPool>);
  });

  it("locks the day and invoice before writing a payment and completes the receipt last", async () => {
    mockInvoiceVersion(2);

    const result = await recordInvoicePayment(actorId, input);

    expect(result).toMatchObject({
      status: 201,
      body: {
        success: true,
        data: {
          paymentId: expect.any(String),
          amountCents: "1000",
          invoiceVersion: 3,
          totalPaidCents: "1750",
          balanceCents: "750",
        },
      },
    });
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.slice(5).map((sql) => sql.split("\n")[0])).toEqual([
      "SELECT id, state, revision",
      "SELECT 1",
      "SELECT invoice.version,",
      "INSERT INTO routebook.payments (id, invoice_id, amount_cents, received_by, received_at)",
      "UPDATE routebook.invoices",
      "UPDATE routebook.van_days SET revision = revision + 1 WHERE id = $1",
      "UPDATE routebook.operations",
      "COMMIT",
    ]);
    expect(statements[5]).toContain("FOR UPDATE");
    expect(statements[7]).toContain("FOR UPDATE OF invoice");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("AND version = $2"), [input.invoiceId, 2]);
  });

  it("rolls back a stale request before any payment or revision write", async () => {
    mockInvoiceVersion(3);

    await expect(recordInvoicePayment(actorId, input)).rejects.toMatchObject({ code: "STALE_VERSION" });

    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).not.toContainEqual(expect.stringMatching(/INSERT INTO routebook\.payments|UPDATE routebook\./));
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  it.each([
    ["CLOSED", "DAY_CLOSED"],
    ["PREPARING", "DAY_NOT_OPEN"],
  ] as const)("rejects a %s day before reading or writing invoice data", async (dayState, code) => {
    mockInvoiceVersion(2, { dayState });

    await expect(recordInvoicePayment(actorId, input)).rejects.toMatchObject({ code });

    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).not.toContainEqual(expect.stringMatching(/SELECT invoice\.version|INSERT INTO routebook\.payments|UPDATE routebook\./));
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  it("rejects an amount above the outstanding balance without writing", async () => {
    mockInvoiceVersion(2, { totalCents: "2500", paidCents: "2500" });

    await expect(recordInvoicePayment(actorId, input)).rejects.toMatchObject({
      code: "PAYMENT_EXCEEDS_BALANCE",
    });

    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).not.toContainEqual(expect.stringMatching(/INSERT INTO routebook\.payments|UPDATE routebook\./));
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  it("rejects an invoice that is not assigned to the actor", async () => {
    mockInvoiceVersion(2, { visitFound: false });

    await expect(recordInvoicePayment(actorId, input)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).not.toContainEqual(expect.stringMatching(/SELECT id, state, revision|INSERT INTO routebook\.payments|UPDATE routebook\./));
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});
