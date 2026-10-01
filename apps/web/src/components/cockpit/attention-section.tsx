import type { CockpitAttentionItem } from "@research-workbench/application/src/projections/cockpit-types";

export function attentionItemLabel(item: CockpitAttentionItem): string {
  switch (item.kind) {
    case "my_review":
      return `${item.taskTitle} · 待你审核 · Submission #${item.submissionNumber}`;
    case "my_scientific_decision":
      return `${item.decisionTitle} · 科学决策待处理`;
    case "blocked_task":
      return `${item.taskTitle} · 任务受阻`;
    case "awaiting_scientific_decision":
      return `${item.taskTitle} · 等待科学决策`;
    case "agent_waiting_human":
      return `${item.taskTitle} · 等待人工输入`;
    case "agent_run_failed":
      return `${item.taskTitle} · 最新 Agent 运行失败 · 尝试 #${item.attemptNumber}`;
    case "file_parse_failed":
      return `${item.fileTitle} · 当前文件版本解析失败`;
    case "long_idle_work":
      return `${item.taskTitle} · ${item.daysIdle} 天无记录活动`;
  }
}

export function AttentionItems({
  items,
}: {
  items: readonly CockpitAttentionItem[];
}) {
  return (
    <ul className="cockpit-attention-list">
      {items.map((item) => (
        <li key={item.id}>
          <a href={item.href}>
            <strong>{attentionItemLabel(item)}</strong>
            <span className="meta">项目 · {item.projectTitle}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function AttentionSection({
  title,
  items,
  emptyMessage,
  testId,
}: {
  title: string;
  items: readonly CockpitAttentionItem[];
  emptyMessage: string;
  testId?: string;
}) {
  return (
    <section className="panel cockpit-section" data-testid={testId}>
      <div className="cockpit-section-heading">
        <h3>{title}</h3>
        {items.length > 0 ? <span className="status-label">{items.length}</span> : null}
      </div>
      {items.length > 0 ? (
        <AttentionItems items={items} />
      ) : (
        <p className="meta">{emptyMessage}</p>
      )}
    </section>
  );
}
