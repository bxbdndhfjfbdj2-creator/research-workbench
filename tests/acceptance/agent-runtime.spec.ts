import { expect, test } from "@playwright/test";
import {
  startAcceptanceEnvironment,
  type AcceptanceEnvironment,
} from "./support/environment";

test.describe.configure({ mode: "serial" });

let environment: AcceptanceEnvironment;

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/portfolio");
}

test.beforeAll(async () => {
  environment = await startAcceptanceEnvironment();
});

test.afterAll(async () => {
  await environment?.stop();
});

test("project intelligent work shows tasks, attempts, frozen context and durable waiting state", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");
  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/agent-work`);

  await expect(page.getByRole("heading", { name: "智能工作" })).toBeVisible();
  await expect(page.getByText("失败后重试的智能诊断", { exact: true })).toBeVisible();
  await expect(page.getByText("等待研究者判断的智能诊断", { exact: true })).toBeVisible();
  await expect(page.getByText("已完成的智能诊断", { exact: true })).toBeVisible();

  await expect(page.getByText("等待人工输入", { exact: true })).toBeVisible();
  await expect(page.getByText("是否继续检验样本构成变化？", { exact: true })).toBeVisible();
  await expect(page.getByText("session-acceptance-waiting", { exact: true })).toBeVisible();
  await expect(page.getByText("artifact:agent-summary", { exact: true })).toBeVisible();
  await expect(page.getByText("样本构成变化解释了主要差异。", { exact: true })).toBeVisible();
  await expect(page.getByText("4878cdabd87d4041bdaff61d04c966883b9fd07a", { exact: true })).toBeVisible();
});

test("retry preserves failed attempt one and creates attempt two", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");
  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/agent-work`);

  const task = page.getByTestId("agent-task").filter({ hasText: "失败后重试的智能诊断" });
  await expect(task.getByText("尝试 1", { exact: true })).toBeVisible();
  await expect(task.getByText("失败", { exact: true })).toBeVisible();
  await task.getByRole("button", { name: "重新运行" }).click();

  await expect(task.getByText("尝试 1", { exact: true })).toBeVisible();
  await expect(task.getByText("尝试 2", { exact: true })).toBeVisible();
  await expect(task.getByText("已提议", { exact: true })).toBeVisible();
});

test("researcher can create a new AgentTask from a research task without choosing a model", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");
  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/agent-work`);

  await page.getByLabel("科研事项").selectOption(environment.agentWork.researchTaskId);
  await page.getByLabel("智能工作目标").fill("新建的只读智能诊断");
  await page.getByLabel("期望输出").fill("诊断摘要");
  await expect(page.getByLabel("模型")).toHaveCount(0);
  await page.getByRole("button", { name: "创建智能工作" }).click();

  const task = page.getByTestId("agent-task").filter({ hasText: "新建的只读智能诊断" });
  await expect(task).toBeVisible();
  await expect(task.getByText("尝试 1", { exact: true })).toBeVisible();
  await expect(task.getByText("已提议", { exact: true })).toBeVisible();
});

test("team intelligent work page exposes the same controlled run facts", async ({ page }) => {
  await login(page, environment.lead.email, environment.lead.password);
  await page.goto("/agent-work");

  await expect(page.getByRole("heading", { name: "智能工作中心" })).toBeVisible();
  await expect(page.getByText("研究项目1", { exact: true })).toBeVisible();
  await expect(page.getByText("等待人工输入", { exact: true })).toBeVisible();
  await expect(page.getByText("失败", { exact: true })).toBeVisible();
});
