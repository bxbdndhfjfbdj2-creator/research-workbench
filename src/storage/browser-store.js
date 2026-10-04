export class StorageError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StorageError';
  }
}

export function createBrowserStore(storage, { key, modelVersion }) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new StorageError('存储适配器不可用');
  }

  function inspect() {
    const raw = storage.getItem(key);
    if (raw == null) return null;
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (error) {
      throw new StorageError('组织世界存储数据已损坏，无法解析', error);
    }
    if (!snapshot || snapshot.modelVersion !== modelVersion) {
      throw new StorageError(`组织模型版本不兼容：需要 ${modelVersion}，实际 ${snapshot?.modelVersion ?? '未知'}`);
    }
    if (!snapshot.world || !Array.isArray(snapshot.events)) {
      throw new StorageError('组织世界存储结构不完整');
    }
    return structuredClone(snapshot);
  }

  return {
    inspect,
    loadWorld() {
      return inspect()?.world ?? null;
    },
    loadEvents() {
      return inspect()?.events ?? [];
    },
    commit({ world, event }) {
      const previous = inspect();
      const events = previous?.events ? structuredClone(previous.events) : [];
      if (event) events.push(structuredClone(event));
      const snapshot = { modelVersion, world: structuredClone(world), events };
      let encoded;
      try {
        encoded = JSON.stringify(snapshot);
      } catch (error) {
        throw new StorageError('组织世界无法序列化', error);
      }
      try {
        storage.setItem(key, encoded);
      } catch (error) {
        throw new StorageError('组织世界持久化失败', error);
      }
    },
    reset() {
      try {
        storage.removeItem(key);
      } catch (error) {
        throw new StorageError('组织世界重置失败', error);
      }
    },
  };
}
