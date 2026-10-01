import "server-only";

import { listPortfolioCockpit } from "@research-workbench/application/src/projections/cockpit-query-service";
import type {
  CockpitViewer,
  PortfolioCockpit,
} from "@research-workbench/application/src/projections/cockpit-types";
import { createDbClient } from "@research-workbench/db/src/client";
import type { CurrentMember } from "./queries";

type WebDbClient = ReturnType<typeof createDbClient>;

const globalWebDb = globalThis as typeof globalThis & {
  __researchWorkbenchDb?: WebDbClient;
};

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  return value;
}

function webDb(): WebDbClient {
  globalWebDb.__researchWorkbenchDb ??= createDbClient(databaseUrl());
  return globalWebDb.__researchWorkbenchDb;
}

function toViewer(member: CurrentMember): CockpitViewer {
  return {
    memberId: member.id,
    teamId: member.teamId,
    organizationRole: member.organizationRole,
  };
}

export type PortfolioCockpitPageData =
  | { status: "ready"; data: PortfolioCockpit }
  | { status: "unavailable" };

export async function loadPortfolioCockpitForPage(
  member: CurrentMember,
): Promise<PortfolioCockpitPageData> {
  try {
    const data = await listPortfolioCockpit(
      webDb().sql,
      toViewer(member),
      new Date(),
    );
    return { status: "ready", data };
  } catch (error) {
    console.error("[cockpit] portfolio projection unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { status: "unavailable" };
  }
}
