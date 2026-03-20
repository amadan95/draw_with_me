import { Redis } from "@upstash/redis";

const DAILY_LIMIT = 40;
const memoryStore =
  (globalThis as typeof globalThis & {
    __drawQuotaStore?: Map<string, { count: number; expiresAt: number }>;
  }).__drawQuotaStore ?? new Map<string, { count: number; expiresAt: number }>();

(globalThis as typeof globalThis & {
  __drawQuotaStore?: Map<string, { count: number; expiresAt: number }>;
}).__drawQuotaStore = memoryStore;

function getDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getRedisClient() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  return Redis.fromEnv();
}

export async function consumeDailyQuota(userId: string) {
  const redis = getRedisClient();
  const dayKey = getDayKey();
  const key = `draw-quota:${dayKey}:${userId}`;

  if (redis) {
    const nextValue = await redis.incr(key);
    if (nextValue === 1) {
      await redis.expire(key, 60 * 60 * 48);
    }

    return {
      used: nextValue,
      limit: DAILY_LIMIT,
      allowed: nextValue <= DAILY_LIMIT
    };
  }

  const record = memoryStore.get(key);
  const now = Date.now();

  if (!record || record.expiresAt < now) {
    memoryStore.set(key, {
      count: 1,
      expiresAt: now + 1000 * 60 * 60 * 24
    });
    return {
      used: 1,
      limit: DAILY_LIMIT,
      allowed: true
    };
  }

  record.count += 1;
  memoryStore.set(key, record);
  return {
    used: record.count,
    limit: DAILY_LIMIT,
    allowed: record.count <= DAILY_LIMIT
  };
}
