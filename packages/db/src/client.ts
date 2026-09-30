import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

export type DatabaseSql = Sql;
import * as schema from "./schema";

export type DbClient = {
  sql: Sql;
  db: PostgresJsDatabase<typeof schema>;
  close: () => Promise<void>;
};

export function createDbClient(connectionString: string): DbClient {
  const sql = postgres(connectionString, { max: 4 });
  return {
    sql,
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function initializeFoundationDatabase(sql: Sql): Promise<void> {
  const migrationDir = resolve(process.cwd(), "packages/db/migrations");
  const migrationFiles = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));

  for (const migrationFile of migrationFiles) {
    const migration = await readFile(resolve(migrationDir, migrationFile), "utf8");
    const statements = migration
      .split("-- statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  }
}

export const researchEventRepository = {
  async listByProject(sql: Sql, projectId: string): Promise<readonly unknown[]> {
    return sql`
      select id, project_id, event_type, actor_type, actor_id, payload, created_at
      from research_events
      where project_id = ${projectId}
      order by created_at asc, id asc
    `;
  },
};
