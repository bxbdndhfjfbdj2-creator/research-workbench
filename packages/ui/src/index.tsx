import type { ReactNode } from "react";

const MAIN_NAVIGATION = [
  { label: "研究组合", href: "/portfolio", enabled: true },
  { label: "研究项目", href: "/portfolio", enabled: true },
  { label: "科学决策", href: "/decisions", enabled: true },
  { label: "智能工作", href: "#", enabled: false },
  { label: "共享资产", href: "#", enabled: false },
  { label: "团队", href: "/team", enabled: true },
  { label: "系统", href: "#", enabled: false },
] as const;

export function AppShell({
  memberName,
  children,
}: {
  memberName: string;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Research Workbench</p>
          <h1 className="brand">科研工作台</h1>
        </div>
        <nav aria-label="主导航" className="main-nav">
          {MAIN_NAVIGATION.map((item) =>
            item.enabled ? (
              <a href={item.href} key={item.label}>
                {item.label}
              </a>
            ) : (
              <span aria-disabled="true" key={item.label} title="后续阶段开放">
                {item.label}
              </span>
            ),
          )}
        </nav>
        <div className="member-chip">
          <span>当前成员</span>
          <strong>{memberName}</strong>
        </div>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="page-header">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {description ? <p className="lede">{description}</p> : null}
    </header>
  );
}

export function ProjectCard({
  id,
  title,
  leadName,
  states,
}: {
  id: string;
  title: string;
  leadName: string;
  states: Array<{ dimension: string; state: string }>;
}) {
  return (
    <article className="project-card" data-testid="project-card">
      <div>
        <p className="meta">研究主理人 · {leadName}</p>
        <h3>
          <a href={`/projects/${id}`}>{title}</a>
        </h3>
      </div>
      <div className="state-strip" aria-label="科研状态摘要">
        {states.length === 0 ? (
          <span className="state-pill muted">尚未登记科研状态</span>
        ) : (
          states.slice(0, 3).map((item) => (
            <span className="state-pill" key={item.dimension}>
              {item.dimension} · {item.state}
            </span>
          ))
        )}
      </div>
    </article>
  );
}

export function DimensionState({
  dimension,
  state,
}: {
  dimension: string;
  state: string;
}) {
  return (
    <div className="dimension-state" data-testid="dimension-state">
      <span>{dimension}</span>
      <strong>{state}</strong>
    </div>
  );
}
