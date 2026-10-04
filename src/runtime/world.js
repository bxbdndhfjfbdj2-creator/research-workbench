function clone(value) {
  return structuredClone(value);
}

function assertKnownType(type, model) {
  if (!model.entityTypes.includes(type)) throw new Error(`未知实体类型：${type}`);
}

function assertEntityShape(entity, model) {
  if (!entity?.id || !entity?.name || !entity?.type) throw new Error('实体必须包含 id、name 和 type');
  assertKnownType(entity.type, model);
  const slots = model.stateSlots[entity.type] || {};
  for (const [slot, value] of Object.entries(entity.states || {})) {
    if (!slots[slot]) throw new Error(`实体类型 ${entity.type} 不支持状态：${slot}`);
    if (!slots[slot].includes(value)) throw new Error(`未知状态值：${slot}=${value}`);
  }
}

export function createEmptyWorld({ name, modelVersion }) {
  return { name, modelVersion, entities: [], relations: [], eventHistory: [], metadata: {} };
}

export function getEntity(world, id) {
  return world.entities.find((entity) => entity.id === id) || null;
}

export function getEntitiesByType(world, type) {
  return world.entities.filter((entity) => entity.type === type);
}

export function getRelations(world, filter = {}) {
  return world.relations.filter((relation) => Object.entries(filter).every(([key, value]) => value == null || relation[key] === value));
}

export function createEntity(world, entity, model) {
  assertEntityShape(entity, model);
  if (getEntity(world, entity.id)) throw new Error(`实体已存在：${entity.id}`);
  if (world.entities.some((item) => item.name === entity.name)) throw new Error(`实体名称已存在：${entity.name}`);
  const next = clone(world);
  next.entities.push({ ...clone(entity), states: clone(entity.states || {}) });
  return next;
}

export function setState(world, { entityId, slot, value }, model) {
  const entity = getEntity(world, entityId);
  if (!entity) throw new Error(`目标实体不存在：${entityId}`);
  const allowed = model.stateSlots[entity.type]?.[slot];
  if (!allowed) throw new Error(`实体类型 ${entity.type} 不支持状态：${slot}`);
  if (!allowed.includes(value)) throw new Error(`未知状态值：${slot}=${value}`);
  const next = clone(world);
  getEntity(next, entityId).states[slot] = value;
  return next;
}

function assertRelation(world, relation, model) {
  const rule = model.relationTypes[relation.type];
  if (!rule) throw new Error(`未知关系类型：${relation.type}`);
  const subject = getEntity(world, relation.subjectId);
  const object = getEntity(world, relation.objectId);
  if (!subject) throw new Error(`关系主体不存在：${relation.subjectId}`);
  if (!object) throw new Error(`关系目标不存在：${relation.objectId}`);
  if (!rule.subjects.includes(subject.type) || !rule.objects.includes(object.type)) {
    throw new Error(`关系 ${relation.type} 的主体或目标类型不合法`);
  }
}

function sameRelation(a, b) {
  return a.subjectId === b.subjectId && a.type === b.type && a.objectId === b.objectId;
}

export function addRelation(world, relation, model) {
  assertRelation(world, relation, model);
  if (world.relations.some((item) => sameRelation(item, relation))) return clone(world);
  const next = clone(world);
  next.relations.push(clone(relation));
  return next;
}

export function removeRelation(world, relation, model) {
  assertRelation(world, relation, model);
  const index = world.relations.findIndex((item) => sameRelation(item, relation));
  if (index === -1) throw new Error(`关系不存在：${relation.type}`);
  const next = clone(world);
  next.relations.splice(index, 1);
  return next;
}
