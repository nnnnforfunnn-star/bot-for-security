import { Context, NextFunction, InlineKeyboard } from "grammy";
import { isUserSeniorAdminInChat } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";
import { db } from "../utils/db.js";
import { config as botConfig } from "../config.js";

/**
 * Команда /settings для вызова панели управления.
 * Если вызвана в ЛС: показывает список групп, где пользователь является старшим админом.
 * Если вызвана в группе: выдает временную кнопку перехода в ЛС с проверкой прав.
 */
export async function adminPanelCommand(ctx: Context) {
  if (!ctx.chat) return;

  if (ctx.chat.type === "private") {
    const chatIds = await db.smembers("bot:chats");
    const adminChats: { id: number; title: string }[] = [];

    for (const cidStr of chatIds) {
      const cid = parseInt(cidStr, 10);
      if (isNaN(cid)) continue;
      
      const isSenior = await isUserSeniorAdminInChat(ctx.api, cid, ctx.from?.id || 0);
      if (isSenior) {
        let title = `Тайпа (ID: ${cid})`;
        try {
          const chat = await ctx.api.getChat(cid);
          if ('title' in chat && chat.title) {
            title = chat.title;
          }
        } catch (e) {}
        adminChats.push({ id: cid, title });
      }
    }

    if (adminChats.length === 0) {
      await ctx.reply("Кечиресиз, сиз эч бир тайпада башкы администратор эмессиз же бот ал тайпага кошула элек.");
      return;
    }

    const kb = new InlineKeyboard();
    for (const c of adminChats) {
      kb.text(`⚙️ ${c.title}`, `adm:direct_select:${c.id}`).row();
    }
    kb.text("❌ Жабуу", "adm:direct_close");

    await ctx.reply("Жөндөөлөрүн башкаргыңыз келген тайпаны тандаңыз:", { reply_markup: kb });
    return;
  }

  // В чате группы:
  const isSenior = await isUserSeniorAdminInChat(ctx.api, ctx.chat.id, ctx.from?.id || 0);
  if (!isSenior) {
    await ctx.reply("Бул панелди Башкы администраторлор же тайпанын ээси гана колдоно алат.");
    return;
  }

  // Записываем владельца сессии настроек
  const settingsOwnerKey = `chat:${ctx.chat.id}:settings_owner`;
  await db.set(settingsOwnerKey, ctx.from?.id, 300);

  const botInfo = await ctx.api.getMe();
  const deepLink = `https://t.me/${botInfo.username}?start=settings_${ctx.chat.id}_${ctx.from?.id}`;

  const keyboard = new InlineKeyboard().url("⚙️ Жөндөөлөргө өтүү", deepLink);
  const replyMsg = await ctx.reply(`Урматтуу админ, тайпанын коопсуздугу үчүн жөндөөлөр жеке кат (PM) аркылуу гана өзгөртүлөт. Төмөнкү баскычты басыңыз:`, { reply_markup: keyboard });

  if (ctx.message?.message_id && replyMsg.message_id) {
    await db.set(`chat:${ctx.chat.id}:admin:${ctx.from?.id}:settings_msgs`, [ctx.message.message_id, replyMsg.message_id], 300);
  }
}

/**
 * Отправка панели управления в ЛС
 */
export async function sendAdminPanel(ctx: Context, chatId: number, editMessage = false) {
  const kb = new InlineKeyboard();
  const webAppUrl = `${botConfig.APP_URL}/index.html?chatId=${chatId}`;

  kb.webApp(`🌐 ВЕБ ПАНЕЛЬ`, webAppUrl).row()
    .text(`❌ Жабуу`, `adm:close:${chatId}`);

  let groupName = "Тайпа";
  try {
    const chat = await ctx.api.getChat(chatId);
    if ('title' in chat && chat.title) groupName = chat.title;
  } catch (e) {}

  const text = `⚙️ **Коопсузбек - Башкаруу Панели**\n\n` +
    `Тайпа: **${groupName}**\n\n` +
    `Бул тайпанын бардык коопсуздук жана модерация жөндөөлөрүн веб-панель аркылуу оңой башкара аласыз. Төмөнкү баскычты басыңыз:`;

  try {
    if (editMessage) {
      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
    } else {
      await ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
    }
  } catch (error) {
    logger.error("Ошибка при отправке панели управления", error);
  }
}

export async function adminPanelCallback(ctx: Context, next: NextFunction) {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !query.data.startsWith("adm:")) {
    return next();
  }

  const parts = query.data.split(":");
  const action = parts[1];

  if (action === "direct_close") {
    if (query.message) {
      await ctx.api.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});
    }
    await ctx.answerCallbackQuery();
    return;
  }

  if (action === "direct_select") {
    const selectedChatId = parseInt(parts[2], 10);
    if (!isNaN(selectedChatId)) {
      const isSenior = await isUserSeniorAdminInChat(ctx.api, selectedChatId, query.from.id);
      if (isSenior) {
        await sendAdminPanel(ctx, selectedChatId, true);
      } else {
        await ctx.answerCallbackQuery({ text: "Бул тайпанын жөндөөлөрүн көрүүгө укугуңуз жок!", show_alert: true });
      }
    }
    await ctx.answerCallbackQuery();
    return;
  }
  
  let chatId: number;
  if (action === "close" || action === "noop") {
    chatId = parseInt(parts[2] || "0", 10);
  } else {
    chatId = parseInt(parts[2] || parts[3] || "0", 10);
  }

  if (isNaN(chatId)) return next();

  const isSenior = await isUserSeniorAdminInChat(ctx.api, chatId, query.from.id);
  if (!isSenior) {
    await ctx.answerCallbackQuery({ text: "Бул аракетти Башкы администраторлор же тайпанын ээси гана жасай алат!", show_alert: true });
    return;
  }

  if (action === "close") {
    if (query.message) {
      await ctx.api.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});
    }
    await ctx.answerCallbackQuery();
  } else {
    await ctx.answerCallbackQuery();
  }
}
