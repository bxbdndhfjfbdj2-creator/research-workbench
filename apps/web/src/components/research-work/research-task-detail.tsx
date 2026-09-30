import type { CurrentMember, ProjectOverview } from "../../server/queries";
import type { ResearchTaskDetailViewModel } from "../../server/work-queries";
import {
  approveReviewAction,
  assignResearchTaskOwnerAction,
  blockResearchTaskAction,
  cancelResearchTaskAction,
  completeUnreviewedTaskAction,
  escalateReviewAction,
  reassignReviewerAction,
  rejectReviewAction,
  reopenResearchTaskAction,
  requestReviewChangesAction,
  setResearchTaskExecutionModeAction,
  setResearchTaskReviewPolicyAction,
  startResearchTaskAction,
  submitResearchTaskAction,
  unblockResearchTaskAction,
  updateResearchTaskRequirementsAction,
} from "../../server/work-actions";

type MemberOption = { id: string; displayName: string };

function hiddenContext(projectId: string, taskId: string) {
  return (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
    </>
  );
}

export function ResearchTaskDetail({
  task,
  project,
  member,
  reviewerCandidates,
}: {
  task: ResearchTaskDetailViewModel;
  project: ProjectOverview;
  member: CurrentMember;
  reviewerCandidates: MemberOption[];
}) {
  const isProjectLead = project.members.some(
    (item) => item.id === member.id && item.role === "lead",
  );
  const canManage = member.organizationRole === "lead" || isProjectLead || task.owner.id === member.id;
  const canAssign = member.organizationRole === "lead" || isProjectLead;
  const latest = task.submissions.at(-1) ?? null;
  const currentReview = latest?.review ?? null;
  const isReviewer = currentReview?.reviewerMemberId === member.id;

  return (
    <div className="research-task-detail">
      <section className="panel">
        <div className="research-work-heading">
          <div>
            <p className="meta">负责人 · {task.owner.displayName}</p>
            <h3>{task.title}</h3>
          </div>
          <span className="status-label">{task.status}</span>
        </div>
        {task.description ? <p>{task.description}</p> : null}
        <div className="research-work-facts">
          <span>执行方式 · {task.executionMode}</span>
          <span>审核策略 · {task.reviewPolicy}</span>
          <span>Workflow · v{task.workflowVersion}</span>
        </div>
        {task.acceptanceCriteria.length > 0 ? (
          <ul>{task.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
        ) : null}

        {canManage ? (
          <div className="task-action-grid">
            {task.status === "open" ? (
              <form action={startResearchTaskAction}>
                {hiddenContext(task.projectId, task.id)}
                <button type="submit">开始任务</button>
              </form>
            ) : null}
            {task.status === "in_progress" ? (
              <form action={blockResearchTaskAction}>
                {hiddenContext(task.projectId, task.id)}
                <button type="submit">标记受阻</button>
              </form>
            ) : null}
            {task.status === "blocked" ? (
              <form action={unblockResearchTaskAction}>
                {hiddenContext(task.projectId, task.id)}
                <button type="submit">恢复执行</button>
              </form>
            ) : null}
            {["open", "in_progress", "blocked", "awaiting_review"].includes(task.status) ? (
              <form action={cancelResearchTaskAction}>
                {hiddenContext(task.projectId, task.id)}
                <button className="secondary-action" type="submit">取消任务</button>
              </form>
            ) : null}
            {task.status === "completed" ? (
              <form action={reopenResearchTaskAction}>
                {hiddenContext(task.projectId, task.id)}
                <button type="submit">重新打开任务</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>

      {canManage && ["open", "in_progress", "blocked"].includes(task.status) ? (
        <section className="panel">
          <h3>当前任务要求</h3>
          <form action={updateResearchTaskRequirementsAction} className="research-work-form">
            {hiddenContext(task.projectId, task.id)}
            <label>标题<input name="title" defaultValue={task.title} maxLength={200} required /></label>
            <label>描述<textarea name="description" defaultValue={task.description ?? ""} maxLength={4000} /></label>
            <label>验收标准（每行一条）<textarea name="acceptanceCriteria" defaultValue={task.acceptanceCriteria.join("\n")} /></label>
            <button type="submit">更新任务要求</button>
          </form>

          <form action={setResearchTaskExecutionModeAction} className="inline-action-form">
            {hiddenContext(task.projectId, task.id)}
            <label>执行方式
              <select name="executionMode" defaultValue={task.executionMode}>
                <option value="human">human</option>
                <option value="agent">agent</option>
                <option value="hybrid">hybrid</option>
              </select>
            </label>
            <button type="submit">更新执行方式</button>
          </form>

          {task.submissions.length === 0 ? (
            <form action={setResearchTaskReviewPolicyAction} className="inline-action-form">
              {hiddenContext(task.projectId, task.id)}
              <label>审核策略
                <select name="reviewPolicy" defaultValue={task.reviewPolicy}>
                  <option value="none">none</option>
                  <option value="required">required</option>
                </select>
              </label>
              <button type="submit">更新审核策略</button>
            </form>
          ) : null}

          {canAssign ? (
            <form action={assignResearchTaskOwnerAction} className="inline-action-form">
              {hiddenContext(task.projectId, task.id)}
              <label>负责人
                <select name="memberId" defaultValue={task.owner.id}>
                  {reviewerCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>
                  ))}
                </select>
              </label>
              <button type="submit">更换负责人</button>
            </form>
          ) : null}
        </section>
      ) : null}

      {task.status === "in_progress" && task.owner.id === member.id ? (
        <section className="panel">
          <h3>正式提交</h3>
          <form action={submitResearchTaskAction} className="research-work-form">
            {hiddenContext(task.projectId, task.id)}
            <label>提交说明<textarea name="summary" maxLength={8000} required /></label>
            {task.reviewPolicy === "required" ? (
              <label>指定审核人
                <select name="reviewerMemberId" required defaultValue="">
                  <option value="" disabled>选择审核人</option>
                  {reviewerCandidates.filter((candidate) => candidate.id !== member.id).map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {task.executionMode !== "human" ? (
              <label>AgentRun ID（可选贡献者）<input name="agentRunContributorId" /></label>
            ) : null}
            <div className="submission-ref-grid">
              <label>引用类型
                <select name="refKind" defaultValue="">
                  <option value="">无</option>
                  <option value="file_version">file_version</option>
                  <option value="research_result">research_result</option>
                  <option value="research_node_revision">research_node_revision</option>
                  <option value="agent_run">agent_run</option>
                </select>
              </label>
              <label>引用 ID<input name="refId" /></label>
              <label>关系
                <select name="refRelation" defaultValue="">
                  <option value="">无</option>
                  <option value="deliverable">deliverable</option>
                  <option value="evidence">evidence</option>
                  <option value="source">source</option>
                  <option value="context">context</option>
                </select>
              </label>
            </div>
            <button type="submit">创建正式提交</button>
          </form>
        </section>
      ) : null}

      {task.reviewPolicy === "none" && task.status === "in_progress" && latest && task.owner.id === member.id ? (
        <section className="panel">
          <h3>接受当前提交</h3>
          <p className="meta">最新提交 #{latest.submissionNumber}</p>
          <form action={completeUnreviewedTaskAction}>
            {hiddenContext(task.projectId, task.id)}
            <input type="hidden" name="submissionId" value={latest.id} />
            <button type="submit">完成任务</button>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <h3>提交与审核历史</h3>
        {task.submissions.length === 0 ? <p className="meta">尚无正式提交。</p> : (
          <div className="submission-history">
            {task.submissions.map((submission) => (
              <article className="submission-card" data-testid="task-submission" key={submission.id}>
                <div className="research-work-heading">
                  <div>
                    <strong>Submission #{submission.submissionNumber}</strong>
                    <p className="meta">{submission.submitterName} · {submission.createdAt.toISOString()}</p>
                  </div>
                  {submission.review ? <span className="status-label">{submission.review.status}</span> : null}
                </div>
                <p>{submission.summary}</p>
                <details>
                  <summary>冻结任务要求与 provenance</summary>
                  <p className="meta">执行方式 · {submission.requirementSnapshot.executionMode} · 审核策略 · {submission.requirementSnapshot.reviewPolicy}</p>
                  <ul>
                    {submission.contributors.map((contributor) => (
                      <li key={`${contributor.kind}:${contributor.id}`}>{contributor.kind} · {contributor.displayName}</li>
                    ))}
                    {submission.refs.map((ref) => (
                      <li key={`${ref.kind}:${ref.id}:${ref.relation}`}>
                        {ref.kind} · {ref.label} · {ref.relation}
                        {ref.accessClass ? ` · ${ref.accessClass}` : ""}
                        {ref.versionNumber ? ` · v${ref.versionNumber}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>

                {submission.review ? (
                  <div className="review-section">
                    <strong>普通审核 · {submission.review.reviewerName}</strong>
                    {submission.review.linkedDecisions.length > 0 ? (
                      <div className="linked-decisions">
                        {submission.review.linkedDecisions.map((decision) => (
                          <span key={decision.id}>ScientificDecision · {decision.title} · {decision.status}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      {currentReview && currentReview.status === "pending" ? (
        <section className="panel">
          <h3>当前普通审核</h3>
          <p className="meta">审核人 · {currentReview.reviewerName}</p>
          {canAssign ? (
            <form action={reassignReviewerAction} className="inline-action-form">
              {hiddenContext(task.projectId, task.id)}
              <input type="hidden" name="reviewRequestId" value={currentReview.id} />
              <label>重新指派
                <select name="reviewerMemberId" defaultValue={currentReview.reviewerMemberId}>
                  {reviewerCandidates.filter((candidate) => candidate.id !== task.owner.id).map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>
                  ))}
                </select>
              </label>
              <button type="submit">重新指派审核</button>
            </form>
          ) : null}
          {isReviewer ? (
            <div className="review-actions">
              <form action={approveReviewAction}>
                {hiddenContext(task.projectId, task.id)}
                <input type="hidden" name="reviewRequestId" value={currentReview.id} />
                <label>审核意见（可选）<textarea name="comment" maxLength={4000} /></label>
                <button type="submit">批准提交</button>
              </form>
              <form action={requestReviewChangesAction}>
                {hiddenContext(task.projectId, task.id)}
                <input type="hidden" name="reviewRequestId" value={currentReview.id} />
                <label>修改要求<textarea name="comment" maxLength={4000} required /></label>
                <button type="submit">要求修改</button>
              </form>
              <form action={rejectReviewAction}>
                {hiddenContext(task.projectId, task.id)}
                <input type="hidden" name="reviewRequestId" value={currentReview.id} />
                <label>拒绝原因<textarea name="comment" maxLength={4000} required /></label>
                <button className="secondary-action" type="submit">拒绝提交</button>
              </form>
              <form action={escalateReviewAction} className="research-work-form">
                {hiddenContext(task.projectId, task.id)}
                <input type="hidden" name="reviewRequestId" value={currentReview.id} />
                <label>决策级别
                  <select name="decisionLevel" defaultValue="general">
                    <option value="general">general</option>
                    <option value="major">major</option>
                  </select>
                </label>
                <label>ScientificDecision 标题<input name="decisionTitle" maxLength={200} required /></label>
                <label>升级原因<textarea name="decisionReason" maxLength={4000} required /></label>
                <label>变更类型
                  <select name="changeKind" defaultValue="record_only">
                    <option value="record_only">仅记录</option>
                    <option value="official_revision">正式 revision</option>
                  </select>
                </label>
                <label>正式槽位（仅 official_revision）
                  <select name="officialSlot" defaultValue="">
                    <option value="">—</option>
                    <option value="核心研究问题">核心研究问题</option>
                    <option value="正式理论">正式理论</option>
                    <option value="主测量指标">主测量指标</option>
                    <option value="主样本">主样本</option>
                    <option value="主数据版本">主数据版本</option>
                    <option value="识别策略">识别策略</option>
                    <option value="主模型">主模型</option>
                    <option value="探索结果升级为正式结果">探索结果升级为正式结果</option>
                    <option value="论文核心主张">论文核心主张</option>
                  </select>
                </label>
                <label>Revision ID（仅 official_revision）<input name="revisionId" /></label>
                <button type="submit">升级为 ScientificDecision</button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {currentReview?.status === "awaiting_scientific_decision" ? (
        <section className="panel">
          <h3>等待科学决策</h3>
          <p>普通审核已暂停。ScientificDecision 达到 approved/rejected 终态后，普通审核会恢复 pending，由原审核人继续验收。</p>
        </section>
      ) : null}
    </div>
  );
}
