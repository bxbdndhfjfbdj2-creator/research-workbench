import Link from "next/link";
import type { ReviewInboxItem } from "../../server/work-queries";

export function ReviewInbox({ items }: { items: ReviewInboxItem[] }) {
  if (items.length === 0) {
    return <div className="panel"><p className="meta">当前没有等待你的普通审核。</p></div>;
  }
  return (
    <div className="review-inbox">
      {items.map((item) => (
        <article className="review-inbox-card" data-testid="review-inbox-item" key={item.id}>
          <div>
            <p className="meta">{item.projectTitle} · Submission #{item.submissionNumber}</p>
            <h3><Link href={`/projects/${item.projectId}/work/${item.taskId}`}>{item.taskTitle}</Link></h3>
            <p className="meta">提交人 · {item.submitterName} · 等待自 {item.waitingSince.toISOString()}</p>
          </div>
          <span className="status-label">{item.status}</span>
          {!item.actionable ? <p className="meta">等待 ScientificDecision，当前不可执行普通审核。</p> : null}
        </article>
      ))}
    </div>
  );
}
