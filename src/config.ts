import dotenv from "dotenv";

// Загружаем переменные окружения для локальной разработки
dotenv.config();

export interface Config {
  BOT_TOKEN: string;
  NODE_ENV: string;
  WEBHOOK_URL?: string;
  WEBHOOK_SECRET?: string;
  KV_URL?: string;
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  APP_URL?: string;
}

function getEnv(key: string, required = false): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Критическая ошибка конфигурации: Переменная окружения ${key} обязательна для заполнения.`);
  }
  return value || "";
}

export const config: Config = {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  NODE_ENV: getEnv("NODE_ENV") || "development",
  KV_URL: process.env.KV_URL || "",
  KV_REST_API_URL: process.env.KV_REST_API_URL || "",
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN || "",
  WEBHOOK_URL: process.env.WEBHOOK_URL || "",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "",
  APP_URL: process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://bot-for-security.vercel.app")
};
