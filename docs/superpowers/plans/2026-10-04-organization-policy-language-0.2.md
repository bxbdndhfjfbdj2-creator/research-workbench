# 组织制度语言 0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前写死在 JavaScript 中的组织模型、组织动作和动作表单升级为可编译、可版本化、可兼容检查、可在线生效的中文组织制度，同时安全迁移现有 0.1 浏览器快照并保持组织世界持续运行。

**Architecture:** 新增确定性的制度解析/编译层，编译结果继续满足现有世界运行时所需的 `entityTypes`、`relationTypes`、`stateSlots`，并额外包含动作定义。动作物化器把制度动作展开成现有四种原子世界操作；兼容性检查器以“当前事实在候选制度下仍合法”为准则；0.2 快照把运行时格式版本和制度版本彻底分离，控制器始终从快照当前制度版本取得模型，不再永久捕获固定 `ORGANIZATION_MODEL`。

**Tech Stack:** 原生 ES 模块、Node.js >= 22、`node:test`、浏览器 DOM、`localStorage`、现有 Railway Bun 静态代理。

**Spec:** `docs/superpowers/specs/2026-10-04-organization-policy-language-0.2-design.md`；补充：`docs/superpowers/specs/2026-10-04-organization-policy-language-0.2-amendment.md`

## Global Constraints

- 第一阶段仍是公开部署的网页应用，不做桌面应用、服务器数据库、账号或多人协同。
- 制度语法必须确定性解析，不调用 AI，不接受自由自然语言。
- 世界运行时核心继续只认识：`创建存在`、`设置状态`、`建立关系`、`取消关系`。
- `取消所有关系` 只属于动作效果模板，物化时展开成零条或多条 `取消关系`；不得进入核心运行时分支。
- 动作输入只支持 `文本` 或一个/多个已声明存在类型；`文本` 不能与存在类型混用。
- 当前世界事实在候选制度下全部合法，候选制度才允许激活；0.2 不自动迁移非法世界事实。
- 运行时格式版本固定为 `组织运行时-2`；制度版本是独立的业务版本标识。
- 0.1 存储键 `organization-runtime-v0.1` 必须保留为恢复副本；0.2 使用 `organization-runtime-v0.2`。
- 0.1 → 0.2 迁移必须保留原实体、关系、状态、元数据和事件字段；仅补充缺失制度版本，并把旧 `world.modelVersion` 降级为迁移来源元数据。
- 已激活制度记录不可变；当前制度版本只引用制度版本表中的一个版本。
- 制度激活必须一次原子持久化；写入失败时旧制度和旧世界继续运行。
- 网页动作表单不得再按具体动作名称写专用字段分支。
- 0.2 主路径完成后，`src/model/organization-actions.js` 不再作为网页运行路径；允许暂时保留文件用于旧测试过渡，最终静态约束必须证明 `app.js` 与控制器不再导入它。

## Review Focus

1. **绑定与多类型输入：** 一个输入声明多个存在类型时，条件和效果必须对所有可能类型静态成立；非法并集必须在编译期拒绝。
2. **批量关系展开：** `取消所有关系` 匹配零条、多条及双端绑定情况都必须确定展开，且整个动作仍保持一次事务原子性。
3. **制度热切换后旧控制器实例：** 不重新创建页面/控制器也必须立即使用新制度动作和模型；不得继续使用启动时缓存的旧 model。
4. **0.1 迁移失败与重复启动：** 新键写入失败不得修改旧键；迁移成功后再次启动必须直接使用 0.2，不得重复导入 0.1。
5. **激活过程的持久化失败：** 候选制度通过检查但提交失败时，内存与存储中的当前制度版本、世界和历史都必须保持旧状态。

---

## 文件结构

```text
src/
├── policy/
│   ├── initial-policy-source.js   # 初始中文制度源码（取代固定动作/模型主路径）
│   ├── parser.js                  # 行式中文语法 -> AST + 行号诊断
│   ├── compiler.js                # AST -> 编译后制度模型
│   ├── action-runtime.js          # 制度动作输入/条件/效果 -> 通用事件
│   └── compatibility.js           # 候选制度与当前世界兼容检查/变化摘要
├── storage/
│   ├── browser-store.js           # 保留 0.1 适配器供迁移测试
│   └── runtime-store.js           # 0.2 快照、0.1 导入、安全单键提交
├── ui/
│   ├── views.js                   # 现有世界视图 + 动态对象视图
│   ├── action-form.js             # 由制度动作定义生成通用表单
│   └── policy-view.js             # 制度编辑、检查结果、历史视图
├── app-controller.js              # 改为制度感知控制器
├── app.js                         # 不再导入固定动作函数
└── demo/seed-world.js             # 接收编译制度模型创建演示世界

tests/
├── policy-compiler.test.mjs
├── policy-actions.test.mjs
├── policy-compatibility.test.mjs
├── runtime-store.test.mjs
├── policy-controller.test.mjs
├── policy-ui.test.mjs
└── policy-hot-update.test.mjs
```

---

### Task 1: 实现中文制度解析器、编译器和初始制度源码

**Files:**
- Create: `src/policy/initial-policy-source.js`
- Create: `src/policy/parser.js`
- Create: `src/policy/compiler.js`
- Create: `tests/policy-compiler.test.mjs`
- Read/keep compatible: `src/runtime/world.js`
- Read/translate semantics from: `src/model/organization-model.js`, `src/model/organization-actions.js`

**Interfaces:**
- Produces: `INITIAL_POLICY_SOURCE: string`
- Produces: `parsePolicy(source: string) -> { ast, errors }`
- Produces: `compilePolicy(source: string) -> { ok, policy, errors }`
- `policy` exposes at least `name`, `version`, `entityTypes`, `relationTypes`, `stateSlots`, `actions`
- `errors[]` exposes `kind`, `line`, `sourceLine`, `message`

- [ ] **Step 1: Write failing compiler tests**

`tests/policy-compiler.test.mjs` must assert:

```js
const result = compilePolicy(INITIAL_POLICY_SOURCE);
assert.equal(result.ok, true);
assert.deepEqual(result.policy.entityTypes, ['成员', '部门', '项目组']);
assert.deepEqual(result.policy.relationTypes.负责人, { subjects: ['部门', '项目组'], objects: ['成员'] });
assert.ok(result.policy.actions.some((action) => action.name === '成员离职'));
assert.ok(result.policy.actions.some((action) => action.name === '更换负责人'));
```

Also pin: line-numbered syntax diagnostics; duplicate type/relation/action names; invalid initial state; undefined relation endpoints; undefined/reused bindings; multi-type input `输入 对象 部门 项目组`; invalid mixed `文本 成员`; and a multi-type effect that is not valid for every possible type.

- [ ] **Step 2: Run compiler test and confirm RED**

Run: `node --test tests/policy-compiler.test.mjs`

Expected: FAIL because policy modules do not exist.

- [ ] **Step 3: Implement line parser**

Implement `parsePolicy(source)` in `src/policy/parser.js`. Blocks use explicit `结束`; every AST node preserves the source line number and raw line. Do not implement indentation semantics or free-form tokenization.

- [ ] **Step 4: Implement compiler and semantic checks**

Implement `compilePolicy(source)` in `src/policy/compiler.js`; compile the AST to the runtime-compatible model shape plus normalized actions. Static checks must include all main-spec checks plus amendment checks for multi-type inputs and `取消所有关系` patterns.

- [ ] **Step 5: Encode current 0.1 semantics as initial Chinese policy**

`INITIAL_POLICY_SOURCE` must define members/departments/projects, their state slots and relationships, and all current primary actions. `更换负责人` and `成员离职` must use the amendment's generic constructs rather than hidden JS helpers.

- [ ] **Step 6: Run compiler regression**

Run: `npm test`

Expected: existing tests plus compiler tests PASS; no existing runtime tests regress.

- [ ] **Step 7: Commit**

```bash
git add src/policy/initial-policy-source.js src/policy/parser.js src/policy/compiler.js tests/policy-compiler.test.mjs
git commit -m "feat: 编译中文组织制度"
```

---

### Task 2: 实现制度动作物化器并复用现有原子事件事务

**Files:**
- Create: `src/policy/action-runtime.js`
- Create: `tests/policy-actions.test.mjs`
- Modify: `src/runtime/events.js`
- Modify: `tests/events.test.mjs`

**Interfaces:**
- Consumes: Task 1 compiled `policy`
- Consumes: current `World`
- Produces: `materializePolicyAction({ policy, world, actionName, inputs, idFactory }) -> Event`
- `Event` contains `type`, `params`, `actorId`, `operations`, `policyVersion`
- Modify `executeEvent(...)` so returned record also contains `policyVersion`

- [ ] **Step 1: Write failing action-materialization tests**

Pin at least:

```js
const event = materializePolicyAction({ policy, world, actionName: '人员调岗', inputs, idFactory });
assert.deepEqual(event.operations.map((op) => op.kind), ['取消关系', '建立关系']);
assert.equal(event.policyVersion, policy.version);
```

Also test: text input creates entity with policy-defined initial states; entity input rejects wrong type; multi-type input accepts department/project but rejects member; relation/state requirements fail with Chinese error; created output binding can be reused by later effects; all emitted operation kinds are one of the existing four.

- [ ] **Step 2: Write amendment-specific RED tests**

Construct a world with multiple owners and assert `更换负责人` expands every old owner relation to `取消关系` before one `建立关系`. Construct a member with department, multiple projects and multiple owned objects and assert `成员离职` expands all relevant relations. Assert zero-match `取消所有关系` is a legal no-op.

- [ ] **Step 3: Run action tests and confirm RED**

Run: `node --test tests/policy-actions.test.mjs`

Expected: FAIL because `materializePolicyAction` does not exist.

- [ ] **Step 4: Implement input binding, requirements and effect materialization**

`src/policy/action-runtime.js` validates all inputs against compiled definitions, evaluates only the supported state/relation requirements, creates output IDs through `idFactory`, reads initial states from the policy, and expands effects in source order.

For `取消所有关系`, iterate current `world.relations` in existing array order and expand matching relations to ordinary `取消关系` operations; `*` never creates a binding.

- [ ] **Step 5: Propagate policy version into audit records**

Modify `executeEvent` so `record.policyVersion === event.policyVersion ?? null` for both success and failure records without changing rollback behavior.

- [ ] **Step 6: Run action and transaction regression**

Run: `npm test`

Expected: all tests PASS, including existing atomic rollback tests.

- [ ] **Step 7: Commit**

```bash
git add src/policy/action-runtime.js src/runtime/events.js tests/policy-actions.test.mjs tests/events.test.mjs
git commit -m "feat: 运行制度定义的组织动作"
```

---

### Task 3: 实现候选制度兼容性检查与变化摘要

**Files:**
- Create: `src/policy/compatibility.js`
- Create: `tests/policy-compatibility.test.mjs`

**Interfaces:**
- Produces: `checkPolicyCompatibility(world, candidatePolicy) -> { compatible, conflicts }`
- Produces: `diffPolicies(currentPolicy, candidatePolicy) -> { addedTypes, removedTypes, addedRelations, removedRelations, addedActions, removedActions, changedStates }`
- Each conflict contains `kind`, `entityId?`, `relation?`, `slot?`, `message`

- [ ] **Step 1: Write compatible-upgrade RED test**

Compile a candidate that adds `委员会`, relation `参加`, and actions `创建委员会` / `加入委员会`; assert `compatible === true` against the existing seeded world and `diffPolicies` reports additions.

- [ ] **Step 2: Write destructive-candidate RED tests**

Pin three conflicts: removing `项目组` while project instances exist (conflict lists the concrete project IDs/names); removing allowed state `在职` while current members use it; removing/changing `参与` so an existing relation becomes illegal.

- [ ] **Step 3: Run test and confirm RED**

Run: `node --test tests/policy-compatibility.test.mjs`

Expected: FAIL because compatibility module does not exist.

- [ ] **Step 4: Implement fact-by-fact candidate validation**

Do not encode “adds are allowed, deletes are forbidden” as the decision rule. Validate every existing entity type, existing state slot/value and relation against the candidate policy; return all discovered conflicts in deterministic world order.

- [ ] **Step 5: Implement policy diff summary**

Diff is presentation metadata only and must not decide compatibility.

- [ ] **Step 6: Run full regression and commit**

Run: `npm test`

Expected: PASS.

```bash
git add src/policy/compatibility.js tests/policy-compatibility.test.mjs
git commit -m "feat: 检查制度热更新兼容性"
```

---

### Task 4: 升级为 0.2 运行时快照并安全迁移 0.1 浏览器数据

**Files:**
- Create: `src/storage/runtime-store.js`
- Create: `tests/runtime-store.test.mjs`
- Modify: `src/demo/seed-world.js`
- Keep: `src/storage/browser-store.js` for legacy parsing/regression only

**Interfaces:**
- Produces: `createRuntimeStore(storage, { key, legacyKey, runtimeFormatVersion, initialPolicySource, compilePolicy, now }) -> RuntimeStore`
- `RuntimeStore.load() -> SnapshotV2 | null` (loads v2; if absent, imports valid v0.1 once)
- `RuntimeStore.commit(snapshot: SnapshotV2) -> void`
- `RuntimeStore.reset(snapshot: SnapshotV2) -> void`
- Snapshot fields: `runtimeFormatVersion`, `currentPolicyVersion`, `policyVersions`, `world`, `events`
- Modify: `createSeedWorld(policy) -> World`; the seed no longer imports fixed `ORGANIZATION_MODEL`

- [ ] **Step 1: Write fresh-0.2 store RED test**

Assert one-key atomic commit/read round-trip and runtime format rejection for any format other than `组织运行时-2`.

- [ ] **Step 2: Write exact 0.1 migration RED test**

Seed legacy key `organization-runtime-v0.1` with a real v0.1-shaped snapshot. Assert migrated v2 snapshot:

```js
assert.equal(snapshot.runtimeFormatVersion, '组织运行时-2');
assert.equal(snapshot.currentPolicyVersion, '组织制度-1');
assert.ok(snapshot.policyVersions.some((p) => p.version === '组织制度-1'));
assert.equal(snapshot.events.every((e) => e.policyVersion === '组织制度-1'), true);
```

Also assert entities/relations/states/metadata are preserved, old event fields survive, legacy `world.modelVersion` is moved to migration-source metadata and is not an authoritative current policy field, and the legacy key remains untouched.

- [ ] **Step 3: Add migration-failure and idempotence tests**

Pin: malformed legacy JSON leaves legacy bytes untouched; v2 write failure leaves no partial v2 key; when both keys exist, only v2 is loaded; after successful migration, repeated `load()` does not import legacy changes again.

- [ ] **Step 4: Run store tests and confirm RED**

Run: `node --test tests/runtime-store.test.mjs`

Expected: FAIL.

- [ ] **Step 5: Implement runtime store and migration**

Use a single JSON value under the v2 key for each commit. Migration first constructs and validates the complete v2 snapshot in memory, then performs exactly one `setItem` for v2 and never deletes/modifies v1.

- [ ] **Step 6: Make seed world policy-driven**

`createSeedWorld(policy)` must use the compiled policy for all entity/state/relation validation. Remove `modelVersion` as a current-policy authority; if retained for backwards compatibility in input, move it under metadata only.

- [ ] **Step 7: Run full regression and commit**

Run: `npm test`

Expected: PASS.

```bash
git add src/storage/runtime-store.js src/demo/seed-world.js tests/runtime-store.test.mjs
git commit -m "feat: 迁移组织运行时到 0.2 快照"
```

---

### Task 5: 改造控制器为制度感知运行时，并实现制度检查/激活

**Files:**
- Modify: `src/app-controller.js`
- Create: `tests/policy-controller.test.mjs`

**Interfaces:**
- Replace main-path constructor with `createOrganizationApp({ store, seedFactory, initialPolicySource, compilePolicy, materializePolicyAction, checkPolicyCompatibility, diffPolicies, now, idFactory })`
- Produces: `start() -> { world, events, policy, policyHistory }`
- Produces: `dispatchAction(actionName, inputs) -> { world, events, policy, record }`
- Produces: `checkPolicySource(source) -> { ok, policy?, errors, compatibility?, diff? }`
- Produces: `activatePolicySource(source) -> { world, events, policy, record }`
- Produces: `reset() -> state`

- [ ] **Step 1: Write controller RED tests for dynamic policy lookup**

Start with `组织制度-1`, dispatch one action, activate a compatible `组织制度-2` that adds committee actions, then call `dispatchAction('创建委员会', ...)` on the *same controller instance*. Assert it succeeds and event record uses `组织制度-2`.

- [ ] **Step 2: Write rejected activation tests**

Duplicate policy version, compile failure and incompatibility must return a non-activatable check result and never alter store/current state.

- [ ] **Step 3: Write atomic activation failure test**

Use a store whose commit throws during activation. Assert controller's in-memory current policy/version, world and events remain exactly as before the attempted activation.

- [ ] **Step 4: Run controller tests and confirm RED**

Run: `node --test tests/policy-controller.test.mjs`

Expected: FAIL against the current fixed-model controller.

- [ ] **Step 5: Implement policy-aware state resolution**

Every dispatch resolves `snapshot.currentPolicyVersion` into the immutable policy record at call time; do not cache a permanent model captured at controller construction.

- [ ] **Step 6: Implement check and activation**

`checkPolicySource` compiles, checks duplicate version, computes diff and compatibility without persistence. `activatePolicySource` repeats authoritative validation, builds one new snapshot containing appended immutable policy record, switched current version and a `制度生效` event, commits once, then updates in-memory state only after commit succeeds.

- [ ] **Step 7: Run full regression and commit**

Run: `npm test`

Expected: PASS.

```bash
git add src/app-controller.js tests/policy-controller.test.mjs
git commit -m "feat: 支持制度在线检查与激活"
```

---

### Task 6: 让网页 GUI 完全由当前制度和当前世界驱动

**Files:**
- Create: `src/ui/action-form.js`
- Create: `src/ui/policy-view.js`
- Modify: `src/ui/views.js`
- Modify: `src/app.js`
- Modify: `styles.css`
- Create: `tests/policy-ui.test.mjs`
- Modify: `tests/views.test.mjs`

**Interfaces:**
- Produces: `renderActionOptions(policy) -> string`
- Produces: `renderActionFields(policy, actionName, world) -> string`
- Produces: `readActionInputs(action, formData) -> object`
- Produces: `renderPolicyManager({ policy, policyHistory, draftSource, checkResult }) -> string`
- Produces: `renderGenericObjects(world, policy, events, { type, selectedId }) -> string`

- [ ] **Step 1: Write generic-action-form RED tests**

Compile a policy with a new `委员会` type and action `加入委员会`; assert the generated form contains a member selector and committee selector without any source-code branch that names `加入委员会`. Test multi-type input merges departments/projects into one selector. Test simple state requirements can prefilter candidates when statically resolvable.

- [ ] **Step 2: Write policy-page and generic-object RED tests**

Assert policy view renders current version, source, history, compile/compatibility errors and an activation button only when checks pass. Assert `renderGenericObjects` renders committee instances, states, inbound/outbound relations and related events.

- [ ] **Step 3: Add static hard-coding constraints**

Read `src/app.js` and assert it does **not** import `organization-actions.js`, does not contain the old action-label map keys, and does not branch on names such as `成员离职` / `更换负责人` / `创建项目` to build fields.

- [ ] **Step 4: Run UI tests and confirm RED**

Run: `node --test tests/policy-ui.test.mjs tests/views.test.mjs`

Expected: FAIL.

- [ ] **Step 5: Implement generic action panel**

`app.js` gets available actions from the current compiled policy; submission reads the selected action's normalized inputs and calls `controller.dispatchAction`. Text/entity/multi-type input rendering belongs in `action-form.js`.

- [ ] **Step 6: Implement policy manager and dynamic object navigation**

Upgrade the policy page to source editor + “检查制度” + result + conditional “使其生效” + history. Add a generic navigation/section for compiled entity types other than the specialized `成员` / `部门` / `项目组` views; no code change should be needed for `委员会`.

- [ ] **Step 7: Remove fixed model from page main path**

`app.js` must no longer import `ORGANIZATION_MODEL` as current truth. Existing specialized views receive the current compiled policy where needed.

- [ ] **Step 8: Run full regression and commit**

Run: `npm test`

Expected: PASS.

```bash
git add src/ui/action-form.js src/ui/policy-view.js src/ui/views.js src/app.js styles.css tests/policy-ui.test.mjs tests/views.test.mjs
git commit -m "feat: 用制度动态生成组织操作界面"
```

---

### Task 7: 以委员会热更新场景完成端到端验收并部署线上

**Files:**
- Create: `tests/policy-hot-update.test.mjs`
- Modify only if a route issue appears: Railway Function `organization-language-live` (current `/src/**/*.js` proxy should already cover new modules)

**Interfaces:**
- Consumes all Task 1–6 public interfaces
- Produces no new product API; this task is integration proof and deployment verification

- [ ] **Step 1: Write full hot-update acceptance test**

Start from a running 0.1/`组织制度-1` world with existing members, departments, a project and historical events. Compile/check/activate `组织制度-2` adding:

```text
存在类型 委员会
状态 生命周期状态 初始 运行中 可为 运行中 已结束
关系 参加：成员 -> 委员会
动作 创建委员会
动作 加入委员会
```

Assert activation preserves all pre-existing world facts and history, appends an immutable policy record and `制度生效` event, then use the same controller to create `架构委员会` and add an existing member. Assert normal events use `组织制度-2` and `参加` relation is visible.

- [ ] **Step 2: Add destructive candidate rejection to the same flow**

Compile a syntactically valid `组织制度-3` that removes `项目组` while a project still exists. Assert compatibility fails with the concrete project conflict, activation is unavailable/rejected, and current policy/world/history remain exactly at the post-committee state.

- [ ] **Step 3: Add amendment regression to end-to-end flow**

Under the active compiled policy, create multiple owner relations then execute `更换负责人`; assert only the new owner remains. Give one member department/project/owner relationships then execute `成员离职`; assert all required relationships are removed and the entity remains with `任职状态=离职`.

- [ ] **Step 4: Run complete fresh verification**

Run: `npm test`

Expected: all tests PASS, 0 FAIL. Record exact total.

- [ ] **Step 5: Commit acceptance test**

```bash
git add tests/policy-hot-update.test.mjs
git commit -m "test: 验证制度热更新完整闭环"
```

- [ ] **Step 6: Sync `organization-runtime-web` branch and verify Railway source paths**

Push/sync the finished branch. The existing Railway Function already proxies `/index.html`, `/styles.css`, and any safe `/src/.../*.js`; only modify its source if live fetch proves a new module path is blocked.

- [ ] **Step 7: Live verification**

Verify the existing public URL returns HTTP 200 and shows the 0.2 policy manager. Verify representative modules such as `/src/policy/compiler.js`, `/src/policy/action-runtime.js`, `/src/storage/runtime-store.js`, `/src/ui/policy-view.js` return 200 JavaScript, while `/package.json` remains 404.

- [ ] **Step 8: Browser-visible acceptance**

Using live page content or browser automation if available, verify current policy version is shown, the policy editor/check flow exists, and the initial action list is generated from policy. Do not claim click-level E2E behavior unless it is actually executed; rely on `policy-hot-update.test.mjs` for semantic end-to-end proof otherwise.

- [ ] **Step 9: Final verification before completion claim**

Run `npm test` once more on the exact tree that was synced, then check Railway environment status and live URL. Completion claim must report test count, deployment status, and any unverified browser-interaction limitations.
