import { describe, expect, it } from "vitest";

import {
  MAX_CENTS,
  MAX_PRODUCT_PRICE_CENTS,
  MAX_QUANTITY,
} from "./cents";
import {
  closeDayInputSchema,
  correctInvoiceInputSchema,
  countedCashCentsSchema,
  countedQuantitySchema,
  createInvoiceInputSchema,
  openingBalanceCentsSchema,
  paymentAmountCentsSchema,
  quantitySchema,
  recordPaymentInputSchema,
  unitPriceCentsSchema,
  verifyOpeningBalanceInputSchema,
} from "./schemas";

const UUID_A = "0b6f1f1e-4a3a-4f5b-8c2d-1a2b3c4d5e6f";
const UUID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("cents schemas", () => {
  it("transforms valid decimal strings into bigint cents", () => {
    expect(openingBalanceCentsSchema.parse("0")).toBe(0n);
    expect(openingBalanceCentsSchema.parse("3000")).toBe(3000n);
    expect(
      openingBalanceCentsSchema.parse(MAX_CENTS.toString()),
    ).toBe(MAX_CENTS);
    expect(paymentAmountCentsSchema.parse("1")).toBe(1n);
    expect(countedCashCentsSchema.parse("0")).toBe(0n);
    expect(unitPriceCentsSchema.parse("100")).toBe(100n);
  });

  it.each([
    "",
    "10.5",
    "-1",
    "01",
    "+1",
    "1e3",
    " 10",
    "10 ",
    "1,000",
  ])("rejects malformed amount %j", (value) => {
    expect(openingBalanceCentsSchema.safeParse(value).success).toBe(
      false,
    );
  });

  it("enforces each amount's inclusive range", () => {
    expect(
      openingBalanceCentsSchema.safeParse(
        (MAX_CENTS + 1n).toString(),
      ).success,
    ).toBe(false);

    expect(paymentAmountCentsSchema.safeParse("0").success).toBe(
      false,
    );
    expect(
      paymentAmountCentsSchema.safeParse(MAX_CENTS.toString())
        .success,
    ).toBe(true);

    expect(countedCashCentsSchema.safeParse("-1").success).toBe(
      false,
    );

    expect(unitPriceCentsSchema.safeParse("0").success).toBe(false);
    expect(
      unitPriceCentsSchema.safeParse(
        MAX_PRODUCT_PRICE_CENTS.toString(),
      ).success,
    ).toBe(true);
    expect(
      unitPriceCentsSchema.safeParse(
        (MAX_PRODUCT_PRICE_CENTS + 1n).toString(),
      ).success,
    ).toBe(false);
  });
});

describe("quantity schemas", () => {
  it("accepts whole units in range", () => {
    expect(quantitySchema.parse(1)).toBe(1);
    expect(quantitySchema.parse(MAX_QUANTITY)).toBe(MAX_QUANTITY);
    expect(countedQuantitySchema.parse(0)).toBe(0);
    expect(countedQuantitySchema.parse(MAX_QUANTITY)).toBe(
      MAX_QUANTITY,
    );
  });

  it.each([0, -1, 1.5, MAX_QUANTITY + 1, "5"])(
    "rejects invalid sale quantity %j",
    (value) => {
      expect(quantitySchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([-1, 1.5, MAX_QUANTITY + 1, "5"])(
    "rejects invalid counted quantity %j",
    (value) => {
      expect(countedQuantitySchema.safeParse(value).success).toBe(
        false,
      );
    },
  );
});

describe("createInvoiceInputSchema", () => {
  const line = {
    productId: UUID_A,
    quantity: 20,
    expectedUnitPriceCents: "100",
  };

  it("parses a valid sale and transforms the price to bigint", () => {
    const parsed = createInvoiceInputSchema.parse({
      visitId: UUID_B,
      lines: [line],
    });

    expect(parsed.lines[0].expectedUnitPriceCents).toBe(100n);
  });

  it("rejects duplicate products", () => {
    const result = createInvoiceInputSchema.safeParse({
      visitId: UUID_B,
      lines: [line, line],
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty and oversized line lists", () => {
    expect(
      createInvoiceInputSchema.safeParse({
        visitId: UUID_B,
        lines: [],
      }).success,
    ).toBe(false);

    const lines = Array.from({ length: 51 }, (_, index) => ({
      ...line,
      productId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));

    expect(
      createInvoiceInputSchema.safeParse({
        visitId: UUID_B,
        lines,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      createInvoiceInputSchema.safeParse({
        visitId: UUID_B,
        lines: [line],
        totalCents: "2000",
      }).success,
    ).toBe(false);
  });
});

describe("recordPaymentInputSchema", () => {
  it("parses a valid payment", () => {
    const parsed = recordPaymentInputSchema.parse({
      amountCents: "1000",
      expectedInvoiceVersion: 2,
    });

    expect(parsed.amountCents).toBe(1000n);
  });

  it("rejects zero, fractional and stale-version values", () => {
    expect(
      recordPaymentInputSchema.safeParse({
        amountCents: "0",
        expectedInvoiceVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      recordPaymentInputSchema.safeParse({
        amountCents: "10.5",
        expectedInvoiceVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      recordPaymentInputSchema.safeParse({
        amountCents: "1000",
        expectedInvoiceVersion: 0,
      }).success,
    ).toBe(false);
  });
});

describe("correctInvoiceInputSchema", () => {
  it("parses a valid correction", () => {
    const parsed = correctInvoiceInputSchema.parse({
      lineId: UUID_A,
      newQuantity: 15,
      expectedInvoiceVersion: 2,
      reason: "Only 15 bottles were delivered",
    });

    expect(parsed.newQuantity).toBe(15);
  });

  it("rejects short reasons and zero quantities", () => {
    expect(
      correctInvoiceInputSchema.safeParse({
        lineId: UUID_A,
        newQuantity: 15,
        expectedInvoiceVersion: 2,
        reason: "oops",
      }).success,
    ).toBe(false);
    expect(
      correctInvoiceInputSchema.safeParse({
        lineId: UUID_A,
        newQuantity: 0,
        expectedInvoiceVersion: 2,
        reason: "Only 15 bottles were delivered",
      }).success,
    ).toBe(false);
  });
});

describe("verifyOpeningBalanceInputSchema", () => {
  it("requires a source reference and explicit verification", () => {
    const parsed = verifyOpeningBalanceInputSchema.parse({
      amountCents: "3000",
      sourceReference: "Legacy ledger page 12",
      verified: true,
    });

    expect(parsed.amountCents).toBe(3000n);
  });

  it("rejects unverified or unreferenced debt", () => {
    expect(
      verifyOpeningBalanceInputSchema.safeParse({
        amountCents: "3000",
        sourceReference: "Legacy ledger page 12",
        verified: false,
      }).success,
    ).toBe(false);
    expect(
      verifyOpeningBalanceInputSchema.safeParse({
        amountCents: "3000",
        sourceReference: "x",
        verified: true,
      }).success,
    ).toBe(false);
  });
});

describe("closeDayInputSchema", () => {
  it("parses counted cash and one count per product", () => {
    const parsed = closeDayInputSchema.parse({
      expectedRevision: 7,
      countedCashCents: "1500",
      counts: [
        { productId: UUID_A, countedQuantity: 85 },
        { productId: UUID_B, countedQuantity: 0 },
      ],
    });

    expect(parsed.countedCashCents).toBe(1500n);
  });

  it("rejects duplicate products and negative counts", () => {
    expect(
      closeDayInputSchema.safeParse({
        expectedRevision: 7,
        countedCashCents: "1500",
        counts: [
          { productId: UUID_A, countedQuantity: 85 },
          { productId: UUID_A, countedQuantity: 84 },
        ],
      }).success,
    ).toBe(false);

    expect(
      closeDayInputSchema.safeParse({
        expectedRevision: 7,
        countedCashCents: "1500",
        counts: [{ productId: UUID_A, countedQuantity: -1 }],
      }).success,
    ).toBe(false);
  });
});
