import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeProjectAccess } from "@research-workbench/application/src/auth/authorize";
import { resolveScientificDecisionReviewStage } from "@research-workbench/application/src/decisions/review-eligibility";
import { createDbClient } from "@research-workbench/db/src/client";
import { RESEARCH_DIMENSIONS } from "@research-workbench/domain/src/research-dimensions";
import type {
  FileAccessClass,
  FileKind,
  FileLinkRelation,
  FileLinkSubjectType,
} from "@research-workbench/domain/src/research-file";
import { getWorkbenchAuth } from "../auth";

export type CurrentMember = {
  id: string;
  teamId: string;
  displayName: string;
  organizationRole: "lead" | "researcher";
};

export type ProjectSummary = {
  id: string;
  title: string;
  leadName: string;
  states: Array<{ dimension: string; state: string }>;
};

export type ProjectOverview = ProjectSummary & {
  members: Array<{ id: string; displayName: string; role: string }>;
};

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Missing required environment variable: DATABASE_URL");
  return value;
}

type WebDbClient = ReturnType<typeof createDbClient>;

const globalWebDb = globalThis as typeof globalThis & {
  __researchWorkbenchDb?: WebDbClient;
};

function webDb(): WebDbClient {
  globalWebDb.__researchWorkbenchDb ??= createDbClient(databaseUrl());
  return globalWebDb.__researchWorkbenchDb;
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const session = await getWorkbenchAuth().api.getSession({
    headers: await headers(),
  });
  if (!session?.user?.id) return null;

  const db = webDb();
  const rows = await db.sql.unsafe(
      `select id, team_id, display_name, organization_role
       from members
       where auth_user_id = $1 and active = true and actor_type = 'human'
       limit 1`,
      [session.user.id],
    );
    const row = rows[0];
    if (!row) return null;

  return {
    id: String(row.id),
    teamId: String(row.team_id),
    displayName: String(row.display_name),
    organizationRole: row.organization_role as "lead" | "researcher",
  };
}

export async function requireCurrentMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  return member;
}

async function loadStates(
  sql: ReturnType<typeof createDbClient>["sql"],
  projectId: string,
): Promise<Array<{ dimension: string; state: string }>> {
  const rows = await sql.unsafe(
    `select dimension, state
     from research_dimension_states
     where project_id = $1
     order by updated_at desc, dimension asc`,
    [projectId],
  );
  const dimensionOrder = new Map(
    RESEARCH_DIMENSIONS.map((dimension, index) => [dimension, index]),
  );

  return rows
    .map((row) => ({
      dimension: String(row.dimension),
      state: String(row.state),
    }))
    .sort(
      (left, right) =>
        (dimensionOrder.get(left.dimension as (typeof RESEARCH_DIMENSIONS)[number]) ?? 999) -
        (dimensionOrder.get(right.dimension as (typeof RESEARCH_DIMENSIONS)[number]) ?? 999),
    );
}

export async function listVisibleProjects(
  member: CurrentMember,
): Promise<ProjectSummary[]> {
  const db = webDb();
  const rows = await db.sql.unsafe(
      `select distinct p.id, p.title, lead.display_name as lead_name, p.created_at
       from research_projects p
       join research_portfolios rp on rp.id = p.portfolio_id
       join members lead on lead.id = p.lead_member_id
       left join project_memberships pm
         on pm.project_id = p.id and pm.member_id = $1
       where rp.team_id = $2
         and ($3 = 'lead' or pm.id is not null)
       order by p.created_at asc, p.id asc`,
      [member.id, member.teamId, member.organizationRole],
    );

  return Promise.all(
    rows.map(async (row) => ({
      id: String(row.id),
      title: String(row.title),
      leadName: String(row.lead_name),
      states: await loadStates(db.sql, String(row.id)),
    })),
  );
}

export async function getProjectOverview(
  member: CurrentMember,
  projectId: string,
): Promise<ProjectOverview | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const projects = await db.sql.unsafe(
      `select p.id, p.title, lead.display_name as lead_name
       from research_projects p
       join members lead on lead.id = p.lead_member_id
       where p.id = $1
       limit 1`,
      [projectId],
    );
    const project = projects[0];
    if (!project) return null;

    const members = await db.sql.unsafe(
      `select m.id, m.display_name, pm.role
       from project_memberships pm
       join members m on m.id = pm.member_id
       where pm.project_id = $1
       order by case when pm.role = 'lead' then 0 else 1 end, m.display_name asc`,
      [projectId],
    );

  return {
    id: String(project.id),
    title: String(project.title),
    leadName: String(project.lead_name),
    states: await loadStates(db.sql, projectId),
    members: members.map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      role: String(row.role),
    })),
  };
}

export async function listTeamMembers(member: CurrentMember) {
  const db = webDb();
  const rows = await db.sql.unsafe(
      `select id, display_name, email, organization_role
       from members
       where team_id = $1 and active = true and actor_type = 'human'
       order by case when organization_role = 'lead' then 0 else 1 end, display_name asc`,
      [member.teamId],
    );
  return rows.map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    email: String(row.email),
    organizationRole: String(row.organization_role),
  }));
}


export type ResearchGraphViewModel = {
  nodes: Array<{
    id: string;
    type: string;
    title: string;
    revisionId: string | null;
    revisionNumber: number | null;
    revisionStatus: string | null;
    isOfficial: boolean;
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    fromTitle: string;
    toTitle: string;
    relation: string;
  }>;
  branches: Array<{
    id: string;
    name: string;
    status: "open" | "closed";
    originNodeId: string;
    originTitle: string;
    closeReason: string | null;
  }>;
};

export type ProjectEvidenceViewModel = {
  results: Array<{
    id: string;
    dataVersionRef: string;
    analysisRevisionId: string;
    analysisTitle: string;
    executionKind: string;
    runRef: string;
    outputRefs: string[];
    gitRepositoryFullName: string | null;
    gitCommitSha: string | null;
    supersededBy: string | null;
  }>;
  links: Array<{
    id: string;
    resultId: string;
    revisionId: string;
    relation: string;
    nodeTitle: string;
  }>;
};

export async function getProjectResearchGraph(
  member: CurrentMember,
  projectId: string,
): Promise<ResearchGraphViewModel | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const nodeRows = await db.sql.unsafe(
    `select n.id, n.type, n.title,
            r.id as revision_id,
            r.revision_number,
            r.status as revision_status,
            case when o.revision_id is not null then true else false end as is_official
     from research_nodes n
     left join lateral (
       select id, revision_number, status
       from research_node_revisions
       where node_id = n.id
       order by revision_number desc
       limit 1
     ) r on true
     left join official_revisions o
       on o.project_id = n.project_id and o.revision_id = r.id
     where n.project_id = $1
     order by n.created_at asc, n.id asc`,
    [projectId],
  );

  const edgeRows = await db.sql.unsafe(
    `select e.id, e.from_node_id, e.to_node_id, e.relation,
            f.title as from_title, t.title as to_title
     from research_edges e
     join research_nodes f on f.id = e.from_node_id
     join research_nodes t on t.id = e.to_node_id
     where e.project_id = $1
     order by e.created_at asc, e.id asc`,
    [projectId],
  );

  const branchRows = await db.sql.unsafe(
    `select b.id, b.name, b.status, b.origin_node_id,
            n.title as origin_title,
            closed.reason as close_reason
     from research_branches b
     join research_nodes n on n.id = b.origin_node_id
     left join lateral (
       select reason
       from research_branch_history
       where branch_id = b.id and action = 'closed'
       order by created_at desc, id desc
       limit 1
     ) closed on true
     where b.project_id = $1
     order by b.created_at asc, b.id asc`,
    [projectId],
  );

  return {
    nodes: nodeRows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      title: String(row.title),
      revisionId: row.revision_id ? String(row.revision_id) : null,
      revisionNumber: row.revision_number === null || row.revision_number === undefined
        ? null
        : Number(row.revision_number),
      revisionStatus: row.revision_status ? String(row.revision_status) : null,
      isOfficial: row.is_official === true,
    })),
    edges: edgeRows.map((row) => ({
      id: String(row.id),
      fromNodeId: String(row.from_node_id),
      toNodeId: String(row.to_node_id),
      fromTitle: String(row.from_title),
      toTitle: String(row.to_title),
      relation: String(row.relation),
    })),
    branches: branchRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      status: row.status as "open" | "closed",
      originNodeId: String(row.origin_node_id),
      originTitle: String(row.origin_title),
      closeReason: row.close_reason ? String(row.close_reason) : null,
    })),
  };
}

export async function getProjectEvidence(
  member: CurrentMember,
  projectId: string,
): Promise<ProjectEvidenceViewModel | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const resultRows = await db.sql.unsafe(
    `select rr.id, rr.data_version_ref, rr.analysis_revision_id,
            n.title as analysis_title, rr.execution_kind, rr.run_ref,
            rr.output_refs, rr.git_repository_full_name, rr.git_commit_sha,
            s.new_result_id as superseded_by
     from research_results rr
     join research_node_revisions ar on ar.id = rr.analysis_revision_id
     join research_nodes n on n.id = ar.node_id
     left join research_result_supersessions s on s.old_result_id = rr.id
     where rr.project_id = $1
     order by rr.created_at desc, rr.id desc`,
    [projectId],
  );

  const linkRows = await db.sql.unsafe(
    `select l.id, l.result_id, l.revision_id, l.relation, n.title as node_title
     from research_result_evidence_links l
     join research_node_revisions r on r.id = l.revision_id
     join research_nodes n on n.id = r.node_id
     where l.project_id = $1
     order by l.created_at asc, l.id asc`,
    [projectId],
  );

  return {
    results: resultRows.map((row) => ({
      id: String(row.id),
      dataVersionRef: String(row.data_version_ref),
      analysisRevisionId: String(row.analysis_revision_id),
      analysisTitle: String(row.analysis_title),
      executionKind: String(row.execution_kind),
      runRef: String(row.run_ref),
      outputRefs: row.output_refs as string[],
      gitRepositoryFullName: row.git_repository_full_name
        ? String(row.git_repository_full_name)
        : null,
      gitCommitSha: row.git_commit_sha ? String(row.git_commit_sha) : null,
      supersededBy: row.superseded_by ? String(row.superseded_by) : null,
    })),
    links: linkRows.map((row) => ({
      id: String(row.id),
      resultId: String(row.result_id),
      revisionId: String(row.revision_id),
      relation: String(row.relation),
      nodeTitle: String(row.node_title),
    })),
  };
}


export type DecisionCenterItem = {
  id: string;
  projectId: string;
  projectTitle: string;
  level: "general" | "major";
  title: string;
  reason: string;
  evidence: Array<{ kind: string; ref: string }>;
  impact: string[];
  status: "proposed" | "awaiting_lead" | "needs_evidence" | "approved" | "rejected";
  proposerType: "human" | "agent" | "system";
  targetSlot: string | null;
  targetRevisionId: string | null;
  targetRevisionSummary: string | null;
  canReview: boolean;
  reviewStage: "project_lead" | "team_lead" | null;
  reviews: Array<{
    stage: string;
    action: string;
    reviewerName: string;
  }>;
};

export type ProjectDecisionCenterViewModel = {
  decisions: DecisionCenterItem[];
  currentOfficial: Array<{
    slot: string;
    revisionId: string;
    revisionNumber: number;
    summary: string;
  }>;
  officialHistory: Array<{
    slot: string;
    revisionId: string;
    revisionNumber: number;
    summary: string;
    decisionId: string;
  }>;
};

function summaryFromJson(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["summary", "question", "model", "title", "name"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function loadDecisionItems(
  member: CurrentMember,
  whereSql: string,
  params: string[],
): Promise<DecisionCenterItem[]> {
  const db = webDb();
  const rows = await db.sql.unsafe(
    `select d.id, d.project_id, p.title as project_title, p.lead_member_id,
            d.level, d.title, d.reason, d.evidence, d.impact, d.status,
            d.proposed_by_type, d.target_slot, d.target_revision_id,
            target.content as target_content
     from scientific_decisions d
     join research_projects p on p.id = d.project_id
     join research_portfolios rp on rp.id = p.portfolio_id
     left join research_node_revisions target on target.id = d.target_revision_id
     where ${whereSql}
     order by d.created_at desc, d.id desc`,
    params,
  );

  return Promise.all(
    rows.map(async (row) => {
      const decisionId = String(row.id);
      const reviewRows = await db.sql.unsafe(
        `select dr.stage, dr.action, m.display_name
         from decision_reviews dr
         join members m on m.id = dr.reviewer_member_id
         where dr.decision_id = $1
         order by dr.created_at asc, dr.id asc`,
        [decisionId],
      );
      const status = row.status as DecisionCenterItem["status"];
      const reviewStage = resolveScientificDecisionReviewStage({
        status,
        projectLeadMemberId: String(row.lead_member_id),
        reviewerMemberId: member.id,
        reviewerOrganizationRole: member.organizationRole,
      });

      return {
        id: decisionId,
        projectId: String(row.project_id),
        projectTitle: String(row.project_title),
        level: row.level as "general" | "major",
        title: String(row.title),
        reason: String(row.reason),
        evidence: Array.isArray(row.evidence)
          ? (row.evidence as Array<{ kind: string; ref: string }>)
          : [],
        impact: Array.isArray(row.impact) ? (row.impact as string[]) : [],
        status,
        proposerType: row.proposed_by_type as "human" | "agent" | "system",
        targetSlot: row.target_slot ? String(row.target_slot) : null,
        targetRevisionId: row.target_revision_id ? String(row.target_revision_id) : null,
        targetRevisionSummary: row.target_revision_id
          ? summaryFromJson(row.target_content)
          : null,
        canReview: reviewStage !== null,
        reviewStage,
        reviews: reviewRows.map((review) => ({
          stage: String(review.stage),
          action: String(review.action),
          reviewerName: String(review.display_name),
        })),
      };
    }),
  );
}

export async function getProjectDecisionCenter(
  member: CurrentMember,
  projectId: string,
): Promise<ProjectDecisionCenterViewModel | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const [decisions, officialRows, historyRows] = await Promise.all([
    loadDecisionItems(member, "d.project_id = $1", [projectId]),
    db.sql.unsafe(
      `select o.slot, o.revision_id, r.revision_number, r.content
       from official_revisions o
       join research_node_revisions r on r.id = o.revision_id
       where o.project_id = $1
       order by o.slot asc`,
      [projectId],
    ),
    db.sql.unsafe(
      `select h.slot, h.revision_id, h.decision_id, r.revision_number, r.content
       from official_revision_history h
       join research_node_revisions r on r.id = h.revision_id
       where h.project_id = $1
       order by h.changed_at asc, h.id asc`,
      [projectId],
    ),
  ]);

  return {
    decisions,
    currentOfficial: officialRows.map((row) => ({
      slot: String(row.slot),
      revisionId: String(row.revision_id),
      revisionNumber: Number(row.revision_number),
      summary: summaryFromJson(row.content),
    })),
    officialHistory: historyRows.map((row) => ({
      slot: String(row.slot),
      revisionId: String(row.revision_id),
      revisionNumber: Number(row.revision_number),
      summary: summaryFromJson(row.content),
      decisionId: String(row.decision_id),
    })),
  };
}

export async function listAttentionDecisions(
  member: CurrentMember,
): Promise<DecisionCenterItem[]> {
  if (member.organizationRole === "lead") {
    return loadDecisionItems(
      member,
      "rp.team_id = $1 and d.status in ('proposed', 'awaiting_lead', 'needs_evidence', 'approved')",
      [member.teamId],
    );
  }

  return loadDecisionItems(
    member,
    "rp.team_id = $1 and p.lead_member_id = $2 and d.status in ('proposed', 'awaiting_lead', 'needs_evidence', 'approved')",
    [member.teamId, member.id],
  );
}

export function getWebDbClient() {
  return webDb();
}


export type AgentWorkRunView = {
  id: string;
  attemptNumber: number;
  state: string;
  failureCode: string | null;
  contextSnapshotId: string | null;
  snapshot: {
    researchQuestionRevisionId: string | null;
    theoryRevisionId: string | null;
    researchDesignRevisionId: string | null;
    dataVersionRef: string | null;
    assetVersionRefs: string[];
    gitBaseCommit: string | null;
    skillVersionRefs: string[];
    harnessVersion: string;
    harnessProfile: string;
    runtimeProfile: string;
    modelRoute: string;
    sandboxPolicy: string;
    toolAllowlist: string[];
    subagentAllowlist: string[];
  } | null;
  session: {
    sessionId: string;
    generation: number;
  } | null;
  artifacts: Array<{ kind: string; payload: unknown }>;
  researchResult: {
    id: string;
    dataVersionRef: string;
    executionKind: string;
    gitCommitSha: string | null;
  } | null;
  interaction: {
    id: string;
    kind: "question" | "approval";
    payload: unknown;
  } | null;
};

export type AgentWorkTaskView = {
  id: string;
  researchTaskId: string;
  researchTaskTitle: string;
  objective: string;
  expectedOutput: string | null;
  runs: AgentWorkRunView[];
};

export type ProjectAgentWorkViewModel = {
  researchTasks: Array<{ id: string; title: string; status: string }>;
  agentTasks: AgentWorkTaskView[];
};

function stringFromRequest(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

async function loadAgentRuns(agentTaskId: string): Promise<AgentWorkRunView[]> {
  const db = webDb();
  const rows = await db.sql.unsafe(
    `select r.id, r.attempt_number, r.state, r.failure_code, r.context_snapshot_id,
            s.research_question_revision_id, s.theory_revision_id,
            s.research_design_revision_id, s.data_version_ref, s.asset_version_refs,
            s.git_base_commit, s.skill_version_refs, s.harness_version,
            s.harness_profile, s.runtime_profile, s.model_route, s.sandbox_policy,
            s.tool_allowlist, s.subagent_allowlist,
            hs.session_id, hs.generation,
            rr.id as result_id, rr.data_version_ref as result_data_version_ref,
            rr.execution_kind as result_execution_kind, rr.git_commit_sha,
            hi.id as interaction_id, hi.kind as interaction_kind,
            hi.payload as interaction_payload
     from agent_runs r
     left join agent_context_snapshots s on s.id = r.context_snapshot_id
     left join lateral (
       select session_id, generation
       from harness_session_references
       where run_id = r.id
       order by generation desc
       limit 1
     ) hs on true
     left join lateral (
       select id, data_version_ref, execution_kind, git_commit_sha
       from research_results
       where run_ref = r.id
       order by created_at desc
       limit 1
     ) rr on true
     left join lateral (
       select id, kind, payload
       from agent_human_interactions
       where run_id = r.id and state = 'pending'
       order by created_at desc
       limit 1
     ) hi on true
     where r.agent_task_id = $1
     order by r.attempt_number asc`,
    [agentTaskId],
  );

  return Promise.all(rows.map(async (row) => {
    const artifactRows = await db.sql.unsafe(
      `select kind, payload
       from agent_run_artifacts
       where run_id = $1
       order by created_at asc, id asc`,
      [String(row.id)],
    );
    return {
      id: String(row.id),
      attemptNumber: Number(row.attempt_number),
      state: String(row.state),
      failureCode: row.failure_code ? String(row.failure_code) : null,
      contextSnapshotId: row.context_snapshot_id ? String(row.context_snapshot_id) : null,
      snapshot: row.context_snapshot_id
        ? {
            researchQuestionRevisionId: row.research_question_revision_id ? String(row.research_question_revision_id) : null,
            theoryRevisionId: row.theory_revision_id ? String(row.theory_revision_id) : null,
            researchDesignRevisionId: row.research_design_revision_id ? String(row.research_design_revision_id) : null,
            dataVersionRef: row.data_version_ref ? String(row.data_version_ref) : null,
            assetVersionRefs: Array.isArray(row.asset_version_refs) ? row.asset_version_refs as string[] : [],
            gitBaseCommit: row.git_base_commit ? String(row.git_base_commit) : null,
            skillVersionRefs: Array.isArray(row.skill_version_refs) ? row.skill_version_refs as string[] : [],
            harnessVersion: String(row.harness_version),
            harnessProfile: String(row.harness_profile),
            runtimeProfile: String(row.runtime_profile),
            modelRoute: String(row.model_route),
            sandboxPolicy: String(row.sandbox_policy),
            toolAllowlist: Array.isArray(row.tool_allowlist) ? row.tool_allowlist as string[] : [],
            subagentAllowlist: Array.isArray(row.subagent_allowlist) ? row.subagent_allowlist as string[] : [],
          }
        : null,
      session: row.session_id
        ? { sessionId: String(row.session_id), generation: Number(row.generation) }
        : null,
      artifacts: artifactRows.map((artifact) => ({
        kind: String(artifact.kind),
        payload: artifact.payload,
      })),
      researchResult: row.result_id
        ? {
            id: String(row.result_id),
            dataVersionRef: String(row.result_data_version_ref),
            executionKind: String(row.result_execution_kind),
            gitCommitSha: row.git_commit_sha ? String(row.git_commit_sha) : null,
          }
        : null,
      interaction: row.interaction_id
        ? {
            id: String(row.interaction_id),
            kind: row.interaction_kind as "question" | "approval",
            payload: row.interaction_payload,
          }
        : null,
    };
  }));
}

export async function getProjectAgentWork(
  member: CurrentMember,
  projectId: string,
): Promise<ProjectAgentWorkViewModel | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const researchTaskRows = await db.sql.unsafe(
    `select id, title, status
     from research_tasks
     where project_id = $1
     order by created_at asc, id asc`,
    [projectId],
  );
  const agentTaskRows = await db.sql.unsafe(
    `select at.id, at.research_task_id, at.request, rt.title as research_task_title
     from agent_tasks at
     join research_tasks rt on rt.id = at.research_task_id
     where at.project_id = $1
     order by at.created_at desc, at.id desc`,
    [projectId],
  );

  return {
    researchTasks: researchTaskRows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
    })),
    agentTasks: await Promise.all(agentTaskRows.map(async (row) => ({
      id: String(row.id),
      researchTaskId: String(row.research_task_id),
      researchTaskTitle: String(row.research_task_title),
      objective: stringFromRequest(row.request, "objective") ?? "未命名智能工作",
      expectedOutput: stringFromRequest(row.request, "expectedOutput"),
      runs: await loadAgentRuns(String(row.id)),
    }))),
  };
}

export async function listAgentWorkCenter(member: CurrentMember) {
  const projects = await listVisibleProjects(member);
  const rows = await Promise.all(projects.map(async (project) => ({
    project,
    work: await getProjectAgentWork(member, project.id),
  })));
  return rows
    .filter((row) => row.work && row.work.agentTasks.length > 0)
    .map((row) => ({
      projectId: row.project.id,
      projectTitle: row.project.title,
      agentTasks: row.work!.agentTasks,
    }));
}


export type ProjectFileListItem = {
  id: string;
  title: string;
  fileKind: FileKind;
  currentVersionNumber: number | null;
  accessClass: FileAccessClass;
  lifecycleState: string;
  scanStatus: string | null;
  parseStatus: string | null;
  updatedAt: Date;
  linkCount: number;
};

export type FileVersionViewModel = {
  id: string;
  versionNumber: number;
  originalFilename: string;
  mediaType: string | null;
  byteSize: number | null;
  sha256: string | null;
  sourceKind: "upload" | "external_reference";
  changeSummary: string | null;
  scanStatus: string;
  parseStatus: string;
  extractedText: string | null;
  createdBy: string;
  createdAt: Date;
  processing: Array<{
    id: string;
    processorKind: string;
    processorName: string;
    processorVersion: string;
    status: string;
    outputRefs: string[];
    errorCode: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>;
};

export type FileLinkViewModel = {
  id: string;
  fileVersionId: string;
  subjectType: FileLinkSubjectType;
  subjectId: string;
  relation: FileLinkRelation;
  createdByType: string;
  createdById: string;
  createdAt: Date;
};

export type RetiredFileLinkViewModel = FileLinkViewModel & {
  retirementId: string;
  retirementReason: string;
  retiredAt: Date;
};

export type ExternalReferenceViewModel = {
  id: string;
  manifestHash: string;
  versionLabel: string;
  uriOrLocator: string | null;
  accessPolicyRef: string | null;
  licenseOrAgreementRef: string | null;
  createdBy: string;
  createdAt: Date;
};

export type ResearchFileDetailViewModel = {
  id: string;
  projectId: string;
  title: string;
  fileKind: FileKind;
  description: string | null;
  accessClass: FileAccessClass;
  lifecycleState: string;
  currentVersionId: string | null;
  createdBy: string;
  createdAt: Date;
  versions: FileVersionViewModel[];
  activeLinks: FileLinkViewModel[];
  retiredLinks: RetiredFileLinkViewModel[];
  externalReference: ExternalReferenceViewModel | null;
};

type ProjectFileFilters = {
  q?: string;
  fileKind?: FileKind;
  processingState?: string;
  subjectType?: FileLinkSubjectType;
};

function normalizeFileSearchQuery(value: string | undefined): string | null {
  const trimmed = value?.trim().slice(0, 200) ?? "";
  if (!trimmed) return null;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return null;
  return trimmed;
}

export async function getProjectFiles(
  member: CurrentMember,
  projectId: string,
  filters: ProjectFileFilters = {},
): Promise<ProjectFileListItem[] | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const where: string[] = ["rf.project_id = $1"];
  const params: string[] = [projectId];

  if (filters.fileKind) {
    params.push(filters.fileKind);
    where.push(`rf.file_kind = $${params.length}`);
  }

  const processingState = filters.processingState?.trim();
  if (processingState) {
    params.push(processingState);
    where.push(
      `(fv.parse_status = $${params.length} or fv.scan_status = $${params.length} or rf.lifecycle_state = $${params.length})`,
    );
  }

  if (filters.subjectType) {
    params.push(filters.subjectType);
    where.push(
      `exists (
         select 1
         from file_versions linked_version
         join file_links linked on linked.file_version_id = linked_version.id
         left join file_link_retirements retired on retired.file_link_id = linked.id
         where linked_version.research_file_id = rf.id
           and linked.subject_type = $${params.length}
           and retired.id is null
       )`,
    );
  }

  const searchQuery = normalizeFileSearchQuery(filters.q);
  if (searchQuery) {
    params.push(searchQuery);
    where.push(
      `fs.search_vector @@ websearch_to_tsquery('simple', $${params.length})`,
    );
  }

  const rows = await db.sql.unsafe(
    `select rf.id, rf.title, rf.file_kind, rf.access_class, rf.lifecycle_state,
            fv.version_number, fv.scan_status, fv.parse_status,
            coalesce(fv.created_at, rf.created_at) as updated_at,
            coalesce(active_links.link_count, 0)::int as link_count
     from research_files rf
     left join file_versions fv on fv.id = rf.current_version_id
     left join file_search_documents fs on fs.file_version_id = fv.id
     left join lateral (
       select count(*)::int as link_count
       from file_versions all_versions
       join file_links fl on fl.file_version_id = all_versions.id
       left join file_link_retirements retirement on retirement.file_link_id = fl.id
       where all_versions.research_file_id = rf.id
         and retirement.id is null
     ) active_links on true
     where ${where.join(" and ")}
     order by rf.created_at asc, rf.id asc`,
    params,
  );

  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    fileKind: row.file_kind as FileKind,
    currentVersionNumber:
      row.version_number === null || row.version_number === undefined
        ? null
        : Number(row.version_number),
    accessClass: row.access_class as FileAccessClass,
    lifecycleState: String(row.lifecycle_state),
    scanStatus: row.scan_status ? String(row.scan_status) : null,
    parseStatus: row.parse_status ? String(row.parse_status) : null,
    updatedAt: new Date(row.updated_at as string | Date),
    linkCount: Number(row.link_count ?? 0),
  }));
}

export async function getResearchFileDetail(
  member: CurrentMember,
  researchFileId: string,
): Promise<ResearchFileDetailViewModel | null> {
  const db = webDb();
  const fileRows = await db.sql.unsafe(
    `select rf.id, rf.project_id, rf.title, rf.file_kind, rf.description,
            rf.current_version_id, rf.access_class, rf.lifecycle_state,
            rf.created_by, rf.created_at, p.lead_member_id
     from research_files rf
     join research_projects p on p.id = rf.project_id
     where rf.id = $1
     limit 1`,
    [researchFileId],
  );
  const file = fileRows[0];
  if (!file) return null;

  const projectId = String(file.project_id);
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const versionRows = await db.sql.unsafe(
    `select fv.id, fv.version_number, fv.original_filename, fv.media_type,
            fv.byte_size, fv.sha256, fv.source_kind, fv.change_summary,
            fv.scan_status, fv.parse_status, fv.created_by, fv.created_at,
            fs.extracted_text,
            er.id as external_reference_id, er.uri_or_locator, er.manifest_hash,
            er.access_policy_ref, er.license_or_agreement_ref, er.version_label,
            er.created_by as external_created_by, er.created_at as external_created_at
     from file_versions fv
     left join file_search_documents fs on fs.file_version_id = fv.id
     left join external_data_references er on er.id = fv.external_reference_id
     where fv.research_file_id = $1
     order by fv.version_number desc`,
    [researchFileId],
  );

  const processingRows = await db.sql.unsafe(
    `select fpr.id, fpr.file_version_id, fpr.processor_kind, fpr.processor_name,
            fpr.processor_version, fpr.status, fpr.output_refs, fpr.error_code,
            fpr.started_at, fpr.finished_at
     from file_processing_records fpr
     join file_versions fv on fv.id = fpr.file_version_id
     where fv.research_file_id = $1
     order by fpr.created_at asc, fpr.id asc`,
    [researchFileId],
  );

  const processingByVersion = new Map<string, FileVersionViewModel["processing"]>();
  for (const row of processingRows) {
    const versionId = String(row.file_version_id);
    const list = processingByVersion.get(versionId) ?? [];
    list.push({
      id: String(row.id),
      processorKind: String(row.processor_kind),
      processorName: String(row.processor_name),
      processorVersion: String(row.processor_version),
      status: String(row.status),
      outputRefs: Array.isArray(row.output_refs) ? (row.output_refs as string[]) : [],
      errorCode: row.error_code ? String(row.error_code) : null,
      startedAt: row.started_at ? new Date(row.started_at as string | Date) : null,
      finishedAt: row.finished_at ? new Date(row.finished_at as string | Date) : null,
    });
    processingByVersion.set(versionId, list);
  }

  const linkRows = await db.sql.unsafe(
    `select fl.id, fl.file_version_id, fl.subject_type, fl.subject_id, fl.relation,
            fl.created_by_type, fl.created_by_id, fl.created_at,
            retirement.id as retirement_id, retirement.reason as retirement_reason,
            retirement.created_at as retired_at
     from file_links fl
     join file_versions fv on fv.id = fl.file_version_id
     left join file_link_retirements retirement on retirement.file_link_id = fl.id
     where fv.research_file_id = $1
     order by fl.created_at asc, fl.id asc`,
    [researchFileId],
  );

  const activeLinks: FileLinkViewModel[] = [];
  const retiredLinks: RetiredFileLinkViewModel[] = [];
  for (const row of linkRows) {
    const link: FileLinkViewModel = {
      id: String(row.id),
      fileVersionId: String(row.file_version_id),
      subjectType: row.subject_type as FileLinkSubjectType,
      subjectId: String(row.subject_id),
      relation: row.relation as FileLinkRelation,
      createdByType: String(row.created_by_type),
      createdById: String(row.created_by_id),
      createdAt: new Date(row.created_at as string | Date),
    };
    if (row.retirement_id) {
      retiredLinks.push({
        ...link,
        retirementId: String(row.retirement_id),
        retirementReason: String(row.retirement_reason),
        retiredAt: new Date(row.retired_at as string | Date),
      });
    } else {
      activeLinks.push(link);
    }
  }

  const versions: FileVersionViewModel[] = versionRows.map((row) => ({
    id: String(row.id),
    versionNumber: Number(row.version_number),
    originalFilename: String(row.original_filename),
    mediaType: row.media_type ? String(row.media_type) : null,
    byteSize: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    sha256: row.sha256 ? String(row.sha256) : null,
    sourceKind: row.source_kind as "upload" | "external_reference",
    changeSummary: row.change_summary ? String(row.change_summary) : null,
    scanStatus: String(row.scan_status),
    parseStatus: String(row.parse_status),
    extractedText: row.extracted_text ? String(row.extracted_text) : null,
    createdBy: String(row.created_by),
    createdAt: new Date(row.created_at as string | Date),
    processing: processingByVersion.get(String(row.id)) ?? [],
  }));

  const currentReferenceRow = versionRows.find(
    (row) =>
      String(row.id) === String(file.current_version_id ?? "") &&
      row.external_reference_id,
  );
  let externalReference: ExternalReferenceViewModel | null = null;
  if (currentReferenceRow?.external_reference_id) {
    const maySeeRestrictedMetadata =
      file.access_class !== "restricted" ||
      member.organizationRole === "lead" ||
      String(file.lead_member_id) === member.id ||
      String(currentReferenceRow.external_created_by) === member.id;

    externalReference = {
      id: String(currentReferenceRow.external_reference_id),
      manifestHash: String(currentReferenceRow.manifest_hash),
      versionLabel: String(currentReferenceRow.version_label),
      uriOrLocator: maySeeRestrictedMetadata
        ? String(currentReferenceRow.uri_or_locator)
        : null,
      accessPolicyRef: maySeeRestrictedMetadata
        ? String(currentReferenceRow.access_policy_ref)
        : null,
      licenseOrAgreementRef:
        maySeeRestrictedMetadata && currentReferenceRow.license_or_agreement_ref
          ? String(currentReferenceRow.license_or_agreement_ref)
          : null,
      createdBy: String(currentReferenceRow.external_created_by),
      createdAt: new Date(currentReferenceRow.external_created_at as string | Date),
    };
  }

  return {
    id: String(file.id),
    projectId,
    title: String(file.title),
    fileKind: file.file_kind as FileKind,
    description: file.description ? String(file.description) : null,
    accessClass: file.access_class as FileAccessClass,
    lifecycleState: String(file.lifecycle_state),
    currentVersionId: file.current_version_id ? String(file.current_version_id) : null,
    createdBy: String(file.created_by),
    createdAt: new Date(file.created_at as string | Date),
    versions,
    activeLinks,
    retiredLinks,
    externalReference,
  };
}


export type ProjectFileUploadStatus = {
  id: string;
  researchFileId: string | null;
  title: string;
  originalFilename: string;
  fileKind: FileKind;
  accessClass: FileAccessClass;
  state: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function getProjectFileUploadStatuses(
  member: CurrentMember,
  projectId: string,
): Promise<ProjectFileUploadStatus[] | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const rows = await db.sql.unsafe(
    `select fui.id, fui.research_file_id,
            coalesce(rf.title, fui.proposed_title, fui.original_filename) as display_title,
            fui.original_filename, fui.file_kind, fui.access_class, fui.state,
            fui.created_by, fui.created_at, fui.updated_at
     from file_upload_intents fui
     left join research_files rf on rf.id = fui.research_file_id
     where fui.project_id = $1
     order by fui.created_at desc, fui.id desc
     limit 20`,
    [projectId],
  );

  return rows.map((row) => ({
    id: String(row.id),
    researchFileId: row.research_file_id ? String(row.research_file_id) : null,
    title: String(row.display_title),
    originalFilename: String(row.original_filename),
    fileKind: row.file_kind as FileKind,
    accessClass: row.access_class as FileAccessClass,
    state: String(row.state),
    createdBy: String(row.created_by),
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
  }));
}
