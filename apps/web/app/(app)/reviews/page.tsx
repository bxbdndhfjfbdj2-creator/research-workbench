import { PageHeader } from "@research-workbench/ui";
import { ReviewInbox } from "../../../src/components/research-work/review-inbox";
import { requireCurrentMember } from "../../../src/server/queries";
import { listMyReviewInbox } from "../../../src/server/work-queries";

export default async function ReviewsPage() {
  const member = await requireCurrentMember();
  const items = await listMyReviewInbox(member);
  return (
    <section>
      <PageHeader
        eyebrow="普通交付审核"
        title="待我审核"
        description="只展示明确指派给你的普通 ReviewRequest。科学治理仍在科学决策中心独立处理。"
      />
      <ReviewInbox items={items} />
    </section>
  );
}
