export function createConversationQueue({ concurrency = 2, limit = 30, onError = () => {} } = {}) {
  const pending = [];
  const activeKeys = new Set();
  let active = 0;
  function pump() {
    while (active < concurrency) {
      const index = pending.findIndex(job => !activeKeys.has(job.key));
      if (index < 0) return;
      const job = pending.splice(index, 1)[0];
      active++; activeKeys.add(job.key);
      Promise.resolve().then(job.run).catch(onError).finally(() => {
        active--; activeKeys.delete(job.key); pump();
      });
    }
  }
  return {
    get size() { return pending.length + active; },
    get active() { return active; },
    add(key, run) {
      if (pending.length + active >= limit) return false;
      pending.push({ key, run }); pump(); return true;
    }
  };
}
