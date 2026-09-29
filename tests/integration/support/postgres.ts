import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDbClient, type DbClient } from "../../../packages/db/src/client";

export type TestDatabase = {
  container: StartedPostgreSqlContainer;
  client: DbClient;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const client = createDbClient(container.getConnectionUri());
  return { container, client };
}

export async function stopTestDatabase(testDb: TestDatabase): Promise<void> {
  await testDb.client.close();
  await testDb.container.stop();
}
