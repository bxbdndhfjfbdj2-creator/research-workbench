import Link from "next/link";
import type { ProjectResearchWorkViewModel } from "../../server/work-queries";
import { createResearchTaskAction } from "../../server/work-actions";

export function ResearchTaskList({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: ProjectResearchWorkViewModel["tasks"];
}) {
  return (
    <div className="research-work-list">
      {tasks.length === 0 ? (
        <div className="panel"><p className="meta">当前还没有科研事项。</p></div>
      ) : (
        tasks.map((task) => (
          <article className="research-work-card" data-testid="research-task" key={task.id}>
            <div className="research-work-heading">
              <div>
                <p className="meta">{task.owner.displayName} · {task.executionMode} · {task.reviewPolicy}</p>
                <h3><Link href={`/projects/${projectId}/work/${task.id}`}>{task.title}</Link></h3>
              </div>
              <span className="status-label">{task.status}</span>
            </div>
            <div className="research-work-facts">
              <span>提交 · {task.latestSubmission ? `#${task.latestSubmission.submissionNumber}` : "尚无"}</span>
              <span>审核 · {task.currentReview?.status ?? "无需/尚无"}</span>
              <span>Agent Runs · {task.agentRunCount}</span>
              <span>最新 Agent · {task.latestAgentRunState ?? "—"}</span>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

export function CreateResearchTaskForm({ projectId }: { projectId: string }) {
  return (
    <section className="panel">
      <h3>创建科研事项</h3>
      <form action={createResearchTaskAction} className="research-work-form">
        <input type="hidden" name="projectId" value={projectId} />
        <label>
          标题
          <input name="title" maxLength={200} required />
        </label>
        <label>
          描述
          <textarea name="description" maxLength={4000} />
        </label>
        <label>
          执行方式
          <select name="executionMode" defaultValue="human">
            <option value="human">human</option>
            <option value="agent">agent</option>
            <option value="hybrid">hybrid</option>
          </select>
        </label>
        <label>
          审核策略
          <select name="reviewPolicy" defaultValue="none">
            <option value="none">none</option>
            <option value="required">required</option>
          </select>
        </label>
        <label>
          验收标准（每行一条）
          <textarea name="acceptanceCriteria" />
        </label>
        <button type="submit">创建科研事项</button>
      </form>
    </section>
  );
}
