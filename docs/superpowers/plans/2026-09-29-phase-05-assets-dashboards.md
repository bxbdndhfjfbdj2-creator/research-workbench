# 第五阶段：共享科研资产、注意力系统与团队驾驶舱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现版本化共享科研资产、跨项目使用关系和人工升级，并完成总负责人/研究成员两类注意力驱动首页、协作简报与受控通知。

**Architecture:** 资产元数据存 PostgreSQL，大文件/附件走 StoragePort→S3/MinIO；资产成熟度只能经人工 promotion service 改变。AttentionItem 是由 ResearchEvent/Decision/Agent/GitHub 状态派生的可查询投影，只允许四类主动打扰。

**Tech Stack:** PostgreSQL；S3 compatible storage；MinIO；AWS SDK v3；Next.js；Vitest；Playwright。

**Spec:** `docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## Global Constraints

- 资产版本不可覆盖。
- 团队级/发布级 promotion 必须人类确认。
- AssetUsage 必须定位具体版本，不允许“latest”。
- 主动通知只允许：科学决策、研究异常、协作请求、时限事件。
- 首页优先“需要人判断”，不做普通任务流水账。

## Review Focus

1. 已被三个项目使用的资产版本被替换：旧 usage 仍指旧版本。
2. AI 推荐资产升级：只能形成候选，不改变 maturity。
3. 对象存储暂时不可用：元数据 transaction 不应错误标记文件已上传。
4. 同一事件反复投影注意力：AttentionItem 去重。
5. 普通 Agent 完成事件：不产生主动通知。

---

### Task 1: 建立 ResearchAsset/Version/Usage/Promotion 模型

**Files:**
- Create: `packages/db/src/schema/research-asset.ts`
- Create: `packages/domain/src/research-asset.ts`
- Create: `packages/application/src/assets/asset-service.ts`
- Create: `packages/application/src/assets/promotion-service.ts`
- Test: `tests/integration/research-assets.test.ts`

**Interfaces:**
- `createAsset(type, metadata, actor)`
- `createAssetVersion(assetId, versionInput, actor)`
- `recordAssetUsage(projectId, assetVersionId, purpose, actor)`
- `proposeAssetPromotion(assetId, targetMaturity, actor)`
- `approveAssetPromotion(proposalId, humanActor)`

- [ ] 写失败测试：版本不可覆盖、usage 绑定具体版本、agent promotion 不直接改变 maturity。
- [ ] 运行失败。
- [ ] 实现 model/services。
- [ ] 验证 PASS。
- [ ] Commit。

### Task 2: 实现 S3/MinIO StoragePort

**Files:**
- Create: `packages/storage/src/port.ts`
- Create: `packages/storage/src/s3-storage.ts`
- Create: `packages/storage/src/fake-storage.ts`
- Test: `packages/storage/src/contract.test.ts`

**Interfaces:**
- `putObject(input): Promise<{objectKey, etag, size, contentType}>`
- `getSignedReadUrl(objectKey, ttlSeconds)`
- `deleteObject` 仅用于未发布临时对象；正式资产版本不通过 UI 删除。
- DB 保存 objectKey，不保存云端 secret。

- [ ] 写 contract 失败测试。
- [ ] 运行失败。
- [ ] 实现 Fake/S3 adapter。
- [ ] MinIO 集成测试。
- [ ] Commit。

### Task 3: 实现跨项目资产复用候选

**Files:**
- Create: `packages/application/src/assets/reuse-candidates.ts`
- Test: `packages/application/src/assets/reuse-candidates.test.ts`

**Interfaces:**
- `suggestReuseCandidates(input): Promise<ReuseCandidate[]>` 首版基于显式标签、类型、项目需求和 Agent proposal，不做复杂向量知识图谱。
- 候选只是 suggestion，不自动创建 AssetUsage。

- [ ] 写失败测试：三个项目相同 tag/type 产生候选；已使用项目不重复推荐。
- [ ] 运行失败。
- [ ] 实现 deterministic candidate engine。
- [ ] 验证 PASS。
- [ ] Commit。

### Task 4: 建立 AttentionItem 与四类通知投影

**Files:**
- Create: `packages/db/src/schema/attention.ts`
- Create: `packages/application/src/attention/projector.ts`
- Create: `packages/application/src/attention/queries.ts`
- Test: `tests/integration/attention-projection.test.ts`

**Interfaces:**
- `AttentionKind = 'scientific_decision'|'research_anomaly'|'collaboration_request'|'deadline'`。
- `projectAttentionFromEvent(event): Promise<void>` 幂等。
- 普通 `AGENT_RUN_COMPLETED` 不产生主动 notification。

- [ ] 写失败测试，覆盖四类允许和一类禁止。
- [ ] 运行失败。
- [ ] 实现 projector。
- [ ] 验证 PASS。
- [ ] Commit。

### Task 5: 实现总负责人研究组合驾驶舱

**Files:**
- Modify: `apps/web/app/(app)/portfolio/page.tsx`
- Create: `apps/web/src/components/portfolio/*`
- Test: `tests/acceptance/lead-dashboard.spec.ts`

**Interfaces:**
- 展示项目多维状态、重大变化、待 lead decision、风险、资产复用候选、人员协作请求、关键时限。
- 不显示机械任务总数作为主 KPI。

- [ ] 写 Playwright 失败测试。
- [ ] 运行失败。
- [ ] 实现 dashboard queries/UI。
- [ ] 验证 PASS。
- [ ] Commit。

### Task 6: 实现研究成员“我的研究控制台”和协作者简报

**Files:**
- Create: `apps/web/app/(app)/my-work/page.tsx`
- Create: `packages/application/src/briefs/collaborator-brief.ts`
- Create: `apps/web/src/components/member-dashboard/*`
- Test: `tests/acceptance/member-dashboard.spec.ts`

**Interfaces:**
- `buildCollaboratorBrief(projectId, memberId, since): Promise<CollaboratorBrief>`。
- Brief 包含正式变化、主结果变化、已关闭路线、待该成员挑战/复核事项。

- [ ] 写失败测试：成员只看到自己主导/协作项目；brief 不泄露无权项目。
- [ ] 运行失败。
- [ ] 实现 service/UI。
- [ ] 验证 PASS。
- [ ] Commit。

### Task 7: 实现共享资产界面、会议简报与阶段验收

**Files:**
- Create: `apps/web/app/(app)/assets/page.tsx`
- Create: `apps/web/app/(app)/assets/[assetId]/page.tsx`
- Create: `packages/application/src/briefs/portfolio-meeting-brief.ts`
- Test: `tests/acceptance/assets-attention.spec.ts`

**Interfaces:**
- 资产页面展示来源、成熟度、版本、使用项目、候选使用、维护者。
- Meeting brief 只列需要讨论的 attention，稳定推进项目进入“无需讨论”区。

- [ ] 写 E2E 失败测试：项目级资产→候选→人工批准→团队级；旧 usage 不变；dashboard 出现跨项目机会。
- [ ] 运行失败。
- [ ] 实现 UI/brief。
- [ ] 阶段验证：`pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance/lead-dashboard.spec.ts tests/acceptance/member-dashboard.spec.ts tests/acceptance/assets-attention.spec.ts`。
- [ ] Commit。

## 第五阶段人工验收

- 项目资产可版本化并追踪到具体使用项目。
- 资产升级必须人工确认。
- 总负责人首页突出真正需要判断的事项。
- 成员首页区分主导研究与交叉协作要求。
- 普通 Agent 运行完成不会造成通知轰炸。
