# 网页组织运行时实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有“请假演示页”改造成一个可公开部署、可持久运行的网页组织操作系统原型，使人员、部门、项目组、负责人和关系的变化全部作为运行时事件发生，而不是通过改源码或重新编译完成。

**Architecture:** 系统分为组织模型、通用世界运行时、持久化适配器和动态网页界面四层。核心运行时只操作“存在、关系、状态、事件事务”，组织层把“调岗、离职、创建项目、更换负责人”等动作编译为一组通用原子操作；浏览器存储保存世界快照和事件历史，GUI 只投影当前世界。

**Tech Stack:** 原生 ES 模块、Node.js >= 22、`node:test`、浏览器 DOM、浏览器本地持久存储、现有 Railway 网页部署。

**Spec:** `docs/superpowers/specs/2026-10-04-organization-runtime-web-design.md`

## Global Constraints

- 第一阶段产品形态是可公开部署的网页应用，不做桌面应用。
- 人员、部门、项目组都是运行时存在，绝不能因为实例变化而修改源码、重新编译或重新部署。
- 底层真相是关系图，不是固定部门树。
- 第一阶段组织类型固定为 `成员`、`部门`、`项目组`。
- 关系方向固定为 `成员 --属于--> 部门`、`成员 --参与--> 项目组`、`部门 --负责人--> 成员`、`项目组 --负责人--> 成员`。
- 成员状态至少支持 `任职状态`，部门和项目组至少支持 `生命周期状态`；典型值包括 `在职`、`离职`、`运行中`、`已结束`。
- 日常组织变化必须先形成事件，再由运行时原子地修改世界；失败事件不得留下部分变化。
- 第一阶段使用浏览器本地持久存储，但运行时不得直接调用浏览器存储接口。
- 删除默认采用状态结束或关系取消，不做物理删除。
- 第一阶段不实现登录、多用户协同、服务器数据库、移动端专属界面、桌面应用、AI 动态生成页面。
- 现有 Railway 线上入口必须继续可访问；部署后必须回读线上页面验证状态码与主要页面内容。

## Review Focus

1. **复合事件中途失败：** 任一操作校验失败时，整个事件回滚，世界、关系和事件历史均不产生半成品；Task 2 用“调岗目标部门不存在”锁定此行为。
2. **非法关系端点：** `属于`、`参与`、`负责人` 的主体/客体类型不符合组织模型时必须拒绝且不改世界；Task 1 和 Task 2 覆盖。
3. **重复与缺失关系：** 完全重复建立关系应幂等，取消不存在的关系应作为失败事件处理且不改世界；Task 2 覆盖。
4. **持久化损坏或版本不兼容：** 读取失败不得静默覆盖已有数据；适配器返回明确错误，由界面提供“重置演示”而不是自动清空；Task 3 覆盖。
5. **运行实例变化污染 GUI：** `index.html` 和模型定义不得包含具体演示实例名作为页面结构条件；新增部门/项目/成员后通用视图必须自动出现它们；Task 5 和 Task 6 覆盖。

---

## 文件结构

实施完成后，相关文件职责固定为：

```text
src/
├── model/
│   ├── organization-model.js   # 稳定组织模型：类型、关系方向、合法状态
│   └── organization-actions.js # 组织动作 -> 通用事件事务
├── runtime/
│   ├── world.js                # 世界结构、通用读写与模型校验
│   └── events.js               # 原子事件事务执行与事件记录
├── storage/
│   └── browser-store.js        # 可替换的浏览器持久化适配器
├── demo/
│   └── seed-world.js           # 仅演示用的初始实例，不属于组织模型
├── ui/
│   └── views.js                # 纯 HTML 视图函数，只读取世界
└── app.js                      # DOM 绑定、导航、表单、运行时与存储协调

tests/
├── world.test.mjs
├── events.test.mjs
├── storage.test.mjs
├── actions.test.mjs
├── views.test.mjs
└── organization-flow.test.mjs
```

`src/engine.js` 在新运行时完成后删除；它当前写死的请假逻辑不能继续作为业务核心。

---

### Task 1: 建立稳定组织模型与通用世界结构

**Files:**
- Create: `src/model/organization-model.js`
- Create: `src/runtime/world.js`
- Create: `src/demo/seed-world.js`
- Create: `tests/world.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `ORGANIZATION_MODEL`
- Produces: `createEmptyWorld({ name, modelVersion }) -> World`
- Produces: `createEntity(world, entity, model) -> World`
- Produces: `setState(world, change, model) -> World`
- Produces: `addRelation(world, relation, model) -> World`
- Produces: `removeRelation(world, relation, model) -> World`
- Produces: `getEntitiesByType(world, type) -> Entity[]`
- Produces: `getRelations(world, filter) -> Relation[]`
- Produces: `createSeedWorld() -> World`

- [ ] **Step 1: 为测试运行器和世界模型写失败测试**

`package.json` 增加 `"test": "node --test tests/*.test.mjs"`。在 `tests/world.test.mjs` 写测试，至少断言：

```js
assert.deepEqual(ORGANIZATION_MODEL.entityTypes, ['成员', '部门', '项目组']);
assert.equal(JSON.stringify(ORGANIZATION_MODEL).includes('张三'), false);

const world = createEmptyWorld({ name: '星河公司', modelVersion: ORGANIZATION_MODEL.version });
assert.equal(world.name, '星河公司');
assert.deepEqual(world.entities, []);
assert.deepEqual(world.relations, []);

const withMember = createEntity(world, {
  id: 'member-1', name: '张三', type: '成员', states: { 任职状态: '在职' },
}, ORGANIZATION_MODEL);
assert.equal(withMember.entities.length, 1);
assert.equal(world.entities.length, 0); // 运行时写操作必须返回新世界
```

再覆盖关系方向：`成员 -> 属于 -> 部门` 合法，`部门 -> 属于 -> 成员` 抛错；`部门 -> 负责人 -> 成员` 合法。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`

Expected: FAIL，原因是新模块或导出尚不存在。

- [ ] **Step 3: 实现稳定模型 `ORGANIZATION_MODEL`**

在 `src/model/organization-model.js` 定义：

```js
export const ORGANIZATION_MODEL = {
  version: '组织模型-0.1',
  entityTypes: ['成员', '部门', '项目组'],
  relationTypes: {
    属于: { subjects: ['成员'], objects: ['部门'] },
    参与: { subjects: ['成员'], objects: ['项目组'] },
    负责人: { subjects: ['部门', '项目组'], objects: ['成员'] },
  },
  stateSlots: {
    成员: { 任职状态: ['在职', '离职'] },
    部门: { 生命周期状态: ['运行中', '已结束'] },
    项目组: { 生命周期状态: ['运行中', '已结束'] },
  },
};
```

该文件不得包含任何具体人员、部门或项目实例。

- [ ] **Step 4: 实现不可变世界操作**

在 `src/runtime/world.js` 实现上述接口。所有写操作先校验存在类型、引用存在性、关系端点类型和状态值，再基于 `structuredClone` 返回新世界；重复建立完全相同关系返回语义相同的世界，不产生第二条关系。

- [ ] **Step 5: 建立独立演示种子**

`src/demo/seed-world.js` 只负责产生演示实例：星河公司、张三、李四、王五、研发部、财务部及初始关系/状态。它只调用 Task 1 的通用接口，不修改 `ORGANIZATION_MODEL`。

- [ ] **Step 6: 运行世界模型测试**

Run: `npm test`

Expected: `tests/world.test.mjs` PASS，无其他失败。

- [ ] **Step 7: Commit**

```bash
git add package.json src/model/organization-model.js src/runtime/world.js src/demo/seed-world.js tests/world.test.mjs
git commit -m "feat: 建立组织世界模型"
```

---

### Task 2: 实现原子事件事务

**Files:**
- Create: `src/runtime/events.js`
- Create: `tests/events.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `createEntity`、`setState`、`addRelation`、`removeRelation`
- Produces: `applyOperations(world, operations, { model, idFactory }) -> World`
- Produces: `executeEvent(world, event, { model, now, idFactory }) -> { world, record }`
- `operation.kind` 只允许：`创建存在`、`设置状态`、`建立关系`、`取消关系`
- `record` 固定包含：`id`、`type`、`params`、`occurredAt`、`actorId`、`status`、`changes`

- [ ] **Step 1: 写事件事务失败测试**

在 `tests/events.test.mjs` 覆盖：

```js
const event = {
  id: 'evt-1',
  type: '组织变更',
  params: { reason: '调岗' },
  actorId: null,
  operations: [
    { kind: '取消关系', subjectId: 'member-1', relation: '属于', objectId: 'dept-old' },
    { kind: '建立关系', subjectId: 'member-1', relation: '属于', objectId: 'dept-missing' },
  ],
};

assert.throws(() => executeEvent(seed, event, context));
assert.deepEqual(seed, before); // 旧关系仍存在，不能留下半次调岗
```

同时断言：成功事件产生一条 `status: '成功'` 的记录；取消不存在关系失败；重复建立关系不会产生重复事实。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/events.test.mjs`

Expected: FAIL，`executeEvent` 尚不存在。

- [ ] **Step 3: 实现 `applyOperations`**

对输入世界只创建一次事务工作副本，按顺序应用操作；任何一步失败直接抛出错误并丢弃工作副本。不得在循环中修改调用方传入的世界。

- [ ] **Step 4: 实现 `executeEvent`**

事件开始前保存原世界引用；成功时返回新世界和变化摘要，失败时抛出包含事件类型与失败操作索引的错误。事件记录本身不由核心世界函数自动持久化，交给 Task 4 的控制器和 Task 3 的存储适配器。

- [ ] **Step 5: 运行事件测试**

Run: `node --test tests/events.test.mjs`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/runtime/events.js tests/events.test.mjs
git commit -m "feat: 添加原子组织事件事务"
```

---

### Task 3: 实现可替换的浏览器持久化适配器

**Files:**
- Create: `src/storage/browser-store.js`
- Create: `tests/storage.test.mjs`

**Interfaces:**
- Produces: `createBrowserStore(storage, { key, modelVersion }) -> Store`
- `Store.loadWorld() -> World | null`
- `Store.loadEvents() -> EventRecord[]`
- `Store.commit({ world, event }) -> void`
- `Store.reset() -> void`
- `Store.inspect() -> { modelVersion, world, events } | null`

- [ ] **Step 1: 写存储适配器失败测试**

使用测试内最小 `FakeStorage`，验证：

```js
const store = createBrowserStore(fakeStorage, {
  key: '组织运行时测试',
  modelVersion: '组织模型-0.1',
});
store.commit({ world, event });
assert.deepEqual(store.loadWorld(), world);
assert.deepEqual(store.loadEvents(), [event]);
```

另写两项关键测试：损坏 JSON 时 `loadWorld()` 抛出明确 `StorageError` 且原字符串仍在；存储中的 `modelVersion` 与当前模型不同时拒绝加载且不自动覆盖。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/storage.test.mjs`

Expected: FAIL，适配器尚不存在。

- [ ] **Step 3: 实现单键快照存储**

`commit({ world, event })` 先在内存中组装完整 `{ modelVersion, world, events }`，然后只调用一次 `storage.setItem`，避免“世界已保存但事件未追加”的双写窗口。`loadWorld`、`loadEvents` 和 `inspect` 都从同一个快照读取。

- [ ] **Step 4: 实现错误保护与重置**

定义并导出 `StorageError`。解析失败、版本不兼容和底层 `setItem` 失败都抛出该错误；只有用户显式执行 `reset()` 才删除存储数据。

- [ ] **Step 5: 运行存储测试**

Run: `node --test tests/storage.test.mjs`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/storage/browser-store.js tests/storage.test.mjs
git commit -m "feat: 添加组织世界浏览器持久化"
```

---

### Task 4: 把组织动作编译为通用事件，并建立应用控制器

**Files:**
- Create: `src/model/organization-actions.js`
- Create: `src/app-controller.js`
- Create: `tests/actions.test.mjs`

**Interfaces:**
- Consumes: Task 1 模型与世界查询、Task 2 `executeEvent`、Task 3 `Store`
- Produces: `createDepartment({ name }) -> Event`
- Produces: `createProject({ name }) -> Event`
- Produces: `transferMember({ memberId, fromDepartmentId, toDepartmentId }) -> Event`
- Produces: `joinProject({ memberId, projectId }) -> Event`
- Produces: `leaveProject({ memberId, projectId }) -> Event`
- Produces: `setOwner({ targetId, previousOwnerId, memberId }) -> Event`
- Produces: `leaveOrganization({ memberId, relationSnapshot }) -> Event`
- Produces: `endEntity({ entityId, type }) -> Event`
- Produces: `createOrganizationApp({ store, seedFactory, model, now, idFactory }) -> AppController`
- `AppController.start() -> { world, events }`
- `AppController.dispatch(event) -> { world, events, record }`
- `AppController.reset() -> { world, events }`

- [ ] **Step 1: 写组织动作失败测试**

在 `tests/actions.test.mjs` 断言组织动作只生成通用操作。例如调岗：

```js
assert.deepEqual(
  transferMember({ memberId: 'm1', fromDepartmentId: 'd1', toDepartmentId: 'd2' }).operations,
  [
    { kind: '取消关系', subjectId: 'm1', relation: '属于', objectId: 'd1' },
    { kind: '建立关系', subjectId: 'm1', relation: '属于', objectId: 'd2' },
  ],
);
```

离职事件必须把成员状态设为 `离职`，并取消调用方传入快照中的当前部门、项目参与和负责人关系；运行时核心不得存在 `if (event.type === '离职')`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/actions.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现组织动作编译器**

所有组织动作函数只负责生成事件对象和 `operations`，不直接改世界、不访问 DOM、不访问存储。`endEntity` 编译为合法生命周期状态变更；不要在运行时增加“结束部门”或“解散项目”的特殊操作类型。

- [ ] **Step 4: 实现 `AppController`**

`start()` 优先读取 Store；没有持久世界时调用 `seedFactory()` 并保存初始快照。`dispatch()` 调用 `executeEvent`，成功后用 Store 的单次 `commit` 同时保存世界与事件；失败时既不更新内存状态也不写存储。`reset()` 只在显式调用时清空并重新建立种子世界。

- [ ] **Step 5: 添加控制器持久化断言**

在同一测试文件中创建两个 Controller 共用同一 `FakeStorage`：第一个执行创建部门事件，第二个 `start()` 后必须读到该部门和事件历史，证明刷新/重新打开网页语义成立。

- [ ] **Step 6: 运行动作与控制器测试**

Run: `node --test tests/actions.test.mjs tests/storage.test.mjs tests/events.test.mjs`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/model/organization-actions.js src/app-controller.js tests/actions.test.mjs
git commit -m "feat: 连接组织动作与运行时"
```

---

### Task 5: 用当前世界动态生成网页 GUI

**Files:**
- Create: `src/ui/views.js`
- Create: `tests/views.test.mjs`
- Modify: `index.html`
- Modify: `styles.css`
- Replace: `src/app.js`
- Delete: `src/engine.js`

**Interfaces:**
- Consumes: Task 4 `AppController` 与组织动作函数
- Produces: `renderOverview(world, events) -> string`
- Produces: `renderPeople(world, events) -> string`
- Produces: `renderDepartments(world, events) -> string`
- Produces: `renderProjects(world, events) -> string`
- Produces: `renderRelations(world) -> string`
- Produces: `renderEvents(events) -> string`
- Produces: `renderPolicy(model) -> string`

- [ ] **Step 1: 写动态视图失败测试**

在 `tests/views.test.mjs` 创建两个不同世界，断言同一个 `renderDepartments` 会随数据变化：

```js
assert.match(renderDepartments(worldA, []), /研发部/);
assert.doesNotMatch(renderDepartments(worldA, []), /人工智能部/);
assert.match(renderDepartments(worldB, []), /人工智能部/);
```

再断言 `renderProjects` 能同时显示跨部门成员，`renderRelations` 输出 `张三 —属于→ 人工智能部` 形式，`renderEvents` 展示变化摘要。

- [ ] **Step 2: 运行视图测试确认失败**

Run: `node --test tests/views.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现纯视图函数**

`src/ui/views.js` 只读取 world/events/model，统一 HTML 转义，不访问 DOM、不修改世界。空成员、空部门、空项目和空事件都要有中文空状态。

- [ ] **Step 4: 重构稳定网页壳层**

`index.html` 固定只包含通用导航与挂载点：`总览`、`人员`、`部门`、`项目`、`关系`、`事件`、`制度`，以及一个“组织变更”入口。HTML 不得出现 `张三`、`研发部`、`火星计划` 等实例名。

- [ ] **Step 5: 实现操作界面与导航**

在 `src/app.js`：

- 启动 `AppController`；
- 根据当前导航调用纯视图函数；
- 提供创建部门、创建项目、成员调岗、加入/退出项目、更换负责人、成员离职、结束部门/项目的表单；
- 每个表单只调用 `organization-actions.js` 生成事件，然后 `controller.dispatch(event)`；
- 操作成功后重新渲染当前世界；
- 运行错误以中文提示显示，不直接改 DOM 中的数据模型；
- “重置演示”必须二次确认，并调用 `controller.reset()`。

- [ ] **Step 6: 调整网页视觉层**

`styles.css` 保留现有清爽的浅色视觉方向，改为稳定侧边导航 + 内容区 + 操作面板；响应式下导航改为横向滚动或顶部入口。不要引入前端框架或图形关系库。

- [ ] **Step 7: 删除旧请假引擎并做静态约束测试**

测试读取 `index.html`，断言不包含具体演示实例名；读取 `src/app.js`，断言不导入 `./engine.js`；删除 `src/engine.js`。

- [ ] **Step 8: 运行全部测试**

Run: `npm test`

Expected: 全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add index.html styles.css src/app.js src/ui/views.js tests/views.test.mjs
git rm src/engine.js
git commit -m "feat: 构建动态组织运行网页界面"
```

---

### Task 6: 用组织变化压力测试证明“运行而非重编译”

**Files:**
- Create: `tests/organization-flow.test.mjs`

**Interfaces:**
- Consumes: Task 1–5 的公开接口
- Produces: 一个端到端的纯运行时验收测试，不增加产品接口

- [ ] **Step 1: 写完整压力场景测试**

测试从 `createSeedWorld()` 开始，通过 Task 4 的组织动作依次执行：

```text
1. 创建 人工智能部
2. 张三从研发部调入人工智能部
3. 创建 火星计划
4. 张三、王五加入火星计划
5. 火星计划负责人改为王五
6. 李四离职
7. 研发部负责人改为王五
8. 火星计划状态改为已结束
```

最后断言：

- `modelVersion` 从头到尾都是 `组织模型-0.1`；
- 张三仍参与火星计划，即调岗没有破坏项目关系；
- 李四状态为 `离职` 且不再作为任何部门/项目负责人；
- 研发部的负责人关系指向王五；
- 火星计划仍然可查询，但生命周期状态为 `已结束`，证明不是物理删除；
- 每一步成功事件都在历史中，顺序与操作顺序一致；
- 把最后状态写入 Store 后创建新 Controller，重新加载得到同一组织状态和事件历史。

- [ ] **Step 2: 运行压力测试确认现有实现满足整个规格**

Run: `node --test tests/organization-flow.test.mjs`

Expected: PASS。如果失败，只修正拥有该行为的现有 Task 文件，不在测试中绕过运行时接口。

- [ ] **Step 3: 运行完整回归测试**

Run: `npm test`

Expected: 所有测试 PASS，0 FAIL。

- [ ] **Step 4: Commit**

```bash
git add tests/organization-flow.test.mjs
git commit -m "test: 验证动态组织运行场景"
```

---

### Task 7: 更新网页部署并做线上回读验证

**Files:**
- Modify only if needed: `server.mjs`
- Deployment configuration: Railway `organization-language-live` function/service

**Interfaces:**
- Consumes: Task 5 新增的 `/src/model/`、`/src/runtime/`、`/src/storage/`、`/src/demo/`、`/src/ui/` 模块
- Produces: 现有公开 URL 继续服务新网页运行时

- [ ] **Step 1: 本地静态服务冒烟检查**

Run: `node server.mjs`

Check: `/`、`/styles.css`、`/src/app.js` 及其所有 ES 模块依赖都返回 `200` 和正确 MIME 类型。

- [ ] **Step 2: 修正线上 Railway 静态代理能力**

现有 Railway Function 只显式代理少数旧路径。将其改为安全代理仓库分支中的 `/index.html`、`/styles.css` 和 `/src/` 下 `.js` 文件，拒绝 `..`、非允许前缀和非 `.js` 的任意路径；继续使用 `PORT=3000`。

- [ ] **Step 3: 部署后检查 Railway 状态**

确认最新部署状态为 `SUCCESS`、副本正常、无关键错误。

- [ ] **Step 4: 线上回读页面和模块**

对公开地址执行线上读取，确认：

- 首页 HTTP 200；
- 标题和正文已经是“组织运行时”新版界面；
- `/src/model/organization-model.js`、`/src/runtime/events.js`、`/src/ui/views.js` 均可被浏览器加载；
- 页面初始显示人员、部门、项目等动态视图，而不是旧的请假三栏演示。

- [ ] **Step 5: 最终回归**

Run: `npm test`

Expected: 全部 PASS。记录测试总数、线上部署状态与公开地址，再声明完成。
