import Link from "next/link";

const ITEMS = [
  { label: "总览", segment: "" },
  { label: "研究网络", segment: "/network" },
  { label: "证据与结果", segment: "/evidence" },
  { label: "科学决策", segment: null },
  { label: "智能工作", segment: null },
  { label: "项目资产", segment: null },
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
      {ITEMS.map((item) =>
        item.segment !== null ? (
          <Link
            className={item.label === active ? "active" : undefined}
            href={`/projects/${projectId}${item.segment}`}
            key={item.label}
          >
            {item.label}
          </Link>
        ) : (
          <span aria-disabled="true" key={item.label}>
            {item.label}
          </span>
        ),
      )}
    </nav>
  );
}
