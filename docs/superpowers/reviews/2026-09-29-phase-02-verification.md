# 第二阶段实现与验证记录

- 分支：`phase/02-scientific-governance`
- 基线：`phase/01-foundation` 已验证头提交 `91fc7a149aa5ea7f339df88f078c4951c04dea48`
- 阶段：研究网络、证据与科学治理
- 状态：自动化实现、独立审查和验收通过；等待人工验收
- 阶段审查修复提交：`b9340747ac2706fd9d1f23e05615a5fe023eeaec`
- 审查修复后 CI：GitHub Actions run `36549580205`

## 已实现范围

第二阶段在第一阶段科研事实底座之上加入非线性研究网络和科学治理能力：

- ResearchNode 与不可变 ResearchNodeRevision 分离。
- ResearchEdge 允许有向环，支持“回到”等非线性研究关系。
- ResearchBranch 支持创建、关闭和重新开启；关闭原因与生命周期历史保留。
- OfficialRevision 作为正式研究状态指针；旧正式版本进入追加式历史。
- ScientificDecision 区分一般与重大决策。
- 一般决策由项目主理人完成审批；重大决策必须先由项目主理人批准，再由总负责人最终批准。
- AI actor 可以提出候选科学变化，但不能执行任何人类审批。
- ResearchResult 是不可变事实记录；代码型结果必须绑定不可变 Git commit locator。
- 新结果通过 supersession 关系替代旧结果，不覆盖旧结果。
- 研究结果可以追加“支持 / 挑战 / 检验”等证据关系。
- Web 工作台新增研究网络、证据与结果、项目科学决策页与全局科学决策中心。

## 科学决策锁

重大正式状态包括核心研究问题、正式理论、主测量指标、主样本、主数据版本、识别策略、主模型、探索结果升级为正式结果和论文核心主张。

正式 revision 指针只能由已批准且目标匹配的 ScientificDecision 支撑。数据库触发器拒绝缺少匹配已批准决策的直接 pointer 写入。项目主理人对重大决策的第一层批准只把状态推进到 `awaiting_lead`，不改变正式指针；总负责人最终批准后，pointer、正式版本历史、ResearchEvent 与 Outbox 在同一事务中提交。

并发最终审批通过行锁串行化：两个并发请求中只有一个可以合法推进，且只产生一次 `OFFICIAL_REVISION_CHANGED`。

## 追加式历史与不可变性

阶段级独立审查额外加固了以下边界：

- `research_node_revisions` 数据库级禁止 UPDATE / DELETE。
- `research_results` 数据库级禁止 UPDATE / DELETE。
- `research_branches` 允许状态更新以支持关闭/重开，但数据库级禁止 DELETE。
- `research_branch_history` 数据库级禁止 UPDATE / DELETE。
- `official_revision_history` 数据库级禁止 UPDATE / DELETE。
- `decision_reviews`、`research_result_supersessions`、`research_result_evidence_links` 同样按追加式历史锁定。
- 正式 pointer 的内部 mutation 已从普通 `official-revision` API 移除，只存在于决策状态机内部实现。

## 自动化验证

审查修复后的 CI 使用冻结锁文件执行：

- `pnpm install --frozen-lockfile`
- 15 个 Vitest 测试文件，共 49 个测试，全部通过
- TypeScript 类型检查
- lint 闸门
- Next.js production build
- 7 个 Chromium Playwright 端到端场景

浏览器验收覆盖第一阶段原有 3 条场景，以及第二阶段新增：

- 竞争机制、挑战关系、候选/已否定状态均可查看。
- 关闭的失败分支仍显示，并保留终止原因；没有“删除失败路线”按钮。
- 证据与结果页显示数据版本、运行引用、Git commit 与结果—节点证据关系。
- AI 重大变更提议先由项目主理人批准，此时正式指针仍是旧 revision。
- 总负责人最终批准后正式指针切换到新 revision。
- 旧正式 revision 仍在历史正式版本中可查看。
- 无审批权限的普通成员不会获得批准按钮；真正 mutation 仍由服务端状态机再次授权。

## 阶段边界

本阶段没有实现 AgentTask / AgentRun、DeepSeek Harness、GitHub Webhook 与工程事实、共享科研资产、自动知识抽取或第三阶段 Agent 控制面。代码型结果暂时保存不可变 `repositoryFullName + commit SHA`，待后续 GitHubReference 阶段再进行外部验证和引用关联。

## 进入人工验收前的结论

自动化质量闸门已通过。人工验收应重点确认：非线性研究网络是否符合科研使用习惯；失败路线保留是否清楚；重大科学变更的两级审批是否符合团队责任边界；旧正式版本与旧结果是否容易追溯；总负责人和项目主理人的决策中心是否提供足够上下文。人工验收通过前，不合并第二阶段，也不进入下一阶段的正式合并流程。
