import { z } from "zod";

import {
  MAX_CENTS,
  MAX_PRODUCT_PRICE_CENTS,
  MAX_QUANTITY,
  isCanonicalNonNegativeCentsString,
} from "./cents";

export const MAX_INVOICE_LINES = 50;

function centsStringSchema(
  min: bigint,
  max: bigint,
  label: string,
) {
  return z
    .string()
    .refine(
      isCanonicalNonNegativeCentsString,
      `${label} must be a whole number of cents written as a non-negative decimal string.`,
    )
    .transform((value) => BigInt(value))
    .refine(
      (value) => value >= min && value <= max,
      `${label} must be between ${min.toString()} and ${max.toString()} cents.`,
    );
}

/** Verified pre-RouteBook customer debt. Zero is allowed. */
export const openingBalanceCentsSchema = centsStringSchema(
  0n,
  MAX_CENTS,
  "Opening balance",
);

/** Cash received in one payment. Must be positive. */
export const paymentAmountCentsSchema = centsStringSchema(
  1n,
  MAX_CENTS,
  "Payment amount",
);

/** Physical cash counted at closing. Zero is allowed. */
export const countedCashCentsSchema = centsStringSchema(
  0n,
  MAX_CENTS,
  "Counted cash",
);

/** Unit price at the time of sale. Must be positive. */
export const unitPriceCentsSchema = centsStringSchema(
  1n,
  MAX_PRODUCT_PRICE_CENTS,
  "Unit price",
);

export const quantitySchema = z
  .number()
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(MAX_QUANTITY, `Quantity must not exceed ${MAX_QUANTITY}.`);

export const countedQuantitySchema = z
  .number()
  .int("Counted quantity must be a whole number.")
  .min(0, "Counted quantity cannot be negative.")
  .max(
    MAX_QUANTITY,
    `Counted quantity must not exceed ${MAX_QUANTITY}.`,
  );

const revisionSchema = z
  .number()
  .int("Revision must be a whole number.")
  .min(1, "Revision must be at least 1.");

export const invoiceLineInputSchema = z.strictObject({
  productId: z.uuid(),
  quantity: quantitySchema,
  expectedUnitPriceCents: unitPriceCentsSchema,
});

export const createInvoiceInputSchema = z
  .strictObject({
    visitId: z.uuid(),
    lines: z
      .array(invoiceLineInputSchema)
      .min(1, "An invoice needs at least one line.")
      .max(
        MAX_INVOICE_LINES,
        `An invoice may contain at most ${MAX_INVOICE_LINES} lines.`,
      ),
  })
  .superRefine((value, ctx) => {
    const productIds = new Set<string>();

    value.lines.forEach((line, index) => {
      if (productIds.has(line.productId)) {
        ctx.addIssue({
          code: "custom",
          message: "Each product may appear only once per invoice.",
          path: ["lines", index, "productId"],
        });
      }

      productIds.add(line.productId);
    });
  });

export const recordPaymentInputSchema = z.strictObject({
  amountCents: paymentAmountCentsSchema,
  expectedInvoiceVersion: revisionSchema,
});

export const correctInvoiceInputSchema = z.strictObject({
  lineId: z.uuid(),
  newQuantity: quantitySchema,
  expectedInvoiceVersion: revisionSchema,
  reason: z
    .string()
    .trim()
    .refine((reason) => !reason.includes("\0") && reason.isWellFormed(), "Enter a valid text reason.")
    .refine((reason) => {
      const length = Array.from(reason).length;
      return length >= 5 && length <= 500;
    }, "A correction reason must be between 5 and 500 characters."),
});

export const verifyOpeningBalanceInputSchema = z.strictObject({
  amountCents: openingBalanceCentsSchema,
  sourceReference: z
    .string()
    .trim()
    .min(5, "A source reference must be at least 5 characters.")
    .max(500, "A source reference must be at most 500 characters."),
  verified: z.literal(true, {
    error: "Opening debt must be explicitly verified.",
  }),
});

export const closeDayInputSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    countedCashCents: countedCashCentsSchema,
    counts: z
      .array(
        z.strictObject({
          productId: z.uuid(),
          countedQuantity: countedQuantitySchema,
        }),
      )
      .min(1, "Closing needs at least one product count."),
  })
  .superRefine((value, ctx) => {
    const productIds = new Set<string>();

    value.counts.forEach((count, index) => {
      if (productIds.has(count.productId)) {
        ctx.addIssue({
          code: "custom",
          message: "Each loaded product may be counted only once.",
          path: ["counts", index, "productId"],
        });
      }

      productIds.add(count.productId);
    });
  });

export type CreateInvoiceInput = z.infer<
  typeof createInvoiceInputSchema
>;
export type RecordPaymentInput = z.infer<
  typeof recordPaymentInputSchema
>;
export type CorrectInvoiceInput = z.infer<
  typeof correctInvoiceInputSchema
>;
export type VerifyOpeningBalanceInput = z.infer<
  typeof verifyOpeningBalanceInputSchema
>;
export type CloseDayInput = z.infer<typeof closeDayInputSchema>;
