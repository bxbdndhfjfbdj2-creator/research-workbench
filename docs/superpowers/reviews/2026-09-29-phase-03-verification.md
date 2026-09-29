# 第三阶段实现与验证记录

- 分支：`phase/03-agent-runtime`
- 基线：`main` @ `f406c9cb35e655e884739efc9aecc98d607a110d`
- 阶段：Agent 执行控制面与 DeepSeek Harness 集成
- 状态：代码实现、阶段级独立审查与无凭据自动化验收通过；真实 Harness/Codex/Claude provider smoke 待外部凭据环境执行；等待人工验收
- 阶段审查最终修复提交：`5459264f48fa49188a35057dc86f01930037fee5`
- 最终自动化验证：GitHub Actions run `36591657248`

## 已实现范围

第三阶段在前两阶段科研事实与科学治理底座之上加入受控 Agent 执行面：

- `AgentTask` 表达科研执行意图；`AgentRun` 表达一次独立执行尝试，失败重试创建新 Run，旧 Run 永久保留。
- `AgentContextSnapshot` 冻结研究问题、理论、设计、数据、Git 基线、技能版本、Harness 版本/profile、模型路由、sandbox 和 allowlist。
- `HarnessSessionReference` 追加式记录 Workbench Run 与 Harness Session 的映射和 generation。
- Outbox 驱动 Agent dispatch；同一 Run 使用 compare-and-swap 保证重复投递不会重复启动。
- `SdkHarnessAdapter` 只依赖 DeepSeek Harness SDK 稳定边界；Workbench 业务层不 import Harness 内部 core 包。
- Harness source/package 版本固定，运行 profile 对工具、子代理与 sandbox 做每 Run 收敛。
- 人工问答与一次性执行审批通过 Workbench bridge plugin 回桥；未获得人工答案时 fail closed。
- Agent 输出只允许生成可见摘要、工具事实、artifact refs、GitHub hints、ResearchResult 和 ScientificDecision proposal，不保存隐藏推理。
- 代码型 ResearchResult 必须带不可变 Git commit locator；AI 科学变更只能形成 proposed ScientificDecision，不能直接改变正式科研指针。
- Codex / Claude Code provider preset 均已配置为显式 opt-in；默认不使用 danger-full-access 或 bypass permission。
- “智能工作”页面区分 AgentTask 与各次 Run，展示冻结上下文、Harness Session、等待人工输入、执行产物、失败重试与结果。
- 研究者创建新智能工作后可显式“授权并排队”，由 application service 写入持久 Outbox；浏览器不会直接调用 Harness。
- worker 新增 production composition factory，将数据库、SdkHarnessAdapter、Session reference、短期 callback credential 与持久执行上下文组合为可部署边界；真正的进程管理仍留给第六阶段部署。

## 阶段级可靠性与安全审查

本阶段在原 Task 1–8 完成后又进行了一轮按不变量而非实现顺序的审查，并修复了以下重要问题。

### 1. Harness RC 依赖安装与供应链策略

DeepSeek Harness `0.2.0-rc.1` 发布窗口触发 pnpm minimum-release-age，且 subprocess runtime 需要少量原生安装脚本。修复没有全局关闭保护：

- minimum-release-age 仅对 `@deepseek-ai/*` 命名空间例外；
- frozen lockfile 固定实际依赖图；
- 仅显式允许 `@deepseek-ai/dsh-subprocess-local`、`node-pty`、`koffi` 的必要构建脚本；
- `@google/genai` 安装脚本明确拒绝；
- Harness 版本仍由 `infra/harness/version.env` 固定，升级必须经过依赖 diff 与 review。

### 2. completed output 原子落库与重放身份

早期实现先把 Run 标为“完成”，随后分别写 artifacts、ResearchResult 和 ScientificDecision。若中途进程失败可能出现“Run 已完成但科研事实只落了一半”。

修复后：

- completed output 的 artifacts、ResearchResult、ScientificDecision proposal、ingestion ledger、`Run=完成` 与 `AGENT_RUN_COMPLETED` 在同一数据库事务提交；
- 任一科学 proposal 或结果校验失败时全部回滚，Run 改为 `失败 / INVALID_AGENT_OUTPUT`；
- `agent_run_ingestions` 记录不可变 result digest；
- 同一 Run 重放完全相同的结果返回同一 IDs，不重复生成事实；
- 同一 Run 若尝试换内容重放则明确拒绝。

### 3. callback credential 的最小秘密边界

callback token 采用短期签名 credential，并与具体 Run 和数据库 credential reference 绑定。最终审查进一步收紧：

- token 值不进入 `AgentRun`、`AgentContextSnapshot`、ResearchEvent、普通错误摘要或 Agent prompt；
- token 不进入 Cordis plugin config；
- worker 只把 token 注入 Harness 子进程环境；
- bridge plugin 在运行时直接读取 `RW_AGENT_CALLBACK_TOKEN`，缺失时 fail closed；
- production composition 默认 callback TTL 为 15 分钟，且禁止配置超过 1 小时。

### 4. 执行链可达性

早期 UI 能创建 AgentTask/Run，但新 Run 会停留在“已提议”。最终收口增加：

- Run 卡片上的“授权并排队”动作；
- 服务端再次校验 Run 与 project 归属；
- 调用正式 `queueAgentRun()` service；
- `Run=排队` 与 `agent.run.dispatch` Outbox 在同一事务产生；
- acceptance 环境故意不启动真实 worker，因此可独立证明 Web → application → durable queue，而不误触外部模型。

## 自动化验证

最终 CI 在冻结锁文件下执行并通过：

- `pnpm install --frozen-lockfile`
- 25 个 Vitest 测试文件全部通过
- 86 个非浏览器测试中 84 个通过、2 个按环境条件明确跳过
- TypeScript 类型检查通过
- lint 闸门通过
- Next.js production build 通过
- 11 个 Chromium Playwright 端到端场景全部通过

两个跳过项分别是：

1. 真实 DeepSeek Harness SDK smoke：当前 CI 未提供 `DEEPSEEK_API_KEY + RW_DSH_BIN`。
2. 真实 Codex/Claude Code 子代理 smoke：当前 CI 未提供 `RW_CODE_SUBAGENT + RW_DSH_BIN` 以及相应 provider 凭据。

跳过逻辑只在必要环境变量缺失时生效；一旦显式配置 provider/runtime，测试失败会真实失败，不能假成功。

## 浏览器验收覆盖

第三阶段新增/扩展的浏览器场景覆盖：

- 项目智能工作页可查看 AgentTask 和所有 Run attempts。
- 失败 Run 保留“尝试 1”，重新运行后创建独立“尝试 2”。
- 新建智能工作时研究者只填写科研目标与期望输出，不选择具体模型。
- 新 Run 从“已提议”经人工“授权并排队”进入“排队”。
- 等待人工输入的 Run 同时展示问题、Harness Session 和冻结上下文。
- 已完成 Run 展示可见执行摘要、artifact refs 和 ResearchResult。
- 团队级智能工作中心可查看多个项目的受控执行状态。
- 第一、二阶段原有登录、研究网络、证据结果、科学决策锁场景全部继续通过。

## 真实 provider smoke 的待执行步骤

### DeepSeek Harness SDK smoke

需要在可信测试环境提供：

- `RW_DSH_BIN`：固定版本 dsh 可执行入口
- `DEEPSEEK_API_KEY`
- 可选：`RW_DSH_HOME`、`RW_DSH_PROVIDER`、`RW_DSH_MODEL`

执行：

```bash
pnpm vitest run tests/integration/harness-sdk-smoke.test.ts
```

### Codex 子代理 smoke

需要：

- `RW_CODE_SUBAGENT=codex`
- `RW_DSH_BIN`
- 父 Harness 所需的 `DEEPSEEK_API_KEY`
- Codex provider 所需的 `OPENAI_API_KEY` 或测试环境已授权的 `CODEX_HOME`

执行：

```bash
RW_CODE_SUBAGENT=codex pnpm vitest run tests/integration/harness-code-subagent-smoke.test.ts
```

### Claude Code 子代理 smoke

需要：

- `RW_CODE_SUBAGENT=claude-code`
- `RW_DSH_BIN`
- 父 Harness 所需的 `DEEPSEEK_API_KEY`
- `ANTHROPIC_API_KEY`

执行：

```bash
RW_CODE_SUBAGENT=claude-code pnpm vitest run tests/integration/harness-code-subagent-smoke.test.ts
```

第三阶段人工验收清单中的“至少 Codex/Claude Code 一条真实子代理链通过测试环境验收”在上述任一真实子代理 smoke PASS 前保持未完成。

## 已知限制与后续责任边界

- 当前 bridge 在 Harness/worker 进程存活时通过持久 internal API 轮询实现人工等待与继续；Web 服务重启不会丢失 pending interaction。
- 如果 worker/Harness 进程恰好在长时间人工等待期间丢失，pending interaction 和 Harness Session reference 仍保留，但“自动重建运行时并恢复正在等待的会话”需要运行时租约/恢复调度；该部署可靠性能力留到第六阶段。
- 第三阶段不验证 GitHub Branch/PR/CI 工程事实；代码型结果当前仍使用不可变 repository + commit locator，第四阶段将补 GitHubReference、Webhook 与 CI 真实性。
- 本阶段不启动云部署、Docker Compose 生产编排、备份恢复或系统状态页；这些属于第六阶段。

## 执行中断复盘

本阶段此前多次出现“代码已经推进，但长时间没有形成阶段完成结论”。主要原因不是单一编码失败，而是三类因素叠加：

1. 每个小修复都等待完整 CI/Playwright，造成大量空转时间；
2. Harness RC 首次接入暴露 pnpm release-age 与 native build 两道供应链策略，需要逐层诊断；
3. 中断后若只看最后一条消息而不读取分支头/Actions，会误以为前面任务没有完成。

本轮改用以下策略后稳定收口：

- 每次恢复先读取真实分支头与最近 Actions，不根据聊天停点猜状态；
- RED/GREEN 阶段只跟踪必要测试和类型检查，完整 Playwright 留给 Task/阶段关键节点；
- 失败只读取当前失败步骤日志，不重复分析已经通过的层；
- 在阶段功能全绿后，再做一次按安全/可靠性不变量的独立审查；
- 最终完成声明必须以最终树上的 fresh full CI 为证据。

## 进入人工验收前的结论

除需要真实外部凭据的 provider smoke 外，第三阶段代码、数据库不变量、Web 控制面、Harness 适配边界和自动化质量闸门已经形成可复现验证证据。

进入第四阶段之前仍需：

1. 在可信测试环境跑通至少一条 Codex 或 Claude Code 真实子代理 smoke。
2. 由项目负责人完成人工验收，重点确认智能工作创建/排队、失败重试、人工等待、冻结上下文和“AI 只能提议科学变化”的使用语义。
3. 按路线图决定是否为第三阶段创建 PR 到 `main`；未完成人工验收前不合并。
