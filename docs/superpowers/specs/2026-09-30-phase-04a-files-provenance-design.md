# Phase 4A：文件、版本与研究溯源基础设计规格

- 状态：待用户审阅
- 日期：2026-09-30
- 分支：`phase/04-research-operations`
- 基线：`phase/03-agent-runtime` @ `1a95b548f4a87eaf908df9ce46db1dd7de02e8d3`
- 产品方向：AI-native Research Workbench；本阶段不依赖真实 Agent Provider/API 才能使用
- 适用对象：固定 6 人、单团队、私有部署的社会科学研究团队
- 关联总规格：`docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## 1. 本阶段在总体路线中的位置

第三阶段已经把 AgentTask / AgentRun / ContextSnapshot / Harness 适配边界建立起来，但产品负责人明确决定暂时不配置真实 Agent Provider/API。产品主线不改变：Research Workbench 仍然以 AI-native 为目标，只是接下来的研究操作能力必须做到“即使全部由人执行，也天然生成未来 AI 能理解、检索、推理、提议和受控执行的结构化科研事实”。

Phase 4 不一次实现所有研究运营能力，而拆成三个可独立验收的子阶段：

1. **Phase 4A：文件、版本与研究溯源基础** —— 本规格覆盖。
2. **Phase 4B：人工/混合 ResearchTask 与统一审核** —— 后续单独规格与计划。
3. **Phase 4C：科研进展投影与组合驾驶舱** —— 后续单独规格与计划。

后续知识库、Ontology、自动探索/分析/决策均依赖 4A–4C 产生的稳定 ID、不可变版本、provenance、事件和审核记录。

## 2. 目标

4A 要把“上传一个附件”升级为“登记一个可版本化、可关联、可追溯、可供未来知识系统消费的研究资料对象”。

一个研究文件必须能够回答：

- 它属于哪个项目？
- 它是什么逻辑资料，而不是只叫什么文件名？
- 当前版本和历史版本分别是什么？
- 文件字节的不可变哈希是什么？
- 谁在何时通过什么方式引入？
- 是否通过恶意文件扫描？
- MIME 类型和基础元数据是什么？
- 解析是否成功，使用了哪个解析器和版本？
- 它与哪些 ResearchNode / ResearchTask / ResearchResult / ScientificDecision / 数据版本有关？
- 它是否是受限数据，只登记外部位置而不复制原始内容？
- 将来 Knowledge/Ontology 系统如何稳定引用其中的来源位置？

## 3. 非目标

本阶段不实现：

- 完整知识库、RAG、embedding 生成或知识图谱推理。
- Ontology 编辑器、OWL/RDF 存储或推理器。
- 自动 Claim/Evidence 抽取。
- 文件在线协同编辑。
- 通用文档管理系统的所有能力。
- 公共分享链接、外部访客、多人组织或多租户。
- 云对象存储的生产部署自动化。
- GitHub 工程事实。
- 真实 Agent Provider 调用。

这些能力必须能够建立在本阶段的稳定文件/版本/provenance 边界上，而不要求重新定义 FileVersion。

## 4. 设计原则

### 4.1 AI-native，但不要求 AI 才能工作

所有核心操作先支持人类完成：上传、登记、分类、关联、查看、下载、版本更新。未来 Agent 使用同一 application service 和相同领域对象，不建立“AI 文件系统”平行路径。

### 4.2 开源优先，适配优先，不重复造轮子

当成熟开源项目已经解决协议、解析、预览、安全扫描或基础检索问题时，Workbench 只建立稳定 adapter，不重新实现底层能力。

自研代码应集中在：

- 科研语义；
- 文件与研究对象的关系；
- 版本/审核/科学治理不变量；
- provenance；
- 权限；
- 事件；
- application orchestration。

### 4.3 内容与逻辑身份分离

`ResearchFile` 是逻辑资料身份；`FileVersion` 是不可变内容版本；`FileBlob` 是物理对象/内容哈希。新上传永远创建新 FileVersion，不覆盖旧版本。

### 4.4 受限数据默认不复制

社会科学中的受限原始数据、许可数据和敏感数据默认只登记外部受控位置、hash/manifest、访问政策和版本信息。普通对象存储只承载被批准进入 Workbench 的附件、派生材料和非受限数据。

### 4.5 所有知识都可追溯到来源

后续知识抽取必须能回到具体 FileVersion，并进一步回到页码、表格、段落、工作表或其他来源 span。因此 4A 从一开始保留解析器版本、结构化解析引用和 source locator 扩展点。

## 5. 开源组件策略

### 5.1 上传：Uppy + tus/tusd

采用 tus 可恢复上传协议，不自研分块上传协议。

建议：

- 浏览器：Uppy，使用 `@uppy/tus`。
- 上传服务：官方 tusd reference server。
- tusd 后端通过 S3-compatible storage 或受控本地 storage。
- Workbench 负责签发/校验上传上下文、最终登记 FileVersion；tusd 不成为科研事实源。

理由：

- 支持大文件、断点续传和网络中断恢复；
- 协议成熟，客户端/服务端解耦；
- 避免在 Next.js Route Handler 内重新实现大文件流式上传。

### 5.2 对象存储：S3-compatible port

Workbench application 只依赖自己的 `ObjectStoragePort`，不依赖某一对象存储 SDK 的业务类型。

第一版自托管优先评估 **SeaweedFS S3 gateway**；同时保持与 AWS S3、兼容 S3 服务和 MinIO 的可替换性。

不把 MinIO 设为新的硬依赖。原因是当前 Community Edition 已转为 source-only 分发且采用 AGPLv3，部署/许可选择应该留在基础设施层，而不是写死在业务模型中。

### 5.3 恶意文件扫描：ClamAV

上传字节先进入 quarantine，扫描通过后才进入可消费状态。

建议以 `clamd` 常驻 daemon + stream/local socket 的方式调用；不得把 clamd TCP socket 暴露到公共网络。

Workbench 只保存扫描 verdict、signature database version、scanner version 和时间，不保存扫描器内部日志全文。

### 5.4 通用类型检测与元数据：Apache Tika

Tika 负责：

- MIME/媒体类型检测；
- 通用文本提取；
- Office/PDF 等多格式基础元数据；
- 作为未知格式的 fallback parser。

Tika 应隔离运行并设置时间、内存、输出限制；解析失败不得影响原始 FileVersion 的存在。

### 5.5 富文档结构解析：Docling

Docling 作为 PDF/DOCX/PPTX/XLSX/图像等富结构解析的首选 worker，用于生成：

- 结构化文档 JSON；
- Markdown/HTML 表示；
- 页面布局、表格和阅读顺序等未来 Knowledge ingestion 所需结构。

Workbench 不把 Docling 自己的内部对象当领域模型；只保存 parser identity/version、解析状态以及结构化输出对象引用。

### 5.6 学术论文专用解析：GROBID（后续可插拔）

GROBID 对科学/技术论文 PDF 的 header、reference、TEI 结构非常适合后续知识库阶段。

4A 不要求部署 GROBID，但 FileProcessing 模型必须允许以后针对 `scholarly_pdf` 增加 GROBID parser，不改变 FileVersion schema。

### 5.7 PDF 预览：PDF.js

Web 端 PDF 阅读使用 PDF.js，不自研 PDF renderer。

其他格式第一版只要求安全的元数据/提取文本/下载能力；不引入完整 Office 在线编辑套件。

### 5.8 搜索与未来语义检索

4A 只做 PostgreSQL 基础全文/元数据检索接口；未来 Knowledge Phase 优先使用：

- PostgreSQL FTS；
- pgvector 存 embedding；
- 必要时再评估独立向量数据库。

不在 4A 引入额外向量服务。

### 5.9 Ontology / Semantic Web 的未来边界

未来 Ontology 系统不从零实现 RDF/OWL/SPARQL/SHACL 引擎。优先评估成熟开源实现：

- Apache Jena / Fuseki：RDF、SPARQL、OWL、推理、SHACL 生态完整；
- Oxigraph：较轻量 RDF/SPARQL 存储和工具链。

4A 只保证可导出/映射的稳定 ID 和 provenance，不提前选定最终 triple store。

## 6. 三种实现路线比较

### 方案 A：Workbench 自研上传、存储、解析、预览

优点：控制度最高。

缺点：重复实现大量成熟基础设施；大文件、断点续传、格式解析、安全扫描和 PDF renderer 都是高维护成本领域。

结论：不采用。

### 方案 B：开源基础设施 + Workbench 领域适配层

Uppy/tusd、S3-compatible storage、ClamAV、Tika、Docling、PDF.js 分别解决成熟基础能力；Workbench 负责领域对象、版本、权限、provenance、事件和关系。

优点：最符合 AI-native Workbench 的价值边界；组件可替换；不把科研语义外包给通用 DMS。

缺点：需要明确 adapter contract 和异步处理状态。

结论：**采用。**

### 方案 C：直接以 Nextcloud/Seafile 等通用 DMS 为文件子系统

优点：成熟文件管理、同步、分享能力丰富。

缺点：ResearchNode/Result/ScientificDecision/provenance 的语义需要双向同步；通用 DMS 会成为第二事实源；版本和权限模型难以与科研治理严格一致。

结论：不作为核心文件事实源。将来若团队需要桌面同步，可作为外部 import/export integration。

## 7. 总体架构

```text
Browser
  |
  | Uppy/tus
  v
Upload Gateway (tusd)
  |
  v
Quarantine Storage
  |
  +--> ClamAV Scanner
  |
  +--> MIME/Metadata Pipeline (Tika)
  |
  +--> Rich Parser Pipeline (Docling; future GROBID)
  |
  v
Object Storage (S3-compatible)
  |
  v
Research Workbench Application
  |
  +--> ResearchFile / FileVersion / FileLink
  +--> ResearchEvent / Outbox
  +--> Search metadata projection
  +--> future Knowledge ingestion
```

上传网关、扫描器和解析器均为可替换基础设施。只有 Workbench PostgreSQL 保存正式科研文件事实。

## 8. 领域模型

### 8.1 ResearchFile

逻辑资料身份。

核心字段：

- `id`
- `projectId`
- `title`
- `fileKind`
- `description`
- `currentVersionId`
- `accessClass`
- `lifecycleState`
- `createdBy`
- `createdAt`

`currentVersionId` 只是便利指针；历史版本不可删除。

### 8.2 FileVersion

不可变内容版本。

核心字段：

- `id`
- `researchFileId`
- `versionNumber`
- `blobId | externalReferenceId`
- `originalFilename`
- `mediaType`
- `byteSize`
- `sha256`
- `sourceKind`
- `sourceMetadata`
- `changeSummary`
- `scanStatus`
- `parseStatus`
- `createdBy`
- `createdAt`

数据库级禁止 UPDATE / DELETE。任何修正创建新版本。

### 8.3 FileBlob

物理内容对象。

核心字段：

- `id`
- `sha256`
- `storageBackend`
- `storageKey`
- `byteSize`
- `mediaTypeDetected`
- `quarantineState`
- `createdAt`

同一团队内可以按 hash 去重物理 blob，但 FileVersion 仍保持独立 provenance。

### 8.4 ExternalDataReference

受限/外部数据引用。

核心字段：

- `id`
- `projectId`
- `uriOrLocator`
- `manifestHash`
- `accessPolicyRef`
- `licenseOrAgreementRef`
- `versionLabel`
- `createdBy`
- `createdAt`

不得存凭据。凭据只通过 secret reference/运行环境提供。

### 8.5 FileLink

把 FileVersion 关联到科研对象。

首版 subject types：

- `research_node_revision`
- `research_task`
- `research_result`
- `scientific_decision`
- `project`
- `data_version`

关系类型示例：

- `documents`
- `input_to`
- `output_of`
- `supports`
- `challenges`
- `review_material`
- `source_for`

FileLink 追加式记录；取消关联以 supersession/retirement 表达，不静默删除审计历史。

### 8.6 FileProcessingRecord

记录扫描/检测/解析。

字段：

- `id`
- `fileVersionId`
- `processorKind`
- `processorName`
- `processorVersion`
- `status`
- `inputHash`
- `outputRefs`
- `errorCode`
- `startedAt`
- `finishedAt`

Processor output 放对象存储，不把大量解析 JSON 塞进主业务表。

## 9. 文件类型分类

`fileKind` 是科研用途，不等于 MIME：

- `literature`
- `data_documentation`
- `dataset`
- `analysis_output`
- `code_archive`
- `research_design`
- `manuscript`
- `review_material`
- `meeting_note`
- `ethics_or_license`
- `presentation`
- `general_attachment`

未来 Ontology 可以把这些映射为更细概念；4A 不把枚举无限扩展。

## 10. 上传状态机

```text
initiated
  -> uploading
  -> uploaded_quarantine
  -> scanning
  -> rejected_malware
  -> accepted
  -> metadata_processing
  -> parsing
  -> ready

任一步基础设施失败
  -> processing_failed
  -> retry
```

关键不变量：

- `ready` 之前不能作为正式分析输入自动消费。
- malware verdict 不等于物理删除；进入 quarantine 并通知负责人。
- parser failure 不改变已通过扫描的文件事实；文件可以保持 `ready_with_parse_error`。
- 相同 upload completion callback 必须幂等。
- 文件名不是 storage key。

## 11. 上传/导入流程

### 11.1 普通上传

1. Web 向 Workbench 请求 upload intent。
2. Workbench 校验项目写权限和 accessClass，生成 opaque upload id。
3. Uppy 经 tusd 上传至 quarantine。
4. tusd completion callback 写 IntegrationInbox/Outbox。
5. scanner worker 计算/确认 SHA-256 并调用 ClamAV。
6. 通过后建立 FileBlob / FileVersion。
7. metadata/parser worker 异步运行 Tika/Docling。
8. processing result 追加到 FileProcessingRecord。
9. UI 逐步展示扫描/解析状态。
10. 所有状态变化产生 ResearchEvent。

### 11.2 新版本上传

用户必须选择已有 ResearchFile，并填写简短 change summary。

新 FileVersion 创建后，`currentVersionId` 在同一事务切换；旧版本永久可回看。

### 11.3 外部受限数据登记

不上传原始 bytes。创建 ExternalDataReference，并可上传批准的字典、代码本、样例或派生材料。

## 12. 权限

第一版延续单团队的透明协作假设：六人默认可读团队项目资料；写入、版本上传和后续审核动作按项目角色控制。

最低规则：

- project member：read。
- project lead / contributor with write role：上传和新版本。
- 受限数据 locator：可按 accessClass 进一步限制元数据字段显示。
- system/Agent：只能通过明确 application service 写 FileLink/processing result；不能替人改变受限数据政策。
- 对象存储不直接暴露长期公开 URL；下载使用短期授权或 server proxy。

## 13. ResearchEvent

新增事件至少包括：

- `RESEARCH_FILE_CREATED`
- `FILE_VERSION_CREATED`
- `FILE_UPLOAD_COMPLETED`
- `FILE_SCAN_COMPLETED`
- `FILE_SCAN_REJECTED`
- `FILE_PARSE_COMPLETED`
- `FILE_PARSE_FAILED`
- `FILE_LINK_CREATED`
- `EXTERNAL_DATA_REFERENCE_CREATED`

事件 payload 只存 IDs、状态、hash、processor identity 等可审计事实，不存文件原文和秘密。

## 14. Outbox / Inbox

外部 callback 和异步处理沿用既有可靠模式：

- tusd completion callback -> IntegrationInbox；
- Workbench transaction -> Outbox；
- scanner/parser worker 幂等消费；
- processor key 使用 `fileVersionId + processorName + processorVersion + inputHash`。

重试不能生成重复 FileVersion。

## 15. UI

项目内导航新增 **文件与资料**。

页面分为：

### 15.1 文件列表

显示：

- 逻辑文件名；
- fileKind；
- 当前版本；
- 更新时间；
- accessClass；
- 扫描/解析状态；
- 关联 ResearchNode/Task/Result 数量。

支持按类型、状态、关联研究对象搜索/过滤。

### 15.2 文件详情

包含：

- 当前版本摘要；
- 版本历史；
- 文件 hash / MIME / 大小；
- 上传来源；
- 扫描状态；
- parser 信息；
- 科研关联；
- PDF.js 预览或提取文本预览；
- 下载。

### 15.3 上传

Uppy 提供可恢复上传进度。

上传者必须选择：

- 新 ResearchFile 或已有文件的新版本；
- fileKind；
- accessClass；
- 可选关联研究对象；
- 新版本时填写 change summary。

## 16. Preview 策略

首版只承诺：

- PDF：PDF.js。
- 图像：浏览器安全预览。
- 纯文本/Markdown：转义后的文本预览。
- Office/复杂文档：优先展示 Docling/Tika 提取表示；保留原件下载。

不在 4A 加入 Office 在线编辑器。

## 17. Knowledge / Ontology 前向兼容

4A 必须从第一天满足：

### 17.1 Stable IDs

ResearchFile、FileVersion、FileProcessingRecord、FileLink 均为稳定 ID，不以文件路径作为身份。

### 17.2 Provenance

未来 Knowledge statement 至少可引用：

- `fileVersionId`
- parser identity/version
- page/sheet/section locator
- content hash

### 17.3 Source span 扩展

4A 不正式建 KnowledgeChunk，但 parser output 必须允许未来形成：

```text
KnowledgeSourceSpan
  fileVersionId
  parsedArtifactRef
  locatorType
  locator
  parserName
  parserVersion
```

### 17.4 语义标准

未来 ontology/export 优先遵守 RDF/JSON-LD、OWL、SPARQL、SHACL 等标准能力，而不是设计只能被 Workbench 理解的私有图格式。

### 17.5 Observation / Claim / Decision 分离

文件解析输出只是 source/observation material，不能自动升级成 ScientificDecision 或正式 Claim。

未来 Agent/Reasoning 系统必须通过单独的 extraction/proposal/governance 流程。

## 18. 与 Phase 4B 的接口

4B 可以直接复用：

- ResearchFile / FileVersion 作为 ResearchTask deliverable。
- FileLink 关联 task submission。
- ReviewRequest 的 subject 可以指向 FileVersion。
- 审核通过不修改 FileVersion；必要修改产生新版本。
- hybrid/Agent task 使用相同 FileVersion，不另建 Agent-only attachment。

## 19. 与 Phase 4C 的接口

进展投影可从事件中计算：

- 最近文件变化；
- 待解析失败；
- 文件/版本活动；
- 待审核材料数量（4B 后）；
- 项目 research dimension 状态。

不得以“文件数量”直接推断科研完成度。

## 20. 与后续 Knowledge Phase 的接口

Knowledge ingestion 消费的是 `FILE_PARSE_COMPLETED` + immutable FileVersion，而不是直接监听对象存储目录。

这样可以：

- 重放；
- 重新解析；
- 切换 parser；
- 对比 parser 版本；
- 建立 KnowledgeVersion；
- 精确 provenance。

## 21. 错误处理

明确错误类：

- upload authorization denied
- upload incomplete
- callback duplicate
- blob checksum mismatch
- malware detected
- scanner unavailable
- parser timeout
- unsupported media
- object storage unavailable
- restricted-data upload forbidden

基础设施不可用时状态保持 pending/failed，不伪造 ready。

## 22. 安全要求

- quarantine 与 ready object prefix/bucket 分离。
- 未扫描 bytes 不进入普通下载路径。
- 文件类型根据内容检测，不信任扩展名。
- parser worker 设置资源限制。
- ClamAV daemon 不暴露公共网络。
- object storage credentials 不进入浏览器持久状态。
- 下载使用短期授权。
- 原始文件名作为 metadata，不直接拼文件系统路径。
- 压缩包防止 zip-slip/path traversal；不在 Web 进程自动解压任意 archive。
- 限制单文件大小、上传并发、解析输出大小。
- 恶意/失败文件默认保留审计状态，不自动物理删除。

## 23. 可观测性

至少记录指标：

- upload started/completed/failed
- scan duration/verdict
- parse duration/success/failure
- processing queue depth
- storage errors
- callback dedupe count

日志不得包含文件原文、受限 locator 凭据或 presigned URL secret query。

## 24. 数据库不变量

- FileVersion UPDATE / DELETE：数据库级拒绝。
- 同一 ResearchFile 的 versionNumber 唯一。
- FileBlob.sha256 + storage backend 可唯一约束。
- FileVersion 的 blob/external reference 二选一。
- ready content 必须有通过 scan verdict；外部 reference 除外。
- FileLink 不允许跨团队引用。
- currentVersionId 必须属于同一 ResearchFile。
- processor success 的 outputRefs 不能为空。
- secret-safe serializer 继续覆盖所有新增 ResearchEvent。

## 25. 测试策略

### 25.1 单元/领域

- version state machine
- fileKind/accessClass validation
- restricted data policy
- source locator validation

### 25.2 PostgreSQL 集成

- FileVersion immutable
- concurrent version allocation
- currentVersion pointer
- callback idempotency
- processing idempotency
- cross-project/cross-team link rejection
- external reference without credentials

### 25.3 Adapter contract

- FakeObjectStorage / real S3-compatible smoke
- FakeScanner / ClamAV smoke
- FakeParser / Tika/Docling conditional smoke
- tus completion callback contract

真实外部二进制不可用时可以显式 skip smoke，但 fake contract 必须始终跑。

### 25.4 Playwright

至少覆盖：

1. 研究者创建逻辑文件并上传 v1。
2. 上传中断后恢复。
3. malware/scan rejected 文件不能进入 ready 下载。
4. 上传 v2 后 v1 仍可查看。
5. 文件关联到 ResearchNode/ResearchResult。
6. 受限数据使用 external reference，不上传 raw bytes。
7. PDF 预览。
8. parser failure 不丢失文件版本。

## 26. 4A 验收标准

人工验收至少确认：

- 用户能在项目内上传并查看文件。
- 同一逻辑文件可以创建多个版本，历史不可覆盖。
- 文件能关联研究节点、任务、结果和科学决策。
- 扫描/解析状态清楚可见。
- PDF 可以直接预览。
- 受限原始数据可以登记而不是被迫上传。
- 任一 FileVersion 都能追到上传者、时间、hash、processor/version 和科研关联。
- 系统不要求真实 AI Provider 才能完成上述操作。
- 新对象能够被未来 Agent/Knowledge/Ontology 系统稳定引用。

## 27. Phase 4A 退出条件

完成 4A 后才开始 4B 书面规格/计划。

4A 不要求：

- 真实 Agent provider；
- 知识抽取；
- Ontology；
- generic review；
- progress cockpit。

这些后续能力只消费本阶段稳定边界，不反向修改 FileVersion 语义。

## 28. 开源依赖治理

任何新开源依赖进入实现计划前必须记录：

- 上游 repository/homepage；
- license；
- 固定版本或镜像 digest；
- 是否执行 native/install scripts；
- 是否处理不可信输入；
- 是否需要网络；
- 数据是否会离开私有部署；
- 替换接口。

高权限或解析不可信内容的组件必须在隔离进程/容器运行。

## 29. 路线顺序修订

原 `2026-09-29-phase-04-github-integration.md` 保留为历史计划文件，不删除、不静默改名。

新的执行顺序变为：

1. Phase 1 Foundation
2. Phase 2 Scientific Governance
3. Phase 3 Agent Runtime
4. Phase 4A Files & Provenance
5. Phase 4B Human/Hybrid Work & Review
6. Phase 4C Progress Projections & Cockpit
7. GitHub Engineering Truth（原 phase-04 文件，后续重新编号/重写时再处理）
8. Assets / Knowledge Foundation
9. Ontology / Reasoning
10. Deployment Hardening

后续正式计划必须以新的路线顺序为准，而不是仅根据旧文件名数字推断。

## 30. 自检

- 无 TBD / TODO / 待定占位符。
- 本规格只覆盖 4A，未把 Review/Progress/Ontology 实现混入一个过大的计划。
- AI-native 主线保持不变。
- 真实 Agent API 不是本阶段运行前置条件。
- 文件内容、版本、物理 blob、外部受限数据引用已经分层。
- 开源组件均放在 adapter/worker 边界，不成为科研事实源。
- Knowledge/Ontology 前向兼容依赖稳定 ID、provenance 和事件，而不是提前实现知识系统。
- 历史 phase-04 GitHub plan 保留，路线顺序通过显式 addendum 修订。
