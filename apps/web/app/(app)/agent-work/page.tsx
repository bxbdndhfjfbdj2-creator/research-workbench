import Link from "next/link";
import { PageHeader } from "@research-workbench/ui";
import { AgentTaskList } from "../../../src/components/agent-runs/agent-task-list";
import {
  listAgentWorkCenter,
  requireCurrentMember,
} from "../../../src/server/queries";

export default async function AgentWorkCenterPage() {
  const member = await requireCurrentMember();
  const projects = await listAgentWorkCenter(member);

  return (
    <section>
      <PageHeader
        eyebrow={member.organizationRole === "lead" ? "团队执行控制面" : "我的智能工作"}
        title="智能工作中心"
        description="集中查看 AgentTask、每次 Run、等待人工输入、失败尝试与可审计执行产物。科研正式状态仍由科学决策流程控制。"
      />
      <div className="agent-work-center">
        {projects.length === 0 ? <div className="panel"><p className="meta">当前没有可查看的智能工作。</p></div> : null}
        {projects.map((project) => (
          <section className="agent-project-section" key={project.projectId}>
            <div className="agent-project-heading">
              <h3>{project.projectTitle}</h3>
              <Link href={`/projects/${project.projectId}/agent-work`}>进入项目智能工作</Link>
            </div>
            <AgentTaskList projectId={project.projectId} tasks={project.agentTasks} />
          </section>
        ))}
      </div>
    </section>
  );
}
