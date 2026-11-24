import { expect } from "vitest";

import { MoneyError, type MoneyErrorCode } from "./cents";

/** Assert a MoneyError with an exact domain code. */
export function expectMoneyError(
  fn: () => unknown,
  code: MoneyErrorCode,
): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MoneyError);
    expect((error as MoneyError).code).toBe(code);
    return;
  }

  throw new Error(`Expected MoneyError with code ${code}.`);
}
