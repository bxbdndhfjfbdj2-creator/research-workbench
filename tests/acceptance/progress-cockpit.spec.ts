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
  if (!environment.cockpit) throw new Error("Cockpit acceptance controller missing");
  await environment.cockpit.ageTask(
    environment.cockpit.idleTaskId,
    "2026-09-01T00:00:00.000Z",
  );
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


test("project overview keeps scientific state before cockpit attention and members", async ({
  page,
}) => {
  const projectLead = environment.researchers[0];
  if (!projectLead?.projectId) throw new Error("Acceptance project missing");

  await login(page, projectLead.email, projectLead.password);
  await page.goto(`/projects/${projectLead.projectId}`);

  await expect(page.getByRole("heading", { name: "多维科研状态" })).toBeVisible();
  await expect(page.getByTestId("project-actions")).toBeVisible();
  await expect(page.getByTestId("project-attention")).toBeVisible();
  await expect(page.getByTestId("recent-activity")).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目成员" })).toBeVisible();

  const headings = await page.locator("h3").allTextContents();
  expect(headings.indexOf("多维科研状态")).toBeLessThan(
    headings.indexOf("项目关注"),
  );
  expect(headings.indexOf("项目关注")).toBeLessThan(
    headings.indexOf("最近重要正式变化"),
  );
  expect(headings.indexOf("最近重要正式变化")).toBeLessThan(
    headings.indexOf("项目成员"),
  );
});

test("project cockpit projects current blocked idle Agent and file facts safely", async ({
  page,
}) => {
  const projectLead = environment.researchers[0];
  const cockpit = environment.cockpit;
  if (!projectLead?.projectId || !cockpit) {
    throw new Error("Acceptance project/cockpit fixture missing");
  }

  await login(page, projectLead.email, projectLead.password);
  await page.goto(`/projects/${projectLead.projectId}`);

  const attention = page.getByTestId("project-attention");
  await expect(attention).toContainText("Cockpit 受阻任务 · 任务受阻");
  await expect(attention).toContainText("Cockpit 长时间无记录活动");
  await expect(attention).toContainText("等待人工输入");
  await expect(attention).toContainText("最新 Agent 运行失败");
  await expect(attention).toContainText(
    "Cockpit Restricted Parse Failure · 当前文件版本解析失败",
  );
  await expect(attention).not.toContainText("等待你");

  const html = await page.content();
  expect(html).not.toContain(cockpit.currentParseFailureLocator);
  expect(html).not.toContain(cockpit.currentParseFailureAccessPolicyRef);
});

test("project cockpit deep-links to canonical workflows only", async ({ page }) => {
  const projectLead = environment.researchers[0];
  const cockpit = environment.cockpit;
  if (!projectLead?.projectId || !cockpit) {
    throw new Error("Acceptance project/cockpit fixture missing");
  }

  const projectId = projectLead.projectId;
  await login(page, projectLead.email, projectLead.password);
  await page.goto(`/projects/${projectId}`);

  const actions = page.getByTestId("project-actions");
  await expect(
    actions.getByRole("link", { name: /变更正式理论/ }),
  ).toHaveAttribute("href", `/projects/${projectId}/decisions`);

  const attention = page.getByTestId("project-attention");
  await expect(
    attention.getByRole("link", { name: /Cockpit 受阻任务/ }),
  ).toHaveAttribute("href", `/projects/${projectId}/work/${cockpit.blockedTaskId}`);
  await expect(
    attention.getByRole("link", { name: /Cockpit 长时间无记录活动/ }),
  ).toHaveAttribute("href", `/projects/${projectId}/work/${cockpit.idleTaskId}`);
  await expect(
    attention.getByRole("link", { name: /等待人工输入/ }),
  ).toHaveAttribute(
    "href",
    `/projects/${projectId}/agent-work#agent-run-${environment.agentWork.waitingRunId}`,
  );
  await expect(
    attention.getByRole("link", { name: /最新 Agent 运行失败/ }),
  ).toHaveAttribute(
    "href",
    `/projects/${projectId}/agent-work#agent-run-${environment.agentWork.failedRunId}`,
  );
  await expect(
    attention.getByRole("link", { name: /当前文件版本解析失败/ }),
  ).toHaveAttribute(
    "href",
    `/projects/${projectId}/files/${cockpit.currentParseFailureFileId}`,
  );
});
