import {
  MAX_CENTS,
  MONEY_ERROR_CODES,
  MoneyError,
  assertCents,
  formatCents,
  lineAmountCents,
} from "./cents";

export interface InvoiceLineAmount {
  readonly quantity: number;
  readonly unitPriceCents: bigint;
}

export interface InvoiceAmounts {
  readonly totalCents: bigint;
  readonly paidCents: bigint;
}

export const PAYMENT_STATUSES = [
  "UNPAID",
  "PARTIAL",
  "PAID",
  "EXCESS_REVIEW",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface InvoiceSettlement {
  readonly totalCents: bigint;
  readonly paidCents: bigint;
  /** Signed invoice balance: total minus payments. */
  readonly balanceCents: bigint;
  /** max(balance, 0) */
  readonly outstandingCents: bigint;
  /** max(-balance, 0) */
  readonly excessPaymentCents: bigint;
  readonly reviewRequired: boolean;
  readonly status: PaymentStatus;
}

export interface SerializedInvoiceSettlement {
  readonly totalCents: string;
  readonly paidCents: string;
  readonly balanceCents: string;
  readonly outstandingCents: string;
  readonly excessPaymentCents: string;
  readonly reviewRequired: boolean;
  readonly status: PaymentStatus;
}

export interface CustomerAccountSummary {
  readonly openingBalanceCents: bigint;
  readonly invoiceTotalCents: bigint;
  readonly paidCents: bigint;
  /** Opening balance plus all invoice totals minus all payments. */
  readonly signedBalanceCents: bigint;
  /** Sum of max(total - paid, 0) per invoice. */
  readonly invoiceOutstandingTotalCents: bigint;
  /** Sum of max(paid - total, 0) per invoice. */
  readonly excessPendingReviewTotalCents: bigint;
  readonly reviewRequired: boolean;
}

export interface SerializedCustomerAccountSummary {
  readonly openingBalanceCents: string;
  readonly invoiceTotalCents: string;
  readonly paidCents: string;
  readonly signedBalanceCents: string;
  readonly invoiceOutstandingTotalCents: string;
  readonly excessPendingReviewTotalCents: string;
  readonly reviewRequired: boolean;
}

export interface InvoicePaymentAmount {
  readonly invoiceId: string;
  readonly amountCents: bigint;
}

/**
 * Sum quantity times the stored unit price for every invoice line.
 * Each stored price is a snapshot, so later catalog changes do not apply.
 *
 * A posted invoice must contain at least one line.
 */
export function invoiceTotalCents(
  lines: readonly InvoiceLineAmount[],
): bigint {
  if (lines.length === 0) {
    throw new MoneyError(
      MONEY_ERROR_CODES.INVOICE_HAS_NO_LINES,
      "An invoice must contain at least one line.",
    );
  }

  let total = 0n;

  for (const line of lines) {
    total += lineAmountCents(line.quantity, line.unitPriceCents);
  }

  if (total > MAX_CENTS) {
    throw new MoneyError(
      MONEY_ERROR_CODES.AMOUNT_OVERFLOW,
      "Invoice total exceeds the supported maximum.",
    );
  }

  return total;
}

/** Signed invoice balance: invoice total minus recorded payments. */
export function invoiceBalanceCents(
  totalCents: bigint,
  paidCents: bigint,
): bigint {
  assertInvoiceAmounts(totalCents, paidCents);
  return totalCents - paidCents;
}

/** Invoice outstanding amount: max(total - paid, 0). */
export function invoiceOutstandingCents(
  totalCents: bigint,
  paidCents: bigint,
): bigint {
  const balance = invoiceBalanceCents(totalCents, paidCents);
  return balance > 0n ? balance : 0n;
}

/** Excess payment: max(paid - total, 0). Never treated as credit. */
export function excessPaymentCents(
  totalCents: bigint,
  paidCents: bigint,
): bigint {
  const balance = invoiceBalanceCents(totalCents, paidCents);
  return balance < 0n ? -balance : 0n;
}

/** True when recorded payments exceed the corrected invoice total. */
export function reviewRequired(
  totalCents: bigint,
  paidCents: bigint,
): boolean {
  return invoiceBalanceCents(totalCents, paidCents) < 0n;
}

/** Derived payment status for an invoice. */
export function paymentStatus(
  totalCents: bigint,
  paidCents: bigint,
): PaymentStatus {
  return statusFromBalance(
    invoiceBalanceCents(totalCents, paidCents),
    paidCents,
  );
}

/** All derived invoice amounts in one consistent calculation. */
export function settleInvoice(
  totalCents: bigint,
  paidCents: bigint,
): InvoiceSettlement {
  const balanceCents = invoiceBalanceCents(totalCents, paidCents);
  const outstandingCents = balanceCents > 0n ? balanceCents : 0n;
  const excessPayment = balanceCents < 0n ? -balanceCents : 0n;

  return {
    totalCents,
    paidCents,
    balanceCents,
    outstandingCents,
    excessPaymentCents: excessPayment,
    reviewRequired: excessPayment > 0n,
    status: statusFromBalance(balanceCents, paidCents),
  };
}

/** Convert an invoice settlement to JSON-safe decimal strings. */
export function serializeInvoiceSettlement(
  settlement: InvoiceSettlement,
): SerializedInvoiceSettlement {
  return {
    totalCents: formatCents(settlement.totalCents),
    paidCents: formatCents(settlement.paidCents),
    balanceCents: formatCents(settlement.balanceCents),
    outstandingCents: formatCents(settlement.outstandingCents),
    excessPaymentCents: formatCents(
      settlement.excessPaymentCents,
    ),
    reviewRequired: settlement.reviewRequired,
    status: settlement.status,
  };
}

/**
 * Calculate the customer account snapshot.
 *
 * Callers must aggregate each invoice's lines and payments separately before
 * passing them here. Joining invoice lines and payments in one query would
 * multiply their amounts. Use `aggregatePaymentsByInvoice` when starting from
 * a flat payment list.
 *
 * A negative signed balance is excess pending review. It is never allocated
 * to opening debt or another invoice.
 */
export function summarizeCustomerAccount(
  openingBalanceCents: bigint,
  invoices: readonly InvoiceAmounts[],
): CustomerAccountSummary {
  assertCents(
    openingBalanceCents,
    0n,
    MAX_CENTS,
    "Opening balance",
  );

  let invoiceTotalCents = 0n;
  let paidCents = 0n;
  let invoiceOutstandingTotalCents = 0n;
  let excessPendingReviewTotalCents = 0n;

  for (const invoice of invoices) {
    const settlement = settleInvoice(
      invoice.totalCents,
      invoice.paidCents,
    );

    invoiceTotalCents += settlement.totalCents;
    paidCents += settlement.paidCents;
    invoiceOutstandingTotalCents += settlement.outstandingCents;
    excessPendingReviewTotalCents += settlement.excessPaymentCents;
  }

  return {
    openingBalanceCents,
    invoiceTotalCents,
    paidCents,
    signedBalanceCents:
      openingBalanceCents + invoiceTotalCents - paidCents,
    invoiceOutstandingTotalCents,
    excessPendingReviewTotalCents,
    reviewRequired: excessPendingReviewTotalCents > 0n,
  };
}

/** Convert a customer account summary to JSON-safe decimal strings. */
export function serializeCustomerAccountSummary(
  summary: CustomerAccountSummary,
): SerializedCustomerAccountSummary {
  return {
    openingBalanceCents: formatCents(summary.openingBalanceCents),
    invoiceTotalCents: formatCents(summary.invoiceTotalCents),
    paidCents: formatCents(summary.paidCents),
    signedBalanceCents: formatCents(summary.signedBalanceCents),
    invoiceOutstandingTotalCents: formatCents(
      summary.invoiceOutstandingTotalCents,
    ),
    excessPendingReviewTotalCents: formatCents(
      summary.excessPendingReviewTotalCents,
    ),
    reviewRequired: summary.reviewRequired,
  };
}

/**
 * Group a flat payment list by invoice before joining with invoice totals.
 * This prevents one invoice line from multiplying its payments.
 */
export function aggregatePaymentsByInvoice(
  payments: readonly InvoicePaymentAmount[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();

  for (const payment of payments) {
    assertCents(
      payment.amountCents,
      1n,
      MAX_CENTS,
      "Payment amount",
    );

    totals.set(
      payment.invoiceId,
      (totals.get(payment.invoiceId) ?? 0n) + payment.amountCents,
    );
  }

  return totals;
}

/** Expected cash for a van day: the sum of payments collected that day. */
export function expectedDayCashCents(
  payments: Iterable<bigint>,
): bigint {
  let total = 0n;

  for (const amount of payments) {
    assertCents(amount, 1n, MAX_CENTS, "Payment amount");
    total += amount;
  }

  return total;
}

function statusFromBalance(
  balanceCents: bigint,
  paidCents: bigint,
): PaymentStatus {
  if (balanceCents > 0n) {
    return paidCents === 0n ? "UNPAID" : "PARTIAL";
  }

  return balanceCents < 0n ? "EXCESS_REVIEW" : "PAID";
}

function assertInvoiceAmounts(
  totalCents: bigint,
  paidCents: bigint,
): void {
  assertCents(totalCents, 1n, MAX_CENTS, "Invoice total");
  assertCents(paidCents, 0n, MAX_CENTS, "Paid amount");
}
