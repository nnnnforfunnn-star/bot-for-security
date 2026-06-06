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

// Резервная память для локального тестирования или VPS (сохраняется в JSON файл)
import fs from "fs";
import path from "path";

const DB_FILE = path.resolve(process.cwd(), "database.json");
let memCache = new Map<string, any>();

// Инициализация локальной базы (чтение из файла)
function loadLocalDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(data);
      for (const key of Object.keys(parsed)) {
        memCache.set(key, parsed[key]);
      }
    }
  } catch (e) {
    logger.warn("Не удалось прочитать database.json");
  }
}

// Сохранение локальной базы (запись в файл)
function saveLocalDB() {
  try {
    const obj = Object.fromEntries(memCache);
    fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {}
}

if (!redis) {
  loadLocalDB();
}

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
        saveLocalDB();
      }
    } catch (e) {}
  },
  
  async incr(key: string): Promise<number> {
    try {
      if (redis) return await redis.incr(key);
      const val = (memCache.get(key) || 0) + 1;
      memCache.set(key, val);
      saveLocalDB();
      return val;
    } catch (e) { return 0; }
  },

  async del(key: string): Promise<void> {
    try {
      if (redis) await redis.del(key);
      else {
        memCache.delete(key);
        saveLocalDB();
      }
    } catch (e) {}
  },

  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      if (redis) await redis.expire(key, ttlSeconds);
    } catch (e) {}
  },

  async zincrby(key: string, increment: number, member: string | number): Promise<number> {
    try {
      if (redis) return await redis.zincrby(key, increment, member.toString());
      const zkey = `${key}:${member}`;
      const val = (memCache.get(zkey) || 0) + increment;
      memCache.set(zkey, val);
      saveLocalDB();
      return val;
    } catch (e) { return 0; }
  },

  async zrange(key: string, start: number, stop: number, opts?: { withScores?: boolean, rev?: boolean }): Promise<any[]> {
    try {
      if (redis) return await redis.zrange(key, start, stop, opts);
      return []; // Сложно реализовать без redis
    } catch (e) { return []; }
  },

  async hset(key: string, field: string, value: string): Promise<void> {
    try {
      if (redis) {
        await redis.hset(key, { [field]: value });
      } else {
        const hash = memCache.get(key) || {};
        hash[field] = value;
        memCache.set(key, hash);
        saveLocalDB();
      }
    } catch (e) {}
  },

  async hgetall(key: string): Promise<Record<string, string> | null> {
    try {
      if (redis) return await redis.hgetall<Record<string, string>>(key);
      return memCache.get(key) || null;
    } catch (e) { return null; }
  },

  async hdel(key: string, field: string): Promise<void> {
    try {
      if (redis) await redis.hdel(key, field);
      else {
        const hash = memCache.get(key);
        if (hash) {
          delete hash[field];
          memCache.set(key, hash);
          saveLocalDB();
        }
      }
    } catch (e) {}
  },

  async lpush(key: string, value: any): Promise<void> {
    try {
      const strVal = typeof value === "string" ? value : JSON.stringify(value);
      if (redis) {
        await redis.lpush(key, strVal);
        await redis.ltrim(key, 0, 99); // Keep only last 100 logs
      } else {
        const list = memCache.get(key) || [];
        list.unshift(strVal);
        if (list.length > 100) list.pop();
        memCache.set(key, list);
        saveLocalDB();
      }
    } catch (e) {}
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      if (redis) return await redis.lrange(key, start, stop);
      const list = memCache.get(key) || [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    } catch (e) { return []; }
  },

  async sadd(key: string, member: string | number): Promise<void> {
    try {
      if (redis) await redis.sadd(key, member);
      else {
        const set = new Set(memCache.get(key) || []);
        set.add(member.toString());
        memCache.set(key, Array.from(set));
        saveLocalDB();
      }
    } catch (e) {}
  },

  async smembers(key: string): Promise<string[]> {
    try {
      if (redis) return await redis.smembers(key);
      return memCache.get(key) || [];
    } catch (e) { return []; }
  }
};

