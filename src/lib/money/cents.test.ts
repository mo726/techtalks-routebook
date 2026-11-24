import { describe, expect, it } from "vitest";

import {
  MAX_CENTS,
  MAX_PRODUCT_PRICE_CENTS,
  MAX_QUANTITY,
  MONEY_ERROR_CODES,
  MoneyError,
  assertCents,
  assertQuantity,
  formatCents,
  isCanonicalCentsString,
  isCanonicalNonNegativeCentsString,
  isMoneyError,
  lineAmountCents,
  parseCentsString,
  parseNonNegativeCentsString,
  sumCents,
} from "./cents";
import { expectMoneyError } from "./test-utils";

describe("canonical cents predicates", () => {
  it("accepts canonical signed amounts", () => {
    expect(isCanonicalCentsString("0")).toBe(true);
    expect(isCanonicalCentsString("1500")).toBe(true);
    expect(isCanonicalCentsString("-500")).toBe(true);
    expect(isCanonicalCentsString(MAX_CENTS.toString())).toBe(
      true,
    );
    expect(
      isCanonicalCentsString(`-${MAX_CENTS.toString()}`),
    ).toBe(true);
  });

  it.each([
    "",
    "01",
    "-0",
    "+1",
    "1.5",
    "1e3",
    " 10",
    "10 ",
    "1,000",
    "abc",
    "9".repeat(18),
  ])("rejects malformed signed amount %j", (value) => {
    expect(isCanonicalCentsString(value)).toBe(false);
  });

  it("rejects non-string signed input at runtime", () => {
    expect(
      isCanonicalCentsString(1500 as unknown as string),
    ).toBe(false);
  });

  it("accepts canonical non-negative amounts", () => {
    expect(isCanonicalNonNegativeCentsString("0")).toBe(true);
    expect(isCanonicalNonNegativeCentsString("1500")).toBe(
      true,
    );
    expect(
      isCanonicalNonNegativeCentsString(MAX_CENTS.toString()),
    ).toBe(true);
  });

  it.each([
    "",
    "01",
    "-1",
    "+1",
    "1.5",
    "1e3",
    " 10",
    "10 ",
    "1,000",
    "abc",
    "9".repeat(17),
  ])("rejects malformed non-negative amount %j", (value) => {
    expect(isCanonicalNonNegativeCentsString(value)).toBe(
      false,
    );
  });

  it("rejects non-string non-negative input at runtime", () => {
    expect(
      isCanonicalNonNegativeCentsString(
        1500 as unknown as string,
      ),
    ).toBe(false);
  });
});

describe("parseCentsString", () => {
  it("parses canonical signed decimal strings into bigint cents", () => {
    expect(parseCentsString("0")).toBe(0n);
    expect(parseCentsString("1")).toBe(1n);
    expect(parseCentsString("1500")).toBe(1500n);
    expect(parseCentsString("-500")).toBe(-500n);
    expect(parseCentsString(MAX_CENTS.toString())).toBe(MAX_CENTS);
    expect(parseCentsString(`-${MAX_CENTS.toString()}`)).toBe(
      -MAX_CENTS,
    );
  });

  it.each([
    "",
    "01",
    "-0",
    "+1",
    "1.5",
    "1e3",
    " 10",
    "10 ",
    "1,000",
    "abc",
  ])("rejects malformed value %j", (value) => {
    expectMoneyError(
      () => parseCentsString(value),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
  });

  it("rejects values outside the signed maximum", () => {
    expectMoneyError(
      () => parseCentsString((MAX_CENTS + 1n).toString()),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => parseCentsString(`-${(MAX_CENTS + 1n).toString()}`),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });

  it("rejects non-string input at runtime", () => {
    expectMoneyError(
      () => parseCentsString(1500 as unknown as string),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
  });
});

describe("parseNonNegativeCentsString", () => {
  it("accepts zero and the maximum", () => {
    expect(parseNonNegativeCentsString("0")).toBe(0n);
    expect(
      parseNonNegativeCentsString(MAX_CENTS.toString()),
    ).toBe(MAX_CENTS);
  });

  it("rejects negative, malformed and out-of-range values", () => {
    expectMoneyError(
      () => parseNonNegativeCentsString("-1"),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
    expectMoneyError(
      () =>
        parseNonNegativeCentsString(
          (MAX_CENTS + 1n).toString(),
        ),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => parseNonNegativeCentsString("10.5"),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
  });

  it("respects a tighter maximum", () => {
    expect(parseNonNegativeCentsString("100", 100n)).toBe(100n);
    expectMoneyError(
      () => parseNonNegativeCentsString("101", 100n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });

  it("rejects non-string input at runtime", () => {
    expectMoneyError(
      () =>
        parseNonNegativeCentsString(1500 as unknown as string),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
  });
});

describe("formatCents", () => {
  it("formats exact integer cents as decimal strings", () => {
    expect(formatCents(0n)).toBe("0");
    expect(formatCents(1500n)).toBe("1500");
    expect(formatCents(-500n)).toBe("-500");
    expect(formatCents(MAX_CENTS)).toBe("5000000000000000");
    expect(formatCents(-MAX_CENTS)).toBe("-5000000000000000");
  });

  it("rejects non-bigint values", () => {
    expectMoneyError(
      () => formatCents(1.5 as unknown as bigint),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
  });
});

describe("assertCents", () => {
  it("returns values inside the inclusive bounds", () => {
    expect(assertCents(0n, 0n, MAX_CENTS)).toBe(0n);
    expect(assertCents(MAX_CENTS, 0n, MAX_CENTS)).toBe(MAX_CENTS);
  });

  it("rejects values outside the bounds", () => {
    expectMoneyError(
      () => assertCents(-1n, 0n, MAX_CENTS),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () => assertCents(MAX_CENTS + 1n, 0n, MAX_CENTS),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });

  it("rejects non-bigint values", () => {
    expectMoneyError(
      () => assertCents(1 as unknown as bigint, 0n, MAX_CENTS),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
  });
});

describe("assertQuantity", () => {
  it("accepts whole units in range", () => {
    expect(assertQuantity(1)).toBe(1);
    expect(assertQuantity(MAX_QUANTITY)).toBe(MAX_QUANTITY);
  });

  it.each([
    0,
    -1,
    1.5,
    MAX_QUANTITY + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid quantity %j", (value) => {
    expectMoneyError(
      () => assertQuantity(value),
      MONEY_ERROR_CODES.INVALID_QUANTITY,
    );
  });
});

describe("lineAmountCents", () => {
  it("multiplies whole units by an exact unit price", () => {
    expect(lineAmountCents(20, 100n)).toBe(2000n);
    expect(
      lineAmountCents(MAX_QUANTITY, MAX_PRODUCT_PRICE_CENTS),
    ).toBe(100_000_000_000_000n);
  });

  it("rejects invalid quantities and prices", () => {
    expectMoneyError(
      () => lineAmountCents(0, 100n),
      MONEY_ERROR_CODES.INVALID_QUANTITY,
    );
    expectMoneyError(
      () => lineAmountCents(20, 0n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
    expectMoneyError(
      () =>
        lineAmountCents(20, MAX_PRODUCT_PRICE_CENTS + 1n),
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
    );
  });
});

describe("sumCents", () => {
  it("returns zero for no values", () => {
    expect(sumCents([])).toBe(0n);
  });

  it("sums exact cents without floating point", () => {
    expect(sumCents([1000n, 1000n])).toBe(2000n);
  });

  it("allows aggregates above the per-record maximum", () => {
    expect(sumCents([MAX_CENTS, MAX_CENTS])).toBe(
      MAX_CENTS * 2n,
    );
  });

  it("rejects non-bigint values", () => {
    expectMoneyError(
      () => sumCents([1 as unknown as bigint]),
      MONEY_ERROR_CODES.INVALID_CENTS,
    );
  });
});

describe("MoneyError", () => {
  it("exposes a stable code and name", () => {
    const error = new MoneyError(
      MONEY_ERROR_CODES.INVALID_CENTS,
      "bad cents",
    );

    expect(error.name).toBe("MoneyError");
    expect(error.code).toBe("INVALID_CENTS");
    expect(error.message).toBe("bad cents");
  });

  it("narrows unknown errors", () => {
    expect(
      isMoneyError(
        new MoneyError(MONEY_ERROR_CODES.INVALID_CENTS, "bad"),
      ),
    ).toBe(true);
    expect(isMoneyError(new Error("other"))).toBe(false);
  });
});
