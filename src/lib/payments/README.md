# Payments module

Domain service for API-10: `POST /api/invoices/{id}/payments`.

## Request flow

1. Validate the actor is present, active, and a driver.
2. Validate the invoice ID and idempotency key are UUIDs, the expected
   invoice version is a positive integer, and the amount is positive and
   within `MAX_CENTS`.
3. Open a store transaction and lock the invoice and day. Concurrent writes
   for the same day wait here, so a same-key request cannot race the first
   operation lookup.
4. Look up the operation by `(actorId, idempotencyKey)`.
5. If the operation exists:
   - reject with `IDEMPOTENCY_KEY_REUSED` when the method route or request
     hash differs;
   - recheck that the actor is still the assigned driver;
   - return the stored original receipt unchanged.
6. Otherwise, verify the assigned driver, `OPEN` day, current invoice version,
   and stored amounts.
7. Compute the settlement. The amount may not exceed the positive
   outstanding balance.
8. Insert the immutable payment with `receivedBy` and `receivedAt`.
9. Increment the invoice version and day revision.
10. Store the operation receipt with method route, request hash, HTTP status,
    and the serialized response.
11. Commit and return the receipt.

A replay returns the original stored totals even if the invoice changed
afterwards. The client refetches the current invoice for display.

## Error mapping

| Code                     | HTTP |
| ------------------------ | ---- |
| `INVALID_REQUEST`        | 422  |
| `INVALID_IDEMPOTENCY_KEY`| 422  |
| `INVALID_VERSION`        | 422  |
| `INVALID_AMOUNT`         | 422  |
| `INVALID_INVOICE_DATA`   | 500  |
| `INACTIVE_ACTOR`         | 403  |
| `FORBIDDEN`              | 403  |
| `NOT_FOUND`              | 404  |
| `DAY_NOT_OPEN`           | 409  |
| `DAY_CLOSED`             | 409  |
| `STALE_VERSION`          | 409  |
| `PAYMENT_EXCEEDS_BALANCE`| 422  |
| `IDEMPOTENCY_KEY_REUSED` | 409  |

`PaymentError` exposes both `code` and `httpStatus`.

## Store contract

`PaymentStore.transaction` must make the callback atomic and serialize
concurrent writes that target the same van day or the same actor/request key.
A PostgreSQL adapter should use `BEGIN`/`COMMIT`, `SELECT ... FOR UPDATE` on
the day and invoice rows, and a unique constraint on
`(actor_id, request_key)`.

`PaymentTransaction` requirements:

- `findInvoiceForUpdate` locks the van day and invoice and returns the
  authoritative assigned driver and day state.
- `updateInvoiceAfterPayment` rejects when the current version differs from
  `expectedVersion`.
- `insertOperation` enforces the unique key and, on a concurrent unique
  conflict, the adapter retries the transaction and replays the stored
  receipt.
- Deadlock and serialization failures (`40P01`, `40001`) are retried by the
  adapter.

The service itself is transaction-agnostic; it does not rely on an in-process
mutex, so multiple service instances sharing one store remain safe.

## Response shapes

`serializePaymentResponse` returns exactly the API-10 success fields:

```json
{
  "paymentId": "…",
  "amountCents": "1000",
  "invoiceVersion": 2,
  "totalPaidCents": "1000",
  "balanceCents": "1000"
}
```

`serializePaymentReceipt` is the JSON-safe stored operation receipt. It adds
the invoice and collection audit fields needed to replay the exact original
receipt:

```json
{
  "paymentId": "…",
  "invoiceId": "…",
  "amountCents": "1000",
  "receivedBy": "…",
  "receivedAt": "2026-11-22T10:00:00.000Z",
  "invoiceVersion": 2,
  "totalPaidCents": "1000",
  "balanceCents": "1000"
}
```

## Tests

`payment.test.ts` covers happy paths, partial and full payments, replay,
cross-invoice key reuse, authorization, inactive actors, day states, stale
versions, excess balances, invalid input, concurrency, rollback, serialization,
and the default clock/ID generator.
