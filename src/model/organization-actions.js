function event(type, params, operations) {
  return { type, params: structuredClone(params || {}), actorId: null, operations };
}

export function hireMember({ name }) {
  return event('成员入职', { name }, [
    { kind: '创建存在', entity: { name, type: '成员', states: { 任职状态: '在职' } } },
  ]);
}

export function createDepartment({ name }) {
  return event('创建部门', { name }, [
    { kind: '创建存在', entity: { name, type: '部门', states: { 生命周期状态: '运行中' } } },
  ]);
}

export function createProject({ name }) {
  return event('创建项目', { name }, [
    { kind: '创建存在', entity: { name, type: '项目组', states: { 生命周期状态: '运行中' } } },
  ]);
}

export function assignDepartment({ memberId, departmentId }) {
  return event('成员加入部门', { memberId, departmentId }, [
    { kind: '建立关系', relation: { subjectId: memberId, type: '属于', objectId: departmentId } },
  ]);
}

export function removeDepartmentMember({ memberId, departmentId }) {
  return event('成员移出部门', { memberId, departmentId }, [
    { kind: '取消关系', relation: { subjectId: memberId, type: '属于', objectId: departmentId } },
  ]);
}

export function transferMember({ memberId, fromDepartmentId, toDepartmentId }) {
  return event('人员调岗', { memberId, fromDepartmentId, toDepartmentId }, [
    { kind: '取消关系', relation: { subjectId: memberId, type: '属于', objectId: fromDepartmentId } },
    { kind: '建立关系', relation: { subjectId: memberId, type: '属于', objectId: toDepartmentId } },
  ]);
}

export function joinProject({ memberId, projectId }) {
  return event('加入项目', { memberId, projectId }, [
    { kind: '建立关系', relation: { subjectId: memberId, type: '参与', objectId: projectId } },
  ]);
}

export function leaveProject({ memberId, projectId }) {
  return event('退出项目', { memberId, projectId }, [
    { kind: '取消关系', relation: { subjectId: memberId, type: '参与', objectId: projectId } },
  ]);
}

export function setOwner({ targetId, currentOwnerIds = [], memberId }) {
  const operations = currentOwnerIds.map((ownerId) => ({
    kind: '取消关系',
    relation: { subjectId: targetId, type: '负责人', objectId: ownerId },
  }));
  operations.push({ kind: '建立关系', relation: { subjectId: targetId, type: '负责人', objectId: memberId } });
  return event('更换负责人', { targetId, memberId }, operations);
}

export function leaveOrganization({ memberId, relations = [] }) {
  const relevant = relations.filter((relation) =>
    (relation.subjectId === memberId && ['属于', '参与'].includes(relation.type)) ||
    (relation.objectId === memberId && relation.type === '负责人'));
  return event('成员离职', { memberId }, [
    { kind: '设置状态', change: { entityId: memberId, slot: '任职状态', value: '离职' } },
    ...relevant.map((relation) => ({ kind: '取消关系', relation: structuredClone(relation) })),
  ]);
}

export function endEntity({ entityId, type }) {
  if (!['部门', '项目组'].includes(type)) throw new Error(`不支持结束的类型：${type}`);
  return event(type === '部门' ? '结束部门' : '结束项目', { entityId, type }, [
    { kind: '设置状态', change: { entityId, slot: '生命周期状态', value: '已结束' } },
  ]);
}
