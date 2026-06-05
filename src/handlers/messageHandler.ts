import { Context, NextFunction } from "grammy";
import { logger } from "../utils/logger.js";
import { isUserAdmin, muteUser, banUser } from "../utils/telegram.js";
import { getGroupConfig } from "../utils/configManager.js";
import { db } from "../utils/db.js";

// Регулярное выражение для поиска арабской вязи и иероглифов
const ARABIC_HIEROGLYPH_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF]/;

// Список спам-слов (можно пополнять)
const SPAM_KEYWORDS = ["казино", "ставка", "крипта", "биткоин", "заработок", "акча", "киреше", "1xbet", "melbet"];

// Фильтр мата на русском и кыргызском (базовые корни)
const KYRGYZ_SWEAR_REGEX = /(коток|жалеп|канчык|сука|бля|нахуй|пиздец|еба|хуй|чмо|сик|амжалак|ам)/i;

// Слова-триггеры для системы Кармы (Сый-Урмат)
const KARMA_WORDS = ["рахмат", "рхм", "ыраазымын", "чоң рахмат", "спс", "спасибо"];

/**
 * Обработчик выдачи предупреждений (Страйков).
 * 3 страйка = Бан.
 */
async function handleWarn(ctx: Context, userId: number, chatId: number, name: string, reason: string, muteMinutes: number) {
  const warnKey = `chat:${chatId}:user:${userId}:warns`;
  const warns = await db.incr(warnKey);
  
  if (warns === 1) {
    await ctx.reply(`⚠️ **Биринчи эскертүү!** Урматтуу [${name}](tg://user?id=${userId}), тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason}`, { parse_mode: "Markdown" });
  } else if (warns === 2) {
    await muteUser(ctx.api, chatId, userId, muteMinutes * 60);
    await ctx.reply(`⛔ **Экинчи эскертүү!** [${name}](tg://user?id=${userId}), эрежелерди кайра бузганыңыз үчүн ${muteMinutes} мүнөткө жазуу укугунан ажыратылдыңыз.`, { parse_mode: "Markdown" });
  } else if (warns >= 3) {
    await banUser(ctx.api, chatId, userId);
    await ctx.reply(`🚫 **Үчүнчү эскертүү!** [${name}](tg://user?id=${userId}) тайпадан биротоло четтетилди (Бан). Кош болуңуз!`, { parse_mode: "Markdown" });
    await db.del(warnKey);
  }
}

export async function messageHandler(ctx: Context, next: NextFunction): Promise<void> {
  if (!ctx.message || !ctx.chat || ctx.chat.type === "private") {
    return next();
  }

  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;
  const name = ctx.from?.first_name || "Колдонуучу";
  
  if (!userId) return next();

  // Админов не проверяем
  const isAdmin = await isUserAdmin(ctx);
  if (isAdmin) return next();

  const config = await getGroupConfig(chatId);
  const text = ctx.message.text || ctx.message.caption || "";
  const lowerText = text.toLowerCase();
  
  let shouldDelete = false;
  let warnReason = "";

  // 1. Проверка Имени на иероглифы/арабскую вязь
  const fullName = `${ctx.from.first_name} ${ctx.from.last_name || ""}`;
  if (ARABIC_HIEROGLYPH_REGEX.test(fullName)) {
    try {
      await ctx.deleteMessage();
      await banUser(ctx.api, chatId, userId);
      await ctx.reply(`❌ [${name}](tg://user?id=${userId}) четтетилди. Биздин тайпада араб тамгалары же иероглифтер менен аталган колдонуучуларга уруксат жок.`, { parse_mode: "Markdown" });
      return;
    } catch (e) {
      logger.error("Error kicking user with invalid name", e);
    }
  }

  // 2. Түнкү дозор (Ночной дозор с 00:00 до 07:00 Бишкек)
  if (config.nightModeEnabled) {
    const utcHour = new Date().getUTCHours();
    const bishkekHour = (utcHour + 6) % 24;
    const hasMediaOrLink = ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link" || e.type === "mention");
    
    if (bishkekHour >= 0 && bishkekHour < 7 && hasMediaOrLink) {
      shouldDelete = true;
      warnReason = "Түнкү дозор: Түнкүсүн шилтеме жана медиа жөнөтүүгө тыюу салынган.";
    }
  }

  // 3. 24-саат Карантин (Запрет ссылок и репостов новичкам)
  if (!shouldDelete && config.quarantineEnabled) {
    const hasLinkOrForward = ctx.message.forward_origin || ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link");
    if (hasLinkOrForward) {
      const joinDate = await db.get<number>(`chat:${chatId}:user:${userId}:joinDate`);
      if (joinDate) {
        const hoursSinceJoin = (Date.now() - joinDate) / (1000 * 60 * 60);
        if (hoursSinceJoin < 24) {
          shouldDelete = true;
          warnReason = "Карантин: Тайпага кошулгандан кийин 24 саат ичинде шилтеме же башка жактан билдирүү жөнөтүүгө болбойт.";
        }
      }
    }
  }

  // 4. Анти-Мат
  if (!shouldDelete && config.antiSwearEnabled && text) {
    // Внимание: перед применением в Production регулярка может потребовать настройки, чтобы не ловить ложные срабатывания (например, в длинных словах).
    // Мы используем пробелы или границы слов для точности:
    const swearWords = KYRGYZ_SWEAR_REGEX.source.replace("(", "(?:").replace(")", ")");
    const strictSwearRegex = new RegExp(`\\b${swearWords}\\b`, 'i');
    
    if (strictSwearRegex.test(lowerText) || KYRGYZ_SWEAR_REGEX.test(lowerText)) {
      shouldDelete = true;
      warnReason = "Сөгүнүү же адепсиз сөздөр колдонулду.";
    }
  }

  // 5. Реклама и Спам
  if (!shouldDelete && text) {
    const hasSpamWord = SPAM_KEYWORDS.some(kw => lowerText.includes(kw));
    const hasMentionsOrLinks = ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link" || e.type === "mention");
    if (hasSpamWord && hasMentionsOrLinks) {
      shouldDelete = true;
      warnReason = "Реклама же спам катталды.";
    }
  }

  // Действие при нарушении
  if (shouldDelete) {
    try {
      await ctx.deleteMessage();
      await handleWarn(ctx, userId, chatId, name, warnReason, config.muteDurationMinutes);
    } catch (e) {
      logger.error(`Failed to handle violation for ${userId}`, e);
    }
    return; // Останавливаем обработку, если удалили
  }

  // 6. Система "Сый-Урмат" (Карма)
  if (config.karmaEnabled && ctx.message.reply_to_message && text) {
    const targetUser = ctx.message.reply_to_message.from;
    // Нельзя благодарить себя или ботов
    if (targetUser && !targetUser.is_bot && targetUser.id !== userId) {
      // Ищем слово из списка благодарностей
      const isThanking = KARMA_WORDS.some(word => {
        // Проверяем как отдельное слово
        const reg = new RegExp(`\\b${word}\\b`, 'i');
        return reg.test(lowerText);
      });
      
      if (isThanking) {
        const urmat = await db.incr(`chat:${chatId}:user:${targetUser.id}:urmat`);
        await ctx.reply(`🌟 [${name}](tg://user?id=${userId}), [${targetUser.first_name}](tg://user?id=${targetUser.id}) аттуу колдонуучуга ыраазычылык билдирди!\nАнын «Сый-Урмат» деңгээли: **${urmat}**`, { parse_mode: "Markdown" });
      }
    }
  }

  await next();
}
