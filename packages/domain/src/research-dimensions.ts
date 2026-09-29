import type { ActorRef } from "./actor";

export const RESEARCH_DIMENSIONS = [
  "研究问题",
  "理论",
  "测量",
  "研究设计",
  "数据",
  "主分析",
  "机制分析",
  "稳健性",
  "论文",
  "复现",
  "投稿",
] as const;

export type ResearchDimension = (typeof RESEARCH_DIMENSIONS)[number];

export const RESEARCH_DIMENSION_STATES = [
  "未开始",
  "探索中",
  "候选",
  "待审查",
  "正式",
  "验证中",
  "稳定",
  "冻结",
  "重新开启",
  "受阻",
  "退休",
] as const;

export type ResearchDimensionStateValue = (typeof RESEARCH_DIMENSION_STATES)[number];

export type ResearchDimensionState = {
  id: string;
  projectId: string;
  dimension: ResearchDimension;
  state: ResearchDimensionStateValue;
  updatedBy: ActorRef;
  updatedAt: Date;
};
