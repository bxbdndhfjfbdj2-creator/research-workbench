import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_MODEL } from '../src/model/organization-model.js';
import { createSeedWorld, createSeedWorld as seedFactory } from '../src/demo/seed-world.js';
import { getEntity, getRelations } from '../src/runtime/world.js';
import { executeEvent } from '../src/runtime/events.js';

const context = {
  model: ORGANIZATION_MODEL,
  now: () => '2026-10-04T12:00:00.000Z',
  idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
};

test('复合事件中途失败时世界完整回滚并留下失败记录', () => {
  const seed = createSeedWorld();
  const invalidTransfer = {
    type: '人员调岗',
    params: { memberId: 'member-zhangsan', targetDepartmentId: 'dept-missing' },
    actorId: null,
    operations: [
      { kind: '取消关系', relation: { subjectId: 'member-zhangsan', type: '属于', objectId: 'dept-rd' } },
      { kind: '建立关系', relation: { subjectId: 'member-zhangsan', type: '属于', objectId: 'dept-missing' } },
    ],
  };
  const result = executeEvent(seed, invalidTransfer, context);
  assert.equal(result.record.status, '失败');
  assert.deepEqual(result.world, seed);
  assert.match(result.record.error, /目标|不存在/);
  assert.deepEqual(result.record.changes, []);
});

test('成功事件原子提交并记录变化', () => {
  const seed = createSeedWorld();
  const event = {
    type: '新建项目', params: { name: '火星计划' }, actorId: null,
    operations: [
      { kind: '创建存在', entity: { id: 'project-mars', name: '火星计划', type: '项目组', states: { 生命周期状态: '运行中' } } },
    ],
  };
  const result = executeEvent(seed, event, context);
  assert.equal(result.record.status, '成功');
  assert.equal(getEntity(result.world, 'project-mars').name, '火星计划');
  assert.equal(result.record.changes.length, 1);
  assert.equal(result.record.type, '新建项目');
  assert.equal(result.record.occurredAt, '2026-10-04T12:00:00.000Z');
});

test('取消不存在关系得到失败记录且世界不变', () => {
  const seed = createSeedWorld();
  const result = executeEvent(seed, {
    type: '退出项目', params: {}, actorId: null,
    operations: [{ kind: '取消关系', relation: { subjectId: 'member-zhangsan', type: '参与', objectId: 'dept-rd' } }],
  }, context);
  assert.equal(result.record.status, '失败');
  assert.deepEqual(result.world, seed);
});

test('重复建立完全相同关系成功但不产生重复事实', () => {
  const seed = createSeedWorld();
  const before = getRelations(seed, { subjectId: 'member-zhangsan', type: '属于', objectId: 'dept-rd' }).length;
  const result = executeEvent(seed, {
    type: '重复建立', params: {}, actorId: null,
    operations: [{ kind: '建立关系', relation: { subjectId: 'member-zhangsan', type: '属于', objectId: 'dept-rd' } }],
  }, context);
  assert.equal(result.record.status, '成功');
  assert.equal(getRelations(result.world, { subjectId: 'member-zhangsan', type: '属于', objectId: 'dept-rd' }).length, before);
  assert.deepEqual(result.record.changes, []);
});

test('非法负责人方向得到失败记录', () => {
  const seed = seedFactory();
  const result = executeEvent(seed, {
    type: '错误任命', params: {}, actorId: null,
    operations: [{ kind: '建立关系', relation: { subjectId: 'member-zhangsan', type: '负责人', objectId: 'dept-rd' } }],
  }, context);
  assert.equal(result.record.status, '失败');
  assert.deepEqual(result.world, seed);
  assert.match(result.record.error, /负责人|类型|关系/);
});

test('设置状态事件可更新世界且保留原世界', () => {
  const seed = createSeedWorld();
  const result = executeEvent(seed, {
    type: '成员离职', params: {}, actorId: 'member-lisi',
    operations: [{ kind: '设置状态', change: { entityId: 'member-lisi', slot: '任职状态', value: '离职' } }],
  }, context);
  assert.equal(result.record.status, '成功');
  assert.equal(getEntity(result.world, 'member-lisi').states.任职状态, '离职');
  assert.equal(getEntity(seed, 'member-lisi').states.任职状态, '在职');
  assert.equal(result.record.actorId, 'member-lisi');
});
