import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWorkbenchAuth, migrateWorkbenchAuth } from "../../../apps/web/src/auth";
import { createInternalMember } from "../../../packages/application/src/auth/create-internal-member";
import { createProject } from "../../../packages/application/src/projects/create-project";
import { setDimensionState } from "../../../packages/application/src/projects/set-dimension-state";
import {
  createDbClient,
  initializeFoundationDatabase,
  type DbClient,
} from "../../../packages/db/src/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

type AcceptanceUser = {
  id: string;
  email: string;
  password: string;
  projectId?: string;
};

export type AcceptanceEnvironment = {
  lead: AcceptanceUser;
  researchers: AcceptanceUser[];
  stop: () => Promise<void>;
};

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for Next.js: ${String(lastError)}`);
}

async function seedBusinessData(
  db: DbClient,
  databaseUrl: string,
  authSecret: string,
): Promise<{ lead: AcceptanceUser; researchers: AcceptanceUser[] }> {
  await initializeFoundationDatabase(db.sql);
  const bootstrapAuth = createWorkbenchAuth(databaseUrl, authSecret, {
    allowAdministrativeBootstrap: true,
  });
  await migrateWorkbenchAuth(bootstrapAuth);

  await db.sql.unsafe(
    "insert into teams (id, name) values ('acceptance-team', 'Acceptance Team')",
  );
  await db.sql.unsafe(
    "insert into research_portfolios (id, team_id, name) values ('acceptance-portfolio', 'acceptance-team', 'Research Portfolio')",
  );

  const password = "Acceptance-Pass-2026!";
  const users = [
    { email: "lead@acceptance.test", displayName: "总负责人", role: "lead" as const },
    ...Array.from({ length: 5 }, (_, index) => ({
      email: `researcher${index + 1}@acceptance.test`,
      displayName: `研究成员${index + 1}`,
      role: "researcher" as const,
    })),
  ];

  const businessUsers: AcceptanceUser[] = [];

  for (const user of users) {
    const authResult = await bootstrapAuth.api.signUpEmail({
      body: {
        email: user.email,
        password,
        name: user.displayName,
      },
    });
    const memberId = randomUUID();
    await createInternalMember(db.sql, {
      id: memberId,
      teamId: "acceptance-team",
      email: user.email,
      displayName: user.displayName,
      organizationRole: user.role,
      authUserId: authResult.user.id,
    });
    businessUsers.push({ id: memberId, email: user.email, password });
  }

  const [lead, ...researchers] = businessUsers;
  if (!lead || researchers.length !== 5) throw new Error("Acceptance users were not seeded");

  for (let index = 0; index < researchers.length; index += 1) {
    const researcher = researchers[index];
    if (!researcher) continue;

    const project = await createProject(
      db.sql,
      {
        portfolioId: "acceptance-portfolio",
        title: `研究项目${index + 1}`,
        leadMemberId: researcher.id,
      },
      { type: "human", id: researcher.id },
    );
    researcher.projectId = project.id;

    await setDimensionState(
      db.sql,
      project.id,
      "理论",
      index === 0 ? "探索中" : "候选",
      { type: "human", id: researcher.id },
    );
    await setDimensionState(
      db.sql,
      project.id,
      "数据",
      index === 0 ? "冻结" : "验证中",
      { type: "human", id: researcher.id },
    );
    await setDimensionState(
      db.sql,
      project.id,
      "主分析",
      "验证中",
      { type: "human", id: researcher.id },
    );
  }

  return { lead, researchers };
}

export async function startAcceptanceEnvironment(): Promise<AcceptanceEnvironment> {
  const container: StartedPostgreSqlContainer =
    await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();
  const authSecret = "acceptance-secret-that-is-long-enough-for-tests";
  const db = createDbClient(databaseUrl);

  let child: ChildProcess | undefined;

  try {
    const seeded = await seedBusinessData(db, databaseUrl, authSecret);

    child = spawn(
      "pnpm",
      ["--filter", "@research-workbench/web", "exec", "next", "dev", "-p", "3100"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          BETTER_AUTH_SECRET: authSecret,
          BETTER_AUTH_URL: "http://127.0.0.1:3100",
          NODE_ENV: "development",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(`[next] ${text}`);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(`[next] ${text}`);
    });

    try {
      await waitForServer("http://127.0.0.1:3100/login", child);
    } catch (error) {
      throw new Error(`${String(error)}\nNext.js output:\n${output}`);
    }

    return {
      ...seeded,
      async stop() {
        if (child && child.exitCode === null) {
          child.kill("SIGTERM");
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              if (child && child.exitCode === null) child.kill("SIGKILL");
              resolve();
            }, 5_000);
            child?.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
        await db.close();
        await container.stop();
      },
    };
  } catch (error) {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await db.close();
    await container.stop();
    throw error;
  }
}
