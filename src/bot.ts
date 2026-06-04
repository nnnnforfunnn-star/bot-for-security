import { Bot } from "grammy";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import { handleNewChatMember, handleVerificationCallback } from "./handlers/joinHandler.js";
import { filterMessage } from "./handlers/messageHandler.js";
import {
  handleMuteCommand,
  handleUnmuteCommand,
  handleBanCommand,
  handleUnbanCommand,
} from "./handlers/commandHandler.js";

// Проверка наличия токена
if (!config.BOT_TOKEN) {
  throw new Error("BOT_TOKEN не установлен в переменных окружения!");
}

// Создаем экземпляр бота с дефолтным контекстом
export const bot = new Bot(config.BOT_TOKEN);

// 1. Глобальный обработчик ошибок (предотвращает краш бота)
bot.catch(globalErrorHandler);

// 2. Лимитирование запросов (защита от флуда/спама командами)
bot.use(rateLimiter);

// 3. Регистрация модераторских команд
bot.command("mute", handleMuteCommand);
bot.command("unmute", handleUnmuteCommand);
bot.command("ban", handleBanCommand);
bot.command("unban", handleUnbanCommand);

// Добавим простую команду /start для проверки работы бота в ЛС
bot.command("start", async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🛡️ Привет! Я бескомпромиссный Telegram-бот модератор.\n\n" +
      "Добавь меня в свою группу, сделай администратором с правами удаления сообщений и блокировки пользователей, и я мгновенно начну защищать твой чат от спама, ботов и нежелательной рекламы."
    );
  }
});

// 4. Обработка событий вступления новых участников в чат (капча)
// Обратите внимание: для работы этого события бот должен быть админом чата
bot.on("chat_member", handleNewChatMember);

// 5. Обработка кликов по кнопке капчи "Я не робот"
bot.on("callback_query:data", handleVerificationCallback);

// 6. Фильтрация всех остальных входящих сообщений (спам, ссылки, запрещенные слова)
// Мы используем "message", чтобы проверять текстовые сообщения, медиа, репосты и т.д.
bot.on("message", filterMessage);

logger.info("Бот успешно инициализирован и настроен.");
