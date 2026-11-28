import "server-only";
import { runVanDayOperation } from "@/lib/db/van-day-transaction";
import {
  assertPaymentDayOpen,
  createPaymentReceipt,
  PAYMENT_METHOD_ROUTE,
  PaymentError,
  serializePaymentResponse,
  type RecordPaymentInput,
} from "./payment";

export function recordInvoicePayment(actorId: string, input: RecordPaymentInput) {
  return runVanDayOperation({
    actorId,
    requestKey: input.idempotencyKey,
    methodRoute: PAYMENT_METHOD_ROUTE,
    requestBody: {
      amountCents: input.amountCents.toString(),
      expectedInvoiceVersion: input.expectedInvoiceVersion,
    },
    resource: {
      id: input.invoiceId,
      async resolveVanDayId(client, id) {
        const { rows: [visit] } = await client.query<{ day_id: string }>(
          `SELECT visit.day_id
             FROM routebook.invoices AS invoice
             JOIN routebook.visits AS visit ON visit.id = invoice.visit_id
             JOIN routebook.van_days AS day ON day.id = visit.day_id
            WHERE invoice.id = $1 AND day.driver_id = $2`,
          [id, actorId],
        );
        if (!visit) {
          throw new PaymentError("NOT_FOUND", "Invoice was not found.");
        }
        return visit.day_id;
      },
    },
    async authorize({ client, vanDay }) {
      // Recheck ownership once the day is locked, including on receipt replay.
      const { rowCount } = await client.query(
        `SELECT 1
           FROM routebook.invoices AS invoice
           JOIN routebook.visits AS visit ON visit.id = invoice.visit_id
           JOIN routebook.van_days AS day ON day.id = visit.day_id
          WHERE invoice.id = $1 AND day.id = $2 AND day.driver_id = $3`,
        [input.invoiceId, vanDay.id, actorId],
      );
      if (rowCount !== 1) {
        throw new PaymentError("NOT_FOUND", "Invoice was not found.");
      }
    },
    async execute({ client, vanDay }) {
      assertPaymentDayOpen(vanDay.state);

      // Independent sums preserve the totals when an invoice has multiple lines and payments.
      const { rows: [invoice] } = await client.query<{
        version: number;
        total_cents: string;
        paid_cents: string;
      }>(
        `SELECT invoice.version,
                (SELECT COALESCE(SUM(line.quantity * line.unit_price_cents), 0)::text
                   FROM routebook.invoice_lines AS line
                  WHERE line.invoice_id = invoice.id) AS total_cents,
                (SELECT COALESCE(SUM(payment.amount_cents), 0)::text
                   FROM routebook.payments AS payment
                  WHERE payment.invoice_id = invoice.id) AS paid_cents
           FROM routebook.invoices AS invoice
          WHERE invoice.id = $1
          FOR UPDATE OF invoice`,
        [input.invoiceId],
      );
      if (!invoice) {
        throw new PaymentError("NOT_FOUND", "Invoice was not found.");
      }

      const receipt = createPaymentReceipt(
        {
          id: input.invoiceId,
          version: invoice.version,
          totalCents: BigInt(invoice.total_cents),
          paidCents: BigInt(invoice.paid_cents),
        },
        input,
        actorId,
      );
      const { payment } = receipt;
      await client.query(
        `INSERT INTO routebook.payments (id, invoice_id, amount_cents, received_by, received_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          payment.id,
          payment.invoiceId,
          payment.amountCents.toString(),
          payment.receivedBy,
          payment.receivedAt,
        ],
      );

      const updated = await client.query(
        `UPDATE routebook.invoices
            SET version = version + 1
          WHERE id = $1 AND version = $2`,
        [input.invoiceId, input.expectedInvoiceVersion],
      );
      if (updated.rowCount !== 1) {
        throw new PaymentError(
          "STALE_VERSION",
          "This invoice changed. Refresh it before paying.",
        );
      }

      await client.query(
        `UPDATE routebook.van_days SET revision = revision + 1 WHERE id = $1`,
        [vanDay.id],
      );

      return {
        status: 201,
        body: { success: true, data: { ...serializePaymentResponse(receipt) } },
      };
    },
  });
}
