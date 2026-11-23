import { describe, expect, it } from "vitest";

import {
  MAX_CENTS,
  MAX_PRODUCT_PRICE_CENTS,
  MAX_QUANTITY,
  MONEY_ERROR_CODES,
} from "./cents";
import {
  PAYMENT_STATUSES,
  aggregatePaymentsByInvoice,
  excessPaymentCents,
  expectedDayCashCents,
  invoiceBalanceCents,
  invoiceOutstandingCents,
  invoiceTotalCents,
  paymentStatus,
  reviewRequired,
  serializeCustomerAccountSummary,
  serializeInvoiceSettlement,
  settleInvoice,
  summarizeCustomerAccount,
} from "./invoice";
import { expectMoneyError } from "./test-utils";

describe("invoiceTotalCents", () => {
  it("sums quantity times the stored unit price", () => {
    expect(
      invoiceTotalCents([{ quantity: 20, unitPriceCents: 100n }]),
    ).toBe(2000n);
    expect(
      invoiceTotalCents([
        { quantity: 2, unitPriceCents: 150n },
        { quantity: 3, unitPriceCents: 250n },
      ]),
    ).toBe(1050n);
  });

  it("rejects an invoice with no lines", () => {
    expectMoneyError(
      () => invoiceTotalCents([]),
      MONEY_ERROR_CODES.INVOICE_HAS_NO_LINES,
    );
  });

  it("accepts exactly the maximum invoice total", () => {
    const maxLine = {
      quantity: MAX_QUANTITY,
      unitPriceCents: MAX_PRODUCT_PRICE_CENTS,
    };
    const lines = Array.from({ length: 50 }, () => maxLine);

    expect(invoiceTotalCents(lines)).toBe(MAX_CENTS);
  });

  it("rejects totals above the supported maximum", () => {
    const maxLine = {
      quantity: MAX_QUANTITY,
      unitPriceCents: MAX_PRODUCT_PRICE_CENTS,
    };
    const lines = Array.from({ length: 51 }, () => maxLine);

    expectMoneyError(
      () => invoiceTotalCents(lines),
      MONEY_ERROR_CODES.AMOUNT_OVERFLOW,
    );
  });

  it("rejects an invalid line", () => {
    expectMoneyError(
      () => invoiceTotalCents([{ quantity: 0, unitPriceCents: 100n }]),
      MONEY_ERROR_CODES.INVALID_QUANTITY,
    );
  });
});

describe("invoice balance formulas", () => {
  it("returns a signed balance of total minus payments", () => {
    expect(invoiceBalanceCents(2000n, 1500n)).toBe(500n);
    expect(invoiceBalanceCents(2000n, 2000n)).toBe(0n);
    expect(invoiceBalanceCents(1500n, 2000n)).toBe(-500n);
  });

  it("returns outstanding and excess as non-negative counterparts", () => {
    expect(invoiceOutstandingCents(2000n, 1500n)).toBe(500n);
    expect(excessPaymentCents(2000n, 1500n)).toBe(0n);
    expect(invoiceOutstandingCents(1500n, 2000n)).toBe(0n);
    expect(excessPaymentCents(1500n, 2000n)).toBe(500n);
  });

  it("reports whether a review is required", () => {
    expect(reviewRequired(2000n, 1500n)).toBe(false);
    expect(reviewRequired(2000n, 2000n)).toBe(false);
    expect(reviewRequired(1500n, 2000n)).toBe(true);
  });

  it("derives every payment status from the signed balance", () => {
    expect(PAYMENT_STATUSES).toEqual([
      "UNPAID",
      "PARTIAL",
      "PAID",
      "EXCESS_REVIEW",
    ]);
    expect(paymentStatus(2000n, 0n)).toBe("UNPAID");
    expect(paymentStatus(2000n, 1500n)).toBe("PARTIAL");
    expect(paymentStatus(2000n, 2000n)).toBe("PAID");
    expect(paymentStatus(1500n, 2000n)).toBe("EXCESS_REVIEW");
  });

  it("rejects zero, negative or out-of-range amounts", () => {
    expectMoneyError(
      () => invoiceBalanceCents(0n, 0n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => invoiceBalanceCents(-1n, 0n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => invoiceBalanceCents(2000n, -1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => invoiceBalanceCents(MAX_CENTS + 1n, 0n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => invoiceBalanceCents(2000n, MAX_CENTS + 1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });
});

describe("settleInvoice", () => {
  it("reports the main PRD correction example", () => {
    expect(settleInvoice(1500n, 1500n)).toEqual({
      totalCents: 1500n,
      paidCents: 1500n,
      balanceCents: 0n,
      outstandingCents: 0n,
      excessPaymentCents: 0n,
      reviewRequired: false,
      status: "PAID",
    });
  });

  it("flags the excess when a correction drops the total below payments", () => {
    expect(settleInvoice(1500n, 2000n)).toEqual({
      totalCents: 1500n,
      paidCents: 2000n,
      balanceCents: -500n,
      outstandingCents: 0n,
      excessPaymentCents: 500n,
      reviewRequired: true,
      status: "EXCESS_REVIEW",
    });
  });

  it("serializes every amount as a decimal string", () => {
    const serialized = serializeInvoiceSettlement(
      settleInvoice(1500n, 2000n),
    );

    expect(serialized).toEqual({
      totalCents: "1500",
      paidCents: "2000",
      balanceCents: "-500",
      outstandingCents: "0",
      excessPaymentCents: "500",
      reviewRequired: true,
      status: "EXCESS_REVIEW",
    });
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });
});

describe("summarizeCustomerAccount", () => {
  it("matches the PRD opening-balance and multiple-payment checkpoints", () => {
    const opening = summarizeCustomerAccount(3000n, []);
    expect(opening.signedBalanceCents).toBe(3000n);
    expect(opening.invoiceOutstandingTotalCents).toBe(0n);
    expect(opening.excessPendingReviewTotalCents).toBe(0n);

    const afterInvoice = summarizeCustomerAccount(3000n, [
      { totalCents: 2000n, paidCents: 0n },
    ]);
    expect(afterInvoice.signedBalanceCents).toBe(5000n);
    expect(afterInvoice.invoiceOutstandingTotalCents).toBe(2000n);

    const afterFirstPayment = summarizeCustomerAccount(3000n, [
      { totalCents: 2000n, paidCents: 1000n },
    ]);
    expect(afterFirstPayment.signedBalanceCents).toBe(4000n);
    expect(afterFirstPayment.invoiceOutstandingTotalCents).toBe(
      1000n,
    );

    const afterSecondPayment = summarizeCustomerAccount(3000n, [
      { totalCents: 2000n, paidCents: 2000n },
    ]);
    expect(afterSecondPayment.signedBalanceCents).toBe(3000n);
    expect(
      afterSecondPayment.invoiceOutstandingTotalCents,
    ).toBe(0n);
  });

  it("keeps opening debt separate from invoice outstanding and excess", () => {
    const summary = summarizeCustomerAccount(3000n, [
      { totalCents: 1500n, paidCents: 2000n },
    ]);

    expect(summary.signedBalanceCents).toBe(2500n);
    expect(summary.invoiceOutstandingTotalCents).toBe(0n);
    expect(summary.excessPendingReviewTotalCents).toBe(500n);
    expect(summary.reviewRequired).toBe(true);
  });

  it("sums each invoice independently without multiplying amounts", () => {
    const summary = summarizeCustomerAccount(0n, [
      { totalCents: 2000n, paidCents: 2000n },
      { totalCents: 3000n, paidCents: 1000n },
    ]);

    expect(summary.invoiceTotalCents).toBe(5000n);
    expect(summary.paidCents).toBe(3000n);
    expect(summary.signedBalanceCents).toBe(2000n);
    expect(summary.invoiceOutstandingTotalCents).toBe(2000n);
    expect(summary.excessPendingReviewTotalCents).toBe(0n);
    expect(summary.reviewRequired).toBe(false);
  });

  it("allows aggregate balances above the per-record maximum", () => {
    const summary = summarizeCustomerAccount(MAX_CENTS, [
      { totalCents: MAX_CENTS, paidCents: 0n },
      { totalCents: MAX_CENTS, paidCents: 0n },
    ]);

    expect(summary.signedBalanceCents).toBe(MAX_CENTS * 3n);
    expect(summary.invoiceOutstandingTotalCents).toBe(
      MAX_CENTS * 2n,
    );
  });

  it("rejects an invalid opening balance or invoice amount", () => {
    expectMoneyError(
      () => summarizeCustomerAccount(-1n, []),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () =>
        summarizeCustomerAccount(0n, [
          { totalCents: 0n, paidCents: 0n },
        ]),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });

  it("serializes every amount as a decimal string", () => {
    const serialized = serializeCustomerAccountSummary(
      summarizeCustomerAccount(3000n, [
        { totalCents: 2000n, paidCents: 1000n },
      ]),
    );

    expect(serialized).toEqual({
      openingBalanceCents: "3000",
      invoiceTotalCents: "2000",
      paidCents: "1000",
      signedBalanceCents: "4000",
      invoiceOutstandingTotalCents: "1000",
      excessPendingReviewTotalCents: "0",
      reviewRequired: false,
    });
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });
});

describe("aggregatePaymentsByInvoice", () => {
  it("returns an empty map when there are no payments", () => {
    expect(aggregatePaymentsByInvoice([]).size).toBe(0);
  });

  it("sums multiple payments per invoice without multiplying them", () => {
    const totals = aggregatePaymentsByInvoice([
      { invoiceId: "invoice-a", amountCents: 1000n },
      { invoiceId: "invoice-b", amountCents: 2000n },
      { invoiceId: "invoice-a", amountCents: 500n },
    ]);

    expect(totals.get("invoice-a")).toBe(1500n);
    expect(totals.get("invoice-b")).toBe(2000n);
  });

  it("rejects non-positive or out-of-range payment amounts", () => {
    expectMoneyError(
      () =>
        aggregatePaymentsByInvoice([
          { invoiceId: "invoice-a", amountCents: 0n },
        ]),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () =>
        aggregatePaymentsByInvoice([
          {
            invoiceId: "invoice-a",
            amountCents: MAX_CENTS + 1n,
          },
        ]),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });
});

describe("expectedDayCashCents", () => {
  it("sums the payments collected on the day", () => {
    expect(expectedDayCashCents([])).toBe(0n);
    expect(expectedDayCashCents([1500n, 1000n])).toBe(2500n);
  });

  it("rejects non-positive or out-of-range payment amounts", () => {
    expectMoneyError(
      () => expectedDayCashCents([0n]),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => expectedDayCashCents([-1n]),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => expectedDayCashCents([MAX_CENTS + 1n]),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });
});
