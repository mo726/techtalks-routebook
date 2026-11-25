import { afterAll } from "vitest";
import {
  cleanupRegisteredIntegrationFixtures,
  closeIntegrationDatabases,
  initializeIntegrationDatabases,
} from "./database";

// These are test-only CSRF values. They do not read credentials from .env.local.
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.CSRF_SECRET = "routebook-local-postgres-integration-csrf-secret";

afterAll(async () => {
  try {
    await cleanupRegisteredIntegrationFixtures();
  } finally {
    await closeIntegrationDatabases();
  }
});

await initializeIntegrationDatabases();
