import type { DatabaseSql } from "@research-workbench/db/src/client";
import { authorizeProjectAccess } from "../auth/authorize";
import { runInReadOnlySnapshot } from "../transactions";
import { loadRecentCockpitActivity } from "./cockpit-activity-query";
import {
  classifyProjectAttention,
  sortActivityItems,
  sortAttentionItems,
} from "./cockpit-classification";
import {
  CockpitProjectionInconsistencyError,
  loadCurrentProjectFacts,
  loadVisibleProjectIds,
} from "./cockpit-current-query";
import type {
  AttentionKind,
  CockpitAttentionItem,
  CockpitLaneSummary,
  CockpitViewer,
  PortfolioCockpit,
  ProjectCockpit,
  ProjectCockpitSummary,
  ProjectCurrentFacts,
} from "./cockpit-types";

const EXPLICIT_ACTION_KINDS = new Set<AttentionKind>([
  "my_review",
  "my_scientific_decision",
]);

const PROJECT_ATTENTION_KIND_ORDER: readonly AttentionKind[] = [
  "blocked_task",
  "awaiting_scientific_decision",
  "agent_waiting_human",
  "agent_run_failed",
  "file_parse_failed",
  "long_idle_work",
];

function classifyProject(
  current: ProjectCurrentFacts,
  viewer: CockpitViewer,
  now: Date,
): CockpitAttentionItem[] {
  return classifyProjectAttention({
    now,
    viewer,
    tasks: current.tasks,
    decisions: current.decisions,
    agentRuns: current.agentRuns,
    fileParseFailures: current.fileParseFailures,
  });
}

function isExplicitAction(item: CockpitAttentionItem): boolean {
  return EXPLICIT_ACTION_KINDS.has(item.kind);
}

function projectAttention(items: readonly CockpitAttentionItem[]) {
  return items.filter((item) => !isExplicitAction(item));
}

function laneSummaries(
  items: readonly CockpitAttentionItem[],
): CockpitLaneSummary[] {
  return PROJECT_ATTENTION_KIND_ORDER.flatMap((kind) => {
    const matching = items.filter((item) => item.kind === kind);
    return matching.length
      ? [{ kind, totalCount: matching.length, preview: matching.slice(0, 3) }]
      : [];
  });
}

export async function listPortfolioCockpit(
  sql: DatabaseSql,
  viewer: CockpitViewer,
  now: Date,
): Promise<PortfolioCockpit> {
  return runInReadOnlySnapshot(sql, async (tx) => {
    const visibleProjectIds = await loadVisibleProjectIds(tx, viewer);
    const [currentProjects, recentActivity] = await Promise.all([
      loadCurrentProjectFacts(tx, viewer, visibleProjectIds),
      loadRecentCockpitActivity(tx, visibleProjectIds, now),
    ]);

    const classified = currentProjects.map((current) => ({
      current,
      items: classifyProject(current, viewer, now),
    }));

    const myActions = sortAttentionItems(
      classified.flatMap(({ items }) => items.filter(isExplicitAction)),
    );

    const projects: ProjectCockpitSummary[] = classified.map(
      ({ current, items }) => {
        const attention = projectAttention(items);
        const projectActivity = recentActivity.filter(
          (item) => item.projectId === current.project.id,
        );
        return {
          project: current.project,
          lanes: laneSummaries(attention),
          latestActivityAt: projectActivity[0]?.occurredAt ?? null,
        };
      },
    );

    return {
      generatedAt: now,
      myActions,
      projects,
      recentActivity: sortActivityItems(recentActivity),
    };
  });
}

export async function getProjectCockpit(
  sql: DatabaseSql,
  viewer: CockpitViewer,
  projectId: string,
  now: Date,
): Promise<ProjectCockpit> {
  return runInReadOnlySnapshot(sql, async (tx) => {
    await authorizeProjectAccess(tx, viewer.memberId, projectId, "read");

    const [currentProjects, recentActivity] = await Promise.all([
      loadCurrentProjectFacts(tx, viewer, [projectId]),
      loadRecentCockpitActivity(tx, [projectId], now),
    ]);

    const current = currentProjects[0];
    if (!current) {
      throw new CockpitProjectionInconsistencyError(
        "Authorized project missing from cockpit current facts",
      );
    }

    const items = classifyProject(current, viewer, now);
    return {
      generatedAt: now,
      project: current.project,
      explicitActions: items.filter(isExplicitAction),
      attention: projectAttention(items),
      recentActivity: sortActivityItems(recentActivity),
    };
  });
}
