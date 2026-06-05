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

/**
 * Отправка или обновление сообщения с панелью в ЛС
 */
export async function sendAdminPanel(ctx: Context, chatId: number, editMessage = false) {
  const config = await getGroupConfig(chatId);
  
  // Сокращаем ключи в callback_data, так как лимит 64 байта
  const keyboard = new InlineKeyboard()
    .text(`Капча: ${config.captchaEnabled ? "✅" : "❌"}`, `adm:tg:captchaEnabled:${chatId}`)
    .text(`Түнкү дозор: ${config.nightModeEnabled ? "✅" : "❌"}`, `adm:tg:nightModeEnabled:${chatId}`)
    .row()
    .text(`24с Карантин: ${config.quarantineEnabled ? "✅" : "❌"}`, `adm:tg:quarantineEnabled:${chatId}`)
    .text(`Анти-Мат: ${config.antiSwearEnabled ? "✅" : "❌"}`, `adm:tg:antiSwearEnabled:${chatId}`)
    .row()
    .text(`Сый-Урмат: ${config.karmaEnabled ? "✅" : "❌"}`, `adm:tg:karmaEnabled:${chatId}`)
    .row()
    .text(`Эскертүүлөр лимити (Warns): ${config.warnLimit}`, `adm:noop`)
    .text(`+1`, `adm:awarn:${chatId}`)
    .text(`-1`, `adm:swarn:${chatId}`)
    .row()
    .text(`Мут убактысы (мүнөт): ${config.muteDurationMinutes}`, `adm:noop`)
    .text(`+30`, `adm:amute:${chatId}`)
    .text(`-30`, `adm:smute:${chatId}`)
    .row()
    .text(`❌ Жабуу`, `adm:close:${chatId}`);

  let groupName = "Тайпа";
  try {
    const chat = await ctx.api.getChat(chatId);
    if ('title' in chat && chat.title) groupName = chat.title;
  } catch (e) {}

  const text = `⚙️ **Коопсузбек - Башкаруу Панели**\n\nТайпа: **${groupName}**\nБул жерден коопсуздук жөндөөлөрүн өзгөртө аласыз. Ар бир баскычты басып, функцияны күйгүзүп же өчүрүңүз.`;

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
 * Обработчик нажатий на кнопки в панели управления (работает в ЛС)
 */
export async function adminPanelCallback(ctx: Context, next: NextFunction) {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !query.data.startsWith("adm:")) {
    return next();
  }

  // data = adm:action:fieldOrChatId:chatId
  const parts = query.data.split(":");
  const action = parts[1];
  
  let chatId: number;
  let field = "";
  if (action === "tg") {
    field = parts[2] || "";
    chatId = parseInt(parts[3], 10);
  } else if (action === "close" || action === "noop") {
    chatId = parseInt(parts[2] || "0", 10);
  } else {
    chatId = parseInt(parts[2], 10);
  }

  if (isNaN(chatId)) return next();

  // Проверяем, является ли юзер админом в этой конкретной группе!
  const isAdmin = await isUserAdminInChat(ctx.api, chatId, query.from.id);
  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: "Сиз бул тайпада админ эмессиз!", show_alert: true });
    return;
  }

  const config = await getGroupConfig(chatId);

  if (action === "tg") {
    // @ts-ignore
    const newValue = !config[field];
    await updateGroupConfig(chatId, { [field]: newValue });
    await ctx.answerCallbackQuery("Өзгөртүлдү ✅");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "amute") {
    const newVal = config.muteDurationMinutes + 30;
    await updateGroupConfig(chatId, { muteDurationMinutes: newVal });
    await ctx.answerCallbackQuery("Убакыт кошулду");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "smute") {
    const newVal = Math.max(10, config.muteDurationMinutes - 30);
    await updateGroupConfig(chatId, { muteDurationMinutes: newVal });
    await ctx.answerCallbackQuery("Убакыт азайтылды");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "awarn") {
    const newVal = Math.min(10, config.warnLimit + 1); // Максимум 10
    await updateGroupConfig(chatId, { warnLimit: newVal });
    await ctx.answerCallbackQuery("Эскертүү лимити көбөйдү");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "swarn") {
    const newVal = Math.max(1, config.warnLimit - 1); // Минимум 1
    await updateGroupConfig(chatId, { warnLimit: newVal });
    await ctx.answerCallbackQuery("Эскертүү лимити азайды");
    await sendAdminPanel(ctx, chatId, true);
  } else if (action === "close") {
    if (query.message) {
      await ctx.api.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});
    }
    await ctx.answerCallbackQuery();
  } else {
    await ctx.answerCallbackQuery();
  }
}
