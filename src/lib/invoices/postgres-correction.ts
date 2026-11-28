import "server-only";
import { runVanDayOperation } from "@/lib/db/van-day-transaction";
import {
  serializeInvoiceSettlement,
  settleInvoice,
  type CorrectInvoiceInput,
} from "@/lib/money";

const correctionErrors = {
  NOT_FOUND: { status: 404, message: "The invoice or invoice line was not found." },
  FORBIDDEN: { status: 403, message: "An active supervisor is required to correct an invoice." },
  DAY_NOT_OPEN: { status: 409, message: "The van day is still being prepared." },
  DAY_CLOSED: { status: 409, message: "Corrections require an OPEN van day." },
  STALE_VERSION: { status: 409, message: "This invoice changed. Refresh it before correcting." },
  INSUFFICIENT_STOCK: { status: 409, message: "The corrected quantity exceeds the available van stock." },
  NO_CHANGE: { status: 422, message: "Specify a quantity different from the current quantity." },
} as const;

export class InvoiceCorrectionError extends Error {
  readonly status: number;

  constructor(readonly code: keyof typeof correctionErrors) {
    const { message, status } = correctionErrors[code];
    super(message);
    this.name = "InvoiceCorrectionError";
    this.status = status;
  }
}

type InvoiceCorrectionRequest = CorrectInvoiceInput & {
  invoiceId: string;
  idempotencyKey: string;
};

type CorrectionLine = {
  quantity: number;
  unit_price_cents: string;
  total_cents: string;
  paid_cents: string;
  available_quantity: string | null;
};

export function correctInvoiceQuantity(
  actorId: string,
  { invoiceId, idempotencyKey, lineId, newQuantity, expectedInvoiceVersion, reason }: InvoiceCorrectionRequest,
) {
  return runVanDayOperation({
    actorId,
    requestKey: idempotencyKey,
    methodRoute: "POST /api/invoices/{id}/corrections",
    requestBody: { lineId, newQuantity, expectedInvoiceVersion, reason },
    resource: {
      id: invoiceId,
      async resolveVanDayId(client, id) {
        const { rows: [visit] } = await client.query<{ day_id: string }>(
          `SELECT visit.day_id
             FROM routebook.invoices AS invoice
             JOIN routebook.visits AS visit ON visit.id = invoice.visit_id
            WHERE invoice.id = $1`,
          [id],
        );
        if (!visit) {
          throw new InvoiceCorrectionError("NOT_FOUND");
        }
        return visit.day_id;
      },
    },
    async authorize({ client, vanDay }) {
      // Check current access under the day lock, including when replaying a receipt.
      const { rows: [access] } = await client.query<{ authorized: boolean }>(
        `SELECT EXISTS (
                  SELECT 1
                    FROM routebook.staff_profiles AS staff
                   WHERE staff.id = $3 AND staff.active AND staff.role = 'SUPERVISOR'
                ) AS authorized
           FROM routebook.invoices AS invoice
           JOIN routebook.visits AS visit ON visit.id = invoice.visit_id
          WHERE invoice.id = $1 AND visit.day_id = $2`,
        [invoiceId, vanDay.id, actorId],
      );
      if (!access) {
        throw new InvoiceCorrectionError("NOT_FOUND");
      }
      if (!access.authorized) {
        throw new InvoiceCorrectionError("FORBIDDEN");
      }
    },
    async execute({ client, vanDay }) {
      if (vanDay.state !== "OPEN") {
        throw new InvoiceCorrectionError(vanDay.state === "CLOSED" ? "DAY_CLOSED" : "DAY_NOT_OPEN");
      }

      const { rows: [invoice] } = await client.query<{ version: number }>(
        `SELECT version
           FROM routebook.invoices
          WHERE id = $1
          FOR UPDATE`,
        [invoiceId],
      );
      if (!invoice) {
        throw new InvoiceCorrectionError("NOT_FOUND");
      }
      if (invoice.version !== expectedInvoiceVersion) {
        throw new InvoiceCorrectionError("STALE_VERSION");
      }

      // Sum payments separately from lines. Stock includes this product's sales across the day.
      const { rows: [line] } = await client.query<CorrectionLine>(
        `SELECT line.quantity, line.unit_price_cents::text,
                (SELECT SUM(item.quantity * item.unit_price_cents)::text
                   FROM routebook.invoice_lines AS item
                  WHERE item.invoice_id = line.invoice_id) AS total_cents,
                (SELECT COALESCE(SUM(payment.amount_cents), 0)::text
                   FROM routebook.payments AS payment
                  WHERE payment.invoice_id = line.invoice_id) AS paid_cents,
                (load.opening_qty - COALESCE((
                  SELECT SUM(sold_line.quantity)
                    FROM routebook.visits AS visit
                    JOIN routebook.invoices AS sale ON sale.visit_id = visit.id
                    JOIN routebook.invoice_lines AS sold_line ON sold_line.invoice_id = sale.id
                   WHERE visit.day_id = $3 AND sold_line.product_id = line.product_id
                ), 0))::text AS available_quantity
           FROM routebook.invoice_lines AS line
           LEFT JOIN routebook.load_items AS load
             ON load.day_id = $3 AND load.product_id = line.product_id
          WHERE line.id = $2 AND line.invoice_id = $1
          FOR UPDATE OF line`,
        [invoiceId, lineId, vanDay.id],
      );
      if (!line) {
        throw new InvoiceCorrectionError("NOT_FOUND");
      }

      const quantityChange = BigInt(newQuantity - line.quantity);
      if (quantityChange === 0n) {
        throw new InvoiceCorrectionError("NO_CHANGE");
      }
      if (line.available_quantity === null) {
        throw new Error("The invoice line has no corresponding van load item.");
      }
      const availableQuantity = BigInt(line.available_quantity) - quantityChange;
      if (availableQuantity < 0n) {
        throw new InvoiceCorrectionError("INSUFFICIENT_STOCK");
      }

      const totalCents =
        BigInt(line.total_cents) + quantityChange * BigInt(line.unit_price_cents);
      const settlement = serializeInvoiceSettlement(
        settleInvoice(totalCents, BigInt(line.paid_cents)),
      );

      await client.query(
        `UPDATE routebook.invoice_lines
            SET quantity = $1
          WHERE id = $2 AND invoice_id = $3`,
        [newQuantity, lineId, invoiceId],
      );
      const { rows: [updatedInvoice] } = await client.query<{ version: number }>(
        `UPDATE routebook.invoices
            SET version = version + 1
          WHERE id = $1 AND version = $2
          RETURNING version`,
        [invoiceId, expectedInvoiceVersion],
      );
      if (!updatedInvoice) {
        throw new InvoiceCorrectionError("STALE_VERSION");
      }
      const { rows: [correction] } = await client.query<{ id: string }>(
        `INSERT INTO routebook.invoice_corrections
           (invoice_id, line_id, old_qty, new_qty, resulting_version, reason, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [invoiceId, lineId, line.quantity, newQuantity, updatedInvoice.version, reason, actorId],
      );
      await client.query(
        "UPDATE routebook.van_days SET revision = revision + 1 WHERE id = $1",
        [vanDay.id],
      );

      return {
        status: 200,
        body: {
          success: true,
          data: {
            correctionId: correction.id,
            invoiceVersion: updatedInvoice.version,
            invoiceTotalCents: settlement.totalCents,
            invoiceBalanceCents: settlement.balanceCents,
            availableQuantity: Number(availableQuantity),
            totalPaidCents: settlement.paidCents,
            outstandingCents: settlement.outstandingCents,
            excessPaymentCents: settlement.excessPaymentCents,
            reviewRequired: settlement.reviewRequired,
          },
        },
      };
    },
  });
}
