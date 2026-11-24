import { describe, expect, it } from "vitest";

import {
  MAX_CENTS,
  MONEY_ERROR_CODES,
} from "../money";
import { expectMoneyError } from "../money/test-utils";
import {
  PAYMENT_ERROR_STATUS,
  PAYMENT_METHOD_ROUTE,
  PaymentActor,
  PaymentError,
  PaymentErrorCode,
  PaymentInvoice,
  PaymentOperation,
  PaymentRecord,
  PaymentService,
  PaymentStore,
  PaymentTransaction,
  RecordPaymentInput,
  UpdateInvoiceAfterPayment,
  buildPaymentRequestHash,
  calculatePaymentSettlement,
  deserializePaymentReceipt,
  isPaymentError,
  recordPayment,
  serializePaymentReceipt,
  serializePaymentResponse,
} from "./payment";

const INVOICE_A = "0b6f1f1e-4a3a-4f5b-8c2d-1a2b3c4d5e6f";
const INVOICE_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DRIVER_A = "1f0e4c8a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const DRIVER_B = "2a1f5d9b-3c4e-4f6a-9b0c-1d2e3f4a5b6c";
const SUPERVISOR = "3b2a6e0c-4d5f-4a7b-8c1d-2e3f4a5b6c7d";
const KEY_1 = "4c3b7f1d-5e6a-4b8c-9d2e-3f4a5b6c7d8e";
const KEY_2 = "5d4c8a2e-6f7b-4c9d-8e3f-4a5b6c7d8e9f";

class MemoryPaymentStore
  implements PaymentStore, PaymentTransaction
{
  private invoices = new Map<string, PaymentInvoice>();
  private payments = new Map<string, PaymentRecord>();
  private operations = new Map<string, PaymentOperation>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    invoices: readonly PaymentInvoice[] = [],
    private readonly options: {
      failOnOperationInsert?: boolean;
    } = {},
  ) {
    for (const invoice of invoices) {
      this.invoices.set(invoice.id, invoice);
    }
  }

  async transaction<T>(
    fn: (tx: PaymentTransaction) => Promise<T>,
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const snapshot = {
        invoices: new Map(this.invoices),
        payments: new Map(this.payments),
        operations: new Map(this.operations),
      };

      try {
        return await fn(this);
      } catch (error) {
        this.invoices = snapshot.invoices;
        this.payments = snapshot.payments;
        this.operations = snapshot.operations;
        throw error;
      }
    });

    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  async findOperation(
    actorId: string,
    requestKey: string,
  ): Promise<PaymentOperation | undefined> {
    return this.operations.get(`${actorId}:${requestKey}`);
  }

  async findInvoiceForUpdate(
    invoiceId: string,
  ): Promise<PaymentInvoice | undefined> {
    return this.invoices.get(invoiceId);
  }

  async insertPayment(payment: PaymentRecord): Promise<void> {
    if (this.payments.has(payment.id)) {
      throw new Error("Duplicate payment ID");
    }

    this.payments.set(payment.id, payment);
  }

  async updateInvoiceAfterPayment(
    update: UpdateInvoiceAfterPayment,
  ): Promise<void> {
    const invoice = this.invoices.get(update.invoiceId);

    if (!invoice) {
      throw new PaymentError(
        "NOT_FOUND",
        "Invoice was not found.",
      );
    }

    if (invoice.version !== update.expectedVersion) {
      throw new PaymentError(
        "STALE_VERSION",
        "This invoice changed.",
      );
    }

    this.invoices.set(invoice.id, {
      ...invoice,
      paidCents: update.totalPaidCents,
      version: update.nextVersion,
      dayRevision: update.nextDayRevision,
    });
  }

  async insertOperation(
    operation: PaymentOperation,
  ): Promise<void> {
    if (this.options.failOnOperationInsert) {
      throw new Error("forced operation failure");
    }

    const key = `${operation.actorId}:${operation.requestKey}`;

    if (this.operations.has(key)) {
      throw new PaymentError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used.",
      );
    }

    this.operations.set(key, operation);
  }

  getInvoice(invoiceId: string): PaymentInvoice | undefined {
    return this.invoices.get(invoiceId);
  }

  setInvoice(invoice: PaymentInvoice): void {
    this.invoices.set(invoice.id, invoice);
  }

  deleteInvoice(invoiceId: string): void {
    this.invoices.delete(invoiceId);
  }

  getPayments(): readonly PaymentRecord[] {
    return [...this.payments.values()];
  }

  getPayment(id: string): PaymentRecord | undefined {
    return this.payments.get(id);
  }

  getOperation(
    actorId: string,
    requestKey: string,
  ): PaymentOperation | undefined {
    return this.operations.get(`${actorId}:${requestKey}`);
  }

  getOperations(): readonly PaymentOperation[] {
    return [...this.operations.values()];
  }
}

function openInvoice(
  overrides: Partial<PaymentInvoice> = {},
): PaymentInvoice {
  return {
    id: INVOICE_A,
    version: 1,
    totalCents: 2000n,
    paidCents: 0n,
    dayId: "day-1",
    dayStatus: "OPEN",
    assignedDriverId: DRIVER_A,
    dayRevision: 4,
    ...overrides,
  };
}

const driverA: PaymentActor = {
  id: DRIVER_A,
  role: "DRIVER",
  active: true,
};

const driverB: PaymentActor = {
  id: DRIVER_B,
  role: "DRIVER",
  active: true,
};

const supervisor: PaymentActor = {
  id: SUPERVISOR,
  role: "SUPERVISOR",
  active: true,
};

function createService(
  store: PaymentStore,
  idStart = 0,
): PaymentService {
  let sequence = idStart;

  return new PaymentService(store, {
    now: () => new Date("2026-11-22T10:00:00.000Z"),
    generateId: () => `payment-${++sequence}`,
  });
}

function paymentInput(
  overrides: Partial<RecordPaymentInput> = {},
): RecordPaymentInput {
  return {
    invoiceId: INVOICE_A,
    amountCents: 1000n,
    expectedInvoiceVersion: 1,
    idempotencyKey: KEY_1,
    ...overrides,
  };
}

function expectPaymentError(
  fn: () => unknown,
  code: PaymentErrorCode,
): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe(code);
    expect((error as PaymentError).httpStatus).toBe(
      PAYMENT_ERROR_STATUS[code],
    );
    return;
  }

  throw new Error(`Expected PaymentError with code ${code}.`);
}

async function expectPaymentRejection(
  fn: () => Promise<unknown>,
  code: PaymentErrorCode,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe(code);
    return;
  }

  throw new Error(`Expected PaymentError with code ${code}.`);
}

describe("calculatePaymentSettlement", () => {
  it("accepts partial and full payments", () => {
    expect(calculatePaymentSettlement(2000n, 0n, 1000n)).toEqual({
      totalPaidCents: 1000n,
      balanceCents: 1000n,
    });
    expect(
      calculatePaymentSettlement(2000n, 1000n, 1000n),
    ).toEqual({
      totalPaidCents: 2000n,
      balanceCents: 0n,
    });
  });

  it("accepts exactly the outstanding amount", () => {
    expect(
      calculatePaymentSettlement(2000n, 500n, 1500n),
    ).toEqual({
      totalPaidCents: 2000n,
      balanceCents: 0n,
    });
  });

  it("rejects payment above the positive balance", () => {
    expectPaymentError(
      () => calculatePaymentSettlement(2000n, 1000n, 1001n),
      "PAYMENT_EXCEEDS_BALANCE",
    );
    expectPaymentError(
      () => calculatePaymentSettlement(1500n, 2000n, 1n),
      "PAYMENT_EXCEEDS_BALANCE",
    );
  });

  it("rejects invalid total, paid and amount values", () => {
    expectMoneyError(
      () => calculatePaymentSettlement(0n, 0n, 1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => calculatePaymentSettlement(-1n, 0n, 1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => calculatePaymentSettlement(MAX_CENTS + 1n, 0n, 1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => calculatePaymentSettlement(2000n, -1n, 1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () =>
        calculatePaymentSettlement(
          2000n,
          MAX_CENTS + 1n,
          1n,
        ),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => calculatePaymentSettlement(2000n, 0n, 0n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => calculatePaymentSettlement(2000n, 0n, -1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () =>
        calculatePaymentSettlement(
          2000n,
          0n,
          MAX_CENTS + 1n,
        ),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });
});

describe("PaymentService happy path", () => {
  it("records a partial payment with audit fields and updates the invoice", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    const receipt = await service.recordPayment(
      driverA,
      paymentInput(),
    );

    expect(receipt).toMatchObject({
      invoiceVersion: 2,
      totalPaidCents: 1000n,
      balanceCents: 1000n,
    });
    expect(receipt.payment).toEqual({
      id: "payment-1",
      invoiceId: INVOICE_A,
      amountCents: 1000n,
      receivedBy: DRIVER_A,
      receivedAt: "2026-11-22T10:00:00.000Z",
    });
    expect(store.getInvoice(INVOICE_A)).toMatchObject({
      paidCents: 1000n,
      version: 2,
      dayRevision: 5,
    });
    expect(store.getPayments()).toHaveLength(1);
    expect(store.getOperation(DRIVER_A, KEY_1)).toMatchObject({
      methodRoute: PAYMENT_METHOD_ROUTE,
      httpStatus: 201,
      requestHash: buildPaymentRequestHash(paymentInput()),
    });
    expect(
      store.getOperation(DRIVER_A, KEY_1)?.response,
    ).toMatchObject({
      paymentId: "payment-1",
      amountCents: "1000",
      totalPaidCents: "1000",
      balanceCents: "1000",
    });
  });

  it("records multiple payments and reaches a zero balance", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    const first = await service.recordPayment(
      driverA,
      paymentInput(),
    );
    const second = await service.recordPayment(
      driverA,
      paymentInput({
        amountCents: 1000n,
        expectedInvoiceVersion: 2,
        idempotencyKey: KEY_2,
      }),
    );

    expect(first.invoiceVersion).toBe(2);
    expect(second.invoiceVersion).toBe(3);
    expect(second.totalPaidCents).toBe(2000n);
    expect(second.balanceCents).toBe(0n);
    expect(store.getPayments()).toHaveLength(2);
    expect(store.getInvoice(INVOICE_A)).toMatchObject({
      paidCents: 2000n,
      version: 3,
      dayRevision: 6,
    });
  });
});

describe("idempotency", () => {
  it("replays the original stored receipt without recording another payment", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    const first = await service.recordPayment(
      driverA,
      paymentInput(),
    );
    await service.recordPayment(
      driverA,
      paymentInput({
        amountCents: 1000n,
        expectedInvoiceVersion: 2,
        idempotencyKey: KEY_2,
      }),
    );

    const replay = await service.recordPayment(
      driverA,
      paymentInput(),
    );

    expect(replay).toEqual(first);
    expect(replay.totalPaidCents).toBe(1000n);
    expect(replay.balanceCents).toBe(1000n);
    expect(replay.invoiceVersion).toBe(2);
    expect(store.getPayments()).toHaveLength(2);
  });

  it("rejects the same key with a different amount or version", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    await service.recordPayment(driverA, paymentInput());

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ amountCents: 500n }),
        ),
      "IDEMPOTENCY_KEY_REUSED",
    );
    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ expectedInvoiceVersion: 2 }),
        ),
      "IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("rejects the same key on a different invoice", async () => {
    const store = new MemoryPaymentStore([
      openInvoice(),
      openInvoice({ id: INVOICE_B }),
    ]);
    const service = createService(store);

    await service.recordPayment(driverA, paymentInput());

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ invoiceId: INVOICE_B }),
        ),
      "IDEMPOTENCY_KEY_REUSED",
    );

    expect(store.getPayments()).toHaveLength(1);
    expect(store.getInvoice(INVOICE_B)?.paidCents).toBe(0n);
  });

  it("rechecks access before replaying", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    await service.recordPayment(driverA, paymentInput());

    await expectPaymentRejection(
      () => service.recordPayment(driverB, paymentInput()),
      "FORBIDDEN",
    );
  });

  it("rejects a replay when the invoice no longer exists", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    await service.recordPayment(driverA, paymentInput());
    store.deleteInvoice(INVOICE_A);

    await expectPaymentRejection(
      () => service.recordPayment(driverA, paymentInput()),
      "NOT_FOUND",
    );
  });

  it("returns the stored receipt even after the day closes", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    const first = await service.recordPayment(
      driverA,
      paymentInput(),
    );

    const current = store.getInvoice(INVOICE_A);
    expect(current).toBeDefined();
    store.setInvoice({ ...current!, dayStatus: "CLOSED" });

    const replay = await service.recordPayment(
      driverA,
      paymentInput(),
    );

    expect(replay).toEqual(first);
    expect(replay.totalPaidCents).toBe(1000n);
  });
});

describe("authorization and day state", () => {
  it("rejects a wrong driver", async () => {
    const service = createService(
      new MemoryPaymentStore([openInvoice()]),
    );

    await expectPaymentRejection(
      () => service.recordPayment(driverB, paymentInput()),
      "FORBIDDEN",
    );
  });

  it("rejects an inactive driver", async () => {
    const service = createService(
      new MemoryPaymentStore([openInvoice()]),
    );

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          { ...driverA, active: false },
          paymentInput(),
        ),
      "INACTIVE_ACTOR",
    );
  });

  it("rejects a supervisor and an invalid actor", async () => {
    const service = createService(
      new MemoryPaymentStore([openInvoice()]),
    );

    await expectPaymentRejection(
      () => service.recordPayment(supervisor, paymentInput()),
      "FORBIDDEN",
    );
    await expectPaymentRejection(
      () =>
        service.recordPayment(
          { ...driverA, id: "   " },
          paymentInput(),
        ),
      "INVALID_REQUEST",
    );
  });

  it("rejects a missing invoice", async () => {
    const service = createService(new MemoryPaymentStore());

    await expectPaymentRejection(
      () => service.recordPayment(driverA, paymentInput()),
      "NOT_FOUND",
    );
  });

  it("distinguishes a closed day from a preparing day", async () => {
    const closedService = createService(
      new MemoryPaymentStore([
        openInvoice({ dayStatus: "CLOSED" }),
      ]),
    );
    const preparingService = createService(
      new MemoryPaymentStore([
        openInvoice({ dayStatus: "PREPARING" }),
      ]),
    );

    await expectPaymentRejection(
      () => closedService.recordPayment(driverA, paymentInput()),
      "DAY_CLOSED",
    );
    await expectPaymentRejection(
      () =>
        preparingService.recordPayment(driverA, paymentInput()),
      "DAY_NOT_OPEN",
    );
  });

  it("rejects a stale invoice version", async () => {
    const service = createService(
      new MemoryPaymentStore([openInvoice({ version: 2 })]),
    );

    await expectPaymentRejection(
      () => service.recordPayment(driverA, paymentInput()),
      "STALE_VERSION",
    );
  });
});

describe("amount rules", () => {
  it("rejects payment above the outstanding balance", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ amountCents: 2001n }),
        ),
      "PAYMENT_EXCEEDS_BALANCE",
    );

    expect(store.getPayments()).toHaveLength(0);
  });

  it("rejects a second payment after full payment", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);

    await service.recordPayment(
      driverA,
      paymentInput({ amountCents: 2000n }),
    );

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({
            amountCents: 1n,
            expectedInvoiceVersion: 2,
            idempotencyKey: KEY_2,
          }),
        ),
      "PAYMENT_EXCEEDS_BALANCE",
    );

    expect(store.getPayments()).toHaveLength(1);
  });

  it("rejects a new payment when a correction left an excess", async () => {
    const store = new MemoryPaymentStore([
      openInvoice({ totalCents: 1500n, paidCents: 2000n }),
    ]);
    const service = createService(store);

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ amountCents: 1n }),
        ),
      "PAYMENT_EXCEEDS_BALANCE",
    );

    expect(store.getPayments()).toHaveLength(0);
    expect(store.getInvoice(INVOICE_A)).toMatchObject({
      totalCents: 1500n,
      paidCents: 2000n,
    });
  });

  it("rejects invalid stored invoice amounts", async () => {
    const zeroTotal = createService(
      new MemoryPaymentStore([
        openInvoice({ totalCents: 0n }),
      ]),
    );
    const negativePaid = createService(
      new MemoryPaymentStore([
        openInvoice({ paidCents: -1n }),
      ]),
    );

    await expectPaymentRejection(
      () => zeroTotal.recordPayment(driverA, paymentInput()),
      "INVALID_INVOICE_DATA",
    );
    await expectPaymentRejection(
      () => negativePaid.recordPayment(driverA, paymentInput()),
      "INVALID_INVOICE_DATA",
    );
  });
});

describe("input validation", () => {
  it("rejects invalid invoice IDs, keys and versions", async () => {
    const service = createService(
      new MemoryPaymentStore([openInvoice()]),
    );

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ invoiceId: "not-a-uuid" }),
        ),
      "INVALID_REQUEST",
    );
    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ idempotencyKey: "not-a-uuid" }),
        ),
      "INVALID_IDEMPOTENCY_KEY",
    );
    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ expectedInvoiceVersion: 0 }),
        ),
      "INVALID_VERSION",
    );
    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({ expectedInvoiceVersion: 1.5 }),
        ),
      "INVALID_VERSION",
    );
  });

  it("rejects zero, negative, oversized and non-bigint amounts", async () => {
    const service = createService(
      new MemoryPaymentStore([openInvoice()]),
    );

    for (const amountCents of [
      0n,
      -1n,
      MAX_CENTS + 1n,
    ]) {
      await expectPaymentRejection(
        () =>
          service.recordPayment(
            driverA,
            paymentInput({ amountCents }),
          ),
        "INVALID_AMOUNT",
      );
    }

    await expectPaymentRejection(
      () =>
        service.recordPayment(
          driverA,
          paymentInput({
            amountCents: 1000 as unknown as bigint,
          }),
        ),
      "INVALID_AMOUNT",
    );
  });
});

describe("atomicity and concurrency", () => {
  it("allows only one of two concurrent payments with the same version", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const firstService = createService(store, 0);
    const secondService = createService(store, 100);

    const results = await Promise.allSettled([
      firstService.recordPayment(
        driverA,
        paymentInput({ idempotencyKey: KEY_1 }),
      ),
      secondService.recordPayment(
        driverA,
        paymentInput({ idempotencyKey: KEY_2 }),
      ),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result) => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(PaymentError);
    expect(
      (rejected[0] as PromiseRejectedResult).reason.code,
    ).toBe("STALE_VERSION");
    expect(store.getPayments()).toHaveLength(1);
    expect(store.getInvoice(INVOICE_A)).toMatchObject({
      paidCents: 1000n,
      version: 2,
    });
  });

  it("replays a concurrent request with the same key", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const firstService = createService(store, 0);
    const secondService = createService(store, 100);
    const input = paymentInput();

    const results = await Promise.all([
      firstService.recordPayment(driverA, input),
      secondService.recordPayment(driverA, input),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(store.getPayments()).toHaveLength(1);
  });

  it("rolls back the payment and invoice update when the receipt fails", async () => {
    const store = new MemoryPaymentStore([openInvoice()], {
      failOnOperationInsert: true,
    });
    const service = createService(store);

    await expect(
      service.recordPayment(driverA, paymentInput()),
    ).rejects.toThrow("forced operation failure");

    expect(store.getPayments()).toHaveLength(0);
    expect(store.getInvoice(INVOICE_A)).toMatchObject({
      paidCents: 0n,
      version: 1,
      dayRevision: 4,
    });
    expect(store.getOperations()).toHaveLength(0);
  });
});

describe("serialization and public helpers", () => {
  it("serializes a receipt to JSON-safe strings and back", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = createService(store);
    const receipt = await service.recordPayment(
      driverA,
      paymentInput(),
    );

    const serialized = serializePaymentReceipt(receipt);

    expect(serialized).toEqual({
      paymentId: "payment-1",
      invoiceId: INVOICE_A,
      amountCents: "1000",
      receivedBy: DRIVER_A,
      receivedAt: "2026-11-22T10:00:00.000Z",
      invoiceVersion: 2,
      totalPaidCents: "1000",
      balanceCents: "1000",
    });
    expect(() => JSON.stringify(serialized)).not.toThrow();

    expect(serializePaymentResponse(receipt)).toEqual({
      paymentId: "payment-1",
      amountCents: "1000",
      invoiceVersion: 2,
      totalPaidCents: "1000",
      balanceCents: "1000",
    });

    const deserialized = deserializePaymentReceipt(serialized);
    expect(deserialized).toEqual(receipt);
  });

  it("builds a deterministic request hash", () => {
    const input = paymentInput();
    const hash = buildPaymentRequestHash(input);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildPaymentRequestHash({ ...input })).toBe(hash);
    expect(
      buildPaymentRequestHash({
        ...input,
        amountCents: 500n,
      }),
    ).not.toBe(hash);
    expect(
      buildPaymentRequestHash({
        ...input,
        invoiceId: INVOICE_B,
      }),
    ).not.toBe(hash);
    expect(
      buildPaymentRequestHash({
        ...input,
        expectedInvoiceVersion: 2,
      }),
    ).not.toBe(hash);
  });

  it("supports the convenience wrapper", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const receipt = await recordPayment(
      store,
      driverA,
      paymentInput(),
      {
        now: () => new Date("2026-11-22T10:00:00.000Z"),
        generateId: () => "payment-wrapper",
      },
    );

    expect(receipt.payment.id).toBe("payment-wrapper");
    expect(store.getPayments()).toHaveLength(1);
  });

  it("uses the default clock and ID generator", async () => {
    const store = new MemoryPaymentStore([openInvoice()]);
    const service = new PaymentService(store);

    const receipt = await service.recordPayment(
      driverA,
      paymentInput(),
    );

    expect(receipt.payment.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(receipt.payment.receivedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("exposes stable error codes and HTTP statuses", () => {
    expect(new PaymentError("NOT_FOUND", "x").httpStatus).toBe(404);
    expect(new PaymentError("DAY_CLOSED", "x").httpStatus).toBe(
      409,
    );
    expect(new PaymentError("INVALID_AMOUNT", "x").httpStatus).toBe(
      422,
    );
    expect(new PaymentError("INVALID_INVOICE_DATA", "x").httpStatus).toBe(
      500,
    );
    expect(isPaymentError(new PaymentError("FORBIDDEN", "x"))).toBe(
      true,
    );
    expect(isPaymentError(new Error("other"))).toBe(false);
  });
});
