import { expect, test } from "@playwright/test";
import {
  startAcceptanceEnvironment,
  type AcceptanceEnvironment,
} from "./support/environment";

test.describe.configure({ mode: "serial" });

let environment: AcceptanceEnvironment;

async function loginAs(
  page: import("@playwright/test").Page,
  user: { email: string; password: string },
): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "研究组合" })).toBeVisible();
}

async function createStartedTask(
  page: import("@playwright/test").Page,
  projectId: string,
  title: string,
  reviewPolicy: "none" | "required",
  executionMode: "human" | "agent" | "hybrid" = "human",
): Promise<string> {
  await page.goto(`/projects/${projectId}/work`);
  await expect(page.getByRole("heading", { name: "研究工作", exact: true })).toBeVisible();

  const createPanel = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "创建科研事项" }),
  });
  await createPanel.getByLabel("标题").fill(title);
  await createPanel.getByLabel("执行方式").selectOption(executionMode);
  await createPanel.getByLabel("审核策略").selectOption(reviewPolicy);
  await createPanel.getByRole("button", { name: "创建科研事项" }).click();

  const taskLink = page.getByRole("link", { name: title, exact: true });
  await expect(taskLink).toBeVisible();
  await taskLink.click();
  await expect(
    page.getByRole("heading", { name: title, exact: true, level: 2 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "开始任务" }).click();
  await expect(page.getByRole("heading", { name: "正式提交" })).toBeVisible();
  return page.url();
}

async function submitTask(
  page: import("@playwright/test").Page,
  summary: string,
  submissionNumber: number,
  reviewerMemberId?: string,
): Promise<void> {
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "创建正式提交" }),
  });
  await form.getByLabel("提交说明").fill(summary);
  if (reviewerMemberId) {
    await form.getByLabel("指定审核人").selectOption(reviewerMemberId);
  }
  await form.getByRole("button", { name: "创建正式提交" }).click();
  await expect(
    page
      .getByTestId("task-submission")
      .filter({ hasText: `Submission #${submissionNumber}` }),
  ).toBeVisible();
}

function taskStatus(page: import("@playwright/test").Page) {
  return page
    .locator(".research-task-detail > section.panel")
    .first()
    .locator(".status-label");
}

test.beforeAll(async () => {
  environment = await startAcceptanceEnvironment();
});

test.afterAll(async () => {
  await environment?.stop();
});

test("pure-text submission completes only after explicit human acceptance", async ({ page }) => {
  const owner = environment.researchers[0];
  if (!owner?.projectId) throw new Error("Acceptance owner/project missing");

  await loginAs(page, owner);
  await createStartedTask(
    page,
    owner.projectId,
    "Phase 4B pure-text acceptance",
    "none",
  );
  await submitTask(page, "Pure text formal delivery", 1);

  await expect(taskStatus(page)).toHaveText("in_progress");
  const submission = page
    .getByTestId("task-submission")
    .filter({ hasText: "Submission #1" });
  await expect(submission).toContainText("Pure text formal delivery");

  await page.getByRole("button", { name: "完成任务" }).click();
  await expect(taskStatus(page)).toHaveText("completed");
  await expect(page.getByRole("button", { name: "重新打开任务" })).toBeVisible();
  await expect(submission).toContainText("Pure text formal delivery");
});

test("required review enters awaiting_review and owner cannot bypass approval", async ({ page }) => {
  const owner = environment.researchers[0];
  const reviewer = environment.researchers[1];
  if (!owner?.projectId || !reviewer) throw new Error("Acceptance users missing");

  await loginAs(page, owner);
  await createStartedTask(
    page,
    owner.projectId,
    "Phase 4B awaiting_review acceptance",
    "required",
  );
  await submitTask(page, "Requires ordinary review", 1, reviewer.id);

  await expect(taskStatus(page)).toHaveText("awaiting_review");
  await expect(page.getByRole("button", { name: "完成任务" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批准提交" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "当前普通审核" })).toBeVisible();
});

test("assigned reviewer approves the immutable submission and completes the task", async ({ page }) => {
  const owner = environment.researchers[0];
  const reviewer = environment.researchers[1];
  if (!owner?.projectId || !reviewer) throw new Error("Acceptance users missing");

  await loginAs(page, owner);
  const taskUrl = await createStartedTask(
    page,
    owner.projectId,
    "Phase 4B reviewer approves acceptance",
    "required",
  );
  await submitTask(page, "Approval-ready submission", 1, reviewer.id);

  await loginAs(page, reviewer);
  await page.goto(taskUrl);
  await expect(page.getByRole("button", { name: "批准提交" })).toBeVisible();
  await page.getByRole("button", { name: "批准提交" }).click();

  await expect(taskStatus(page)).toHaveText("completed");
  const submission = page
    .getByTestId("task-submission")
    .filter({ hasText: "Submission #1" });
  await expect(submission.locator(".status-label")).toHaveText("approved");
});

test("request_changes preserves the first cycle and a second submission can be approved", async ({ page }) => {
  const owner = environment.researchers[0];
  const reviewer = environment.researchers[1];
  if (!owner?.projectId || !reviewer) throw new Error("Acceptance users missing");

  await loginAs(page, owner);
  const taskUrl = await createStartedTask(
    page,
    owner.projectId,
    "Phase 4B request_changes acceptance",
    "required",
  );
  await submitTask(page, "First review cycle", 1, reviewer.id);

  await loginAs(page, reviewer);
  await page.goto(taskUrl);
  await page.getByLabel("修改要求").fill("Please add the robustness note.");
  await page.getByRole("button", { name: "要求修改" }).click();
  await expect(taskStatus(page)).toHaveText("in_progress");
  const first = page
    .getByTestId("task-submission")
    .filter({ hasText: "Submission #1" });
  await expect(first.locator(".status-label")).toHaveText("changes_requested");

  await loginAs(page, owner);
  await page.goto(taskUrl);
  await submitTask(page, "Second review cycle", 2, reviewer.id);

  await loginAs(page, reviewer);
  await page.goto(taskUrl);
  await page.getByRole("button", { name: "批准提交" }).click();

  await expect(taskStatus(page)).toHaveText("completed");
  await expect(page.getByTestId("task-submission")).toHaveCount(2);
  await expect(
    page.getByTestId("task-submission").filter({ hasText: "Submission #1" }).locator(".status-label"),
  ).toHaveText("changes_requested");
  await expect(
    page.getByTestId("task-submission").filter({ hasText: "Submission #2" }).locator(".status-label"),
  ).toHaveText("approved");
});

test("contributor cannot self-review while the explicitly assigned reviewer can", async ({ page }) => {
  const owner = environment.researchers[0];
  const reviewer = environment.researchers[1];
  if (!owner?.projectId || !reviewer) throw new Error("Acceptance users missing");

  await loginAs(page, owner);
  const taskUrl = await createStartedTask(
    page,
    owner.projectId,
    "Phase 4B contributor self-review guard",
    "required",
  );
  await submitTask(page, "Contributor-owned submission", 1, reviewer.id);

  await expect(page.getByRole("button", { name: "批准提交" })).toHaveCount(0);
  const reassignForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "重新指派审核" }),
  });
  await expect(reassignForm.locator(`option[value="${owner.id}"]`)).toHaveCount(0);

  await loginAs(page, reviewer);
  await page.goto(taskUrl);
  await expect(page.getByRole("button", { name: "批准提交" })).toBeVisible();
  await page.getByRole("button", { name: "批准提交" }).click();
  await expect(taskStatus(page)).toHaveText("completed");
});
