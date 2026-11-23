# Money module

Exact money handling for RouteBook. Amounts are integer USD cents stored as
`bigint`; JSON responses use canonical decimal strings.

## Invariants

- No floating-point arithmetic is used for money.
- `MAX_CENTS` is `5_000_000_000_000_000n`.
- A single stored amount is in `[-MAX_CENTS, MAX_CENTS]` when signed, or
  `[0, MAX_CENTS]` when unsigned.
- A unit price is in `[1, MAX_PRODUCT_PRICE_CENTS]`.
- A sale quantity is a whole number in `[1, MAX_QUANTITY]`.
- An invoice has at least one line.
- An invoice total is in `[1, MAX_CENTS]`.
- Aggregate customer and day totals may exceed `MAX_CENTS`; they are not
  stored as one record.

## Parsing and formatting

```ts
parseCentsString("1500"); // 1500n
parseCentsString("-500"); // -500n
parseNonNegativeCentsString("1500"); // 1500n
formatCents(1500n); // "1500"
```

`parseCentsString` accepts a leading minus, but not `-0`, leading zeros,
fractions, exponents, whitespace, or a leading plus. It enforces the signed
maximum. `parseNonNegativeCentsString` rejects a minus sign and enforces the
unsigned maximum.

## Formulas

For invoice total `T`, recorded payments `P`, and one payment amount `A`:

```text
balance     = T - P
outstanding = max(T - P, 0)
excess      = max(P - T, 0)
status      = UNPAID        when balance > 0 and P = 0
              PARTIAL       when balance > 0 and P > 0
              PAID          when balance = 0
              EXCESS_REVIEW when balance < 0
```

A customer account adds opening debt separately:

```text
signedBalance = openingBalance + sum(T) - sum(P)
```

Invoice outstanding and excess totals are summed per invoice. They are never
netted against opening debt or another invoice.

`aggregatePaymentsByInvoice` groups a flat payment list before joining it to
invoice totals, which prevents one invoice line from multiplying its payments.

## JSON serialization

`serializeInvoiceSettlement` and `serializeCustomerAccountSummary` convert
every `bigint` field to a decimal string. Use these at the API boundary;
`JSON.stringify` throws on raw `bigint` values.

## Error codes

| Code                   | Meaning                                         |
| ---------------------- | ----------------------------------------------- |
| `INVALID_CENTS`        | Not a canonical decimal integer amount          |
| `AMOUNT_OUT_OF_RANGE`  | Outside the allowed inclusive range             |
| `INVALID_QUANTITY`     | Not a whole unit in the allowed range           |
| `AMOUNT_OVERFLOW`      | Invoice total above `MAX_CENTS`                 |
| `INVOICE_HAS_NO_LINES` | Invoice total requested for an empty invoice    |

## Schemas

`schemas.ts` exposes Zod schemas for opening balances, payment amounts,
counted cash, unit prices, quantities, invoice creation, corrections, and
closing. Amounts are validated as strings and transformed to `bigint` for the
domain layer.
