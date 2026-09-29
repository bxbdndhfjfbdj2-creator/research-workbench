import type {
  AgentWorkRunView,
  AgentWorkTaskView,
  ProjectAgentWorkViewModel,
} from "../../server/queries";
import {
  answerAgentApprovalAction,
  answerAgentQuestionAction,
  createAgentWorkAction,
  queueAgentRunAction,
  retryAgentRunAction,
} from "../../server/agent-actions";

function payloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function artifactText(artifact: AgentWorkRunView["artifacts"][number]): string {
  const payload = payloadRecord(artifact.payload);
  if (!payload) return JSON.stringify(artifact.payload);
  if (artifact.kind === "visible_summary" && typeof payload.summary === "string") {
    return payload.summary;
  }
  if (artifact.kind === "artifact_ref" && typeof payload.ref === "string") {
    return payload.ref;
  }
  if (artifact.kind === "tool_fact") {
    return [payload.tool, payload.summary].filter((item) => typeof item === "string").join(" · ");
  }
  if (artifact.kind === "github_hint") {
    return [payload.kind, payload.value].filter((item) => typeof item === "string").join(" · ");
  }
  return JSON.stringify(artifact.payload);
}

function questionDetails(run: AgentWorkRunView) {
  if (run.interaction?.kind !== "question") return null;
  const payload = payloadRecord(run.interaction.payload);
  const questions = Array.isArray(payload?.questions) ? payload?.questions : [];
  const first = questions[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const record = first as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : "response",
    text: typeof record.question === "string" ? record.question : "需要人工输入",
  };
}

function RunCard({
  projectId,
  run,
}: {
  projectId: string;
  run: AgentWorkRunView;
}) {
  const question = questionDetails(run);
  return (
    <article className="agent-run-card" data-testid="agent-run">
      <div className="agent-run-heading">
        <strong>尝试 {run.attemptNumber}</strong>
        <span className="status-label">{run.state}</span>
      </div>
      {run.failureCode ? <p className="run-failure">失败原因 · {run.failureCode}</p> : null}

      {run.interaction ? (
        <div className="human-interaction">
          <strong>等待人工输入</strong>
          {question ? <p>{question.text}</p> : <p>该执行需要一次性人工授权。</p>}
          {question ? (
            <form action={answerAgentQuestionAction} className="inline-action-form">
              <input type="hidden" name="interactionId" value={run.interaction.id} />
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="questionId" value={question.id} />
              <label>
                回答
                <input name="answer" required />
              </label>
              <button type="submit">提交回答</button>
            </form>
          ) : (
            <form action={answerAgentApprovalAction} className="inline-action-form">
              <input type="hidden" name="interactionId" value={run.interaction.id} />
              <input type="hidden" name="projectId" value={projectId} />
              <button name="answer" value="allowed-once" type="submit">允许一次</button>
              <button className="secondary-action" name="answer" value="rejected" type="submit">拒绝</button>
            </form>
          )}
        </div>
      ) : null}

      {run.artifacts.length > 0 ? (
        <div className="run-artifacts">
          <strong>可见执行产物</strong>
          {run.artifacts.map((artifact, index) => (
            <span key={`${artifact.kind}-${index}`}>{artifactText(artifact)}</span>
          ))}
        </div>
      ) : null}

      {run.researchResult ? (
        <div className="run-result">
          <strong>科研结果</strong>
          <span>{run.researchResult.dataVersionRef}</span>
          <span>{run.researchResult.executionKind === "code" ? "代码结果" : "人工结果"}</span>
        </div>
      ) : null}

      <details className="run-details">
        <summary>运行与上下文详情</summary>
        <dl>
          <div><dt>ContextSnapshot</dt><dd className="mono">{run.contextSnapshotId ?? "—"}</dd></div>
          <div><dt>Harness Session</dt><dd>{run.session?.sessionId ?? "尚未建立"}</dd></div>
          <div><dt>理论 revision</dt><dd className="mono">{run.snapshot?.theoryRevisionId ?? "—"}</dd></div>
          <div><dt>数据版本</dt><dd>{run.snapshot?.dataVersionRef ?? "—"}</dd></div>
          <div><dt>Git 基线</dt><dd className="mono">{run.snapshot?.gitBaseCommit ?? "—"}</dd></div>
          <div><dt>Harness</dt><dd className="mono" title={run.snapshot?.harnessVersion ?? undefined}>{run.snapshot?.harnessVersion ?? "—"}</dd></div>
          <div><dt>运行配置</dt><dd>{run.snapshot?.runtimeProfile ?? "—"} · {run.snapshot?.sandboxPolicy ?? "—"}</dd></div>
          <div><dt>模型路由</dt><dd>{run.snapshot?.modelRoute ?? "—"}</dd></div>
        </dl>
      </details>


      {run.state === "已提议" || run.state === "等待授权" ? (
        <form action={queueAgentRunAction} className="run-retry-form">
          <input type="hidden" name="runId" value={run.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <button type="submit">授权并排队</button>
        </form>
      ) : null}

      {run.state === "失败" || run.state === "取消" || run.state === "被替代" ? (
        <form action={retryAgentRunAction} className="run-retry-form">
          <input type="hidden" name="runId" value={run.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <button type="submit">重新运行</button>
        </form>
      ) : null}
    </article>
  );
}

export function AgentTaskList({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: AgentWorkTaskView[];
}) {
  if (tasks.length === 0) {
    return <div className="panel"><p className="meta">当前还没有智能工作。</p></div>;
  }
  return (
    <div className="agent-task-list">
      {tasks.map((task) => (
        <article className="agent-task-card" data-testid="agent-task" key={task.id}>
          <div className="agent-task-heading">
            <div>
              <p className="meta">科研事项 · {task.researchTaskTitle}</p>
              <h3>{task.objective}</h3>
            </div>
            <span className="status-label">AgentTask</span>
          </div>
          {task.expectedOutput ? <p className="task-output">期望输出 · {task.expectedOutput}</p> : null}
          <div className="agent-run-list">
            {task.runs.map((run) => (
              <RunCard projectId={projectId} run={run} key={run.id} />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function CreateAgentWorkForm({
  projectId,
  researchTasks,
}: {
  projectId: string;
  researchTasks: ProjectAgentWorkViewModel["researchTasks"];
}) {
  if (researchTasks.length === 0) return null;
  return (
    <section className="panel">
      <h3>从科研事项创建智能工作</h3>
      <p className="meta">只定义科研目标与期望输出。模型、Harness 版本和执行策略由工作台冻结，不由研究者逐次选择。</p>
      <form action={createAgentWorkAction} className="agent-create-form">
        <input type="hidden" name="projectId" value={projectId} />
        <label>
          科研事项
          <select aria-label="科研事项" name="researchTaskId" required defaultValue={researchTasks[0]?.id}>
            {researchTasks.map((task) => (
              <option value={task.id} key={task.id}>{task.title}</option>
            ))}
          </select>
        </label>
        <label>
          智能工作目标
          <input name="objective" required />
        </label>
        <label>
          期望输出
          <input name="expectedOutput" required />
        </label>
        <button type="submit">创建智能工作</button>
      </form>
    </section>
  );
}
