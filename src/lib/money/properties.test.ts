import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MAX_CENTS,
  MAX_PRODUCT_PRICE_CENTS,
  MAX_QUANTITY,
  formatCents,
  lineAmountCents,
  parseCentsString,
  sumCents,
} from "./cents";
import {
  aggregatePaymentsByInvoice,
  excessPaymentCents,
  invoiceBalanceCents,
  invoiceOutstandingCents,
  invoiceTotalCents,
  paymentStatus,
  settleInvoice,
} from "./invoice";
import { calculatePaymentSettlement } from "../payments/payment";

const cents = fc.bigInt({ min: 0n, max: MAX_CENTS });
const positiveCents = fc.bigInt({ min: 1n, max: MAX_CENTS });
const quantity = fc.integer({ min: 1, max: MAX_QUANTITY });
const unitPrice = fc.bigInt({
  min: 1n,
  max: MAX_PRODUCT_PRICE_CENTS,
});

describe("money properties", () => {
  it("round-trips signed cents through canonical strings", () => {
    fc.assert(
      fc.property(cents, (value) => {
        expect(parseCentsString(formatCents(value))).toBe(value);
        expect(parseCentsString(formatCents(-value))).toBe(-value);
      }),
    );
  });

  it("keeps outstanding and excess mutually exclusive", () => {
    fc.assert(
      fc.property(positiveCents, cents, (total, paid) => {
        const balance = invoiceBalanceCents(total, paid);
        const outstanding = invoiceOutstandingCents(total, paid);
        const excess = excessPaymentCents(total, paid);

        expect(balance).toBe(total - paid);
        expect(outstanding).toBe(balance > 0n ? balance : 0n);
        expect(excess).toBe(balance < 0n ? -balance : 0n);
        expect(outstanding * excess).toBe(0n);
      }),
    );
  });

  it("keeps settlement fields internally consistent", () => {
    fc.assert(
      fc.property(positiveCents, cents, (total, paid) => {
        const settlement = settleInvoice(total, paid);

        expect(settlement.paidCents + settlement.balanceCents).toBe(
          total,
        );
        expect(settlement.reviewRequired).toBe(
          settlement.excessPaymentCents > 0n,
        );
        expect(settlement.status).toBe(paymentStatus(total, paid));
      }),
    );
  });

  it("computes line amounts as exact integer multiplication", () => {
    fc.assert(
      fc.property(quantity, unitPrice, (units, price) => {
        expect(lineAmountCents(units, price)).toBe(
          BigInt(units) * price,
        );
      }),
    );
  });

  it("sums invoice lines exactly", () => {
    const line = fc.record({
      quantity,
      unitPriceCents: unitPrice,
    });

    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 10 }),
        (lines) => {
          const expected = lines.reduce(
            (total, current) =>
              total +
              BigInt(current.quantity) * current.unitPriceCents,
            0n,
          );

          expect(invoiceTotalCents(lines)).toBe(expected);
        },
      ),
    );
  });

  it("sums arbitrary cents without overflow or rounding", () => {
    fc.assert(
      fc.property(
        fc.array(cents, { maxLength: 100 }),
        (values) => {
          const expected = values.reduce(
            (total, value) => total + value,
            0n,
          );

          expect(sumCents(values)).toBe(expected);
        },
      ),
    );
  });

  it("groups payments by invoice without multiplying amounts", () => {
    const payment = fc.record({
      invoiceId: fc.constantFrom("a", "b", "c"),
      amountCents: positiveCents,
    });

    fc.assert(
      fc.property(
        fc.array(payment, { maxLength: 50 }),
        (payments) => {
          const expected = new Map<string, bigint>();

          for (const current of payments) {
            expected.set(
              current.invoiceId,
              (expected.get(current.invoiceId) ?? 0n) +
                current.amountCents,
            );
          }

          expect(aggregatePaymentsByInvoice(payments)).toEqual(
            expected,
          );
        },
      ),
    );
  });

  it("accepts every payment up to the positive outstanding balance", () => {
    fc.assert(
      fc.property(
        positiveCents,
        cents,
        positiveCents,
        (total, paid, amount) => {
          const outstanding = invoiceOutstandingCents(total, paid);
          fc.pre(amount <= outstanding);

          const settlement = calculatePaymentSettlement(
            total,
            paid,
            amount,
          );

          expect(settlement.totalPaidCents).toBe(paid + amount);
          expect(settlement.balanceCents).toBe(
            total - paid - amount,
          );
        },
      ),
    );
  });
});
