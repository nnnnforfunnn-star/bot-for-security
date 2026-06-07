import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import { db } from "./utils/db.js";
import { joinHandler, captchaCallbackHandler } from "./handlers/joinHandler.js";
import { messageHandler } from "./handlers/messageHandler.js";
import { adminPanelCommand, adminPanelCallback, sendAdminPanel } from "./handlers/adminPanel.js";
import { bataCommand, topUrmatCommand } from "./handlers/funHandler.js";
import { filterCommand, stopFilterCommand, filtersListCommand } from "./handlers/filterHandler.js";
import { helpCommand, helpCallback } from "./handlers/helpHandler.js";
import { kickCommand, pinCommand, unpinCommand, warnCommand, unwarnCommand, warnsCommand, idCommand } from "./handlers/modCommands.js";
import { lockCommand, unlockCommand, locksListCommand } from "./handlers/locksHandler.js";
import { 
  delCommand, purgeCommand, setRulesCommand, rulesCommand, 
  titleCommand, meCommand, reportCommand, antifloodCommand, 
  blacklistCommand, unblacklistCommand, welcomeConfigCommand 
} from "./handlers/adminCommands.js";
import { isUserAdminInChat, isUserSeniorAdminInChat } from "./utils/telegram.js";
import {
  handleMuteCommand,
  handleUnmuteCommand,
  handleBanCommand,
  handleUnbanCommand,
} from "./handlers/commandHandler.js";
import {
  promoteCommand, demoteCommand, tmuteCommand, tbanCommand,
  slowmodeCommand, setPhotoCommand, setTitleCommand, setDescCommand,
  adminsCommand, infoCommand, resetWarnsCommand, linkCommand
} from "./handlers/groupCommands.js";
import {
  silentCommand, logChannelCommand, unpinAllCommand, warnLimitCommand,
  warnActionCommand, welcomeToggleCommand, goodbyeToggleCommand,
  cleanWelcomeToggleCommand, captchaTypeCommand, captchaKickCommand,
  antiArabicCommand, antiSwearCommand
} from "./handlers/configCommands.js";

if (!config.BOT_TOKEN) {
  throw new Error("BOT_TOKEN не установлен в переменных окружения!");
}

export const bot = new Bot(config.BOT_TOKEN);

bot.catch(globalErrorHandler);
bot.use(rateLimiter);

// 1. Модераторские команды
bot.command("mute", handleMuteCommand);
bot.command("unmute", handleUnmuteCommand);
bot.command("ban", handleBanCommand);
bot.command("unban", handleUnbanCommand);
bot.command("kick", kickCommand);
bot.command("pin", pinCommand);
bot.command("unpin", unpinCommand);
bot.command("warn", warnCommand);
bot.command("unwarn", unwarnCommand);
bot.command("warns", warnsCommand);
bot.command("id", idCommand);
bot.command("del", delCommand);
bot.command("purge", purgeCommand);
bot.command("report", reportCommand);

// 1.5 Жаңы тайпа башкаруу команд лары
bot.command("promote", promoteCommand);
bot.command("demote", demoteCommand);
bot.command("tmute", tmuteCommand);
bot.command("tban", tbanCommand);
bot.command("slowmode", slowmodeCommand);
bot.command("setphoto", setPhotoCommand);
bot.command("settitle", setTitleCommand);
bot.command("setdesc", setDescCommand);
bot.command("admins", adminsCommand);
bot.command("info", infoCommand);
bot.command("resetwarns", resetWarnsCommand);
bot.command("link", linkCommand);

// 1.6 Жаңы жөндөө командалары
bot.command("silent", silentCommand);
bot.command("logchannel", logChannelCommand);
bot.command("unpinall", unpinAllCommand);
bot.command("warnlimit", warnLimitCommand);
bot.command("warnaction", warnActionCommand);
bot.command("welcomeon", welcomeToggleCommand);
bot.command("welcomeoff", welcomeToggleCommand);
bot.command("goodbyeon", goodbyeToggleCommand);
bot.command("goodbyeoff", goodbyeToggleCommand);
bot.command("cleanwelcomeon", cleanWelcomeToggleCommand);
bot.command("cleanwelcomeoff", cleanWelcomeToggleCommand);
bot.command("captchatype", captchaTypeCommand);
bot.command("captchakick", captchaKickCommand);
bot.command("antiarabic", antiArabicCommand);
bot.command("antiswear", antiSwearCommand);

// 2. Бөгөттөө (Locks)
bot.command("lock", lockCommand);
bot.command("unlock", unlockCommand);
bot.command("locks", locksListCommand);

// 3. Антифлуд & Кара тизме
bot.command("antiflood", antifloodCommand);
bot.command("blacklist", blacklistCommand);
bot.command("unblacklist", unblacklistCommand);

// 4. Саламдашуу & Эрежелер & Карма
bot.command("welcome", welcomeConfigCommand);
bot.command("rules", rulesCommand);
bot.command("setrules", setRulesCommand);
bot.command("title", titleCommand);
bot.command("me", meCommand);

// 5. Настройки и Админ-панель
bot.command("settings", adminPanelCommand);

// 6. Fun & Filters
bot.command("bata", bataCommand);
bot.command("top", topUrmatCommand);
bot.command("filter", filterCommand);
bot.command("stop", stopFilterCommand);
bot.command("filters", filtersListCommand);

// 7. Notes (Snippets)
import { saveNoteCommand, getNoteCommand, clearNoteCommand, notesListCommand } from "./handlers/notesHandler.js";
bot.command("save", saveNoteCommand);
bot.command("get", (ctx) => getNoteCommand(ctx, false));
bot.command("clear", clearNoteCommand);
bot.command("notes", notesListCommand);

// 8. Iris-like RP and Fun Commands
import { 
  handleRpCommand, randomCommand, infaCommand, chooseCommand, 
  yesNoCommand, whoCommand, sayCommand, rouletteCommand 
} from "./handlers/rpHandler.js";
import { 
  setNickCommand, removeNickCommand, nickCommand, 
  setDevizCommand, removeDevizCommand, profileCommand, 
  shipCommand, weatherCommand 
} from "./handlers/socialHandler.js";

// Text listeners for RP Actions and Notes
bot.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.toLowerCase().trim();
  
  if (text.startsWith("#")) {
    await getNoteCommand(ctx, true);
    // don't return here so normal message processing happens too, or maybe return?
    // usually notes should not stop message processing
  }

  // RP Actions Check
  if (ctx.message.reply_to_message) {
    const actionWords = ["обнять", "поцеловать", "ударить", "укусить", "убить", "дать пять", "погладить", "пнуть", "расстрелять"];
    for (const w of actionWords) {
      if (text.startsWith(w)) return handleRpCommand(ctx);
    }
  }
  
  // Custom Triggers without slash
  if (text.startsWith("рандом")) return randomCommand(ctx);
  if (text.startsWith("!инфа") || text.startsWith("инфа")) return infaCommand(ctx);
  if (text.startsWith("!выбери") || text.startsWith("выбери")) return chooseCommand(ctx);
  if (text.startsWith("!данет") || text.startsWith("данет")) return yesNoCommand(ctx);
  if (text.startsWith("!кто") || text.startsWith("кто ")) return whoCommand(ctx);
  if (text.startsWith("!скажи") || text.startsWith("скажи ")) return sayCommand(ctx);
  if (text === "рулетка" || text === "!рулетка" || text === "!русская рулетка") return rouletteCommand(ctx);
  
  if (text.startsWith("+ник")) return setNickCommand(ctx);
  if (text === "-ник") return removeNickCommand(ctx);
  if (text === "ник") return nickCommand(ctx);
  if (text.startsWith("+девиз")) return setDevizCommand(ctx);
  if (text === "-девиз") return removeDevizCommand(ctx);
  if (text === "профиль" || text === "кто я" || text === "кто ты") return profileCommand(ctx);
  if (text === "шипперим" || text === "пейринг") return shipCommand(ctx);
  if (text.startsWith("!погода") || text.startsWith("погода")) return weatherCommand(ctx);
  
  await next();
});

// Помощь
bot.command("help", helpCommand);

async function sendStartMenu(ctx: any, editMessage = false) {
  const keyboard = new InlineKeyboard()
    .url("➕ Тайпага кошуу (Добавить в группу)", `https://t.me/${ctx.me.username}?startgroup=true`).row()
    .text("📖 Буйруктар (Команды)", "help:main").row()
    .url("🆘 Тех. Колдоо (Поддержка)", "https://t.me/noneaibek");

  const text = `👋 Салам, <b>${ctx.from?.first_name || 'досум'}</b>!\n\n` +
    `🛡 <b>Коопсузбек</b> — тайпаңызды коргоо жана башкаруу үчүн түзүлгөн эң күчтүү, заманбап кыргызча модератор-бот.\n\n` +
    `🚀 Мени тайпаңызга кошуп, администратор укугун бериңиз да, <code>/settings</code> буйругу менен баарын өзүңүзгө ылайыктап алыңыз!`;

  if (editMessage) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

bot.command("start", async (ctx) => {
  if (ctx.chat.type === "private") {
    const payload = ctx.match;
    if (payload && payload.startsWith("settings_")) {
      const chatIdStr = payload.replace("settings_", "");
      const chatId = parseInt(chatIdStr, 10);
      if (!isNaN(chatId) && ctx.from) {
        const isAdmin = await isUserSeniorAdminInChat(ctx.api, chatId, ctx.from.id);
        if (isAdmin) {
          await sendAdminPanel(ctx, chatId, false);

          // Автоматически удаляем сообщения команды /settings в чате группы
          try {
            const msgsKey = `chat:${chatId}:admin:${ctx.from.id}:settings_msgs`;
            const msgs = await db.get<number[]>(msgsKey);
            if (msgs && Array.isArray(msgs)) {
              for (const msgId of msgs) {
                await ctx.api.deleteMessage(chatId, msgId).catch(() => {});
              }
              await db.del(msgsKey);
            }
          } catch (e) {
            logger.warn("Не удалось удалить сообщения /settings", { error: e as any });
          }
        } else {
          await ctx.reply("Кечиресиз, Web-Панельди ачуу үчүн сиз тайпанын ээси (creator) же толук укуктуу старший админ болушуңуз керек!");
        }
        return;
      }
    }
    await sendStartMenu(ctx, false);
  }
});

bot.on("callback_query:data", async (ctx, next) => {
  if (ctx.callbackQuery.data === "start:main") {
    await sendStartMenu(ctx, true);
    await ctx.answerCallbackQuery();
  } else {
    await next();
  }
});

// Обработчики
bot.on("chat_member", joinHandler);
bot.on("callback_query:data", adminPanelCallback);
bot.on("callback_query:data", captchaCallbackHandler);
bot.on("callback_query:data", helpCallback);
bot.on("message", messageHandler);
bot.on("edited_message", messageHandler);

logger.info("Бот Коопсузбек ийгиликтүү ишке кирди!");
