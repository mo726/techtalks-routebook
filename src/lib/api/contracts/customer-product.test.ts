import { describe, expect, it } from "vitest";
import {
  createCustomerSchema,
  createProductSchema,
  patchCustomerSchema,
  patchProductSchema,
} from "./customer-product";

describe("customer and product request contracts", () => {
  it("trims and accepts customer names and locations at their bounds", () => {
    expect(
      createCustomerSchema.parse({ name: " Cedar Market ", location: " Beirut " }),
    ).toEqual({ name: "Cedar Market", location: "Beirut" });
    expect(createCustomerSchema.safeParse({ name: "", location: "Beirut" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "A".repeat(161), location: "Beirut" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "Market", location: "B".repeat(241) }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "😀".repeat(160), location: "بيروت" }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ name: "😀".repeat(161), location: "بيروت" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "\ud800", location: "Beirut" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "Shop", location: "😀".repeat(240) }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ name: "Shop", location: "😀".repeat(241) }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "A\0B", location: "Beirut" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "Shop", location: "Beir\0ut" }).success).toBe(false);
  });

  it("rejects opening balance and other unknown customer mutation fields", () => {
    expect(
      createCustomerSchema.safeParse({
        name: "Cedar Market",
        location: "Beirut",
        openingBalanceCents: "3000",
      }).success,
    ).toBe(false);
    expect(
      patchCustomerSchema.safeParse({ openingBalanceVerified: true }).success,
    ).toBe(false);
    expect(patchCustomerSchema.safeParse({}).success).toBe(false);
    expect(patchCustomerSchema.safeParse({ active: false }).success).toBe(true);
  });

  it("accepts product prices only as decimal integer strings from 1 to 100 million cents", () => {
    const product = { name: "Bottle", unit: "bottle" };
    expect(createProductSchema.safeParse({ ...product, priceCents: "1" }).success).toBe(true);
    expect(createProductSchema.safeParse({ ...product, priceCents: "100000000" }).success).toBe(true);

    for (const priceCents of ["0", "100000001", "1.5", "-1", "100\n", 100]) {
      expect(createProductSchema.safeParse({ ...product, priceCents }).success).toBe(false);
    }
    expect(createProductSchema.parse({ ...product, priceCents: "0001" }).priceCents).toBe("1");
    expect(patchProductSchema.safeParse({ priceCents: "125" }).success).toBe(true);
    expect(patchProductSchema.safeParse({ priceCents: "100000001" }).success).toBe(false);
    expect(patchProductSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(patchProductSchema.safeParse({}).success).toBe(false);
  });

  it("validates product name and unit bounds", () => {
    expect(createProductSchema.safeParse({ name: "Juice", unit: "box", priceCents: "99" }).success).toBe(true);
    expect(createProductSchema.safeParse({ name: "A".repeat(161), unit: "box", priceCents: "99" }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: "Juice", unit: "b".repeat(41), priceCents: "99" }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: "🧃".repeat(160), unit: "علبة", priceCents: "99" }).success).toBe(true);
    expect(createProductSchema.safeParse({ name: "🧃".repeat(161), unit: "علبة", priceCents: "99" }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: "Juice", unit: "🥛".repeat(40), priceCents: "99" }).success).toBe(true);
    expect(createProductSchema.safeParse({ name: "Juice", unit: "🥛".repeat(41), priceCents: "99" }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: "Ju\0ice", unit: "box", priceCents: "99" }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: "Juice", unit: "bo\0x", priceCents: "99" }).success).toBe(false);
    expect(patchCustomerSchema.safeParse({ name: "A\0B" }).success).toBe(false);
    expect(patchCustomerSchema.safeParse({ location: "A\0B" }).success).toBe(false);
    expect(patchProductSchema.safeParse({ name: "A\0B" }).success).toBe(false);
    expect(patchProductSchema.safeParse({ unit: "A\0B" }).success).toBe(false);
  });
});
