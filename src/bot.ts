import { Bot } from "grammy";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import { joinHandler, captchaCallbackHandler } from "./handlers/joinHandler.js";
import { messageHandler } from "./handlers/messageHandler.js";
import { adminPanelCommand, adminPanelCallback } from "./handlers/adminPanel.js";
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

// 1. Глобальный обработчик ошибок
bot.catch(globalErrorHandler);

// 2. Лимитирование запросов
bot.use(rateLimiter);

// 3. Регистрация модераторских команд
bot.command("mute", handleMuteCommand);
bot.command("unmute", handleUnmuteCommand);
bot.command("ban", handleBanCommand);
bot.command("unban", handleUnbanCommand);
bot.command("settings", adminPanelCommand);

// Приветствие в ЛС на кыргызском
bot.command("start", async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🛡️ Ассалому алейкум! Мен **Коопсузбек**мин — тайпаңыздын тазалыгын жана коопсуздугун сактаган кыргызча модератор.\n\n" +
      "Мени өзүңүздүн тайпаңызга кошуп, администратор кылыңыз. Мен спамдарды, ботторду жана уят сөздөрдү автоматтык түрдө өчүрөм.\n\n" +
      "Тайпада /settings буйругун жазып, мени толук башкара аласыз.",
      { parse_mode: "Markdown" }
    );
  }
});

// 4. Обработка событий вступления новых участников в чат (капча)
bot.on("chat_member", joinHandler);

// 5. Обработка кликов по инлайн кнопкам (Панель и Капча)
bot.on("callback_query:data", adminPanelCallback);
bot.on("callback_query:data", captchaCallbackHandler);

// 6. Фильтрация всех остальных сообщений (спам, ссылки, карма, мат)
bot.on("message", messageHandler);
bot.on("edited_message", messageHandler);

logger.info("Бот Коопсузбек ийгиликтүү ишке кирди!");
