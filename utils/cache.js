// utils/cache.js
import logger from './logger.js';

const DEFAULT_TTL = 21600; // 6 hours

export async function getCache(client, key) {
  try {
    const data = await client.get(`cache:${key}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error(`Error getting from cache for key ${key}:`, error);
    return null;
  }
}

export async function setCache(client, key, value, ttl = DEFAULT_TTL) {
  try {
    await client.setex(`cache:${key}`, ttl, JSON.stringify(value));
    logger.debug(`Cache SET for key ${key} with TTL ${ttl}s`);
  } catch (error) {
    logger.error(`Error setting cache for key ${key}:`, error);
  }
}
