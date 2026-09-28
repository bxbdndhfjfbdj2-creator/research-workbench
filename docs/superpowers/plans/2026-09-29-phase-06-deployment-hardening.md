# 第六阶段：安全加固、部署与第一版全量验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前五阶段的软件加固为可在私有云服务器持续运行的第一版：可观测、可备份、可升级、可回退，并通过完整自动化与人工科研闭环验收。

**Architecture:** Docker Compose 运行 web/worker/postgres/minio/deepseek-harness；GitHub Actions 构建和测试镜像，预发布环境先部署并人工验收，正式环境需显式审批。日志使用结构化输出和可选 OpenTelemetry exporter，不记录 secret/hidden reasoning。

**Tech Stack:** Docker Compose；GHCR；GitHub Actions；PostgreSQL backup；MinIO/S3；Pino；OpenTelemetry；Playwright。

**Spec:** `docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## Global Constraints

- 正式环境不能从 feature branch 直接部署。
- migration 在应用启动前单独执行；失败不得启动新版本。
- `danger-full-access` 不作为 production 默认 Harness 权限。
- 日志不得包含密码、token、private key、数据库 URL credential 或模型隐藏推理。
- 预发布人工验收通过后才能正式发布。
- 正式部署后必须烟雾测试；失败触发回退流程。

## Review Focus

1. migration 失败：部署失败关闭，不把新应用版本切到生产流量。
2. Worker/Harness 重启：未完成 Outbox/AgentTask 可恢复。
3. secret 注入日志：自动扫描阻断 CI。
4. Postgres/对象存储备份恢复：能在隔离环境恢复并登录/读取项目。
5. 正式烟雾测试失败：发布任务标记失败并执行明确回退步骤。

---

### Task 1: 统一结构化日志、健康检查与基础可观测性

**Files:**
- Create: `packages/observability/src/logger.ts`
- Create: `packages/observability/src/metrics.ts`
- Create: `apps/web/app/api/health/live/route.ts`
- Create: `apps/web/app/api/health/ready/route.ts`
- Create: `apps/worker/src/health.ts`
- Test: `packages/observability/src/logger.test.ts`
- Test: `tests/integration/health.test.ts`

**Interfaces:**
- `createLogger(context): Logger` 自动 redact secret keys。
- liveness 只说明进程存活；readiness 检查 PostgreSQL。
- Worker readiness 额外检查 queue。
- Harness health 单独展示，不让 Web 因 Harness 暂停而完全失去科研数据访问。

- [ ] **Step 1: 写失败测试**

secret redaction；DB down 时 readiness=false；Harness down 仍保持 Web liveness=true 并在依赖状态中标红。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/observability/src/logger.test.ts tests/integration/health.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 logger/health**

日志字段名统一，错误对象序列化必须走 redaction。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/observability/src/logger.test.ts tests/integration/health.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/observability apps/web/app/api/health apps/worker/src/health.ts tests/integration/health.test.ts
git commit -m "feat: add health and observability foundation"
```

### Task 2: Docker Compose 开发/预发布/正式运行定义

**Files:**
- Create: `infra/docker/compose.base.yml`
- Create: `infra/docker/compose.dev.yml`
- Create: `infra/docker/compose.staging.yml`
- Create: `infra/docker/compose.prod.yml`
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `infra/harness/Dockerfile`
- Create: `scripts/smoke-compose.sh`
- Create: `tests/integration/compose-config.test.ts`

**Interfaces:**
- services: web, worker, postgres, minio, deepseek-harness。
- secret 通过 env file/secret manager 注入，不 bake 到 image。
- dev 可暴露调试端口；prod 只暴露必要 Web 入口。
- Compose service names 在 staging/prod 保持一致，便于 runbook 共用。

- [ ] **Step 1: 写失败测试**

解析四个 Compose 文件，断言 prod 不暴露 Postgres/MinIO 管理端口，Harness 默认无 `danger-full-access` 配置。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/compose-config.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 Dockerfiles 与 Compose**

镜像以非 root 用户运行；healthcheck 使用 Task 1 endpoints。

- [ ] **Step 4: 构建并运行本地 smoke**

Run: `docker compose -f infra/docker/compose.base.yml -f infra/docker/compose.dev.yml config && docker compose -f infra/docker/compose.base.yml -f infra/docker/compose.dev.yml up -d --build && bash scripts/smoke-compose.sh`  
Expected: config valid，所有服务健康，smoke PASS。

- [ ] **Step 5: Commit**

```bash
git add infra/docker apps/web/Dockerfile apps/worker/Dockerfile infra/harness/Dockerfile scripts/smoke-compose.sh tests/integration/compose-config.test.ts
git commit -m "chore: add containerized runtime"
```

### Task 3: CI、镜像构建与秘密输出扫描

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/build-images.yml`
- Create: `scripts/check-secrets-in-output.ts`
- Create: `scripts/check-secrets-in-output.test.ts`

**Interfaces:**
- PR 必跑：lockfile install、typecheck、lint、unit/integration、build。
- main 成功后构建 immutable SHA-tagged images。
- CI 不运行需要真实付费模型的测试；真实 Harness smoke 使用受保护环境手动运行。
- `check-secrets-in-output` 至少识别项目定义的 secret 保留键和测试用伪 key pattern。

- [ ] **Step 1: 写失败的秘密扫描测试**

伪造 `sk-test-...`、`privateKey`、带凭据的 DATABASE_URL，断言 scanner 返回失败；普通 commit SHA 不误报。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run scripts/check-secrets-in-output.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 scanner 和 GitHub Actions**

CI 在测试日志/构建产物摘要上运行 scanner。

- [ ] **Step 4: 验证本地 gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm vitest run scripts/check-secrets-in-output.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/build-images.yml scripts/check-secrets-in-output.ts scripts/check-secrets-in-output.test.ts
git commit -m "ci: add quality gates and image builds"
```

### Task 4: 备份、恢复和数据库迁移运行手册

**Files:**
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/restore-postgres.sh`
- Create: `scripts/backup-object-storage.sh`
- Create: `infra/deploy/MIGRATIONS.md`
- Create: `infra/deploy/BACKUP-RESTORE.md`
- Test: `tests/integration/backup-restore.test.ts`

**Interfaces:**
- backup 产物有时间戳和 checksum。
- restore 必须指定新/隔离目标，脚本默认拒绝 production hostname/database name。
- migrations 为单向 forward migration；不自动执行 destructive down migration。

- [ ] **Step 1: 写失败的隔离恢复测试**

创建最小 Team/Project/ResearchEvent/Asset fixture，backup 后删除测试数据库与 bucket，restore 到隔离目标并断言数据完整。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/backup-restore.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 backup/restore 脚本和 migration runbook**

脚本失败必须非零退出；任何 destructive restore 需要显式 `--target` 且 production target 被拒绝。

- [ ] **Step 4: 运行恢复测试**

Run: `pnpm vitest run tests/integration/backup-restore.test.ts`  
Expected: PASS，并在测试日志记录恢复耗时。

- [ ] **Step 5: Commit**

```bash
git add scripts/backup-postgres.sh scripts/restore-postgres.sh scripts/backup-object-storage.sh infra/deploy/MIGRATIONS.md infra/deploy/BACKUP-RESTORE.md tests/integration/backup-restore.test.ts
git commit -m "ops: add backup restore and migration runbooks"
```

### Task 5: 预发布与正式部署工作流

**Files:**
- Create: `.github/workflows/deploy-staging.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `infra/deploy/deploy-compose.sh`
- Create: `infra/deploy/ROLLBACK.md`
- Create: `infra/deploy/README.md`
- Create: `tests/integration/deploy-dry-run.test.ts`

**Interfaces:**
- staging 从 main 的 immutable image SHA 部署。
- production 只接受已经在 staging 记录为 accepted 的同一 image SHA，并使用 GitHub Environment manual approval。
- rollback 使用上一已知良好 image SHA。
- `deploy-compose.sh --dry-run --environment staging|production --sha <sha>` 不执行 SSH/远程变更。

- [ ] **Step 1: 写部署 dry-run 失败测试**

断言 production 未给 accepted staging evidence 时拒绝；同 SHA 通过 gate 后生成确定的 compose pull/migrate/up/smoke 命令序列。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/deploy-dry-run.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 staging/production workflows 与 deploy script**

云服务器 provider 保持中立；目标主机、SSH key、域名均通过 GitHub Environment secrets/vars 注入。

- [ ] **Step 4: 验证 dry-run 与模拟 rollback**

Run: `pnpm vitest run tests/integration/deploy-dry-run.test.ts`  
Expected: PASS；模拟 smoke fail 时输出 rollback 到 previous SHA 的操作。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-staging.yml .github/workflows/deploy-production.yml infra/deploy tests/integration/deploy-dry-run.test.ts
git commit -m "ops: add staged deployment workflow"
```

### Task 6: 第一版完整自动化验收场景

**Files:**
- Create: `tests/acceptance/full-research-lifecycle.spec.ts`
- Create: `tests/acceptance/failure-retry.spec.ts`
- Create: `tests/acceptance/webhook-idempotency.spec.ts`
- Create: `tests/acceptance/asset-promotion.spec.ts`

**Interfaces:**
- `full-research-lifecycle.spec.ts` 逐项覆盖设计规格第 31.1 的 20 步核心科研闭环。
- FakeHarness/FakeGitHub 用于 deterministic CI；受保护 staging 另跑真实 Harness/GitHub smoke。

- [ ] **Step 1: 写四个失败 E2E**

覆盖完整生命周期、Agent Run #1→#2、同一 GitHub webhook 三次、项目资产→团队级资产。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm playwright test tests/acceptance/full-research-lifecycle.spec.ts tests/acceptance/failure-retry.spec.ts tests/acceptance/webhook-idempotency.spec.ts tests/acceptance/asset-promotion.spec.ts`  
Expected: 至少一个测试 FAIL，直到所有阶段 wiring 完整。

- [ ] **Step 3: 只修复跨模块 wiring 缺口**

不得借验收阶段新增规格外产品功能；发现真正的设计缺口必须回到规格/计划评审。

- [ ] **Step 4: 运行完整自动化验收**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance && pnpm build`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance
git commit -m "test: add complete v1 acceptance scenarios"
```

### Task 7: 人工验收手册、运行手册与发布候选

**Files:**
- Create: `docs/acceptance/v1-manual-acceptance.md`
- Create: `docs/operations/v1-runbook.md`
- Create: `CHANGELOG.md`

**Interfaces:**
- 手册覆盖：六人登录、五项目、多维状态、研究分支、重大审批、Agent Run、真实编码子代理、GitHub CI 真实性、资产升级、故障恢复。
- 每项记录“执行者、时间、环境、结果、证据链接”。

- [ ] **Step 1: 写人工验收 checklist**

每项必须有预期结果和证据字段；任何失败都要求 GitHub issue 链接。

- [ ] **Step 2: 在 staging 执行手册**

Expected: 全部通过；真实 Harness 与至少一种编码子代理 smoke 有实际证据。

- [ ] **Step 3: 对失败项修复后只重跑受影响范围及最终 full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance && pnpm build`  
Expected: PASS。

- [ ] **Step 4: 创建 release candidate 前做 production dry-run**

Run: `bash infra/deploy/deploy-compose.sh --dry-run --environment production --sha <candidate-sha>`  
Expected: 只有 staging accepted evidence 存在时成功。

- [ ] **Step 5: Commit**

```bash
git add docs/acceptance/v1-manual-acceptance.md docs/operations/v1-runbook.md CHANGELOG.md
git commit -m "docs: add v1 acceptance and operations runbook"
```

## 第六阶段最终发布闸门

只有以下全部满足，第一版才可标记完成：

- 六名成员真实账户可用。
- 五个项目可并行且多维状态独立。
- 研究网络/分支/回路/失败历史可追踪。
- 重大科学变化无法绕过审批。
- 真实 Harness 运行和至少一种真实 Codex/Claude Code 子代理链通过 staging。
- 正式结果可追溯到数据版本、代码提交、Agent/人工运行。
- GitHub 无 Commit/CI 不会被标记为工程验证通过。
- 资产可版本化、升级和跨项目追踪。
- Harness/GitHub/Worker 重启不会静默损坏正式科研状态。
- staging 人工验收和 production smoke 均通过。
