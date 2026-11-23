import { z } from "zod";

const stockItemSchema = z.object({
  product: z.object({
    id: z.string().uuid(),
    name: z.string(),
    unit: z.string(),
  }),
  openingQuantity: z.number().int().positive(),
  availableQuantity: z.number().int().nonnegative(),
});

export const driverStockResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    vanDay: z
      .object({
        id: z.string().uuid(),
        vanCode: z.string(),
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        state: z.literal("OPEN"),
        revision: z.number().int().positive(),
      })
      .nullable(),
    stock: z.array(stockItemSchema),
  }),
});

export type DriverStockResponse = z.infer<typeof driverStockResponseSchema>;
