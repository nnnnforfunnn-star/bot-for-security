import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";
import { config } from "../src/config.js";
import { logger } from "../src/utils/logger.js";

/**
 * Vercel Serverless Function для приема вебхуков от Telegram.
 *
 * Vercel автоматически парсит тело запроса и помещает его в req.body,
 * поэтому используем адаптер "express" (он читает req.body, а не raw stream).
 * Секретный токен проверяется через встроенную опцию grammY secretToken.
 */
const handleUpdate = webhookCallback(bot, "express", {
  secretToken: config.WEBHOOK_SECRET || undefined,
});

export default handleUpdate;
