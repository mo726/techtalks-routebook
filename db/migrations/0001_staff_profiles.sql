CREATE SCHEMA IF NOT EXISTS routebook;

REVOKE ALL ON SCHEMA routebook FROM PUBLIC;
REVOKE ALL ON SCHEMA routebook FROM anon, authenticated;

DO $$
BEGIN
  CREATE ROLE routebook_runtime NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

GRANT USAGE ON SCHEMA routebook TO routebook_runtime;

CREATE TABLE routebook.staff_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name varchar(120) NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 120),
  role text NOT NULL
    CHECK (role IN ('DRIVER', 'SUPERVISOR')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX staff_profiles_role_active_idx
  ON routebook.staff_profiles (role, active);

REVOKE ALL ON TABLE routebook.staff_profiles FROM PUBLIC;
REVOKE ALL ON TABLE routebook.staff_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE routebook.staff_profiles TO routebook_runtime;
