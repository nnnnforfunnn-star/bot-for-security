import { Redis as UpstashRedis } from "@upstash/redis";
import { createClient } from "redis";
import { logger } from "./logger.js";
import fs from "fs";
import path from "path";

// 1. Поддержка TCP Redis (через обычный redis:// URL)
let redisTCPClient: any = null;

async function getRedisTCPClient() {
  if (!process.env.REDIS_URL) return null;
  try {
    if (!redisTCPClient) {
      redisTCPClient = createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 500),
          connectTimeout: 5000
        }
      });
      redisTCPClient.on("error", (err: any) => {
        logger.error("Redis TCP Client Error", err);
      });
    }
    if (!redisTCPClient.isOpen) {
      await redisTCPClient.connect();
      logger.info("Успешно подключена база данных Redis по TCP.");
    }
    return redisTCPClient;
  } catch (err) {
    logger.error("Ошибка при подключении к Redis TCP", err);
    return null;
  }
}

// 2. Поддержка REST Redis (Upstash)
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let upstashClient: UpstashRedis | null = null;
if (upstashUrl && upstashToken) {
  upstashClient = new UpstashRedis({ url: upstashUrl, token: upstashToken });
  logger.info("Успешно подключена база данных Redis по HTTP REST (Upstash).");
}

// 3. Локальная база (Резервная память)
const DB_FILE = path.resolve(process.cwd(), "database.json");
let memCache = new Map<string, any>();

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

function saveLocalDB() {
  try {
    const obj = Object.fromEntries(memCache);
    fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {}
}

if (!process.env.REDIS_URL && !upstashClient) {
  loadLocalDB();
  logger.warn("Redis не настроен! Используется временная память (database.json).");
}

export const db = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        const val = await tcp.get(key);
        if (val === null) return null;
        try {
          return JSON.parse(val) as T;
        } catch {
          return val as unknown as T;
        }
      }
      if (upstashClient) return await upstashClient.get<T>(key);
      return memCache.get(key) || null;
    } catch (e) {
      return null;
    }
  },
  
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      const strVal = typeof value === "string" ? value : JSON.stringify(value);
      if (tcp) {
        if (ttlSeconds) {
          await tcp.set(key, strVal, { EX: ttlSeconds });
        } else {
          await tcp.set(key, strVal);
        }
        return;
      }
      if (upstashClient) {
        if (ttlSeconds) await upstashClient.set(key, value, { ex: ttlSeconds });
        else await upstashClient.set(key, value);
        return;
      }
      memCache.set(key, value);
      if (ttlSeconds) {
        setTimeout(() => {
          memCache.delete(key);
          saveLocalDB();
        }, ttlSeconds * 1000).unref?.();
      }
      saveLocalDB();
    } catch (e) {}
  },
  
  async incr(key: string): Promise<number> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) return await tcp.incr(key);
      if (upstashClient) return await upstashClient.incr(key);
      const val = (memCache.get(key) || 0) + 1;
      memCache.set(key, val);
      saveLocalDB();
      return val;
    } catch (e) { return 0; }
  },

  async incrby(key: string, increment: number): Promise<number> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) return await tcp.incrBy(key, increment);
      if (upstashClient) return await upstashClient.incrby(key, increment);
      const val = (memCache.get(key) || 0) + increment;
      memCache.set(key, val);
      saveLocalDB();
      return val;
    } catch (e) { return 0; }
  },

  async del(key: string): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.del(key);
        return;
      }
      if (upstashClient) {
        await upstashClient.del(key);
        return;
      }
      memCache.delete(key);
      saveLocalDB();
    } catch (e) {}
  },

  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.expire(key, ttlSeconds);
        return;
      }
      if (upstashClient) {
        await upstashClient.expire(key, ttlSeconds);
        return;
      }
      setTimeout(() => {
        memCache.delete(key);
        saveLocalDB();
      }, ttlSeconds * 1000).unref?.();
    } catch (e) {}
  },

  async zincrby(key: string, increment: number, member: string | number): Promise<number> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        const res = await tcp.zIncrBy(key, increment, member.toString());
        return parseFloat(res);
      }
      if (upstashClient) return await upstashClient.zincrby(key, increment, member.toString());
      const zkey = `${key}:${member}`;
      const val = (memCache.get(zkey) || 0) + increment;
      memCache.set(zkey, val);
      saveLocalDB();
      return val;
    } catch (e) { return 0; }
  },

  async zadd(key: string, score: number, member: string | number): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.zAdd(key, { score, value: member.toString() });
        return;
      }
      if (upstashClient) {
        await upstashClient.zadd(key, { score, member: member.toString() });
        return;
      }
      const zkey = `${key}:${member}`;
      memCache.set(zkey, score);
      saveLocalDB();
    } catch (e) {}
  },

  async zrange(key: string, start: number, stop: number, opts?: { withScores?: boolean, rev?: boolean }): Promise<any[]> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        if (opts?.withScores) {
          const res = await tcp.zRangeWithScores(key, start, stop, { REV: opts?.rev });
          return res.flatMap((item: any) => [item.value, item.score]);
        } else {
          return await tcp.zRange(key, start, stop, { REV: opts?.rev });
        }
      }
      if (upstashClient) return await upstashClient.zrange(key, start, stop, opts);
      return [];
    } catch (e) { return []; }
  },

  async hset(key: string, field: string, value: string): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.hSet(key, field, value);
        return;
      }
      if (upstashClient) {
        await upstashClient.hset(key, { [field]: value });
        return;
      }
      const hash = memCache.get(key) || {};
      hash[field] = value;
      memCache.set(key, hash);
      saveLocalDB();
    } catch (e) {}
  },

  async hget<T = string>(key: string, field: string): Promise<T | null> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        const res = await tcp.hGet(key, field);
        if (res === null || res === undefined) return null;
        try {
          return JSON.parse(res) as T;
        } catch {
          return res as unknown as T;
        }
      }
      if (upstashClient) return await upstashClient.hget<T>(key, field);
      const hash = memCache.get(key) || {};
      return hash[field] !== undefined ? hash[field] : null;
    } catch (e) { return null; }
  },

  async hgetall(key: string): Promise<Record<string, string> | null> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        const res = await tcp.hGetAll(key);
        if (!res || Object.keys(res).length === 0) return null;
        return res;
      }
      if (upstashClient) return await upstashClient.hgetall<Record<string, string>>(key);
      return memCache.get(key) || null;
    } catch (e) { return null; }
  },

  async hdel(key: string, field: string): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.hDel(key, field);
        return;
      }
      if (upstashClient) {
        await upstashClient.hdel(key, field);
        return;
      }
      const hash = memCache.get(key);
      if (hash) {
        delete hash[field];
        memCache.set(key, hash);
        saveLocalDB();
      }
    } catch (e) {}
  },

  async lpush(key: string, value: any): Promise<void> {
    try {
      const strVal = typeof value === "string" ? value : JSON.stringify(value);
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.lPush(key, strVal);
        await tcp.lTrim(key, 0, 99);
        return;
      }
      if (upstashClient) {
        await upstashClient.lpush(key, strVal);
        await upstashClient.ltrim(key, 0, 99);
        return;
      }
      const list = memCache.get(key) || [];
      list.unshift(strVal);
      if (list.length > 100) list.pop();
      memCache.set(key, list);
      saveLocalDB();
    } catch (e) {}
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) return await tcp.lRange(key, start, stop);
      if (upstashClient) return await upstashClient.lrange(key, start, stop);
      const list = memCache.get(key) || [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    } catch (e) { return []; }
  },

  async sadd(key: string, member: string | number): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.sAdd(key, member.toString());
        return;
      }
      if (upstashClient) {
        await upstashClient.sadd(key, member);
        return;
      }
      const set = new Set(memCache.get(key) || []);
      set.add(member.toString());
      memCache.set(key, Array.from(set));
      saveLocalDB();
    } catch (e) {}
  },

  async smembers(key: string): Promise<string[]> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) return await tcp.sMembers(key);
      if (upstashClient) return await upstashClient.smembers(key);
      return memCache.get(key) || [];
    } catch (e) { return []; }
  },

  async srem(key: string, member: string | number): Promise<void> {
    try {
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.sRem(key, member.toString());
        return;
      }
      if (upstashClient) {
        await upstashClient.srem(key, member);
        return;
      }
      const set = new Set(memCache.get(key) || []);
      set.delete(member.toString());
      memCache.set(key, Array.from(set));
      saveLocalDB();
    } catch (e) {}
  },

  async rpush(key: string, value: any): Promise<void> {
    try {
      const strVal = typeof value === "string" ? value : JSON.stringify(value);
      const tcp = await getRedisTCPClient();
      if (tcp) {
        await tcp.rPush(key, strVal);
        return;
      }
      if (upstashClient) {
        await upstashClient.rpush(key, strVal);
        return;
      }
      const list = memCache.get(key) || [];
      list.push(strVal);
      memCache.set(key, list);
      saveLocalDB();
    } catch (e) {}
  }
};
