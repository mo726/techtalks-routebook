import { describe, expect, it } from "vitest";
import {
  createVanDayRequestSchema,
  openVanDayRequestSchema,
  replaceVanDayLoadRequestSchema,
  assignVanDayVisitRequestSchema,
} from "./van-days";

describe("van-day API request contracts", () => {
  it("normalizes van codes and validates Gregorian business dates", () => {
    expect(
      createVanDayRequestSchema.parse({
        vanCode: " van-04 ",
        businessDate: "2026-11-25",
        driverId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({
      vanCode: "VAN-04",
      businessDate: "2026-11-25",
      driverId: "11111111-1111-4111-8111-111111111111",
    });

    expect(
      createVanDayRequestSchema.safeParse({
        vanCode: "VAN-04",
        businessDate: "2026-02-30",
        driverId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);

    expect(
      createVanDayRequestSchema.safeParse({
        vanCode: "ß".repeat(40),
        businessDate: "2026-11-25",
        driverId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields for mutation contracts", () => {
    expect(
      createVanDayRequestSchema.safeParse({
        vanCode: "VAN-04",
        businessDate: "2026-11-25",
        driverId: "11111111-1111-4111-8111-111111111111",
        createdBy: "client-controlled",
      }).success,
    ).toBe(false);
  });

  it("validates replacement load quantities and unique products", () => {
    const productId = "22222222-2222-4222-8222-222222222222";
    const request = {
      expectedRevision: 1,
      items: [{ productId, quantity: 100 }],
    };

    expect(replaceVanDayLoadRequestSchema.safeParse(request).success).toBe(true);
    expect(
      replaceVanDayLoadRequestSchema.safeParse({
        ...request,
        items: [
          ...request.items,
          { productId, quantity: 5 },
        ],
      }).success,
    ).toBe(false);
    expect(
      replaceVanDayLoadRequestSchema.safeParse({
        ...request,
        items: [{ productId, quantity: 0 }],
      }).success,
    ).toBe(false);
  });

  it("validates visit assignment and expected open revision", () => {
    expect(
      assignVanDayVisitRequestSchema.safeParse({
        customerId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(true);
    expect(
      openVanDayRequestSchema.safeParse({ expectedRevision: 2 }).success,
    ).toBe(true);
    expect(
      openVanDayRequestSchema.safeParse({
        expectedRevision: 2,
        state: "OPEN",
      }).success,
    ).toBe(false);
  });
});
