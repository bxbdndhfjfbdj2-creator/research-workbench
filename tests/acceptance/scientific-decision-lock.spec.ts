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

test("major AI proposal changes official theory only after two human approvals", async ({ page }) => {
  const projectLead = environment.researchers[0];
  if (!projectLead?.projectId) throw new Error("Acceptance project missing");

  await login(page, projectLead.email, projectLead.password);
  await page.goto(`/projects/${projectLead.projectId}/decisions`);

  await expect(page.getByRole("heading", { name: "科学决策" })).toBeVisible();
  await expect(page.getByText("变更正式理论", { exact: true })).toBeVisible();
  await expect(page.getByText("AI 提议", { exact: true })).toBeVisible();
  await expect(page.getByText("待项目主理人审批", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("official-revisions").getByText("旧版正式理论", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("scientific-decision")
      .filter({ hasText: "变更正式理论" })
      .getByText("新版候选理论", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "主理人批准" }).click();
  await expect(page.getByText("等待总负责人批准", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("official-revisions").getByText("旧版正式理论", { exact: true }),
  ).toBeVisible();

  await page.context().clearCookies();
  await login(page, environment.lead.email, environment.lead.password);
  await page.goto("/decisions");

  await expect(page.getByRole("heading", { name: "科学决策中心" })).toBeVisible();
  await expect(page.getByText("变更正式理论", { exact: true })).toBeVisible();
  await expect(page.getByText("等待总负责人批准", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "总负责人批准" }).click();
  await expect(
    page.getByTestId("scientific-decision")
      .filter({ hasText: "变更正式理论" })
      .getByText("已批准", { exact: true }),
  ).toBeVisible();

  await page.goto(`/projects/${projectLead.projectId}/decisions`);
  await expect(
    page.getByTestId("official-revisions").getByText("新版候选理论", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("official-history").getByText("旧版正式理论", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("历史正式版本", { exact: true })).toBeVisible();
});

test("non-authorized reviewer is not offered an approval action", async ({ page }) => {
  const uninvolved = environment.researchers[1];
  if (!uninvolved) throw new Error("Acceptance researcher missing");

  await login(page, uninvolved.email, uninvolved.password);
  await page.goto("/decisions");

  await expect(page.getByRole("heading", { name: "科学决策中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: /批准/ })).toHaveCount(0);
});
