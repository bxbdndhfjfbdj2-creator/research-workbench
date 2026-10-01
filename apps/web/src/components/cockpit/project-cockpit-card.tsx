import type {
  AttentionKind,
  ProjectCockpitSummary,
} from "@research-workbench/application/src/projections/cockpit-types";
import { attentionItemLabel } from "./attention-section";

function laneLabel(kind: AttentionKind): string {
  switch (kind) {
    case "blocked_task":
      return "受阻任务";
    case "awaiting_scientific_decision":
      return "等待科学决策";
    case "agent_waiting_human":
      return "Agent 等待人工输入";
    case "agent_run_failed":
      return "Agent 最新运行失败";
    case "file_parse_failed":
      return "当前文件解析失败";
    case "long_idle_work":
      return "长时间无记录活动";
    case "my_review":
      return "待我审核";
    case "my_scientific_decision":
      return "待我处理的科学决策";
  }
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProjectCockpitCard({
  summary,
}: {
  summary: ProjectCockpitSummary;
}) {
  return (
    <article className="project-card cockpit-project-card" data-testid="project-card">
      <div>
        <p className="meta">研究主理人 · {summary.project.leadName}</p>
        <h3>
          <a href={`/projects/${summary.project.id}`}>{summary.project.title}</a>
        </h3>
      </div>

      <div className="state-strip" aria-label="科研状态摘要">
        {summary.project.dimensions.length === 0 ? (
          <span className="state-pill muted">尚未登记科研状态</span>
        ) : (
          summary.project.dimensions.slice(0, 3).map((item) => (
            <span className="state-pill" key={item.dimension}>
              {item.dimension} · {item.state}
            </span>
          ))
        )}
      </div>

      <div className="cockpit-card-attention" aria-label="项目关注摘要">
        {summary.lanes.length === 0 ? (
          <p className="meta">当前没有项目关注事项。</p>
        ) : (
          summary.lanes.map((lane) => (
            <div className="cockpit-lane-preview" key={lane.kind}>
              <div className="cockpit-lane-heading">
                <strong>{laneLabel(lane.kind)}</strong>
                <span>{lane.totalCount}</span>
              </div>
              <ul>
                {lane.preview.map((item) => (
                  <li key={item.id}>
                    <a href={item.href}>{attentionItemLabel(item)}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <p className="meta">
        {summary.latestActivityAt
          ? `最近正式变化 · ${formatTimestamp(summary.latestActivityAt)}`
          : "最近 14 天没有符合 cockpit allowlist 的正式变化。"}
      </p>
    </article>
  );
}
