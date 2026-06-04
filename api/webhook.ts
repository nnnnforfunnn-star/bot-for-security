import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";
import { config } from "../src/config.js";
import { logger } from "../src/utils/logger.js";

// Создаем обработчик вебхука для Vercel (совместимый с Express/Node.js HTTP)
const handleUpdate = webhookCallback(bot, "express");

/**
 * Основной обработчик запросов от Telegram API на серверах Vercel.
 * Защищен с помощью секретного токена X-Telegram-Bot-Api-Secret-Token.
 */
export default async function handler(req: any, res: any): Promise<void> {
  // Логируем входящие запросы только в режиме отладки или для диагностики
  logger.info(`Получен вебхук запрос: ${req.method} ${req.url}`);

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  // Защита вебхука: верифицируем секретный токен, заданный при setWebhook
  if (config.WEBHOOK_SECRET) {
    const telegramSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (telegramSecret !== config.WEBHOOK_SECRET) {
      logger.warn("Попытка несанкционированного доступа к вебхуку. Секретный токен неверен.");
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
  }

  try {
    // Передаем запрос во встроенный обработчик grammY
    await handleUpdate(req, res);
  } catch (error) {
    logger.error("Критическая ошибка при обработке вебхука на Vercel", error);
    // Vercel ожидает, что мы закроем соединение в случае ошибки
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  }
}
