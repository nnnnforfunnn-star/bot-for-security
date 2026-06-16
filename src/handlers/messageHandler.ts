import { Context, NextFunction, InlineKeyboard } from "grammy";
import { logger } from "../utils/logger.js";
import { config as botEnvConfig } from "../config.js";
import { isUserAdmin, muteUser, banUser, unbanUser, formatMessageToHtml, parseDurationAndReason } from "../utils/telegram.js";
import { getGroupConfig, updateGroupConfig } from "../utils/configManager.js";
import { db } from "../utils/db.js";
import { logAction } from "../utils/actionLogger.js";
import { runActivityCheck } from "../utils/activityScheduler.js";
import { runQuizCheck } from "../utils/quizScheduler.js";

// Импорт обработчиков команд для поддержки кастомных алиасов (коротких команд)
import { zombiesCommand, muteallCommand, unmuteallCommand, pinCommand, unpinCommand, kickmeCommand, idCommand, warnsCommand, unwarnCommand } from "./modCommands.js";
import { rulesCommand, meCommand, purgeCommand, reportCommand, mainchatCommand } from "./adminCommands.js";
import { linkCommand, adminsCommand, infoCommand, slowmodeCommand, promoteCommand, demoteCommand } from "./groupCommands.js";
import { handleMuteCommand, handleUnmuteCommand, handleBanCommand, handleUnbanCommand } from "./commandHandler.js";
import { adminPanelCommand } from "./adminPanel.js";

const commandHandlers: Record<string, (ctx: Context) => Promise<any>> = {
  zombies: zombiesCommand,
  muteall: muteallCommand,
  unmuteall: unmuteallCommand,
  pin: pinCommand,
  unpin: unpinCommand,
  kickme: kickmeCommand,
  id: idCommand,
  rules: rulesCommand,
  me: meCommand,
  link: linkCommand,
  admins: adminsCommand,
  info: infoCommand,
  warns: warnsCommand,
  unwarn: unwarnCommand,
  slowmode: slowmodeCommand,
  promote: promoteCommand,
  demote: demoteCommand,
  purge: purgeCommand,
  report: reportCommand,
  ban: handleBanCommand,
  unban: handleUnbanCommand,
  mute: handleMuteCommand,
  unmute: handleUnmuteCommand,
  mainchat: mainchatCommand
};

// Регулярное выражение для поиска арабской вязи и иероглифов
const ARABIC_HIEROGLYPH_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF]/;
function isLinkWhitelisted(text: string, entities: any[], whitelist: string[]): boolean {
  if (!entities || entities.length === 0) return true;
  if (!whitelist || whitelist.length === 0) return false;
  
  const cleanWhitelist = whitelist.map(d => d.trim().toLowerCase()).filter(d => d.length > 0);
  if (cleanWhitelist.length === 0) return false;

  for (const entity of entities) {
    let urlStr = "";
    if (entity.type === "url") {
      urlStr = text.substring(entity.offset, entity.offset + entity.length);
    } else if (entity.type === "text_link") {
      urlStr = entity.url;
    }
    
    if (urlStr) {
      try {
        if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
          urlStr = "https://" + urlStr;
        }
        const hostname = new URL(urlStr).hostname.toLowerCase();
        
        const isWhitelisted = cleanWhitelist.some(domain => {
          return hostname === domain || hostname.endsWith("." + domain);
        });
        
        if (!isWhitelisted) {
          return false;
        }
      } catch (e) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Безопасное удаление сообщения с логированием ошибки и выводом предупреждения о правах.
 */
async function safeDeleteMessage(ctx: Context, chatId: number | string, messageId: number, silent = false): Promise<boolean> {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
    return true;
  } catch (err: any) {
    logger.error("Failed to delete message:", err);
    if (!silent && err.description && (err.description.includes("not enough rights") || err.description.includes("admin") || err.description.includes("write privileges") || err.description.includes("privilege"))) {
      await ctx.reply("⚠️ Боттун билдирүүлөрдү өчүрүүгө укугу жок! Сураныч, ботко администратор орнотууларынан билдирүүлөрдү өчүрүүгө уруксат бериңиз.").catch(() => {});
    }
    return false;
  }
}

/**
 * Обработчик выдачи предупреждений (Страйков).
 */
async function handleWarn(ctx: Context, userId: number, chatId: number, name: string, reason: string, muteMinutes: number, warnLimit: number, warnAction: "mute" | "ban" | "kick" = "mute", adminName: string = "Коопсузбек", warnIncrement: number = 1) {
  const warnKey = `chat:${chatId}:user:${userId}:warns`;
  const warns = await db.incrby(warnKey, warnIncrement);
  
  try {
    const config = await getGroupConfig(chatId);
    if (config.warnExpireDays && config.warnExpireDays > 0) {
      await db.expire(warnKey, config.warnExpireDays * 86400);
    }
  } catch (e) {
    logger.error("Error setting warn expiration:", e);
  }
  
  await logAction(ctx.api, chatId, userId, name, "Эскертүү", `${reason}, чек: ${warns}/${warnLimit}`, adminName);

  if (warns < warnLimit) {
    const textMsg = `⚠️ **${warns}-эскертүү!** Урматтуу [${name}](tg://user?id=${userId}), тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason}\nБашкаруучу: ${adminName}`;
    await ctx.reply(textMsg, { parse_mode: "Markdown" }).catch(async () => {
      await ctx.reply(`⚠️ ${warns}-эскертүү! Урматтуу ${name}, тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason}\nБашкаруучу: ${adminName}`);
    });
  } else if (warns >= warnLimit) {
    if (warnAction === "ban") {
      await banUser(ctx.api, chatId, userId);
      await logAction(ctx.api, chatId, userId, name, "Бан", "Эскертүүлөрдүн чеги толду", adminName);
      const textMsg = `🚫 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан биротоло бөгөттөлдү. Кош болуңуз!\nБашкаруучу: ${adminName}`;
      await ctx.reply(textMsg, { parse_mode: "Markdown" }).catch(async () => {
        await ctx.reply(`🚫 Лимит толду! ${name} тайпадан биротоло бөгөттөлдү. Кош болуңуз!\nБашкаруучу: ${adminName}`);
      });
    } else if (warnAction === "kick") {
      await ctx.api.banChatMember(chatId, userId).catch(() => {});
      await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
      await logAction(ctx.api, chatId, userId, name, "Кик", "Эскертүүлөрдүн чегине жетти", adminName);
      const textMsg = `👢 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан чыгарылды.\nБашкаруучу: ${adminName}`;
      await ctx.reply(textMsg, { parse_mode: "Markdown" }).catch(async () => {
        await ctx.reply(`👢 Лимит толду! ${name} тайпадан чыгарылды.\nБашкаруучу: ${adminName}`);
      });
    } else {
      await muteUser(ctx.api, chatId, userId, muteMinutes * 60);
      await logAction(ctx.api, chatId, userId, name, "Мут", `Эскертүүлөрдүн чегине жетти, мөөнөтү: ${muteMinutes} мүнөт`, adminName);
      const textMsg = `🔇 **Лимит толду!** [${name}](tg://user?id=${userId}) ${muteMinutes} мүнөткө жазуу укугунан ажыратылды.\nБашкаруучу: ${adminName}`;
      await ctx.reply(textMsg, { parse_mode: "Markdown" }).catch(async () => {
        await ctx.reply(`🔇 Лимит толду! ${name} ${muteMinutes} мүнөткө жазуу укугунан ажыратылды.\nБашкаруучу: ${adminName}`);
      });
    }
    await db.del(warnKey);
  }
}

async function findUserIdByUsername(chatId: number, username: string): Promise<{ id: number; name: string } | null> {
  const cleanUsername = username.replace("@", "").trim().toLowerCase();
  if (!cleanUsername) return null;

  try {
    const userIds = await db.smembers(`chat:${chatId}:users`);
    for (const uidStr of userIds) {
      const storedUsername = await db.hget<string>(`chat:${chatId}:user:${uidStr}:info`, "username");
      if (storedUsername && storedUsername.toLowerCase() === cleanUsername) {
        const storedName = await db.hget<string>(`chat:${chatId}:user:${uidStr}:info`, "name") || "Колдонуучу";
        return { id: parseInt(uidStr, 10), name: storedName };
      }
    }
  } catch (e) {
    logger.error("Error finding user by username:", e);
  }
  return null;
}

async function resolveTargetUser(ctx: Context, text: string, triggerUsed: string): Promise<{ id: number; name: string } | null> {
  const targetMsg = ctx.message?.reply_to_message || ctx.editedMessage?.reply_to_message;
  if (targetMsg && targetMsg.from) {
    return {
      id: targetMsg.from.id,
      name: targetMsg.from.first_name || "Колдонуучу"
    };
  }

  // Попробуем извлечь аргумент из текста после триггера/алиаса
  const lowerText = text.toLowerCase();
  const triggerIndex = lowerText.indexOf(triggerUsed.toLowerCase());
  let remaining = text;
  if (triggerIndex !== -1) {
    remaining = text.substring(triggerIndex + triggerUsed.length).trim();
  }

  const args = remaining.split(/\s+/).filter(a => a.length > 0);
  if (args.length > 0) {
    const arg = args[0];
    // Если это ID пользователя
    const potentialId = parseInt(arg, 10);
    if (!isNaN(potentialId) && potentialId > 1000) {
      return { id: potentialId, name: `Колдонуучу [${potentialId}]` };
    }
    // Если это юзернейм
    if (arg.startsWith("@")) {
      const found = await findUserIdByUsername(ctx.chat!.id, arg);
      if (found) return found;
    }
  }

  return null;
}async function checkAndSendAnnouncements(ctx: Context, chatId: number) {
  try {
    const announcementsMap = await db.hgetall(`chat:${chatId}:announcements`);
    if (!announcementsMap) return;

    for (const [annId, annValRaw] of Object.entries(announcementsMap)) {
      if (!annValRaw) continue;
      try {
        let ann: any;
        if (typeof annValRaw === "string") {
          ann = JSON.parse(annValRaw);
        } else {
          ann = annValRaw;
        }
        if (ann.enabled === false) continue;

        let shouldSend = false;
        const now = Date.now();
        const lastSent = ann.lastSent || 0;

        if (ann.intervalType === "interval") {
          const intervalMs = (ann.intervalValue || 60) * 60 * 1000;
          if (now - lastSent >= intervalMs) {
            shouldSend = true;
          }
        } else if (ann.intervalType === "daily") {
          const bishkekTime = new Date(now + 6 * 3600 * 1000);
          const todayStr = bishkekTime.toISOString().split("T")[0];
          const lastSentDateStr = lastSent ? new Date(lastSent + 6 * 3600 * 1000).toISOString().split("T")[0] : "";
          
          if (todayStr !== lastSentDateStr) {
            const [targetHours, targetMinutes] = (ann.dailyTime || "12:00").split(":").map(Number);
            const currentHours = bishkekTime.getUTCHours();
            const currentMinutes = bishkekTime.getUTCMinutes();
            if (currentHours > targetHours || (currentHours === targetHours && currentMinutes >= targetMinutes)) {
              shouldSend = true;
            }
          }
        }

        if (shouldSend) {
          const targetChats = ann.chats || [];
          for (const targetChatId of targetChats) {
            try {
              let replyMarkup = undefined;
              if (Array.isArray(ann.buttons) && ann.buttons.length > 0) {
                replyMarkup = new InlineKeyboard();
                for (const btn of ann.buttons) {
                  if (btn.text && btn.url) {
                    replyMarkup.url(btn.text, btn.url).row();
                  }
                }
              }

              const targetConfig = await getGroupConfig(targetChatId);
              const threadId = targetConfig.mainTopicId;

              if (ann.photo) {
                await ctx.api.sendPhoto(targetChatId, ann.photo, {
                  caption: ann.text,
                  reply_markup: replyMarkup,
                  parse_mode: "Markdown",
                  message_thread_id: threadId
                }).catch(async () => {
                  return await ctx.api.sendPhoto(targetChatId, ann.photo, {
                    caption: ann.text,
                    reply_markup: replyMarkup,
                    message_thread_id: threadId
                  });
                });
              } else {
                await ctx.api.sendMessage(targetChatId, ann.text, {
                  reply_markup: replyMarkup,
                  parse_mode: "Markdown",
                  message_thread_id: threadId
                }).catch(async () => {
                  return await ctx.api.sendMessage(targetChatId, ann.text, {
                    reply_markup: replyMarkup,
                    message_thread_id: threadId
                  });
                });
              }
            } catch (chatErr) {
              logger.error(`Error sending announcement ${annId} to chat ${targetChatId}:`, chatErr);
            }
          }

          ann.lastSent = now;
          await db.hset(`chat:${chatId}:announcements`, annId, JSON.stringify(ann));
        }
      } catch (e) {
        logger.error(`Error processing announcement ${annId}:`, e);
      }
    }
  } catch (err) {
    logger.error("Error in checkAndSendAnnouncements:", err);
  }
}

async function checkAndDeleteBroadcasts(ctx: Context) {
  try {
    const listKey = "global:broadcast_deletions";
    const items = await db.lrange(listKey, 0, -1);
    if (!items || items.length === 0) return;

    const now = Date.now();
    const remaining: string[] = [];

    for (const itemRaw of items) {
      try {
        const item = typeof itemRaw === "string" ? JSON.parse(itemRaw) : itemRaw;
        if (now >= item.deleteAt) {
          await ctx.api.deleteMessage(item.chatId, item.messageId).catch(() => {});
        } else {
          remaining.push(JSON.stringify(item));
        }
      } catch (e) {
        // If it's corrupted, don't keep it
      }
    }

    // Update the list in Redis
    await db.del(listKey);
    for (const rem of remaining) {
      await db.rpush(listKey, rem);
    }
  } catch (err) {
    logger.error("Error in checkAndDeleteBroadcasts:", err);
  }
}

export async function messageHandler(ctx: Context, next: NextFunction): Promise<void> {
  const msg = ctx.message || ctx.editedMessage;
  if (!msg || !ctx.chat || ctx.chat.type === "private") {
    return next();
  }
  const msgEntities = [...(msg.entities || []), ...(msg.caption_entities || [])];

  const chatId = ctx.chat.id;

  // Проверяем лок планировщика объявлений для этого чата раз в 30 секунд
  const lockKey = `chat:${chatId}:scheduler:lock`;
  try {
    const hasLock = await db.get(lockKey);
    if (!hasLock) {
      await db.set(lockKey, "locked", 30);
      await checkAndSendAnnouncements(ctx, chatId).catch(err => logger.error("Error in announcements check:", err));
      await runActivityCheck().catch(err => logger.error("Error in activity generator:", err));
      await runQuizCheck().catch(err => logger.error("Error in quiz check:", err));
      await checkAndDeleteBroadcasts(ctx).catch(err => logger.error("Error in checkAndDeleteBroadcasts:", err));
    }
  } catch (lockErr) {
    logger.error("Error checking/setting scheduler lock:", lockErr);
  }
  const userId = ctx.from?.id;
  const name = ctx.from?.first_name || "Колдонуучу";
  
  if (!userId) return next();

  const config = await getGroupConfig(chatId);
  const isAdmin = await isUserAdmin(ctx);

  const executeViolation = async (action: string, reason: string) => {
    try {
      await safeDeleteMessage(ctx, chatId, msg.message_id);
      if (action === "warn") {
        await handleWarn(ctx, userId, chatId, name, reason, config.muteDurationMinutes, config.warnLimit, config.warnAction);
      } else if (action === "mute") {
        const dur = config.muteDurationMinutes || 120;
        await muteUser(ctx.api, chatId, userId, dur * 60);
        await logAction(ctx.api, chatId, userId, name, "Мут", `${reason}, мөөнөтү: ${dur} мүнөт`, "Система");
        const replyText = `🔇 [${name}](tg://user?id=${userId}) ${reason} үчүн жазуу укугунан ажыратылды. Мөөнөтү: ${dur} мүнөт.`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`🔇 ${name} ${reason} үчүн жазуу укугунан ажыратылды. Мөөнөтү: ${dur} мүнөт.`);
        });
      } else if (action === "kick") {
        await ctx.api.banChatMember(chatId, userId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
        await logAction(ctx.api, chatId, userId, name, "Кик", reason, "Система");
        const replyText = `👢 [${name}](tg://user?id=${userId}) ${reason} үчүн чыгарылды.`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`👢 ${name} ${reason} үчүн чыгарылды.`);
        });
      } else if (action === "ban") {
        await banUser(ctx.api, chatId, userId);
        await logAction(ctx.api, chatId, userId, name, "Бан", reason, "Система");
        const replyText = `🚫 [${name}](tg://user?id=${userId}) ${reason} үчүн бөгөттөлдү.`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`🚫 ${name} ${reason} үчүн бөгөттөлдү.`);
        });
      } else {
        await logAction(ctx.api, chatId, userId, name, "Өчүрүү", reason, "Система");
      }
    } catch (e) {
      logger.error("Error executing violation action:", e);
    }
  };

  // --- LOCKDOWN MODE (Чукул кырдаал режими) ---
  if (config.lockdownMode && !isAdmin) {
    const act = config.lockdownAction || "delete";
    await executeViolation(act, "Өзгөчө кырдаал режими (Lockdown)");
    return;
  }

  // Analytics Tracking
  const isEdited = !!ctx.editedMessage;
  if (!isEdited) {
    const today = new Date().toISOString().split("T")[0];
    await db.incr(`chat:${chatId}:stats:messages_count`);
    await db.incr(`chat:${chatId}:stats:messages_by_date:${today}`);
    await db.sadd(`chat:${chatId}:users`, userId);
    await db.hset(`chat:${chatId}:user:${userId}:info`, "name", name);
    if (ctx.from.username) await db.hset(`chat:${chatId}:user:${userId}:info`, "username", ctx.from.username);
    await db.zincrby(`chat:${chatId}:stats:top_users`, 1, userId);
    await db.zincrby(`chat:${chatId}:stats:top_users:${today}`, 1, userId);
  }

  const text = msg.text || msg.caption || "";
  const lowerText = text.toLowerCase().trim();

  // --- GLOBAL CONFIGURATION CHECKS (Глобалдык Башкаруу) ---
  try {
    const { getGlobalConfig } = await import("../utils/configManager.js");
    const globalConfig = await getGlobalConfig();

    // 1. Глобалдык Кара Тизме (Global Blacklist)
    if (globalConfig.globalBlacklistEnabled && globalConfig.globalBlacklistUsers) {
      const blacklistIds = globalConfig.globalBlacklistUsers.split(/[\s,;\n]+/).map(id => id.trim()).filter(Boolean);
      if (blacklistIds.includes(String(userId))) {
        try {
          await ctx.api.banChatMember(chatId, userId);
          await safeDeleteMessage(ctx, chatId, msg.message_id);
          const replyText = `🚫 [${name}](tg://user?id=${userId}) глобалдык кара тизмеде (Global Blacklist) болгондуктан тайпадан бөгөттөлдү.`;
          await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
            await ctx.reply(`🚫 ${name} глобалдык кара тизмеде (Global Blacklist) болгондуктан тайпадан бөгөттөлдү.`);
          });
          await logAction(ctx.api, chatId, userId, name, "Ban", "Глобалдык кара тизме", "Система");
        } catch (e) {
          logger.error(`Error banning global blacklisted user ${userId} on message`, e);
        }
        return;
      }
    }

    if (!isAdmin) {
      // 2. Түнкү режим (Global Night Mode)
      if (globalConfig.nightModeEnabled) {
        const utcHour = new Date().getUTCHours();
        const bishkekHour = (utcHour + 6) % 24;
        const start = globalConfig.nightModeStartHour ?? 23;
        const end = globalConfig.nightModeEndHour ?? 7;
        
        let isNight = false;
        if (start < end) {
          isNight = bishkekHour >= start && bishkekHour < end;
        } else {
          isNight = bishkekHour >= start || bishkekHour < end;
        }
        
        if (isNight) {
          const act = globalConfig.nightModeAction || "delete";
          if (act === "restrict") {
            await safeDeleteMessage(ctx, chatId, msg.message_id);
            await logAction(ctx.api, chatId, userId, name, "Өчүрүү", "Глобалдык түнкү режим: билдирүү жөнөтүү жабык", "Система");
          } else {
            await executeViolation(act, "Глобалдык түнкү режим");
          }
          return;
        }
      }

      // 3. Спамга каршы коргоо (Global Anti-Flood)
      if (globalConfig.antiFloodEnabled) {
        const floodMax = globalConfig.antiFloodMaxMessages || 5;
        const floodSec = globalConfig.antiFloodSeconds || 3;
        const muteMin = globalConfig.antiFloodMuteMinutes || 15;
        
        const floodKey = `global:flood:${chatId}:user:${userId}`;
        const currentCount = await db.get<number>(floodKey) || 0;
        if (currentCount === 0) {
          await db.set(floodKey, 1, floodSec);
        } else if (currentCount >= floodMax) {
          await safeDeleteMessage(ctx, chatId, msg.message_id);
          const actMute = muteMin * 60;
          await muteUser(ctx.api, chatId, userId, actMute);
          await logAction(ctx.api, chatId, userId, name, "Мут", `Глобалдык анти-флуд: лимит ашты (${floodMax} билдирүү / ${floodSec}с)`, "Система");
          if (currentCount === floodMax) {
            await ctx.reply(`🤖 Глобалдык анти-флуд иштеди! [${name}](tg://user?id=${userId}) тайпаны толтурганы үчүн ${muteMin} мүнөткө мутталды.`, { parse_mode: "Markdown" });
          }
          return;
        } else {
          await db.set(floodKey, currentCount + 1, floodSec);
        }
      }

      // 4. Шилтемелерди чектөө (Global Anti-Link)
      if (globalConfig.antiLinkEnabled) {
        const hasLink = msgEntities.some(e => e.type === "url" || e.type === "text_link");
        if (hasLink) {
          const whitelistRaw = globalConfig.antiLinkWhitelist || "";
          const whitelist = whitelistRaw.split(/[\s,;\n]+/).map(d => d.trim().toLowerCase()).filter(Boolean);
          const allWhitelisted = isLinkWhitelisted(text, msgEntities, whitelist);
          if (!allWhitelisted) {
            const act = globalConfig.antiLinkAction || "delete";
            await executeViolation(act, "Глобалдык анти-ссылка: шилтемелерге тыюу салынган.");
            return;
          }
        }
      }
    }

    // 5. Сөгүнгөнгө каршы фильтр (Global Swear Filter)
    if (globalConfig.profanityFilterEnabled && text) {
      let wordsToCheck: string[] = [];
      if (globalConfig.profanityCustomWords) {
        wordsToCheck = globalConfig.profanityCustomWords.split(/[\s,;\n]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
      }
      if (wordsToCheck.length > 0) {
        for (const sw of wordsToCheck) {
          if (lowerText.includes(sw)) {
            const act = globalConfig.profanityAction || "warn";
            await executeViolation(act, `Глобалдык адепсиз сөз: ${sw}`);
            return;
          }
        }
      }
    }

    // --- GLOBAL SUPER FEATURES ---
    
    // 1. Глобалдык Паника Режими (Global Panic Mode)
    if (globalConfig.globalPanicEnabled && !isAdmin) {
      await executeViolation("delete", "Глобалдык Паника Режими активдүү");
      return;
    }

    // 2. ЖИ Токсиктүүлүк көзөмөлү (AI Toxicity & Sentiment Engine)
    if (globalConfig.toxicityFilterEnabled && text && !isAdmin) {
      let isToxic = false;
      let reason = "";
      
      const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁүҮөӨңҢ]/g, "");
      if (letters.length >= 8) {
        const caps = letters.replace(/[^A-ZА-ЯЁҮӨҢ]/g, "");
        if (caps.length / letters.length > 0.85) {
          isToxic = true;
          reason = "Ашыкча CAPSLOCK колдонуу";
        }
      }
      
      if (!isToxic) {
        const consonantMatch = text.match(/[цкнгшщзхфвпрлджчмтббвгджзйклмнпрстфхцчшщъыьэюяүөң]{8,}/i);
        if (consonantMatch) {
          isToxic = true;
          reason = "Түшүнүксүз спам (Keyboard smash)";
        }
      }
      
      if (!isToxic) {
        const repeatingChar = /(.)\1{6,}/;
        if (repeatingChar.test(text)) {
          isToxic = true;
          reason = "Символдорду ашыкча кайталоо";
        }
      }

      if (!isToxic) {
        const toxicKeywords = ["сука", "нахуй", "бля", "пидр", "пидор", "гандон", "далбаеб", "далбайоб", "малсың", "эшек", "сөкпө", "өлтүрөм", "сабап", "урам", "кот", "котун", "амсың"];
        for (const word of toxicKeywords) {
          if (lowerText.includes(word)) {
            isToxic = true;
            reason = `Агрессивдүү сөз аныкталды: ${word}`;
            break;
          }
        }
      }
      
      if (isToxic) {
        const act = globalConfig.toxicityAction || "delete";
        await executeViolation(act, `ЖИ Токсиктүүлүк чыпкасы: ${reason}`);
        return;
      }
    }

    // 3. Глобалдык Карма Аурасын Тазалоо (Global Karma Aura Purge)
    if (globalConfig.karmaPurgeEnabled && !isAdmin) {
      const threshold = globalConfig.karmaMinThreshold ?? -10;
      const karmaKey = `chat:${chatId}:user:${userId}:urmat`;
      const userKarma = await db.get<number>(karmaKey) || 0;
      if (userKarma < threshold) {
        const act = globalConfig.karmaPurgeAction || "mute";
        await executeViolation(act, `Глобалдык карма аурасы тазалоо (Карма: ${userKarma} < ${threshold})`);
        return;
      }
    }

    // 4. Санариптик Колтамга & Кайталануу чыпкасы (Digital Fingerprint Shield)
    if (globalConfig.fingerprintEnabled && text.length > 10 && !isAdmin) {
      const cleanMsg = lowerText.replace(/\s+/g, "");
      let hashVal = 0;
      for (let i = 0; i < cleanMsg.length; i++) {
        hashVal = ((hashVal << 5) - hashVal) + cleanMsg.charCodeAt(i);
        hashVal |= 0;
      }
      const fingerprintKey = `global:fingerprint:${hashVal}`;
      const existingSender = await db.get<string>(fingerprintKey);
      if (existingSender) {
        const [prevUser, prevChat] = existingSender.split(":");
        if (prevUser !== String(userId)) {
          const act = globalConfig.fingerprintAction || "ban";
          await executeViolation(act, "Санариптик колтамга чыпкасы: спам кайталанды.");
          return;
        }
      } else {
        await db.set(fingerprintKey, `${userId}:${chatId}`, 60);
      }
    }

    // 5. Чатты ойготуучу (AI Conversation Starter / Wake-Up Chat)
    if (globalConfig.wakeupEnabled) {
      const timeoutHours = globalConfig.wakeupTimeoutHours || 3;
      const lastActKey = `chat:${chatId}:last_activity`;
      const lastAct = await db.get<number>(lastActKey);
      const now = Date.now();
      if (lastAct && (now - lastAct > timeoutHours * 3600 * 1000)) {
        const hashKey = "global:icebreakers";
        const allIb = await db.hgetall(hashKey) || {};
        const ibList = Object.values(allIb);
        if (ibList.length > 0) {
          const randomIbRaw: any = ibList[Math.floor(Math.random() * ibList.length)];
          let randomIb = randomIbRaw;
          if (typeof randomIb === "string") {
            try { randomIb = JSON.parse(randomIbRaw); } catch(e) {}
          }
          if (randomIb && randomIb.text) {
            setTimeout(async () => {
              await ctx.reply(`💬 **Тайпада бир аз тынчтык болуп калыптыр. Келиңиздер, маек курабыз!**\n\n${randomIb.text}`).catch(() => {});
            }, 1500);
          }
        }
      }
      await db.set(lastActKey, now);
    } else {
      await db.set(`chat:${chatId}:last_activity`, Date.now());
    }
  } catch (e) {
    logger.error("Error running Global Configuration checks:", e);
  }

  // 00. Жаратуучунун жеке автожооптору (Creator triggers)
  if (text) {
    try {
      const { handleCreatorTrigger } = await import("./creatorCommands.js");
      const isCreatorTriggered = await handleCreatorTrigger(ctx, text);
      if (isCreatorTriggered) {
        return;
      }
    } catch (e) {
      logger.error("Error processing creator triggers:", e);
    }
  }

  // 0. Автожооптор (Filters) - Текшерүү баарына тиешелүү, эгер өчүрүлбөсө
  if (text && config.disableFilters !== true && (config.disableFilters as any) !== "true") {
    try {
      const filters = await db.hgetall(`chat:${chatId}:filters`);
      if (filters) {
        for (const trigger of Object.keys(filters)) {
          const triggers = trigger.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
          let isMatched = false;

          for (const trig of triggers) {
            const escaped = trig.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            // Match trig as a whole word (bounded by non-alphanumeric Cyrillic/Latin characters)
            const regex = new RegExp(`(?<=^|[^a-zA-Z0-9\\u0400-\\u04FF])${escaped}(?=$|[^a-zA-Z0-9\\u0400-\\u04FF])`, 'i');
            if (regex.test(lowerText)) {
              isMatched = true;
              break;
            }
          }

          if (isMatched) {
            if (config.smartContextFilters !== false) {
              let confidence = 0.3;
              if (text.includes("?")) {
                confidence += 0.3;
              }
              const inquiryWords = [
                "кандай", "эмне", "качан", "кайда", "эмнеге", "ким", "кайсы", "канча", "неге", "кылабыз", "болобу", "барбы", "жардам", "көмөк",
                "как", "что", "где", "когда", "почему", "зачем", "кто", "какой", "сколько", "можно", "есть", "ли", "помочь", "помощь", "подскажите"
              ];
              const words = lowerText.split(/[^a-zA-Z0-9\u0400-\u04FF]/).filter(Boolean);
              const hasInquiryWord = words.some(w => inquiryWords.includes(w));
              if (hasInquiryWord) {
                confidence += 0.3;
              }
              if (text.length < 60) {
                confidence += 0.2;
              } else if (text.length > 200) {
                confidence -= 0.1;
              }
              const botId = parseInt(botEnvConfig.BOT_TOKEN.split(":")[0], 10);
              if (ctx.message?.reply_to_message?.from?.id === botId) {
                confidence += 0.2;
              }
              if (confidence < 0.5) {
                continue;
              }
            }

            let replyContent = filters[trigger];
            let replyText = replyContent;
            let keyboard: InlineKeyboard | undefined = undefined;

            let photoUrl: string | undefined = undefined;
            try {
              if (replyContent.startsWith("{") && replyContent.endsWith("}")) {
                const parsed = JSON.parse(replyContent);
                replyText = parsed.text || "";
                photoUrl = parsed.photo;
                
                const linkFormat = parsed.linkFormat || "button";

                if (linkFormat === "inline_text" && Array.isArray(parsed.buttons)) {
                  let linksStr = "";
                  for (const btn of parsed.buttons) {
                    if (btn.text && btn.url) {
                      if (linksStr) {
                        linksStr += "\n-------------------\n";
                      } else {
                        linksStr += "\n\n";
                      }
                      linksStr += `[${btn.text}](${btn.url})`;
                    }
                  }
                  replyText += linksStr;
                } else {
                  const kb = new InlineKeyboard();
                  let hasButtons = false;

                  if (Array.isArray(parsed.buttons)) {
                    for (const btn of parsed.buttons) {
                      if (btn.text && btn.url) {
                        kb.url(btn.text, btn.url).row();
                        hasButtons = true;
                      }
                    }
                  } else if (parsed.buttonText && parsed.buttonUrl) {
                    kb.url(parsed.buttonText, parsed.buttonUrl);
                    hasButtons = true;
                  }

                  if (hasButtons) {
                    keyboard = kb;
                  }
                }
              }
            } catch (e) {
              // Not JSON
            }

            const formattedText = formatMessageToHtml(replyText);

            if (photoUrl) {
              try {
                await ctx.replyWithPhoto(photoUrl, {
                  caption: formattedText,
                  reply_markup: keyboard,
                  parse_mode: "HTML"
                });
                break;
              } catch (e) {
                try {
                  await ctx.replyWithPhoto(photoUrl, {
                    caption: replyText,
                    reply_markup: keyboard
                  });
                  break;
                } catch (photoErr) {
                  // Fall through to text-only reply
                }
              }
            }

            await ctx.reply(formattedText, {
              reply_markup: keyboard,
              parse_mode: "HTML"
            }).catch(async () => {
              await ctx.reply(replyText, {
                reply_markup: keyboard
              }).catch(() => {});
            });
            break;
          }
        }
      }
    } catch (e) {}
  }

  // 0. Встроенные сокращенные текстовые команды (Кыргызские / Русские алиасы)
  const builtinCommandAliases: Record<string, { handler: (ctx: Context) => Promise<any>; requiresAdmin: boolean }> = {
    "эрежелер": { handler: rulesCommand, requiresAdmin: false },
    "эреже": { handler: rulesCommand, requiresAdmin: false },
    "rules": { handler: rulesCommand, requiresAdmin: false },
    
    "админдер": { handler: adminsCommand, requiresAdmin: false },
    "admins": { handler: adminsCommand, requiresAdmin: false },
    
    "репорт": { handler: reportCommand, requiresAdmin: false },
    "report": { handler: reportCommand, requiresAdmin: false },
    "жалоо": { handler: reportCommand, requiresAdmin: false },
    
    "мен": { handler: meCommand, requiresAdmin: false },
    "профиль": { handler: meCommand, requiresAdmin: false },
    "профилим": { handler: meCommand, requiresAdmin: false },
    "me": { handler: meCommand, requiresAdmin: false },
    
    "ид": { handler: idCommand, requiresAdmin: false },
    "id": { handler: idCommand, requiresAdmin: false },
    
    "эскертүүлөр": { handler: warnsCommand, requiresAdmin: false },
    "страйктар": { handler: warnsCommand, requiresAdmin: false },
    "warns": { handler: warnsCommand, requiresAdmin: false },

    // Команды, требующие прав администратора
    "жабуу": { handler: muteallCommand, requiresAdmin: true },
    "muteall": { handler: muteallCommand, requiresAdmin: true },
    
    "ачуу": { handler: unmuteallCommand, requiresAdmin: true },
    "unmuteall": { handler: unmuteallCommand, requiresAdmin: true },
    
    "шилтеме": { handler: linkCommand, requiresAdmin: true },
    "link": { handler: linkCommand, requiresAdmin: true },
    
    "зомби": { handler: zombiesCommand, requiresAdmin: true },
    "zombies": { handler: zombiesCommand, requiresAdmin: true },
    
    "башкаруу": { handler: adminPanelCommand, requiresAdmin: true },
    "настройки": { handler: adminPanelCommand, requiresAdmin: true },
    "settings": { handler: adminPanelCommand, requiresAdmin: true },
  };

  const cleanPrefix = (str: string) => {
    if (str.startsWith("/") || str.startsWith(".") || str.startsWith("!")) {
      return str.substring(1);
    }
    return str;
  };

  const firstWordRaw = lowerText.split(/\s+/)[0];
  const cleanedWord = cleanPrefix(firstWordRaw);
  const matchedBuiltin = builtinCommandAliases[cleanedWord];

  if (matchedBuiltin) {
    const isSettings = matchedBuiltin.handler === adminPanelCommand;
    if (!isSettings && config.commandsEnabled !== true) {
      // Игнорируем
    } else if (!matchedBuiltin.requiresAdmin || isAdmin) {
      let cmdName = "";
      if (matchedBuiltin.handler === rulesCommand) cmdName = "rules";
      else if (matchedBuiltin.handler === adminsCommand) cmdName = "admins";
      else if (matchedBuiltin.handler === reportCommand) cmdName = "report";
      else if (matchedBuiltin.handler === meCommand) cmdName = "me";
      else if (matchedBuiltin.handler === idCommand) cmdName = "id";
      else if (matchedBuiltin.handler === warnsCommand) cmdName = "warns";
      else if (matchedBuiltin.handler === muteallCommand) cmdName = "muteall";
      else if (matchedBuiltin.handler === unmuteallCommand) cmdName = "unmuteall";
      else if (matchedBuiltin.handler === linkCommand) cmdName = "link";
      else if (matchedBuiltin.handler === zombiesCommand) cmdName = "zombies";
      else if (matchedBuiltin.handler === adminPanelCommand) cmdName = "settings";

      if (cmdName && config.disabledCommands && config.disabledCommands[cmdName] === true) {
        // Команда отключена, игнорируем
      } else {
        await matchedBuiltin.handler(ctx);
        return;
      }
    }
  }

  // 0. Текстовые команды администратора (сокращенные команды / алиасы из веб-панели и стандартные команды)
  if (isAdmin && config.commandsEnabled === true) {
    // 0.1 Проверка кастомных настроек команд из веб-панели
    const customCommands = config.customCommands || {};
    let matchedCmdKey: string | null = null;
    let matchedCmd: any = null;

    const cleanLowerText = cleanPrefix(lowerText);
    for (const [key, cmd] of Object.entries(customCommands)) {
      if (cmd && cmd.alias) {
        const aliases = cmd.alias.toLowerCase().split(",").map(a => a.trim());
        for (const alias of aliases) {
          const cleanAlias = cleanPrefix(alias);
          if (cleanAlias && (cleanLowerText === cleanAlias || cleanLowerText.startsWith(cleanAlias + " ") || cleanLowerText.startsWith(cleanAlias + "\n"))) {
            matchedCmdKey = key;
            matchedCmd = { ...cmd, aliasUsed: alias };
            break;
          }
        }
      }
      if (matchedCmdKey) break;
    }

    if (matchedCmdKey && matchedCmd) {
      if (config.disabledCommands && config.disabledCommands[matchedCmdKey] === true) {
        return;
      }
      const action = matchedCmd.action || "none";
      const customReply = matchedCmd.replyText || "";
      const autoDelete = matchedCmd.autoDelete || false;

      const { durationSeconds, reason: parsedReason } = parseDurationAndReason(text, matchedCmd.aliasUsed);
      
      const targetRequiredActions = ["ban", "mute", "kick", "warn", "unban", "unmute", "unwarn", "info", "promote", "demote", "del"];
      
      const targetUser = await resolveTargetUser(ctx, text, matchedCmd.aliasUsed);
      const targetUserId = targetUser?.id;
      const targetName = targetUser?.name || "Колдонуучу";

      if (targetRequiredActions.includes(action) && !targetUserId) {
        await ctx.reply("💡 Бул буйрукту кайсы бир билдирүүгө жооп (reply) катары жазыңыз же колдонуучунун ID/никнеймин көрсөтүңүз.");
        return;
      }

      if (targetUserId && ["ban", "mute", "kick", "warn", "demote"].includes(action)) {
        const isTargetAdmin = await isUserAdmin(ctx, targetUserId);
        if (isTargetAdmin) {
          await ctx.reply("❌ Администраторлорго карата чектөөлөрдү колдонууга болбойт.");
          return;
        }
      }

      // Если мы нашли targetUser по аргументу в тексте, уберем его имя/ID из причины
      let reason = parsedReason;
      const targetMsg = msg.reply_to_message;
      if (targetUser && !targetMsg) {
        const args = parsedReason.split(/\s+/);
        if (args.length > 0 && (args[0] === targetUser.id.toString() || args[0].toLowerCase().startsWith("@"))) {
          reason = args.slice(1).join(" ");
        }
      }
      reason = reason || "Башкаруучунун буйругу";

      const adminName = ctx.from?.first_name || "Админ";
      let replyMsgText = "";

      if (action === "ban" && targetUserId) {
        await banUser(ctx.api, chatId, targetUserId, durationSeconds);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Бан", reason, adminName);
        const durationText = durationSeconds > 0 ? ` ${Math.round(durationSeconds/60)} мүнөткө` : "";
        replyMsgText = customReply || `🚷 [${targetName}](tg://user?id=${targetUserId}) бөгөттөлдү${durationText}.\nСебеби: ${reason}\nБашкаруучу: ${adminName}`;
      } else if (action === "mute" && targetUserId) {
        const finalDuration = durationSeconds > 0 ? durationSeconds : (matchedCmd.muteDuration || config.muteDurationMinutes || 120) * 60;
        await muteUser(ctx.api, chatId, targetUserId, finalDuration);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Мут", `${reason} (${Math.round(finalDuration/60)} мүнөт)`, adminName);
        replyMsgText = customReply || `🔇 [${targetName}](tg://user?id=${targetUserId}) жазуу укугунан ажыратылды. Мүнөтү: ${Math.round(finalDuration/60)}.\nСебеби: ${reason}\nБашкаруучу: ${adminName}`;
      } else if (action === "kick" && targetUserId) {
        await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, targetName, "Кик", reason, adminName);
        replyMsgText = customReply || `👢 ${targetName} чаттан чыгарылды. Себеби: ${reason}\nБашкаруучу: ${adminName}`;
      } else if (action === "warn" && targetUserId) {
        const warnIncrement = matchedCmd.warnCount || 1;
        await handleWarn(ctx, targetUserId, chatId, targetName, reason, config.muteDurationMinutes, config.warnLimit, config.warnAction, adminName, warnIncrement);
        replyMsgText = customReply;
      } else if (action === "unban" && targetUserId) {
        await unbanUser(ctx.api, chatId, targetUserId);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Бөгөттөн чыгаруу", reason, adminName);
        replyMsgText = customReply || `✅ [${targetName}](tg://user?id=${targetUserId}) бөгөттөн чыгарылды.\nБашкаруучу: ${adminName}`;
      } else if (action === "unmute" && targetUserId) {
        await ctx.api.restrictChatMember(chatId, targetUserId, {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        await logAction(ctx.api, chatId, targetUserId, targetName, "Мутту алуу", reason, adminName);
        replyMsgText = customReply || `🔊 [${targetName}](tg://user?id=${targetUserId}) жазуу укугу кайтарылды.\nБашкаруучу: ${adminName}`;
      } else if (action === "del") {
        if (targetMsg) {
          await safeDeleteMessage(ctx, chatId, targetMsg.message_id);
        }
        await safeDeleteMessage(ctx, chatId, msg.message_id, true);
        if (targetUserId) {
          await logAction(ctx.api, chatId, targetUserId, targetName, "Өчүрүү", reason, ctx.from.first_name);
        }
        replyMsgText = customReply;
      } else if (action === "warns_top") {
        const userIds = await db.smembers(`chat:${chatId}:users`);
        const warnList: string[] = [];
        for (const uid of userIds) {
          const w = await db.get<number>(`chat:${chatId}:user:${uid}:warns`) || 0;
          if (w > 0) {
            const info = await db.hgetall(`chat:${chatId}:user:${uid}:info`);
            const name = info?.name || `Колдонуучу (ID: ${uid})`;
            warnList.push(`• [${name}](tg://user?id=${uid}): ${w}/${config.warnLimit || 3}`);
          }
        }
        const listText = warnList.length > 0 ? warnList.join("\n") : "Тайпада эскертүү алгандар жок. 🎉";
        replyMsgText = (customReply || `⚠️ **Тайпадагы эскертүүсү бар колдонуучулар:**\n{list}`).replace(/{list}/g, listText);
      } else if (action === "random_member") {
        const userIds = await db.smembers(`chat:${chatId}:users`);
        if (userIds && userIds.length > 0) {
          const randUid = userIds[Math.floor(Math.random() * userIds.length)];
          const info = await db.hgetall(`chat:${chatId}:user:${randUid}:info`);
          const name = info?.name || `Колдонуучу (ID: ${randUid})`;
          const mention = `[${name}](tg://user?id=${randUid})`;
          replyMsgText = (customReply || `🎉 Биз тандаган кокус катышуучу: {target}!`).replace(/{target}/g, mention);
        } else {
          replyMsgText = "Катышуучулар табылган жок.";
        }
      } else if (action === "ro_all") {
        const handler = commandHandlers["muteall"];
        if (handler) {
          await handler(ctx);
        }
        replyMsgText = customReply || "🔇 Тайпа окуу режимине гана өткөрүлдү. Жазууга тыюу салынат!";
      } else if (action === "unro_all") {
        const handler = commandHandlers["unmuteall"];
        if (handler) {
          await handler(ctx);
        }
        replyMsgText = customReply || "🔊 Тайпа ачылды. Катышуучулар кайрадан жаза алышат!";
      } else if (action === "lock_media") {
        const locks = { ...config.locks, photo: true, video: true, stickers: true, gifs: true, voices: true };
        await updateGroupConfig(chatId, { locks });
        replyMsgText = customReply || "🖼 Тайпада сүрөт, видео жана стикерлерди жөнөтүү убактылуу бөгөттөлдү!";
      } else if (action === "unlock_media") {
        const locks = { ...config.locks, photo: false, video: false, stickers: false, gifs: false, voices: false };
        await updateGroupConfig(chatId, { locks });
        replyMsgText = customReply || "🔓 Тайпада медиа жөнөтүүгө кайрадан уруксат берилди!";
      } else if (action === "get_admins") {
        try {
          const admins = await ctx.api.getChatAdministrators(chatId);
          const adminMentions = admins
            .map(a => `[${a.user.first_name}](tg://user?id=${a.user.id})`)
            .join(", ");
          replyMsgText = (customReply || `⚠️ **Урматтуу администраторлор, бул жерде тез арада жардам керек!**\n{admins}`).replace(/{admins}/g, adminMentions);
        } catch (e) {
          replyMsgText = "Админдерди чакырууда ката кетти.";
        }
      } else {
        // Вызываем соответствующий обработчик команды из бота
        const handler = commandHandlers[action];
        if (handler) {
          await handler(ctx);
        }
        replyMsgText = customReply;
      }

      if (replyMsgText) {
        replyMsgText = replyMsgText
          .replace(/{name}/g, targetName)
          .replace(/{target}/g, targetName)
          .replace(/{admin}/g, ctx.from.first_name)
          .replace(/{reason}/g, reason);

        const sentReply = await ctx.reply(replyMsgText, { parse_mode: "Markdown" }).catch(async () => {
          return await ctx.reply(replyMsgText).catch(() => null);
        });
        
        if (autoDelete) {
          setTimeout(async () => {
            await safeDeleteMessage(ctx, chatId, msg.message_id, true);
            if (sentReply) {
              await safeDeleteMessage(ctx, chatId, sentReply.message_id, true);
            }
          }, 5000);
        }
      }
      return;
    }

    // 0.2 Стандартные жестко заданные текстовые команды (обратная совместимость)
    const firstWordRawStats = lowerText.split(/\s+/)[0];
    const triggerUsed = cleanPrefix(firstWordRawStats);
    const isHardcodedCommand = ["бан", "ban", "мут", "mute", "кик", "kick", "разбан", "unban", "анмут", "unmute", "эскертүү", "warn", "өчүр", "del"].includes(triggerUsed);
    
    if (isHardcodedCommand) {
      const targetUser = await resolveTargetUser(ctx, text, firstWordRawStats);
      const targetUserId = targetUser?.id;
      const targetName = targetUser?.name || "Колдонуучу";
      const adminName = ctx.from?.first_name || "Админ";

      if (!targetUserId) {
        await ctx.reply("💡 Бул буйрукту кайсы бир билдирүүгө жооп (reply) катары жазыңыз же колдонуучунун ID/никнеймин көрсөтүңүз.");
        return;
      }

      const { durationSeconds, reason: parsedReason } = parseDurationAndReason(text, firstWordRawStats);
      
      let reason = parsedReason;
      const targetMsg = msg.reply_to_message;
      if (targetUser && !targetMsg) {
        const args = parsedReason.split(/\s+/);
        if (args.length > 0 && (args[0] === targetUser.id.toString() || args[0].toLowerCase().startsWith("@"))) {
          reason = args.slice(1).join(" ");
        }
      }

      if ((triggerUsed === "бан" || triggerUsed === "ban") && !(config.disabledCommands?.ban)) {
        const customReason = reason || "Администратордун буйругу";
        await banUser(ctx.api, chatId, targetUserId, durationSeconds);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Бан", customReason, adminName);
        const durationText = durationSeconds > 0 ? ` ${Math.round(durationSeconds/60)} мүнөткө` : "";
        const replyText = `🚫 [${targetName}](tg://user?id=${targetUserId}) бөгөттөлдү${durationText}.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`🚫 ${targetName} бөгөттөлдү${durationText}.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`);
        });
        return;
      } else if ((triggerUsed === "мут" || triggerUsed === "mute") && !(config.disabledCommands?.mute)) {
        const duration = durationSeconds > 0 ? durationSeconds : (config.muteDurationMinutes || 120) * 60;
        const customReason = reason || "Администратордун буйругу";
        await muteUser(ctx.api, chatId, targetUserId, duration);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Мут", `${customReason} ${Math.round(duration/60)} мүнөт`, adminName);
        const replyText = `🔇 [${targetName}](tg://user?id=${targetUserId}) жазуу укугунан ${Math.round(duration/60)} мүнөткө ажыратылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`🔇 ${targetName} жазуу укугунан ${Math.round(duration/60)} мүнөткө ажыратылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`);
        });
        return;
      } else if ((triggerUsed === "кик" || triggerUsed === "kick") && !(config.disabledCommands?.kick)) {
        const customReason = reason || "Администратордун буйругу";
        await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, targetName, "Кик", customReason, adminName);
        const replyText = `👢 [${targetName}](tg://user?id=${targetUserId}) тайпадан чыгарылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`👢 ${targetName} тайпадан чыгарылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`);
        });
        return;
      } else if ((triggerUsed === "разбан" || triggerUsed === "unban") && !(config.disabledCommands?.unban)) {
        const customReason = reason || "Администратордун буйругу";
        await unbanUser(ctx.api, chatId, targetUserId);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Бөгөттөн чыгаруу", customReason, adminName);
        const replyText = `✅ [${targetName}](tg://user?id=${targetUserId}) бөгөттөн чыгарылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`✅ ${targetName} бөгөттөн чыгарылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`);
        });
        return;
      } else if ((triggerUsed === "анмут" || triggerUsed === "unmute") && !(config.disabledCommands?.unmute)) {
        const customReason = reason || "Администратордун буйругу";
        await ctx.api.restrictChatMember(chatId, targetUserId, {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        await logAction(ctx.api, chatId, targetUserId, targetName, "Мутту алуу", customReason, adminName);
        const replyText = `🔊 [${targetName}](tg://user?id=${targetUserId}) жазуу укугу кайтарылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`;
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(`🔊 ${targetName} жазуу укугу кайтарылды.\nСебеби: ${customReason}\nБашкаруучу: ${adminName}`);
        });
        return;
      } else if ((triggerUsed === "эскертүү" || triggerUsed === "warn") && !(config.disabledCommands?.warn)) {
        const customReason = reason || "Администратордун эскертүүсү";
        await handleWarn(ctx, targetUserId, chatId, targetName, customReason, config.muteDurationMinutes, config.warnLimit, config.warnAction, adminName);
        return;
      } else if ((triggerUsed === "өчүр" || triggerUsed === "del") && !(config.disabledCommands?.del)) {
        const customReason = reason || "Администратордун буйругу";
        if (targetMsg) {
          await safeDeleteMessage(ctx, chatId, targetMsg.message_id);
        }
        await safeDeleteMessage(ctx, chatId, msg.message_id, true);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Өчүрүү", customReason, ctx.from.first_name);
        return;
      }
    }
  }

  if (isAdmin) return next();
  
  // --- Anti-Channel (Запрет писать от имени канала) ---
  if (config.antiChannel && msg?.sender_chat?.type === "channel") {
    if (!msg.is_automatic_forward) {
      const act = config.channelAction || "ban";
      await safeDeleteMessage(ctx, chatId, msg.message_id);
      if (act === "ban") {
        await ctx.api.banChatSenderChat(chatId, msg.sender_chat.id).catch(() => {});
      }
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
      await safeDeleteMessage(ctx, chatId, msg.message_id);
      const action = config.antiflood.action;
      if (action === "mute") {
        const floodMute = config.floodMuteDuration || 120;
        await muteUser(ctx.api, chatId, userId, floodMute * 60);
      }
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
  if (config.locks) {
    let lockViolated = false;
    let lockReason = "";

    if (config.locks.links && msgEntities.some(e => e.type === "url" || e.type === "text_link")) {
      const whitelist = config.linkWhitelist || [];
      const allWhitelisted = isLinkWhitelisted(text, msgEntities, whitelist);
      if (!allWhitelisted) {
        lockViolated = true; lockReason = "Шилтемелер (Links) бөгөттөлгөн.";
      }
    } else if (config.locks.forwards && msg.forward_origin) {
      lockViolated = true; lockReason = "Башка каналдан репост кылуу бөгөттөлгөн.";
    } else if (config.locks.media && (msg.photo || msg.video || msg.document)) {
      lockViolated = true; lockReason = "Медиа жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.photo && msg.photo) {
      lockViolated = true; lockReason = "Сүрөт жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.video && msg.video) {
      lockViolated = true; lockReason = "Видео жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.audio && msg.audio) {
      lockViolated = true; lockReason = "Аудио жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.document && msg.document) {
      lockViolated = true; lockReason = "Файл/Документ жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.stickers && msg.sticker) {
      lockViolated = true; lockReason = "Стикерлер бөгөттөлгөн.";
    } else if (config.locks.gifs && msg.animation) {
      lockViolated = true; lockReason = "GIF анимациялар бөгөттөлгөн.";
    } else if (config.locks.voices && msg.voice) {
      lockViolated = true; lockReason = "Үн билдирүүлөр бөгөттөлгөн.";
    } else if (config.locks.videonote && msg.video_note) {
      lockViolated = true; lockReason = "Кружоктор бөгөттөлгөн.";
    } else if (config.locks.games && msg.game) {
      lockViolated = true; lockReason = "Оюндар бөгөттөлгөн.";
    } else if (config.locks.commands && text?.startsWith("/")) {
      lockViolated = true; lockReason = "Буйруктар бөгөттөлгөн.";
    } else if (config.locks.text && text && !msg.photo && !msg.video && !msg.document && !msg.voice && !msg.video_note && !msg.animation) {
      lockViolated = true; lockReason = "Жөнөкөй текст жазуу бөгөттөлгөн.";
    } else if (config.locks.arabic && text && /[\u0600-\u06FF]/.test(text)) {
      lockViolated = true; lockReason = "Араб ариби бөгөттөлгөн.";
    }

    if (lockViolated) {
      const act = config.locksAction || "delete";
      await executeViolation(act, lockReason);
      return;
    }
  }

  // 2.5 Media & Link Rate Limiter
  if (config.mediaRateLimitEnabled) {
    const hasMedia = msg?.photo || msg?.video || msg?.document || 
                      msg?.audio || msg?.voice || msg?.video_note || 
                      msg?.sticker || msg?.animation;
    const hasLink = msgEntities.some(e => e.type === "url" || e.type === "text_link");

    if (hasMedia || hasLink) {
      try {
        const rateLimitCount = config.mediaRateLimitCount || 5;
        const rateLimitPeriod = config.mediaRateLimitPeriod || 60;
        const rateLimitAction = config.mediaRateLimitAction || "delete";
        
        const rateLimitKey = `chat:${chatId}:user:${userId}:mediaCount`;
        const currentCount = await db.get<number>(rateLimitKey) || 0;
        
        if (currentCount >= rateLimitCount) {
          await safeDeleteMessage(ctx, chatId, msg.message_id);
          const limitReason = `Медиа жана шилтеме лимити ашты (чек: ${rateLimitCount} билдирүү / ${rateLimitPeriod}с)`;
          
          if (rateLimitAction === "delete") {
            await logAction(ctx.api, chatId, userId, name, "Өчүрүү", limitReason, "Система");
          } else if (rateLimitAction === "mute") {
            await muteUser(ctx.api, chatId, userId, 2 * 60 * 60);
            await logAction(ctx.api, chatId, userId, name, "Мут", `${limitReason}, мөөнөтү: 120 мүнөт`, "Система");
            await ctx.reply(`🔇 [${name}](tg://user?id=${userId}) ${limitReason} үчүн 2 саатка жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" });
          } else if (rateLimitAction === "warn") {
            await handleWarn(ctx, userId, chatId, name, limitReason, config.muteDurationMinutes, config.warnLimit, config.warnAction, "Система", 1);
          } else if (rateLimitAction === "kick") {
            await ctx.api.banChatMember(chatId, userId).catch(() => {});
            await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
            await logAction(ctx.api, chatId, userId, name, "Кик", limitReason, "Система");
            await ctx.reply(`👢 [${name}](tg://user?id=${userId}) тайпадан чыгарылды. Себеби: ${limitReason}`, { parse_mode: "Markdown" });
          } else if (rateLimitAction === "ban") {
            await banUser(ctx.api, chatId, userId);
            await logAction(ctx.api, chatId, userId, name, "Бан", limitReason, "Система");
            await ctx.reply(`🚷 [${name}](tg://user?id=${userId}) бөгөттөлдү. Себеби: ${limitReason}`, { parse_mode: "Markdown" });
          }
          return;
        } else {
          const newCount = await db.incr(rateLimitKey);
          if (newCount === 1) {
            await db.expire(rateLimitKey, rateLimitPeriod);
          }
        }
      } catch (e) {
        logger.error("Error checking media rate limit:", e);
      }
    }
  }

  // 3. Blacklist
  if (text) {
    try {
      const blacklist = await db.hgetall(`chat:${chatId}:blacklist`);
      if (blacklist) {
        for (const word of Object.keys(blacklist)) {
          if (lowerText.includes(word)) {
            await safeDeleteMessage(ctx, chatId, msg.message_id);
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
              await logAction(ctx.api, chatId, userId, name, "Өчүрүү", customReason, "Система");
            } else if (action === "mute") {
              await muteUser(ctx.api, chatId, userId, duration);
              await logAction(ctx.api, chatId, userId, name, "Мут", `${customReason}, мөөнөтү: ${Math.round(duration/60)} мүнөт`, "Система");
              await ctx.reply(`🔇 [${name}](tg://user?id=${userId}) ${customReason} үчүн жазуу укугунан ажыратылды. Мөөнөтү: ${Math.round(duration/60)} мүнөт.`, { parse_mode: "Markdown" });
            } else if (action === "kick") {
              await ctx.api.banChatMember(chatId, userId).catch(() => {});
              await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
              await logAction(ctx.api, chatId, userId, name, "Кик", customReason, "Система");
              await ctx.reply(`👢 [${name}](tg://user?id=${userId}) ${customReason} үчүн чыгарылды.`, { parse_mode: "Markdown" });
            } else if (action === "ban") {
              await banUser(ctx.api, chatId, userId);
              await logAction(ctx.api, chatId, userId, name, "Бан", customReason, "Система");
              await ctx.reply(`🚫 [${name}](tg://user?id=${userId}) ${customReason} үчүн биротоло бөгөттөлдү.`, { parse_mode: "Markdown" });
            } else {
              await handleWarn(ctx, userId, chatId, name, customReason, config.muteDurationMinutes, config.warnLimit, config.warnAction, "Система", warnCount);
            }
            return; // stop further checks
          }
        }
      }
    } catch(e) {}
  }

  // 4. Anti-Arabic Name
  if (config.antiArabicName) {
    const fullName = `${ctx.from.first_name} ${ctx.from.last_name || ""}`;
    if (ARABIC_HIEROGLYPH_REGEX.test(fullName)) {
      try {
        const act = config.arabicAction || "ban";
        await executeViolation(act, "Атында араб/иероглиф тамгалары бар");
        return;
      } catch (e) {}
    }
  }

  // 5. Night Mode (Түнкү дозор)
  if (config.nightModeEnabled) {
    const utcHour = new Date().getUTCHours();
    const bishkekHour = (utcHour + 6) % 24;
    const hasMediaOrLink = msg.photo || msg.video || msg.document || msgEntities.some(e => e.type === "url" || e.type === "text_link" || e.type === "mention");
    
    const start = config.nightModeStart;
    const end = config.nightModeEnd;
    
    let isNight = false;
    if (start < end) {
      isNight = bishkekHour >= start && bishkekHour < end;
    } else {
      isNight = bishkekHour >= start || bishkekHour < end;
    }

    if (isNight && hasMediaOrLink) {
      const act = config.nightModeAction || "delete";
      await executeViolation(act, "Түнкү дозор: Шилтеме/Медиа жөнөтүүгө болбойт.");
      return;
    }
  }

  // 6. Quarantine (Карантин)
  if (config.quarantineEnabled) {
    const hasLinkOrForward = msg.forward_origin || msgEntities.some(e => e.type === "url" || e.type === "text_link");
    if (hasLinkOrForward) {
      const joinDate = await db.get<number>(`chat:${chatId}:user:${userId}:joinDate`);
      if (joinDate) {
        const hoursSinceJoin = (Date.now() - joinDate) / (1000 * 60 * 60);
        if (hoursSinceJoin < 24) {
          await executeViolation("delete", "Карантин: 24 саат ичинде шилтеме жөнөтүүгө болбойт.");
          return;
        }
      }
    }
  }

  // 7. Swear Filter (Анти-Сөгүнүү)
  if (config.antiSwearEnabled && text) {
    try {
      const swearList = await db.smembers(`chat:${chatId}:swearwords`);
      if (swearList && swearList.length > 0) {
        for (const sw of swearList) {
          if (lowerText.includes(sw.toLowerCase())) {
            const act = config.swearAction || "warn";
            await executeViolation(act, `Сөгүнүү же адепсиз сөз: ${sw}`);
            return;
          }
        }
      }
    } catch (e) {}
  }

  // Сбрасываем таймер активности группы при сообщении от реального пользователя
  if (ctx.from && !ctx.from.is_bot && (!text || !text.startsWith("/"))) {
    await db.set(`chat:${chatId}:lastMessageTime`, Date.now()).catch(() => {});
  }

  // Проверка ответа на активный вопрос/макал
  if (text && ctx.from && !ctx.from.is_bot) {
    try {
      const activeQuestionRaw = await db.get<string>(`chat:${chatId}:active_question`);
      if (activeQuestionRaw) {
        const activeQuestion = typeof activeQuestionRaw === "string" ? JSON.parse(activeQuestionRaw) : activeQuestionRaw;
        if (activeQuestion && activeQuestion.answer) {
          const cleanUserMsg = text.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ");
          const cleanAnswer = activeQuestion.answer.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ");
          const isMatch = cleanUserMsg.includes(cleanAnswer) || 
            (cleanUserMsg.length >= Math.max(3, Math.round(cleanAnswer.length * 0.7)) && cleanAnswer.includes(cleanUserMsg));
          if (isMatch) {
            const reward = config.activityGeneratorKarmaReward || 1;
            const karmaKey = `chat:${chatId}:user:${userId}:urmat`;
            const currentKarma = await db.get<number>(karmaKey) || 0;
            const newKarma = currentKarma + reward;
            
            await db.set(karmaKey, newKarma);
            await db.zadd(`chat:${chatId}:urmat_leaderboard`, newKarma, String(userId));
            await db.del(`chat:${chatId}:active_question`);
            
            await ctx.reply(`🎉 **Туура жооп!**\n\nСиз макалдын уландысын таптыңыз: *"${activeQuestion.answer}"*\n\nСизге \`+${reward}\` Сый-Урмат (карма) упайы берилди!`, {
              parse_mode: "Markdown"
            }).catch(() => {});
          }
        }
      }
    } catch (eqErr) {
      logger.error("Error checking active question answer:", eqErr);
    }
  }

  // Автоматическая выдача кармы (репутации) при ответах
  if (config.karmaEnabled && msg.reply_to_message && msg.reply_to_message.from && !msg.reply_to_message.from.is_bot && text && ctx.from && !ctx.from.is_bot) {
    const targetUser = msg.reply_to_message.from;
    if (targetUser.id !== userId) {
      const karmaTriggers = ["+", "+1", "рахмат", "спасибо", "лайк", "like", "👍", "ыраазычылык", "рахмаат"];
      const trimmedText = text.trim().toLowerCase();
      
      const isTrigger = karmaTriggers.some(trigger => {
        if (trigger === "+") return trimmedText === "+" || trimmedText.startsWith("+ ");
        return trimmedText.startsWith(trigger);
      });

      if (isTrigger) {
        try {
          const karmaKey = `chat:${chatId}:user:${targetUser.id}:urmat`;
          const currentKarma = await db.get<number>(karmaKey) || 0;
          const newKarma = currentKarma + 1;
          await db.set(karmaKey, newKarma);
          await db.zadd(`chat:${chatId}:urmat_leaderboard`, newKarma, String(targetUser.id));

          const targetName = targetUser.first_name || "Колдонуучу";
          await ctx.reply(`😊 [${ctx.from.first_name}](tg://user?id=${userId}) колдонуучу [${targetName}](tg://user?id=${targetUser.id}) сый-урмат (карма) упайын көбөйттү!\n\n**Сый-Урмат:** \`${newKarma}\` (жаңы упай)`, {
            parse_mode: "Markdown"
          }).catch(() => {});
        } catch (e) {
          logger.error("Error setting karma automatically on reply:", e);
        }
      }
    }
  }

  await next();
}
