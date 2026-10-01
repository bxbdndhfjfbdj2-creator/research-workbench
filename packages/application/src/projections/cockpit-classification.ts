import type {
  AgentRunCurrentFact,
  CockpitActivityItem,
  CockpitAttentionItem,
  ProjectAttentionFacts,
  ResearchTaskCurrentFact,
} from "./cockpit-types";

export const COCKPIT_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const COCKPIT_RECENT_MS = 14 * 24 * 60 * 60 * 1000;

export function computeLastMeaningfulTaskActivity(
  task: ResearchTaskCurrentFact,
): Date {
  const candidates = [
    task.updatedAt,
    task.latestSubmissionAt,
    task.latestReviewAt,
    task.latestLinkedDecisionAt,
    task.latestAgentRunAt,
  ].filter((value): value is Date => value instanceof Date);

  return new Date(Math.max(...candidates.map((value) => value.getTime())));
}

export function selectLatestAgentRuns(
  runs: readonly AgentRunCurrentFact[],
): AgentRunCurrentFact[] {
  const latest = new Map<string, AgentRunCurrentFact>();

  for (const run of runs) {
    const current = latest.get(run.agentTaskId);
    if (
      !current ||
      run.attemptNumber > current.attemptNumber ||
      (run.attemptNumber === current.attemptNumber &&
        run.id.localeCompare(current.id) > 0)
    ) {
      latest.set(run.agentTaskId, run);
    }
  }

  return [...latest.values()].sort((left, right) =>
    left.agentTaskId.localeCompare(right.agentTaskId),
  );
}

export function sortAttentionItems(
  items: readonly CockpitAttentionItem[],
): CockpitAttentionItem[] {
  return [...items].sort((left, right) => {
    const time =
      left.occurredOrWaitingSince.getTime() -
      right.occurredOrWaitingSince.getTime();
    return time || left.id.localeCompare(right.id);
  });
}

export function sortActivityItems(
  items: readonly CockpitActivityItem[],
): CockpitActivityItem[] {
  return [...items].sort((left, right) => {
    const time = right.occurredAt.getTime() - left.occurredAt.getTime();
    return time || left.id.localeCompare(right.id);
  });
}

export function classifyProjectAttention(
  facts: ProjectAttentionFacts,
): CockpitAttentionItem[] {
  const items: CockpitAttentionItem[] = [];
  const myDecisionIds = new Set<string>();

  for (const decision of facts.decisions) {
    if (!decision.reviewStage) continue;
    myDecisionIds.add(decision.id);
    items.push({
      kind: "my_scientific_decision",
      id: `decision:${decision.id}`,
      projectId: decision.projectId,
      projectTitle: decision.projectTitle,
      occurredOrWaitingSince: decision.updatedAt,
      href: `/projects/${decision.projectId}/decisions`,
      decisionId: decision.id,
      decisionTitle: decision.title,
      reviewStage: decision.reviewStage,
    });
  }

  for (const task of facts.tasks) {
    const review = task.currentReview;

    if (
      review?.status === "pending" &&
      review.reviewerMemberId === facts.viewer.memberId
    ) {
      items.push({
        kind: "my_review",
        id: `review:${review.id}`,
        projectId: task.projectId,
        projectTitle: task.projectTitle,
        occurredOrWaitingSince: review.createdAt,
        href: `/projects/${task.projectId}/work/${task.id}`,
        taskId: task.id,
        taskTitle: task.title,
        reviewRequestId: review.id,
        submissionNumber: review.submissionNumber,
      });
    }

    if (task.status === "blocked") {
      items.push({
        kind: "blocked_task",
        id: `blocked:${task.id}`,
        projectId: task.projectId,
        projectTitle: task.projectTitle,
        occurredOrWaitingSince: task.updatedAt,
        href: `/projects/${task.projectId}/work/${task.id}`,
        taskId: task.id,
        taskTitle: task.title,
        ownerMemberId: task.ownerMemberId,
        ownerDisplayName: task.ownerDisplayName,
      });
      continue;
    }

    if (
      review?.status === "awaiting_scientific_decision" &&
      (!review.linkedDecisionId || !myDecisionIds.has(review.linkedDecisionId))
    ) {
      items.push({
        kind: "awaiting_scientific_decision",
        id: `awaiting-decision:${review.id}`,
        projectId: task.projectId,
        projectTitle: task.projectTitle,
        occurredOrWaitingSince: review.updatedAt,
        href: `/projects/${task.projectId}/work/${task.id}`,
        taskId: task.id,
        taskTitle: task.title,
        reviewRequestId: review.id,
        scientificDecisionId: review.linkedDecisionId,
      });
    }

    const hasWaitingReview =
      review?.status === "pending" ||
      review?.status === "awaiting_scientific_decision";

    if (
      (task.status === "open" || task.status === "in_progress") &&
      !hasWaitingReview
    ) {
      const lastMeaningfulActivityAt =
        computeLastMeaningfulTaskActivity(task);
      const idleMs = facts.now.getTime() - lastMeaningfulActivityAt.getTime();
      if (idleMs >= COCKPIT_IDLE_MS) {
        items.push({
          kind: "long_idle_work",
          id: `long-idle:${task.id}`,
          projectId: task.projectId,
          projectTitle: task.projectTitle,
          occurredOrWaitingSince: lastMeaningfulActivityAt,
          href: `/projects/${task.projectId}/work/${task.id}`,
          taskId: task.id,
          taskTitle: task.title,
          lastMeaningfulActivityAt,
          daysIdle: Math.floor(idleMs / (24 * 60 * 60 * 1000)),
        });
      }
    }
  }

  for (const run of selectLatestAgentRuns(facts.agentRuns)) {
    if (run.state === "等待人工输入") {
      items.push({
        kind: "agent_waiting_human",
        id: `agent-waiting:${run.id}`,
        projectId: run.projectId,
        projectTitle: run.projectTitle,
        occurredOrWaitingSince: run.updatedAt,
        href: `/projects/${run.projectId}/agent-work#agent-run-${run.id}`,
        researchTaskId: run.researchTaskId,
        taskTitle: run.taskTitle,
        agentTaskId: run.agentTaskId,
        agentRunId: run.id,
        attemptNumber: run.attemptNumber,
      });
    } else if (run.state === "失败") {
      items.push({
        kind: "agent_run_failed",
        id: `agent-failed:${run.id}`,
        projectId: run.projectId,
        projectTitle: run.projectTitle,
        occurredOrWaitingSince: run.updatedAt,
        href: `/projects/${run.projectId}/agent-work#agent-run-${run.id}`,
        researchTaskId: run.researchTaskId,
        taskTitle: run.taskTitle,
        agentTaskId: run.agentTaskId,
        agentRunId: run.id,
        attemptNumber: run.attemptNumber,
      });
    }
  }

  for (const file of facts.fileParseFailures) {
    if (file.parseStatus !== "failed") continue;
    items.push({
      kind: "file_parse_failed",
      id: `file-parse:${file.researchFileId}:${file.fileVersionId}`,
      projectId: file.projectId,
      projectTitle: file.projectTitle,
      occurredOrWaitingSince: file.failedAt,
      href: `/projects/${file.projectId}/files/${file.researchFileId}`,
      researchFileId: file.researchFileId,
      fileVersionId: file.fileVersionId,
      fileTitle: file.fileTitle,
      versionNumber: file.versionNumber,
      accessClass: file.accessClass,
    });
  }

  return sortAttentionItems(items);
}
