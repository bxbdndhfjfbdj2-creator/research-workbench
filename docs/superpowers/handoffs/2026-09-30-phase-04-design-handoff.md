# Research Workbench 交接记录：Phase 4A 书面规格阶段

- 日期：2026-09-30
- 当前产品主线：AI-native Research Workbench
- 当前实施状态：Phase 1/2 已合并；Phase 3 已验证并建立 Draft PR #4；Phase 4A 只完成书面设计规格，尚未写实施计划或产品代码。
- 当前设计分支：`phase/04-research-operations`
- 基线：Phase 3 head `1a95b548f4a87eaf908df9ce46db1dd7de02e8d3`
- Phase 3 Draft PR：#4 `feat: add phase three Agent runtime`
- Phase 3 真实 provider smoke：产品负责人明确允许暂时跳过；不视为伪造 PASS，也不改变 AI-native 主线。

## 新路线

Phase 4 被拆成：

- 4A：Files & Provenance —— 当前规格已写。
- 4B：Human/Hybrid ResearchTask & Review —— 尚未进入书面规格。
- 4C：Progress Projections & Cockpit —— 尚未进入书面规格。

之后再推进 GitHub Engineering Truth、Knowledge Foundation、Ontology/Reasoning 和 Deployment Hardening。

## Phase 4A 关键设计决定

- Uppy + tus/tusd：可恢复上传。
- S3-compatible storage port：业务层不绑定具体存储；自托管优先评估 SeaweedFS，MinIO 作为兼容选项而非硬依赖。
- ClamAV：quarantine 后恶意文件扫描。
- Apache Tika：MIME/通用元数据和 fallback text extraction。
- Docling：富文档结构解析。
- GROBID：未来学术 PDF 可插拔解析器。
- PDF.js：PDF preview。
- PostgreSQL FTS；未来 pgvector。
- Future Ontology：优先 Apache Jena/Fuseki 或 Oxigraph，不自研 RDF/OWL/SPARQL/SHACL 引擎。
- Workbench 自研只负责科研语义、File/FileVersion/FileLink、权限、provenance、事件、治理和 orchestration。

## 当前 Superpowers 闸门

这是 architectural path。

已经完成：

1. 项目上下文探索。
2. 用户批准方向：AI-native 主线不变，真实 Agent API 暂不接；先完善人工可操作研究工作台。
3. 用户增加约束：知识库、自动探索/分析/决策和 Ontology 要纳入未来架构；优先采用成熟开源工具。
4. 正式 Phase 4A 书面规格已提交。

**当前必须停止在“用户审阅书面规格”闸门。**

下一步只有在用户明确批准
`docs/superpowers/specs/2026-09-30-phase-04a-files-provenance-design.md`
后，才能调用 `superpowers:writing-plans` 创建 4A implementation plan。

不得因为用户之前批准过概念方向就跳过书面规格审阅。

## 恢复工作时先做

1. 读取本交接记录。
2. 读取 Phase 4A 书面规格。
3. 查看 GitHub 分支头和 PR #4 状态，禁止根据聊天停点猜状态。
4. 如果用户已经明确批准 4A 书面规格，调用 writing-plans；否则只处理规格修改/审阅反馈。
5. 不实施 4B/4C，除非 4A 结束并重新走对应设计闸门。

## 实施阶段的固定策略

- TDD：先 RED，再 GREEN。
- 小任务只等必要测试/类型检查；完整 Playwright 留到关键节点和阶段末。
- 每次中断恢复先读取真实 branch head 与 Actions。
- 失败只分析当前失败步骤，不重做已通过层。
- 最终完成声明必须基于最终树 fresh full CI。
- 阶段结束写 `docs/superpowers/reviews/` 验证记录。
- 不自动合并 Draft PR。
