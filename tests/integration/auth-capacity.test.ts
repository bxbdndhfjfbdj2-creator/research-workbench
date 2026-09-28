import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInternalMember } from "../../packages/application/src/auth/create-internal-member";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";
import { createWorkbenchAuthOptions } from "../../apps/web/src/auth";

describe("internal six-member authentication policy", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('capacity-team', 'Capacity Team')");
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("permits six active human members and rejects the seventh", async () => {
    for (let index = 1; index <= 6; index += 1) {
      await createInternalMember(testDb.client.sql, {
        id: `capacity-${index}`,
        teamId: "capacity-team",
        email: `member${index}@capacity.test`,
        displayName: `Member ${index}`,
        organizationRole: index === 1 ? "lead" : "researcher",
      });
    }

    await expect(
      createInternalMember(testDb.client.sql, {
        id: "capacity-7",
        teamId: "capacity-team",
        email: "member7@capacity.test",
        displayName: "Member 7",
        organizationRole: "researcher",
      }),
    ).rejects.toThrow(/six|6|capacity/i);
  });

  it("disables public email/password sign-up at the auth server", () => {
    expect(createWorkbenchAuthOptions()).toMatchObject({
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
      },
    });
  });
});
