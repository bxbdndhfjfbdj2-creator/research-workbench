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

test("research network preserves competing and failed routes", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/network`);

  await expect(page.getByRole("heading", { name: "研究网络" })).toBeVisible();
  await expect(page.getByText("竞争机制 A", { exact: true })).toBeVisible();
  await expect(page.getByText("竞争机制 B", { exact: true })).toBeVisible();
  await expect(page.getByText("挑战", { exact: true })).toBeVisible();
  await expect(page.getByText("候选", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已否定", { exact: true })).toBeVisible();
  await expect(page.getByText("失败但保留的机制路线", { exact: true })).toBeVisible();
  await expect(page.getByText("关键测量无法支持该机制", { exact: true })).toBeVisible();
  await expect(page.getByText("已关闭", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /删除.*路线|删除分支/ })).toHaveCount(0);
});

test("evidence page keeps result provenance visible", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/evidence`);

  await expect(page.getByRole("heading", { name: "证据与结果" })).toBeVisible();
  await expect(page.getByText("data:v1", { exact: true })).toBeVisible();
  await expect(page.getByText("acceptance-run-1", { exact: true })).toBeVisible();
  await expect(page.getByText("0123456789abcdef0123456789abcdef01234567", { exact: true })).toBeVisible();
  await expect(page.getByText("支持", { exact: true })).toBeVisible();
  await expect(page.getByText("竞争机制 A", { exact: true })).toBeVisible();
});
