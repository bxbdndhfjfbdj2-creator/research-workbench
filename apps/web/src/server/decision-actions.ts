"use server";

import { revalidatePath } from "next/cache";
import { reviewScientificDecision } from "@research-workbench/application/src/decisions/review-decision";
import type { DecisionReviewAction } from "@research-workbench/domain/src/scientific-decision";
import {
  getWebDbClient,
  requireCurrentMember,
} from "./queries";

const ALLOWED_ACTIONS = new Set<DecisionReviewAction>([
  "approve",
  "reject",
  "request_evidence",
]);

export async function reviewScientificDecisionAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const decisionId = String(formData.get("decisionId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const action = String(formData.get("action") ?? "") as DecisionReviewAction;

  if (!decisionId || !ALLOWED_ACTIONS.has(action)) {
    throw new Error("Invalid scientific decision review request");
  }

  await reviewScientificDecision(
    getWebDbClient().sql,
    decisionId,
    action,
    { type: "human", id: member.id },
  );

  revalidatePath("/decisions");
  if (projectId) {
    revalidatePath(`/projects/${projectId}/decisions`);
    revalidatePath(`/projects/${projectId}/network`);
  }
}
