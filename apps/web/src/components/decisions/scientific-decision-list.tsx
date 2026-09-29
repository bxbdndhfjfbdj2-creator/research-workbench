import type { DecisionCenterItem } from "../../server/queries";
import { ScientificDecisionCard } from "./scientific-decision-card";

export function ScientificDecisionList({
  items,
  showProject = false,
}: {
  items: DecisionCenterItem[];
  showProject?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="panel">
        <p className="meta">当前没有需要你处理的科学决策。</p>
      </div>
    );
  }

  return (
    <div className="decision-list">
      {items.map((item) => (
        <ScientificDecisionCard
          item={item}
          key={item.id}
          showProject={showProject}
        />
      ))}
    </div>
  );
}
