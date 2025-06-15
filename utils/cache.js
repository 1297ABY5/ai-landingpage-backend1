const memoryCache = new Map();

export async function getCache(key) {
  return memoryCache.get(key) || null;
}

export async function setCache(key, value, ttlSeconds = 21600) {
  memoryCache.set(key, value);
  setTimeout(() => memoryCache.delete(key), ttlSeconds * 1000);
}
