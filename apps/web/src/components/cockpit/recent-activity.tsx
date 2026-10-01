import type { CockpitActivityItem } from "@research-workbench/application/src/projections/cockpit-types";

function formatTimestamp(value: Date): string {
  return value.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RecentActivity({
  items,
  title = "最近重要正式变化",
}: {
  items: readonly CockpitActivityItem[];
  title?: string;
}) {
  return (
    <section className="panel cockpit-section" data-testid="recent-activity">
      <div className="cockpit-section-heading">
        <h3>{title}</h3>
        {items.length > 0 ? <span className="status-label">{items.length}</span> : null}
      </div>
      {items.length === 0 ? (
        <p className="meta">最近 14 天没有符合 cockpit allowlist 的正式变化。</p>
      ) : (
        <ul className="cockpit-activity-list">
          {items.map((item) => (
            <li key={item.id}>
              <a href={item.href}>
                <strong>{item.label}</strong>
                <span className="meta">
                  项目 · {item.projectTitle} · {formatTimestamp(item.occurredAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
