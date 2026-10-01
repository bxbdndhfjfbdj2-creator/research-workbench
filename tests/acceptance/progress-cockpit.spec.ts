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

test("Recent Activity is curated, bounded, newest-first, and excludes stale/raw payload", async ({
  page,
}) => {
  const projectLead = environment.researchers[0];
  const cockpit = environment.cockpit;
  if (!projectLead?.projectId || !cockpit) {
    throw new Error("Acceptance project/cockpit fixture missing");
  }

  await login(page, projectLead.email, projectLead.password);
  await page.goto(`/projects/${projectLead.projectId}`);

  const recent = page.getByTestId("recent-activity");
  await expect(recent).toContainText(
    "Cockpit Restricted Parse Failure · 文件解析失败",
  );
  await expect(recent).toContainText("主分析方案 · 已创建");
  await expect(recent).toContainText("变更正式理论 · 已提出");
  await expect(recent).toContainText("主分析 · 验证中");
  await expect(recent).not.toContainText("Cockpit 14天外事件 · 已受阻");

  const items = recent.locator("li");
  expect(await items.count()).toBeLessThanOrEqual(10);
  const labels = await items.locator("strong").allTextContents();
  const submissionIndex = labels.findIndex((label) =>
    label.includes("Cockpit 待研究成员2审核 · 提交 #1"),
  );
  const blockedIndex = labels.findIndex((label) =>
    label.includes("Cockpit 受阻任务 · 已受阻"),
  );
  expect(submissionIndex).toBeGreaterThanOrEqual(0);
  expect(blockedIndex).toBeGreaterThanOrEqual(0);
  expect(submissionIndex).toBeLessThan(blockedIndex);

  const html = await recent.innerHTML();
  expect(html).not.toContain(cockpit.rawEventShaSentinel);
  expect(html).not.toContain(cockpit.rawEventErrorSentinel);
});

test("canonical unblock clears current blocked attention while preserving history", async ({
  page,
}) => {
  const projectLead = environment.researchers[0];
  const cockpit = environment.cockpit;
  if (!projectLead?.projectId || !cockpit) {
    throw new Error("Acceptance project/cockpit fixture missing");
  }

  await login(page, projectLead.email, projectLead.password);
  await page.goto(
    `/projects/${projectLead.projectId}/work/${cockpit.blockedTaskId}`,
  );
  await page.getByRole("button", { name: "恢复执行" }).click();

  await page.goto(`/projects/${projectLead.projectId}`);
  const attention = page.getByTestId("project-attention");
  await expect(attention).not.toContainText("Cockpit 受阻任务 · 任务受阻");
  await expect(page.getByTestId("recent-activity")).toContainText(
    "Cockpit 受阻任务 · 已解除受阻",
  );
});

test("a new formal Submission resets long-idle projection", async ({ page }) => {
  const projectLead = environment.researchers[0];
  const cockpit = environment.cockpit;
  if (!projectLead?.projectId || !cockpit) {
    throw new Error("Acceptance project/cockpit fixture missing");
  }

  await login(page, projectLead.email, projectLead.password);
  await page.goto(
    `/projects/${projectLead.projectId}/work/${cockpit.idleTaskId}`,
  );
  await page
    .getByLabel("提交说明")
    .fill("COCKPIT_SUBMISSION_SUMMARY_SECRET");
  await page.getByRole("button", { name: "创建正式提交" }).click();

  await page.goto(`/projects/${projectLead.projectId}`);
  await expect(page.getByTestId("project-attention")).not.toContainText(
    "Cockpit 长时间无记录活动",
  );
  await expect(page.getByTestId("recent-activity")).toContainText(
    "Cockpit 长时间无记录活动 · 提交 #1",
  );
});

test("retry supersedes current Agent failure and cockpit remains read-only/minimal", async ({
  page,
}) => {
  const projectLead = environment.researchers[0];
  const cockpit = environment.cockpit;
  if (!projectLead?.projectId || !cockpit) {
    throw new Error("Acceptance project/cockpit fixture missing");
  }

  const projectId = projectLead.projectId;
  await login(page, projectLead.email, projectLead.password);
  await page.goto(`/projects/${projectId}/agent-work`);
  await page
    .locator(`#agent-run-${environment.agentWork.failedRunId}`)
    .getByRole("button", { name: "重新运行" })
    .click();

  await page.goto(`/projects/${projectId}`);
  const attention = page.getByTestId("project-attention");
  await expect(attention).not.toContainText("最新 Agent 运行失败");

  const cockpitSections = [
    page.getByTestId("project-actions"),
    attention,
    page.getByTestId("recent-activity"),
  ];
  for (const section of cockpitSections) {
    await expect(section.getByRole("button")).toHaveCount(0);
  }

  const cockpitHtml = (await Promise.all(
    cockpitSections.map((section) => section.innerHTML()),
  )).join("\n");
  expect(cockpitHtml).not.toContain("COCKPIT_SUBMISSION_SUMMARY_SECRET");
  expect(cockpitHtml).not.toContain("Cockpit formal review submission");
  expect(cockpitHtml).not.toContain("新增结果更支持修订后的机制解释");
  expect(cockpitHtml).not.toContain(cockpit.currentParseFailureLocator);
  expect(cockpitHtml).not.toContain(cockpit.currentParseFailureAccessPolicyRef);
  expect(cockpitHtml).not.toContain(cockpit.rawEventShaSentinel);
  expect(cockpitHtml).not.toContain(cockpit.rawEventErrorSentinel);
  expect(cockpitHtml).not.toMatch(
    /progress\s*%|health score|risk score|AI priority|\bGreen\b|\bAmber\b|\bRed\b/i,
  );
});

test("projection inconsistency renders unavailable, never an empty or healthy conclusion", async ({
  page,
}) => {
  const projectLead = environment.researchers[0];
  const cockpit = environment.cockpit;
  if (!projectLead?.projectId || !cockpit) {
    throw new Error("Acceptance project/cockpit fixture missing");
  }

  await cockpit.setRawDimensionState("projection_test_unknown");
  await login(page, projectLead.email, projectLead.password);

  await page.goto("/portfolio");
  await expect(page.getByTestId("cockpit-unavailable")).toContainText(
    "科研关注投影暂时不可用",
  );
  await expect(page.getByText("当前没有明确等待你处理的事项。")).toHaveCount(0);
  await expect(page.getByText(/全部正常|没有风险|进展顺利/)).toHaveCount(0);

  await page.goto(`/projects/${projectLead.projectId}`);
  await expect(page.getByRole("heading", { name: "多维科研状态" })).toBeVisible();
  await expect(page.getByTestId("project-cockpit-unavailable")).toContainText(
    "科研关注投影暂时不可用",
  );
  await expect(page.getByText("当前没有明确等待你处理的事项。")).toHaveCount(0);
});

