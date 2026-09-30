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
import { createResearchTask } from "../../../packages/application/src/tasks/research-task-service";
import { createAgentTask } from "../../../packages/application/src/agents/create-agent-task";
import { createAgentRun } from "../../../packages/application/src/agents/create-agent-run";
import { buildAgentContextSnapshot } from "../../../packages/application/src/agents/context-snapshot";
import { recordHarnessSessionReference } from "../../../packages/application/src/agents/harness-session-reference";
import {
  issueAgentCallbackCredential,
  requestHumanInteraction,
} from "../../../packages/application/src/agents/human-interaction";
import { ingestAgentResult } from "../../../packages/application/src/agents/result-ingestion";
import { registerExternalDataVersion } from "../../../packages/application/src/files/file-service";
import type { JsonValue } from "../../../packages/domain/src/events";
import { markOutboxDelivered } from "../../../packages/queue/src/outbox-dispatcher";
import { createReviewResolutionOutboxHandler } from "../../../apps/worker/src/review-runtime";
import {
  createDbClient,
  initializeFoundationDatabase,
  type DbClient,
} from "../../../packages/db/src/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  startFileAcceptanceServices,
  type StartedFileAcceptanceServices,
} from "./file-services";

type AcceptanceUser = {
  id: string;
  email: string;
  password: string;
  projectId?: string;
};

export type FileLinkTargets = {
  researchNodeRevisionId: string;
  researchResultId: string;
};

export type ReviewResolutionController = {
  processDecisionReviewEvents: (
    projectId: string,
    decisionTitle: string,
  ) => Promise<{ decisionId: string; processed: number }>;
};

export type RestrictedFileFixture = {
  projectId: string;
  fileVersionId: string;
  title: string;
  locator: string;
  accessPolicyRef: string;
};

export type FileAcceptanceController = {
  tusEndpoint: string;
  processLatestUpload: (projectId: string) => Promise<{
    intentId: string;
    state: string;
    result: "ready" | "ready_with_parse_error" | "rejected_malware" | "already_terminal";
    researchFileId: string | null;
    fileVersionId: string | null;
  }>;
  getLatestUploadFacts: (projectId: string) => Promise<{
    intentId: string;
    state: string;
    tusUploadId: string | null;
    researchFileId: string | null;
    inboxCount: number;
    completedOutboxCount: number;
    fileVersionCount: number;
  }>;
};

export type AcceptanceEnvironment = {
  lead: AcceptanceUser;
  researchers: AcceptanceUser[];
  fileLinkTargets: FileLinkTargets;
  restrictedFile: RestrictedFileFixture;
  reviewResolution: ReviewResolutionController;
  files?: FileAcceptanceController;
  scientificDecision: {
    projectId: string;
    decisionId: string;
    oldRevisionId: string;
    newRevisionId: string;
  };
  agentWork: {
    projectId: string;
    researchTaskId: string;
    failedRunId: string;
    waitingRunId: string;
    completedRunId: string;
  };
  stop: () => Promise<void>;
};

export type FileAcceptanceEnvironment = Omit<AcceptanceEnvironment, "files"> & {
  files: FileAcceptanceController;
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
  agentWork: {
    projectId: string;
    researchTaskId: string;
    failedRunId: string;
    waitingRunId: string;
    completedRunId: string;
  };
  fileLinkTargets: FileLinkTargets;
  restrictedFile: RestrictedFileFixture;
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
  const restrictedReferenceViewer = researchers[1];
  if (!primaryResearcher?.projectId || !restrictedReferenceViewer) {
    throw new Error("Primary acceptance project or restricted reference viewer missing");
  }
  await db.sql.unsafe(
    `insert into project_memberships (id, project_id, member_id, role)
     values ($1, $2, $3, 'collaborator')`,
    [randomUUID(), primaryResearcher.projectId, restrictedReferenceViewer.id],
  );

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

  const agentResearchTask = await createResearchTask(
    db.sql,
    primaryResearcher.projectId,
    { title: "智能分析科研事项" },
    graphActor,
  );
  const agentSnapshot = await buildAgentContextSnapshot(
    db.sql,
    primaryResearcher.projectId,
    {
      researchQuestionRevisionId: null,
      theoryRevisionId: oldTheoryRevision.id,
      researchDesignRevisionId: null,
      dataVersionRef: "data:v1",
      assetVersionRefs: [],
      gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
      skillVersionRefs: ["skill:diagnostic@1"],
      harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
      harnessProfile: "sdk",
      runtimeProfile: "research-execution",
      modelRoute: "deepseek-official/deepseek-v4-flash",
      sandboxPolicy: "read-only",
      toolAllowlist: ["read_file", "search_files"],
      subagentAllowlist: [],
    },
    graphActor,
  );
  const agentPolicy = {
    contextSnapshotId: agentSnapshot.id,
    gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
    skillVersionRefs: ["skill:diagnostic@1"],
    harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
    harnessProfile: "sdk",
    runtimeProfile: "research-execution",
    modelRoute: "deepseek-official/deepseek-v4-flash",
    sandboxPolicy: "read-only" as const,
    toolAllowlist: ["read_file", "search_files"],
    subagentAllowlist: [],
  };

  const failedAgentTask = await createAgentTask(
    db.sql,
    agentResearchTask.id,
    { objective: "失败后重试的智能诊断", expectedOutput: "诊断摘要" },
    graphActor,
  );
  const failedRun = await createAgentRun(
    db.sql,
    failedAgentTask.id,
    agentPolicy,
    graphActor,
  );
  await db.sql.unsafe(
    "update agent_runs set state = '失败', failure_code = 'TEST_FAILURE' where id = $1",
    [failedRun.id],
  );
  await recordHarnessSessionReference(
    db.sql,
    failedRun.id,
    "session-acceptance-failed",
    {
      runtimeProfile: "research-execution",
      harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
    },
  );

  const waitingAgentTask = await createAgentTask(
    db.sql,
    agentResearchTask.id,
    { objective: "等待研究者判断的智能诊断", expectedOutput: "待确认诊断" },
    graphActor,
  );
  const waitingRun = await createAgentRun(
    db.sql,
    waitingAgentTask.id,
    agentPolicy,
    graphActor,
  );
  await db.sql.unsafe(
    "update agent_runs set state = '执行中' where id = $1",
    [waitingRun.id],
  );
  await recordHarnessSessionReference(
    db.sql,
    waitingRun.id,
    "session-acceptance-waiting",
    {
      runtimeProfile: "research-execution",
      harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
    },
  );
  const callback = await issueAgentCallbackCredential(
    db.sql,
    waitingRun.id,
    "acceptance-agent-callback-signing-secret",
    3600,
  );
  await requestHumanInteraction(db.sql, {
    runId: waitingRun.id,
    kind: "question",
    payload: {
      questions: [
        {
          id: "confirm-anomaly",
          question: "是否继续检验样本构成变化？",
          options: [{ label: "继续" }, { label: "暂缓" }],
        },
      ],
    },
    nonce: "acceptance-waiting-question",
    credentialRef: callback.credentialRef,
  });

  const completedAgentTask = await createAgentTask(
    db.sql,
    agentResearchTask.id,
    { objective: "已完成的智能诊断", expectedOutput: "诊断与结果" },
    graphActor,
  );
  const completedRun = await createAgentRun(
    db.sql,
    completedAgentTask.id,
    agentPolicy,
    graphActor,
  );
  await db.sql.unsafe(
    "update agent_runs set state = '完成' where id = $1",
    [completedRun.id],
  );
  await recordHarnessSessionReference(
    db.sql,
    completedRun.id,
    "session-acceptance-completed",
    {
      runtimeProfile: "research-execution",
      harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
    },
  );
  await ingestAgentResult(db.sql, completedRun.id, {
    visibleMessageSummary: "样本构成变化解释了主要差异。",
    toolFacts: [{ tool: "read_file", summary: "读取冻结分析输入" }],
    artifactRefs: ["artifact:agent-summary"],
    githubHints: [],
    scientificChangeProposals: [],
    stopReason: "completed",
    researchResult: {
      dataVersionRef: "data:v1",
      analysisRevisionId: analysisRevision.id,
      executionKind: "code",
      outputRefs: ["artifact:agent-summary"],
      gitCommit: {
        repositoryFullName: "example/research-project",
        sha: "0123456789abcdef0123456789abcdef01234567",
      },
    },
  });

  const restrictedExternal = await registerExternalDataVersion(
    db.sql,
    primaryResearcher.projectId,
    {
      title: "Restricted work reference acceptance",
      fileKind: "dataset",
      accessClass: "restricted",
      uriOrLocator: "secure-datalake://acceptance/work-review-42",
      manifestHash: "manifest-work-review-42",
      accessPolicyRef: "policy:work-review-42",
      versionLabel: "release-work-review-42",
    },
    graphActor,
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
    agentWork: {
      projectId: primaryResearcher.projectId,
      researchTaskId: agentResearchTask.id,
      failedRunId: failedRun.id,
      waitingRunId: waitingRun.id,
      completedRunId: completedRun.id,
    },
    fileLinkTargets: {
      researchNodeRevisionId: revisionA.id,
      researchResultId: result.id,
    },
    restrictedFile: {
      projectId: primaryResearcher.projectId,
      fileVersionId: restrictedExternal.fileVersion.id,
      title: restrictedExternal.researchFile.title,
      locator: restrictedExternal.externalReference.uriOrLocator,
      accessPolicyRef: restrictedExternal.externalReference.accessPolicyRef,
    },
  };
}

export async function startAcceptanceEnvironment(
  options: { fileServices?: StartedFileAcceptanceServices } = {},
): Promise<AcceptanceEnvironment> {
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
          ...(options.fileServices?.webEnvironment ?? {}),
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

    const reviewResolutionHandler = createReviewResolutionOutboxHandler(db.sql);

    return {
      ...seeded,
      reviewResolution: {
        async processDecisionReviewEvents(projectId: string, decisionTitle: string) {
          const decisions = await db.sql.unsafe(
            `select id
             from scientific_decisions
             where project_id = $1 and title = $2
             order by created_at desc, id desc
             limit 1`,
            [projectId, decisionTitle],
          );
          const decision = decisions[0];
          if (!decision) throw new Error("Acceptance scientific decision not found");
          const decisionId = String(decision.id);

          const rows = await db.sql.unsafe(
            `select id, event_type, payload, attempts
             from outbox_events
             where event_type = 'scientific.decision.reviewed'
               and status = 'pending'
               and payload->>'decisionId' = $1
             order by created_at asc, id asc`,
            [decisionId],
          );

          for (const row of rows) {
            const handled = await reviewResolutionHandler({
              id: String(row.id),
              eventType: String(row.event_type),
              payload: row.payload as JsonValue,
              attempts: Number(row.attempts ?? 0),
            });
            if (!handled) {
              throw new Error("Acceptance review-resolution handler declined its event");
            }
            await markOutboxDelivered(db.sql, String(row.id));
          }

          return { decisionId, processed: rows.length };
        },
      },
      ...(options.fileServices
        ? {
            files: {
              tusEndpoint: options.fileServices.tusEndpoint,
              processLatestUpload(projectId: string) {
                return options.fileServices!.processLatestUpload(db.sql, projectId);
              },
              getLatestUploadFacts(projectId: string) {
                return options.fileServices!.getLatestUploadFacts(db.sql, projectId);
              },
            },
          }
        : {}),
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
        await options.fileServices?.stop();
      },
    };
  } catch (error) {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await db.close();
    await container.stop();
    await options.fileServices?.stop();
    throw error;
  }
}

export async function startFileAcceptanceEnvironment(): Promise<FileAcceptanceEnvironment> {
  const fileServices = await startFileAcceptanceServices();
  const environment = await startAcceptanceEnvironment({ fileServices });
  if (!environment.files) {
    await environment.stop();
    throw new Error("File acceptance services were not attached");
  }
  return environment as FileAcceptanceEnvironment;
}
