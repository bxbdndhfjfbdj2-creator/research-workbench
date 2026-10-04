import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_MODEL } from '../src/model/organization-model.js';
import {
  createEmptyWorld,
  createEntity,
  setState,
  addRelation,
  removeRelation,
  getEntity,
  getEntitiesByType,
  getRelations,
} from '../src/runtime/world.js';
import { createSeedWorld } from '../src/demo/seed-world.js';

test('组织模型只定义稳定类型而不包含演示实例', () => {
  assert.deepEqual(ORGANIZATION_MODEL.entityTypes, ['成员', '部门', '项目组']);
  assert.equal(JSON.stringify(ORGANIZATION_MODEL).includes('张三'), false);
});

test('空世界和实体写操作保持不可变', () => {
  const world = createEmptyWorld({ name: '星河公司', modelVersion: ORGANIZATION_MODEL.version });
  assert.deepEqual(world.entities, []);
  assert.deepEqual(world.relations, []);
  const withMember = createEntity(world, {
    id: 'member-1', name: '张三', type: '成员', states: { 任职状态: '在职' },
  }, ORGANIZATION_MODEL);
  assert.equal(withMember.entities.length, 1);
  assert.equal(world.entities.length, 0);
  assert.equal(getEntity(withMember, 'member-1').name, '张三');
  assert.equal(getEntitiesByType(withMember, '成员').length, 1);
});

test('状态值必须符合实体类型定义且更新不修改原世界', () => {
  let world = createEmptyWorld({ name: '测试', modelVersion: ORGANIZATION_MODEL.version });
  world = createEntity(world, { id: 'm1', name: '甲', type: '成员', states: { 任职状态: '在职' } }, ORGANIZATION_MODEL);
  const changed = setState(world, { entityId: 'm1', slot: '任职状态', value: '离职' }, ORGANIZATION_MODEL);
  assert.equal(getEntity(changed, 'm1').states.任职状态, '离职');
  assert.equal(getEntity(world, 'm1').states.任职状态, '在职');
  assert.throws(() => setState(world, { entityId: 'm1', slot: '任职状态', value: '未知' }, ORGANIZATION_MODEL), /状态|未知/);
});

test('关系方向由组织模型严格约束', () => {
  let world = createEmptyWorld({ name: '测试', modelVersion: ORGANIZATION_MODEL.version });
  for (const entity of [
    { id: 'm1', name: '甲', type: '成员', states: { 任职状态: '在职' } },
    { id: 'd1', name: '研发部', type: '部门', states: { 生命周期状态: '运行中' } },
    { id: 'p1', name: '项目甲', type: '项目组', states: { 生命周期状态: '运行中' } },
  ]) world = createEntity(world, entity, ORGANIZATION_MODEL);

  world = addRelation(world, { subjectId: 'm1', type: '属于', objectId: 'd1' }, ORGANIZATION_MODEL);
  world = addRelation(world, { subjectId: 'd1', type: '负责人', objectId: 'm1' }, ORGANIZATION_MODEL);
  world = addRelation(world, { subjectId: 'p1', type: '负责人', objectId: 'm1' }, ORGANIZATION_MODEL);
  assert.equal(getRelations(world, { type: '负责人' }).length, 2);
  assert.throws(() => addRelation(world, { subjectId: 'd1', type: '属于', objectId: 'm1' }, ORGANIZATION_MODEL), /关系|类型/);
});

test('完全重复关系幂等，取消不存在关系报错', () => {
  let world = createEmptyWorld({ name: '测试', modelVersion: ORGANIZATION_MODEL.version });
  world = createEntity(world, { id: 'm1', name: '甲', type: '成员', states: { 任职状态: '在职' } }, ORGANIZATION_MODEL);
  world = createEntity(world, { id: 'd1', name: '研发部', type: '部门', states: { 生命周期状态: '运行中' } }, ORGANIZATION_MODEL);
  const relation = { subjectId: 'm1', type: '属于', objectId: 'd1' };
  world = addRelation(world, relation, ORGANIZATION_MODEL);
  world = addRelation(world, relation, ORGANIZATION_MODEL);
  assert.equal(world.relations.length, 1);
  const removed = removeRelation(world, relation, ORGANIZATION_MODEL);
  assert.equal(removed.relations.length, 0);
  assert.throws(() => removeRelation(removed, relation, ORGANIZATION_MODEL), /不存在/);
});

test('演示种子与稳定模型分离并包含预期运行时实例', () => {
  const seed = createSeedWorld();
  assert.equal(seed.name, '星河公司');
  assert.equal(getEntitiesByType(seed, '成员').length, 3);
  assert.equal(getEntitiesByType(seed, '部门').length, 2);
  assert.ok(getRelations(seed, { type: '负责人' }).length >= 2);
});
