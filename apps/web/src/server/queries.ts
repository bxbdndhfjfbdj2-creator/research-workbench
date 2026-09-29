import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeProjectAccess } from "@research-workbench/application/src/auth/authorize";
import { createDbClient } from "@research-workbench/db/src/client";
import { RESEARCH_DIMENSIONS } from "@research-workbench/domain/src/research-dimensions";
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
  params: unknown[],
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
      const projectLead = String(row.lead_member_id) === member.id;
      const canProjectLeadReview =
        projectLead && (status === "proposed" || status === "needs_evidence");
      const canTeamLeadReview =
        member.organizationRole === "lead" && status === "awaiting_lead";

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
        canReview: canProjectLeadReview || canTeamLeadReview,
        reviewStage: canProjectLeadReview
          ? "project_lead"
          : canTeamLeadReview
            ? "team_lead"
            : null,
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
