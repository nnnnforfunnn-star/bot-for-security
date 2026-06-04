import { bot } from "../src/bot.js";
import { config } from "../src/config.js";
import { logger } from "../src/utils/logger.js";

// Инициализируем бота один раз (grammY рекомендует для Serverless)
let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

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

    await bot.handleUpdate(req.body);
    return res.status(200).send("OK");
  } catch (error) {
    logger.error("Error handling update", error);
    return res.status(500).send("Internal Server Error");
  }
}


