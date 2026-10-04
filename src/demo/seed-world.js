import { ORGANIZATION_MODEL } from '../model/organization-model.js';
import { addRelation, createEmptyWorld, createEntity } from '../runtime/world.js';

export function createSeedWorld() {
  let world = createEmptyWorld({ name: '星河公司', modelVersion: ORGANIZATION_MODEL.version });
  const entities = [
    { id: 'member-zhangsan', name: '张三', type: '成员', states: { 任职状态: '在职' } },
    { id: 'member-lisi', name: '李四', type: '成员', states: { 任职状态: '在职' } },
    { id: 'member-wangwu', name: '王五', type: '成员', states: { 任职状态: '在职' } },
    { id: 'dept-rd', name: '研发部', type: '部门', states: { 生命周期状态: '运行中' } },
    { id: 'dept-finance', name: '财务部', type: '部门', states: { 生命周期状态: '运行中' } },
  ];
  for (const entity of entities) world = createEntity(world, entity, ORGANIZATION_MODEL);
  for (const relation of [
    { subjectId: 'member-zhangsan', type: '属于', objectId: 'dept-rd' },
    { subjectId: 'member-lisi', type: '属于', objectId: 'dept-rd' },
    { subjectId: 'member-wangwu', type: '属于', objectId: 'dept-finance' },
    { subjectId: 'dept-rd', type: '负责人', objectId: 'member-lisi' },
    { subjectId: 'dept-finance', type: '负责人', objectId: 'member-wangwu' },
  ]) world = addRelation(world, relation, ORGANIZATION_MODEL);
  return world;
}
