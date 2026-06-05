import { Context, NextFunction, InlineKeyboard } from "grammy";
import { getGroupConfig, updateGroupConfig } from "../utils/configManager.js";
import { isUserAdmin, isUserAdminInChat } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";

/**
 * Команда /settings для вызова панели управления.
 * Теперь выдает кнопку перехода в ЛС бота для безопасности.
 */
export async function adminPanelCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply("Бул буйрукту тайпада жазышыңыз керек. Андан соң мен сизге жеке каттан жөндөөлөрдү ачып берем.");
    return;
  }

  const isAdmin = await isUserAdmin(ctx);
  if (!isAdmin) {
    await ctx.reply("Бул панелди админдер гана колдоно алат.");
    return;
  }

  const botInfo = await ctx.api.getMe();
  const deepLink = `https://t.me/${botInfo.username}?start=settings_${ctx.chat.id}`;

  const keyboard = new InlineKeyboard().url("⚙️ Жөндөөлөргө өтүү", deepLink);
  await ctx.reply(`Урматтуу админ, тайпанын коопсуздугу үчүн жөндөөлөр жеке кат (PM) аркылуу гана өзгөртүлөт. Төмөнкү баскычты басыңыз:`, { reply_markup: keyboard });
}

import { config as botConfig } from "../config.js";

/**
 * Отправка или обновление сообщения с панелью в ЛС
 */
export async function sendAdminPanel(ctx: Context, chatId: number, editMessage = false, page: string = "main") {
  const config = await getGroupConfig(chatId);
  const kb = new InlineKeyboard();
  const webAppUrl = `${botConfig.APP_URL}/index.html?chatId=${chatId}`;

  if (page === "main") {
    kb.webApp(`🌐 WEB ПАНЕЛЬ (ЖАҢЫ)`, webAppUrl).row()
      .text(`🔒 Бөгөттөөлөр (Locks)`, `adm:pg:locks:${chatId}`).row()
      .text(`🤖 Антифлуд & Саламдашуу`, `adm:pg:auto:${chatId}`).row()
      .text(`⚙️ Негизги Жөндөөлөр`, `adm:pg:basic:${chatId}`).row()
      .text(`❌ Жабуу`, `adm:close:${chatId}`);
  } else if (page === "locks") {
    kb.text(`Шилтеме: ${config.locks.links ? "❌" : "✅"}`, `adm:lk:links:${chatId}`)
      .text(`Репост: ${config.locks.forwards ? "❌" : "✅"}`, `adm:lk:forwards:${chatId}`).row()
      .text(`Боттор: ${config.locks.bots ? "❌" : "✅"}`, `adm:lk:bots:${chatId}`)
      .text(`Медиа: ${config.locks.media ? "❌" : "✅"}`, `adm:lk:media:${chatId}`).row()
      .text(`Стикер: ${config.locks.stickers ? "❌" : "✅"}`, `adm:lk:stickers:${chatId}`)
      .text(`GIF: ${config.locks.gifs ? "❌" : "✅"}`, `adm:lk:gifs:${chatId}`).row()
      .text(`Үн/Видео: ${config.locks.voices ? "❌" : "✅"}`, `adm:lk:voices:${chatId}`)
      .text(`Араб: ${config.locks.arabic ? "❌" : "✅"}`, `adm:lk:arabic:${chatId}`).row()
      .text(`NSFW/Уят: ${config.locks.porn ? "❌" : "✅"}`, `adm:lk:porn:${chatId}`).row()
      .text(`🔙 Артка`, `adm:pg:main:${chatId}`);
  } else if (page === "auto") {
    kb.text(`Антифлуд: ${config.antiflood.enabled ? "✅" : "❌"}`, `adm:af:toggle:${chatId}`).row()
      .text(`Саламдашуу: ${config.welcome.enabled ? "✅" : "❌"}`, `adm:wc:toggle:${chatId}`).row()
      .text(`Капча: ${config.captchaEnabled ? "✅" : "❌"}`, `adm:tg:captchaEnabled:${chatId}`).row()
      .text(`🔙 Артка`, `adm:pg:main:${chatId}`);
  } else if (page === "basic") {
    kb.text(`Түнкү дозор: ${config.nightModeEnabled ? "✅" : "❌"}`, `adm:tg:nightModeEnabled:${chatId}`)
      .text(`24с Карантин: ${config.quarantineEnabled ? "✅" : "❌"}`, `adm:tg:quarantineEnabled:${chatId}`).row()
      .text(`Анти-Мат: ${config.antiSwearEnabled ? "✅" : "❌"}`, `adm:tg:antiSwearEnabled:${chatId}`)
      .text(`Сый-Урмат: ${config.karmaEnabled ? "✅" : "❌"}`, `adm:tg:karmaEnabled:${chatId}`).row()
      .text(`Эскертүүлөр лимити (Warns): ${config.warnLimit}`, `adm:noop`).row()
      .text(`+1`, `adm:awarn:${chatId}`)
      .text(`-1`, `adm:swarn:${chatId}`).row()
      .text(`🔙 Артка`, `adm:pg:main:${chatId}`);
  }

  let groupName = "Тайпа";
  try {
    const chat = await ctx.api.getChat(chatId);
    if ('title' in chat && chat.title) groupName = chat.title;
  } catch (e) {}

  let title = "Башкаруу Панели";
  if (page === "locks") title = "🔒 Бөгөттөөлөр (Locks)";
  if (page === "auto") title = "🤖 Антифлуд & Саламдашуу";
  if (page === "basic") title = "⚙️ Негизги Жөндөөлөр";

  const text = `⚙️ **Коопсузбек - ${title}**\n\nТайпа: **${groupName}**\nБул жерден коопсуздук жөндөөлөрүн өзгөртө аласыз.`;

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
  
  let chatId: number;
  let field = "";
  if (action === "tg" || action === "pg" || action === "lk" || action === "af" || action === "wc") {
    field = parts[2] || "";
    chatId = parseInt(parts[3], 10);
  } else if (action === "close" || action === "noop") {
    chatId = parseInt(parts[2] || "0", 10);
  } else {
    chatId = parseInt(parts[2], 10);
  }

  if (isNaN(chatId)) return next();

  const isAdmin = await isUserAdminInChat(ctx.api, chatId, query.from.id);
  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: "Сиз бул тайпада админ эмессиз!", show_alert: true });
    return;
  }

  const config = await getGroupConfig(chatId);

  if (action === "pg") {
    await sendAdminPanel(ctx, chatId, true, field);
    await ctx.answerCallbackQuery();
  } else if (action === "tg") {
    // @ts-ignore
    const newValue = !config[field];
    await updateGroupConfig(chatId, { [field]: newValue });
    await ctx.answerCallbackQuery("Өзгөртүлдү ✅");
    await sendAdminPanel(ctx, chatId, true, "basic");
  } else if (action === "lk") {
    // @ts-ignore
    config.locks[field] = !config.locks[field];
    await updateGroupConfig(chatId, { locks: config.locks });
    await ctx.answerCallbackQuery("Бөгөттөө өзгөртүлдү ✅");
    await sendAdminPanel(ctx, chatId, true, "locks");
  } else if (action === "af") {
    config.antiflood.enabled = !config.antiflood.enabled;
    await updateGroupConfig(chatId, { antiflood: config.antiflood });
    await ctx.answerCallbackQuery("Антифлуд өзгөртүлдү ✅");
    await sendAdminPanel(ctx, chatId, true, "auto");
  } else if (action === "wc") {
    config.welcome.enabled = !config.welcome.enabled;
    await updateGroupConfig(chatId, { welcome: config.welcome });
    await ctx.answerCallbackQuery("Саламдашуу өзгөртүлдү ✅");
    await sendAdminPanel(ctx, chatId, true, "auto");
  } else if (action === "awarn") {
    const newVal = Math.min(10, config.warnLimit + 1);
    await updateGroupConfig(chatId, { warnLimit: newVal });
    await ctx.answerCallbackQuery("Эскертүү лимити көбөйдү");
    await sendAdminPanel(ctx, chatId, true, "basic");
  } else if (action === "swarn") {
    const newVal = Math.max(1, config.warnLimit - 1);
    await updateGroupConfig(chatId, { warnLimit: newVal });
    await ctx.answerCallbackQuery("Эскертүү лимити азайды");
    await sendAdminPanel(ctx, chatId, true, "basic");
  } else if (action === "close") {
    if (query.message) {
      await ctx.api.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});
    }
    await ctx.answerCallbackQuery();
  } else {
    await ctx.answerCallbackQuery();
  }
}
