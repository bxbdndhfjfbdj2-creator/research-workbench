import { randomUUID } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { createWorkbenchAuth } from "../apps/web/src/auth";
import { createDbClient, initializeFoundationDatabase } from "../packages/db/src/client";
import { createInternalMember } from "../packages/application/src/auth/create-internal-member";

const databaseUrl = process.env.DATABASE_URL?.trim();
const authSecret = process.env.BETTER_AUTH_SECRET?.trim();

if (!databaseUrl || !authSecret) {
  throw new Error("DATABASE_URL and BETTER_AUTH_SECRET are required");
}

const credentials = Array.from({ length: 6 }, (_, index) => {
  const slot = index + 1;
  const email = process.env[`BOOTSTRAP_MEMBER_${slot}_EMAIL`]?.trim();
  const password = process.env[`BOOTSTRAP_MEMBER_${slot}_PASSWORD`];
  const displayName =
    process.env[`BOOTSTRAP_MEMBER_${slot}_NAME`]?.trim() ??
    (slot === 1 ? "Research Lead" : `Researcher ${slot - 1}`);

  if (!email || !password) {
    throw new Error(
      `BOOTSTRAP_MEMBER_${slot}_EMAIL and BOOTSTRAP_MEMBER_${slot}_PASSWORD are required`,
    );
  }

  return { email, password, displayName, role: slot === 1 ? "lead" as const : "researcher" as const };
});

const db = createDbClient(databaseUrl);
const bootstrapAuth = createWorkbenchAuth(databaseUrl, authSecret);
const { runMigrations } = await getMigrations(bootstrapAuth.options);

try {
  await initializeFoundationDatabase(db.sql);
  await runMigrations();

  await db.sql.unsafe(
    "insert into teams (id, name) values ('default-team', 'Research Team') on conflict (id) do nothing",
  );
  await db.sql.unsafe(
    "insert into research_portfolios (id, team_id, name) values ('default-portfolio', 'default-team', 'Research Portfolio') on conflict (id) do nothing",
  );

  for (const credential of credentials) {
    const existing = await db.sql.unsafe(
      "select id from members where team_id = 'default-team' and email = $1 limit 1",
      [credential.email.toLowerCase()],
    );
    if (existing.length > 0) continue;

    const authResult = await bootstrapAuth.api.signUpEmail({
      body: {
        email: credential.email,
        password: credential.password,
        name: credential.displayName,
      },
    });

    await createInternalMember(db.sql, {
      id: randomUUID(),
      teamId: "default-team",
      email: credential.email,
      displayName: credential.displayName,
      organizationRole: credential.role,
      authUserId: authResult.user.id,
    });
  }
} finally {
  await db.close();
}
