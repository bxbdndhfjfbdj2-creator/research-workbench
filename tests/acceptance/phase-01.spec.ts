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

test("team lead sees all five research projects", async ({ page }) => {
  await login(page, environment.lead.email, environment.lead.password);

  await expect(page.getByRole("heading", { name: "研究组合" })).toBeVisible();
  await expect(page.getByTestId("project-card")).toHaveCount(5);
  for (let index = 1; index <= 5; index += 1) {
    await expect(page.getByText(`研究项目${index}`, { exact: true })).toBeVisible();
  }
});

test("researcher sees only projects they participate in", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher) throw new Error("Acceptance researcher missing");

  await login(page, researcher.email, researcher.password);

  await expect(page.getByTestId("project-card")).toHaveCount(1);
  await expect(page.getByText("研究项目1", { exact: true })).toBeVisible();
  await expect(page.getByText("研究项目2", { exact: true })).not.toBeVisible();
});

test("project page shows independent multidimensional research states", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page
    .getByTestId("project-card")
    .getByRole("link", { name: "研究项目1", exact: true })
    .click();
  await page.waitForURL(`**/projects/${researcher.projectId}`);

  await expect(page.getByRole("heading", { name: "研究项目1" })).toBeVisible();
  await expect(page.getByTestId("dimension-state")).toContainText([
    "理论探索中",
    "数据冻结",
    "主分析验证中",
  ]);
});
