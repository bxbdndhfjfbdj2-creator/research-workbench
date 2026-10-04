import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_MODEL } from '../src/model/organization-model.js';
import {
  hireMember, createDepartment, createProject, assignDepartment, removeDepartmentMember,
  transferMember, joinProject, leaveProject, setOwner, leaveOrganization, endEntity,
} from '../src/model/organization-actions.js';
import { createOrganizationApp } from '../src/app-controller.js';
import { createBrowserStore } from '../src/storage/browser-store.js';
import { createSeedWorld } from '../src/demo/seed-world.js';

class FakeStorage { constructor(){this.map=new Map();} getItem(k){return this.map.get(k)??null;} setItem(k,v){this.map.set(k,String(v));} removeItem(k){this.map.delete(k);} }
const fixedNow = () => '2026-10-04T12:00:00.000Z';
function ids(){ let n=0; return () => `generated-${++n}`; }

test('组织动作只编译为通用原子操作', () => {
  assert.deepEqual(hireMember({ name: '赵六' }).operations, [
    { kind: '创建存在', entity: { name: '赵六', type: '成员', states: { 任职状态: '在职' } } },
  ]);
  assert.equal(createDepartment({ name: '人工智能部' }).operations[0].entity.type, '部门');
  assert.equal(createProject({ name: '火星计划' }).operations[0].entity.type, '项目组');
  assert.deepEqual(transferMember({ memberId:'m', fromDepartmentId:'d1', toDepartmentId:'d2' }).operations, [
    { kind:'取消关系', relation:{ subjectId:'m', type:'属于', objectId:'d1' } },
    { kind:'建立关系', relation:{ subjectId:'m', type:'属于', objectId:'d2' } },
  ]);
  assert.equal(assignDepartment({ memberId:'m', departmentId:'d' }).operations[0].kind, '建立关系');
  assert.equal(removeDepartmentMember({ memberId:'m', departmentId:'d' }).operations[0].kind, '取消关系');
  assert.equal(joinProject({ memberId:'m', projectId:'p' }).operations[0].relation.type, '参与');
  assert.equal(leaveProject({ memberId:'m', projectId:'p' }).operations[0].kind, '取消关系');
});

test('更换负责人先取消所有当前负责人再建立新负责人', () => {
  const event = setOwner({ targetId:'p1', currentOwnerIds:['m1','m2'], memberId:'m3' });
  assert.deepEqual(event.operations.map((op)=>op.kind), ['取消关系','取消关系','建立关系']);
  assert.deepEqual(event.operations.at(-1).relation, { subjectId:'p1', type:'负责人', objectId:'m3' });
});

test('离职动作设置离职状态并清理成员参与和负责人关系', () => {
  const relations = [
    { subjectId:'m1', type:'属于', objectId:'d1' },
    { subjectId:'m1', type:'参与', objectId:'p1' },
    { subjectId:'d1', type:'负责人', objectId:'m1' },
    { subjectId:'p1', type:'负责人', objectId:'m1' },
    { subjectId:'m2', type:'属于', objectId:'d1' },
  ];
  const event = leaveOrganization({ memberId:'m1', relations });
  assert.deepEqual(event.operations[0], { kind:'设置状态', change:{ entityId:'m1', slot:'任职状态', value:'离职' } });
  assert.equal(event.operations.filter((op)=>op.kind==='取消关系').length, 4);
  assert.equal(event.operations.some((op)=>op.relation?.subjectId==='m2'), false);
});

test('结束部门或项目只编译为生命周期状态变化', () => {
  assert.deepEqual(endEntity({ entityId:'d1', type:'部门' }).operations, [
    { kind:'设置状态', change:{ entityId:'d1', slot:'生命周期状态', value:'已结束' } },
  ]);
});

test('控制器持久化成功和失败事件，并可由新控制器恢复', () => {
  const storage = new FakeStorage();
  const store = createBrowserStore(storage, { key:'org', modelVersion:ORGANIZATION_MODEL.version });
  const app1 = createOrganizationApp({ store, seedFactory:createSeedWorld, model:ORGANIZATION_MODEL, now:fixedNow, idFactory:ids() });
  let state = app1.start();
  assert.equal(state.world.name, '星河公司');
  assert.deepEqual(state.events, []);

  state = app1.dispatch(createDepartment({ name:'人工智能部' }));
  assert.equal(state.record.status, '成功');
  const ai = state.world.entities.find((e)=>e.name==='人工智能部');
  assert.ok(ai);

  const app2 = createOrganizationApp({ store, seedFactory:createSeedWorld, model:ORGANIZATION_MODEL, now:fixedNow, idFactory:ids() });
  state = app2.start();
  assert.ok(state.world.entities.some((e)=>e.name==='人工智能部'));
  assert.equal(state.events.length, 1);

  const before = structuredClone(state.world);
  state = app2.dispatch(transferMember({ memberId:'member-zhangsan', fromDepartmentId:'dept-rd', toDepartmentId:'missing' }));
  assert.equal(state.record.status, '失败');
  assert.deepEqual(state.world, before);

  const app3 = createOrganizationApp({ store, seedFactory:createSeedWorld, model:ORGANIZATION_MODEL, now:fixedNow, idFactory:ids() });
  state = app3.start();
  assert.deepEqual(state.world, before);
  assert.equal(state.events.at(-1).status, '失败');
});

test('控制器只有在存储提交成功后才替换内存状态', () => {
  const world = createSeedWorld();
  const events = [];
  const store = {
    loadWorld: () => world,
    loadEvents: () => events,
    commit: () => { throw new Error('写入失败'); },
    reset: () => {},
  };
  const app = createOrganizationApp({ store, seedFactory:createSeedWorld, model:ORGANIZATION_MODEL, now:fixedNow, idFactory:ids() });
  const started = app.start();
  assert.throws(() => app.dispatch(createDepartment({ name:'不会保存' })), /写入失败/);
  assert.deepEqual(app.getState().world, started.world);
});
