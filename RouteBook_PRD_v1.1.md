# RouteBook — Product Requirements Document v1.1

Source: [PRD-Improved model](https://app.notion.com/p/41bf70cb83b2806ba962f1a6eaafd56c)

# TechTalks | Software Engineering Internship — November 2026

**Team PRD · Draft v1.1 · Based on the TechTalks PRD template v1.1**

## Document Control

| Field | Team response |
| --- | --- |
| Project name | RouteBook |
| Development track | React.js / Next.js |
| Team leader | Mohammad Sayed Ahmad |
| Team members | Jad Youssef el Issa, Mohammad Sayed Ahmad, Mahdi Amin Harissa, Mostafa Borshalli, Nour Komayha |
| PRD version | 1.1 |
| Last updated | 2026-11-17 |
| Discovery & Validation document | RouteBook — User Interviews and Validation Findings |
| Review status | Draft for team review |

**Executive summary.** A van-sales driver can record a payment at a shop and still leave without a reliable count of what remains in the van. RouteBook connects each online sale and payment to the van load so the driver can check available stock and the supervisor can explain stock, cash, and customer balances at day’s end. RouteBook also maintains customer account records, including invoice history, payment history, outstanding amounts, and verified opening balances for existing customer debts.

## 1. Problem & Target Users

### 1.1 Problem Statement

The driver interviewed by the team records payments in software but relies on memory for stock and deliveries. The distributor records each order separately on paper and sometimes miscalculates payments. By the next shop visit, the driver can be unsure which items are available, and at closing the distributor has to reconstruct what sold.

Manual records can also make it difficult to track how much each customer owes, identify previous payments, and understand how an outstanding balance changed over time.

### 1.2 Primary User

- **Primary user / role:** A van-sales driver at a small distributor.
- **Relevant context:** During an assigned shop visit, the driver needs to check the van’s stock, record the items delivered, and enter the cash received.
- **Primary need:** See what remains available for the next stop after each sale.
- **Secondary user:** The depot supervisor assigns visits, records the opening load, corrects invoice errors, manages customer account records, and checks the van and cash on return.

### 1.3 Evidence From Discovery

| Finding | Evidence or source | Implication for the MVP |
| --- | --- | --- |
| The driver sometimes arrives with missing or incorrect items and loses track of what sold. | Team interview with a driver using payment software | Show assigned visits and deduct each sale from the driver’s van stock. |
| Separate paper orders give no running stock count. Manual payment calculations sometimes produce errors. | Team interview with a distributor | Link invoice, payment, and remaining balance. Provide expected quantities and cash for closing. |
| The owner already has a complete system and described occasional waits for updates as minor. | Team interview with a business owner | Focus the first release on distributors whose stock and payment records are disconnected. |

**Not yet validated.** Route connectivity, daily counting practices, and how staff handle partial payments, existing customer debts, and corrections require follow-up in Section 7.

## 2. MVP Goal & Product Outcome

### 2.1 One-Sentence Goal

> Our MVP enables a van-sales driver to record a shop sale and its payment online and see the remaining stock without reconstructing the delivery from memory.

### 2.2 Expected User Outcome

At the next stop, the driver can see how many units remain. Back at the depot, the supervisor can compare the physical count and cash in hand with the records, see what each customer owes, review the customer's invoice and payment history, and trace a corrected quantity to the original invoice.

### 2.3 Success Indicator

| Metric / indicator | How it will be measured | Target or pass condition |
| --- | --- | --- |
| Accuracy after a quantity correction | Run the shop visit in Section 6 and compare the closing figures with an independent count. | 85 bottles, $15 cash, $0 owed. Both stock and cash differences equal zero. Exactly one invoice, one payment, and one recorded correction. |
| Customer account accuracy | Test an existing opening balance, a new invoice, and multiple payments against the account calculation. | Customer account history shows the correct invoices and payments, with the correct outstanding and total customer balance. |

## 3. Core User Journey

**Scenario.** A driver delivers 15 bottles to a shop, enters 20 by mistake, and collects $15. The supervisor corrects the invoice before checking the van back in.

1. **Starting point.** At the depot, the supervisor assigns the shop visit to the driver and records 100 bottles on the van.
2. **First action.** At the shop, the driver opens the assigned visit and selects the bottle priced at $1.
3. **System response.** RouteBook shows 100 bottles available. When the driver enters 20, it displays a $20 invoice total.
4. **Core action.** The driver confirms the sale and records $15 cash. The invoice shows $5 owed and the van record shows 80 bottles.
5. **System outcome.** After confirming that only 15 bottles were delivered, the supervisor changes the quantity to 15. RouteBook shows 85 bottles available, a $15 invoice, $15 collected, and $0 owed.
6. **Completion.** The supervisor counts 85 bottles and $15 cash, enters both counts, and sees zero difference for each. The invoice history identifies who corrected the quantity. The customer's account history retains the invoice and its payment.

### Alternative & Failure Paths

| Situation | Expected product behavior |
| --- | --- |
| Missing customer, zero or negative sale quantity, or quantity above available stock | Identify the field or available quantity. Keep the sale unposted and preserve existing totals. |
| Driver repeats confirmation after a slow response | Show the outcome of the original transaction. Count the sale, payment, or correction once. |
| Driver attempts to correct a posted invoice | Deny the correction and preserve the invoice, stock, cash, and balance. |
| Connection drops during confirmation | Show that confirmation is pending verification. Once online, let the driver check the result before retrying. |
| Physical stock or cash differs from the expected figure | Show expected, counted, and signed difference separately for each. Preserve the recorded sale and payment. |
| Customer pays only part of an invoice | Record the amount received as a separate payment transaction and show the remaining invoice amount as outstanding. |
| Customer makes multiple payments for the same invoice | Preserve each payment separately and update the invoice outstanding amount and customer balance after each payment. |
| Customer has a debt from before RouteBook | Allow an authorized supervisor to enter a verified opening balance and include it in the customer's account balance. |
| A payment is greater than the corrected invoice total | Preserve the payment record and flag the excess amount for supervisor review. Do not automatically delete or change the payment. |

## 4. Functional Requirements

### R1 — Customer records and assigned visits

- **Priority:** Must-have
- **User story:** As a supervisor, I want to assign a customer visit to a driver so the driver records the delivery against the correct shop and the customer's account remains organized.
- **Expected behavior:** The supervisor can create a customer and manually assign a visit. The driver can open the shop from their assigned visits. Each customer record provides access to the customer's account information, including invoice history, payment history, and current balance. An authorized supervisor can enter a verified opening balance for debts that existed before RouteBook.
- **Acceptance criteria:** **Given** a new customer named Cedar Market, **when** the supervisor assigns its visit to Driver A, **then** Driver A can open Cedar Market and its sale form. **Given** no customer is selected, **when** the driver confirms a sale, **then** RouteBook requests a customer and creates no invoice. **Given** Cedar Market has a verified opening balance of $30, **when** the supervisor saves it, **then** the customer account displays the $30 opening balance.

### R2 — Opening load and available stock

- **Priority:** Must-have
- **User story:** As a driver, I want the available quantity for each product in my van so I know what I can deliver.
- **Expected behavior:** The supervisor records the quantity loaded per product. Confirmed sales reduce the selling van’s available stock. If an authorized invoice correction changes the delivered quantity, the recorded stock is adjusted accordingly.
- **Acceptance criteria:** **Given** an empty van, **when** the supervisor records 100 bottles, **then** its driver sees 100 available. **Given** 100 available, **when** the driver attempts to sell 101, **then** RouteBook displays the available quantity and keeps stock at 100. **Given** a confirmed sale of 20 bottles is corrected to 15 bottles by a supervisor, **then** the recorded stock increases by five bottles.

### R3 — Online sales and invoices

- **Priority:** Must-have
- **User story:** As a driver, I want to record the products sold at a shop so I can show the customer the quantities, prices, and total.
- **Expected behavior:** A confirmed online sale creates one customer invoice and deducts each sold quantity once. Each line shows product, quantity, unit price, and amount. Each invoice is linked to the relevant customer account and appears in the customer's invoice history with its date and total amount.
- **Acceptance criteria:** **Given** 100 bottles at $1 each, **when** the driver confirms 20 bottles for Cedar Market, **then** one $20 invoice is visible and 80 bottles remain. The invoice appears in Cedar Market's account history. **When** the same confirmation is retried, **then** the same invoice and stock count remain visible, without creating a duplicate invoice.

### R4 — Payments and authorized invoice corrections

- **Priority:** Must-have
- **User story:** As a driver, I want to record the amount actually collected so the supervisor can correct a delivery error and still account for the cash in my hand.
- **Expected behavior:** The system accepts full or partial payments and supports multiple payments against the same invoice. Each payment is stored as a separate transaction linked to its invoice and customer. The invoice outstanding amount and customer balance are updated after every payment. A supervisor can correct a posted quantity. The system updates the invoice, stock, and customer balance together and records the editor and the old and new quantities. Original payment records must remain unchanged after an invoice correction. If payments exceed the corrected invoice total, the system flags the excess amount for review.
- **Acceptance criteria:**
  - **Given** a $20 invoice and zero opening balance, **when** the driver records $15, **then** cash collected is $15 and the customer owes $5.
  - **When** the supervisor corrects 20 bottles to 15 at $1 each, **then** stock rises by five, the balance falls to $0, and the original $15 payment appears once.
  - **Given** a $20 invoice, **when** the customer makes a $10 payment and later another $10 payment, **then** the system records two separate payments, the invoice outstanding amount becomes $0, and the customer's balance is updated correctly.
  - **Given** a $20 invoice with $20 already paid, **when** the supervisor corrects the invoice total to $15, **then** the original $20 payment remains recorded and the $5 excess is flagged for review.
  - **When** the correction is retried, **then** only one change from 20 to 15 appears in history.

### R5 — End-of-day reconciliation

- **Priority:** Must-have
- **User story:** As a supervisor, I want to compare the driver’s counts with expected stock and cash so I can identify a shortage and review outstanding customer balances.
- **Expected behavior:** Show expected and counted stock per product, expected and counted cash for the van day, and outstanding balances by customer. Calculate each difference as counted minus expected. The supervisor can review customer account balances and the invoices and payments that contribute to those balances. Entering physical counts must not automatically modify invoices, payments, or customer account balances.
- **Acceptance criteria:** **Given** expected stock of 85 bottles and expected cash of $15, **when** the supervisor enters 85 and $15, **then** both differences are zero. **Given** the same expectations, **when** the counts are 84 and $13, **then** the summary shows shortages of one bottle and $2, and the customer’s balance stays unchanged. **Given** a customer with an opening balance, invoices, and payments, **when** the supervisor reviews the customer's account, **then** RouteBook displays the correct outstanding balance and the related transaction history.

## 5. MVP Scope, Boundaries & Product Rules

### 5.1 In Scope

Customer records and manual visit assignment (R1), van loading and stock tracking (R2), online sales and invoices (R3), full or partial payments, multiple payments, customer account records, and authorized quantity corrections (R4), and daily stock, cash, and customer balance review (R5).

Customer invoice history, payment history, verified opening balances, and outstanding balance calculations are supporting capabilities within the five existing features. They are not separate features.

### 5.2 Explicitly Out of Scope

Offline sales and synchronization, product returns, GPS and maps, route optimization, advanced customer statements, retailer portals, and ERP integrations. The correction in Section 6 fixes a data-entry error on goods that never left the van. Automatic refunds, advanced credit management, and complex accounting workflows are also outside the MVP.

### 5.3 Product Rules & Constraints

| Rule ID | Product rule | Reason |
| --- | --- | --- |
| BR-01 | Drivers work with their assigned visits and van. Supervisors manage opening loads and authorize posted-invoice corrections. | Keep customer and cash records within the relevant staff roles. |
| BR-02 | Available stock per product equals the opening load minus corrected units sold. A sale cannot take available stock below zero. | The driver needs a usable quantity for the next visit. |
| BR-03 | Customer balance equals opening balance plus corrected invoice totals minus recorded payments. Expected cash equals cash payments collected that day. | Unpaid sales contribute to receivables. Cash represents money actually received. |
| BR-04 | Apply each confirmation once. Keep the original payment and retain the editor and before-and-after quantities for a correction. | A retry or quantity correction must never count the same money twice. |
| BR-05 | Show physical counts and differences alongside expected figures. Entering a count does not alter the invoice or customer balance. | A depot shortage and a customer debt require different follow-up. |
| BR-06 | Each customer account maintains its invoice history, payment history, and calculated outstanding balance. | The supervisor needs to understand what each customer owes and how the balance was calculated. |
| BR-07 | Opening customer balances must be entered by an authorized user and represent verified debts from before RouteBook. | Existing customer debts must not be lost when the system is introduced. |
| BR-08 | Each payment is recorded as a separate transaction linked to its invoice. Full, partial, and multiple payments are supported. The invoice outstanding amount is recalculated after each payment. | Preserve an accurate record of every amount collected and the remaining amount due. |
| BR-09 | If total recorded payments exceed the corrected invoice amount, preserve all payment records and flag the excess for review. | A correction must not silently delete money already received or change the payment history. |
| BR-10 | Recorded stock is updated based on the actual quantity delivered and confirmed by the driver. | Stock should reflect goods delivered, not an incorrect quantity entered on an invoice. |

## 6. End-to-End MVP Acceptance Test

| Item | Required description |
| --- | --- |
| Test name | Correct an overstated delivery and reconcile one van day |
| Related requirements | R1–R5 |
| Test users / roles | One supervisor and one driver with separate accounts |
| Test data / initial state | One empty van, one new shop (Cedar Market), bottles priced at $1 each. Start a fresh day with $0 cash, $0 customer balance, and no transactions. |
| Test actions | Assign visit and load van, record sale and payment, attempt unauthorized correction, correct as supervisor, retry correction, enter physical counts, and review the customer account. |
| Expected results | Values at each checkpoint are shown below. The customer account history and payment records remain accurate. |
| Measurable pass condition | All checkpoints match, both closing differences are zero, and there is exactly one invoice, one payment, and one correction. |
| Failure / abuse test | An attempted driver correction is denied. The invoice and all totals remain at their pre-correction values. Repeated confirmation must not create duplicate records. |

### Test Procedure

1. As supervisor, create Cedar Market, assign its visit to the driver, and record an opening load of 100 bottles. As driver, open the visit and verify the stock.
2. Simulate handing over **15 bottles** and collecting **$15**. Deliberately enter **20 bottles** on the invoice, confirm the sale, and record the $15 payment once. Check the second row below.
3. As driver, try to change the posted quantity to 15. Verify that the action is denied and the second-row values still hold.
4. As supervisor, open the same invoice and correct the quantity to 15. Repeat the same correction request. Verify the final row and one history entry showing the supervisor changed 20 to 15.
5. Enter the physical counts of 85 bottles and $15 cash. Verify zero difference for each and a zero balance for Cedar Market. Open the invoice and payment records and count them.

| Checkpoint | Invoice total | Bottles on record | Cash collected | Cedar Market owes |
| --- | --- | --- | --- | --- |
| Opening load | — | 100 | $0 | $0 |
| 20 entered, $15 received | $20 | 80 | $15 | $5 |
| Corrected to 15 delivered | $15 | 85 | $15 | $0 |

**Pass condition.** All checkpoint values match. The supervisor can trace the five-bottle change, the single $15 payment, and the zero closing differences to one sale. The denied attempt and the retry create no additional adjustments.

### Additional Customer Account Acceptance Test

**Test data:**

- Customer: Cedar Market.
- Verified opening balance: $30.
- New invoice: $20.

**Test procedure:**

1. As supervisor, enter a verified opening customer balance of $30.
2. Record a new $20 invoice for the customer.
3. Record a first payment of $10.
4. Record a second payment of $10 against the same invoice.
5. Open the customer's account history and verify the results.

| Checkpoint | Opening balance | Invoice total | Payments recorded | Invoice outstanding | Total customer balance |
| --- | --- | --- | --- | --- | --- |
| Opening account | $30 | — | $0 | — | $30 |
| New invoice | $30 | $20 | $0 | $20 | $50 |
| First payment | $30 | $20 | $10 | $10 | $40 |
| Second payment | $30 | $20 | $20 | $0 | $30 |

**Expected results:**

- The account displays the $30 opening balance.
- The invoice appears once in the customer's invoice history.
- Both $10 payments appear as separate transactions.
- The invoice outstanding amount becomes $0.
- The total customer balance returns to $30.
- The system preserves the dates and amounts of the invoice and payments.

### Additional Overpayment Acceptance Test

**Test data:** A customer has a $20 invoice and has already paid $20.

**Test procedure:**

1. The supervisor corrects the invoice total from $20 to $15.
2. The system recalculates the invoice outstanding amount.
3. The supervisor opens the customer's account and reviews the payment history.

**Expected results:**

- The corrected invoice total is $15.
- The original $20 payment remains unchanged.
- The invoice has no outstanding amount.
- The $5 excess is flagged for supervisor review.
- The system does not automatically delete the payment or issue a refund.

## 7. Open Questions & Assumptions

| Open question / assumption | Why it matters | How the team will resolve it |
| --- | --- | --- |
| **Not yet validated.** Can the driver connect during typical shop visits? | The MVP requires online confirmation. | Ask a driver to check connectivity at representative stops and record where confirmation would be delayed. |
| **Not yet validated.** Who counts stock and cash, and how does the depot investigate a shortage? | The closing summary must support the actual handover. | Observe one end-of-day count with a driver and supervisor and compare it with Section 3. |
| **Not yet validated.** Who authorizes corrections, and what happens if the revised total is below the payment already received? | The proposed supervisor role and handling of excess payments need field confirmation. | Walk through one partial payment and one overpayment example with the distributor before finalizing the correction rules. |
| **Not yet validated.** How are existing customer debts verified before entering opening balances? | Incorrect opening balances would affect all future customer account calculations. | Confirm the source of existing debt records and who is authorized to approve them. |
| **Not yet validated.** Should an excess payment be refunded, retained as customer credit, or applied to a future invoice? | The MVP must identify excess payments without making an unapproved financial decision. | Confirm the distributor's preferred process. For the MVP, flag the excess for supervisor review without automatically refunding or applying it. |
| **Not yet validated.** Can customers make multiple payments over different visits or days? | Payment history and invoice outstanding amounts must remain accurate over time. | Confirm the expected payment process with the distributor and driver. |

**Final MVP boundary:** RouteBook contains exactly five core features (R1–R5). Customer account history, opening balances, partial and multiple payments, and overpayment handling are supporting requirements within those five features. They do not create a sixth feature.

