import { bot } from "../src/bot.js";
import { config } from "../src/config.js";
import { logger } from "../src/utils/logger.js";

// Добавляем глобальные обработчики для защиты процесса от непредвиденных падений
process.on("unhandledRejection", (reason, promise) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error("Unhandled Rejection at Promise", err, { promise: String(promise) });
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception thrown", error);
});

let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Ручная проверка секретного токена вебхука (Безопасность)
  if (config.WEBHOOK_SECRET) {
    const telegramSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (telegramSecret !== config.WEBHOOK_SECRET) {
      logger.warn("Unauthorized webhook access attempt.");
      return res.status(403).send("Forbidden");
    }
  }

  try {
    if (!isBotInitialized) {
      await bot.init();
      isBotInitialized = true;
      logger.info("Бот инициализирован в Serverless-окружении.");
    }

    // Таймаут-предохранитель на 8.5 секунд. Если Vercel Serverless Function висит слишком долго,
    // мы принудительно возвращаем 200 OK, чтобы Telegram не уходил в бесконечный retry-цикл.
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Update processing timeout")), 8500)
    );

    await Promise.race([
      bot.handleUpdate(req.body),
      timeoutPromise
    ]);

    return res.status(200).send("OK");
  } catch (error: any) {
    if (error?.message === "Update processing timeout") {
      logger.warn(`Update ${req.body?.update_id} timed out. Responding with 200 OK to prevent Telegram retry loop.`);
      return res.status(200).send("OK");
    }
    
    logger.error("Error handling update", error);
    // Возвращаем 200 OK при любых внутренних ошибках обработки сообщения,
    // чтобы Telegram не спамил повторными запросами этого же апдейта.
    return res.status(200).send("OK");
  }
}


