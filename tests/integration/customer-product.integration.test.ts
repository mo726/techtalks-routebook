import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/lib/auth/authorization";
import { createCsrfToken } from "@/lib/security/csrf";
import { runOperationTransaction } from "@/lib/db/operation-transaction";
import { recheckSupervisor } from "@/lib/api/route-utils";
import {
  cleanupIntegrationFixtures,
  createIntegrationFixtures,
  getAdminPool,
  getRuntimePool,
  registerIntegrationFixtureCleanup,
  type IntegrationFixtures,
} from "./database";
import { getIntegrationActor, setIntegrationActor } from "./auth-context";

vi.mock("@/lib/db/pool", async () => {
  const database = await import("./database");
  return { getPool: database.getRuntimePool };
});

vi.mock("@/lib/auth/require-staff", async () => {
  const { NextResponse: MockNextResponse } = await import("next/server");
  const { resolveStaffAccess: resolve } = await import("@/lib/auth/authorization");
  const { getIntegrationActor: getActor } = await import("./auth-context");
  return {
    requireStaff: vi.fn(async (allowedRoles: readonly StaffRole[]) => {
      const access = resolve(getActor(), allowedRoles);
      return access.ok
        ? access
        : {
            ok: false as const,
            response: MockNextResponse.json(
              { error: { code: access.code } },
              { status: access.status },
            ),
          };
    }),
  };
});

import { GET as getCustomers, POST as createCustomer } from "@/app/api/customers/route";
import { PATCH as patchCustomer } from "@/app/api/customers/[id]/route";
import { GET as getProducts, POST as createProduct } from "@/app/api/products/route";
import { PATCH as patchProduct } from "@/app/api/products/[id]/route";

const testCsrfSecret = "routebook-local-postgres-integration-csrf-secret";
let fixtures: IntegrationFixtures;

type ListBody<T> = {
  success: boolean;
  data: { items: T[]; nextCursor: string | null };
};
type CustomerItem = { id: string; name: string; location: string; active: boolean };
type ProductItem = { id: string; name: string; unit: string; priceCents: string; active: boolean };
type MutationBody<T> = { success: boolean; data: { [key: string]: T } };

function writeHeaders(key: string = randomUUID()) {
  const actor = getIntegrationActor();
  const nonce = randomBytes(32).toString("hex");
  return {
    "content-type": "application/json",
    "idempotency-key": key,
    origin: "http://localhost:3000",
    cookie: `routebook-csrf=${nonce}`,
    "x-csrf-token": createCsrfToken(actor.id, nonce, testCsrfSecret),
  };
}

function writeRequest(url: string, method: "POST" | "PATCH", body: unknown, key?: string) {
  return new NextRequest(url, {
    method,
    headers: writeHeaders(key),
    body: JSON.stringify(body),
  });
}

async function responseBody<T>(response: Response) {
  return await response.json() as T;
}

async function collectPages<T>(
  endpoint: "customers" | "products",
  query: { limit: number; cursor?: string },
) {
  const items: T[] = [];
  let cursor = query.cursor;
  for (let page = 0; page < 500; page += 1) {
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (cursor) params.set("cursor", cursor);
    const request = new NextRequest(`http://localhost/api/${endpoint}?${params}`);
    const response = endpoint === "customers" ? await getCustomers(request) : await getProducts(request);
    expect(response.status).toBe(200);
    const body = await responseBody<ListBody<T>>(response);
    items.push(...body.data.items);
    cursor = body.data.nextCursor ?? undefined;
    if (!cursor) return items;
  }
  throw new Error("Pagination did not finish within the integration test safety limit.");
}

async function countOperation(actorId: string, requestKey: string) {
  const result = await getAdminPool().query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM routebook.operations
      WHERE actor_id = $1 AND request_key = $2`,
    [actorId, requestKey],
  );
  return Number(result.rows[0]?.count ?? "0");
}

describe.sequential("P-14a PostgreSQL customer and product integration", () => {
  beforeAll(async () => {
    fixtures = await createIntegrationFixtures();
    registerIntegrationFixtureCleanup(() => cleanupIntegrationFixtures(fixtures));
  });

  beforeEach(() => setIntegrationActor(fixtures.supervisor));

  it("connects only as the verified local runtime user and exercises allowed and denied database permissions", async () => {
    const client = await getRuntimePool().connect();
    try {
      const identity = await client.query<{
        database_name: string;
        user_name: string;
        runtime_member: boolean;
        is_superuser: boolean;
      }>(`SELECT current_database() AS database_name,
                 current_user AS user_name,
                 pg_has_role(current_user, 'routebook_runtime', 'MEMBER') AS runtime_member,
                 (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
      expect(identity.rows[0]).toEqual({
        database_name: "routebook_test",
        user_name: "routebook_test_user",
        runtime_member: true,
        is_superuser: false,
      });
      await expect(client.query("SELECT id FROM routebook.customers LIMIT 1")).resolves.toBeDefined();
      await expect(
        client.query("DELETE FROM routebook.customers WHERE id = $1", [fixtures.customerA]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        client.query("UPDATE routebook.staff_profiles SET role = 'SUPERVISOR' WHERE id = $1", [fixtures.driverA.id]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        client.query("UPDATE routebook.invoice_lines SET unit_price_cents = 126 WHERE false"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
  });

  it("creates customers through the API with the database zero opening-balance default", async () => {
    const name = `${fixtures.prefix} API Customer`;
    const response = await createCustomer(
      writeRequest("http://localhost/api/customers", "POST", { name, location: `${fixtures.prefix} Shop` }),
    );
    expect(response.status).toBe(201);
    const body = await responseBody<MutationBody<CustomerItem>>(response);
    const customer = body.data.customer;
    const stored = await getAdminPool().query<{
      opening_balance_cents: string;
      opening_balance_source: string | null;
      opening_balance_verified_by: string | null;
      opening_balance_verified_at: Date | null;
    }>(`SELECT opening_balance_cents::text, opening_balance_source,
               opening_balance_verified_by, opening_balance_verified_at
          FROM routebook.customers WHERE id = $1`, [customer.id]);
    expect(stored.rows[0]).toEqual({
      opening_balance_cents: "0",
      opening_balance_source: null,
      opening_balance_verified_by: null,
      opening_balance_verified_at: null,
    });
  });

  it("isolates driver customer lists to each driver's assigned OPEN van day", async () => {
    setIntegrationActor(fixtures.driverA);
    const driverAItems = await collectPages<CustomerItem>("customers", { limit: 100 });
    const namesA = driverAItems.map((customer) => customer.name);
    expect(namesA).toContain(`${fixtures.prefix} Assigned A`);
    expect(namesA).toContain(`${fixtures.prefix} To Archive`);
    expect(namesA).not.toContain(`${fixtures.prefix} Assigned B`);
    expect(namesA).not.toContain(`${fixtures.prefix} Unassigned`);

    setIntegrationActor(fixtures.driverB);
    const driverBItems = await collectPages<CustomerItem>("customers", { limit: 100 });
    const namesB = driverBItems.map((customer) => customer.name);
    expect(namesB).toContain(`${fixtures.prefix} Assigned B`);
    expect(namesB).not.toContain(`${fixtures.prefix} Assigned A`);
    expect(namesB).not.toContain(`${fixtures.prefix} Unassigned`);
  });

  it("updates and archives customers while supervisors retain archived visibility", async () => {
    const update = await patchCustomer(
      writeRequest(`http://localhost/api/customers/${fixtures.archiveCustomer}`, "PATCH", {
        location: `${fixtures.prefix} Updated Location`,
      }),
      { params: Promise.resolve({ id: fixtures.archiveCustomer }) },
    );
    expect(update.status).toBe(200);
    const archive = await patchCustomer(
      writeRequest(`http://localhost/api/customers/${fixtures.archiveCustomer}`, "PATCH", { active: false }),
      { params: Promise.resolve({ id: fixtures.archiveCustomer }) },
    );
    expect(archive.status).toBe(200);
    const allCustomers = await collectPages<CustomerItem>("customers", { limit: 100 });
    expect(allCustomers).toContainEqual(expect.objectContaining({
      id: fixtures.archiveCustomer,
      location: `${fixtures.prefix} Updated Location`,
      active: false,
    }));

    setIntegrationActor(fixtures.driverA);
    const driverCustomers = await collectPages<CustomerItem>("customers", { limit: 100 });
    expect(driverCustomers.some((customer) => customer.id === fixtures.archiveCustomer)).toBe(false);
  });

  it("creates, lists, updates and archives products with role-specific active visibility", async () => {
    const productName = `${fixtures.prefix} Main Product`;
    const create = await createProduct(
      writeRequest("http://localhost/api/products", "POST", {
        name: productName,
        unit: "carton",
        priceCents: "125",
      }),
    );
    expect(create.status).toBe(201);
    const created = (await responseBody<MutationBody<ProductItem>>(create)).data.product;
    expect(created.priceCents).toBe("125");

    const update = await patchProduct(
      writeRequest(`http://localhost/api/products/${created.id}`, "PATCH", { priceCents: "250" }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(update.status).toBe(200);
    const archive = await patchProduct(
      writeRequest(`http://localhost/api/products/${created.id}`, "PATCH", { active: false }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(archive.status).toBe(200);

    const supervisorProducts = await collectPages<ProductItem>("products", { limit: 100 });
    expect(supervisorProducts).toContainEqual(expect.objectContaining({
      id: created.id,
      priceCents: "250",
      active: false,
    }));
    setIntegrationActor(fixtures.driverA);
    const driverProducts = await collectPages<ProductItem>("products", { limit: 100 });
    expect(driverProducts.some((product) => product.id === created.id)).toBe(false);
  });

  it("paginates all duplicate customer and product names without skips or repeats", async () => {
    const duplicateCustomerName = `${fixtures.prefix} Duplicate Customer`;
    const duplicateCustomerIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await createCustomer(
        writeRequest("http://localhost/api/customers", "POST", {
          name: duplicateCustomerName,
          location: `${fixtures.prefix} Duplicate ${index}`,
        }),
      );
      expect(response.status).toBe(201);
      duplicateCustomerIds.push(
        (await responseBody<MutationBody<CustomerItem>>(response)).data.customer.id,
      );
    }
    const customerPages = await collectPages<CustomerItem>("customers", { limit: 1 });
    const seenCustomerIds = customerPages
      .filter((customer) => customer.name === duplicateCustomerName)
      .map((customer) => customer.id);
    expect(seenCustomerIds).toEqual([...duplicateCustomerIds].sort());

    const duplicateProductName = `${fixtures.prefix} Duplicate Product`;
    const duplicateProductIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await createProduct(
        writeRequest("http://localhost/api/products", "POST", {
          name: duplicateProductName,
          unit: "bottle",
          priceCents: String(100 + index),
        }),
      );
      expect(response.status).toBe(201);
      duplicateProductIds.push(
        (await responseBody<MutationBody<ProductItem>>(response)).data.product.id,
      );
    }
    const productPages = await collectPages<ProductItem>("products", { limit: 1 });
    const seenProductIds = productPages
      .filter((product) => product.name === duplicateProductName)
      .map((product) => product.id);
    expect(seenProductIds).toEqual([...duplicateProductIds].sort());
  });

  it("creates only one resource and receipt for concurrent identical idempotent requests", async () => {
    const key = randomUUID();
    const body = { name: `${fixtures.prefix} Concurrent Same`, location: `${fixtures.prefix} Location` };
    const requests = () => writeRequest("http://localhost/api/customers", "POST", body, key);
    const responses = await Promise.all([createCustomer(requests()), createCustomer(requests())]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await countOperation(fixtures.supervisor.id, key)).toBe(1);
    const customers = await getAdminPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM routebook.customers WHERE name = $1",
      [body.name],
    );
    expect(customers.rows[0]?.count).toBe("1");
  });

  it("returns one success and one conflict for concurrent reuse of a key with different requests", async () => {
    const key = randomUUID();
    const requests = [
      writeRequest("http://localhost/api/customers", "POST", {
        name: `${fixtures.prefix} Concurrent Conflict A`,
        location: `${fixtures.prefix} Location A`,
      }, key),
      writeRequest("http://localhost/api/customers", "POST", {
        name: `${fixtures.prefix} Concurrent Conflict B`,
        location: `${fixtures.prefix} Location B`,
      }, key),
    ];
    const responses = await Promise.all(requests.map((request) => createCustomer(request)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await countOperation(fixtures.supervisor.id, key)).toBe(1);
  });

  it("rolls back a failed mutation and its pending operation receipt together", async () => {
    const key = randomUUID();
    const name = `${fixtures.prefix} Forced Rollback`;
    await expect(runOperationTransaction({
      actorId: fixtures.supervisor.id,
      requestKey: key,
      methodRoute: "POST /integration/rollback-probe",
      requestBody: { name },
      pool: getRuntimePool(),
      authorize: ({ client }) => recheckSupervisor(client, fixtures.supervisor.id),
      execute: async ({ client }) => {
        await client.query(
          "INSERT INTO routebook.customers (name, location) VALUES ($1, $2)",
          [name, `${fixtures.prefix} Rollback Location`],
        );
        throw new Error("Intentional integration rollback probe.");
      },
    })).rejects.toThrow("Intentional integration rollback probe.");

    const rows = await getAdminPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM routebook.customers WHERE name = $1",
      [name],
    );
    expect(rows.rows[0]?.count).toBe("0");
    expect(await countOperation(fixtures.supervisor.id, key)).toBe(0);
  });

  it("rechecks current database authorization before replaying a stored response", async () => {
    const key = randomUUID();
    const name = `${fixtures.prefix} Replay Authorization`;
    const first = await createCustomer(
      writeRequest("http://localhost/api/customers", "POST", { name, location: `${fixtures.prefix} Replay` }, key),
    );
    expect(first.status).toBe(201);

    await getAdminPool().query(
      "UPDATE routebook.staff_profiles SET role = 'DRIVER' WHERE id = $1",
      [fixtures.supervisor.id],
    );
    try {
      const replay = await createCustomer(
        writeRequest("http://localhost/api/customers", "POST", { name, location: `${fixtures.prefix} Replay` }, key),
      );
      expect(replay.status).toBe(403);
      await expect(responseBody<{ error: { code: string } }>(replay)).resolves.toMatchObject({
        error: { code: "ROLE_FORBIDDEN" },
      });
    } finally {
      await getAdminPool().query(
        "UPDATE routebook.staff_profiles SET role = 'SUPERVISOR' WHERE id = $1",
        [fixtures.supervisor.id],
      );
    }
    expect(await countOperation(fixtures.supervisor.id, key)).toBe(1);
  });

  it("preserves historical invoice line prices when the product price changes", async () => {
    const productResponse = await createProduct(
      writeRequest("http://localhost/api/products", "POST", {
        name: `${fixtures.prefix} Historical Price Product`,
        unit: "case",
        priceCents: "125",
      }),
    );
    expect(productResponse.status).toBe(201);
    const product = (await responseBody<MutationBody<ProductItem>>(productResponse)).data.product;
    const admin = await getAdminPool().connect();
    try {
      await admin.query("BEGIN");
      await admin.query(
        "INSERT INTO routebook.invoices (id, visit_id, created_by) VALUES ($1, $2, $3)",
        [fixtures.invoiceId, fixtures.invoiceVisit, fixtures.supervisor.id],
      );
      await admin.query(
        `INSERT INTO routebook.invoice_lines (invoice_id, product_id, quantity, unit_price_cents)
         VALUES ($1, $2, 2, 125)`,
        [fixtures.invoiceId, product.id],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      admin.release();
    }

    const update = await patchProduct(
      writeRequest(`http://localhost/api/products/${product.id}`, "PATCH", { priceCents: "450" }),
      { params: Promise.resolve({ id: product.id }) },
    );
    expect(update.status).toBe(200);
    const stored = await getAdminPool().query<{ price_cents: string; unit_price_cents: string }>(
      `SELECT product.price_cents::text, line.unit_price_cents::text
         FROM routebook.products AS product
         JOIN routebook.invoice_lines AS line ON line.product_id = product.id
        WHERE product.id = $1 AND line.invoice_id = $2`,
      [product.id, fixtures.invoiceId],
    );
    expect(stored.rows[0]).toEqual({ price_cents: "450", unit_price_cents: "125" });
  });
});
