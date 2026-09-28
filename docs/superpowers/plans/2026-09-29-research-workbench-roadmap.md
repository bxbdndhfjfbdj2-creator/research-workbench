# Research Workbench 第一版总实施路线图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不扩大第一版范围的前提下，把已批准的设计规格实现为可供固定 6 人团队使用、可审计、可分阶段验收并可部署到私有云服务器的 AI 原生科研协同工作台。

**Architecture:** 使用“模块化单体 Web + 独立 Worker + PostgreSQL + S3 兼容对象存储 + 独立 DeepSeek Harness Runtime”的结构。Research Workbench 负责科研事实、权限、审批、可靠任务与跨项目资产；DeepSeek Harness 通过适配层负责 Agent 执行；GitHub 负责代码与工程事实。六个阶段均通过独立 PR 和质量闸门交付，上一阶段未通过自动测试与人工验收时不得进入下一阶段。

**Tech Stack:** TypeScript；Node.js >= 22.19；pnpm 11.7；Next.js + React；PostgreSQL；Drizzle ORM；Better Auth；pg-boss；Vitest；Playwright；S3 兼容对象存储（开发/预发布使用 MinIO）；DeepSeek Harness TypeScript SDK；Octokit；Docker Compose；GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## Global Constraints

- 第一版固定 6 名成员、单团队、私有部署，不开放公众注册。
- 数据模型不得把研究项目数量写死为 5。
- Research Workbench、DeepSeek Harness、GitHub 分别是科研事实源、AI 执行事实源、工程事实源。
- 智能代理不得直接修改正式科研状态；重大科学变更必须由项目主理人提议并由总负责人批准。
- 正式版本、研究结果和科研事件不得原地覆盖或静默删除。
- Workbench 本身不提供任意代码执行；代码执行通过 Harness/外部编码代理完成。
- Harness 接入必须集中在适配层，业务模块不得直接依赖 Harness 内部包。
- 外部副作用必须经过事务发件箱；外部事件必须先进入可靠收件箱并幂等处理。
- GitHub `main` 不允许智能代理直接写入；实现阶段以功能/阶段分支、PR、CI、Review 为准。
- 凭据、模型密钥和 GitHub 私钥不得进入科研事件、上下文快照或普通日志。
- 第一版不引入 Kubernetes、Kafka、多租户、计费、公共注册、自研模型或自研通用编码代理。

## Review Focus

1. **事务提交成功但外部调用前进程崩溃**：正式状态保持已提交，Outbox 事件仍可在重启后重试；由阶段一的 Outbox 集成测试固定。
2. **同一 GitHub Webhook 或任务被重复投递**：只能产生一次业务状态变化；由阶段一/四的收件箱与 GitHub 幂等测试固定。
3. **AI 或普通成员绕过科学决策锁**：数据库正式指针必须保持不变；由阶段二审批状态机测试固定。
4. **Harness/GitHub 暂时不可用**：AgentTask/工程事项保留可重试状态，不伪造完成；由阶段三/四故障测试固定。
5. **凭据或秘密意外进入事件、日志或 Agent 快照**：序列化与日志层必须拦截；由阶段一安全序列化测试与阶段六泄密扫描固定。

---

## 一、锁定的代码结构

```text
research-workbench/
├── apps/
│   ├── web/                       # Next.js Web、Route Handlers、Server UI
│   └── worker/                    # Outbox、pg-boss、Agent/GitHub 异步 Worker
├── packages/
│   ├── config/                    # 环境变量验证、运行配置
│   ├── domain/                    # 纯领域类型、不变量、状态机
│   ├── db/                        # Drizzle schema、migration、transaction/repository
│   ├── application/               # 用例服务、授权、事务编排
│   ├── queue/                     # Outbox/Inbox/pg-boss 协作
│   ├── harness-adapter/           # Workbench ↔ Harness 稳定边界
│   ├── harness-bridge-plugin/     # Harness 外置插件：人工问答/审批回桥
│   ├── github-adapter/            # GitHub App、Webhook、工程状态
│   ├── storage/                   # S3/MinIO 文件对象接口
│   ├── ui/                        # 共享 UI primitives
│   └── observability/             # 结构化日志、指标、trace helper
├── tests/
│   ├── integration/               # Postgres/队列/适配器集成测试
│   └── acceptance/                # Playwright + 核心科研闭环
├── infra/
│   ├── docker/                    # dev/staging/prod compose；worker 镜像内含 pinned dsh runtime
│   ├── harness/                   # Workbench Harness profile/patch 与固定版本元数据
│   └── deploy/                    # 云服务器部署脚本与运行手册
├── scripts/                       # bootstrap、seed、backup、smoke
└── .github/workflows/             # CI、镜像、预发布/正式发布
```

依赖方向固定为：

```text
apps/* -> application -> domain
                  \-> db
worker -> queue -> application
application -> harness-adapter/github-adapter/storage (ports only)
integrations -> external systems
domain -> no framework / no DB / no Harness / no GitHub
```

## 二、六阶段交付顺序

| 阶段 | 独立交付物 | 必须通过的闸门 |
|---|---|---|
| 第一阶段 | 基础工作台、身份、项目、多维状态、事件账本、Outbox/Inbox | 6 人可登录；项目可创建；事务/事件/幂等测试通过 |
| 第二阶段 | 研究网络、版本、科学决策锁、结果证据 | 重大变更无法绕过审批；失败分支和旧版本保留 |
| 第三阶段 | AgentTask/Run、上下文快照、Harness SDK、人工暂停 | 真实 Harness 测试任务可运行；故障可重试；AI 无法直接变更正式状态 |
| 第四阶段 | GitHub App、Webhook、Branch/Commit/PR/CI 语义映射 | 无 Commit/CI 不能标记工程验证完成；Webhook 幂等 |
| 第五阶段 | 共享资产、对象存储、组合/成员驾驶舱、注意力流 | 跨项目资产可升级/追踪；首页只突出四类主动打扰事件 |
| 第六阶段 | 安全加固、可观测性、Worker 内置 pinned Harness runtime、Docker Compose、预发布/正式部署、全量验收 | 自动测试 + 预发布人工验收 + 正式烟雾测试全部通过 |

## 三、Git 与审查策略

每个阶段使用独立分支：

```text
phase/01-foundation
phase/02-scientific-governance
phase/03-agent-runtime
phase/04-github-integration
phase/05-assets-dashboards
phase/06-deployment-hardening
```

阶段内每个 Task 至少一个有意义的 commit；阶段结束开一个 PR 到 `main`。PR 只有在以下条件同时满足时可合并：

- 阶段计划的所有 checkbox 完成。
- 阶段指定测试命令通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。
- 代码审查没有未解决的高严重度问题。
- 对应阶段人工验收清单完成。
- PR 描述记录本阶段新增的科研业务不变量和已知限制。

## 四、测试分层

- **领域单元测试**：状态机、不变量、权限和审批规则。
- **数据库集成测试**：使用真实 PostgreSQL，验证事务、唯一约束、不可变记录、Outbox/Inbox。
- **适配器契约测试**：Harness、GitHub、S3 均先以 fake/contract 测试固定边界。
- **外部集成烟雾测试**：有真实凭据时运行 Harness/GitHub 测试；无凭据时明确 skip，不伪造成功。
- **浏览器端到端测试**：Playwright 覆盖登录、项目、审批、智能工作、资产升级。
- **部署烟雾测试**：健康检查、数据库迁移、Worker、Harness、对象存储、GitHub webhook endpoint。

## 五、阶段推进规则

每个阶段完成后停止实施，向项目负责人提供：

1. PR 链接与 commit 范围。
2. 自动测试结果。
3. 人工验收步骤和结果。
4. 新增/变化的数据模型。
5. 尚未解决的风险。
6. 下一阶段是否可以进入的建议。

只有明确批准当前阶段，才开始下一阶段。

## 六、执行顺序

- 第一阶段计划：`2026-09-29-phase-01-foundation.md`
- 第二阶段计划：`2026-09-29-phase-02-scientific-governance.md`
- 第三阶段计划：`2026-09-29-phase-03-agent-runtime.md`
- 第四阶段计划：`2026-09-29-phase-04-github-integration.md`
- 第五阶段计划：`2026-09-29-phase-05-assets-dashboards.md`
- 第六阶段计划：`2026-09-29-phase-06-deployment-hardening.md`

阶段计划共同继承本文的 Global Constraints 和 Git/测试规则；阶段计划中的 Interfaces 块是相邻 Task 之间唯一允许依赖的稳定接口说明。
