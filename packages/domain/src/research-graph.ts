import type { JsonValue } from "./events";

export const RESEARCH_NODE_TYPES = [
  "研究问题",
  "理论",
  "机制",
  "假设",
  "测量",
  "研究设计",
  "数据方案",
  "分析方案",
  "解释",
  "论文主张",
] as const;

export type ResearchNodeType = (typeof RESEARCH_NODE_TYPES)[number];

export const RESEARCH_EDGE_RELATIONS = [
  "来源于",
  "支持",
  "挑战",
  "检验",
  "依赖",
  "修订",
  "替代",
  "使用",
  "产生",
  "回到",
] as const;

export type ResearchEdgeRelation = (typeof RESEARCH_EDGE_RELATIONS)[number];

export const NODE_REVISION_STATUSES = ["候选", "正式", "已否定"] as const;
export type NodeRevisionStatus = (typeof NODE_REVISION_STATUSES)[number];

export type ResearchNode = {
  id: string;
  projectId: string;
  type: ResearchNodeType;
  title: string;
  createdAt: Date;
};

export type ResearchNodeRevision = {
  id: string;
  nodeId: string;
  revisionNumber: number;
  content: JsonValue;
  status: NodeRevisionStatus;
  createdByType: "human" | "agent" | "system";
  createdById: string;
  createdAt: Date;
};

export type ResearchEdge = {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: ResearchEdgeRelation;
  createdAt: Date;
};

export type ResearchBranch = {
  id: string;
  projectId: string;
  name: string;
  originNodeId: string;
  status: "open" | "closed";
  createdAt: Date;
  updatedAt: Date;
};
