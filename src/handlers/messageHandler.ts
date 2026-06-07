import { Context, NextFunction } from "grammy";
import { logger } from "../utils/logger.js";
import { isUserAdmin, muteUser, banUser, unbanUser } from "../utils/telegram.js";
import { getGroupConfig } from "../utils/configManager.js";
import { db } from "../utils/db.js";
import { logAction } from "../utils/actionLogger.js";

// Регулярное выражение для поиска арабской вязи и иероглифов
const ARABIC_HIEROGLYPH_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF]/;

// Слова-триггеры для системы Кармы (Сый-Урмат)
const KARMA_WORDS = ["рахмат", "рхм", "ыраазымын", "чоң рахмат", "спс", "спасибо"];

/**
 * Обработчик выдачи предупреждений (Страйков).
 */
async function handleWarn(ctx: Context, userId: number, chatId: number, name: string, reason: string, muteMinutes: number, warnLimit: number, warnAction: "mute" | "ban" | "kick" = "mute", adminName: string = "Система (Бот)", warnIncrement: number = 1) {
  const warnKey = `chat:${chatId}:user:${userId}:warns`;
  const warns = await db.incrby(warnKey, warnIncrement);
  
  await logAction(ctx.api, chatId, userId, name, "Эскертүү (Warn)", `${reason} (${warns}/${warnLimit})`, adminName);

  if (warns < warnLimit) {
    await ctx.reply(`⚠️ **${warns}-эскертүү!** Урматтуу [${name}](tg://user?id=${userId}), тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason}`, { parse_mode: "Markdown" });
  } else if (warns >= warnLimit) {
    if (warnAction === "ban") {
      await banUser(ctx.api, chatId, userId);
      await logAction(ctx.api, chatId, userId, name, "Бан", "Эскертүүлөрдүн чегине жетти (Warn Limit)", adminName);
      await ctx.reply(`🚫 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан биротоло четтетилди (Бан). Кош болуңуз!`, { parse_mode: "Markdown" });
    } else if (warnAction === "kick") {
      await ctx.api.banChatMember(chatId, userId).catch(() => {});
      await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
      await logAction(ctx.api, chatId, userId, name, "Кик", "Эскертүүлөрдүн чегине жетти", adminName);
      await ctx.reply(`👢 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан чыгарылды (Кик).`, { parse_mode: "Markdown" });
    } else {
      await muteUser(ctx.api, chatId, userId, muteMinutes * 60);
      await logAction(ctx.api, chatId, userId, name, "Мут", `Эскертүүлөрдүн чегине жетти (${muteMinutes} мүнөт)`, adminName);
      await ctx.reply(`🔇 **Лимит толду!** [${name}](tg://user?id=${userId}) ${muteMinutes} мүнөткө жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" });
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

  // Analytics Tracking
  const today = new Date().toISOString().split("T")[0];
  await db.incr(`chat:${chatId}:stats:messages_count`);
  await db.incr(`chat:${chatId}:stats:messages_by_date:${today}`);
  await db.sadd(`chat:${chatId}:users`, userId);
  await db.hset(`chat:${chatId}:user:${userId}:info`, "name", name);
  if (ctx.from.username) await db.hset(`chat:${chatId}:user:${userId}:info`, "username", ctx.from.username);
  await db.zincrby(`chat:${chatId}:stats:top_users`, 1, userId);
  await db.zincrby(`chat:${chatId}:stats:top_users:${today}`, 1, userId);

  const isAdmin = await isUserAdmin(ctx);
  const text = ctx.message.text || ctx.message.caption || "";
  const lowerText = text.toLowerCase().trim();

  const config = await getGroupConfig(chatId);

  // 0. Текстовые команды администратора (например, отправка "бан" ответом на сообщение)
  if (isAdmin && ctx.message.reply_to_message) {
    const targetMsg = ctx.message.reply_to_message;
    const targetUserId = targetMsg.from?.id;
    if (targetUserId) {
      // 0.1 Проверка кастомных настроек команд из веб-панели
      const customCommands = config.customCommands || {};
      let matchedCmdKey: string | null = null;
      let matchedCmd: any = null;

      for (const [key, cmd] of Object.entries(customCommands)) {
        if (cmd && cmd.alias) {
          const aliases = cmd.alias.toLowerCase().split(",").map(a => a.trim());
          for (const alias of aliases) {
            if (alias && (lowerText === alias || lowerText.startsWith(alias + " "))) {
              matchedCmdKey = key;
              matchedCmd = cmd;
              break;
            }
          }
        }
        if (matchedCmdKey) break;
      }

      if (matchedCmdKey && matchedCmd) {
        const action = matchedCmd.action || "none";
        const customReply = matchedCmd.replyText || "";
        const autoDelete = matchedCmd.autoDelete || false;
        
        let reason = "Башкаруучунун буйругу (Custom Command)";
        const aliasUsed = lowerText.split(" ")[0];
        if (text.length > aliasUsed.length) {
          reason = text.substring(aliasUsed.length).trim();
        }

        let replyMsgText = "";

        if (action === "ban") {
          await banUser(ctx.api, chatId, targetUserId, 0);
          await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Бан", reason, ctx.from.first_name);
          replyMsgText = customReply || `🚷 [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) бөгөттөлдү (Бан). Себеби: ${reason}`;
        } else if (action === "mute") {
          const durationMinutes = matchedCmd.muteDuration || config.muteDurationMinutes || 120;
          await muteUser(ctx.api, chatId, targetUserId, durationMinutes * 60);
          await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Мут", `${reason} (${durationMinutes} мүнөт)`, ctx.from.first_name);
          replyMsgText = customReply || `🔇 [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) жазуу укугунан ажыратылды (Мут, ${durationMinutes} мүнөт). Себеби: ${reason}`;
        } else if (action === "kick") {
          await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
          await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
          await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Кик", reason, ctx.from.first_name);
          replyMsgText = customReply || `👢 ${targetMsg.from?.first_name} чаттан чыгарылды (Кик). Себеби: ${reason}`;
        } else if (action === "warn") {
          const warnIncrement = matchedCmd.warnCount || 1;
          await handleWarn(ctx, targetUserId, chatId, targetMsg.from?.first_name || "", reason, config.muteDurationMinutes, config.warnLimit, config.warnAction, ctx.from.first_name, warnIncrement);
          replyMsgText = customReply;
        } else if (action === "unban") {
          await unbanUser(ctx.api, chatId, targetUserId);
          await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Разбан", reason, ctx.from.first_name);
          replyMsgText = customReply || `✅ [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) бөгөттөн чыгарылды (Разбан).`;
        } else if (action === "unmute") {
          await ctx.api.restrictChatMember(chatId, targetUserId, {
            can_send_messages: true, can_send_audios: true, can_send_documents: true,
            can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
            can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
            can_add_web_page_previews: true,
          });
          await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Анмут", reason, ctx.from.first_name);
          replyMsgText = customReply || `🔊 [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) жазуу укугу кайтарылды (Анмут).`;
        } else if (action === "del") {
          await ctx.api.deleteMessage(chatId, targetMsg.message_id).catch(() => {});
          await ctx.deleteMessage().catch(() => {});
          await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Удаление", reason, ctx.from.first_name);
          replyMsgText = customReply;
        }

        if (replyMsgText) {
          replyMsgText = replyMsgText
            .replace(/{name}/g, targetMsg.from?.first_name || "Колдонуучу")
            .replace(/{target}/g, targetMsg.from?.first_name || "Колдонуучу")
            .replace(/{admin}/g, ctx.from.first_name)
            .replace(/{reason}/g, reason);

          const sentReply = await ctx.reply(replyMsgText, { parse_mode: "Markdown" }).catch(() => null);
          
          if (autoDelete) {
            setTimeout(async () => {
              await ctx.deleteMessage().catch(() => {});
              if (sentReply) {
                await ctx.api.deleteMessage(chatId, sentReply.message_id).catch(() => {});
              }
            }, 5000);
          }
        }
        return;
      }

      // 0.2 Стандартные жестко заданные текстовые команды (обратная совместимость)
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
        await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Бан", "Админдин буйругу (Manual)", ctx.from.first_name);
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
        await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Мут", "Админдин буйругу (Manual)", ctx.from.first_name);
        await ctx.reply(`🔇 [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) жазуу укугунан ажыратылды (Мут).`, { parse_mode: "Markdown" });
        return;
      } else if (lowerText === "кик" || lowerText === "kick") {
        await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Кик", "Админдин буйругу (Manual)", ctx.from.first_name);
        await ctx.reply(`👢 ${targetMsg.from?.first_name} чаттан чыгарылды (Кик).`);
        return;
      } else if (lowerText === "разбан" || lowerText === "unban") {
        await unbanUser(ctx.api, chatId, targetUserId);
        await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Разбан", "Админдин буйругу (Manual)", ctx.from.first_name);
        await ctx.reply(`✅ [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) бөгөттөн чыгарылды (Разбан).`, { parse_mode: "Markdown" });
        return;
      } else if (lowerText === "анмут" || lowerText === "unmute") {
        await ctx.api.restrictChatMember(chatId, targetUserId, {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Анмут", "Админдин буйругу (Manual)", ctx.from.first_name);
        await ctx.reply(`🔊 [${targetMsg.from?.first_name}](tg://user?id=${targetUserId}) жазуу укугу кайтарылды (Анмут).`, { parse_mode: "Markdown" });
        return;
      } else if (lowerText === "эскертүү" || lowerText === "warn") {
        await handleWarn(ctx, targetUserId, chatId, targetMsg.from?.first_name || "", "Админдин эскертүүсү", config.muteDurationMinutes, config.warnLimit, config.warnAction, ctx.from.first_name);
        return;
      } else if (lowerText === "өчүр" || lowerText === "del") {
        await ctx.api.deleteMessage(chatId, targetMsg.message_id).catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, targetMsg.from?.first_name || "Колдонуучу", "Удаление", "Админдин буйругу (Manual Del)", ctx.from.first_name);
        return;
      }
    }
  }

  if (isAdmin) return next();
  
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
    } else if (config.locks?.photo && ctx.message.photo) {
      shouldDelete = true; warnReason = "Сүрөт жөнөтүү бөгөттөлгөн.";
    } else if (config.locks?.video && ctx.message.video) {
      shouldDelete = true; warnReason = "Видео жөнөтүү бөгөттөлгөн.";
    } else if (config.locks?.audio && ctx.message.audio) {
      shouldDelete = true; warnReason = "Аудио жөнөтүү бөгөттөлгөн.";
    } else if (config.locks?.document && ctx.message.document) {
      shouldDelete = true; warnReason = "Файл/Документ жөнөтүү бөгөттөлгөн.";
    } else if (config.locks?.stickers && ctx.message.sticker) {
      shouldDelete = true; warnReason = "Стикерлер бөгөттөлгөн.";
    } else if (config.locks?.gifs && ctx.message.animation) {
      shouldDelete = true; warnReason = "GIF анимациялар бөгөттөлгөн.";
    } else if (config.locks?.voices && ctx.message.voice) {
      shouldDelete = true; warnReason = "Үн билдирүүлөр бөгөттөлгөн.";
    } else if (config.locks?.videonote && ctx.message.video_note) {
      shouldDelete = true; warnReason = "Кружоктор бөгөттөлгөн.";
    } else if (config.locks?.games && ctx.message.game) {
      shouldDelete = true; warnReason = "Оюндар бөгөттөлгөн.";
    } else if (config.locks?.commands && text?.startsWith("/")) {
      shouldDelete = true; warnReason = "Буйруктар бөгөттөлгөн.";
    } else if (config.locks?.text && text && !ctx.message.photo && !ctx.message.video && !ctx.message.document && !ctx.message.voice && !ctx.message.video_note && !ctx.message.animation) {
      shouldDelete = true; warnReason = "Жөнөкөй текст жазуу бөгөттөлгөн.";
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
            const rawAction = blacklist[word] || "warn";
            let action = "warn";
            let duration = 60 * 60; // 1h default
            let warnCount = 1;
            let customReason = `Кара тизмедеги сөз: ${word}`;

            if (rawAction.includes(":")) {
              const parts = rawAction.split(":");
              action = parts[0];
              const val = parseInt(parts[1], 10);
              customReason = parts.slice(2).join(":") || customReason;
              
              if (action === "mute" && !isNaN(val)) {
                duration = val * 60; // val is in minutes
              } else if (action === "warn" && !isNaN(val)) {
                warnCount = val;
              }
            } else {
              action = rawAction;
            }

            if (action === "delete") {
              await logAction(ctx.api, chatId, userId, name, "Удаление", customReason, "Система (Бот)");
            } else if (action === "mute") {
              await muteUser(ctx.api, chatId, userId, duration);
              await logAction(ctx.api, chatId, userId, name, "Мут", `${customReason} (${Math.round(duration/60)} мүнөт)`, "Система (Бот)");
              await ctx.reply(`🔇 [${name}](tg://user?id=${userId}) ${customReason} үчүн жазуу укугунан ажыратылды (${Math.round(duration/60)} мүнөт).`, { parse_mode: "Markdown" });
            } else if (action === "kick") {
              await ctx.api.banChatMember(chatId, userId).catch(() => {});
              await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
              await logAction(ctx.api, chatId, userId, name, "Кик", customReason, "Система (Бот)");
              await ctx.reply(`👢 [${name}](tg://user?id=${userId}) ${customReason} үчүн чыгарылды.`, { parse_mode: "Markdown" });
            } else if (action === "ban") {
              await banUser(ctx.api, chatId, userId);
              await logAction(ctx.api, chatId, userId, name, "Бан", customReason, "Система (Бот)");
              await ctx.reply(`🚫 [${name}](tg://user?id=${userId}) ${customReason} для биротоло бөгөттөлдү.`, { parse_mode: "Markdown" });
            } else {
              await handleWarn(ctx, userId, chatId, name, customReason, config.muteDurationMinutes, config.warnLimit, config.warnAction, "Система (Бот)", warnCount);
            }
            return; // stop further checks
          }
        }
      }
    } catch(e) {}
  }

  // Остальные старые проверки: Ночной дозор, Мат, Спам, Имя и т.д.
  if (config.antiArabicName) {
    const fullName = `${ctx.from.first_name} ${ctx.from.last_name || ""}`;
    if (ARABIC_HIEROGLYPH_REGEX.test(fullName)) {
      try {
        await ctx.deleteMessage();
        await banUser(ctx.api, chatId, userId);
        await logAction(ctx.api, chatId, userId, name, "Бан", "Атында араб/иероглиф тамгалары бар", "Система (Бот)");
        await ctx.reply(`❌ [${name}](tg://user?id=${userId}) четтетилди. Атында араб/иероглиф тамгалары бар.`, { parse_mode: "Markdown" });
        return;
      } catch (e) {}
    }
  }

  if (!shouldDelete && config.nightModeEnabled) {
    const utcHour = new Date().getUTCHours();
    const bishkekHour = (utcHour + 6) % 24;
    const hasMediaOrLink = ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link" || e.type === "mention");
    
    const start = config.nightModeStart;
    const end = config.nightModeEnd;
    
    let isNight = false;
    if (start < end) {
      isNight = bishkekHour >= start && bishkekHour < end;
    } else {
      isNight = bishkekHour >= start || bishkekHour < end;
    }

    if (isNight && hasMediaOrLink) {
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

  // Swear filter now uses the configurable swear list from DB
  if (!shouldDelete && config.antiSwearEnabled && text) {
    try {
      const swearList = await db.smembers(`chat:${chatId}:swearwords`);
      if (swearList && swearList.length > 0) {
        for (const sw of swearList) {
          if (lowerText.includes(sw.toLowerCase())) {
            shouldDelete = true;
            warnReason = `Сөгүнүү же адепсиз сөз: ${sw}`;
            break;
          }
        }
      }
    } catch (e) {}
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
        for (const trigger of Object.keys(filters)) {
          if (lowerText.includes(trigger.toLowerCase())) {
            await ctx.reply(filters[trigger]);
            break;
          }
        }
      }
    } catch (e) {}
  }

  await next();
}
