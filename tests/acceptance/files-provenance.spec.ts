import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  startFileAcceptanceEnvironment,
  type FileAcceptanceEnvironment,
} from "./support/environment";

test.describe.configure({ mode: "serial" });

let environment: FileAcceptanceEnvironment;


function minimalPdfBuffer(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT
/F1 18 Tf
20 100 Td
(${escaped}) Tj
ET
`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>
stream
${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n 
`;
  }
  body += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF
`;
  return Buffer.from(body, "utf8");
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "研究组合" })).toBeVisible();
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


test("quarantines malware without exposing a formal file", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);

  const uploadPanel = page.locator('section[aria-label="上传资料"]');
  await uploadPanel.getByLabel("资料标题").fill("Malware quarantine proof");
  await uploadPanel.getByLabel("资料类型").selectOption("literature");
  await uploadPanel.getByLabel("访问级别").selectOption("project");
  await uploadPanel.getByLabel("文件").setInputFiles({
    name: "malware-marker.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("MALWARE_MARKER acceptance quarantine proof"),
  });
  await uploadPanel.getByRole("button", { name: "开始上传" }).click();

  await expect(
    page.getByText("上传完成，正在进行安全扫描与解析。", { exact: true }),
  ).toBeVisible();

  const processed = await environment.files.processLatestUpload(researcher.projectId);
  expect(processed.result).toBe("rejected_malware");
  expect(processed.fileVersionId).toBeNull();

  const facts = await environment.files.getLatestUploadFacts(researcher.projectId);
  expect(facts.state).toBe("rejected_malware");
  expect(facts.fileVersionCount).toBe(0);

  await page.reload();
  const rejected = page
    .getByTestId("file-upload-status")
    .filter({ hasText: "Malware quarantine proof" });
  await expect(rejected).toBeVisible();
  await expect(rejected).toContainText("rejected_malware");
  await expect(rejected.getByRole("link", { name: "下载原文件" })).toHaveCount(0);
});


test("uploads v2 while preserving immutable v1 download history", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);
  await page.getByRole("link", { name: "Phase 4A first file", exact: true }).click();

  const newVersionPanel = page.locator('section[aria-label="上传新版本"]');
  await newVersionPanel.getByLabel("变更摘要").fill("Second immutable revision");
  await newVersionPanel.getByLabel("文件").setInputFiles({
    name: "phase-4a-v2.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("phase-4a-v2-through-real-tusd"),
  });
  await newVersionPanel.getByRole("button", { name: "上传新版本" }).click();
  await expect(
    page.getByText("上传完成，正在进行安全扫描与解析。", { exact: true }),
  ).toBeVisible();

  const processed = await environment.files.processLatestUpload(researcher.projectId);
  expect(processed.result).toBe("ready");

  await page.reload();
  const versions = page.getByTestId("file-version");
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText("v2");
  await expect(versions.first()).toContainText("Second immutable revision");

  const v1 = versions.filter({ hasText: "v1" });
  await expect(v1).toBeVisible();
  const oldDownload = v1.getByRole("link", { name: "下载此版本" });
  await expect(oldDownload).toBeVisible();
  const oldHref = await oldDownload.getAttribute("href");
  if (!oldHref) throw new Error("Historical download link is missing href");

  const response = await page.context().request.get(
    new URL(oldHref, page.url()).toString(),
  );
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe("phase-4a-v1-through-real-tusd");
});


test("links the current file version to research provenance subjects", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);
  await page.getByRole("link", { name: "Phase 4A first file", exact: true }).click();

  const links = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "科研对象关联" }),
  });
  const form = links.locator("form").first();

  await form.getByLabel("对象类型").selectOption("research_node_revision");
  await form.getByLabel("Stable ID").fill(environment.fileLinkTargets.researchNodeRevisionId);
  await form.getByLabel("关系").selectOption("supports");
  await form.getByRole("button", { name: "创建关联" }).click();
  await expect(
    links.getByText(
      `supports · research_node_revision · ${environment.fileLinkTargets.researchNodeRevisionId}`,
      { exact: false },
    ),
  ).toBeVisible();

  await form.getByLabel("对象类型").selectOption("research_result");
  await form.getByLabel("Stable ID").fill(environment.fileLinkTargets.researchResultId);
  await form.getByLabel("关系").selectOption("source_for");
  await form.getByRole("button", { name: "创建关联" }).click();
  await expect(
    links.getByText(
      `source_for · research_result · ${environment.fileLinkTargets.researchResultId}`,
      { exact: false },
    ),
  ).toBeVisible();
});


test("registers restricted external data without tus bytes and redacts locator for ordinary members", async ({ page }) => {
  const creator = environment.researchers[0];
  const ordinaryMember = environment.researchers[1];
  if (!creator?.projectId || !ordinaryMember) throw new Error("Acceptance users missing");

  let tusCreationPosts = 0;
  await page.route(
    (url) => url.href.startsWith(environment.files.tusEndpoint),
    async (route) => {
      if (route.request().method() === "POST") tusCreationPosts += 1;
      await route.continue();
    },
  );

  await login(page, creator.email, creator.password);
  await page.goto(`/projects/${creator.projectId}/files`);

  const form = page.locator("form.panel").filter({
    has: page.getByRole("heading", { name: "登记受控外部数据" }),
  });
  await form.getByLabel("标题").fill("Restricted external acceptance");
  await form.getByLabel("资料类型").selectOption("dataset");
  await form.getByLabel("受控 locator").fill("secure-datalake://acceptance/study-42");
  await form.getByLabel("Manifest hash").fill("manifest-acceptance-42");
  await form.getByLabel("Access policy ref").fill("policy:acceptance-42");
  await form.getByLabel("License / agreement ref").fill("agreement:acceptance-42");
  await form.getByLabel("版本标签").fill("release-42");
  await form.getByRole("button", { name: "登记外部数据" }).click();

  const fileLink = page.getByRole("link", {
    name: "Restricted external acceptance",
    exact: true,
  });
  await expect(fileLink).toBeVisible();
  expect(tusCreationPosts).toBe(0);

  await fileLink.click();
  await expect(page.getByText("manifest-acceptance-42", { exact: true })).toBeVisible();
  await expect(page.getByText("release-42", { exact: true })).toBeVisible();
  await expect(
    page.getByText("secure-datalake://acceptance/study-42", { exact: true }),
  ).toBeVisible();
  const detailUrl = page.url();

  await page.context().clearCookies();
  await login(page, ordinaryMember.email, ordinaryMember.password);
  await page.goto(detailUrl);

  await expect(
    page.getByRole("heading", {
      name: "Restricted external acceptance",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await expect(page.getByText("manifest-acceptance-42", { exact: true })).toBeVisible();
  await expect(page.getByText("release-42", { exact: true })).toBeVisible();
  await expect(
    page.getByText("secure-datalake://acceptance/study-42", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("受限元数据", { exact: true })).toHaveCount(3);
});


test("renders the first PDF page from the authenticated Workbench content route", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);

  const uploadPanel = page.locator('section[aria-label="上传资料"]');
  await uploadPanel.getByLabel("资料标题").fill("PDF preview acceptance");
  await uploadPanel.getByLabel("资料类型").selectOption("literature");
  await uploadPanel.getByLabel("访问级别").selectOption("project");
  await uploadPanel.getByLabel("文件").setInputFiles({
    name: "preview-proof.pdf",
    mimeType: "application/pdf",
    buffer: minimalPdfBuffer("Phase 4A PDF"),
  });
  await uploadPanel.getByRole("button", { name: "开始上传" }).click();
  await expect(
    page.getByText("上传完成，正在进行安全扫描与解析。", { exact: true }),
  ).toBeVisible();

  const processed = await environment.files.processLatestUpload(researcher.projectId);
  expect(processed.result).toBe("ready");

  await page.reload();
  const contentResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.startsWith("/api/files/") &&
      !url.searchParams.has("download") &&
      response.request().method() === "GET"
    );
  });
  await page.getByRole("link", { name: "PDF preview acceptance", exact: true }).click();
  const contentResponse = await contentResponsePromise;
  expect([200, 206]).toContain(contentResponse.status());

  const preview = page.locator('figure[aria-label="PDF preview acceptance PDF preview"]');
  await expect(preview).toBeVisible();
  const canvas = preview.locator("canvas");
  await expect(canvas).toHaveAttribute("aria-hidden", "false", { timeout: 15_000 });
  await expect
    .poll(async () => Number(await canvas.getAttribute("width") ?? "0"))
    .toBeGreaterThan(0);
});


test("keeps a clean file downloadable when rich parsing fails", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);

  const uploadPanel = page.locator('section[aria-label="上传资料"]');
  const bytes = Buffer.from("DOCLING_FAIL acceptance fallback body");
  await uploadPanel.getByLabel("资料标题").fill("Parser fallback acceptance");
  await uploadPanel.getByLabel("资料类型").selectOption("data_documentation");
  await uploadPanel.getByLabel("访问级别").selectOption("project");
  await uploadPanel.getByLabel("文件").setInputFiles({
    name: "parser-fallback.txt",
    mimeType: "text/plain",
    buffer: bytes,
  });
  await uploadPanel.getByRole("button", { name: "开始上传" }).click();
  await expect(
    page.getByText("上传完成，正在进行安全扫描与解析。", { exact: true }),
  ).toBeVisible();

  const processed = await environment.files.processLatestUpload(researcher.projectId);
  expect(processed.result).toBe("ready_with_parse_error");
  expect(processed.fileVersionId).toBeTruthy();

  const download = await page.context().request.get(
    `/api/files/${processed.fileVersionId}/content?download=1`,
  );
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(bytes);

  await page.reload();
  const fileLink = page.getByRole("link", {
    name: "Parser fallback acceptance",
    exact: true,
  });
  await expect(fileLink).toBeVisible();
  await fileLink.click();

  await expect(page.getByText(/scan passed · parse failed/)).toBeVisible();
  await expect(
    page.getByText(/docling@unavailable · failed · RICH_PARSE_FAILED/),
  ).toBeVisible();
  await expect(page.getByText("acceptance extracted text latent trust interview evidence")).toBeVisible();
  await expect(page.getByRole("link", { name: "下载原文件" })).toBeVisible();
});


test("preserves a formal file with structured parser failure and no internal error leakage", async ({ page }) => {
  const researcher = environment.researchers[0];
  if (!researcher?.projectId) throw new Error("Acceptance project missing");

  await login(page, researcher.email, researcher.password);
  await page.goto(`/projects/${researcher.projectId}/files`);

  const uploadPanel = page.locator('section[aria-label="上传资料"]');
  await uploadPanel.getByLabel("资料标题").fill("Parser failure acceptance");
  await uploadPanel.getByLabel("资料类型").selectOption("data_documentation");
  await uploadPanel.getByLabel("访问级别").selectOption("project");
  await uploadPanel.getByLabel("文件").setInputFiles({
    name: "parser-failure.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("DOCLING_FAIL acceptance parser boundary"),
  });
  await uploadPanel.getByRole("button", { name: "开始上传" }).click();
  await expect(
    page.getByText("上传完成，正在进行安全扫描与解析。", { exact: true }),
  ).toBeVisible();

  const processed = await environment.files.processLatestUpload(researcher.projectId);
  expect(processed.result).toBe("ready_with_parse_error");
  expect(processed.fileVersionId).toBeTruthy();

  await page.reload();
  const status = page
    .getByTestId("file-upload-status")
    .filter({ hasText: "Parser failure acceptance" });
  await expect(status).toContainText("ready_with_parse_error");

  await page.getByRole("link", { name: "Parser failure acceptance", exact: true }).click();
  const currentVersion = page.getByTestId("file-version").first();
  await expect(currentVersion).toContainText("parse failed");
  await expect(currentVersion).toContainText("docling@unavailable · failed · RICH_PARSE_FAILED");
  await expect(page.getByText("ACCEPTANCE_DOCLING_FAILURE_WITH_SECRET_DETAILS")).toHaveCount(0);
});
