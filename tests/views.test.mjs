import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ORGANIZATION_MODEL } from '../src/model/organization-model.js';
import { createSeedWorld } from '../src/demo/seed-world.js';
import { createEntity, addRelation, setState } from '../src/runtime/world.js';
import {
  renderOverview, renderPeople, renderDepartments, renderProjects,
  renderRelations, renderEvents, renderPolicy,
} from '../src/ui/views.js';

function richWorld() {
  let world = createSeedWorld();
  world = createEntity(world, { id:'dept-ai', name:'人工智能部', type:'部门', states:{ 生命周期状态:'运行中' } }, ORGANIZATION_MODEL);
  world = createEntity(world, { id:'project-mars', name:'火星计划', type:'项目组', states:{ 生命周期状态:'运行中' } }, ORGANIZATION_MODEL);
  world = addRelation(world, { subjectId:'member-zhangsan', type:'属于', objectId:'dept-ai' }, ORGANIZATION_MODEL);
  world = addRelation(world, { subjectId:'member-zhangsan', type:'参与', objectId:'project-mars' }, ORGANIZATION_MODEL);
  world = addRelation(world, { subjectId:'member-wangwu', type:'参与', objectId:'project-mars' }, ORGANIZATION_MODEL);
  world = addRelation(world, { subjectId:'project-mars', type:'负责人', objectId:'member-wangwu' }, ORGANIZATION_MODEL);
  return world;
}

test('部门视图随世界数据动态变化而不是写死实例', () => {
  const a = renderDepartments(createSeedWorld(), [], {});
  const b = renderDepartments(richWorld(), [], {});
  assert.match(a, /研发部/);
  assert.doesNotMatch(a, /人工智能部/);
  assert.match(b, /人工智能部/);
});

test('人员详情显示状态、所属部门、参与项目和负责对象', () => {
  const world = richWorld();
  const html = renderPeople(world, [], { selectedId:'member-wangwu' });
  assert.match(html, /在职/);
  assert.match(html, /财务部/);
  assert.match(html, /火星计划/);
  assert.match(html, /负责/);
});

test('项目视图显示跨部门参与成员', () => {
  const html = renderProjects(richWorld(), [], { selectedId:'project-mars' });
  assert.match(html, /张三/);
  assert.match(html, /王五/);
  assert.match(html, /研发部|人工智能部/);
  assert.match(html, /财务部/);
});

test('部门和项目详情展示与当前对象相关的最近事件', () => {
  const world = richWorld();
  const events = [
    { id:'e1', type:'成员加入部门', params:{memberId:'member-zhangsan',departmentId:'dept-ai'}, status:'成功', changes:[] },
    { id:'e2', type:'加入项目', params:{memberId:'member-wangwu',projectId:'project-mars'}, status:'成功', changes:[] },
  ];
  assert.match(renderDepartments(world, events, { selectedId:'dept-ai' }), /成员加入部门/);
  assert.match(renderProjects(world, events, { selectedId:'project-mars' }), /加入项目/);
});

test('关系视图用可读箭头表示当前关系', () => {
  const html = renderRelations(richWorld());
  assert.match(html, /张三\s*—属于→\s*人工智能部/);
  assert.match(html, /火星计划\s*—负责人→\s*王五/);
});

test('事件视图同时显示参数、成功失败和失败原因', () => {
  const html = renderEvents([
    { id:'e1', type:'创建部门', params:{name:'人工智能部'}, status:'成功', occurredAt:'2026-10-04', changes:[{}], error:null },
    { id:'e2', type:'人员调岗', params:{memberId:'member-zhangsan',toDepartmentId:'missing'}, status:'失败', occurredAt:'2026-10-04', changes:[], error:'目标部门不存在' },
  ]);
  assert.match(html, /创建部门/);
  assert.match(html, /成功/);
  assert.match(html, /人员调岗/);
  assert.match(html, /失败/);
  assert.match(html, /目标部门不存在/);
  assert.match(html, /事件参数/);
  assert.match(html, /member-zhangsan/);
  assert.match(html, /人工智能部/);
});

test('总览与制度页来自当前世界和稳定模型', () => {
  const overview = renderOverview(richWorld(), []);
  assert.match(overview, /3/);
  assert.match(overview, /3/);
  assert.match(overview, /1/);
  const policy = renderPolicy(ORGANIZATION_MODEL);
  assert.match(policy, /组织模型-0\.1/);
  assert.match(policy, /成员/);
  assert.match(policy, /负责人/);
});

test('视图会转义实体名称避免注入 HTML', () => {
  let world = createSeedWorld();
  world = createEntity(world, { id:'x', name:'<script>坏</script>', type:'部门', states:{生命周期状态:'运行中'} }, ORGANIZATION_MODEL);
  const html = renderDepartments(world, [], {});
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('静态网页壳层不写死演示实例且不再依赖旧引擎', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  for (const name of ['张三','研发部','火星计划']) assert.equal(html.includes(name), false);
  assert.match(html, /总览/);
  assert.match(html, /人员/);
  assert.match(html, /部门/);
  assert.match(html, /项目/);
  assert.match(html, /关系/);
  assert.match(html, /事件/);
  assert.match(html, /制度/);
  assert.equal(app.includes("./engine.js"), false);
});
