import { executeEvent } from './runtime/events.js';

export function createOrganizationApp({ store, seedFactory, model, now, idFactory }) {
  let world = null;
  let events = [];

  function snapshot(record = undefined) {
    const result = { world: structuredClone(world), events: structuredClone(events) };
    if (record !== undefined) result.record = structuredClone(record);
    return result;
  }

  return {
    start() {
      const stored = store.loadWorld();
      if (stored) {
        world = stored;
        events = store.loadEvents();
      } else {
        const seed = seedFactory();
        store.commit({ world: seed, event: null });
        world = seed;
        events = [];
      }
      return snapshot();
    },

    dispatch(event) {
      if (!world) this.start();
      const result = executeEvent(world, event, { model, now, idFactory });
      store.commit({ world: result.world, event: result.record });
      world = result.world;
      events = store.loadEvents();
      return snapshot(result.record);
    },

    reset() {
      store.reset();
      const seed = seedFactory();
      store.commit({ world: seed, event: null });
      world = seed;
      events = [];
      return snapshot();
    },

    getState() {
      if (!world) return this.start();
      return snapshot();
    },
  };
}
