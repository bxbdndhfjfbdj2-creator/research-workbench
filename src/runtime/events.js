import { addRelation, createEntity, removeRelation, setState } from './world.js';

function nextId(idFactory, prefix) {
  if (typeof idFactory === 'function') return idFactory(prefix);
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function applyOperation(world, operation, { model, idFactory }) {
  switch (operation.kind) {
    case '创建存在': {
      const entity = structuredClone(operation.entity || {});
      if (!entity.id) entity.id = nextId(idFactory, 'entity');
      return { world: createEntity(world, entity, model), change: { kind: operation.kind, entityId: entity.id, name: entity.name, type: entity.type } };
    }
    case '设置状态':
      return { world: setState(world, operation.change, model), change: { kind: operation.kind, ...structuredClone(operation.change) } };
    case '建立关系':
      return { world: addRelation(world, operation.relation, model), change: { kind: operation.kind, ...structuredClone(operation.relation) } };
    case '取消关系':
      return { world: removeRelation(world, operation.relation, model), change: { kind: operation.kind, ...structuredClone(operation.relation) } };
    default:
      throw new Error(`未知操作类型：${operation.kind}`);
  }
}

export function applyOperations(world, operations, { model, idFactory } = {}) {
  let working = structuredClone(world);
  const changes = [];
  for (const operation of operations || []) {
    const result = applyOperation(working, operation, { model, idFactory });
    working = result.world;
    changes.push(result.change);
  }
  return { world: working, changes };
}

export function executeEvent(world, event, { model, now = () => new Date().toISOString(), idFactory } = {}) {
  const baseRecord = {
    id: nextId(idFactory, 'event'),
    type: event.type,
    params: structuredClone(event.params || {}),
    occurredAt: typeof now === 'function' ? now() : String(now),
    actorId: event.actorId ?? null,
    status: '失败',
    changes: [],
    error: null,
  };

  try {
    const result = applyOperations(world, event.operations || [], { model, idFactory });
    return {
      world: result.world,
      record: { ...baseRecord, status: '成功', changes: result.changes, error: null },
    };
  } catch (error) {
    return {
      world,
      record: { ...baseRecord, status: '失败', changes: [], error: error instanceof Error ? error.message : String(error) },
    };
  }
}
