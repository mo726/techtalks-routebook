import { z } from "zod";

const visitSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().positive(),
  customer: z.object({
    id: z.string().uuid(),
    name: z.string(),
    location: z.string(),
  }),
  invoice: z
    .object({
      id: z.string().uuid(),
      number: z.string().regex(/^\d+$/),
    })
    .nullable(),
});

export const driverVisitsResponseSchema = z.object({
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
    visits: z.array(visitSchema),
  }),
});

export type DriverVisitsResponse = z.infer<
  typeof driverVisitsResponseSchema
>;
export type DriverVisit = DriverVisitsResponse["data"]["visits"][number];
