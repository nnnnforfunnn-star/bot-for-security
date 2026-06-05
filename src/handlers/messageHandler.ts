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
 */
async function handleWarn(ctx: Context, userId: number, chatId: number, name: string, reason: string, muteMinutes: number, warnLimit: number, warnAction: "mute" | "ban" | "kick" = "mute") {
  const warnKey = `chat:${chatId}:user:${userId}:warns`;
  const warns = await db.incr(warnKey);
  
  if (warns < warnLimit - 1) {
    await ctx.reply(`⚠️ **${warns}-эскертүү!** Урматтуу [${name}](tg://user?id=${userId}), тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason}`, { parse_mode: "Markdown" });
  } else if (warns === warnLimit - 1) {
    await muteUser(ctx.api, chatId, userId, muteMinutes * 60);
    await ctx.reply(`⛔ **Акыркы эскертүү!** [${name}](tg://user?id=${userId}), эрежелерди кайра бузганыңыз үчүн ${muteMinutes} мүнөткө жазуу укугунан ажыратылдыңыз.`, { parse_mode: "Markdown" });
  } else if (warns >= warnLimit) {
    if (warnAction === "ban") {
      await banUser(ctx.api, chatId, userId);
      await ctx.reply(`🚫 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан биротоло четтетилди (Бан). Кош болуңуз!`, { parse_mode: "Markdown" });
    } else if (warnAction === "kick") {
      await ctx.api.banChatMember(chatId, userId).catch(() => {});
      await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
      await ctx.reply(`👢 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан чыгарылды (Кик).`, { parse_mode: "Markdown" });
    } else {
      await muteUser(ctx.api, chatId, userId, 24 * 60 * 60); // 24h mute
      await ctx.reply(`🔇 **Лимит толду!** [${name}](tg://user?id=${userId}) 24 саатка жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" });
    }
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

  const isAdmin = await isUserAdmin(ctx);
  const text = ctx.message.text || ctx.message.caption || "";
  const lowerText = text.toLowerCase().trim();

  // 0. Текстовые команды администратора (например, отправка "бан" ответом на сообщение)
  if (isAdmin && ctx.message.reply_to_message) {
    const targetMsg = ctx.message.reply_to_message;
    const targetUserId = targetMsg.from?.id;
    if (targetUserId) {
      if (lowerText.startsWith("бан") || lowerText.startsWith("ban")) {
        let duration = 0;
        const match = lowerText.match(/(?:бан|ban)\s+(\d+)([мчсдкmhds])/);
        if (match) {
          const val = parseInt(match[1]);
          const unit = match[2];
          if (unit === 'м' || unit === 'm') duration = val * 60;
          if (unit === 'ч' || unit === 'с' || unit === 'h') duration = val * 3600;
          if (unit === 'д' || unit === 'к' || unit === 'd') duration = val * 86400;
        }
        await banUser(ctx.api, chatId, targetUserId, duration);
        await ctx.reply(`🚷 [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) бөгөттөлдү (Бан).`, { parse_mode: "Markdown" });
        return;
      } else if (lowerText.startsWith("мут") || lowerText.startsWith("mute")) {
        let duration = 120 * 60; // 2 hours default
        const match = lowerText.match(/(?:мут|mute)\s+(\d+)([мчсдкmhds])/);
        if (match) {
          const val = parseInt(match[1]);
          const unit = match[2];
          if (unit === 'м' || unit === 'm') duration = val * 60;
          if (unit === 'ч' || unit === 'с' || unit === 'h') duration = val * 3600;
          if (unit === 'д' || unit === 'к' || unit === 'd') duration = val * 86400;
        }
        await muteUser(ctx.api, chatId, targetUserId, duration);
        await ctx.reply(`🔇 [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) жазуу укугунан ажыратылды (Мут).`, { parse_mode: "Markdown" });
        return;
      } else if (lowerText === "кик" || lowerText === "kick") {
        await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await ctx.reply(`👢 ${targetMsg.from?.first_name} чаттан чыгарылды (Кик).`);
        return;
      } else if (lowerText === "эскертүү" || lowerText === "warn") {
        const config = await getGroupConfig(chatId);
        await handleWarn(ctx, targetUserId, chatId, targetMsg.from?.first_name || "", "Админдин эскертүүсү", config.muteDurationMinutes, config.warnLimit, config.warnAction);
        return;
      } else if (lowerText === "өчүр" || lowerText === "del") {
        await ctx.api.deleteMessage(chatId, targetMsg.message_id).catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        return;
      }
    }
  }

  if (isAdmin) return next();

  const config = await getGroupConfig(chatId);
  
  // --- Anti-Channel (Запрет писать от имени канала) ---
  if (config.antiChannel && ctx.message?.sender_chat?.type === "channel") {
    if (!ctx.message.is_automatic_forward) {
      await ctx.deleteMessage().catch(() => {});
      await ctx.api.banChatSenderChat(chatId, ctx.message.sender_chat.id).catch(() => {});
      return;
    }
  }

  let shouldDelete = false;
  let warnReason = "";

  // 1. Antiflood
  if (config.antiflood?.enabled) {
    const floodKey = `chat:${chatId}:user:${userId}:flood`;
    const msgCount = await db.incr(floodKey);
    if (msgCount === 1) {
      await db.expire(floodKey, config.antiflood.seconds);
    }
    if (msgCount > config.antiflood.messages) {
      await ctx.deleteMessage().catch(() => {});
      const action = config.antiflood.action;
      if (action === "mute") await muteUser(ctx.api, chatId, userId, 60 * 60); // 1 hour
      if (action === "ban") await banUser(ctx.api, chatId, userId);
      if (action === "kick") {
        await ctx.api.banChatMember(chatId, userId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
      }
      if (msgCount === config.antiflood.messages + 1 && action !== "delete") {
        await ctx.reply(`🤖 Антифлуд иштеди! [${name}](tg://user?id=${userId}) тайпаны толтурганы үчүн жазаланды (${action}).`, { parse_mode: "Markdown" });
      }
      return;
    }
  }

  // 2. Locks Module (Жесткие блокировки)
  if (!shouldDelete) {
    if (config.locks?.links && ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link")) {
      shouldDelete = true; warnReason = "Шилтемелер (Links) бөгөттөлгөн.";
    } else if (config.locks?.forwards && ctx.message.forward_origin) {
      shouldDelete = true; warnReason = "Башка каналдан репост кылуу бөгөттөлгөн.";
    } else if (config.locks?.media && (ctx.message.photo || ctx.message.video || ctx.message.document)) {
      shouldDelete = true; warnReason = "Медиа жөнөтүү бөгөттөлгөн.";
    } else if (config.locks?.stickers && ctx.message.sticker) {
      shouldDelete = true; warnReason = "Стикерлер бөгөттөлгөн.";
    } else if (config.locks?.gifs && ctx.message.animation) {
      shouldDelete = true; warnReason = "GIF анимациялар бөгөттөлгөн.";
    } else if (config.locks?.voices && (ctx.message.voice || ctx.message.video_note)) {
      shouldDelete = true; warnReason = "Үн жана видео билдирүүлөр бөгөттөлгөн.";
    } else if (config.locks?.arabic && text && /[\u0600-\u06FF]/.test(text)) {
      shouldDelete = true; warnReason = "Араб ариби бөгөттөлгөн.";
    }
  }

  // 3. Blacklist
  if (!shouldDelete && text) {
    try {
      const blacklist = await db.hgetall(`chat:${chatId}:blacklist`);
      if (blacklist) {
        for (const word of Object.keys(blacklist)) {
          if (lowerText.includes(word)) {
            await ctx.deleteMessage().catch(() => {});
            const action = blacklist[word] || "warn";
            if (action === "delete") {
              // already deleted
            } else if (action === "mute") {
              await muteUser(ctx.api, chatId, userId, 60 * 60); // 1h mute
              await ctx.reply(`🔇 [${name}](tg://user?id=${userId}) кара тизмедеги сөз үчүн жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" });
            } else if (action === "kick") {
              await ctx.api.banChatMember(chatId, userId).catch(() => {});
              await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
              await ctx.reply(`👢 [${name}](tg://user?id=${userId}) кара тизмедеги сөз үчүн чыгарылды.`, { parse_mode: "Markdown" });
            } else if (action === "ban") {
              await banUser(ctx.api, chatId, userId);
              await ctx.reply(`🚫 [${name}](tg://user?id=${userId}) кара тизмедеги сөз үчүн биротоло бөгөттөлдү.`, { parse_mode: "Markdown" });
            } else {
              await handleWarn(ctx, userId, chatId, name, `Кара тизмедеги сөз: ${word}`, config.muteDurationMinutes, config.warnLimit, config.warnAction);
            }
            return; // stop further checks
          }
        }
      }
    } catch(e) {}
  }

  // Остальные старые проверки: Ночной дозор, Мат, Спам, Имя и т.д.
  const fullName = `${ctx.from.first_name} ${ctx.from.last_name || ""}`;
  if (ARABIC_HIEROGLYPH_REGEX.test(fullName)) {
    try {
      await ctx.deleteMessage();
      await banUser(ctx.api, chatId, userId);
      await ctx.reply(`❌ [${name}](tg://user?id=${userId}) четтетилди. Атында араб тамгалары бар.`, { parse_mode: "Markdown" });
      return;
    } catch (e) {}
  }

  if (!shouldDelete && config.nightModeEnabled) {
    const utcHour = new Date().getUTCHours();
    const bishkekHour = (utcHour + 6) % 24;
    const hasMediaOrLink = ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link" || e.type === "mention");
    if (bishkekHour >= 0 && bishkekHour < 7 && hasMediaOrLink) {
      shouldDelete = true; warnReason = "Түнкү дозор: Шилтеме/Медиа жөнөтүүгө болбойт.";
    }
  }

  if (!shouldDelete && config.quarantineEnabled) {
    const hasLinkOrForward = ctx.message.forward_origin || ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link");
    if (hasLinkOrForward) {
      const joinDate = await db.get<number>(`chat:${chatId}:user:${userId}:joinDate`);
      if (joinDate) {
        const hoursSinceJoin = (Date.now() - joinDate) / (1000 * 60 * 60);
        if (hoursSinceJoin < 24) {
          shouldDelete = true; warnReason = "Карантин: 24 саат ичинде шилтеме жөнөтүүгө болбойт.";
        }
      }
    }
  }

  if (!shouldDelete && config.antiSwearEnabled && text) {
    const swearWords = KYRGYZ_SWEAR_REGEX.source.replace("(", "(?:").replace(")", ")");
    const strictSwearRegex = new RegExp(`\\b${swearWords}\\b`, 'i');
    if (strictSwearRegex.test(lowerText) || KYRGYZ_SWEAR_REGEX.test(lowerText)) {
      shouldDelete = true; warnReason = "Сөгүнүү же адепсиз сөздөр.";
    }
  }

  if (shouldDelete) {
    try {
      await ctx.deleteMessage();
      await handleWarn(ctx, userId, chatId, name, warnReason, config.muteDurationMinutes, config.warnLimit, config.warnAction);
    } catch (e) {}
    return;
  }

  // 4. Карма (Рахмат / + / -)
  if (config.karmaEnabled && ctx.message.reply_to_message && text) {
    const targetUser = ctx.message.reply_to_message.from;
    if (targetUser && !targetUser.is_bot && targetUser.id !== userId) {
      const isThanking = KARMA_WORDS.some(word => new RegExp(`\\b${word}\\b`, 'i').test(lowerText)) || lowerText === "+";
      const isMinus = lowerText === "-";
      
      if (isThanking) {
        const urmat = await db.zincrby(`chat:${chatId}:urmat_leaderboard`, 1, targetUser.id);
        await db.set(`chat:${chatId}:user:${targetUser.id}:urmat`, urmat);
        await ctx.reply(`🌟 [${name}](tg://user?id=${userId}), [${targetUser.first_name}](tg://user?id=${targetUser.id}) аттуу колдонуучунун рейтингин көтөрдү!\nАнын «Сый-Урмат» деңгээли: **${urmat}**`, { parse_mode: "Markdown" });
      } else if (isMinus) {
        const urmat = await db.zincrby(`chat:${chatId}:urmat_leaderboard`, -1, targetUser.id);
        await db.set(`chat:${chatId}:user:${targetUser.id}:urmat`, urmat);
        await ctx.reply(`📉 [${name}](tg://user?id=${userId}), [${targetUser.first_name}](tg://user?id=${targetUser.id}) аттуу колдонуучунун рейтингин түшүрдү.\nЖаңы деңгээли: **${urmat}**`, { parse_mode: "Markdown" });
      }
    }
  }

  // 5. Автожооптор (Filters)
  if (text) {
    try {
      const filters = await db.hgetall(`chat:${chatId}:filters`);
      if (filters) {
        const words = lowerText.split(/\s+/);
        for (const word of words) {
          if (filters[word]) {
            await ctx.reply(filters[word]);
            break;
          }
        }
      }
    } catch (e) {}
  }

  await next();
}
