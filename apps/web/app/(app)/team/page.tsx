import { PageHeader } from "@research-workbench/ui";
import {
  listTeamMembers,
  requireCurrentMember,
} from "../../../src/server/queries";

export default async function TeamPage() {
  const member = await requireCurrentMember();
  const members = await listTeamMembers(member);

  return (
    <section>
      <PageHeader
        eyebrow="固定内部团队"
        title="团队"
        description="第一阶段固定六名内部成员，不开放公众注册。"
      />
      <div className="panel">
        <ul className="member-list">
          {members.map((teamMember) => (
            <li key={teamMember.id}>
              <div>
                <strong>{teamMember.displayName}</strong>
                <span>{teamMember.email}</span>
              </div>
              <span>{teamMember.organizationRole === "lead" ? "总负责人" : "研究成员"}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
