import "server-only";
import { Pool } from "pg";

const globalForPool = globalThis as typeof globalThis & {
  routeBookPool?: Pool;
};

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for staff profile access.");
  }

  return new Pool({
    connectionString,
    max: 1,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: true }
        : undefined,
  });
}

export function getPool(): Pool {
  const existingPool = globalForPool.routeBookPool;
  if (existingPool) {
    return existingPool;
  }

  const newPool = createPool();
  globalForPool.routeBookPool = newPool;
  return newPool;
}
