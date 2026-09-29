import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWorkbenchAuth, migrateWorkbenchAuth } from "../../../apps/web/src/auth";
import { createInternalMember } from "../../../packages/application/src/auth/create-internal-member";
import { createProject } from "../../../packages/application/src/projects/create-project";
import { setDimensionState } from "../../../packages/application/src/projects/set-dimension-state";
import {
  createResearchNode,
  createNodeRevision,
  linkResearchNodes,
} from "../../../packages/application/src/research-graph/node-service";
import {
  createResearchBranch,
  closeResearchBranch,
} from "../../../packages/application/src/research-graph/branch-service";
import { createResearchResult } from "../../../packages/application/src/results/create-result";
import { linkResultEvidence } from "../../../packages/application/src/results/link-evidence";
import { createScientificDecision } from "../../../packages/application/src/decisions/create-decision";
import { reviewScientificDecision } from "../../../packages/application/src/decisions/review-decision";
import { proposeOfficialRevisionChange } from "../../../packages/application/src/research-graph/official-revision";
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
  scientificDecision: {
    projectId: string;
    decisionId: string;
    oldRevisionId: string;
    newRevisionId: string;
  };
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
): Promise<{
  lead: AcceptanceUser;
  researchers: AcceptanceUser[];
  scientificDecision: {
    projectId: string;
    decisionId: string;
    oldRevisionId: string;
    newRevisionId: string;
  };
}> {
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

  const primaryResearcher = researchers[0];
  if (!primaryResearcher?.projectId) throw new Error("Primary acceptance project missing");

  const graphActor = { type: "human" as const, id: primaryResearcher.id };
  const mechanismA = await createResearchNode(
    db.sql,
    primaryResearcher.projectId,
    "机制",
    "竞争机制 A",
    graphActor,
  );
  const mechanismB = await createResearchNode(
    db.sql,
    primaryResearcher.projectId,
    "机制",
    "竞争机制 B",
    graphActor,
  );
  const revisionA = await createNodeRevision(
    db.sql,
    mechanismA.id,
    { summary: "机制 A 的候选解释" },
    "候选",
    graphActor,
  );
  await createNodeRevision(
    db.sql,
    mechanismB.id,
    { summary: "机制 B 已被当前证据削弱" },
    "已否定",
    graphActor,
  );
  await linkResearchNodes(db.sql, mechanismA.id, mechanismB.id, "挑战", graphActor);

  const failedBranch = await createResearchBranch(
    db.sql,
    primaryResearcher.projectId,
    "失败但保留的机制路线",
    mechanismB.id,
    graphActor,
  );
  await closeResearchBranch(
    db.sql,
    failedBranch.id,
    "关键测量无法支持该机制",
    graphActor,
  );

  const analysisNode = await createResearchNode(
    db.sql,
    primaryResearcher.projectId,
    "分析方案",
    "主分析方案",
    graphActor,
  );
  const analysisRevision = await createNodeRevision(
    db.sql,
    analysisNode.id,
    { model: "Y ~ X + fixed effects" },
    "候选",
    graphActor,
  );
  const result = await createResearchResult(
    db.sql,
    {
      projectId: primaryResearcher.projectId,
      dataVersionRef: "data:v1",
      analysisRevisionId: analysisRevision.id,
      executionKind: "code",
      runRef: "acceptance-run-1",
      outputRefs: ["table:main-result"],
      gitCommit: {
        repositoryFullName: "example/research-project",
        sha: "0123456789abcdef0123456789abcdef01234567",
      },
    },
    graphActor,
  );
  await linkResultEvidence(
    db.sql,
    result.id,
    revisionA.id,
    "支持",
    graphActor,
  );

  const theoryNode = await createResearchNode(
    db.sql,
    primaryResearcher.projectId,
    "理论",
    "正式理论版本",
    graphActor,
  );
  const oldTheoryRevision = await createNodeRevision(
    db.sql,
    theoryNode.id,
    { summary: "旧版正式理论" },
    "候选",
    graphActor,
  );
  const bootstrapDecision = await createScientificDecision(
    db.sql,
    {
      projectId: primaryResearcher.projectId,
      level: "major",
      title: "建立初始正式理论",
      reason: "建立第二阶段验收基线",
      evidence: [],
      impact: ["正式理论"],
      change: {
        kind: "official_revision",
        slot: "正式理论",
        revisionId: oldTheoryRevision.id,
      },
    },
    graphActor,
  );
  await reviewScientificDecision(
    db.sql,
    bootstrapDecision.id,
    "approve",
    graphActor,
  );
  await reviewScientificDecision(
    db.sql,
    bootstrapDecision.id,
    "approve",
    { type: "human", id: lead.id },
  );

  const newTheoryRevision = await createNodeRevision(
    db.sql,
    theoryNode.id,
    { summary: "新版候选理论" },
    "候选",
    { type: "agent", id: "theory-agent" },
  );
  const aiDecision = await proposeOfficialRevisionChange(
    db.sql,
    {
      projectId: primaryResearcher.projectId,
      slot: "正式理论",
      revisionId: newTheoryRevision.id,
      reason: "新增结果更支持修订后的机制解释",
      evidence: [{ kind: "result", ref: result.id }],
    },
    { type: "agent", id: "theory-agent" },
  );

  return {
    lead,
    researchers,
    scientificDecision: {
      projectId: primaryResearcher.projectId,
      decisionId: aiDecision.id,
      oldRevisionId: oldTheoryRevision.id,
      newRevisionId: newTheoryRevision.id,
    },
  };
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
