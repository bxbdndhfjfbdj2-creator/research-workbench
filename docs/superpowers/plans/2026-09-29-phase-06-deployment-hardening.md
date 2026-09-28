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

1. migration 失败：旧版本服务保持运行或部署失败关闭，不出现半迁移新版本。
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
- `createLogger(context)` 自动 redact secret keys。
- readiness 检查 Postgres；Worker 额外报告 queue；Harness health 独立展示，不让 Web 因 Harness 暂停而完全失去科研数据访问。

- [ ] 写失败测试：secret redaction、DB down readiness false。
- [ ] 运行失败。
- [ ] 实现 logger/health。
- [ ] 验证 PASS。
- [ ] Commit。

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

**Interfaces:**
- services: web, worker, postgres, minio, deepseek-harness。
- secret 通过 env file/secret manager 注入，不 bake 到 image。
- dev 可暴露调试端口；prod 只暴露必要 Web 入口。

- [ ] 写 Compose config lint/smoke 脚本，当前应失败。
- [ ] Build images。
- [ ] `docker compose ... config` 和本地 smoke。
- [ ] 确认 worker/harness restart policy 不造成重复正式状态。
- [ ] Commit。

### Task 3: CI 工作流

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/build-images.yml`
- Create: `scripts/check-secrets-in-output.ts`

**Interfaces:**
- PR 必跑：install lockfile、typecheck、lint、unit/integration、build；acceptance 可按标签/夜间 + phase PR gate。
- main 成功后构建 immutable SHA-tagged images。
- CI 不运行需要真实付费模型的测试，真实 Harness smoke 使用受保护环境手动运行。

- [ ] 写本地 workflow/static test 或 actionlint gate。
- [ ] 添加 secret-output scanner fixture，确认能发现伪 token。
- [ ] 实现 workflows。
- [ ] 验证本地 gates。
- [ ] Commit。

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
- restore 必须指定新/隔离目标，脚本默认拒绝覆盖 production。
- migrations 为单向 forward migration；回退通过应用版本 + 兼容 migration 策略，不自动 destructive down migration。

- [ ] 写隔离 restore 失败测试。
- [ ] 创建含最小项目数据的测试 DB/对象。
- [ ] backup→destroy test DB→restore→验证项目/事件/资产。
- [ ] 记录命令和恢复 RTO 实测。
- [ ] Commit。

### Task 5: 预发布与正式部署工作流

**Files:**
- Create: `.github/workflows/deploy-staging.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `infra/deploy/deploy-compose.sh`
- Create: `infra/deploy/ROLLBACK.md`
- Create: `infra/deploy/README.md`

**Interfaces:**
- staging 自动/手动从 main SHA image 部署。
- production 只接受已经在 staging 验收的同一 image SHA，并使用 GitHub Environment manual approval。
- rollback 使用上一已知良好 image SHA。

- [ ] 写部署脚本 dry-run 测试。
- [ ] 实现 staging deployment。
- [ ] 加 production environment gate。
- [ ] 模拟 smoke fail 并验证 rollback 命令。
- [ ] Commit。

### Task 6: 第一版完整自动化验收场景

**Files:**
- Create: `tests/acceptance/full-research-lifecycle.spec.ts`
- Create: `tests/acceptance/failure-retry.spec.ts`
- Create: `tests/acceptance/webhook-idempotency.spec.ts`
- Create: `tests/acceptance/asset-promotion.spec.ts`

**Interfaces:**
- `full-research-lifecycle.spec.ts` 逐项覆盖设计规格第 31.1 的 20 步核心科研闭环。
- FakeHarness/FakeGitHub 用于 deterministic CI；受保护 staging 另跑真实 Harness/GitHub smoke。

- [ ] 先写四个失败 E2E。
- [ ] 运行确认失败点对应缺少的系统 wiring，不新增规格外功能。
- [ ] 修复 wiring 直至全通过。
- [ ] Run: `pnpm test && pnpm playwright test tests/acceptance`，Expected: PASS。
- [ ] Commit。

### Task 7: 人工验收手册与发布候选

**Files:**
- Create: `docs/acceptance/v1-manual-acceptance.md`
- Create: `docs/operations/v1-runbook.md`
- Create: `CHANGELOG.md`

**Interfaces:**
- 手册必须覆盖：六人登录、五项目、多维状态、研究分支、重大审批、Agent Run、真实编码子代理、GitHub CI 真实性、资产升级、故障恢复。
- 每项记录“执行者、时间、环境、结果、证据链接”。

- [ ] 在 staging 按手册执行完整验收。
- [ ] 所有失败形成 GitHub issue 并阻止 release。
- [ ] 修复后重新执行受影响步骤。
- [ ] 创建 release candidate tag 前运行 `pnpm typecheck && pnpm lint && pnpm test && pnpm build`。
- [ ] Commit: `git commit -am "docs: add v1 acceptance and operations runbook"`。

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
