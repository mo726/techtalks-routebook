/**
 * Exact money handling for RouteBook.
 *
 * Every monetary value is an integer number of USD cents stored as a `bigint`.
 * Values cross the JSON boundary as canonical decimal strings, and arithmetic
 * never uses JavaScript floating point.
 */

/** Maximum value for a single monetary record (5,000,000,000,000,000 cents). */
export const MAX_CENTS = 5_000_000_000_000_000n;

/** Maximum unit price stored on a product or invoice line. */
export const MAX_PRODUCT_PRICE_CENTS = 100_000_000n;

/** Maximum whole-unit quantity for a sale line, load or count. */
export const MAX_QUANTITY = 1_000_000;

/** Minimum amount for a recorded cash payment. */
export const MIN_PAYMENT_CENTS = 1n;

/** The maximum cents value has 16 digits. */
export const MAX_CENTS_DIGITS = 16;

export const MONEY_ERROR_CODES = {
  INVALID_CENTS: "INVALID_CENTS",
  AMOUNT_OUT_OF_RANGE: "AMOUNT_OUT_OF_RANGE",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  AMOUNT_OVERFLOW: "AMOUNT_OVERFLOW",
  INVOICE_HAS_NO_LINES: "INVOICE_HAS_NO_LINES",
} as const;

export type MoneyErrorCode =
  (typeof MONEY_ERROR_CODES)[keyof typeof MONEY_ERROR_CODES];

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

/** Narrow an unknown error to a domain money error. */
export function isMoneyError(error: unknown): error is MoneyError {
  return error instanceof MoneyError;
}

const SIGNED_CENTS_PATTERN = /^-?(0|[1-9]\d*)$/;
const UNSIGNED_CENTS_PATTERN = /^(0|[1-9]\d*)$/;

// A leading minus adds one character to the longest supported amount.
const MAX_CENTS_STRING_LENGTH = MAX_CENTS_DIGITS + 1;


export function isCanonicalCentsString(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CENTS_STRING_LENGTH &&
    value !== "-0" &&
    SIGNED_CENTS_PATTERN.test(value)
  );
}

/**
 * True when a string is a canonical non-negative integer amount.
 *
 * This checks syntax and length only; it does not check the amount range.
 */
export function isCanonicalNonNegativeCentsString(
  value: string,
): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CENTS_DIGITS &&
    UNSIGNED_CENTS_PATTERN.test(value)
  );
}

/**
 * Parse a canonical signed decimal string into bounded bigint cents.
 *
 * Accepts whole numbers such as "0", "1500" or "-500" within
 * [-MAX_CENTS, MAX_CENTS]. Rejects fractions, exponents, leading zeros,
 * surrounding whitespace and any other sign than a leading minus.
 */
export function parseCentsString(value: string): bigint {
  if (!isCanonicalCentsString(value)) {
    throw new MoneyError(
      MONEY_ERROR_CODES.INVALID_CENTS,
      'Cents must be a whole number written as a decimal string, for example "1500".',
    );
  }

  return assertCents(
    BigInt(value),
    -MAX_CENTS,
    MAX_CENTS,
    "Amount",
  );
}

/**
 * Parse a client-supplied non-negative amount and enforce a maximum.
 * This is the entry point used by the API validation layer.
 */
export function parseNonNegativeCentsString(
  value: string,
  max: bigint = MAX_CENTS,
): bigint {
  if (!isCanonicalNonNegativeCentsString(value)) {
    throw new MoneyError(
      MONEY_ERROR_CODES.INVALID_CENTS,
      'Cents must be a whole number written as a non-negative decimal string, for example "1500".',
    );
  }

  return assertCents(BigInt(value), 0n, max, "Amount");
}

/** Format exact bigint cents as a decimal string for JSON responses. */
export function formatCents(cents: bigint): string {
  assertBigInt(cents, "Amount");
  return cents.toString();
}

/** Assert that a bigint amount is inside an inclusive range. */
export function assertCents(
  value: bigint,
  min: bigint,
  max: bigint,
  label = "Amount",
): bigint {
  assertBigInt(value, label);

  if (value < min || value > max) {
    throw new MoneyError(
      MONEY_ERROR_CODES.AMOUNT_OUT_OF_RANGE,
      `${label} must be between ${min} and ${max} cents.`,
    );
  }

  return value;
}

/** Assert that a quantity is a whole number of units in the supported range. */
export function assertQuantity(quantity: number): number {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_QUANTITY
  ) {
    throw new MoneyError(
      MONEY_ERROR_CODES.INVALID_QUANTITY,
      `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.`,
    );
  }

  return quantity;
}

/** Sum exact cents. Aggregates may exceed the per-record maximum. */
export function sumCents(values: Iterable<bigint>): bigint {
  let total = 0n;

  for (const value of values) {
    assertBigInt(value, "Amount");
    total += value;
  }

  return total;
}

/** Calculate one invoice line amount without floating point. */
export function lineAmountCents(
  quantity: number,
  unitPriceCents: bigint,
): bigint {
  assertQuantity(quantity);
  assertCents(
    unitPriceCents,
    1n,
    MAX_PRODUCT_PRICE_CENTS,
    "Unit price",
  );

  return BigInt(quantity) * unitPriceCents;
}

function assertBigInt(
  value: unknown,
  label: string,
): asserts value is bigint {
  if (typeof value !== "bigint") {
    throw new MoneyError(
      MONEY_ERROR_CODES.INVALID_CENTS,
      `${label} must be an integer number of cents.`,
    );
  }
}
