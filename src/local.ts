import { bot } from "./bot.js";
import { logger } from "./utils/logger.js";

async function startLocalDev() {
  logger.info("Запуск бота в режиме локальной разработки (Long Polling)...");

  try {
    // Получаем информацию о боте для проверки токена
    const botInfo = await bot.api.getMe();
    logger.info(`Бот успешно авторизован!`, {
      id: botInfo.id,
      username: botInfo.username,
      firstName: botInfo.first_name,
    });

    // Запускаем бота (метод long polling)
    // Перед запуском long polling желательно удалить вебхук, чтобы не было конфликтов
    logger.info("Удаляем активный вебхук (если есть) перед запуском Long Polling...");
    await bot.api.deleteWebhook({ drop_pending_updates: true });

    logger.info("Слушатель обновлений запущен. Нажмите Ctrl+C для выхода.");
    await bot.start({
      // При локальном тестировании мы хотим получать все возможные типы обновлений,
      // включая chat_member (для капчи на вступление) и callback_query
      allowed_updates: ["message", "callback_query", "chat_member"],
    });
  } catch (error) {
    logger.error("Ошибка при локальном запуске бота", error);
    process.exit(1);
  }
}

// Запускаем локальный инстанс
startLocalDev();
