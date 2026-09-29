import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

export type ResearchProject = {
  id: string;
  portfolioId: string;
  title: string;
  leadMemberId: string;
  createdAt: Date;
};

type InsertedProject = {
  id: string;
  portfolio_id: string;
  title: string;
  lead_member_id: string;
  created_at: Date;
};

export async function createProject(
  sql: DatabaseSql,
  input: { portfolioId: string; title: string; leadMemberId: string },
  actor: ActorRef,
): Promise<ResearchProject> {
  assertHumanActor(actor);

  const permission = await sql.unsafe(
    `select 1
     from members actor
     join research_portfolios rp on rp.id = $2 and rp.team_id = actor.team_id
     join members project_lead
       on project_lead.id = $3
      and project_lead.team_id = rp.team_id
      and project_lead.active = true
      and project_lead.actor_type = 'human'
     where actor.id = $1
       and actor.active = true
       and actor.actor_type = 'human'
       and (actor.organization_role = 'lead' or actor.id = project_lead.id)
     limit 1`,
    [actor.id, input.portfolioId, input.leadMemberId],
  );
  if (permission.length === 0) {
    throw new Error("Forbidden: actor cannot create a project in this portfolio");
  }

  const projectId = randomUUID();
  const membershipId = randomUUID();

  return runInTransaction(sql, async (tx) => {
    const rows = (await tx.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values ($1, $2, $3, $4)
       returning id, portfolio_id, title, lead_member_id, created_at`,
      [projectId, input.portfolioId, input.title.trim(), input.leadMemberId],
    )) as readonly InsertedProject[];

    await tx.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ($1, $2, $3, 'lead')`,
      [membershipId, projectId, input.leadMemberId],
    );

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "PROJECT_CREATED",
      actor,
      payload: {
        title: input.title.trim(),
        leadMemberId: input.leadMemberId,
        portfolioId: input.portfolioId,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "project.created",
      payload: { projectId },
    });

    const row = rows[0];
    if (!row) throw new Error("Project insert returned no row");
    return {
      id: row.id,
      portfolioId: row.portfolio_id,
      title: row.title,
      leadMemberId: row.lead_member_id,
      createdAt: row.created_at,
    };
  });
}
