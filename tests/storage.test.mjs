import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_MODEL } from '../src/model/organization-model.js';
import { createSeedWorld } from '../src/demo/seed-world.js';
import { createBrowserStore, StorageError } from '../src/storage/browser-store.js';

class FakeStorage {
  constructor() { this.map = new Map(); this.failWrites = false; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.failWrites) throw new Error('quota'); this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const options = { key: 'org-world', modelVersion: ORGANIZATION_MODEL.version };

test('单次提交后同时读回世界与事件历史', () => {
  const storage = new FakeStorage();
  const store = createBrowserStore(storage, options);
  const world = createSeedWorld();
  const event = { id: 'event-1', type: '测试', status: '成功' };
  store.commit({ world, event });
  assert.deepEqual(store.loadWorld(), world);
  assert.deepEqual(store.loadEvents(), [event]);
  assert.deepEqual(store.inspect(), { modelVersion: ORGANIZATION_MODEL.version, world, events: [event] });
});

test('连续提交会保留已有事件并用新世界替换快照', () => {
  const storage = new FakeStorage();
  const store = createBrowserStore(storage, options);
  const world1 = createSeedWorld();
  store.commit({ world: world1, event: { id: 'e1', status: '成功' } });
  const world2 = structuredClone(world1);
  world2.metadata.marker = 'new';
  store.commit({ world: world2, event: { id: 'e2', status: '失败' } });
  assert.equal(store.loadWorld().metadata.marker, 'new');
  assert.deepEqual(store.loadEvents().map((e) => e.id), ['e1', 'e2']);
});

test('损坏 JSON 抛 StorageError 且不会覆盖原字符串', () => {
  const storage = new FakeStorage();
  storage.setItem(options.key, '{broken');
  const store = createBrowserStore(storage, options);
  assert.throws(() => store.loadWorld(), StorageError);
  assert.equal(storage.getItem(options.key), '{broken');
});

test('模型版本不兼容时拒绝加载且不自动清空', () => {
  const storage = new FakeStorage();
  const raw = JSON.stringify({ modelVersion: '旧模型', world: createSeedWorld(), events: [] });
  storage.setItem(options.key, raw);
  const store = createBrowserStore(storage, options);
  assert.throws(() => store.inspect(), /版本/);
  assert.equal(storage.getItem(options.key), raw);
});

test('底层写入失败时旧快照保持不变', () => {
  const storage = new FakeStorage();
  const store = createBrowserStore(storage, options);
  const world = createSeedWorld();
  store.commit({ world, event: { id: 'e1', status: '成功' } });
  const before = storage.getItem(options.key);
  storage.failWrites = true;
  const changed = structuredClone(world);
  changed.metadata.marker = 'uncommitted';
  assert.throws(() => store.commit({ world: changed, event: { id: 'e2', status: '成功' } }), StorageError);
  assert.equal(storage.getItem(options.key), before);
});

test('只有显式 reset 才删除快照', () => {
  const storage = new FakeStorage();
  const store = createBrowserStore(storage, options);
  store.commit({ world: createSeedWorld(), event: { id: 'e1', status: '成功' } });
  store.reset();
  assert.equal(store.loadWorld(), null);
  assert.deepEqual(store.loadEvents(), []);
  assert.equal(store.inspect(), null);
});
