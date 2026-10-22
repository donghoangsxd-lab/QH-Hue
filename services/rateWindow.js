function allow(store, key, now, max, windowMs) {
  const list = (store.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    store.set(key, list);
    return false;
  }
  list.push(now);
  if (store.size > 5000) store.clear();
  store.set(key, list);
  return true;
}

module.exports = { allow };
