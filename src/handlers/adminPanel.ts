import { Context, NextFunction, InlineKeyboard } from "grammy";
import { getGroupConfig, updateGroupConfig } from "../utils/configManager.js";
import { isUserAdmin } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";

/**
 * Команда /settings для вызова панели управления.
 */
export async function adminPanelCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply("Бул буйрук тайпаларда гана иштейт.");
    return;
  }

  const isAdmin = await isUserAdmin(ctx);
  if (!isAdmin) {
    await ctx.reply("Бул панелди админдер гана колдоно алат.");
    return;
  }

  await sendAdminPanel(ctx, ctx.chat.id);
}

/**
 * Отправка или обновление сообщения с панелью
 */
async function sendAdminPanel(ctx: Context, chatId: number, editMessage = false) {
  const config = await getGroupConfig(chatId);
  
  const keyboard = new InlineKeyboard()
    .text(`Капча: ${config.captchaEnabled ? "✅ Ооба" : "❌ Жок"}`, `admin:toggle:captchaEnabled`)
    .row()
    .text(`Түнкү дозор: ${config.nightModeEnabled ? "✅ Ооба" : "❌ Жок"}`, `admin:toggle:nightModeEnabled`)
    .row()
    .text(`24с Карантин: ${config.quarantineEnabled ? "✅ Ооба" : "❌ Жок"}`, `admin:toggle:quarantineEnabled`)
    .row()
    .text(`Анти-Мат: ${config.antiSwearEnabled ? "✅ Ооба" : "❌ Жок"}`, `admin:toggle:antiSwearEnabled`)
    .row()
    .text(`Сый-Урмат (Карма): ${config.karmaEnabled ? "✅ Ооба" : "❌ Жок"}`, `admin:toggle:karmaEnabled`)
    .row()
    .text(`Мут убактысы: ${config.muteDurationMinutes} мүнөт`, `admin:noop`)
    .text(`+30м`, `admin:addmute`)
    .text(`-30м`, `admin:submute`)
    .row()
    .text(`❌ Жабуу`, `admin:close`);

  const text = `⚙️ **Коопсузбек - Башкаруу Панели**\n\nБул жерден тайпаңыздын коопсуздук жөндөөлөрүн өзгөртө аласыз. Ар бир баскычты басып, функцияны күйгүзүп же өчүрүңүз.`;

  try {
    if (editMessage) {
      await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
    } else {
      await ctx.reply(text, { reply_markup: keyboard, parse_mode: "Markdown" });
    }
  } catch (error) {
    logger.error("Ошибка при отправке панели управления", error);
  }
}

/**
 * Обработчик нажатий на кнопки в панели управления
 */
export async function adminPanelCallback(ctx: Context, next: NextFunction) {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !query.data.startsWith("admin:")) {
    return next();
  }

  const chatId = query.message?.chat.id;
  if (!chatId) return;

  const isAdmin = await isUserAdmin(ctx, query.from.id);
  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: "Сиз админ эмессиз!", show_alert: true });
    return;
  }

  const parts = query.data.split(":");
  const action = parts[1];
  const field = parts[2];

  const config = await getGroupConfig(chatId);

  if (action === "toggle") {
    // @ts-ignore
    const newValue = !config[field];
    await updateGroupConfig(chatId, { [field]: newValue });
    await ctx.answerCallbackQuery("Өзгөртүлдү ✅");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "addmute") {
    const newVal = config.muteDurationMinutes + 30;
    await updateGroupConfig(chatId, { muteDurationMinutes: newVal });
    await ctx.answerCallbackQuery("Убакыт кошулду");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "submute") {
    const newVal = Math.max(10, config.muteDurationMinutes - 30); // минимум 10 минут
    await updateGroupConfig(chatId, { muteDurationMinutes: newVal });
    await ctx.answerCallbackQuery("Убакыт азайтылды");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "close") {
    if (query.message) {
      await ctx.api.deleteMessage(chatId, query.message.message_id).catch(() => {});
    }
    await ctx.answerCallbackQuery();
  } else {
    await ctx.answerCallbackQuery();
  }
}
