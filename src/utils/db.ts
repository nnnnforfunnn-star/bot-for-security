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
      return null;
    }
  },
  
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      if (redis) {
        if (ttlSeconds) await redis.set(key, value, { ex: ttlSeconds });
        else await redis.set(key, value);
      } else {
        memCache.set(key, value);
      }
    } catch (e) {}
  },
  
  async incr(key: string): Promise<number> {
    try {
      if (redis) return await redis.incr(key);
      const val = (memCache.get(key) || 0) + 1;
      memCache.set(key, val);
      return val;
    } catch (e) { return 0; }
  },

  async del(key: string): Promise<void> {
    try {
      if (redis) await redis.del(key);
      else memCache.delete(key);
    } catch (e) {}
  },

  // --- Новые методы для Рейтингов (Сый-Урмат Top) ---
  async zincrby(key: string, increment: number, member: string | number): Promise<number> {
    try {
      if (redis) return await redis.zincrby(key, increment, member.toString());
      return 0;
    } catch (e) { return 0; }
  },

  async zrange(key: string, start: number, stop: number, opts?: { withScores?: boolean, rev?: boolean }): Promise<any[]> {
    try {
      if (redis) return await redis.zrange(key, start, stop, opts);
      return [];
    } catch (e) { return []; }
  },

  // --- Новые методы для Автоответов (Filters) ---
  async hset(key: string, field: string, value: string): Promise<void> {
    try {
      if (redis) await redis.hset(key, { [field]: value });
    } catch (e) {}
  },

  async hgetall(key: string): Promise<Record<string, string> | null> {
    try {
      if (redis) return await redis.hgetall<Record<string, string>>(key);
      return null;
    } catch (e) { return null; }
  },

  async hdel(key: string, field: string): Promise<void> {
    try {
      if (redis) await redis.hdel(key, field);
    } catch (e) {}
  }
};

