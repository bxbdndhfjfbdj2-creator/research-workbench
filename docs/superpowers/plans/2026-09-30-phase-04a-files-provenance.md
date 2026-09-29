# Phase 4A Files & Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不依赖真实 Agent Provider/API 的前提下，为 Research Workbench 增加可恢复上传、不可变文件版本、受限外部数据登记、安全扫描、文档解析、科研对象关联、基础全文检索与安全预览，并让所有人工操作从第一天形成 stable ID、versioned、auditable、provenance-first 的科研事实。

**Architecture:** 延续现有“模块化单体 Web + 独立 Worker + PostgreSQL + Outbox/Inbox”边界。浏览器使用 Uppy + tus，tusd 只负责可恢复上传并把 pre-create/post-finish hook 交回 Workbench；S3-compatible ObjectStoragePort、ClamAV、Tika、Docling、PDF.js 都通过 adapter 隔离。正式科研事实只落 Workbench PostgreSQL；上传、扫描、解析的瞬时状态先落 operational ingest records，达到终态后才一次性生成 immutable FileVersion 和 FileProcessingRecord。

**Tech Stack:** TypeScript；Node.js >= 22.19；pnpm 11.7；Next.js 15 + React 19；PostgreSQL 16；Drizzle schema + explicit SQL migrations；pg-boss/Outbox；Vitest；Playwright；Uppy Core 5.2.0；@uppy/tus 5.1.1；tusd 2.9.2；AWS SDK S3 client 3.1141.0；SeaweedFS 4.47；ClamAV 1.5.4；Apache Tika 4.0.0；Docling Serve 1.35.0；PDF.js/pdfjs-dist 6.3.289。

**Spec:** docs/superpowers/specs/2026-09-30-phase-04a-files-provenance-design.md

## Global Constraints

- 基线保持 phase/03-agent-runtime @ 1a95b548f4a87eaf908df9ce46db1dd7de02e8d3；实现分支继续使用 phase/04-research-operations。
- AI-native 主线不变，但 Phase 4A 不以真实 DeepSeek/Codex/Claude Provider/API 为运行前置条件。
- 固定 6 人、单团队、私有部署；不得引入多租户、公共分享链接或公开对象存储 URL。
- Research Workbench 是科研事实源；GitHub 是工程事实源；DeepSeek Harness 是 AI 执行事实源。
- AI 不得直接改变正式科学状态；文件解析输出只能成为 source/observation material，不得自动生成正式 Claim、ResearchResult 或 ScientificDecision。
- ResearchFile、FileVersion、FileProcessingRecord、FileLink 使用 stable ID；失败分支、历史版本、拒绝结果和审计事实不得静默删除。
- FileVersion 数据库级禁止 UPDATE / DELETE；同一 ResearchFile 的 versionNumber 唯一；currentVersionId 必须指向同一 ResearchFile。
- FileVersion 的 blobId / externalReferenceId 必须二选一；普通上传版必须有 SHA-256 和 clean scan；external reference 例外。
- 受限原始社会科学数据默认不复制进普通对象存储；只登记 locator/manifest/access policy/license/version，且不得保存凭据。
- quarantine 与 ready 存储命名空间分离；未通过扫描的 bytes 不得进入普通下载/预览路径。
- 文件类型以内容检测为准，不信任扩展名；parser/scanner 运行在资源受限、私网隔离边界。
- Event/Outbox/日志只存 ID、状态、hash、processor identity 等审计事实，不存文件原文、presigned URL、上传 token、对象存储密钥或受限 locator 凭据。
- 成熟基础设施优先适配，不自研 tus、对象存储、恶意扫描、通用文档解析、PDF renderer、RDF/OWL/SPARQL/SHACL 引擎。
- 真实外部 binary/service smoke 无环境时必须明确 SKIP；fake/contract 测试始终执行，不得把 SKIP 伪装成 PASS。
- 所有实现任务遵循 TDD：先 RED，再 GREEN；每个任务完成一个可独立审查的 deliverable 后做有意义 commit。
- 阶段完成前必须 fresh full CI + 全量 Playwright + 独立不变量审查 + verification record；不自动合并任何 Draft PR。

## Plan-time Architecture Reconciliation

批准规格同时要求“FileVersion 不可 UPDATE/DELETE”和“FileVersion 含 scanStatus/parseStatus”，而扫描/解析本身是异步状态机。为同时满足两条强不变量，本计划固定以下实现：

1. ResearchFile 可以先以 draft 存在；FileUploadIntent 与 FileIngestProcessorAttempt 承载 initiated -> uploading -> uploaded_quarantine -> scanning -> metadata_processing -> parsing 等瞬时状态。
2. 普通上传只有在 ClamAV clean 且 Tika 内容检测完成、rich parse 达到成功或可接受失败终态后，才在一个事务中创建 FileVersion。此时 scanStatus/parseStatus 已是终态快照，因此 FileVersion 永远不需要 UPDATE。
3. parser 失败允许终态 ready_with_parse_error；FileVersion.parseStatus = failed，原始文件仍可安全下载；失败的 parser facts 被复制成 immutable FileProcessingRecord。
4. malware rejection 不创建正式 FileVersion；ResearchFile draft、quarantine FileBlob、FileUploadIntent、FILE_SCAN_REJECTED ResearchEvent 保留完整审计，恶意 bytes 不自动物理删除。
5. external reference 不经过 bytes pipeline；ExternalDataReference + FileVersion 在同一事务创建，scanStatus/parseStatus 均为 not_applicable。
6. FileLink 本体 append-only；取消关联通过独立 immutable FileLinkRetirement 记录表达，不 UPDATE/DELETE 原 link。
7. 现有 authorizeProjectAccess(..., "write") 的正式科研状态权限不放宽；新增 file_write action，仅 team lead、project lead、collaborator 可上传/建新版本，避免把 collaborator 意外授权给 ScientificDecision 等正式状态写操作。

## Pinned Open-source Dependency Governance

| Component | Pin | License | Untrusted input / network posture | Workbench replacement boundary |
|---|---:|---|---|---|
| Uppy Core | 5.2.0 | MIT | Browser processes user-selected files; no data leaves deployment except configured tus endpoint | FileUploadClient UI wrapper |
| @uppy/tus | 5.1.1 | MIT | Browser sends resumable chunks only to private tusd endpoint | FileUploadClient UI wrapper |
| tusd | 2.9.2 | MIT | Accepts untrusted uploads; HTTP hooks only to private Workbench endpoint | tus protocol boundary |
| @aws-sdk/client-s3 | 3.1141.0 | Apache-2.0 | Network only to configured S3-compatible private endpoint | ObjectStoragePort |
| SeaweedFS | 4.47 | Apache-2.0 | Stores quarantine/ready objects in private deployment | S3-compatible ObjectStoragePort |
| ClamAV | 1.5.4 | GPL-2.0 | Scans untrusted bytes; clamd socket/private network only; signature updates may use controlled egress | MalwareScannerPort |
| Apache Tika | 4.0.0 | Apache-2.0 | Parses untrusted documents in isolated service; no remote VLM credentials; private endpoint only | MetadataExtractorPort |
| Docling Serve | 1.35.0 | MIT | Parses untrusted rich documents in isolated service; model cache prefetched and runtime document traffic stays private | RichDocumentParserPort |
| pdfjs-dist | 6.3.289 | Apache-2.0 | Browser renders authenticated PDF stream from Workbench | PdfPreview component |

Upstream references to record in infra/files/README.md:
- https://github.com/transloadit/uppy
- https://github.com/tus/tusd
- https://github.com/seaweedfs/seaweedfs
- https://github.com/Cisco-Talos/clamav
- https://tika.apache.org/
- https://github.com/docling-project/docling-serve
- https://github.com/mozilla/pdf.js
- https://github.com/aws/aws-sdk-js-v3

No Phase 4A plan task adds GROBID, pgvector, Jena/Fuseki or Oxigraph as runtime dependencies; their adapter-compatible extension points remain future work.

## Review Focus

1. **Duplicate/out-of-order tus hooks:** repeated pre-create/post-finish or post-finish arriving after a process restart must create one inbox fact, one processing workflow and at most one FileVersion; Task 5 and Task 7 pin this.
2. **Concurrent new-version finalization:** two accepted uploads for the same ResearchFile must allocate distinct monotonic version numbers and currentVersionId must point to the highest committed version; Task 1 and Task 7 pin this.
3. **Forged callback/storage locator:** a caller must not smuggle an arbitrary bucket/key, oversized object or stale upload token into processing; Task 5 validates signed intent, expected byte size, quarantine bucket and prefix.
4. **Scanner/parser failure:** scanner unavailable or malware must never expose ready bytes; Docling/Tika parse failure must preserve the accepted file and produce explicit retry/ready_with_parse_error semantics; Task 6 and Task 7 pin this.
5. **Sensitive-data leakage / governance escalation:** restricted locator credentials, upload tokens, raw text and presigned secrets must not reach ResearchEvent/Outbox/logs, and parser output must not create ResearchResult/ScientificDecision; Task 2, Task 5, Task 7 and Task 9 pin this.

---

## File Structure

### Domain and database

- Create packages/domain/src/research-file.ts — file kinds, access classes, terminal version facts, link subject/relation types, locator validation.
- Create packages/domain/src/research-file.test.ts — pure validation tests.
- Create packages/db/migrations/0001_files_provenance.sql — Phase 4A tables, constraints, triggers and FTS projection.
- Create packages/db/src/schema/research-file.ts — Drizzle declarations for formal file facts.
- Create packages/db/src/schema/file-ingest.ts — Drizzle declarations for operational upload/processing state.
- Modify packages/db/src/schema/index.ts — export new schema modules.
- Modify packages/db/src/client.ts — apply all numbered migrations in lexical order while preserving initializeFoundationDatabase compatibility.

### Application

- Create packages/application/src/files/file-service.ts — ResearchFile creation, external reference registration, version allocation/finalization helpers.
- Create packages/application/src/files/file-links.ts — append-only FileLink creation/retirement and subject project resolution.
- Create packages/application/src/files/upload-intent.ts — signed intent creation/validation and lifecycle rules.
- Create packages/application/src/files/tusd-hook.ts — normalized pre-create/post-finish ingestion, inbox + outbox transaction.
- Create packages/application/src/files/process-upload.ts — hash/scan/parse/finalize orchestration.
- Create packages/application/src/files/search-projection.ts — bounded PostgreSQL FTS projection writer.
- Create packages/application/src/files/content-access.ts — authorized blob descriptor for download/preview.
- Modify packages/application/src/auth/authorize.ts — add file_write without widening existing formal write authority.

### Storage adapter

- Create packages/storage/package.json.
- Create packages/storage/src/types.ts — ObjectStoragePort and storage reference types.
- Create packages/storage/src/fake.ts — deterministic fake used by tests.
- Create packages/storage/src/s3.ts — AWS SDK implementation for S3-compatible endpoints.
- Create packages/storage/src/contract.test.ts — adapter contract.
- Create tests/integration/storage-seaweedfs-smoke.test.ts — real S3-compatible smoke.

### File-processing adapters

- Create packages/file-processing/package.json.
- Create packages/file-processing/src/types.ts — MalwareScannerPort, MetadataExtractorPort, RichDocumentParserPort.
- Create packages/file-processing/src/fakes.ts — deterministic test adapters.
- Create packages/file-processing/src/clamav.ts — clamd INSTREAM adapter.
- Create packages/file-processing/src/tika.ts — Tika 4 /detect + /rmeta/text adapter.
- Create packages/file-processing/src/docling.ts — Docling Serve /v1/convert/file adapter.
- Create packages/file-processing/src/contract.test.ts.
- Create tests/integration/clamav-smoke.test.ts.
- Create tests/integration/tika-smoke.test.ts.
- Create tests/integration/docling-smoke.test.ts.

### Worker and configuration

- Create apps/worker/src/file-worker.ts — file outbox handler.
- Create apps/worker/src/file-runtime.ts — production file adapter composition.
- Create apps/worker/src/file-runtime.test.ts.
- Modify apps/worker/src/main.ts — compose boolean outbox handlers without changing existing agent semantics.
- Modify packages/config/src/env.ts and env.test.ts — file service URLs, limits and secret references.
- Create infra/files/version.env — pinned external component versions, no secrets.
- Create infra/files/README.md — licenses, runtime isolation, network posture, local smoke instructions and replacement ports.

### Web

- Create apps/web/app/api/internal/file-upload-hook/route.ts — private tusd HTTP hook endpoint.
- Create apps/web/app/api/files/[fileVersionId]/content/route.ts — authenticated range-capable content stream/download.
- Create apps/web/app/(app)/projects/[projectId]/files/page.tsx.
- Create apps/web/app/(app)/projects/[projectId]/files/[researchFileId]/page.tsx.
- Create apps/web/src/server/file-actions.ts.
- Create apps/web/src/components/files/file-upload-form.tsx.
- Create apps/web/src/components/files/external-reference-form.tsx.
- Create apps/web/src/components/files/file-list.tsx.
- Create apps/web/src/components/files/file-detail.tsx.
- Create apps/web/src/components/files/file-link-form.tsx.
- Create apps/web/src/components/files/pdf-preview.tsx.
- Modify apps/web/src/server/queries.ts — file list/detail/linkable-subject/search projections.
- Modify apps/web/src/components/project-navigation.tsx — enable “文件与资料”.
- Modify apps/web/package.json and pnpm-lock.yaml — exact Uppy/PDF.js pins.

### Acceptance and verification

- Create tests/acceptance/files-provenance.spec.ts.
- Create tests/acceptance/support/file-services.ts — pinned SeaweedFS + tusd Testcontainers and fake scanner/parser worker composition.
- Modify tests/acceptance/support/environment.ts — seed/file runtime lifecycle.
- Modify package.json acceptance script.
- Modify .github/workflows/ci.yml only as needed to include the new acceptance/spec checks.
- Create docs/superpowers/reviews/2026-09-30-phase-04a-verification.md at phase completion.

---

### Task 1: Lock File Facts, Operational Ingest State, and Database Invariants

**Files:**
- Create: packages/domain/src/research-file.ts
- Create: packages/domain/src/research-file.test.ts
- Create: packages/db/migrations/0001_files_provenance.sql
- Create: packages/db/src/schema/research-file.ts
- Create: packages/db/src/schema/file-ingest.ts
- Modify: packages/db/src/schema/index.ts
- Modify: packages/db/src/client.ts
- Test: tests/integration/files-provenance-model.test.ts

**Interfaces:**
- Produces: FILE_KINDS; FileAccessClass = "project" | "restricted"; FileSourceKind = "upload" | "external_reference"; FileScanStatus = "passed" | "not_applicable"; FileParseStatus = "parsed" | "failed" | "not_applicable".
- Produces: ResearchFile, FileVersion, FileBlob, ExternalDataReference, FileLink, FileProcessingRecord domain types.
- Produces: FileUploadIntentState matching the approved state machine plus ready_with_parse_error.
- Produces: initializeFoundationDatabase(sql) still exists, but now executes 0000_foundation.sql then every later numbered migration in lexical order.

- [ ] **Step 1: Write RED domain tests for enumerations and locator safety**

In packages/domain/src/research-file.test.ts, assert:
- all 12 approved fileKind values are accepted and an unknown value is rejected;
- accessClass accepts only project/restricted;
- external locators with URL userinfo or query keys matching token, secret, password, credential, signature, api_key are rejected;
- normal https, s3-style, secure-datalake and catalog locators without embedded credentials are accepted.

Run: pnpm exec vitest run packages/domain/src/research-file.test.ts  
Expected: FAIL because the module/constants/validators do not exist.

- [ ] **Step 2: Add the pure domain types and validators**

Implement in packages/domain/src/research-file.ts:
~~~ts
export const FILE_KINDS = [
  "literature",
  "data_documentation",
  "dataset",
  "analysis_output",
  "code_archive",
  "research_design",
  "manuscript",
  "review_material",
  "meeting_note",
  "ethics_or_license",
  "presentation",
  "general_attachment",
] as const;

export function assertFileKind(value: string): asserts value is FileKind;
export function assertFileAccessClass(value: string): asserts value is FileAccessClass;
export function assertSafeExternalLocator(value: string): void;
~~~

Run the domain test again.  
Expected: PASS.

- [ ] **Step 3: Write RED PostgreSQL tests for the approved invariants**

Create tests/integration/files-provenance-model.test.ts covering:
- migration 0001 is applied by initializeFoundationDatabase;
- file_versions rejects UPDATE and DELETE;
- research_file_id + version_number is unique;
- exactly one of blob_id/external_reference_id is present;
- blob-backed version requires sha256/byte_size/media_type and scan_status = passed;
- external-backed version permits byte_size/media_type/sha256 null and requires scan_status/parse_status = not_applicable;
- research_files.current_version_id must belong to the same research_file;
- processor success requires at least one output ref;
- file_links and file_link_retirements are append-only;
- external_data_references are immutable;
- two transactions attempting the same explicit version number cannot both commit.

Run: pnpm exec vitest run tests/integration/files-provenance-model.test.ts  
Expected: FAIL because 0001/tables/triggers do not exist.

- [ ] **Step 4: Add 0001 schema plus ordered migration loading**

0001_files_provenance.sql must create:
- research_files
- file_blobs
- external_data_references
- file_versions
- file_links
- file_link_retirements
- file_processing_records
- file_upload_intents
- file_ingest_processor_attempts
- file_search_documents with a tsvector column and GIN index

Use DB checks/triggers for the invariant set above. Operational ingest tables may UPDATE state; formal version/link/processing/reference facts may not.

Modify initializeFoundationDatabase to read packages/db/migrations, sort matching NNNN_*.sql lexically, and execute each statement-breakpoint section. Keep the function name so all existing tests/callers remain valid.

Run:
- pnpm exec vitest run tests/integration/files-provenance-model.test.ts
- pnpm exec vitest run tests/integration/db-foundation.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/domain/src/research-file.ts packages/domain/src/research-file.test.ts packages/db/migrations/0001_files_provenance.sql packages/db/src/schema/research-file.ts packages/db/src/schema/file-ingest.ts packages/db/src/schema/index.ts packages/db/src/client.ts tests/integration/files-provenance-model.test.ts
git commit -m "feat: add file provenance data model"
~~~

---

### Task 2: Add File-specific Authorization and External-data Registration

**Files:**
- Modify: packages/application/src/auth/authorize.ts
- Modify: packages/application/src/auth/authorize.test.ts
- Create: packages/application/src/files/file-service.ts
- Test: packages/application/src/files/file-service.test.ts

**Interfaces:**
- Consumes: ResearchFile/FileVersion/ExternalDataReference types from Task 1.
- Produces: authorizeProjectAccess(..., action: "read" | "write" | "file_write").
- Produces:
~~~ts
export async function createResearchFile(
  sql: DatabaseSql,
  projectId: string,
  input: { title: string; fileKind: FileKind; description?: string | null; accessClass: FileAccessClass },
  actor: ActorRef,
): Promise<ResearchFile>;

export async function registerExternalDataVersion(
  sql: DatabaseSql,
  projectId: string,
  input: {
    researchFileId?: string;
    title?: string;
    fileKind: FileKind;
    accessClass: FileAccessClass;
    uriOrLocator: string;
    manifestHash: string;
    accessPolicyRef: string;
    licenseOrAgreementRef?: string | null;
    versionLabel: string;
    changeSummary?: string | null;
  },
  actor: ActorRef,
): Promise<{ researchFile: ResearchFile; externalReference: ExternalDataReference; fileVersion: FileVersion }>;
~~~

- [ ] **Step 1: Write RED authorization tests**

Extend authorize.test.ts to prove:
- team lead and project lead retain formal write;
- collaborator is rejected for formal write;
- collaborator is allowed file_write;
- observer/method_challenger/theory_replication_challenger are read-only for file_write.

Run: pnpm exec vitest run packages/application/src/auth/authorize.test.ts  
Expected: FAIL for file_write.

- [ ] **Step 2: Implement file_write without widening formal write**

Only team lead, project membership lead and collaborator may satisfy file_write. Existing write behavior remains byte-for-byte equivalent for existing callers.

Run the authorization test.  
Expected: PASS.

- [ ] **Step 3: Write RED service tests for normal logical files and external references**

file-service.test.ts must assert:
- createResearchFile creates draft logical identity + RESEARCH_FILE_CREATED event + outbox record;
- registerExternalDataVersion creates or reuses a logical file, immutable ExternalDataReference, immutable FileVersion version 1/N, currentVersionId switch, EXTERNAL_DATA_REFERENCE_CREATED and FILE_VERSION_CREATED events in one transaction;
- a collaborator with file_write can perform the operation;
- a restricted locator containing credentials is rejected before any DB row/event is written;
- raw bytes are never accepted by this API;
- restricted reference read model can later redact uriOrLocator without losing manifestHash/versionLabel.

Run: pnpm exec vitest run packages/application/src/files/file-service.test.ts  
Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement the minimal transaction services**

Allocate version numbers under SELECT ... FOR UPDATE on the ResearchFile row. For external references set scanStatus/parseStatus to not_applicable, sourceKind to external_reference, and store manifestHash on ExternalDataReference rather than pretending it is a raw-file SHA-256.

Events must contain IDs, version number, accessClass and manifest hash only; never the locator itself.

Run:
- pnpm exec vitest run packages/application/src/files/file-service.test.ts
- pnpm exec vitest run packages/application/src/events/append-research-event.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/application/src/auth/authorize.ts packages/application/src/auth/authorize.test.ts packages/application/src/files/file-service.ts packages/application/src/files/file-service.test.ts
git commit -m "feat: register research files and external data"
~~~

---

### Task 3: Make FileLink Append-only and Project-safe

**Files:**
- Create: packages/application/src/files/file-links.ts
- Test: packages/application/src/files/file-links.test.ts

**Interfaces:**
- Consumes: immutable FileVersion from Task 1 and file_write/read authorization from Task 2.
- Produces:
~~~ts
export async function createFileLink(
  sql: DatabaseSql,
  input: {
    fileVersionId: string;
    subjectType: "research_node_revision" | "research_task" | "research_result" | "scientific_decision" | "project" | "data_version";
    subjectId: string;
    relation: "documents" | "input_to" | "output_of" | "supports" | "challenges" | "review_material" | "source_for";
  },
  actor: ActorRef,
): Promise<FileLink>;

export async function retireFileLink(
  sql: DatabaseSql,
  fileLinkId: string,
  reason: string,
  actor: ActorRef,
): Promise<{ id: string; fileLinkId: string; reason: string; createdAt: Date }>;
~~~

- [ ] **Step 1: Write RED subject-resolution tests**

Assert each supported subject type resolves to the same project as the FileVersion. data_version is valid only when the opaque ref is already used by a ResearchResult or AgentContextSnapshot in that project.

Assert cross-project links are rejected before insert even if both projects belong to the same team.

Run: pnpm exec vitest run packages/application/src/files/file-links.test.ts  
Expected: FAIL.

- [ ] **Step 2: Implement explicit project resolution per subject type**

Do not add a generic unchecked polymorphic foreign key helper. Each subject type gets an explicit SQL resolver, and project must equal the ResearchFile project.

Run the test.  
Expected: subject-resolution cases PASS.

- [ ] **Step 3: Add RED append-only lifecycle assertions**

Assert:
- FILE_LINK_CREATED event contains IDs/relation only;
- retirement inserts file_link_retirements + FILE_LINK_RETIRED event;
- original file_links row remains unchanged;
- direct UPDATE/DELETE still fails at DB level;
- duplicate retirement of the same link is idempotent or returns the existing retirement record, never a second conflicting retirement.

Run the test.  
Expected: FAIL until retirement logic exists.

- [ ] **Step 4: Implement retirement and idempotency**

Use one retirement per FileLink and preserve all history.

Run:
- pnpm exec vitest run packages/application/src/files/file-links.test.ts
- pnpm exec vitest run tests/integration/files-provenance-model.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/application/src/files/file-links.ts packages/application/src/files/file-links.test.ts
git commit -m "feat: add auditable file links"
~~~

---

### Task 4: Introduce ObjectStoragePort and a Real S3-compatible Adapter

**Files:**
- Create: packages/storage/package.json
- Create: packages/storage/src/types.ts
- Create: packages/storage/src/fake.ts
- Create: packages/storage/src/s3.ts
- Create: packages/storage/src/contract.test.ts
- Create: tests/integration/storage-seaweedfs-smoke.test.ts
- Create: infra/files/version.env
- Create: infra/files/README.md
- Modify: pnpm-workspace.yaml only if package build policy needs an explicit new install-script decision
- Modify: pnpm-lock.yaml

**Interfaces:**
- Produces:
~~~ts
export type StorageObjectRef = { bucket: string; key: string };

export type ByteRange = { start: number; end?: number };

export type StoredObjectRead = {
  body: NodeJS.ReadableStream;
  contentLength: number;
  contentType: string | null;
  contentRange: string | null;
  etag: string | null;
};

export interface ObjectStoragePort {
  headObject(ref: StorageObjectRef): Promise<{ contentLength: number; contentType: string | null; etag: string | null } | null>;
  readObject(ref: StorageObjectRef, range?: ByteRange): Promise<StoredObjectRead>;
  putObject(ref: StorageObjectRef, body: NodeJS.ReadableStream | Uint8Array, contentType?: string | null): Promise<void>;
  copyObject(source: StorageObjectRef, destination: StorageObjectRef): Promise<void>;
  deleteObject(ref: StorageObjectRef): Promise<void>;
}
~~~
- S3 adapter depends only on exact @aws-sdk/client-s3 3.1141.0.

- [ ] **Step 1: Write RED adapter contract tests against FakeObjectStorage**

Contract assertions:
- put/head/read round-trip;
- range read returns exact bytes and Content-Range metadata;
- copy is idempotent for same source/destination content;
- missing object is explicit, not silently empty;
- storage keys are opaque and never constructed from original filename.

Run: pnpm exec vitest run packages/storage/src/contract.test.ts  
Expected: FAIL because package/port/fake do not exist.

- [ ] **Step 2: Implement port + fake and make contract GREEN**

Keep AWS/S3 types out of ObjectStoragePort.

Run the contract test.  
Expected: PASS.

- [ ] **Step 3: Write RED S3 compatibility smoke**

tests/integration/storage-seaweedfs-smoke.test.ts starts or connects to SeaweedFS 4.47, creates quarantine/ready test buckets, and reruns the same core contract against S3ObjectStorage.

Run: pnpm exec vitest run tests/integration/storage-seaweedfs-smoke.test.ts  
Expected: FAIL because S3 adapter is missing.

- [ ] **Step 4: Implement S3 adapter and dependency governance files**

S3ObjectStorage constructor takes endpoint/region/credentials/pathStyle from config. It must support range GET and copy without exposing presigned URLs.

infra/files/version.env records only non-secret pins:
- TUSD_VERSION=2.9.2
- SEAWEEDFS_VERSION=4.47
- CLAMAV_VERSION=1.5.4
- TIKA_VERSION=4.0.0
- DOCLING_SERVE_VERSION=1.35.0

infra/files/README.md records upstream, license, untrusted-input status, network posture, runtime isolation, replacement port and exact npm pins for Uppy/AWS/PDF.js.

Run:
- pnpm exec vitest run packages/storage/src/contract.test.ts
- pnpm exec vitest run tests/integration/storage-seaweedfs-smoke.test.ts

Expected: PASS when container/runtime is available; if the smoke is deliberately environment-gated, output must explicitly say SKIP with the missing prerequisite.

- [ ] **Step 5: Commit**

~~~bash
git add packages/storage tests/integration/storage-seaweedfs-smoke.test.ts infra/files pnpm-lock.yaml
git commit -m "feat: add s3 compatible file storage"
~~~

---

### Task 5: Secure tusd Upload Intents and Reliable Hook Ingestion

**Files:**
- Create: packages/application/src/files/upload-intent.ts
- Create: packages/application/src/files/tusd-hook.ts
- Create: packages/application/src/files/upload-intent.test.ts
- Create: packages/application/src/files/tusd-hook.test.ts
- Create: apps/web/app/api/internal/file-upload-hook/route.ts
- Modify: packages/config/src/env.ts
- Modify: packages/config/src/env.test.ts

**Interfaces:**
- Consumes: file_write authorization, FileUploadIntent tables, IntegrationInbox, Outbox.
- Produces:
~~~ts
export async function createFileUploadIntent(
  sql: DatabaseSql,
  projectId: string,
  input: {
    researchFileId?: string;
    title?: string;
    fileKind: FileKind;
    accessClass: FileAccessClass;
    originalFilename: string;
    byteSize: number;
    declaredMediaType?: string | null;
    changeSummary?: string | null;
  },
  actor: ActorRef,
  signingSecret: string,
  ttlSeconds: number,
): Promise<{ uploadIntentId: string; uploadToken: string; expiresAt: Date }>;

export async function handleTusHook(
  sql: DatabaseSql,
  hook: NormalizedTusHook,
  uploadToken: string,
  policy: { quarantineBucket: string; quarantinePrefix: string; maxFileBytes: number },
): Promise<{ accepted: boolean; inboxId?: string }>;
~~~

- [ ] **Step 1: Write RED signed-intent tests**

Assert:
- token binds uploadIntentId, actorId, expected byteSize and expiry;
- token is HMAC-authenticated and tamper/expiry fails;
- token itself is not stored in file_upload_intents, ResearchEvent or Outbox;
- original filename is metadata only and cannot influence storage key;
- max file size and required changeSummary for new-version intent are enforced.

Run: pnpm exec vitest run packages/application/src/files/upload-intent.test.ts  
Expected: FAIL.

- [ ] **Step 2: Implement upload intent creation/token verification**

Use Node crypto HMAC with constant-time comparison. Store only a token fingerprint/nonce if replay accounting needs it; never the bearer token.

Run the intent test.  
Expected: PASS.

- [ ] **Step 3: Write RED tus hook tests**

Normalize only the tusd fields Phase 4A needs:
- Type
- Event.Upload.ID
- Size/Offset
- MetaData.workbenchUploadId
- Storage.Type/Bucket/Key

Tests must prove:
- pre-create rejects unknown/stale token, wrong expected size and unsupported metadata;
- post-finish rejects partial/incomplete upload, bucket mismatch, prefix escape and size mismatch;
- accepted post-finish inserts IntegrationInbox(provider=tusd, externalId=tusUploadId:post-finish), marks intent uploaded_quarantine and enqueues file.upload.completed in one transaction;
- duplicate post-finish returns accepted=false/existing inbox and creates no second outbox;
- raw tus HTTP headers/token are not persisted.

Run: pnpm exec vitest run packages/application/src/files/tusd-hook.test.ts  
Expected: FAIL.

- [ ] **Step 4: Implement hook service + private route**

Route requirements:
- accept only application/json;
- read forwarded X-Workbench-Upload-Token but strip it before normalization;
- invoke handleTusHook for both pre-create and post-finish;
- return JSON Content-Type required by tusd;
- no long-running scan/parse inside the HTTP hook;
- no public authentication session dependency: this is service-to-service auth via the signed upload token.

Extend config with secret references for FILE_UPLOAD_SIGNING_SECRET and object-store credentials, and non-secret values for TUS_ENDPOINT, quarantine bucket/prefix, max bytes, hook TTL.

Run:
- pnpm exec vitest run packages/application/src/files/upload-intent.test.ts packages/application/src/files/tusd-hook.test.ts
- pnpm exec vitest run packages/config/src/env.test.ts
- pnpm typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/application/src/files/upload-intent.ts packages/application/src/files/tusd-hook.ts packages/application/src/files/upload-intent.test.ts packages/application/src/files/tusd-hook.test.ts apps/web/app/api/internal/file-upload-hook/route.ts packages/config/src/env.ts packages/config/src/env.test.ts
git commit -m "feat: secure resumable upload ingestion"
~~~

---

### Task 6: Add Scanner and Parser Ports with ClamAV, Tika and Docling Adapters

**Files:**
- Create: packages/file-processing/package.json
- Create: packages/file-processing/src/types.ts
- Create: packages/file-processing/src/fakes.ts
- Create: packages/file-processing/src/clamav.ts
- Create: packages/file-processing/src/tika.ts
- Create: packages/file-processing/src/docling.ts
- Create: packages/file-processing/src/contract.test.ts
- Create: tests/integration/clamav-smoke.test.ts
- Create: tests/integration/tika-smoke.test.ts
- Create: tests/integration/docling-smoke.test.ts

**Interfaces:**
- Produces:
~~~ts
export type LocalFileInput = {
  path: string;
  originalFilename: string;
  byteSize: number;
  sha256: string;
};

export interface MalwareScannerPort {
  scan(input: LocalFileInput): Promise<{
    verdict: "clean" | "malware";
    signatureName: string | null;
    scannerVersion: string;
    signatureDatabaseVersion: string;
  }>;
}

export interface MetadataExtractorPort {
  extract(input: LocalFileInput): Promise<{
    mediaTypeDetected: string;
    metadataArtifact: Uint8Array;
    textArtifact: Uint8Array | null;
    processorVersion: string;
  }>;
}

export interface RichDocumentParserPort {
  parse(input: LocalFileInput, mediaType: string): Promise<{
    supported: boolean;
    artifacts: Array<{ kind: "json" | "markdown" | "html"; bytes: Uint8Array }>;
    processorVersion: string;
  }>;
}
~~~

- [ ] **Step 1: Write RED fake contract tests**

Assert deterministic clean/malware, metadata success/failure and parser supported/unsupported/failure behavior without any network service.

Run: pnpm exec vitest run packages/file-processing/src/contract.test.ts  
Expected: FAIL.

- [ ] **Step 2: Implement the ports and fakes**

Fakes must be injectable and never hidden behind NODE_ENV branching in application services.

Run the contract test.  
Expected: PASS.

- [ ] **Step 3: Write conditional RED real-adapter smokes**

- ClamAV smoke: scan a clean fixture and the standard EICAR test signature against private clamd; assert clean vs malware plus version fields.
- Tika smoke: PUT fixture to /detect and /rmeta/text; assert content-derived MIME and metadata/text.
- Docling smoke: multipart POST /v1/convert/file requesting json, md, html; assert at least one structured artifact.

Each smoke must use explicit environment prerequisites and it.skipIf when absent.

Run:
- pnpm exec vitest run tests/integration/clamav-smoke.test.ts
- pnpm exec vitest run tests/integration/tika-smoke.test.ts
- pnpm exec vitest run tests/integration/docling-smoke.test.ts

Expected now: FAIL where enabled because adapters are missing; explicit SKIP where prerequisite is absent.

- [ ] **Step 4: Implement production adapters**

ClamAV uses clamd INSTREAM/local socket or private host/port; never expose clamd publicly. Tika 4 adapter uses explicit /detect and /rmeta/text handlers with request timeout/output cap. Docling uses private /v1/convert/file with multipart and bounded timeout/output size. No adapter writes domain facts directly.

Run contract + enabled smokes.  
Expected: fake contract PASS; configured real smokes PASS; unavailable smokes explicitly SKIP.

- [ ] **Step 5: Commit**

~~~bash
git add packages/file-processing tests/integration/clamav-smoke.test.ts tests/integration/tika-smoke.test.ts tests/integration/docling-smoke.test.ts
git commit -m "feat: add file processing adapters"
~~~

---

### Task 7: Orchestrate Quarantine, Hashing, Scan, Parse and Immutable Finalization

**Files:**
- Create: packages/application/src/files/process-upload.ts
- Create: packages/application/src/files/process-upload.test.ts
- Create: packages/application/src/files/search-projection.ts
- Create: apps/worker/src/file-worker.ts
- Test: tests/integration/file-processing-idempotency.test.ts

**Interfaces:**
- Consumes: ObjectStoragePort, MalwareScannerPort, MetadataExtractorPort, RichDocumentParserPort.
- Produces:
~~~ts
export type FileProcessingDependencies = {
  storage: ObjectStoragePort;
  scanner: MalwareScannerPort;
  metadataExtractor: MetadataExtractorPort;
  richParser: RichDocumentParserPort;
  quarantineBucket: string;
  readyBucket: string;
  readyPrefix: string;
  derivedPrefix: string;
  maxExtractedSearchBytes: number;
  metrics: FileMetricsPort;
};

export async function processCompletedUpload(
  sql: DatabaseSql,
  uploadIntentId: string,
  deps: FileProcessingDependencies,
): Promise<"ready" | "ready_with_parse_error" | "rejected_malware" | "already_terminal">;

export function createFileOutboxHandler(
  sql: DatabaseSql,
  deps: FileProcessingDependencies,
): (record: ClaimedOutboxRecord) => Promise<boolean>;
~~~

- [ ] **Step 1: Write RED clean-path orchestration test**

With FakeObjectStorage + fake processors:
- stream quarantine object to an opaque OS temp file;
- compute SHA-256 from bytes, never trust S3 ETag;
- scan before Tika/Docling;
- promote clean bytes to deterministic ready key derived from SHA-256, not original filename;
- persist sanitized scan-report.json and parser artifacts under deterministic derived keys;
- create FileBlob, FileVersion, terminal FileProcessingRecords, FTS projection, currentVersionId and FILE_* ResearchEvents in one finalization transaction;
- remove temp file in finally;
- delete clean quarantine source only after ready copy succeeds.

Run: pnpm exec vitest run packages/application/src/files/process-upload.test.ts  
Expected: FAIL.

- [ ] **Step 2: Implement minimal clean path until GREEN**

FileVersion terminal values:
- scanStatus = passed;
- parseStatus = parsed when rich parser or Tika fallback produced accepted text/structure;
- sourceKind = upload;
- sha256/byteSize/mediaType come from worker-verified facts.

FileProcessingRecord success outputRefs must be non-empty: ClamAV points to sanitized scan-report.json; Tika/Docling point to deterministic derived artifacts.

Run the test.  
Expected: clean path PASS.

- [ ] **Step 3: Add RED failure/retry/governance cases**

Add assertions:
- malware -> intent rejected_malware, blob remains quarantine/rejected, FILE_SCAN_REJECTED emitted, no FileVersion/current pointer/download eligibility;
- scanner unavailable -> processing_failed with safe error code, bytes remain quarantine, retry succeeds without a second version;
- Docling failure + Tika fallback -> ready_with_parse_error, parseStatus=failed, file still downloadable, FILE_PARSE_FAILED emitted;
- duplicate outbox delivery -> already_terminal and no duplicate FileVersion/processing record;
- two concurrent finalized uploads to one ResearchFile -> unique monotonic version numbers and highest version current;
- clean physical blob dedup uses unique backend+sha256 without collapsing separate FileVersion provenance;
- after processing, scientific_decisions and research_results row counts are unchanged.

Run:
- pnpm exec vitest run packages/application/src/files/process-upload.test.ts
- pnpm exec vitest run tests/integration/file-processing-idempotency.test.ts

Expected: FAIL until retry/concurrency/idempotency paths exist.

- [ ] **Step 4: Implement failure paths, processing attempt staging, FTS and metrics**

Operational FileIngestProcessorAttempt may UPDATE pending/running/succeeded/failed and stores only safe errorCode plus output object refs. On terminal finalization, copy its processor facts into immutable FileProcessingRecord.

FTS projection:
- index ResearchFile title, current original filename, bounded Tika extracted text and safe metadata values;
- store tsvector + short safe preview, not full parser JSON;
- use a configurable byte cap and truncate before to_tsvector.

Metrics sink must receive:
- upload completed/failed;
- scan duration/verdict;
- parse duration/success/failure;
- callback dedupe count;
- storage errors;
- queue depth when the worker pass begins.
No metric label may include filename, raw locator or presigned/token data.

Run:
- pnpm exec vitest run packages/application/src/files/process-upload.test.ts tests/integration/file-processing-idempotency.test.ts
- pnpm exec vitest run packages/application/src/events/append-research-event.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/application/src/files/process-upload.ts packages/application/src/files/process-upload.test.ts packages/application/src/files/search-projection.ts apps/worker/src/file-worker.ts tests/integration/file-processing-idempotency.test.ts
git commit -m "feat: process quarantined research files"
~~~

---

### Task 8: Compose the Production File Runtime Without Disturbing Agent Runtime

**Files:**
- Create: apps/worker/src/file-runtime.ts
- Create: apps/worker/src/file-runtime.test.ts
- Modify: apps/worker/src/main.ts
- Modify: apps/worker/package.json
- Modify: packages/application/package.json as needed for port dependencies
- Modify: packages/config/src/env.ts
- Modify: pnpm-lock.yaml

**Interfaces:**
- Consumes: createFileOutboxHandler and production adapters.
- Produces:
~~~ts
export type FileRuntimeConfig = {
  s3Endpoint: string;
  s3Region: string;
  s3ForcePathStyle: boolean;
  quarantineBucket: string;
  readyBucket: string;
  readyPrefix: string;
  derivedPrefix: string;
  clamavEndpoint: { socketPath: string } | { host: string; port: number };
  tikaBaseUrl: string;
  doclingBaseUrl: string;
  maxFileBytes: number;
  maxExtractedSearchBytes: number;
};

export function createProductionFileOutboxHandler(
  sql: DatabaseSql,
  config: FileRuntimeConfig,
  secrets: { s3AccessKeyId: string; s3SecretAccessKey: string },
): (record: ClaimedOutboxRecord) => Promise<boolean>;

export function composeOutboxHandlers(
  ...handlers: Array<(record: ClaimedOutboxRecord) => Promise<boolean>>
): OutboxDispatchHandler;
~~~

- [ ] **Step 1: Write RED composition tests**

Assert:
- file event is handled exactly once by file handler;
- agent.run.dispatch retains existing Agent handler behavior;
- unknown outbox type is marked delivered only if a handler explicitly owns it; otherwise throw safe UnhandledOutboxEvent so it retries/alerts rather than silently disappearing;
- config rejects public/invalid service URLs where private-only policy is enforceable and never serializes secret values.

Run: pnpm exec vitest run apps/worker/src/file-runtime.test.ts packages/config/src/env.test.ts  
Expected: FAIL.

- [ ] **Step 2: Implement production composition**

Instantiate S3ObjectStorage, ClamAvScannerAdapter, TikaMetadataExtractor and DoclingRichParser only here. Application/domain packages must not import their concrete classes.

Run the runtime/config tests.  
Expected: PASS.

- [ ] **Step 3: Add RED outbox retry integration**

Extend tests/integration/outbox-retry.test.ts or add file-runtime retry coverage proving:
- storage/scanner transient error leaves outbox pending with safe DispatchError;
- a later pass succeeds and the same upload intent finalizes once.

Run the targeted outbox test.  
Expected: FAIL until composition/retry path is wired.

- [ ] **Step 4: Wire main worker dispatch and verify Phase 3 regression**

Keep startWorker(databaseUrl, dispatch) injectable for tests. Add handler composition at the production caller/composition boundary; do not hardwire a real Agent provider.

Run:
- pnpm exec vitest run apps/worker/src/file-runtime.test.ts apps/worker/src/production-runtime.test.ts tests/integration/outbox-retry.test.ts
- pnpm typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/worker/src/file-runtime.ts apps/worker/src/file-runtime.test.ts apps/worker/src/main.ts apps/worker/package.json packages/application/package.json packages/config/src/env.ts packages/config/src/env.test.ts pnpm-lock.yaml
git commit -m "feat: compose file processing worker"
~~~

---

### Task 9: Serve Authenticated File Content and PDF Preview Safely

**Files:**
- Create: packages/application/src/files/content-access.ts
- Create: packages/application/src/files/content-access.test.ts
- Create: apps/web/app/api/files/[fileVersionId]/content/route.ts
- Create: apps/web/src/components/files/pdf-preview.tsx
- Modify: apps/web/package.json
- Modify: pnpm-lock.yaml

**Interfaces:**
- Produces:
~~~ts
export async function getFileContentDescriptor(
  sql: DatabaseSql,
  fileVersionId: string,
  actorId: string,
): Promise<{
  projectId: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  storageRef: StorageObjectRef;
  accessClass: FileAccessClass;
}>;
~~~
- Route supports GET and byte Range; query parameter download=1 changes Content-Disposition but never storage authorization.

- [ ] **Step 1: Write RED content authorization tests**

Assert:
- project member can read a clean blob-backed version;
- outsider cannot;
- malware/no-version/pending upload cannot;
- external-reference version has no content stream;
- restricted metadata policy does not accidentally bypass project membership.

Run: pnpm exec vitest run packages/application/src/files/content-access.test.ts  
Expected: FAIL.

- [ ] **Step 2: Implement descriptor query and authenticated streaming route**

Route must:
- resolve logged-in CurrentMember;
- call getFileContentDescriptor;
- pass Range to ObjectStoragePort.readObject;
- return 206 + Content-Range when appropriate;
- set nosniff and safe Content-Disposition;
- never redirect to a long-lived/public object URL.

Run the content-access test and typecheck.  
Expected: PASS.

- [ ] **Step 3: Add RED PDF preview acceptance component test target**

Add pdfjs-dist 6.3.289 exactly. Implement PdfPreview as a client component that loads only the authenticated Workbench content URL and renders at least page 1 with PDF.js; do not send source URLs to third-party viewers.

The browser proof is completed in Task 12; here pnpm build is the RED/GREEN gate for the worker bundle and Next.js client/server boundary.

Run: pnpm build  
Expected before wiring: FAIL for missing module/component integration.

- [ ] **Step 4: Wire PDF.js worker and make production build GREEN**

Use PDF.js packaged worker from pdfjs-dist; no CDN.

Run:
- pnpm build
- pnpm typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/application/src/files/content-access.ts packages/application/src/files/content-access.test.ts apps/web/app/api/files/[fileVersionId]/content/route.ts apps/web/src/components/files/pdf-preview.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add secure file content preview"
~~~

---

### Task 10: Build File Queries, FTS Search and Restricted Metadata Redaction

**Files:**
- Modify: apps/web/src/server/queries.ts
- Create: packages/application/src/files/file-read-model.test.ts

**Interfaces:**
- Produces:
~~~ts
export type ProjectFileListItem = {
  id: string;
  title: string;
  fileKind: FileKind;
  currentVersionNumber: number | null;
  accessClass: FileAccessClass;
  lifecycleState: string;
  scanStatus: string | null;
  parseStatus: string | null;
  updatedAt: Date;
  linkCount: number;
};

export async function getProjectFiles(
  member: CurrentMember,
  projectId: string,
  filters?: { q?: string; fileKind?: FileKind; processingState?: string; subjectType?: string },
): Promise<ProjectFileListItem[] | null>;

export async function getResearchFileDetail(
  member: CurrentMember,
  researchFileId: string,
): Promise<ResearchFileDetailViewModel | null>;
~~~

- [ ] **Step 1: Write RED read-model tests**

Seed:
- normal uploaded-style version with processing records/search text;
- restricted external reference;
- old version + current version;
- active link + retired link.

Assert:
- default list shows current version facts but history remains on detail;
- q uses PostgreSQL FTS, not only filename ILIKE;
- filters by fileKind/processing/link subject work;
- normal project member sees restricted reference existence, manifest hash and version label but uriOrLocator/accessPolicyRef/license ref are redacted;
- team lead/project lead/creator can see those restricted metadata fields;
- retired link is shown in audit history but excluded from active link count.

Run: pnpm exec vitest run packages/application/src/files/file-read-model.test.ts  
Expected: FAIL.

- [ ] **Step 2: Implement query helpers following existing explicit-SQL style**

Do not introduce a repository abstraction rewrite. Keep query DTO mapping focused and deterministic.

Run the read-model test.  
Expected: PASS.

- [ ] **Step 3: Add RED search edge cases**

Assert:
- empty query does not build invalid tsquery;
- punctuation-only query degrades to metadata filters without SQL error;
- query cannot inject SQL;
- search projection contains no restricted locator and no raw parser JSON.

Run the test.  
Expected: FAIL until normalization is complete.

- [ ] **Step 4: Implement safe websearch_to_tsquery/simple config behavior**

Bound query length and parameterize all SQL.

Run:
- pnpm exec vitest run packages/application/src/files/file-read-model.test.ts
- pnpm typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/src/server/queries.ts packages/application/src/files/file-read-model.test.ts
git commit -m "feat: query and search research files"
~~~

---

### Task 11: Add Human File Operations UI with Uppy/tus

**Files:**
- Create: apps/web/src/server/file-actions.ts
- Create: apps/web/src/components/files/file-upload-form.tsx
- Create: apps/web/src/components/files/external-reference-form.tsx
- Create: apps/web/src/components/files/file-list.tsx
- Create: apps/web/src/components/files/file-detail.tsx
- Create: apps/web/src/components/files/file-link-form.tsx
- Create: apps/web/app/(app)/projects/[projectId]/files/page.tsx
- Create: apps/web/app/(app)/projects/[projectId]/files/[researchFileId]/page.tsx
- Modify: apps/web/src/components/project-navigation.tsx
- Modify: apps/web/package.json
- Modify: pnpm-lock.yaml

**Interfaces:**
- Consumes: createFileUploadIntent, registerExternalDataVersion, createFileLink/retireFileLink, query DTOs, PdfPreview.
- Uppy pins: @uppy/core 5.2.0 and @uppy/tus 5.1.1 exactly.

- [ ] **Step 1: Write RED server-action tests for form boundary validation**

Create focused tests for file-actions helpers proving:
- new file requires title/fileKind/accessClass/file;
- new version requires existing ResearchFile + non-empty changeSummary;
- external reference form has no raw-file field and rejects credential-bearing locator;
- link action permits only approved subject/relation values;
- all actions resolve CurrentMember server-side and never trust actor ID from form data.

Run the new file-actions test.  
Expected: FAIL.

- [ ] **Step 2: Implement server actions and Uppy intent handoff**

FileUploadForm flow:
1. validate selected file and metadata locally;
2. request signed Workbench upload intent;
3. instantiate Uppy Core + Tus;
4. set workbenchUploadId as tus metadata and X-Workbench-Upload-Token as request header;
5. show resumable progress, retry and terminal “processing” state;
6. never persist bearer token outside Uppy instance memory.

Run targeted tests + typecheck.  
Expected: PASS.

- [ ] **Step 3: Build file list/detail pages**

List displays title, fileKind, current version, accessClass, scan/parse status, updated time and active link count. Detail displays terminal version history, hash/MIME/size, provenance, processing records, active/retired links, preview/download, external-reference metadata with redaction.

Enable “文件与资料” in ProjectNavigation; keep existing project pages unchanged.

Run: pnpm build  
Expected: PASS.

- [ ] **Step 4: Add new-version and link interactions**

From detail page:
- upload vN+1 with changeSummary;
- create/retire links;
- for PDF show PdfPreview;
- for text/Markdown or extracted representation show escaped text only;
- Office/complex docs show extracted representation + original download, no online editor.

Run:
- pnpm typecheck
- pnpm lint
- pnpm build

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/web/src/server/file-actions.ts apps/web/src/components/files apps/web/app/(app)/projects/[projectId]/files apps/web/src/components/project-navigation.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add research file workspace"
~~~

---

### Task 12: Prove the Eight Phase 4A Browser Scenarios with Real tusd

**Files:**
- Create: tests/acceptance/support/file-services.ts
- Modify: tests/acceptance/support/environment.ts
- Create: tests/acceptance/files-provenance.spec.ts
- Modify: package.json

**Interfaces:**
- Acceptance infrastructure uses pinned SeaweedFS 4.47 + tusd 2.9.2 Testcontainers.
- Scanner/Tika/Docling are injected fakes in acceptance so browser coverage is deterministic; real adapter behavior stays in Task 4/6 smoke tests.
- The acceptance worker uses real S3ObjectStorage against SeaweedFS and the same application processCompletedUpload path as production.

- [ ] **Step 1: Write the first RED Playwright scenario and service harness**

Start SeaweedFS + tusd with tusd S3 backend pointed at the quarantine bucket and HTTP hooks pointed at the test Next.js host endpoint. Start the file outbox worker with fake processors.

Scenario 1:
- log in as project researcher;
- open 文件与资料;
- create logical ResearchFile and upload v1;
- wait for ready;
- assert version 1, SHA-256, MIME, uploader and processor identity visible.

Run: pnpm exec playwright test tests/acceptance/files-provenance.spec.ts -g "uploads v1"  
Expected: FAIL until the harness/UI is fully wired.

- [ ] **Step 2: Make v1 flow GREEN, then add resumable-upload RED/GREEN**

Scenario 2:
- upload a file larger than configured tus chunk size;
- abort the first PATCH after at least one chunk;
- retry/resume;
- assert only one tus creation POST for that intent and final Workbench version is created once.

Run targeted test.  
Expected: PASS.

- [ ] **Step 3: Add malware, v2 history and link scenarios**

Scenario 3: fake scanner flags test marker -> UI shows rejected/quarantine; content route/download is unavailable.

Scenario 4: upload v2 with changeSummary -> detail shows v1 + v2 and v1 remains downloadable; current is v2.

Scenario 5: link current FileVersion to ResearchNode revision and ResearchResult -> both appear under provenance links.

Run those three tests.  
Expected: PASS.

- [ ] **Step 4: Add external reference, PDF preview and parser-failure scenarios**

Scenario 6: register restricted external dataset -> no tus request/raw bytes; manifest/version visible; locator redacted for ordinary member.

Scenario 7: upload PDF -> PDF.js renders first page from authenticated Workbench content route.

Scenario 8: fake rich parser failure with Tika fallback -> version survives, status ready_with_parse_error, original remains downloadable, parse failure audit visible.

Run:
- pnpm exec playwright test tests/acceptance/files-provenance.spec.ts
- pnpm acceptance after adding this spec to the root script

Expected: all Phase 1–4A browser specs PASS.

- [ ] **Step 5: Commit**

~~~bash
git add tests/acceptance/support/file-services.ts tests/acceptance/support/environment.ts tests/acceptance/files-provenance.spec.ts package.json
git commit -m "test: cover phase four file workflows"
~~~

---

### Task 13: CI Integration, Dependency Audit and Security Regression

**Files:**
- Modify: .github/workflows/ci.yml only where current commands do not already execute new tests
- Create: tests/integration/file-event-secret-safety.test.ts
- Modify: infra/files/README.md

**Interfaces:**
- No new product interface; this task pins cross-cutting failure modes missed by individual components.

- [ ] **Step 1: Write RED secret/governance regression test**

Assert across upload intent, post-finish, clean parse, malware reject, external reference and link operations:
- ResearchEvent/Outbox JSON contains no upload token, S3 credential, presigned query, raw document text, restricted locator credential, ClamAV internal log or Docling/Tika raw payload;
- processing a file creates no ScientificDecision and no ResearchResult;
- log/metric adapters receive IDs/status/hash/duration only.

Run: pnpm exec vitest run tests/integration/file-event-secret-safety.test.ts  
Expected: FAIL if any unsafe field leaks.

- [ ] **Step 2: Fix serializers/telemetry boundaries until GREEN**

Do not weaken assertSecretSafe. Remove unsafe payload fields at producers.

Run the regression test.  
Expected: PASS.

- [ ] **Step 3: Run the external adapter matrix**

Run:
- pnpm exec vitest run tests/integration/storage-seaweedfs-smoke.test.ts
- pnpm exec vitest run tests/integration/clamav-smoke.test.ts
- pnpm exec vitest run tests/integration/tika-smoke.test.ts
- pnpm exec vitest run tests/integration/docling-smoke.test.ts

Expected:
- SeaweedFS/tusd path used by acceptance: PASS;
- ClamAV/Tika/Docling: PASS when configured, otherwise explicit SKIP with prerequisite name.

Record exact upstream pins, license, install/native scripts decision, untrusted-input boundary, network posture and replacement port in infra/files/README.md.

- [ ] **Step 4: Ensure CI executes the required non-conditional core**

CI must always run fake contracts, PostgreSQL integration tests, typecheck, lint, build and full Playwright. Do not make Phase 4A core success depend on real Agent provider/API or optional external parser smoke credentials.

Run local equivalent:
- pnpm typecheck
- pnpm lint
- pnpm test
- pnpm build
- pnpm acceptance

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add .github/workflows/ci.yml tests/integration/file-event-secret-safety.test.ts infra/files/README.md
git commit -m "test: harden file provenance boundaries"
~~~

---

### Task 14: Fresh Verification, Independent Invariant Review and Phase Record

**Files:**
- Create: docs/superpowers/reviews/2026-09-30-phase-04a-verification.md

**Interfaces:**
- Consumes the complete implementation tree; produces only verification evidence and review findings.
- No product code changes are allowed after the “fresh” verification run without rerunning the affected layer and then the full final gate.

- [ ] **Step 1: Re-read live branch head and GitHub Actions before final verification**

Confirm phase/04-research-operations head and inspect the most recent workflow run. Do not reuse remembered results.

- [ ] **Step 2: Run fresh full local verification from the final tree**

Run, in this order:
~~~bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm acceptance
~~~

Expected: all required commands exit 0. Optional real ClamAV/Tika/Docling smoke may be explicit SKIP only if the required endpoint/binary is absent; list each skip separately.

- [ ] **Step 3: Request an independent invariant review**

Use superpowers:requesting-code-review with a fresh reviewer focused on:
- FileVersion immutability and version concurrency;
- quarantine/ready boundary and forged storage locators;
- hook/inbox/outbox idempotency;
- restricted-data and secret leakage;
- Observation/Claim/Decision separation;
- adapter isolation and replaceability;
- old-version/negative/failure history preservation.

Any high-severity issue returns to the owning task and invalidates the previous final verification until fixed and rerun.

- [ ] **Step 4: Create the Phase 4A verification record**

docs/superpowers/reviews/2026-09-30-phase-04a-verification.md must record:
- verified branch head SHA;
- commit range from 03697b66bb445bbac59a8e3e144319490e975b2d;
- exact test/build commands and outcomes;
- Playwright scenario count;
- external adapter smoke PASS/SKIP matrix;
- pinned open-source versions/licenses;
- schema/invariant summary;
- independent review findings and fixes;
- known limitations;
- explicit statement that real Agent provider smoke remains out of scope and was not converted into PASS.

Commit only the verification record after the fresh tree has passed.

- [ ] **Step 5: Push, verify GitHub Actions and prepare the stacked Draft PR without merging**

After the verification-record commit:
- read the new branch head from GitHub;
- wait for/read the GitHub Actions run for that exact head and require conclusion=success before declaring Phase 4A verified;
- if no Phase 4A PR exists, create a Draft PR from phase/04-research-operations to phase/03-agent-runtime so Phase 3 can remain unmerged;
- include new scientific/file invariants, CI evidence and known skips in PR description;
- do not enable auto-merge and do not merge the Draft PR.

---

## Self-review Checklist

### Spec coverage

- Sections 1–4 goals/non-goals/principles: Global Constraints + Tasks 1–14.
- Uppy/tusd: Tasks 5, 11, 12.
- S3-compatible storage / SeaweedFS portability: Task 4.
- ClamAV quarantine scanning: Tasks 6–7.
- Tika MIME/metadata/fallback extraction: Tasks 6–7.
- Docling rich structure: Tasks 6–7.
- GROBID future plug-in: preserved by RichDocumentParserPort; no 4A runtime dependency.
- PDF.js: Tasks 9 and 12.
- PostgreSQL FTS / future pgvector: Tasks 1, 7, 10; no vector service introduced.
- Ontology future boundary: stable IDs/provenance retained; no RDF engine implemented.
- ResearchFile/FileVersion/FileBlob/ExternalDataReference/FileLink/FileProcessingRecord: Tasks 1–3 and 7.
- FileVersion immutability/current pointer/concurrency: Tasks 1 and 7.
- Restricted data default no-copy: Task 2 + Task 12.
- Upload lifecycle/idempotency: Tasks 5 and 7.
- Permissions: Tasks 2, 9, 10, 11.
- Required ResearchEvents/Outbox/Inbox: Tasks 2, 3, 5, 7.
- File list/detail/upload UI: Tasks 10–12.
- Preview strategy: Tasks 9, 11, 12.
- Knowledge/Ontology forward provenance: immutable processor/version/hash/output refs in Tasks 1, 6, 7.
- Observation/Claim/Decision separation: Tasks 7 and 13.
- Phase 4B/4C interfaces: file/version/link contracts exist; no 4B/4C implementation is pulled forward.
- Error handling/security/observability: Tasks 5–8 and 13.
- Database invariants: Task 1 + concurrency/idempotency Task 7.
- All eight Playwright scenarios: Task 12.
- Exit conditions and dependency governance: Tasks 13–14.

### Step scan

Every implementation task has an explicit RED test, a command that demonstrates failure, a named interface or constrained implementation action, a GREEN command and a commit. Setup/dependency edits are folded into the first deliverable that needs them rather than split into non-testable scaffolding tasks.

### Type consistency

- Task 4 ObjectStoragePort is the only storage interface consumed by Tasks 7–9.
- Task 6 processing ports are the only scanner/parser interfaces consumed by Task 7/8.
- Task 5 post-finish emits file.upload.completed; Task 7/8 own that outbox event.
- FileVersion is created only by Task 2 external-reference flow or Task 7 upload finalization; no later task mutates it.
- FileLink retirement is a separate immutable record and never changes FileLink.
- Existing formal write authorization remains unchanged; only file_write is new.

### Review Focus closure

All five Review Focus items have concrete tests in Tasks 2, 5, 7, 10 and 13. No Review Focus item is left only as prose.

### Proportion

The plan chooses interfaces, invariants, filenames, versions and proof commands without embedding implementation bodies. Detailed algorithms are limited to places where the approved spec leaves a dangerous ambiguity: terminal FileVersion creation, signed tus intent handling, quarantine/finalization ordering and output provenance.
