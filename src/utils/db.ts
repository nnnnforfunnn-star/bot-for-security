import { Redis } from "@upstash/redis";
import { logger } from "./logger.js";

// Используем переменные окружения Vercel Upstash Redis (или старые от KV)
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let redis: Redis | null = null;
if (url && token) {
  redis = new Redis({ url, token });
  logger.info("Успешно подключена база данных Redis (Vercel KV).");
} else {
  logger.warn("Redis URL/Token не найдены! Используется временная память (Сбросится при перезапуске). Для постоянной памяти добавьте Upstash Redis в Vercel.");
}

// Резервная память для локального тестирования
const memCache = new Map<string, any>();

export const db = {
  async get<T>(key: string): Promise<T | null> {
    try {
      if (redis) return await redis.get<T>(key);
      return memCache.get(key) || null;
    } catch (e) {
      logger.error(`DB Get Error [${key}]`, e);
      return null;
    }
  },
  
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      if (redis) {
        if (ttlSeconds) {
          await redis.set(key, value, { ex: ttlSeconds });
        } else {
          await redis.set(key, value);
        }
      } else {
        memCache.set(key, value);
      }
    } catch (e) {
      logger.error(`DB Set Error [${key}]`, e);
    }
  },
  
  async incr(key: string): Promise<number> {
    try {
      if (redis) return await redis.incr(key);
      const val = (memCache.get(key) || 0) + 1;
      memCache.set(key, val);
      return val;
    } catch (e) {
      logger.error(`DB Incr Error [${key}]`, e);
      return 0;
    }
  },

  async del(key: string): Promise<void> {
    try {
      if (redis) await redis.del(key);
      else memCache.delete(key);
    } catch (e) {
      logger.error(`DB Del Error [${key}]`, e);
    }
  }
};
