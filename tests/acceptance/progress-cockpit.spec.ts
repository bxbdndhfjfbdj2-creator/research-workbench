import { expect, test } from "@playwright/test";
import {
  startAcceptanceEnvironment,
  type AcceptanceEnvironment,
} from "./support/environment";

test.describe.configure({ mode: "serial" });

let environment: AcceptanceEnvironment;

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/portfolio");
}

test.beforeAll(async () => {
  environment = await startAcceptanceEnvironment({ cockpitFixtures: true });
});

test.afterAll(async () => {
  await environment?.stop();
});

test("portfolio cockpit preserves role-aware project visibility and existing navigation", async ({
  page,
}) => {
  await login(page, environment.lead.email, environment.lead.password);
  await expect(page.getByRole("heading", { name: "研究组合" })).toBeVisible();
  await expect(page.getByTestId("project-card")).toHaveCount(5);
  await expect(page.getByRole("link", { name: "驾驶舱" })).toHaveCount(0);

  const researcher = environment.researchers[0];
  if (!researcher) throw new Error("Acceptance researcher missing");
  await login(page, researcher.email, researcher.password);
  await expect(page.getByTestId("project-card")).toHaveCount(1);
  await expect(page.getByText("研究项目1", { exact: true })).toBeVisible();
  await expect(page.getByText("研究项目2", { exact: true })).not.toBeVisible();
});

test("我的明确行动 only contains work formally assigned to the current member", async ({
  page,
}) => {
  const projectLead = environment.researchers[0];
  const assignedReviewer = environment.researchers[1];
  if (!projectLead || !assignedReviewer) {
    throw new Error("Acceptance researchers missing");
  }

  await login(page, assignedReviewer.email, assignedReviewer.password);
  const reviewerActions = page.getByTestId("my-actions");
  await expect(reviewerActions).toContainText("Cockpit 待研究成员2审核");
  await expect(reviewerActions).not.toContainText("变更正式理论");

  await login(page, projectLead.email, projectLead.password);
  const projectLeadActions = page.getByTestId("my-actions");
  await expect(projectLeadActions).toContainText("变更正式理论");
  await expect(projectLeadActions).not.toContainText("Cockpit 待研究成员2审核");

  await login(page, environment.lead.email, environment.lead.password);
  const leadActions = page.getByTestId("my-actions");
  await expect(leadActions).not.toContainText("变更正式理论");
  await expect(leadActions).not.toContainText("Cockpit 待研究成员2审核");
});
