import { Bot } from "grammy";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import { joinHandler, captchaCallbackHandler } from "./handlers/joinHandler.js";
import { messageHandler } from "./handlers/messageHandler.js";
import { adminPanelCommand, adminPanelCallback, sendAdminPanel } from "./handlers/adminPanel.js";
import { bataCommand, topUrmatCommand } from "./handlers/funHandler.js";
import { filterCommand, stopFilterCommand, filtersListCommand } from "./handlers/filterHandler.js";
import { isUserAdminInChat } from "./utils/telegram.js";
import {
  handleMuteCommand,
  handleUnmuteCommand,
  handleBanCommand,
  handleUnbanCommand,
} from "./handlers/commandHandler.js";

if (!config.BOT_TOKEN) {
  throw new Error("BOT_TOKEN не установлен в переменных окружения!");
}

export const bot = new Bot(config.BOT_TOKEN);

bot.catch(globalErrorHandler);
bot.use(rateLimiter);

// Модераторские команды
bot.command("mute", handleMuteCommand);
bot.command("unmute", handleUnmuteCommand);
bot.command("ban", handleBanCommand);
bot.command("unban", handleUnbanCommand);

// Настройки и Админ-панель
bot.command("settings", adminPanelCommand);

// Fun & Filters
bot.command("bata", bataCommand);
bot.command("top", topUrmatCommand);
bot.command("filter", filterCommand);
bot.command("stop", stopFilterCommand);
bot.command("filters", filtersListCommand);

// Старт и обработка Deep Links (Панель управления в ЛС)
bot.command("start", async (ctx) => {
  if (ctx.chat.type === "private") {
    const payload = ctx.match;
    
    if (payload && payload.startsWith("settings_")) {
      const chatIdStr = payload.replace("settings_", "");
      const chatId = parseInt(chatIdStr, 10);
      
      if (!isNaN(chatId)) {
        const isAdmin = await isUserAdminInChat(ctx.api, chatId, ctx.from.id);
        if (isAdmin) {
          await sendAdminPanel(ctx, chatId, false);
        } else {
          await ctx.reply("Кечиресиз, сиз ал тайпада администратор эмессиз!");
        }
        return;
      }
    }

    await ctx.reply(
      "🛡️ Ассалому алейкум! Мен **Коопсузбек**мин — тайпаңыздын тазалыгын жана коопсуздугун сактаган кыргызча модератор.\n\n" +
      "Мени өзүңүздүн тайпаңызга кошуп, администратор кылыңыз. Мен спамдарды, ботторду жана уят сөздөрдү автоматтык түрдө өчүрөм.\n\n" +
      "Тайпада /settings буйругун жазып, мени толук башкара аласыз.",
      { parse_mode: "Markdown" }
    );
  }
});

// Обработчики
bot.on("chat_member", joinHandler);
bot.on("callback_query:data", adminPanelCallback);
bot.on("callback_query:data", captchaCallbackHandler);
bot.on("message", messageHandler);
bot.on("edited_message", messageHandler);

logger.info("Бот Коопсузбек ийгиликтүү ишке кирди!");
