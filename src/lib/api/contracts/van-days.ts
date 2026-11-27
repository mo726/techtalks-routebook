import { z } from "zod";

const uuidSchema = z.string().uuid();

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const revisionSchema = z.number().int().positive().safe();

export const createVanDayRequestSchema = z
  .object({
    vanCode: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .transform((value) => value.toUpperCase())
      .pipe(z.string().min(1).max(40)),
    businessDate: businessDateSchema,
    driverId: uuidSchema,
  })
  .strict();

export const replaceVanDayLoadRequestSchema = z
  .object({
    expectedRevision: revisionSchema,
    items: z
      .array(
        z
          .object({
            productId: uuidSchema,
            quantity: z.number().int().min(1).max(1_000_000).safe(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.productId)).size === items.length,
      ),
  })
  .strict();

export const assignVanDayVisitRequestSchema = z
  .object({ customerId: uuidSchema })
  .strict();

export const openVanDayRequestSchema = z
  .object({ expectedRevision: revisionSchema })
  .strict();

const loadItemSchema = z.object({
  productId: uuidSchema,
  productName: z.string(),
  unit: z.string(),
  quantity: z.number().int().positive(),
});

const visitSchema = z.object({
  id: uuidSchema,
  position: z.number().int().positive(),
  customer: z.object({
    id: uuidSchema,
    name: z.string(),
    location: z.string(),
  }),
  invoice: z
    .object({ id: uuidSchema, number: z.string().regex(/^\d+$/) })
    .nullable(),
});

export const vanDaySchema = z.object({
  id: uuidSchema,
  vanCode: z.string(),
  businessDate: businessDateSchema,
  state: z.enum(["PREPARING", "OPEN", "CLOSED"]),
  revision: revisionSchema,
  driver: z.object({ id: uuidSchema, displayName: z.string() }),
  load: z.array(loadItemSchema),
  visits: z.array(visitSchema),
});

export const vanDaysResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    vanDays: z.array(vanDaySchema),
    staff: z.array(z.object({ id: uuidSchema, displayName: z.string() })).optional(),
    nextCursor: uuidSchema.nullable(),
  }),
});

export const vanDayVisitsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    vanDay: z.object({
      id: uuidSchema,
      state: z.enum(["PREPARING", "OPEN", "CLOSED"]),
      revision: revisionSchema,
    }),
    visits: z.array(visitSchema),
  }),
});

export type CreateVanDayRequest = z.infer<typeof createVanDayRequestSchema>;
export type ReplaceVanDayLoadRequest = z.infer<
  typeof replaceVanDayLoadRequestSchema
>;
export type AssignVanDayVisitRequest = z.infer<
  typeof assignVanDayVisitRequestSchema
>;
