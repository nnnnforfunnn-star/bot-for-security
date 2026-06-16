import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import { db } from "./utils/db.js";
import { joinHandler, captchaCallbackHandler, rulesAgreementCallbackHandler, goodbyeHandler } from "./handlers/joinHandler.js";
import { chatMemberUpdateHandler } from "./handlers/chatMemberHandler.js";
import { messageHandler } from "./handlers/messageHandler.js";
import { adminPanelCommand, adminPanelCallback, sendAdminPanel } from "./handlers/adminPanel.js";
import { filterCommand, stopFilterCommand, filtersListCommand } from "./handlers/filterHandler.js";
import { helpCommand, helpCallback } from "./handlers/helpHandler.js";
import { kickCommand, pinCommand, unpinCommand, warnCommand, unwarnCommand, warnsCommand, idCommand, kickmeCommand, muteallCommand, unmuteallCommand, zombiesCommand, setTopicCommand } from "./handlers/modCommands.js";
import { lockCommand, unlockCommand, locksListCommand } from "./handlers/locksHandler.js";
import { 
  delCommand, purgeCommand, setRulesCommand, rulesCommand, 
  titleCommand, meCommand, reportCommand, antifloodCommand, 
  blacklistCommand, unblacklistCommand, welcomeConfigCommand,
  mainchatCommand 
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
  adminsCommand, infoCommand, resetWarnsCommand, linkCommand,
  lockdownCommand, unlockdownCommand
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

import { getGroupConfig } from "./utils/configManager.js";

bot.catch(globalErrorHandler);
bot.use(rateLimiter);

// Middleware для проверки отключенных команд в группе
// Memory cache to throttle chat metadata updates to Redis
const lastChatMetadataUpdate = new Map<number, number>();

bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== "private") {
    const chatId = ctx.chat.id;
    const now = Date.now();
    const lastUpdate = lastChatMetadataUpdate.get(chatId) || 0;

    // Обновляем метаданные в базе только раз в 30 минут
    if (now - lastUpdate > 30 * 60 * 1000) {
      lastChatMetadataUpdate.set(chatId, now);
      
      // Выполняем в фоне без await, чтобы не задерживать обработку сообщения
      db.sadd("bot:chats", chatId).catch(() => {});
      
      const chatMeta = {
        id: chatId,
        title: (ctx.chat as any).title || "Тайпа",
        username: (ctx.chat as any).username || "",
        type: ctx.chat.type,
        updatedAt: now
      };
      db.hset("bot:chats_metadata", String(chatId), JSON.stringify(chatMeta)).catch(() => {});
    }

    if (ctx.message?.text?.startsWith("/")) {
      const fullCmd = ctx.message.text.split(" ")[0].substring(1);
      const cmdName = fullCmd.split("@")[0].toLowerCase();

      try {
        const config = await getGroupConfig(ctx.chat.id);
        
        // Разрешаем только settings, start и mainchat, если команды в группе отключены
        const isAlwaysAllowed = ["settings", "start", "mainchat"].includes(cmdName);
        if (!isAlwaysAllowed && config.commandsEnabled !== true) {
          return;
        }

        if (config.disabledCommands && config.disabledCommands[cmdName] === true) {
          // Команда отключена администратором чата через веб-панель
          return; 
        }
      } catch (e) {
        logger.error("Error checking disabled commands in middleware:", e);
      }
    }
  }
  await next();
});

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
bot.command("kickme", kickmeCommand);
bot.command("muteall", muteallCommand);
bot.command("unmuteall", unmuteallCommand);
bot.command("zombies", zombiesCommand);
bot.command("settopic", setTopicCommand);

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
bot.command("lockdown", lockdownCommand);
bot.command("unlockdown", unlockdownCommand);

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
bot.command("filter", filterCommand);
bot.command("stop", stopFilterCommand);
bot.command("filters", filtersListCommand);

// 7. Notes (Snippets)
import { saveNoteCommand, getNoteCommand, clearNoteCommand, notesListCommand } from "./handlers/notesHandler.js";
bot.command("save", saveNoteCommand);
bot.command("get", (ctx) => getNoteCommand(ctx, false));
bot.command("clear", clearNoteCommand);
bot.command("notes", notesListCommand);

// Text listeners for Notes (hashtags)
bot.on(["message:text", "message:caption"], async (ctx, next) => {
  const text = (ctx.message.text || ctx.message.caption || "").toLowerCase().trim();
  
  if (text.includes("#")) {
    await getNoteCommand(ctx, true);
  }
  
  await next();
});

// Помощь
bot.command("help", helpCommand);

// Коопсузбек командасы
bot.hears(/^(?:\/)?коопсузбек!?$/i, async (ctx) => {
  await ctx.reply("Мен!");
});

// Диагностика (Ping)
bot.command("ping", async (ctx) => {
  const start = Date.now();
  const msg = await ctx.reply("🏓 Понг...");
  const latency = Date.now() - start;
  
  let dbStatus = "Иштеп жатат ✅";
  try {
    await db.set("ping:test", "1", 5);
    const test = await db.get("ping:test");
    if (String(test) !== "1") dbStatus = "Ката ❌";
  } catch (e) {
    dbStatus = "Иштебей жатат ❌";
  }

  const uptime = Math.round(process.uptime());
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;

  await ctx.api.editMessageText(
    ctx.chat.id,
    msg.message_id,
    `🏓 **Понг!**\n\n` +
    `⚡️ **Боттун жооп убактысы:** \`${latency} миллисекунд\`\n` +
    `🗄 **Базанын абалы:** \`${dbStatus}\`\n` +
    `⏱ **Боттун иштөө убактысы:** \`${hours} саат ${minutes} мүнөт ${secs} секунд\``,
    { parse_mode: "Markdown" }
  ).catch(() => {});
});

async function sendStartMenu(ctx: any, editMessage = false) {
  const keyboard = new InlineKeyboard()
    .url("➕ Тайпага кошуу", `https://t.me/${ctx.me.username}?startgroup=true`).row()
    .text("📖 Буйруктар", "help:main").row()
    .url("🆘 Тех. Колдоо", "https://t.me/noneaibek");

  const text = `👋 Салам, <b>${ctx.from?.first_name || 'досум'}</b>!\n\n` +
    `🛡 <b>Коопсузбек</b> — тайпаңызды коргоо жана башкаруу үчүн түзүлгөн эң күчтүү, заманбап кыргызча модератор-бот.\n\n` +
    `⚠️ <b>Маанилүү:</b> Бот тайпада толук жана үзгүлтүксүз иштей алышы үчүн, ага тайпанын администратордук жөндөөлөрүнөн <b>бардык администратордук укуктарды</b> бериңиз.\n\n` +
    `⚙️ <b>Башкаруу панелине кирүү үчүн:</b> Ботко түз ушул жерден (же тайпаңыздан) <code>/settings</code> буйругун жөнөтүңүз. Ал сиз администратор болгон топтордун тизмесин көрсөтүп, веб-панелди ачат!`;

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
      const parts = payload.split("_");
      const chatId = parseInt(parts[1], 10);
      const ownerId = parseInt(parts[2], 10);
      
      if (!isNaN(chatId) && ctx.from) {
        // Проверяем, совпадает ли тот, кто перешел, с тем, кто вызвал команду settings в чате
        const settingsOwner = await db.get<number>(`chat:${chatId}:settings_owner`);
        
        if (ctx.from.id !== ownerId || (settingsOwner && settingsOwner !== ctx.from.id)) {
          await ctx.reply("Кечиресиз, бул шилтеме сиз үчүн эмес же анын мөөнөтү бүтүп калган.");
          return;
        }

        const isAdmin = await isUserSeniorAdminInChat(ctx.api, chatId, ctx.from.id);
        if (isAdmin) {
          await sendAdminPanel(ctx, chatId, false);

          // Сразу удаляем сохраненного владельца команды, чтобы ссылка стала недействительной
          await db.del(`chat:${chatId}:settings_owner`);

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
          await ctx.reply("Кечиресиз, веб-панелди ачуу үчүн сиз тайпанын ээси же башкы администратору болушуңуз керек!");
        }
        return;
      }
    }
    await sendStartMenu(ctx, false);
  }
});

bot.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  if (data === "start:main") {
    await sendStartMenu(ctx, true);
    await ctx.answerCallbackQuery();
  } else if (data && data.startsWith("web_grant_goto:")) {
    const parts = data.split(":");
    const chatId = parseInt(parts[1], 10);
    const targetUserId = parseInt(parts[2], 10);

    if (ctx.from.id !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "Кечиресиз, сизге бул жерден кирүүгө уруксат жок!",
        show_alert: true
      });
      return;
    }

    // Set settings_owner in db so deep linking works
    await db.set(`chat:${chatId}:settings_owner`, targetUserId, 300);

    const botInfo = ctx.me;
    const deepLink = `https://t.me/${botInfo.username}?start=settings_${chatId}_${targetUserId}`;
    
    await ctx.answerCallbackQuery({
      url: deepLink
    });

    // Delete the notification message in the chat
    await ctx.deleteMessage().catch(() => {});
  } else {
    await next();
  }
});

// Көзөмөлдөөчү темалар (Forum Topics tracker)
bot.on(["message:forum_topic_created", "message:forum_topic_edited"], async (ctx, next) => {
  try {
    const chatId = ctx.chat?.id;
    if (chatId && ctx.chat.type === "supergroup") {
      const threadId = ctx.message?.message_thread_id;
      const name = ctx.message?.forum_topic_created?.name || ctx.message?.forum_topic_edited?.name;
      if (threadId && name) {
        await db.hset(`chat:${chatId}:topics`, String(threadId), name);
      }
    }
  } catch (e) {
    logger.error("Error in forum topic tracking:", e);
  }
  await next();
});

// Обработчики
bot.on("message:new_chat_members", joinHandler);
bot.on("message:left_chat_member", goodbyeHandler);
bot.on("chat_member", joinHandler);
bot.on("chat_member", chatMemberUpdateHandler);
bot.on("callback_query:data", adminPanelCallback);
bot.on("callback_query:data", captchaCallbackHandler);
bot.on("callback_query:data", rulesAgreementCallbackHandler);
bot.on("callback_query:data", helpCallback);
bot.on("message", messageHandler);
bot.on("edited_message", messageHandler);

bot.command("mainchat", mainchatCommand);

bot.on("my_chat_member", async (ctx) => {
  try {
    const update = ctx.myChatMember;
    const newStatus = update.new_chat_member.status;
    const oldStatus = update.old_chat_member.status;

    const isPromoted = oldStatus === "member" && newStatus === "administrator";
    const isAdded = ["left", "kicked"].includes(oldStatus) && ["member", "administrator"].includes(newStatus);

    if (isAdded || isPromoted) {
      const chatId = ctx.chat.id;

      // 1. Find the owner/creator of the group
      let ownerId: number | null = null;
      try {
        const admins = await ctx.api.getChatAdministrators(chatId);
        const creator = admins.find(adm => adm.status === "creator");
        if (creator) {
          ownerId = creator.user.id;
        }
      } catch (e) {
        logger.error("Error fetching chat administrators on add:", e);
      }

      const infoMessage = `👋 *Саламатсызбы!*\n\n` +
        `🛡 *Коопсузбек* коопсуздук ботун тайпаңызга кошконуңуз үчүн терең ыраазычылык билдиребиз.\n\n` +
        `⚠️ *Маанилүү кадамдар:*\n` +
        `1️⃣ *Толук укуктарды бериңиз:* Бот тайпада толук жана үзгүлтүксүз иштей алышы үчүн, ага тайпанын администратордук жөндөөлөрүнөн *бардык администратордук укуктарды* (билдирүүлөрдү өчүрүү, колдонуучуларды чектөө, билдирүүлөрдү кадоо ж.б.) толук бериңиз.\n` +
        `2️⃣ *Негизги чатты орнотуңуз:* Тайпаңыздын негизги темасына (бөлүмүнө) же чатына барып, сөзсүз \`/mainchat\` буйругун жазыңыз. Бул ботко кулактандырууларды жана негизги билдирүүлөрдү кайсы жерге жөнөтүү керек экенин көрсөтөт.\n` +
        `3️⃣ *Башкаруу панели:* Боттун жөндөөлөрүн башкаруу жана веб-панелди ачуу үчүн каалаган убакта ушул жерден же тайпаңыздан \`/settings\` буйругун жөнөтүңүз.`;

      let dmSent = false;
      if (ownerId) {
        try {
          await ctx.api.sendMessage(ownerId, infoMessage, { parse_mode: "Markdown" });
          dmSent = true;
        } catch (dmErr: any) {
          logger.warn(`Could not send DM to group owner ${ownerId}:`, dmErr);
        }
      }

      // If DM failed or owner was not found, send a fallback message directly to the group!
      if (!dmSent) {
        try {
          const groupMessage = `👋 *Саламатсызбы, тайпанын администраторлору!*\n\n` +
            `🛡 *Коопсузбек* коопсуздук боту тайпага кошулду. Боттун толук жана үзгүлтүксүз иштеши үчүн төмөнкүлөрдү аткарыңыз:\n\n` +
            `1️⃣ Ботко администратордук жөндөөлөрдөн *бардык администратордук укуктарды* (билдирүүлөрдү өчүрүү, колдонуучуларды чектөө, билдирүүлөрдү кадоо ж.б.) бериңиз.\n` +
            `2️⃣ Тайпанын негизги темасына же чатына барып, сөзсүз \`/mainchat\` буйругун жазыңыз.\n` +
            `3️⃣ Боттун веб-панелин ачуу жана жөндөөлөрдү башкаруу үчүн \`/settings\` буйругун колдонуңуз.`;
          await ctx.reply(groupMessage, { parse_mode: "Markdown" });
        } catch (grpErr: any) {
          logger.error("Error sending join fallback message to group:", grpErr);
        }
      }
    }
  } catch (err: any) {
    logger.error("Error in my_chat_member handler:", err);
  }
});

logger.info("Бот Коопсузбек ийгиликтүү ишке кирди!");
