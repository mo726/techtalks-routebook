import { z } from "zod";

/** PostgreSQL varchar limits count Unicode code points, not UTF-16 code units. */
export function isPostgresTextWithinLimit(value: string, maximumCharacters: number) {
  if (value.includes("\0") || Array.from(value).length > maximumCharacters) return false;

  // PostgreSQL UTF-8 text cannot represent unpaired UTF-16 surrogates.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function postgresTextSchema(maximumCharacters: number, trim = false) {
  const stringSchema = trim ? z.string().trim() : z.string();
  return stringSchema
    .min(1)
    .refine((value) => !value.includes("\0"), {
      message: "Text cannot contain a NUL character.",
    })
    .refine((value) => isPostgresTextWithinLimit(value, maximumCharacters), {
      message: `Text must contain at most ${maximumCharacters} valid Unicode characters.`,
    });
}

const customerNameSchema = postgresTextSchema(160, true);
const customerLocationSchema = postgresTextSchema(240, true);
const productNameSchema = postgresTextSchema(160, true);
const productUnitSchema = postgresTextSchema(40, true);

export const productPriceCentsSchema = z
  .string()
  .regex(/^\d+$/, {
    message: "priceCents must be a decimal integer string.",
  })
  .refine((value) => value === value.trim(), {
    message: "priceCents cannot contain surrounding whitespace.",
  })
  .transform((value) => value.replace(/^0+(?=\d)/, ""))
  .refine(
    (value) =>
      value !== "0" &&
      value.length <= 9 &&
      (value.length < 9 || value <= "100000000"),
    { message: "priceCents must be between 1 and 100000000 cents." },
  );

export const createCustomerSchema = z
  .object({ name: customerNameSchema, location: customerLocationSchema })
  .strict();

export const patchCustomerSchema = z
  .object({
    name: customerNameSchema.optional(),
    location: customerLocationSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one customer field to update.",
  });

export const createProductSchema = z
  .object({
    name: productNameSchema,
    unit: productUnitSchema,
    priceCents: productPriceCentsSchema,
  })
  .strict();

export const patchProductSchema = z
  .object({
    name: productNameSchema.optional(),
    unit: productUnitSchema.optional(),
    priceCents: productPriceCentsSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one product field to update.",
  });

export const customerSchema = z
  .object({
    id: z.string().uuid(),
    name: postgresTextSchema(160),
    location: postgresTextSchema(240),
    active: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const productSchema = z
  .object({
    id: z.string().uuid(),
    name: postgresTextSchema(160),
    unit: postgresTextSchema(40),
    priceCents: productPriceCentsSchema,
    active: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const customersListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ items: z.array(customerSchema), nextCursor: z.string().nullable() }).strict(),
  })
  .strict();

export const productsListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ items: z.array(productSchema), nextCursor: z.string().nullable() }).strict(),
  })
  .strict();

export const customerMutationResponseSchema = z
  .object({ success: z.literal(true), data: z.object({ customer: customerSchema }).strict() })
  .strict();

export const productMutationResponseSchema = z
  .object({ success: z.literal(true), data: z.object({ product: productSchema }).strict() })
  .strict();

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type PatchCustomerInput = z.infer<typeof patchCustomerSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type PatchProductInput = z.infer<typeof patchProductSchema>;
export type CustomerRecord = z.infer<typeof customerSchema>;
export type ProductRecord = z.infer<typeof productSchema>;
