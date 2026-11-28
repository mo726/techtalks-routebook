# PostgreSQL integration tests

These tests are separate from `npm test` and target only the local database named `routebook_test`.
They use real PostgreSQL connections for routes, SQL, authorization rechecks, and transactions.
The external Supabase-backed `requireStaff` identity lookup is mocked; role/active checks inside
the operation transaction still query the real `routebook.staff_profiles` table. CSRF validation
uses the real implementation with a test-only secret.

## Connection setup

Set these environment variables in the shell that will run the test command. Do not put either
URL in `.env.local`, a committed file, or a shared Supabase configuration:

- `TEST_DATABASE_URL`: connection URL for `routebook_test_user` on `localhost:5432/routebook_test`.
  This login must not be a superuser and must inherit `routebook_runtime`.
- `TEST_ADMIN_DATABASE_URL`: a separate local superuser connection to the same database. It is
  used only to create and remove isolated test fixtures because runtime permissions do not allow
  fixture management in `auth.users` and `routebook.staff_profiles`.

Use URL-encoded passwords and keep the values in a private local shell or a secret store. The test
preflight rejects non-loopback hosts, any database other than `routebook_test`, unexpected runtime
users, URL query overrides, a superuser runtime login, and an admin connection that is not a local
superuser. It verifies `current_database()`, `current_user`, the runtime role membership, and the
server address before fixture SQL runs. It never reads `DATABASE_URL` or falls back to it.

PowerShell example (replace the placeholders locally; do not paste real credentials into source):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://routebook_test_user:<URL-ENCODED-PASSWORD>@localhost:5432/routebook_test'
$env:TEST_ADMIN_DATABASE_URL = 'postgresql://<LOCAL-SUPERUSER>:<URL-ENCODED-PASSWORD>@localhost:5432/routebook_test'
npm run test:integration
```

The suite has not been run automatically. Run it only when explicitly approved and when both
variables point to the prepared disposable local database.
