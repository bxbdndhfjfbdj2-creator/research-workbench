import type { DecisionCenterItem } from "../../server/queries";
import { reviewScientificDecisionAction } from "../../server/decision-actions";

const STATUS_LABELS: Record<DecisionCenterItem["status"], string> = {
  proposed: "待项目主理人审批",
  awaiting_lead: "等待总负责人批准",
  needs_evidence: "需要补充证据",
  approved: "已批准",
  rejected: "已拒绝",
};

function reviewButtonLabel(item: DecisionCenterItem): string {
  return item.reviewStage === "team_lead" ? "总负责人批准" : "主理人批准";
}

export function ScientificDecisionCard({
  item,
  showProject = false,
}: {
  item: DecisionCenterItem;
  showProject?: boolean;
}) {
  return (
    <article className="decision-card" data-testid="scientific-decision">
      <div className="decision-card-heading">
        <div>
          {showProject ? <p className="meta">{item.projectTitle}</p> : null}
          <h3>{item.title}</h3>
        </div>
        <div className="decision-badges">
          <span className="status-label">
            {item.level === "major" ? "重大决策" : "一般决策"}
          </span>
          {item.proposerType === "agent" ? (
            <span className="status-label">AI 提议</span>
          ) : null}
          <span className="status-label">{STATUS_LABELS[item.status]}</span>
        </div>
      </div>

      <dl className="decision-details">
        <div><dt>原因</dt><dd>{item.reason}</dd></div>
        <div>
          <dt>证据</dt>
          <dd>
            {item.evidence.length > 0
              ? item.evidence.map((evidence) => `${evidence.kind} · ${evidence.ref}`).join("；")
              : "未附加证据引用"}
          </dd>
        </div>
        <div><dt>影响</dt><dd>{item.impact.join("、") || "仅记录"}</dd></div>
        {item.targetSlot ? <div><dt>变更位置</dt><dd>{item.targetSlot}</dd></div> : null}
        {item.targetRevisionSummary ? (
          <div><dt>候选新版本</dt><dd>{item.targetRevisionSummary}</dd></div>
        ) : null}
      </dl>

      {item.reviews.length > 0 ? (
        <div className="decision-review-history">
          <strong>审批记录</strong>
          {item.reviews.map((review, index) => (
            <span key={`${review.stage}-${index}`}>
              {review.stage === "team_lead" ? "总负责人" : "项目主理人"} ·
              {review.action === "approve" ? "批准" : review.action === "reject" ? "拒绝" : "要求补充证据"} ·
              {review.reviewerName}
            </span>
          ))}
        </div>
      ) : null}

      {item.canReview ? (
        <div className="decision-actions">
          <form action={reviewScientificDecisionAction}>
            <input type="hidden" name="decisionId" value={item.id} />
            <input type="hidden" name="projectId" value={item.projectId} />
            <button name="action" value="approve" type="submit">
              {reviewButtonLabel(item)}
            </button>
            <button className="secondary-action" name="action" value="request_evidence" type="submit">
              要求补充证据
            </button>
            <button className="secondary-action" name="action" value="reject" type="submit">
              拒绝
            </button>
          </form>
        </div>
      ) : null}
    </article>
  );
}
