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

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;

  if (process.env.VERCEL_URL) {
    const url = process.env.VERCEL_URL.toLowerCase();
    
    // Если URL уже чистый (без дефисов-хешей) или это кастомный домен
    if (!url.includes("-")) {
      return `https://${url}`;
    }

    const repoSlug = process.env.VERCEL_GIT_REPO_SLUG;
    if (repoSlug) {
      return `https://${repoSlug}.vercel.app`;
    }

    const parts = url.split("-");
    
    // 1. Поиск "-git-" (например: project-name-git-main-scope.vercel.app)
    const gitIndex = parts.indexOf("git");
    if (gitIndex > 0) {
      return `https://${parts.slice(0, gitIndex).join("-")}.vercel.app`;
    }

    // 2. Поиск хеша деплоя (например: project-name-dz987hsa-scope.vercel.app)
    // Хеш обычно состоит из букв и цифр, длина от 7 до 12 символов
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.length >= 7 && part.length <= 12 && /[0-9]/.test(part) && /[a-z]/.test(part)) {
        return `https://${parts.slice(0, i).join("-")}.vercel.app`;
      }
    }

    // 3. Резервный вариант: если содержит scope-суффиксы Vercel
    const vercelIndex = parts.findIndex(p => p.includes("projects.vercel.app") || p === "projects");
    if (vercelIndex > 1) {
      // Обычно перед scope идет хеш деплоя, поэтому берем части до хеша (индекс vercelIndex - 2)
      return `https://${parts.slice(0, vercelIndex - 1).join("-")}.vercel.app`;
    }
    
    return `https://${url}`;
  }

  return "https://bot-for-security.vercel.app";
}

export const config: Config = {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  NODE_ENV: getEnv("NODE_ENV") || "development",
  KV_URL: process.env.KV_URL || "",
  KV_REST_API_URL: process.env.KV_REST_API_URL || "",
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN || "",
  WEBHOOK_URL: process.env.WEBHOOK_URL || "",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "",
  APP_URL: getAppUrl()
};
