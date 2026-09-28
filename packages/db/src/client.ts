import postgres, { type Sql } from "postgres";

export type DbClient = {
  sql: Sql;
  close: () => Promise<void>;
};

export function createDbClient(connectionString: string): DbClient {
  const sql = postgres(connectionString, { max: 4 });
  return {
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function initializeFoundationDatabase(_sql: Sql): Promise<void> {
  throw new Error("foundation database not implemented");
}

export const researchEventRepository = {
  async listByProject(_projectId: string): Promise<unknown[]> {
    return [];
  },
};
