import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  startFileAcceptanceEnvironment,
  type FileAcceptanceEnvironment,
} from "./support/environment";

test.describe.configure({ mode: "serial" });

let environment: FileAcceptanceEnvironment;

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/portfolio");
}

test.beforeAll(async () => {
  environment = await startFileAcceptanceEnvironment();
});

test.afterAll(async () => {
  await environment?.stop();
});

test("uploads v1 through tusd and shows immutable provenance", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);
  await expect(page.getByRole("heading", { name: "文件与资料", exact: true })).toBeVisible();

  const bytes = Buffer.from("phase-4a-v1-through-real-tusd");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const uploadPanel = page.locator('section[aria-label="上传资料"]');
  await uploadPanel.getByLabel("资料标题").fill("Phase 4A first file");
  await uploadPanel.getByLabel("资料类型").selectOption("literature");
  await uploadPanel.getByLabel("访问级别").selectOption("project");
  await uploadPanel.getByLabel("文件").setInputFiles({
    name: "phase-4a-first.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await uploadPanel.getByRole("button", { name: "开始上传" }).click();
  await expect(
    page.getByText("上传完成，正在进行安全扫描与解析。", { exact: true }),
  ).toBeVisible();

  await environment.files.processLatestUpload(researcher.projectId);
  await page.reload();

  await page.getByRole("link", { name: "Phase 4A first file", exact: true }).click();
  await expect(page.getByText("v1", { exact: true })).toBeVisible();
  await expect(page.getByText("phase-4a-first.pdf", { exact: false })).toBeVisible();
  await expect(page.getByText("application/pdf", { exact: false })).toBeVisible();
  await expect(page.getByText(sha256, { exact: true })).toBeVisible();
  await expect(page.getByText(researcher.id, { exact: true })).toBeVisible();
  await expect(page.getByText(/tika@1\.0\.0/)).toBeVisible();
  await expect(page.getByText(/docling@1\.0\.0/)).toBeVisible();
});


test("resumes one tus upload after a chunk connection reset", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  let creationPosts = 0;
  let patchCount = 0;
  let abortedSecondPatch = false;
  const patchUrls = new Set<string>();
  const tusMatcher = (url: URL) => url.href.startsWith(environment.files.tusEndpoint);

  await page.route(tusMatcher, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      creationPosts += 1;
    }
    if (request.method() === "PATCH") {
      patchCount += 1;
      patchUrls.add(request.url());
      if (patchCount === 2 && !abortedSecondPatch) {
        abortedSecondPatch = true;
        await route.abort("connectionreset");
        return;
      }
    }
    await route.continue();
  });

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);

  const uploadPanel = page.locator('section[aria-label="上传资料"]');
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 512 * 1024, "R");
  await uploadPanel.getByLabel("资料标题").fill("Resumable upload proof");
  await uploadPanel.getByLabel("资料类型").selectOption("data_documentation");
  await uploadPanel.getByLabel("访问级别").selectOption("project");
  await uploadPanel.getByLabel("文件").setInputFiles({
    name: "resumable-proof.txt",
    mimeType: "text/plain",
    buffer: bytes,
  });
  await uploadPanel.getByRole("button", { name: "开始上传" }).click();

  await expect(
    page.getByText("上传完成，正在进行安全扫描与解析。", { exact: true }),
  ).toBeVisible();

  const uploaded = await environment.files.getLatestUploadFacts(researcher.projectId);
  expect(abortedSecondPatch).toBe(true);
  expect(creationPosts).toBe(1);
  expect(patchCount).toBeGreaterThanOrEqual(3);
  expect(patchUrls.size).toBe(1);
  expect(uploaded.tusUploadId).toBeTruthy();
  expect(uploaded.inboxCount).toBe(1);
  expect(uploaded.completedOutboxCount).toBe(1);
  expect(uploaded.fileVersionCount).toBe(0);

  const processed = await environment.files.processLatestUpload(researcher.projectId);
  expect(processed.result).toBe("ready");

  const ready = await environment.files.getLatestUploadFacts(researcher.projectId);
  expect(ready.tusUploadId).toBe(uploaded.tusUploadId);
  expect(ready.fileVersionCount).toBe(1);
});
