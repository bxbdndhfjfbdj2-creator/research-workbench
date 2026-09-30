import Link from "next/link";

const ITEMS = [
  { label: "总览", segment: "" },
  { label: "研究网络", segment: "/network" },
  { label: "证据与结果", segment: "/evidence" },
  { label: "科学决策", segment: "/decisions" },
  { label: "智能工作", segment: "/agent-work" },
  { label: "文件与资料", segment: "/files" },
] as const;

export function ProjectNavigation({
  projectId,
  active,
}: {
  projectId: string;
  active: (typeof ITEMS)[number]["label"];
}) {
  return (
    <nav className="project-nav" aria-label="项目导航">
      {ITEMS.map((item) => (
        <Link
          className={item.label === active ? "active" : undefined}
          href={`/projects/${projectId}${item.segment}`}
          key={item.label}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
