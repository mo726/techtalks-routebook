import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { getVanDayStock } from "./van-day-stock";

const dayId = "11111111-1111-4111-8111-111111111111";
const driverId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";

function makePool(rows: unknown[]) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    expect(sql).toContain("SELECT");
    expect(values).toBeDefined();
    return { rows };
  });
  return { pool: { query } as unknown as Pick<Pool, "query">, query };
}

const row = {
  day_id: dayId,
  van_code: "VAN-01",
  business_date: "2026-11-25",
  day_state: "OPEN",
  day_revision: 3,
  product_id: productId,
  product_name: "Water",
  product_unit: "bottle",
  opening_quantity: 100,
  available_quantity: "85",
};

describe("getVanDayStock", () => {
  it("derives available quantities from invoice lines for the requested day", async () => {
    const database = makePool([row]);

    await expect(
      getVanDayStock({
        vanDayId: dayId,
        staffId: driverId,
        canViewAll: false,
        pool: database.pool,
      }),
    ).resolves.toEqual({
      vanDay: {
        id: dayId,
        vanCode: "VAN-01",
        businessDate: "2026-11-25",
        state: "OPEN",
        revision: 3,
      },
      stock: [{
        product: { id: productId, name: "Water", unit: "bottle" },
        openingQuantity: 100,
        availableQuantity: 85,
      }],
    });

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("SUM(invoice_line.quantity)::bigint AS sold_quantity"),
      [dayId, false, driverId],
    );
    expect(database.query.mock.calls[0]?.[0]).toContain(
      "invoice_line.product_id = load_item.product_id",
    );
  });

  it("allows supervisor lookups by day ID and returns days without load as an empty stock list", async () => {
    const database = makePool([{
      ...row,
      day_state: "PREPARING",
      product_id: null,
      product_name: null,
      product_unit: null,
      opening_quantity: null,
      available_quantity: null,
    }]);

    await expect(
      getVanDayStock({
        vanDayId: dayId,
        staffId: driverId,
        canViewAll: true,
        pool: database.pool,
      }),
    ).resolves.toEqual({
      vanDay: {
        id: dayId,
        vanCode: "VAN-01",
        businessDate: "2026-11-25",
        state: "PREPARING",
        revision: 3,
      },
      stock: [],
    });
    expect(database.query).toHaveBeenCalledWith(expect.any(String), [
      dayId,
      true,
      driverId,
    ]);
  });

  it("returns null when the scoped day does not exist", async () => {
    const database = makePool([]);

    await expect(
      getVanDayStock({
        vanDayId: dayId,
        staffId: driverId,
        canViewAll: false,
        pool: database.pool,
      }),
    ).resolves.toBeNull();
  });

  it("rejects negative available quantities rather than hiding inconsistent stock", async () => {
    const database = makePool([{ ...row, available_quantity: "-1" }]);

    await expect(
      getVanDayStock({
        vanDayId: dayId,
        staffId: driverId,
        canViewAll: false,
        pool: database.pool,
      }),
    ).rejects.toThrow();
  });

  it("resolves the legacy driver request as the driver's current open day", async () => {
    const database = makePool([row]);

    await getVanDayStock({
      vanDayId: null,
      staffId: driverId,
      canViewAll: false,
      pool: database.pool,
    });

    expect(database.query.mock.calls[0]?.[0]).toContain("state = 'OPEN'");
    expect(database.query).toHaveBeenCalledWith(expect.any(String), [
      null,
      false,
      driverId,
    ]);
  });
});
