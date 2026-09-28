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
- `createAsset(type, metadata, actor): Promise<ResearchAsset>`
- `createAssetVersion(assetId, versionInput, actor): Promise<ResearchAssetVersion>`
- `recordAssetUsage(projectId, assetVersionId, purpose, actor): Promise<AssetUsage>`
- `proposeAssetPromotion(assetId, targetMaturity, actor): Promise<AssetPromotionProposal>`
- `approveAssetPromotion(proposalId, humanActor): Promise<ResearchAsset>`

- [ ] **Step 1: 写失败测试**

覆盖：版本不可覆盖；usage 绑定具体版本；agent promotion 不直接改变 maturity；团队级/发布级批准 actor 必须是 human。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/research-assets.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 model/services**

每次 version/promotion 写相应 ResearchEvent；旧 usage 不随新版本自动迁移。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/integration/research-assets.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/research-asset.ts packages/domain/src/research-asset.ts packages/application/src/assets tests/integration/research-assets.test.ts
git commit -m "feat: add versioned research assets"
```

### Task 2: 实现 S3/MinIO StoragePort

**Files:**
- Create: `packages/storage/src/port.ts`
- Create: `packages/storage/src/s3-storage.ts`
- Create: `packages/storage/src/fake-storage.ts`
- Test: `packages/storage/src/contract.test.ts`
- Test: `tests/integration/minio-storage.test.ts`

**Interfaces:**
- `putObject(input): Promise<{objectKey:string; etag:string; size:number; contentType:string}>`
- `getSignedReadUrl(objectKey, ttlSeconds): Promise<string>`
- `deleteTemporaryObject(objectKey): Promise<void>` 仅用于尚未成为正式资产版本的临时对象。
- DB 保存 objectKey，不保存云端 secret。

- [ ] **Step 1: 写失败 contract 测试**

Fake/S3 都必须实现相同接口；上传失败时不得返回 object metadata；signed URL 只对已有 objectKey 生成。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/storage/src/contract.test.ts tests/integration/minio-storage.test.ts`  
Expected: FAIL 或 MinIO 未启动时 integration 明确 SKIP。

- [ ] **Step 3: 实现 Fake/S3 adapter**

AWS SDK client config 从 secret-safe config 注入；禁止把 access secret 写日志。

- [ ] **Step 4: 运行 contract + MinIO 集成测试**

Run: `pnpm vitest run packages/storage/src/contract.test.ts tests/integration/minio-storage.test.ts`  
Expected: contract PASS；MinIO 环境存在时 integration PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/storage tests/integration/minio-storage.test.ts
git commit -m "feat: add S3-compatible research storage"
```

### Task 3: 实现跨项目资产复用候选

**Files:**
- Create: `packages/application/src/assets/reuse-candidates.ts`
- Test: `packages/application/src/assets/reuse-candidates.test.ts`

**Interfaces:**
- `suggestReuseCandidates(input): Promise<ReuseCandidate[]>` 首版基于显式标签、类型、项目需求和 Agent proposal，不做复杂向量知识图谱。
- 候选只是 suggestion，不自动创建 AssetUsage。

- [ ] **Step 1: 写失败测试**

三个项目相同 tag/type 产生候选；已使用该版本的项目不重复推荐；AI suggestion 不自动建立 usage。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/application/src/assets/reuse-candidates.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 deterministic candidate engine**

排序依据只使用显式信号，保证测试可重复。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/application/src/assets/reuse-candidates.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/assets/reuse-candidates.ts packages/application/src/assets/reuse-candidates.test.ts
git commit -m "feat: suggest cross-project asset reuse"
```

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

- [ ] **Step 1: 写失败测试**

覆盖四类允许 attention、重复 event 去重，以及普通 Agent 完成不产生主动通知。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/attention-projection.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 projector/queries**

AttentionItem 保存 source event id 作为幂等键；查询按用户授权和项目角色过滤。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/integration/attention-projection.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/attention.ts packages/application/src/attention tests/integration/attention-projection.test.ts
git commit -m "feat: add attention projection"
```

### Task 5: 实现总负责人研究组合驾驶舱

**Files:**
- Modify: `apps/web/app/(app)/portfolio/page.tsx`
- Create: `apps/web/src/components/portfolio/*`
- Create: `packages/application/src/portfolio/lead-dashboard-query.ts`
- Test: `tests/acceptance/lead-dashboard.spec.ts`

**Interfaces:**
- 展示项目多维状态、重大变化、待 lead decision、风险、资产复用候选、人员协作请求、关键时限。
- 不显示机械任务总数作为主 KPI。

- [ ] **Step 1: 写 Playwright 失败测试**

构造五个项目，其中两个需要决策、一个有跨项目资产候选；断言首页优先展示需要人判断的内容。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm playwright test tests/acceptance/lead-dashboard.spec.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 dashboard query/UI**

风险和状态来自已有领域数据，不在 UI 内推断科研含义。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm playwright test tests/acceptance/lead-dashboard.spec.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(app)/portfolio/page.tsx apps/web/src/components/portfolio packages/application/src/portfolio/lead-dashboard-query.ts tests/acceptance/lead-dashboard.spec.ts
git commit -m "feat: add lead research portfolio dashboard"
```

### Task 6: 实现研究成员“我的研究控制台”和协作者简报

**Files:**
- Create: `apps/web/app/(app)/my-work/page.tsx`
- Create: `packages/application/src/briefs/collaborator-brief.ts`
- Create: `apps/web/src/components/member-dashboard/*`
- Test: `tests/acceptance/member-dashboard.spec.ts`

**Interfaces:**
- `buildCollaboratorBrief(projectId, memberId, since): Promise<CollaboratorBrief>`。
- Brief 包含正式变化、主结果变化、已关闭路线、待该成员挑战/复核事项。

- [ ] **Step 1: 写失败测试**

成员只看到自己主导/协作项目；brief 不泄露无权项目；主导项目和协作项目明确分区。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm playwright test tests/acceptance/member-dashboard.spec.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 service/UI**

Brief 基于 ResearchEvent + authorized project scope 生成，不读取其他项目。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm playwright test tests/acceptance/member-dashboard.spec.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(app)/my-work packages/application/src/briefs/collaborator-brief.ts apps/web/src/components/member-dashboard tests/acceptance/member-dashboard.spec.ts
git commit -m "feat: add member research dashboard"
```

### Task 7: 实现共享资产界面、会议简报与阶段验收

**Files:**
- Create: `apps/web/app/(app)/assets/page.tsx`
- Create: `apps/web/app/(app)/assets/[assetId]/page.tsx`
- Create: `packages/application/src/briefs/portfolio-meeting-brief.ts`
- Test: `tests/acceptance/assets-attention.spec.ts`

**Interfaces:**
- 资产页面展示来源、成熟度、版本、使用项目、候选使用、维护者。
- `buildPortfolioMeetingBrief(asOf): Promise<PortfolioMeetingBrief>` 只把需要讨论的 attention 放入讨论区，稳定推进项目进入“无需讨论”区。

- [ ] **Step 1: 写 E2E 失败测试**

项目级资产→候选→人工批准→团队级；旧 usage 不变；dashboard 出现跨项目机会；普通 Agent 完成不产生主动通知。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm playwright test tests/acceptance/assets-attention.spec.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 UI/brief**

不新增社区、评论流或通用通知中心等规格外功能。

- [ ] **Step 4: 阶段验证**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance/lead-dashboard.spec.ts tests/acceptance/member-dashboard.spec.ts tests/acceptance/assets-attention.spec.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(app)/assets packages/application/src/briefs/portfolio-meeting-brief.ts tests/acceptance/assets-attention.spec.ts
git commit -m "feat: deliver shared assets and attention dashboards"
```

## 第五阶段人工验收

- 项目资产可版本化并追踪到具体使用项目。
- 资产升级必须人工确认。
- 总负责人首页突出真正需要判断的事项。
- 成员首页区分主导研究与交叉协作要求。
- 普通 Agent 运行完成不会造成通知轰炸。
