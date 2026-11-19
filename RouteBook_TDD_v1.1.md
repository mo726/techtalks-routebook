# RouteBook - Technical Design Document (TDD)

**TechTalks | Software Engineering Internship - November 2026**  
**Team design draft | Version 1.1 | 19 November 2026**

## Document Control

| Field | Team response |
|---|---|
| Project name | RouteBook |
| Development track | React.js / Next.js |
| Team leader | Mohammad Sayed Ahmad |
| Team members | Jad Youssef el Issa, Mohammad Sayed Ahmad, Mahdi Amin Harissa, Mostafa Borshalli, Nour Komayha |
| Responsibilities | Mohammad coordinates review and unresolved decisions. Implementation area owners are TBD by the team at M1. No individual implementation assignments have been confirmed. |
| TDD version | 1.1 |
| Last updated | 2026-11-19 |
| PRD reference | PRD-Improved model v1.1; document dated 2026-11-17; current content retrieved 2026-11-19 (page edit metadata: 2026-11-19T16:51:43.390Z). [Open PRD v1.1](https://app.notion.com/p/41bf70cb83b2806ba962f1a6eaafd56c) |
| Review status | Draft for team review. The referenced PRD remains marked Draft. Review approval has not been verified. |

### Revision Record

This revision supersedes TDD v1.0 as the working design and aligns it with PRD Improved model v1.1. Mohammad identifies this as Mahdi’s recent revision; editor identity is user-reported. Added customer account history, verified opening-debt provenance, explicit multiple-payment contracts, and excess-payment review instead of automatic credit classification. Added tests T-15 through T-18 and expanded T-11. The PRD remains Draft; this update does not assert approval or implementation.

### Executive Technical Summary

RouteBook will use a responsive Next.js application for drivers and supervisors, with Route Handlers providing a same-origin JSON API. PostgreSQL stores customers, assigned visits, van loads, invoices, payments, corrections, and closing counts, while Supabase Auth manages staff sign-in. The backend calculates stock and balances from stored transactions and commits financial changes atomically. One deployment serves one distributor, with an online workflow from van loading to daily reconciliation. The stack, cash-only USD baseline, and closing rules below are proposed engineering decisions for this draft and require team review.

Customer account reporting uses the existing customer, invoice and payment relationships. Verified opening debts carry source, supervisor and timestamp metadata. Excess after correction is flagged for review without automatic refunds or allocation. These remain supporting capabilities within R1-R5, not additional core features.

### Requirements Traceability

| PRD ID | Requirement | Components | Test reference |
|---|---|---|---|
| R1 | Customers, assigned visits, account history and verified opening debt | Customer/account pages, verification service | T-01, T-06, T-15, T-16 |
| R2 | Opening load and available stock | Van-day service, stock queries | T-02, T-07 |
| R3 | Online sales, invoices and customer invoice history | Sale form, invoice service, account history | T-03, T-05, T-07, T-15 |
| R4 | Full, partial and multiple payments; corrections; excess review | Payment service, correction history, review flags | T-03, T-04, T-05, T-06, T-08, T-11, T-15, T-17 |
| R5 | Daily reconciliation and traceable customer balances | Closing page, account reporting | T-03, T-09, T-10, T-15, T-18 |

## 1. Technology Stack

| Layer | Selected design baseline | Responsibility and reason |
|---|---|---|
| Frontend / UI | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 | Responsive forms and role-specific pages within the team's development track. |
| Backend / API | Next.js Route Handlers on Node.js 24 | Same-origin API and domain services in one application. Use the Node runtime for database access. |
| Database | PostgreSQL 17 baseline, hosted by Supabase | Foreign keys, exact integer arithmetic, transactions and row locking support linked stock and cash changes. Verify the provisioned major version at M1. |
| Database access | node-postgres (pg 8), parameterized SQL and versioned SQL migrations | Explicit queries and transaction boundaries make the stock/correction workflow reviewable. |
| Authentication | Supabase Auth, supabase-js 2 and @supabase/ssr | Managed email/password staff accounts and cookie-based sessions. Roles remain in the application database. |
| Validation | Zod 4 | Shared field definitions with authoritative server validation. |
| File storage | None | The MVP stores records and displays invoices in the browser. |
| Background processing | None | Each action finishes in a short request transaction. |
| Hosting | Vercel application and Supabase database/auth | Managed deployment for the internship demo. Accounts and selected plans remain to be confirmed. |
| Testing / CI | Vitest, Playwright, PostgreSQL integration tests, GitHub Actions | Verify calculations, real database behavior, permissions and the complete browser journey. |

Pin exact compatible package versions in the lockfile at M1, including the Next.js/React pair, and record the PostgreSQL server version. These are design baselines, not claims that a repository or deployment already exists. Next.js installation and deployment requirements are documented in [S1].

**Key alternative considered.** A separate Express service would add a second deployment and cross-origin session configuration. The chosen single application keeps UI and API releases together. SQL access requires the team to maintain query types and migrations, a trade-off accepted for this small relational model.

**External dependencies.** Supabase Auth and PostgreSQL, Vercel hosting, and GitHub CI. The runtime uses a pooled database connection, with a module-level pool capped initially at one connection per warm application instance and no named prepared statements [S4]. Limits, selected plans and budget are TBD at M1. No price or uptime commitment is assumed.

**Track alignment.** React components and Next.js server features implement the complete MVP while preserving one clear database boundary.

## 2. System Architecture

### 2.1 Architecture Diagram

![RouteBook architecture](tdd_work/architecture.png)

The browser sends business requests only to the Next.js API. The API verifies the session and staff profile before calling a domain service. Supabase Auth owns identity and tokens. All business data belongs to the private application schema in PostgreSQL.

### 2.2 Component Responsibilities

| Component | Responsibility | Inputs / dependencies | Outputs |
|---|---|---|---|
| Driver UI | Assigned visits, stock, sale and payment forms, invoice view | Session, scoped API results | Explicit submissions and confirmation state |
| Supervisor UI | Customers, opening load, assignments, corrections and closing | Supervisor session | Validated management actions |
| API boundary | Identity, role, ownership, validation and error mapping | Verified Auth user, active staff profile | Authorized service call or rejection |
| Domain services | Sales, payments, corrections, reconciliation | Checked payload and database transaction | Persisted records and calculated totals |
| PostgreSQL | Constraints, locks and durable records | Parameterized SQL from server | Consistent query results |
| Supabase Auth | Login, refresh, logout and recovery | Staff credentials | Verified identity and managed session |

### 2.3 Primary Request / Data Flow

1. The supervisor creates a van day in PREPARING state, assigns its driver and visits, records product opening quantities and opens the day.
2. The driver opens an assigned visit. The API verifies identity and ownership and returns current quantities and prices.
3. The driver submits a sale with a unique request key. The backend validates active products and the assigned visit, locks the van day, and checks available stock.
4. In one transaction it inserts the invoice, its price-snapshot lines and a completed operation receipt. A successful response contains the invoice ID, version and remaining stock.
5. A separate payment request records the cash actually received. The interface keeps the invoice visible if payment recording fails, and retries only the payment operation.
6. A supervisor corrects a quantity using the current invoice version. The transaction records before/after values and updates the line quantity. Stock and balance queries immediately reflect the corrected quantity.
7. The supervisor previews closing, enters physical counts and confirms the displayed day revision. The backend locks the day, stores counts and expected-value snapshots, and changes the state to CLOSED.

### 2.4 Architecture Boundaries

- **In-process and external components.** UI, API and domain services share one application. PostgreSQL and Supabase Auth are managed services.
- **State ownership.** PostgreSQL owns posted transactions. Auth owns sessions. The browser owns unsent form values and the key used to confirm an uncertain request.
- **Assumptions.** One distributor per deployment, one driver per van day, whole-number product units, USD cents and cash collections. Multi-organization hosting and currency conversion require a separate scope decision.
- **Complexity boundary.** The MVP has no background queue, microservices, client database or offline sales synchronization. It also excludes returns, maps, route optimization, advanced statements, retailer portals and ERP integrations, as specified in the PRD.

## 3. Data Model & Entity-Relationship Diagram

### 3.1 ER Diagrams

The ERD is split into sales, audit and closing records for readability. Repeated entities refer to the same tables. Every arrow points from a referenced parent to a child and labels its cardinality. PK means primary key, FK means foreign key, and UQ means unique. A key marked PK may also be a foreign key, as specified in Section 4. Composite foreign keys and unique constraints are detailed there. The identity table auth.users is provider-managed; its 1 to 0..1 link to staff_profiles is enforced by staff_profiles.id.

![Sales and stock ERD](tdd_work/erd_sales_v11.png)

![Payment and audit ERD](tdd_work/erd_audit.png)

![Closing ERD](tdd_work/erd_closing.png)

### 3.2 Entity Catalog

| Entity | Purpose | Relationships |
|---|---|---|
| staff_profiles | Active application role for an Auth identity | Driver of van days, transaction actor |
| customers | Shop name, location and opening balance | Visits and invoices |
| products | Sale unit and current price | Loaded items and invoice lines |
| van_days | Driver, van code, business date and state | Loaded items, visits and closing |
| load_items | Immutable opening quantity after the day opens | One product per day |
| visits | Manual assignment of a customer to a van day | Zero or one invoice per visit |
| invoices | Posted customer sale and current version | One or more lines, payments, corrections |
| invoice_lines | Product, quantity and historical unit price | One product per invoice |
| payments | Immutable recorded cash collection | Invoice and collecting actor |
| invoice_corrections | Quantity change history with reason | Invoice line and supervisor |
| reconciliations | Final cash count and expected cash snapshot | Exactly one for a closed day |
| reconciliation_items | Physical and expected closing quantities | One per loaded product in the closing |
| operations | Durable retry receipt and request fingerprint | Unique per actor/request key |

### 3.3 Data Lifecycle

Staff accounts are provisioned by an administrator through Supabase Auth, then associated with a staff profile. The application provides no public registration. Customers and products can be archived; historical transactions remain readable. Opening quantities and assignments can change only in PREPARING. A confirmed invoice is retained, its line quantities can change through the correction service while the day is OPEN, and each change has an immutable audit entry. Payments are append-only. Closing freezes the day and stores a snapshot. Hard deletion of referenced records is blocked by foreign keys. Financial records and retry receipts remain for the demo lifetime; a real-business retention period must be agreed before real data is introduced.

## 4. Database Schema & Data Integrity

### 4.1 Core Tables

All tables live in schema routebook, which is not exposed through the Supabase Data API [S5]. Required fields are NOT NULL. IDs are generated UUIDs unless noted. Timestamps are UTC timestamptz. All foreign keys use ON DELETE RESTRICT. Each FK gets an index unless the same leading columns are already covered by a primary or unique key. Monetary fields use bigint cents, sent as decimal strings in JSON. Arithmetic uses SQL bigint/numeric or TypeScript BigInt, never floating-point money.

#### 4.1.1 staff_profiles

Identity and application permissions supporting all requirements.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK; FK auth.users(id) | Auth subject |
| display_name | varchar(120) | Yes | Length 1-120 | Staff label |
| role | text | Yes | DRIVER or SUPERVISOR | Server-owned role |
| active | boolean | Yes | Default true | Access switch |
| created_at | timestamptz | Yes | Default now() | Created time |

**Relationships, indexes and validation.** Index (role,active). Provision profiles with Auth accounts. App cannot change role through customer APIs. All references use RESTRICT on parent deletion.

#### 4.1.2 customers

R1 shop identity and R5 opening balance.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Customer ID |
| name | varchar(160) | Yes | Length 1-160 | Business label |
| location | varchar(240) | Yes | Length 1-240 | Delivery location |
| opening_balance_cents | bigint | Yes | Default 0; 0 to 5000000000000000 | Verified pre-RouteBook debt |
| opening_balance_source | varchar(500) | For positive debt | Length 5-500 when set | Reference to checked legacy records, no secrets |
| opening_balance_verified_by | uuid | For positive debt | FK staff_profiles | Supervisor who verified the debt |
| opening_balance_verified_at | timestamptz | For positive debt | Server-set timestamp | Verification date |
| active | boolean | Yes | Default true | Archival flag |
| created_at | timestamptz | Yes | Default now() | Creation time |

**Relationships, indexes and validation.** Index (active,name,id). Names are not unique because separate shops may share a name. Opening balance is set once by a supervisor before any invoice under a customer row lock. A positive balance requires a source reference and server-recorded verifier/time; a CHECK constraint requires all three provenance fields when positive. Reject negative opening debt. Invoice creation locks the same customer before the day. Once verified, opening debt is immutable in this draft; correcting verified legacy debt is an explicit unresolved workflow, never a silent PATCH. Preserve the original operation receipt as the verification record. All references use RESTRICT on parent deletion.

#### 4.1.3 products

Minimal catalog supporting R2/R3.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Product ID |
| name | varchar(160) | Yes | Length 1-160 | Product label |
| unit | varchar(40) | Yes | Length 1-40 | Bottle, box or other whole unit |
| price_cents | bigint | Yes | 1 to 100000000 | Current unit price |
| active | boolean | Yes | Default true | Archival flag |
| created_at | timestamptz | Yes | Default now() | Creation time |

**Relationships, indexes and validation.** Index (active,name,id). Catalog changes apply to future invoices only. All references use RESTRICT on parent deletion.

#### 4.1.4 van_days

R2/R5 workday and transaction lock target.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Day ID |
| van_code | varchar(40) | Yes | Normalized nonempty code | Stable fleet label |
| business_date | date | Yes | Business date in Asia/Beirut | Assigned day |
| driver_id | uuid | Yes | FK staff_profiles | Assigned DRIVER |
| state | text | Yes | PREPARING, OPEN, CLOSED | Lifecycle |
| revision | integer | Yes | Default 1; >0 | Changes on all day mutations |
| created_by | uuid | Yes | FK staff_profiles | Supervisor |
| created_at | timestamptz | Yes | Default now() | Creation time |

**Relationships, indexes and validation.** Unique (van_code,business_date). Partial unique van_code and driver_id for PREPARING/OPEN. Index (driver_id,business_date). Verify driver role/active status server-side. Driver and van/date become immutable on opening. All references use RESTRICT on parent deletion.

#### 4.1.5 load_items

R2 starting stock per product.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| day_id | uuid | Yes | PK part; FK van_days | Loaded day |
| product_id | uuid | Yes | PK part; FK products | Loaded product |
| opening_qty | integer | Yes | 1 to 1000000 | Units loaded |

**Relationships, indexes and validation.** Composite PK (day_id,product_id). Delete/replace these rows only during PREPARING. Opening stock is immutable after OPEN; remaining quantity is derived. All references use RESTRICT on parent deletion.

#### 4.1.6 visits

R1 manual shop assignment.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Visit ID |
| day_id | uuid | Yes | FK van_days | Assigned day |
| customer_id | uuid | Yes | FK customers | Assigned shop |
| position | integer | Yes | >0 | Manual visit order |
| created_at | timestamptz | Yes | Default now() | Created time |

**Relationships, indexes and validation.** Unique (day_id,customer_id), unique (day_id,position). One visit per customer/day is a draft scope choice. Assign only active customers before opening. All references use RESTRICT on parent deletion.

#### 4.1.7 invoices

R3 posted sale header.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Invoice ID |
| number | bigint identity | Yes | Unique; generated always | Display RB- plus number |
| visit_id | uuid | Yes | Unique FK visits | Customer/day ownership via visit |
| version | integer | Yes | Default 1; >0 | Correction/payment concurrency |
| created_by | uuid | Yes | FK staff_profiles | Driver |
| created_at | timestamptz | Yes | Default now() | Posting time |

**Relationships, indexes and validation.** Unique visit_id and number. Sequence gaps are acceptable. Totals and payment status are derived. All persisted invoices are posted, so no redundant status field is stored. All references use RESTRICT on parent deletion.

#### 4.1.8 invoice_lines

R3 quantities and historical prices.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Line ID |
| invoice_id | uuid | Yes | FK invoices | Parent invoice |
| product_id | uuid | Yes | FK products | Sold product |
| quantity | integer | Yes | 1 to 1000000 | Current corrected quantity |
| unit_price_cents | bigint | Yes | 1 to 100000000 | Price at sale |

**Relationships, indexes and validation.** Unique (invoice_id,product_id); unique (id,invoice_id) supports correction composite FK. Index product_id. Maximum 50 lines; quantities change only through audited correction. Snapshot price remains immutable. All references use RESTRICT on parent deletion.

#### 4.1.9 payments

R4 immutable cash record.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Payment ID |
| invoice_id | uuid | Yes | FK invoices | Paid invoice |
| amount_cents | bigint | Yes | 1 to 5000000000000000 | Cash received |
| received_by | uuid | Yes | FK staff_profiles | Assigned driver |
| received_at | timestamptz | Yes | Default now() | Recording time |

**Relationships, indexes and validation.** Index (invoice_id,received_at). Server checks current positive balance under invoice/day locks and requires expected invoice version. All payments are USD cash, so method/currency are deployment constants. All references use RESTRICT on parent deletion.

#### 4.1.10 invoice_corrections

R4 permanent quantity-change history.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Correction ID |
| invoice_id | uuid | Yes | FK invoices; composite FK with line_id | Invoice |
| line_id | uuid | Yes | Composite FK invoice_lines | Changed line |
| old_qty | integer | Yes | 1 to 1000000 | Before |
| new_qty | integer | Yes | 1 to 1000000; differs from old_qty | After |
| resulting_version | integer | Yes | >1 | Invoice version after change |
| reason | varchar(500) | Yes | Length 5-500 | Explanation |
| actor_id | uuid | Yes | FK staff_profiles | Supervisor |
| created_at | timestamptz | Yes | Default now() | Correction time |

**Relationships, indexes and validation.** Unique (invoice_id,resulting_version); index (invoice_id,created_at). Composite FK (line_id,invoice_id) references invoice_lines(id,invoice_id). Retain all events and historical unit price. All references use RESTRICT on parent deletion.

#### 4.1.11 reconciliations

R5 frozen closing cash snapshot.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| day_id | uuid | Yes | PK; FK van_days | One closing per day |
| expected_cash_cents | bigint | Yes | >=0 | Calculated inside close transaction |
| counted_cash_cents | bigint | Yes | >=0 | Physical count |
| closed_by | uuid | Yes | FK staff_profiles | Supervisor |
| closed_at | timestamptz | Yes | Default now() | Closing time |

**Relationships, indexes and validation.** PK supports day lookup; index closed_at. Cash difference is counted minus expected. Header and item counts commit with CLOSED state. All references use RESTRICT on parent deletion.

#### 4.1.12 reconciliation_items

R5 frozen product count snapshots.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| day_id | uuid | Yes | PK part; FK reconciliations | Closing |
| product_id | uuid | Yes | PK part; composite FK load_items | Product counted |
| expected_qty | integer | Yes | >=0 | Computed remaining units |
| counted_qty | integer | Yes | 0 to 1000000 | Physical units |

**Relationships, indexes and validation.** PK (day_id,product_id); composite FK to load_items(day_id,product_id). Store one row for every loaded product, including products with zero remaining. Difference is derived. All references use RESTRICT on parent deletion.

#### 4.1.13 operations

Technical support for duplicate-free R1-R5 writes.

| Field | Type | Required | Key / constraint | Meaning |
|---|---|---|---|---|
| id | uuid | Yes | PK | Receipt ID |
| actor_id | uuid | Yes | FK staff_profiles | Original actor |
| request_key | uuid | Yes | Unique with actor_id | Client retry key |
| method_route | varchar(240) | Yes | Normalized method/path | Operation identity |
| request_hash | char(64) | Yes | SHA-256 hex | Canonical request fingerprint |
| http_status | smallint | During commit | Success status 200-299 | Stored outcome |
| response_body | jsonb | During commit | Validated success envelope | Bounded replay response |
| created_at | timestamptz | Yes | Default now() | Request time |

**Relationships, indexes and validation.** Unique (actor_id,request_key), index created_at. A deferred constraint trigger rejects COMMIT while http_status/response_body are NULL. Provisional values exist only inside the transaction. Limit stored response to 64 KiB and omit credentials. No generic resource FK is needed because the receipt stores its response. All references use RESTRICT on parent deletion.


Customer opening debts are bounded from 0 to 5,000,000,000,000,000 cents. Each invoice total is bounded to 5,000,000,000,000,000 cents. Counted cash uses the same nonnegative cap. Aggregate customer/day sums use PostgreSQL numeric when summing bigint and remain decimal strings in responses. Reject arithmetic outside supported per-record bounds before writes.

### 4.2 Cross-Entity Integrity Rules

| Rule | Enforcement | Failure behavior |
|---|---|---|
| One day per van/date and one active day per van and driver | Unique (van_code, business_date), plus partial unique indexes on van_code and driver_id where state is PREPARING or OPEN | 409 DAY_CONFLICT |
| A sale belongs to its assigned visit and customer | Invoice has unique visit_id; day and customer are obtained through that visit | 404 for inaccessible visit, 409 for already invoiced visit |
| Available stock stays nonnegative | Under a van-day row lock, calculate opening_qty minus sum of current invoice quantities. Every invoice writer uses this lock. | 409 INSUFFICIENT_STOCK; rollback all lines |
| Payment and correction belong to the invoice day | Derive day from invoice -> visit; require OPEN and appropriate actor/ownership | 409 DAY_CLOSED or 403 FORBIDDEN |
| One product line per invoice and load | Unique (invoice_id, product_id), composite load PK | 422 DUPLICATE_PRODUCT |
| Correction history matches the line | Composite FK (line_id, invoice_id) to invoice_lines(id, invoice_id); old quantity read under lock | Rollback if history or line update fails |
| Closing counts cover every loaded product exactly once | Set comparison under day lock; composite FK from reconciliation_items(day_id, product_id) to load_items | 422 INCOMPLETE_COUNTS |
| Exactly one completed outcome per request key | Operations unique (actor_id, request_key); business write and receipt share transaction | Replay same result or 409 KEY_REUSED |

Available quantity is calculated per van day and product. Invoice total is the sum of quantity times its stored unit price. Signed invoice balance is invoice total minus its payments. Invoice outstanding is max(signed balance, 0); excess payment is max(-signed balance, 0). Customer balance is opening_balance_cents plus all invoice totals minus all payments across days. Return this signed account calculation separately from total unpaid invoice amounts and total excess awaiting review. Do not automatically allocate an invoice excess to opening debt or another invoice. A negative account result is labelled excess pending review, not approved spendable credit. Aggregate invoice lines and payments independently before joining to avoid multiplying amounts when an invoice has multiple lines and payments. Expected day cash is the sum of payments on invoices belonging to that day. This draft permits collections only while the originating day is OPEN; collecting older debts is a scope question in Section 10.3.

### 4.3 Transactions & Concurrency

Use one checked-out pg client for BEGIN, every query, COMMIT and ROLLBACK. Business writes use READ COMMITTED with SELECT ... FOR UPDATE on the affected van_days row before reading any stock, invoice version, payment sum or closing state. The day lock serializes sales, payments, corrections, assignment/load edits and closing for that van day [S3]. Reads of a whole report use one read-only REPEATABLE READ transaction so its cash, stock and balances share one snapshot [S6].

Every mutation has an Idempotency-Key UUID. After authentication, insert an operation row with status fields initially empty inside the same transaction. A unique-key collision waits for the first transaction; once it commits, compare the canonical request hash, method and route, recheck current access and return its stored result. Reusing the key with a different request returns 409. A failed transaction removes its provisional operation row. Completed rows are retained. There is no separately committed pending receipt.

For invoice creation, first lock its customer row to serialize against opening-balance edits, then lock the day. Opening-balance verification locks only the customer and rechecks invoice existence and whether the debt has already been verified. All other financial operations start with the day lock and never subsequently request a customer lock. Within a financial transaction, lock the day, recheck authorization/state, lock the invoice when applicable, validate the expected version, perform the writes, increment the day revision, complete the receipt, and commit. Two corrections with different keys and the same invoice version produce one success and one STALE_VERSION. A retry of the original successful key returns its original response even if the invoice has since changed; the UI refetches the current record.

Retry deadlocks (40P01) and serialization failures (40001) at most three times with short jitter, using the same key. Limit lock waits to two seconds and statement execution to five seconds, then rollback and return a retryable 503. Never call Auth or another network service inside a database transaction. If commit outcome is unknown, check the operation receipt or repeat the same key after reconnecting. All-or-nothing commits prevent partial invoices or orphaned audit changes.

## 5. API & Interface Design

### 5.1 Endpoint / Operation Overview

All routes use /api. Protected GET responses use Cache-Control: private, no-store. Lists accept cursor and limit, with a default of 25 and maximum of 100. The actor comes from the session. A request body cannot choose an actor or role. All mutations require an Idempotency-Key, including setup records.

| ID | Method and route | Role | Purpose / PRD |
|---|---|---|---|
| API-01 | GET /me | Staff | Current active profile; all requirements |
| API-02 | GET, POST /customers; PATCH /customers/{id} | Supervisor for writes; scoped driver reads | Customer details and archival; opening debt uses API-16; R1 |
| API-03 | GET, POST /products; PATCH /products/{id} | Supervisor writes, staff reads | Minimal product setup and current price; R2/R3 |
| API-04 | GET, POST /van-days | Supervisor writes, scoped driver reads | Create day with van code/date/driver; R2 |
| API-05 | PUT /van-days/{id}/load | Supervisor | Replace load in PREPARING, expected revision; R2 |
| API-06 | GET, POST /van-days/{id}/visits | Supervisor writes, assigned driver reads | Assign a shop; R1 |
| API-07 | POST /van-days/{id}/open | Supervisor | Freeze load/assignments and open day, expected revision; R2 |
| API-08 | GET /van-days/{id}/stock | Scoped staff | Current stock; R2 |
| API-09 | POST /invoices; GET /invoices/{id} | Assigned driver creates; scoped staff reads | Sale and invoice lines/history; R3 |
| API-10 | POST /invoices/{id}/payments | Assigned driver | Record cash against open-day invoice; R4 |
| API-11 | POST /invoices/{id}/corrections | Supervisor | Correct one line quantity with reason/version; R4 |
| API-12 | GET /van-days/{id}/reconciliation; POST /van-days/{id}/close | Supervisor | Preview or saved closing, then final counts; R5 |
| API-13 | GET /customers/{id}/balance | Supervisor or assigned-customer driver | Signed balance, outstanding and excess awaiting review; R1/R5 |
| API-15 | GET /customers/{id}/account | Supervisor or assigned-customer driver | Opening debt provenance, invoice/payment history, calculated totals; R1/R3/R4/R5 |
| API-16 | POST /customers/{id}/opening-balance | Supervisor | Verify and record opening debt once before invoices; R1/BR-07 |
| API-14 | GET /operations/{key} | Original actor | Check committed result after interrupted confirmation; all writes |

GET /van-days includes staff choices only in supervisor responses, allowing driver assignment without a separate user-management feature. Customer create requires name and location and starts with zero opening debt. Positive opening debt is recorded through API-16, not generic customer PATCH. Reject opening-balance and verification fields in other mutation bodies. Product create requires name, unit label and price. Archival uses PATCH active=false. Van-day create requires businessDate, vanCode and an active driver. Setup and opening operations return the created/updated resource with its revision. An already opened load cannot be edited.

### 5.2 Critical Operation Contracts

#### API-09 - Create invoice

**POST /api/invoices.** Requires a verified driver assigned to the visit's day, which must be OPEN. Body contains visitId UUID and 1-50 distinct lines, each with productId UUID, quantity integer 1-1,000,000 and expectedUnitPriceCents decimal string. Maximum request body is 64 KiB. The server reads product prices and rejects a changed displayed price with 409 PRICE_CHANGED so the driver can review it. It stores the current price as the invoice-line snapshot. Posted quantities cannot exceed available stock.

**Success 201.** Return invoice ID/number, version=1, line amounts, totalCents, paidCents, balanceCents and affected available quantities. Insert invoice and all lines, increment day revision, and commit the receipt atomically. There is exactly one invoice per visit. A multi-line failure rolls back the whole invoice. A distinct-key second invoice on the same visit returns 409 VISIT_ALREADY_INVOICED.

#### API-10 - Record payment

**POST /api/invoices/{id}/payments.** Requires the assigned driver and an OPEN day. Body contains amountCents as a positive decimal string and expectedInvoiceVersion. Payment amount must not exceed the current positive invoice balance. Under the day/invoice locks, create one immutable payment, increment invoice version and day revision, and complete the receipt.

**Success 201.** Return payment ID, amountCents, invoiceVersion, totalPaidCents and balanceCents. A retry with the original key returns the same payment. A simultaneous different-key payment with the old version returns 409 STALE_VERSION, allowing the driver to see what was already collected. If the sale succeeded and this request failed, only this request is retried.

#### API-11 - Correct invoice quantity

**POST /api/invoices/{id}/corrections.** Requires a supervisor, OPEN day, and body containing lineId UUID, newQuantity integer 1-1,000,000, expectedInvoiceVersion and reason of 5-500 characters. Read old quantity and historical unit price under lock. A higher quantity must fit the available stock. A lower quantity releases the difference back to the van. Equal quantities return 422 NO_CHANGE.

**Success 200.** Return correction ID, new invoice version, invoiceTotalCents, invoiceBalanceCents, availableQuantity and unchanged totalPaidCents. Update only the quantity and version, insert old/new quantities and reason, increment day revision and commit the receipt. For 20 -> 15 bottles at 100 cents with 1,500 cents paid, return total 1,500, balance 0 and available 85. A price change to the product catalog does not change this invoice's stored price.

**PRD v1.1 excess-payment rule.** Preserve every payment when a correction reduces an invoice below its paid amount. Return outstandingCents=max(total-paid,0), excessPaymentCents=max(paid-total,0), and reviewRequired=(excessPaymentCents>0), alongside the signed balance. For $20 paid and a corrected $15 total, return outstanding 0, excess 500 cents and reviewRequired=true. Display the flag on invoice, customer account and supervisor closing review. Do not create a refund, allocate the excess to another debt, or label it approved credit. The flag is derived from persisted amounts and remains visible after closing. There is no dismiss/refund/apply-credit endpoint in this MVP; final disposition remains a product question.

#### API-15 - Customer account and history

GET /api/customers/{id}/account returns one consistent snapshot: openingBalanceCents, signedBalanceCents, invoiceOutstandingTotalCents, excessPendingReviewTotalCents, reviewRequired, plus separately paginated invoices and payments. Use invoiceCursor/paymentCursor and limits 25 default, 100 maximum per list, ordered by timestamp then ID. Summary totals cover all qualifying records, not only the current page. Each invoice includes its ID/reference, date, total, paid, outstanding, excess and review flag. Each payment includes its own ID, invoice ID/reference, date and amount. The customer link is enforced through payment -> invoice -> visit -> customer; it is never accepted independently from the request. Show verified opening amount and, to supervisors only, source, verifier and verification date. Account totals include all customer invoices/payments, including closed days, under the visibility rule in Section 6.

Customer account UI: summary cards for opening debt, signed account balance, unpaid invoices and excess pending review; invoice and payment history lists; a clear alert linking to each overpaid invoice. Distinguish a fully paid invoice from a customer who still owes opening debt. Each $10 payment has a separate history row and timestamp. Empty states display zero totals and no transactions; failed reads show an error rather than zero balances.

#### API-16 - Verified opening debt

POST /api/customers/{id}/opening-balance requires a supervisor, Idempotency-Key, amountCents as a nonnegative bounded decimal string, sourceReference (5-500 characters) and verified=true. Server supplies verifier/time. Lock customer, reject if any invoice exists or opening debt is already verified (409 OPENING_BALANCE_LOCKED), persist amount and provenance with the receipt atomically. A replay returns the same result. Return 201 with amount and verification metadata. A driver receives 403 and no changes. This records a verified debt, not cash collected, so expected day cash stays unchanged. Zero-debt customers can use the default without this step.

#### Multiple payments and day boundaries

API-10 accepts repeated distinct payments for the same invoice, each with a new key and current invoice version. A $20 invoice paid as $10 plus $10 produces two immutable payments and zero outstanding. Replaying either key produces no extra payment. Account history preserves both dates and amounts. The current draft restricts collection to the original OPEN van day; PRD Section 7 explicitly leaves payments across visits/days unresolved. This restriction is provisional, not an approved requirement. Before enabling later-day collection, introduce an explicit collection_day_id on payments, authorize the collecting driver/current assignment, reconcile cash by collection day, and define locks for both day and invoice without rewriting a closed cash snapshot. Collecting opening debts also needs an allocation policy; it is not silently treated as payment against a new invoice.

#### Shared response and failure conventions

Amounts are strings to preserve exact integer cents. The example uses synthetic display values; actual resource identifiers are UUIDs.

```json
{"success":true,"data":{"invoiceNumber":"RB-000001","version":3,"totalCents":"1500","paidCents":"1500","balanceCents":"0","availableQuantity":85}}
```

```json
{"success":false,"error":{"code":"STALE_VERSION","message":"This invoice changed. Refresh it before correcting.","retryable":false}}
```

401 indicates missing/expired authentication. 403 indicates forbidden role. 404 hides nonexistent or unassigned records. 422 reports validation errors. 409 covers business conflicts, stale versions, closed days and key reuse. 503 indicates a temporary dependency/lock failure and permits same-key retry. Unexpected failures return 500 with a support request ID and no database details.

**Closing contract.** POST /van-days/{id}/close takes expectedRevision, countedCashCents >= 0 and one countedQuantity >= 0 for every load product. The server locks the day, verifies its revision, computes expected quantities/cash, stores reconciliation header/items and closes the day in one transaction. Response 201 includes expected, counted and signed differences. A different-key repeat on a closed day returns 409 DAY_CLOSED. Mismatches are saved visibly; they do not alter sales or customer balances.

## 6. Authentication, Authorization & Privacy

### 6.1 User Roles

Drivers record sales and payments only for their assigned van day and see its customers and invoices. For API-13/API-15, this draft permits account history and totals for customers assigned to the driver’s current OPEN day; other customers return 404. Full assigned-customer history is a proposed visibility interpretation requiring team review. A visible historical invoice does not grant mutation permission. Supervisor-only source/verifier details are omitted from driver responses. Supervisors prepare days, maintain catalog/customer details, correct quantities and reconcile all days within this distributor. Guests can access the login page only. Staff-account provisioning and role changes are administrator operations outside the ordinary application UI.

### 6.2 Permission Matrix

| Action | Guest | Driver | Supervisor |
|---|---|---|---|
| View assigned visits and stock | No | Own day | All days |
| Create sale and payment | No | Own OPEN day | No, under this draft role model |
| Maintain customers/products/load | No | No | Yes |
| Correct posted invoice quantity | No | No | OPEN day |
| View own invoice/payment history | No | Own day | All days |
| View assigned customer account and balance | No | Assigned customer only; proposed visibility boundary | All customers |
| Verify opening debt or close day | No | No | Yes |
| Retrieve operation receipt | No | Own key | Own key |
| Delete financial history | No | No | No |

### 6.3 Security Controls

**Authentication.** Use Supabase email/password sign-in for provisioned staff. Use the supported SSR cookie refresh flow, verify identity server-side with getUser for protected requests, and load role/active status from staff_profiles [S2]. Treat refresh failure as 401. Sign-out clears the browser session through Auth; disabling a profile blocks business access immediately on subsequent checks. Accept cookie handling provided by the SSR integration and use Secure and SameSite=Lax in HTTPS deployments.

**Authorization.** Every route and server-side data read verifies role and ownership. Proxy-based redirects provide navigation convenience; the API repeats authorization. A driver ID supplied in a URL never grants access. Query scope joins through visits and van_days. The private SQL runtime role has only necessary table privileges, with no schema ownership, DDL or DELETE permission on posted financial records.

**Input validation.** Validate UUIDs, enum values, lengths, list limits, quantity/cents ranges and day state server-side. Use parameterized SQL and escape rendered user text. Explicitly reject unknown body fields on mutations. Require same-origin Origin and a session-bound CSRF token for cookie-authenticated writes, including login/logout. Never put mutation behavior behind GET.

**Data protection.** Use HTTPS and encrypted database connections with certificate verification. Store only staff display names/identities and customer business names/location notes. Collect no customer bank details, card data or identity documents. Disable shared caching for authenticated data and exclude sensitive fields from error bodies and logs. Supabase owns password credentials; RouteBook stores no password hashes itself.

**Secrets and abuse controls.** Keep database credentials server-side and out of public-prefixed variables. Use platform secret storage. Auth's login protections handle identity attacks, and database-backed idempotency, payload limits and row locks protect business writes. Configure host request limits before a public demo if exposed to unauthenticated traffic; do not rely on per-process counters across serverless instances.

**Uploads and retention.** There are no uploads. Archive customer/product profiles without deleting invoice references. Keep synthetic records for review and reset only disposable test environments. Agree a real-data retention and deletion process before a live pilot, including how account removal preserves financial actor references.

**Primary security risk.** A driver changes an invoice ID in a request to access another driver's data. Ownership-scoped queries plus direct API tests must return 404 for those records, including payment history and operation receipts. Verify that routebook is absent from exposed API schemas and that anon/authenticated roles have no direct table access [S5].

## 7. Business Rules, State Transitions & Failure Cases

### 7.1 Critical Rules

| Scenario | Behavior and enforcement | User feedback |
|---|---|---|
| Duplicate confirmation | Unique actor/key plus atomic receipt replays committed result | Show saved invoice/payment reference |
| Two sales consume the last stock | Day lock serializes checks; losing request rolls back | Available stock changed; review quantity |
| Quantity correction | Version check, history and line update share a transaction; payment preserved | Show revised stock, outstanding and excess-review flag |
| Closed day or unauthorized actor | Server rejects before financial changes | Day is closed / access denied |
| Lost response or service outage | Mark confirmation uncertain; check receipt and retry same key | Verifying transaction; avoid starting a new sale |

### 7.2 State Transitions

| Entity/state | Action | Next state | Actor |
|---|---|---|---|
| Van day PREPARING | Edit load and visits | PREPARING, revision +1 | Supervisor |
| Van day PREPARING | Open with positive load and assigned active driver | OPEN | Supervisor |
| Van day OPEN | Sale, payment or correction | OPEN, revision +1 | Authorized role |
| Van day OPEN | Save complete physical counts | CLOSED | Supervisor |
| Invoice POSTED | Quantity correction | POSTED, version +1 | Supervisor |
| Invoice POSTED | Payment | POSTED, version +1 | Assigned driver |
| Browser awaiting response | Timeout | Confirmation uncertain | System |
| Browser confirmation uncertain | Receipt found / same-key retry succeeds | Confirmed | System |

The draft blocks reopening closed days, changing an opened load, replacing posted prices/customers, cancelling invoices, zero-quantity corrections and editing/deleting payments. These boundaries keep this first implementation focused; exceptions need a team scope decision. Visits need no independent stored status: an invoice's existence means invoiced. Payment status is derived as unpaid, partial, paid or EXCESS_REVIEW from totals. EXCESS_REVIEW means outstanding zero and a positive excess awaiting a supervisor decision; it is not spendable credit. Record correction actor, time, reason, old/new quantity and resulting invoice version. Closing records actor/time and expected/counted values.

## 8. Testing & Quality Strategy

### 8.1 Test Matrix

| ID | Requirement / risk | Level and scenario | Passing result |
|---|---|---|---|
| T-01 | R1 | Integration: create Cedar Market and assign Driver A | A sees visit; Driver B receives 404 |
| T-02 | R2 | Integration: load 100, attempt sale 101 | 409, stock 100, no invoice/lines |
| T-03 | R1-R5 | Browser E2E: main PRD example below | 85 bottles, $15 cash, $0 debt, one invoice/payment/correction |
| T-04 | R4 | Unit + integration: 10 units at $5, pay $30, correct to 8 | Invoice $40, stock 92, cash $30, debt $10 |
| T-05 | R3/R4 | Integration: concurrent same-key submissions and different body same key | One effect for same body; 409 for changed body |
| T-06 | Authorization | Direct API: driver correction, wrong-day access, inactive profile, missing CSRF | 403/404/401 as appropriate, zero mutation |
| T-07 | Stock race | Real PostgreSQL: two visits concurrently request 7 from a load of 10 | One invoice, one 409, stock 3 |
| T-08 | Atomic correction | Force exception after line update before audit insert; then retry | Rollback all changes; retry succeeds once |
| T-09 | R5 / closing race | Concurrent close and sale using preview revision | Sale commits first and close gets 409, or close commits first and sale gets 409 |
| T-10 | R5 | Expected 85/$15, count 84/$13 | Differences -1 and -$2, customer debt unchanged |
| T-11 | R4 / BR-09 excess review | Pay $20 on 20 bottles, correct to 15; retry correction | Cash $20, stock 85, outstanding $0, excess $5 flagged, one correction; no refund or automatic allocation |
| T-12 | Snapshot/history | Change catalog price after sale; inspect original invoice and report during mutation | Historical invoice price preserved; report never mixes committed versions |
| T-13 | Money/validation | Unit: malformed cents, fractions, negative quantities, duplicate lines and multiplication overflow | Reject invalid values; exact cents at accepted boundaries |
| T-14 | Recovery | Drop response after COMMIT; reload and query original key | Existing record retrieved, no additional effect |
| T-15 | R1/R3/R4/R5 account accuracy | Opening debt $30, invoice $20, payments $10 then $10 | Account balance $30 -> $50 -> $40 -> $30; invoice outstanding $20 -> $10 -> $0; one invoice and two separate payment rows |
| T-16 | R1 / BR-07 verification | Supervisor verifies $30 with source; driver and later-edit attempts; replay | Saved source/actor/time, no cash effect, denied unauthorized/locked changes, one verification effect |
| T-17 | R4 payment race | Two concurrent distinct $10 payments with same invoice version; refresh and retry losing request | One initial success, one stale response; second intentional payment succeeds with current version; total $20, never $30 |
| T-18 | Account reporting and visibility | Multi-line invoice, multiple payments, pagination, unassigned driver and closed-day reads | No join multiplication; summaries independent of page size; unassigned 404; supervisor sees retained history |

### 8.2 Minimum Coverage by Concern

Use unit tests for formulas, validation and outstanding/excess formatting. Use real PostgreSQL for locks, constraints, rollback, receipts and authorization; mocks cannot establish these guarantees. Playwright covers the full browser journey with two staff roles. Manually test keyboard navigation, visible focus, labelled controls, clear pending/error states, and forms at 360-pixel mobile and desktop widths. Refresh and sign-out should not expose another user's cached data. The table lists planned tests; none are claimed as executed implementation tests.

### 8.3 Primary MVP Acceptance Test

**Setup.** Seed an active supervisor and driver, one Cedar Market customer with zero opening balance, a product Bottle at 100 cents, and a new PREPARING van day. Use only synthetic accounts/data.

1. Supervisor assigns Cedar Market, loads 100 bottles and opens the day.
2. Driver simulates delivery of 15 bottles, deliberately posts quantity 20 and records 1,500 cents received.
3. Verify invoice 2,000 cents, stock 80, cash 1,500 cents and balance 500 cents. Attempt correction as driver and verify denial.
4. Supervisor corrects quantity to 15 with the current invoice version and a reason. Repeat using the same key.
5. Verify invoice 1,500 cents, stock 85, cash 1,500 cents, balance zero and one correction event.
6. Supervisor enters counted stock 85 and counted cash 1,500 cents with the previewed day revision, then closes. Verify both differences zero and state CLOSED.

**Pass rule.** All intermediate and final quantities match, with exactly one invoice, one payment and one correction. The unauthorized attempt and same-key retry have no extra effect. Repeat the run in an isolated fresh dataset.

**Recovery test.** After committing the payment, drop the response. The driver retrieves its operation receipt and sees the original payment. Retry its exact request using the same key and verify cash is still 1,500 cents.

### 8.4 PRD v1.1 Account and Excess Acceptance Tests

In a fresh fixture, the supervisor verifies Cedar Market’s $30 opening debt with a legacy-record reference. Post a $20 invoice. Record $10, then a separate $10 payment using distinct keys and refreshed versions. At each step assert customer balances $30, $50, $40, $30; invoice outstanding $20, $10, $0 after invoice/payment steps. Assert one invoice history entry and two payment history entries with dates, amounts and invoice linkage. Opening debt remains $30, and collected cash is $20. Repeat each payment request with its original key and verify no extra rows or cash.

In a separate zero-opening-debt fixture, load 100 bottles, invoice 20 at $1 and record $20 payment. Correct to 15. Assert invoice total $15, stock 85, cash $20, outstanding $0, signed balance -$5 and excess $5 flagged for supervisor review. Inspect invoice, account and closing screens. Confirm the original payment remains unchanged, no automatic refund/credit allocation exists, and the flag survives readback, retries and day closing. These are planned acceptance tests, not executed application tests.

## 9. Development Workflow & Deployment

### 9.1 Repository and Collaboration

The proposed repository name is routebook; its location is TBD by Mohammad at M1. Use main for reviewed changes and feature branches such as feat/R3-invoice. One teammate reviews every pull request against its requirement, API contract and tests. Use TypeScript strict mode, ESLint and consistent formatting. Keep migrations, design documentation and code in the repository after implementation begins. Tasks should identify R1-R5, a test ID and an owner selected by the team.

### 9.2 Environments & Configuration

| Environment | Runtime / hosting | Data policy |
|---|---|---|
| Local | Node.js 24, local PostgreSQL matching the hosted major, development Auth project | Synthetic fixtures only |
| CI | Isolated PostgreSQL service, mock identity only in test composition | Reset test data per run; no production credentials |
| Demo / staging | Vercel preview/staging with dedicated Supabase project | Synthetic accounts and transactions |
| Production pilot | Same architecture, separately provisioned | Requires review, business-rule decisions, retention and backup plan before real data |

**Environment variable names.** DATABASE_URL (runtime pooler), MIGRATION_DATABASE_URL (migration connection with elevated privileges), NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, APP_ORIGIN and CSRF_SECRET. Public Supabase configuration identifies the Auth service; it never substitutes for server authorization. Runtime must not receive the migration credential. CI injects a test database URL; no secrets are included here.

**Migrations and initialization.** Store ordered SQL migrations in db/migrations and apply each once using a migration-history table and an advisory lock on a direct or session connection. Include CHECK constraints, partial indexes, role grants and private-schema access checks. Seed repeatable synthetic customers/products and map separately provisioned Auth identities to profiles. Never run destructive demo seeds against a live environment.

**Build and release.** Proposed package scripts run installation from lockfile, type checking, lint, unit tests, database migrations on a fresh test database, integration tests, build and Playwright smoke/E2E tests. These script names are to be implemented with the repository. Lint is a separate CI step because Next.js 16 build does not run it automatically [S1]. Apply reviewed additive migrations once, deploy the application, then run the main workflow smoke test against demo fixtures. Deployment does not imply team or TechTalks approval.

**Logging and monitoring.** Record request ID, operation ID, error code, duration and transaction retry count. Track 5xx rates, connection saturation and pending confirmations. Exclude tokens, passwords, raw request bodies and customer details. Keep correction history in PostgreSQL even when application logs expire.

**Rollback and recovery.** Revert the application to the previous compatible release when a smoke test fails. Preserve additive schema changes until a forward fix is reviewed. Before data-changing migrations, take an export or verified provider backup and test restore in a separate database. Never blindly reverse a migration that would discard posted transactions. Demo data can be reseeded. Backup frequency, retention and restore objectives for real data are TBD before the pilot.

**Hosting limits and costs.** Confirm connection limits, request timeouts, database capacity, backup availability and total budget for the chosen plans at M1. Use the pooler for application requests and direct/session connections for migrations [S4]. Raise capacity only after measured need. This document makes no free-tier availability or cost guarantee.

## 10. Technical Risks & Design Decisions

### 10.1 Risk Register

| Risk | Probability / impact | Mitigation | Contingency | Owner |
|---|---|---|---|---|
| Retried or concurrent writes misstate stock/cash | Medium / High | Day lock, atomic receipt, version checks, T-05/T-07/T-08/T-09 | Pause writes and inspect retained invoice/payment/audit records before resuming | Mohammad coordinates; backend owner TBD at M1 |
| Driver loses connectivity during confirmation | High / High | Visible uncertain state and receipt lookup with same-key retry | Resume online confirmation when service returns; document affected stops in validation | Mohammad coordinates user validation |
| Unresolved excess disposition and cross-day collection alter schema/API late | Medium / High | Review examples in 10.3 before M2 baseline | Revise PRD and TDD together before implementing the affected operation | Mohammad with team and distributor |

### 10.2 Important Engineering Decisions

| Decision | Context and alternative | Rationale and trade-off |
|---|---|---|
| One Next.js application | Alternative is separate UI/API services | One deployment and same-origin sessions reduce setup. Server capacity remains shared. |
| PostgreSQL with explicit SQL | Alternative is Prisma ORM | Direct row-lock queries and constraints are visible. Team owns mapping types and migration tooling. |
| Derived stock and balances | Alternative is mutable balance counters | One formula follows corrected quantities and payments. Queries need joins/aggregation and indexes. |
| One lock per van day | Alternative is finer product-level locks | Easier to prove correctness for a small van workflow. High concurrent traffic on one van would queue. |
| Managed Auth with private SQL schema | Alternative is custom credential/session storage | Auth handles credentials. Application still owns record-level authorization and needs service availability. |
| Freeze closed days; flag excess for review | PRD v1.1 requires preserved payments and review without automatic refunds or credit application | Preserve daily snapshots and cash. Closed-day collection restrictions remain provisional pending confirmation of cross-day payment requirements. |

### 10.3 Open Questions

**PRD BR-10 ambiguity.** BR-10 says stock follows actual delivered quantity confirmed by the driver, while the main PRD test deliberately records 20 instead of 15 and expects stock 80 until a supervisor corrects it to 85. This design follows the explicit test: stock uses confirmed invoice quantities, then authorized corrections. It does not add an independent delivered-quantity field. Confirm this interpretation with the team before implementing R2/R3; if separate physical-delivery confirmation is intended, revise the schema, API and acceptance checkpoints together.

**Cross-day payments and opening debt.** Confirm whether “later” payments may occur after closing and how old debt is collected. Same-open-day multiple payments are fully designed; cross-day collection and legacy-debt allocation remain blocking product decisions for those paths. Verify customer-history visibility and the handling of mistakes in already verified opening debt before the data baseline.


| Open item | Proposed next action | Owner | Target resolution |
|---|---|---|---|
| PRD/TDD review and implementation authorization | Record actual team and TechTalks review decisions; reconcile this draft with any requested changes | Mohammad | Before M4 completion |
| Operational rules - whole units, USD cash, single business, excess-payment disposition, zero-quantity cancellation, late corrections and old-debt collection | Walk through examples with the distributor. Approve the proposed restrictions or amend PRD/API/schema together | Mohammad with team | Before M2 baseline |
| Connectivity and deployment readiness | Check representative stops, select plans, verify exact versions, assign owners and establish real-data retention/backup objectives if planning a pilot | Mohammad coordinates | Hosting/version choices at M1; operational checks before M4/pilot |

## 11. Implementation Readiness & Milestones

| Milestone | Deliverable | Completion condition |
|---|---|---|
| M1 - Architecture baseline | Confirmed stack, architecture, repository and ownership | Team selects exact package versions and hosting plans and assigns implementation owners |
| M2 - Data and contracts | ERD, migrations design and contracts | Operational decisions approved and all R1-R5 paths supported |
| M3 - Security and quality | Permission tests, race/failure strategy and fixtures | Review agrees controls and measurable expected results |
| M4 - Development readiness | Reviewed TDD and deployment plan | Blocking questions resolved and required implementation authorization recorded |

**First implementation slice.** After authorization, implement staff sign-in, supervisor opening load, a driver sale and payment, and a read-only summary using real PostgreSQL. Use the 100 -> 80 bottles and $15 cash/$5 debt checkpoint. Next add the audited correction and closing to complete T-03. This slice spans UI, API, permissions and data.

**Known blockers.** PRD review status remains Draft, implementation authorization is unverified, and operational rules/hosting assignments in Section 10.3 need confirmation. Drafting this design records a proposal and does not claim those milestones are complete.

## 12. Final Review Checklist

### Product Alignment

- [ ] Correct PRD version reviewed and approved by the required reviewers.
- [x] Major components are mapped to R1-R5.
- [x] PRD exclusions remain outside the designed workflow.

### Design Completeness

- [x] Stack choices and trade-offs are recorded as draft decisions.
- [x] Architecture and ER diagrams match the described tables and boundaries.
- [x] Schema includes keys, fields, constraints and relationship cardinalities.
- [x] Transactions, concurrent updates, retries and unknown outcomes are addressed.
- [x] Critical API contracts specify input, output, permissions and failure behavior.

### Security, Testing & Operations

- [x] Identity, server authorization and minimum-data controls are documented.
- [x] State transitions and relevant failure cases are defined.
- [x] Planned tests cover the main journey and negative cases.
- [x] Repository, migration, release and recovery procedures are specified.
- [x] Examples use synthetic data and contain no credentials.
- [x] Risks and unresolved decisions have owners and milestones.
- [ ] Selected plans, package versions and environment setup verified by the team.

### Team Review

| Team member | Review responsibility | Notes | Date |
|---|---|---|---|
| Mohammad Sayed Ahmad | Coordinate consistency and submission | Pending | Pending |
| Jad Youssef el Issa | Technical review; implementation area TBD | Pending | Pending |
| Mahdi Amin Harissa | Technical review; implementation area TBD | Pending | Pending |
| Mostafa Borshalli | Technical review; implementation area TBD | Pending | Pending |
| Nour Komayha | Technical review; implementation area TBD | Pending | Pending |

**Final team status.** Draft for review. **Version submitted.** None recorded. **Outstanding blockers.** See Section 10.3. Checked items indicate coverage in this document, not an implemented or tested application.

## Sources and Design References

The structure follows the attached TechTalks TDD_Template.md v1.0. Product requirements come from the PRD Improved model v1.1 linked in Document Control. Technical references are retained from the 18 November 2026 draft; this revision changes product alignment, not selected dependency versions. Decisions extending the PRD are explicitly proposed in this draft.

- **S1.** [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) and [deployment](https://nextjs.org/docs/app/getting-started/deploying).
- **S2.** [Supabase server-side authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- **S3.** [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html).
- **S4.** [Supabase PostgreSQL connections and pooling](https://supabase.com/docs/guides/database/connecting-to-postgres).
- **S5.** [Supabase custom schemas and API exposure](https://supabase.com/docs/guides/api/using-custom-schemas).
- **S6.** [PostgreSQL transaction isolation](https://www.postgresql.org/docs/17/sql-set-transaction.html).
