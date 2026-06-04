import dotenv from "dotenv";

// Загружаем переменные окружения для локальной разработки
dotenv.config();

export interface Config {
  BOT_TOKEN: string;
  NODE_ENV: string;
  WEBHOOK_URL?: string;
  // Секретный токен для верификации запросов от Telegram (рекомендуется Telegram API)
  WEBHOOK_SECRET?: string;
}

function getEnv(key: string, required = false): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Критическая ошибка конфигурации: Переменная окружения ${key} обязательна для заполнения.`);
  }
  return value || "";
}

export const config: Config = {
  BOT_TOKEN: getEnv("BOT_TOKEN", true),
  NODE_ENV: getEnv("NODE_ENV") || "development",
  WEBHOOK_URL: getEnv("WEBHOOK_URL"),
  WEBHOOK_SECRET: getEnv("WEBHOOK_SECRET"),
};
