import { PageHeader } from "@research-workbench/ui";
import { ScientificDecisionList } from "../../../src/components/decisions/scientific-decision-list";
import {
  listAttentionDecisions,
  requireCurrentMember,
} from "../../../src/server/queries";

export default async function DecisionsPage() {
  const member = await requireCurrentMember();
  const decisions = await listAttentionDecisions(member);

  return (
    <section>
      <PageHeader
        eyebrow={member.organizationRole === "lead" ? "团队治理" : "我的审批"}
        title="科学决策中心"
        description="集中查看需要人工判断的研究变更；重大决策必须经过项目主理人与总负责人两级审批。"
      />
      <ScientificDecisionList items={decisions} showProject />
    </section>
  );
}
