import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  MAX_CENTS,
  MIN_PAYMENT_CENTS,
  assertCents,
  formatCents,
  invoiceBalanceCents,
  parseCentsString,
  settleInvoice,
} from "../money";

export type StaffRole = "DRIVER" | "SUPERVISOR";
export type VanDayStatus = "PREPARING" | "OPEN" | "CLOSED";

export interface PaymentActor {
  readonly id: string;
  readonly role: StaffRole;
  readonly active: boolean;
}

export interface PaymentInvoice {
  readonly id: string;
  readonly version: number;
  readonly totalCents: bigint;
  readonly paidCents: bigint;
  readonly dayId: string;
  readonly dayStatus: VanDayStatus;
  readonly assignedDriverId: string;
  readonly dayRevision: number;
}

/** Immutable cash record. Only `payments` table fields belong here. */
export interface PaymentRecord {
  readonly id: string;
  readonly invoiceId: string;
  readonly amountCents: bigint;
  readonly receivedBy: string;
  readonly receivedAt: string;
}

export interface RecordPaymentInput {
  readonly invoiceId: string;
  readonly amountCents: bigint;
  readonly expectedInvoiceVersion: number;
  readonly idempotencyKey: string;
}

export interface PaymentReceipt {
  readonly payment: PaymentRecord;
  readonly invoiceVersion: number;
  readonly totalPaidCents: bigint;
  readonly balanceCents: bigint;
}

/** JSON-safe receipt stored in the idempotency operation. */
export interface SerializedPaymentReceipt {
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly amountCents: string;
  readonly receivedBy: string;
  readonly receivedAt: string;
  readonly invoiceVersion: number;
  readonly totalPaidCents: string;
  readonly balanceCents: string;
}

export interface PaymentOperation {
  readonly actorId: string;
  readonly requestKey: string;
  readonly methodRoute: string;
  readonly requestHash: string;
  readonly httpStatus: 201;
  readonly response: SerializedPaymentReceipt;
  readonly createdAt: string;
}

export interface UpdateInvoiceAfterPayment {
  readonly invoiceId: string;
  readonly expectedVersion: number;
  readonly totalPaidCents: bigint;
  readonly nextVersion: number;
  readonly nextDayRevision: number;
}

/**
 * All methods run inside the transaction opened by `PaymentStore.transaction`.
 *
 * A database adapter must:
 * - lock the van day and invoice rows in `findInvoiceForUpdate`;
 * - derive the assigned driver and day state from the database;
 * - reject `updateInvoiceAfterPayment` when the current version differs;
 * - enforce unique (actorId, requestKey) in `insertOperation`;
 * - retry and replay when a concurrent insert wins the unique race.
 */
export interface PaymentTransaction {
  findOperation(
    actorId: string,
    requestKey: string,
  ): Promise<PaymentOperation | undefined>;

  findInvoiceForUpdate(
    invoiceId: string,
  ): Promise<PaymentInvoice | undefined>;

  insertPayment(payment: PaymentRecord): Promise<void>;

  updateInvoiceAfterPayment(
    update: UpdateInvoiceAfterPayment,
  ): Promise<void>;

  insertOperation(operation: PaymentOperation): Promise<void>;
}

/**
 * Transaction boundary for payment writes.
 *
 * The adapter must make the callback atomic and serialize concurrent writes
 * that target the same van day or the same actor/request key. A PostgreSQL
 * adapter can implement this with BEGIN/COMMIT plus SELECT ... FOR UPDATE and
 * the operations unique constraint.
 */
export interface PaymentStore {
  transaction<T>(
    fn: (tx: PaymentTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PaymentServiceDependencies {
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export const PAYMENT_METHOD_ROUTE =
  "POST /api/invoices/{id}/payments";

export type PaymentErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_VERSION"
  | "INVALID_AMOUNT"
  | "INVALID_INVOICE_DATA"
  | "INACTIVE_ACTOR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DAY_NOT_OPEN"
  | "DAY_CLOSED"
  | "STALE_VERSION"
  | "PAYMENT_EXCEEDS_BALANCE"
  | "IDEMPOTENCY_KEY_REUSED";

export const PAYMENT_ERROR_STATUS: Record<PaymentErrorCode, number> = {
  INVALID_REQUEST: 422,
  INVALID_IDEMPOTENCY_KEY: 422,
  INVALID_VERSION: 422,
  INVALID_AMOUNT: 422,
  INVALID_INVOICE_DATA: 500,
  INACTIVE_ACTOR: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DAY_NOT_OPEN: 409,
  DAY_CLOSED: 409,
  STALE_VERSION: 409,
  PAYMENT_EXCEEDS_BALANCE: 422,
  IDEMPOTENCY_KEY_REUSED: 409,
};

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;

  constructor(code: PaymentErrorCode, message: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }

  get httpStatus(): number {
    return PAYMENT_ERROR_STATUS[this.code];
  }
}

/** Narrow an unknown error to a domain payment error. */
export function isPaymentError(
  error: unknown,
): error is PaymentError {
  return error instanceof PaymentError;
}

const UUID_SCHEMA = z.uuid();

/**
 * Canonical request fingerprint for idempotency comparison.
 * The field order is fixed so the same request always hashes identically.
 */
export function buildPaymentRequestHash(
  input: RecordPaymentInput,
): string {
  const canonical = JSON.stringify({
    invoiceId: input.invoiceId,
    amountCents: formatCents(input.amountCents),
    expectedInvoiceVersion: input.expectedInvoiceVersion,
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Exact API-10 success body. */
export interface PaymentResponse {
  readonly paymentId: string;
  readonly amountCents: string;
  readonly invoiceVersion: number;
  readonly totalPaidCents: string;
  readonly balanceCents: string;
}

/** Convert a payment receipt to the exact API-10 response body. */
export function serializePaymentResponse(
  receipt: PaymentReceipt,
): PaymentResponse {
  return {
    paymentId: receipt.payment.id,
    amountCents: formatCents(receipt.payment.amountCents),
    invoiceVersion: receipt.invoiceVersion,
    totalPaidCents: formatCents(receipt.totalPaidCents),
    balanceCents: formatCents(receipt.balanceCents),
  };
}

/** Convert a payment receipt to the JSON-safe stored operation receipt. */
export function serializePaymentReceipt(
  receipt: PaymentReceipt,
): SerializedPaymentReceipt {
  return {
    paymentId: receipt.payment.id,
    invoiceId: receipt.payment.invoiceId,
    amountCents: formatCents(receipt.payment.amountCents),
    receivedBy: receipt.payment.receivedBy,
    receivedAt: receipt.payment.receivedAt,
    invoiceVersion: receipt.invoiceVersion,
    totalPaidCents: formatCents(receipt.totalPaidCents),
    balanceCents: formatCents(receipt.balanceCents),
  };
}

/** Rebuild a payment receipt from its stored JSON-safe form. */
export function deserializePaymentReceipt(
  serialized: SerializedPaymentReceipt,
): PaymentReceipt {
  return {
    payment: {
      id: serialized.paymentId,
      invoiceId: serialized.invoiceId,
      amountCents: parseCentsString(serialized.amountCents),
      receivedBy: serialized.receivedBy,
      receivedAt: serialized.receivedAt,
    },
    invoiceVersion: serialized.invoiceVersion,
    totalPaidCents: parseCentsString(serialized.totalPaidCents),
    balanceCents: parseCentsString(serialized.balanceCents),
  };
}

/**
 * Pure API-10 settlement rule. It permits only a positive outstanding
 * balance and never permits a payment to create a credit.
 */
export function calculatePaymentSettlement(
  totalCents: bigint,
  paidCents: bigint,
  amountCents: bigint,
): {
  totalPaidCents: bigint;
  balanceCents: bigint;
} {
  assertCents(totalCents, 1n, MAX_CENTS, "Invoice total");
  assertCents(paidCents, 0n, MAX_CENTS, "Paid amount");
  assertCents(
    amountCents,
    MIN_PAYMENT_CENTS,
    MAX_CENTS,
    "Payment amount",
  );

  const outstandingCents = settleInvoice(
    totalCents,
    paidCents,
  ).outstandingCents;

  if (amountCents > outstandingCents) {
    throw new PaymentError(
      "PAYMENT_EXCEEDS_BALANCE",
      "Payment amount must not exceed the current positive invoice balance.",
    );
  }

  const totalPaidCents = paidCents + amountCents;

  return {
    totalPaidCents,
    balanceCents: invoiceBalanceCents(
      totalCents,
      totalPaidCents,
    ),
  };
}

export function assertPaymentDayOpen(status: VanDayStatus): void {
  if (status === "CLOSED") {
    throw new PaymentError("DAY_CLOSED", "Payments require an OPEN van day.");
  }

  if (status !== "OPEN") {
    throw new PaymentError("DAY_NOT_OPEN", "The van day is still being prepared.");
  }
}

export function createPaymentReceipt(
  invoice: Pick<PaymentInvoice, "id" | "version" | "totalCents" | "paidCents">,
  input: Pick<RecordPaymentInput, "amountCents" | "expectedInvoiceVersion">,
  receivedBy: string,
  { now = () => new Date(), generateId = randomUUID }: PaymentServiceDependencies = {},
): PaymentReceipt {
  if (invoice.version !== input.expectedInvoiceVersion) {
    throw new PaymentError("STALE_VERSION", "This invoice changed. Refresh it before paying.");
  }

  if (
    invoice.totalCents < 1n ||
    invoice.totalCents > MAX_CENTS ||
    invoice.paidCents < 0n ||
    invoice.paidCents > MAX_CENTS
  ) {
    throw new PaymentError("INVALID_INVOICE_DATA", "Stored invoice amounts are invalid.");
  }

  return {
    ...calculatePaymentSettlement(invoice.totalCents, invoice.paidCents, input.amountCents),
    invoiceVersion: invoice.version + 1,
    payment: {
      id: generateId(),
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      receivedBy,
      receivedAt: now().toISOString(),
    },
  };
}

/**
 * Framework-agnostic reference implementation of the API-10 rules.
 *
 * The live HTTP route uses `recordInvoicePayment` in `postgres-payment.ts`
 * with the shared `runVanDayOperation` helper. This class remains useful for
 * unit-testing the domain flow against a `PaymentStore`; both paths share the
 * pure helpers in this module so the rules stay identical.
 */
export class PaymentService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(
    private readonly store: PaymentStore,
    dependencies: PaymentServiceDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.generateId = dependencies.generateId ?? randomUUID;
  }

  async recordPayment(
    actor: PaymentActor,
    input: RecordPaymentInput,
  ): Promise<PaymentReceipt> {
    this.validateActor(actor);
    this.validateInput(input);

    const requestHash = buildPaymentRequestHash(input);

    return this.store.transaction(async (tx) => {
      // Lock the day and invoice first, as required for financial writes.
      // A concurrent same-key request then waits here and sees the committed
      // operation receipt instead of racing the first lookup.
      const invoice = await tx.findInvoiceForUpdate(
        input.invoiceId,
      );

      const existing = await tx.findOperation(
        actor.id,
        input.idempotencyKey,
      );

      if (existing) {
        return this.replayOperation(
          tx,
          actor,
          existing,
          requestHash,
        );
      }

      if (!invoice) {
        throw new PaymentError(
          "NOT_FOUND",
          "Invoice was not found.",
        );
      }

      this.assertAssignedDriver(actor, invoice);
      assertPaymentDayOpen(invoice.dayStatus);
      const receipt = createPaymentReceipt(invoice, input, actor.id, {
        now: this.now,
        generateId: this.generateId,
      });

      await tx.insertPayment(receipt.payment);
      await tx.updateInvoiceAfterPayment({
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        totalPaidCents: receipt.totalPaidCents,
        nextVersion: receipt.invoiceVersion,
        nextDayRevision: invoice.dayRevision + 1,
      });
      await tx.insertOperation({
        actorId: actor.id,
        requestKey: input.idempotencyKey,
        methodRoute: PAYMENT_METHOD_ROUTE,
        requestHash,
        httpStatus: 201,
        response: serializePaymentReceipt(receipt),
        createdAt: this.now().toISOString(),
      });

      return receipt;
    });
  }

  private async replayOperation(
    tx: PaymentTransaction,
    actor: PaymentActor,
    operation: PaymentOperation,
    requestHash: string,
  ): Promise<PaymentReceipt> {
    if (
      operation.methodRoute !== PAYMENT_METHOD_ROUTE ||
      operation.requestHash !== requestHash
    ) {
      throw new PaymentError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used with a different request.",
      );
    }

    // Recheck current access, but return the stored result even if the
    // invoice or day changed after the original payment.
    const invoice = await tx.findInvoiceForUpdate(
      operation.response.invoiceId,
    );

    if (!invoice) {
      throw new PaymentError(
        "NOT_FOUND",
        "Invoice was not found.",
      );
    }

    this.assertAssignedDriver(actor, invoice);
    return deserializePaymentReceipt(operation.response);
  }

  private validateActor(actor: PaymentActor): void {
    if (
      typeof actor?.id !== "string" ||
      actor.id.trim().length === 0
    ) {
      throw new PaymentError(
        "INVALID_REQUEST",
        "A staff actor is required.",
      );
    }

    if (actor.active !== true) {
      throw new PaymentError(
        "INACTIVE_ACTOR",
        "This staff profile is inactive.",
      );
    }

    if (actor.role !== "DRIVER") {
      throw new PaymentError(
        "FORBIDDEN",
        "Only a driver may record a payment.",
      );
    }
  }

  private validateInput(input: RecordPaymentInput): void {
    assertUuid(
      input.invoiceId,
      "INVALID_REQUEST",
      "Invoice ID",
    );
    assertUuid(
      input.idempotencyKey,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key",
    );

    if (
      !Number.isInteger(input.expectedInvoiceVersion) ||
      input.expectedInvoiceVersion < 1
    ) {
      throw new PaymentError(
        "INVALID_VERSION",
        "Expected invoice version must be a positive integer.",
      );
    }

    if (
      typeof input.amountCents !== "bigint" ||
      input.amountCents < MIN_PAYMENT_CENTS ||
      input.amountCents > MAX_CENTS
    ) {
      throw new PaymentError(
        "INVALID_AMOUNT",
        "Payment amount must be a positive whole number of cents.",
      );
    }
  }

  private assertAssignedDriver(
    actor: PaymentActor,
    invoice: PaymentInvoice,
  ): void {
    if (
      actor.role !== "DRIVER" ||
      actor.id !== invoice.assignedDriverId
    ) {
      throw new PaymentError(
        "FORBIDDEN",
        "Only the assigned driver may record this payment.",
      );
    }
  }
}

/** Convenience wrapper. The store's transaction still enforces atomicity. */
export async function recordPayment(
  store: PaymentStore,
  actor: PaymentActor,
  input: RecordPaymentInput,
  dependencies: PaymentServiceDependencies = {},
): Promise<PaymentReceipt> {
  return new PaymentService(store, dependencies).recordPayment(
    actor,
    input,
  );
}

function assertUuid(
  value: string,
  code: PaymentErrorCode,
  label: string,
): void {
  if (
    typeof value !== "string" ||
    !UUID_SCHEMA.safeParse(value).success
  ) {
    throw new PaymentError(
      code,
      `${label} must be a valid UUID.`,
    );
  }
}
