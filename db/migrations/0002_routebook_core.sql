BEGIN;

CREATE TABLE routebook.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL
    CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 160),
  location varchar(240) NOT NULL
    CHECK (location = btrim(location) AND char_length(location) BETWEEN 1 AND 240),
  opening_balance_cents bigint NOT NULL DEFAULT 0
    CHECK (opening_balance_cents BETWEEN 0 AND 5000000000000000),
  opening_balance_source varchar(500),
  opening_balance_verified_by uuid
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  opening_balance_verified_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_opening_balance_provenance_check CHECK (
    (
      opening_balance_cents = 0
      AND opening_balance_source IS NULL
      AND opening_balance_verified_by IS NULL
      AND opening_balance_verified_at IS NULL
    )
    OR (
      opening_balance_cents > 0
      AND opening_balance_source IS NOT NULL
      AND char_length(btrim(opening_balance_source)) BETWEEN 5 AND 500
      AND opening_balance_verified_by IS NOT NULL
      AND opening_balance_verified_at IS NOT NULL
    )
  )
);

CREATE TABLE routebook.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL
    CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 160),
  unit varchar(40) NOT NULL
    CHECK (unit = btrim(unit) AND char_length(unit) BETWEEN 1 AND 40),
  price_cents bigint NOT NULL
    CHECK (price_cents BETWEEN 1 AND 100000000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routebook.van_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  van_code varchar(40) NOT NULL
    CHECK (
      van_code = upper(btrim(van_code))
      AND char_length(van_code) BETWEEN 1 AND 40
    ),
  business_date date NOT NULL,
  driver_id uuid NOT NULL
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'PREPARING'
    CHECK (state IN ('PREPARING', 'OPEN', 'CLOSED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT van_days_van_date_key UNIQUE (van_code, business_date)
);

CREATE TABLE routebook.load_items (
  day_id uuid NOT NULL
    REFERENCES routebook.van_days(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL
    REFERENCES routebook.products(id) ON DELETE RESTRICT,
  opening_qty integer NOT NULL CHECK (opening_qty BETWEEN 1 AND 1000000),
  CONSTRAINT load_items_pkey PRIMARY KEY (day_id, product_id)
);

CREATE TABLE routebook.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL
    REFERENCES routebook.van_days(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL
    REFERENCES routebook.customers(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visits_day_customer_key UNIQUE (day_id, customer_id),
  CONSTRAINT visits_day_position_key UNIQUE (day_id, position)
);

CREATE TABLE routebook.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY,
  visit_id uuid NOT NULL UNIQUE
    REFERENCES routebook.visits(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_number_key UNIQUE (number)
);

CREATE TABLE routebook.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL
    REFERENCES routebook.invoices(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL
    REFERENCES routebook.products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_price_cents bigint NOT NULL
    CHECK (unit_price_cents BETWEEN 1 AND 100000000),
  CONSTRAINT invoice_lines_invoice_product_key UNIQUE (invoice_id, product_id),
  CONSTRAINT invoice_lines_id_invoice_key UNIQUE (id, invoice_id)
);

CREATE TABLE routebook.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL
    REFERENCES routebook.invoices(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL
    CHECK (amount_cents BETWEEN 1 AND 5000000000000000),
  received_by uuid NOT NULL
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routebook.invoice_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL
    REFERENCES routebook.invoices(id) ON DELETE RESTRICT,
  line_id uuid NOT NULL,
  old_qty integer NOT NULL CHECK (old_qty BETWEEN 1 AND 1000000),
  new_qty integer NOT NULL
    CHECK (new_qty BETWEEN 1 AND 1000000 AND new_qty <> old_qty),
  resulting_version integer NOT NULL CHECK (resulting_version > 1),
  reason varchar(500) NOT NULL
    CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 5 AND 500),
  actor_id uuid NOT NULL
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_corrections_invoice_version_key
    UNIQUE (invoice_id, resulting_version),
  CONSTRAINT invoice_corrections_line_invoice_fkey
    FOREIGN KEY (line_id, invoice_id)
    REFERENCES routebook.invoice_lines(id, invoice_id) ON DELETE RESTRICT
);

CREATE TABLE routebook.reconciliations (
  day_id uuid PRIMARY KEY
    REFERENCES routebook.van_days(id) ON DELETE RESTRICT,
  expected_cash_cents bigint NOT NULL
    CHECK (expected_cash_cents BETWEEN 0 AND 5000000000000000),
  counted_cash_cents bigint NOT NULL
    CHECK (counted_cash_cents BETWEEN 0 AND 5000000000000000),
  closed_by uuid NOT NULL
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  closed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routebook.reconciliation_items (
  day_id uuid NOT NULL
    REFERENCES routebook.reconciliations(day_id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  expected_qty integer NOT NULL CHECK (expected_qty >= 0),
  counted_qty integer NOT NULL CHECK (counted_qty BETWEEN 0 AND 1000000),
  CONSTRAINT reconciliation_items_pkey PRIMARY KEY (day_id, product_id),
  CONSTRAINT reconciliation_items_load_item_fkey
    FOREIGN KEY (day_id, product_id)
    REFERENCES routebook.load_items(day_id, product_id) ON DELETE RESTRICT
);

CREATE TABLE routebook.operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL
    REFERENCES routebook.staff_profiles(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL,
  method_route varchar(240) NOT NULL
    CHECK (method_route = btrim(method_route) AND char_length(method_route) > 0),
  request_hash char(64) NOT NULL
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  http_status smallint,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_actor_request_key UNIQUE (actor_id, request_key),
  CONSTRAINT operations_response_pair_check CHECK (
    (http_status IS NULL AND response_body IS NULL)
    OR (
      http_status IS NOT NULL
      AND http_status BETWEEN 200 AND 299
      AND response_body IS NOT NULL
      AND jsonb_typeof(response_body) = 'object'
      AND response_body->>'success' = 'true'
      AND pg_column_size(response_body) <= 65536
    )
  )
);

CREATE INDEX customers_active_name_id_idx
  ON routebook.customers (active, name, id);
CREATE INDEX customers_opening_balance_verified_by_idx
  ON routebook.customers (opening_balance_verified_by);
CREATE INDEX products_active_name_id_idx
  ON routebook.products (active, name, id);
CREATE UNIQUE INDEX van_days_active_van_code_key
  ON routebook.van_days (van_code)
  WHERE state IN ('PREPARING', 'OPEN');
CREATE UNIQUE INDEX van_days_active_driver_id_key
  ON routebook.van_days (driver_id)
  WHERE state IN ('PREPARING', 'OPEN');
CREATE INDEX van_days_driver_business_date_idx
  ON routebook.van_days (driver_id, business_date);
CREATE INDEX van_days_created_by_idx
  ON routebook.van_days (created_by);
CREATE INDEX load_items_product_id_idx
  ON routebook.load_items (product_id);
CREATE INDEX visits_customer_id_idx
  ON routebook.visits (customer_id);
CREATE INDEX invoices_created_by_idx
  ON routebook.invoices (created_by);
CREATE INDEX invoice_lines_product_id_idx
  ON routebook.invoice_lines (product_id);
CREATE INDEX payments_invoice_received_at_idx
  ON routebook.payments (invoice_id, received_at);
CREATE INDEX payments_received_by_idx
  ON routebook.payments (received_by);
CREATE INDEX invoice_corrections_invoice_created_at_idx
  ON routebook.invoice_corrections (invoice_id, created_at);
CREATE INDEX invoice_corrections_line_id_idx
  ON routebook.invoice_corrections (line_id);
CREATE INDEX invoice_corrections_actor_id_idx
  ON routebook.invoice_corrections (actor_id);
CREATE INDEX reconciliations_closed_at_idx
  ON routebook.reconciliations (closed_at);
CREATE INDEX reconciliations_closed_by_idx
  ON routebook.reconciliations (closed_by);
CREATE INDEX operations_created_at_idx
  ON routebook.operations (created_at);

CREATE FUNCTION routebook.enforce_verified_opening_balance_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, routebook
AS $$
BEGIN
  IF OLD.opening_balance_verified_at IS NOT NULL
    AND (
      NEW.opening_balance_cents IS DISTINCT FROM OLD.opening_balance_cents
      OR NEW.opening_balance_source IS DISTINCT FROM OLD.opening_balance_source
      OR NEW.opening_balance_verified_by IS DISTINCT FROM OLD.opening_balance_verified_by
      OR NEW.opening_balance_verified_at IS DISTINCT FROM OLD.opening_balance_verified_at
    )
  THEN
    RAISE EXCEPTION 'Verified opening balances are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_opening_balance_immutable
  BEFORE UPDATE ON routebook.customers
  FOR EACH ROW
  EXECUTE FUNCTION routebook.enforce_verified_opening_balance_immutable();

CREATE FUNCTION routebook.enforce_invoice_line_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, routebook
AS $$
DECLARE
  line_count integer;
BEGIN
  PERFORM 1
    FROM routebook.invoices
   WHERE id = NEW.invoice_id
   FOR UPDATE;

  SELECT count(*)::integer
    INTO line_count
    FROM routebook.invoice_lines
   WHERE invoice_id = NEW.invoice_id;

  IF line_count >= 50 THEN
    RAISE EXCEPTION 'An invoice cannot contain more than 50 lines'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_lines_maximum_count
  BEFORE INSERT ON routebook.invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION routebook.enforce_invoice_line_limit();

CREATE FUNCTION routebook.enforce_invoice_has_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, routebook
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM routebook.invoice_lines
     WHERE invoice_id = NEW.id
  )
  THEN
    RAISE EXCEPTION 'A posted invoice must contain at least one line'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER invoices_require_lines_at_commit
  AFTER INSERT ON routebook.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION routebook.enforce_invoice_has_lines();

CREATE FUNCTION routebook.enforce_operation_receipt_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, routebook
AS $$
BEGIN
  IF OLD.http_status IS NOT NULL OR OLD.response_body IS NOT NULL THEN
    RAISE EXCEPTION 'Completed operation receipts are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.request_key IS DISTINCT FROM OLD.request_key
    OR NEW.method_route IS DISTINCT FROM OLD.method_route
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Operation request identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER operations_receipt_immutable
  BEFORE UPDATE ON routebook.operations
  FOR EACH ROW
  EXECUTE FUNCTION routebook.enforce_operation_receipt_immutability();

CREATE FUNCTION routebook.enforce_completed_operation_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, routebook
AS $$
DECLARE
  receipt_status smallint;
  receipt_body jsonb;
BEGIN
  SELECT http_status, response_body
    INTO receipt_status, receipt_body
    FROM routebook.operations
   WHERE id = NEW.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF receipt_status IS NULL
    OR receipt_body IS NULL
    OR receipt_status NOT BETWEEN 200 AND 299
    OR jsonb_typeof(receipt_body) <> 'object'
    OR receipt_body->>'success' IS DISTINCT FROM 'true'
    OR pg_column_size(receipt_body) > 65536
  THEN
    RAISE EXCEPTION 'Operation receipt must contain a bounded success response'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER operations_completed_at_commit
  AFTER INSERT OR UPDATE ON routebook.operations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION routebook.enforce_completed_operation_receipt();

REVOKE ALL ON SCHEMA routebook FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA routebook TO routebook_runtime;

REVOKE ALL ON TABLE
  routebook.customers,
  routebook.products,
  routebook.van_days,
  routebook.load_items,
  routebook.visits,
  routebook.invoices,
  routebook.invoice_lines,
  routebook.payments,
  routebook.invoice_corrections,
  routebook.reconciliations,
  routebook.reconciliation_items,
  routebook.operations
FROM PUBLIC, anon, authenticated, routebook_runtime;

GRANT SELECT, INSERT ON routebook.customers, routebook.products
  TO routebook_runtime;
GRANT UPDATE (name, location, active, opening_balance_cents,
  opening_balance_source, opening_balance_verified_by,
  opening_balance_verified_at) ON routebook.customers TO routebook_runtime;
GRANT UPDATE (name, unit, price_cents, active)
  ON routebook.products TO routebook_runtime;
GRANT SELECT, INSERT ON routebook.van_days TO routebook_runtime;
GRANT UPDATE (van_code, business_date, driver_id, state, revision)
  ON routebook.van_days TO routebook_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON routebook.load_items
  TO routebook_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON routebook.visits
  TO routebook_runtime;
GRANT SELECT, INSERT ON routebook.invoices TO routebook_runtime;
GRANT UPDATE (version) ON routebook.invoices TO routebook_runtime;
GRANT SELECT, INSERT ON routebook.invoice_lines TO routebook_runtime;
GRANT UPDATE (quantity) ON routebook.invoice_lines TO routebook_runtime;
GRANT SELECT, INSERT ON routebook.payments,
  routebook.invoice_corrections,
  routebook.reconciliations,
  routebook.reconciliation_items
  TO routebook_runtime;
GRANT SELECT, INSERT ON routebook.operations TO routebook_runtime;
GRANT UPDATE (http_status, response_body)
  ON routebook.operations TO routebook_runtime;

REVOKE ALL ON SEQUENCE routebook.invoices_number_seq
  FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE routebook.invoices_number_seq
  TO routebook_runtime;

REVOKE ALL ON FUNCTION routebook.enforce_verified_opening_balance_immutable()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION routebook.enforce_invoice_line_limit()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION routebook.enforce_invoice_has_lines()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION routebook.enforce_operation_receipt_immutability()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION routebook.enforce_completed_operation_receipt()
  FROM PUBLIC, anon, authenticated;

COMMIT;
