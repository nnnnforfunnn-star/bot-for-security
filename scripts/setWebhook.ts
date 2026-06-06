import { Bot } from "grammy";
import { config } from "../src/config.js";
import { logger } from "../src/utils/logger.js";

async function setWebhook() {
  if (!config.BOT_TOKEN) {
    throw new Error("BOT_TOKEN не установлен");
  }

  const bot = new Bot(config.BOT_TOKEN);
  const webhookUrl = `${config.APP_URL}/api/webhook`;

  logger.info(`Попытка зарегистрировать вебхук: ${webhookUrl}`);

  try {
    const success = await bot.api.setWebhook(webhookUrl, {
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query", "chat_member"]
    });

    if (success) {
      logger.info(`✅ Вебхук успешно установлен на: ${webhookUrl}`);
      const info = await bot.api.getWebhookInfo();
      logger.info(`Детали вебхука: ${JSON.stringify(info, null, 2)}`);
    } else {
      logger.error("❌ Не удалось установить вебхук.");
    }
  } catch (error) {
    logger.error("Ошибка при установке вебхука:", error);
  }
}

setWebhook();
