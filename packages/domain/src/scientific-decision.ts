import type { ActorRef } from "./actor";
import type { JsonValue } from "./events";

export const DECISION_LEVELS = ["general", "major"] as const;
export type DecisionLevel = (typeof DECISION_LEVELS)[number];

export const DECISION_STATUSES = [
  "proposed",
  "awaiting_lead",
  "needs_evidence",
  "approved",
  "rejected",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_REVIEW_ACTIONS = ["approve", "reject", "request_evidence"] as const;
export type DecisionReviewAction = (typeof DECISION_REVIEW_ACTIONS)[number];

export const OFFICIAL_REVISION_SLOTS = [
  "核心研究问题",
  "正式理论",
  "主测量指标",
  "主样本",
  "主数据版本",
  "识别策略",
  "主模型",
  "探索结果升级为正式结果",
  "论文核心主张",
] as const;
export type OfficialRevisionSlot = (typeof OFFICIAL_REVISION_SLOTS)[number];

export type DecisionEvidence = { kind: string; ref: string };

export type DecisionChange =
  | { kind: "record_only" }
  | { kind: "official_revision"; slot: OfficialRevisionSlot; revisionId: string };

export type DecisionProposal = {
  projectId: string;
  level: DecisionLevel;
  title: string;
  reason: string;
  evidence: DecisionEvidence[];
  impact: string[];
  change: DecisionChange;
};

export type ScientificDecision = {
  id: string;
  projectId: string;
  level: DecisionLevel;
  title: string;
  reason: string;
  evidence: JsonValue;
  impact: JsonValue;
  change: DecisionChange;
  status: DecisionStatus;
  proposedBy: ActorRef;
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
};
