# RouteBook

RouteBook is a Next.js App Router application with TypeScript and Tailwind
CSS 4. The domain work includes exact money arithmetic, validation schemas,
and payment service logic.

## Getting started

Node.js 24 is the supported runtime (see `.nvmrc`).

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

The project uses the Next.js App Router, TypeScript, and Tailwind CSS 4.

## Authentication setup

1. Copy `.env.example` to `.env.local` and fill in the Supabase project URL,
   publishable key, and a PostgreSQL connection string for `DATABASE_URL`.
   The database login must be a restricted runtime user with membership in
   `routebook_runtime`, not a database owner or Supabase service-role key.
   Keep database credentials server-side; do not use a `NEXT_PUBLIC_` prefix.
2. Set `APP_ORIGIN` to the exact origin serving the app. Generate a unique
   `CSRF_SECRET` with at least 32 random bytes, for example:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Apply `db/migrations/0001_staff_profiles.sql`, then
   `db/migrations/0002_routebook_core.sql`, to the Supabase database in order.
   The second migration adds the customer, product, van-day, sales, payment,
   reconciliation, and idempotency schema with constraints and indexes.
4. An administrator creates staff users in Supabase Auth, then provisions each
   user in `routebook.staff_profiles` with the Auth user UUID, display name,
   and either `DRIVER` or `SUPERVISOR` role. There is no public registration
   or in-app role editor.
5. Start the app with `npm run dev`. Staff sign in at `/login`.

The driver workspace includes assigned visits at `/driver/visits` and current
van stock at `/driver/stock` for drivers with an open van day. These pages read
only data for the signed-in driver. Other navigation destinations are not
implemented yet.

A supervisor van-load demo is available at `/supervisor/van-load`. It uses
mock data, does not persist changes, and is not connected to the database.

## Shared UI components

Reusable UI primitives are exported from `src/components/ui`: `Button`,
`Input`, semantic responsive table components, `Alert`, `LoadingState`,
`ErrorState`, and `EmptyState`. They provide consistent styling and accessible
labels, status announcements, validation descriptions, and retry actions.

The app reads the staff profile through its server-side `DATABASE_URL`
connection. Keep the `routebook` schema private from the Supabase Data API.
The migrations grant `routebook_runtime` only the privileges needed by the
current schema, with posted payments, corrections, and reconciliation records
not updateable or deletable by the runtime role. Future migrations must grant
only the specific privileges the app needs.

Future van-day mutation handlers should use
`src/lib/db/van-day-transaction.ts` for the shared transaction, row lock, and
idempotency-receipt flow. The helper does not create business API routes or
pages; each handler remains responsible for authorization and its domain
validation.

## Money and payments

Exact currency arithmetic, invoice validation, and payment service logic are
implemented in `src/lib/money` and `src/lib/payments`. The accompanying
README files describe their supported operations and constraints.

Useful checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
