import type { ReactNode } from "react";
import { AppShell } from "@research-workbench/ui";
import { requireCurrentMember } from "../../src/server/queries";

export const dynamic = "force-dynamic";

export default async function WorkbenchLayout({
  children,
}: {
  children: ReactNode;
}) {
  const member = await requireCurrentMember();
  return <AppShell memberName={member.displayName}>{children}</AppShell>;
}
