import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

const expectedDatabase = "routebook_test";
const expectedRuntimeUser = "routebook_test_user";
const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

let runtimePool: Pool | undefined;
let adminPool: Pool | undefined;
let registeredFixtureCleanup: (() => Promise<void>) | undefined;

function validatedConnectionString(environmentName: string, expectedUser?: string) {
  const connectionString = process.env[environmentName];
  if (!connectionString) {
    throw new Error(`${environmentName} must be configured to run PostgreSQL integration tests.`);
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${environmentName} must be a valid PostgreSQL URL for the local test database.`);
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !allowedHosts.has(url.hostname.toLowerCase()) ||
    url.port !== "5432" ||
    databaseName !== expectedDatabase ||
    !username ||
    !url.password ||
    url.search ||
    url.hash ||
    (expectedUser !== undefined && username !== expectedUser) ||
    (expectedUser === undefined && username === expectedRuntimeUser)
  ) {
    throw new Error(
      `${environmentName} must target localhost:5432/${expectedDatabase} with the required distinct database user.`,
    );
  }

  return connectionString;
}

function isLoopbackAddress(address: string | null) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function verifyRuntimeConnection(client: PoolClient) {
  const result = await client.query<{
    database_name: string;
    current_user: string;
    server_address: string | null;
    runtime_member: boolean;
    is_superuser: boolean;
  }>(`SELECT current_database() AS database_name,
             current_user AS current_user,
             host(inet_server_addr()) AS server_address,
             pg_has_role(current_user, 'routebook_runtime', 'MEMBER') AS runtime_member,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
  const identity = result.rows[0];
  if (
    identity?.database_name !== expectedDatabase ||
    identity.current_user !== expectedRuntimeUser ||
    !identity.runtime_member ||
    identity.is_superuser ||
    !isLoopbackAddress(identity.server_address)
  ) {
    throw new Error("Connected runtime database identity failed the local safety check.");
  }
}

async function verifyAdminConnection(client: PoolClient) {
  const result = await client.query<{
    database_name: string;
    current_user: string;
    server_address: string | null;
    is_superuser: boolean;
  }>(`SELECT current_database() AS database_name,
             current_user AS current_user,
             host(inet_server_addr()) AS server_address,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
  const identity = result.rows[0];
  if (
    identity?.database_name !== expectedDatabase ||
    identity.current_user === expectedRuntimeUser ||
    !identity.is_superuser ||
    !isLoopbackAddress(identity.server_address)
  ) {
    throw new Error("Connected admin database identity failed the local safety check.");
  }
}

async function verifyPool(pool: Pool, verify: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await verify(client);
  } finally {
    client.release();
  }
}

export async function initializeIntegrationDatabases() {
  if (runtimePool && adminPool) return;

  // Validate both targets before opening either connection or issuing SQL.
  const runtimeUrl = validatedConnectionString("TEST_DATABASE_URL", expectedRuntimeUser);
  const adminUrl = validatedConnectionString("TEST_ADMIN_DATABASE_URL");

  runtimePool = new Pool({ connectionString: runtimeUrl, max: 8, connectionTimeoutMillis: 5_000 });
  adminPool = new Pool({ connectionString: adminUrl, max: 2, connectionTimeoutMillis: 5_000 });
  try {
    await verifyPool(runtimePool, verifyRuntimeConnection);
    await verifyPool(adminPool, verifyAdminConnection);
  } catch {
    await closeIntegrationDatabases();
    throw new Error("PostgreSQL integration database safety verification failed; no test fixtures were created.");
  }
}

export function getRuntimePool() {
  if (!runtimePool) throw new Error("The verified runtime test database is not initialized.");
  return runtimePool;
}

export function getAdminPool() {
  if (!adminPool) throw new Error("The verified admin test database is not initialized.");
  return adminPool;
}

export async function closeIntegrationDatabases() {
  const pools = [runtimePool, adminPool].filter((pool): pool is Pool => pool !== undefined);
  runtimePool = undefined;
  adminPool = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
}

export function registerIntegrationFixtureCleanup(cleanup: () => Promise<void>) {
  registeredFixtureCleanup = cleanup;
}

export async function cleanupRegisteredIntegrationFixtures() {
  const cleanup = registeredFixtureCleanup;
  registeredFixtureCleanup = undefined;
  if (cleanup) await cleanup();
}

export type IntegrationFixtures = {
  prefix: string;
  supervisor: { id: string; displayName: string; role: "SUPERVISOR"; active: true };
  driverA: { id: string; displayName: string; role: "DRIVER"; active: true };
  driverB: { id: string; displayName: string; role: "DRIVER"; active: true };
  dayA: string;
  dayB: string;
  customerA: string;
  customerB: string;
  unassignedCustomer: string;
  archiveCustomer: string;
  invoiceCustomer: string;
  invoiceId: string;
  visitA: string;
  invoiceVisit: string;
  customerIds: string[];
  dayIds: string[];
  visitIds: string[];
  userIds: string[];
};

export async function createIntegrationFixtures(): Promise<IntegrationFixtures> {
  const admin = getAdminPool();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase();
  const prefix = `P14A-${suffix}`;
  const supervisor = { id: randomUUID(), displayName: `${prefix} Supervisor`, role: "SUPERVISOR" as const, active: true as const };
  const driverA = { id: randomUUID(), displayName: `${prefix} Driver A`, role: "DRIVER" as const, active: true as const };
  const driverB = { id: randomUUID(), displayName: `${prefix} Driver B`, role: "DRIVER" as const, active: true as const };
  const customerA = randomUUID();
  const customerB = randomUUID();
  const unassignedCustomer = randomUUID();
  const archiveCustomer = randomUUID();
  const invoiceCustomer = randomUUID();
  const dayA = randomUUID();
  const dayB = randomUUID();
  const visitA = randomUUID();
  const visitB = randomUUID();
  const archiveVisit = randomUUID();
  const invoiceVisit = randomUUID();
  const invoiceId = randomUUID();
  const customers = [customerA, customerB, unassignedCustomer, archiveCustomer, invoiceCustomer];
  const users = [supervisor.id, driverA.id, driverB.id];
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    for (const id of users) {
      await client.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    }
    for (const profile of [supervisor, driverA, driverB]) {
      await client.query(
        `INSERT INTO routebook.staff_profiles (id, display_name, role, active)
         VALUES ($1, $2, $3, $4)`,
        [profile.id, profile.displayName, profile.role, profile.active],
      );
    }
    const customerSeeds = [
      [customerA, `${prefix} Assigned A`, true],
      [customerB, `${prefix} Assigned B`, true],
      [unassignedCustomer, `${prefix} Unassigned`, true],
      [archiveCustomer, `${prefix} To Archive`, true],
      [invoiceCustomer, `${prefix} Invoice Customer`, true],
    ] as const;
    for (const [id, name] of customerSeeds) {
      await client.query(
        `INSERT INTO routebook.customers (id, name, location)
         VALUES ($1, $2, $3)`,
        [id, name, `${prefix} Location`],
      );
    }
    await client.query(
      `INSERT INTO routebook.van_days (id, van_code, business_date, driver_id, state, created_by)
       VALUES ($1, $2, CURRENT_DATE, $3, 'OPEN', $5),
              ($4, $6, CURRENT_DATE, $7, 'OPEN', $5)`,
      [dayA, `${suffix.slice(0, 10)}A`, driverA.id, dayB, supervisor.id, `${suffix.slice(0, 10)}B`, driverB.id],
    );
    for (const [id, dayId, customerId, position] of [
      [visitA, dayA, customerA, 1],
      [visitB, dayB, customerB, 1],
      [archiveVisit, dayA, archiveCustomer, 2],
      [invoiceVisit, dayA, invoiceCustomer, 3],
    ] as const) {
      await client.query(
        `INSERT INTO routebook.visits (id, day_id, customer_id, position)
         VALUES ($1, $2, $3, $4)`,
        [id, dayId, customerId, position],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return {
    prefix,
    supervisor,
    driverA,
    driverB,
    dayA,
    dayB,
    customerA,
    customerB,
    unassignedCustomer,
    archiveCustomer,
    invoiceCustomer,
    invoiceId,
    visitA,
    invoiceVisit,
    customerIds: customers,
    dayIds: [dayA, dayB],
    visitIds: [visitA, visitB, archiveVisit, invoiceVisit],
    userIds: users,
  };
}

export async function cleanupIntegrationFixtures(fixtures: IntegrationFixtures) {
  const admin = getAdminPool();
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM routebook.operations WHERE actor_id = ANY($1::uuid[])", [fixtures.userIds]);
    await client.query("DELETE FROM routebook.invoice_lines WHERE invoice_id = $1", [fixtures.invoiceId]);
    await client.query("DELETE FROM routebook.invoices WHERE id = $1", [fixtures.invoiceId]);
    await client.query("DELETE FROM routebook.visits WHERE id = ANY($1::uuid[])", [fixtures.visitIds]);
    await client.query("DELETE FROM routebook.van_days WHERE id = ANY($1::uuid[])", [fixtures.dayIds]);
    await client.query("DELETE FROM routebook.customers WHERE name LIKE $1", [`${fixtures.prefix}%`]);
    await client.query("DELETE FROM routebook.products WHERE name LIKE $1", [`${fixtures.prefix}%`]);
    await client.query("DELETE FROM routebook.staff_profiles WHERE id = ANY($1::uuid[])", [fixtures.userIds]);
    await client.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [fixtures.userIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
