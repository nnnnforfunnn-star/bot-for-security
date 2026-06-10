import { Context, NextFunction, InlineKeyboard } from "grammy";
import { logger } from "../utils/logger.js";
import { isUserAdmin, muteUser, banUser, unbanUser, formatMessageToHtml, parseDurationAndReason } from "../utils/telegram.js";
import { getGroupConfig } from "../utils/configManager.js";
import { db } from "../utils/db.js";
import { logAction } from "../utils/actionLogger.js";

// Импорт обработчиков команд для поддержки кастомных алиасов (коротких команд)
import { zombiesCommand, muteallCommand, unmuteallCommand, pinCommand, unpinCommand, kickmeCommand, idCommand, warnsCommand, unwarnCommand } from "./modCommands.js";
import { rulesCommand, meCommand, purgeCommand, reportCommand } from "./adminCommands.js";
import { linkCommand, adminsCommand, infoCommand, slowmodeCommand, promoteCommand, demoteCommand } from "./groupCommands.js";
import { topUrmatCommand, bataCommand } from "./funHandler.js";
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
  top: topUrmatCommand,
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
};

// Регулярное выражение для поиска арабской вязи и иероглифов
const ARABIC_HIEROGLYPH_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF]/;

// Слова-триггеры для системы Кармы (Сый-Урмат)
const KARMA_WORDS = ["рахмат", "рхм", "ыраазымын", "чоң рахмат", "спс", "спасибо"];

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
 * Обработчик выдачи предупреждений (Страйков).
 */
async function handleWarn(ctx: Context, userId: number, chatId: number, name: string, reason: string, muteMinutes: number, warnLimit: number, warnAction: "mute" | "ban" | "kick" = "mute", adminName: string = "Система (Бот)", warnIncrement: number = 1) {
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
    await ctx.reply(`⚠️ **${warns}-эскертүү!** Урматтуу [${name}](tg://user?id=${userId}), тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason}`, { parse_mode: "Markdown" });
  } else if (warns >= warnLimit) {
    if (warnAction === "ban") {
      await banUser(ctx.api, chatId, userId);
      await logAction(ctx.api, chatId, userId, name, "Бан", "Эскертүүлөрдүн чеги толду", adminName);
      await ctx.reply(`🚫 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан биротоло бөгөттөлдү. Кош болуңуз!`, { parse_mode: "Markdown" });
    } else if (warnAction === "kick") {
      await ctx.api.banChatMember(chatId, userId).catch(() => {});
      await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
      await logAction(ctx.api, chatId, userId, name, "Кик", "Эскертүүлөрдүн чегине жетти", adminName);
      await ctx.reply(`👢 **Лимит толду!** [${name}](tg://user?id=${userId}) тайпадан чыгарылды.`, { parse_mode: "Markdown" });
    } else {
      await muteUser(ctx.api, chatId, userId, muteMinutes * 60);
      await logAction(ctx.api, chatId, userId, name, "Мут", `Эскертүүлөрдүн чегине жетти, мөөнөтү: ${muteMinutes} мүнөт`, adminName);
      await ctx.reply(`🔇 **Лимит толду!** [${name}](tg://user?id=${userId}) ${muteMinutes} мүнөткө жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" });
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
  const targetMsg = ctx.message?.reply_to_message;
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
}

export async function messageHandler(ctx: Context, next: NextFunction): Promise<void> {
  if (!ctx.message || !ctx.chat || ctx.chat.type === "private") {
    return next();
  }

  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;
  const name = ctx.from?.first_name || "Колдонуучу";
  
  if (!userId) return next();

  const config = await getGroupConfig(chatId);
  const isAdmin = await isUserAdmin(ctx);

  const executeViolation = async (action: string, reason: string) => {
    try {
      await ctx.deleteMessage().catch(() => {});
      if (action === "warn") {
        await handleWarn(ctx, userId, chatId, name, reason, config.muteDurationMinutes, config.warnLimit, config.warnAction);
      } else if (action === "mute") {
        const dur = config.muteDurationMinutes || 120;
        await muteUser(ctx.api, chatId, userId, dur * 60);
        await logAction(ctx.api, chatId, userId, name, "Мут", `${reason}, мөөнөтү: ${dur} мүнөт`, "Система");
        await ctx.reply(`🔇 [${name}](tg://user?id=${userId}) ${reason} үчүн жазуу укугунан ажыратылды. Мөөнөтү: ${dur} мүнөт.`, { parse_mode: "Markdown" });
      } else if (action === "kick") {
        await ctx.api.banChatMember(chatId, userId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
        await logAction(ctx.api, chatId, userId, name, "Кик", reason, "Система");
        await ctx.reply(`👢 [${name}](tg://user?id=${userId}) ${reason} үчүн чыгарылды.`, { parse_mode: "Markdown" });
      } else if (action === "ban") {
        await banUser(ctx.api, chatId, userId);
        await logAction(ctx.api, chatId, userId, name, "Бан", reason, "Система");
        await ctx.reply(`🚫 [${name}](tg://user?id=${userId}) ${reason} үчүн бөгөттөлдү.`, { parse_mode: "Markdown" });
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
  const today = new Date().toISOString().split("T")[0];
  await db.incr(`chat:${chatId}:stats:messages_count`);
  await db.incr(`chat:${chatId}:stats:messages_by_date:${today}`);
  await db.sadd(`chat:${chatId}:users`, userId);
  await db.hset(`chat:${chatId}:user:${userId}:info`, "name", name);
  if (ctx.from.username) await db.hset(`chat:${chatId}:user:${userId}:info`, "username", ctx.from.username);
  await db.zincrby(`chat:${chatId}:stats:top_users`, 1, userId);
  await db.zincrby(`chat:${chatId}:stats:top_users:${today}`, 1, userId);

  const text = ctx.message.text || ctx.message.caption || "";
  const lowerText = text.toLowerCase().trim();

  // 0. Автожооптор (Filters) - Текшерүү баарына тиешелүү, эгер өчүрүлбөсө
  if (text && config.disableFilters !== true && (config.disableFilters as any) !== "true") {
    try {
      const filters = await db.hgetall(`chat:${chatId}:filters`);
      if (filters) {
        for (const trigger of Object.keys(filters)) {
          if (lowerText.includes(trigger.toLowerCase())) {
            let replyContent = filters[trigger];
            let replyText = replyContent;
            let keyboard: InlineKeyboard | undefined = undefined;

            let photoUrl: string | undefined = undefined;
            try {
              if (replyContent.startsWith("{") && replyContent.endsWith("}")) {
                const parsed = JSON.parse(replyContent);
                replyText = parsed.text || "";
                photoUrl = parsed.photo;
                
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
                // Fallback
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
    
    "топ": { handler: topUrmatCommand, requiresAdmin: false },
    "top": { handler: topUrmatCommand, requiresAdmin: false },
    
    "бата": { handler: bataCommand, requiresAdmin: false },
    "bata": { handler: bataCommand, requiresAdmin: false },
    
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
    if (!matchedBuiltin.requiresAdmin || isAdmin) {
      let cmdName = "";
      if (matchedBuiltin.handler === rulesCommand) cmdName = "rules";
      else if (matchedBuiltin.handler === adminsCommand) cmdName = "admins";
      else if (matchedBuiltin.handler === reportCommand) cmdName = "report";
      else if (matchedBuiltin.handler === topUrmatCommand) cmdName = "top";
      else if (matchedBuiltin.handler === bataCommand) cmdName = "bata";
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
  if (isAdmin) {
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
      const targetMsg = ctx.message.reply_to_message;
      if (targetUser && !targetMsg) {
        const args = parsedReason.split(/\s+/);
        if (args.length > 0 && (args[0] === targetUser.id.toString() || args[0].toLowerCase().startsWith("@"))) {
          reason = args.slice(1).join(" ");
        }
      }
      reason = reason || "Башкаруучунун буйругу";

      let replyMsgText = "";

      if (action === "ban" && targetUserId) {
        await banUser(ctx.api, chatId, targetUserId, durationSeconds);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Бан", reason, ctx.from.first_name);
        const durationText = durationSeconds > 0 ? ` ${Math.round(durationSeconds/60)} мүнөткө` : "";
        replyMsgText = customReply || `🚷 [${targetName}](tg://user?id=${targetUserId}) бөгөттөлдү${durationText}.\nСебеби: ${reason}`;
      } else if (action === "mute" && targetUserId) {
        const finalDuration = durationSeconds > 0 ? durationSeconds : (matchedCmd.muteDuration || config.muteDurationMinutes || 120) * 60;
        await muteUser(ctx.api, chatId, targetUserId, finalDuration);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Мут", `${reason} (${Math.round(finalDuration/60)} мүнөт)`, ctx.from.first_name);
        replyMsgText = customReply || `🔇 [${targetName}](tg://user?id=${targetUserId}) жазуу укугунан ажыратылды. Мүнөтү: ${Math.round(finalDuration/60)}.\nСебеби: ${reason}`;
      } else if (action === "kick" && targetUserId) {
        await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, targetName, "Кик", reason, ctx.from.first_name);
        replyMsgText = customReply || `👢 ${targetName} чаттан чыгарылды. Себеби: ${reason}`;
      } else if (action === "warn" && targetUserId) {
        const warnIncrement = matchedCmd.warnCount || 1;
        await handleWarn(ctx, targetUserId, chatId, targetName, reason, config.muteDurationMinutes, config.warnLimit, config.warnAction, ctx.from.first_name, warnIncrement);
        replyMsgText = customReply;
      } else if (action === "unban" && targetUserId) {
        await unbanUser(ctx.api, chatId, targetUserId);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Разбан", reason, ctx.from.first_name);
        replyMsgText = customReply || `✅ [${targetName}](tg://user?id=${targetUserId}) бөгөттөн чыгарылды.`;
      } else if (action === "unmute" && targetUserId) {
        await ctx.api.restrictChatMember(chatId, targetUserId, {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        await logAction(ctx.api, chatId, targetUserId, targetName, "Анмут", reason, ctx.from.first_name);
        replyMsgText = customReply || `🔊 [${targetName}](tg://user?id=${targetUserId}) жазуу укугу кайтарылды.`;
      } else if (action === "del") {
        if (targetMsg) {
          await ctx.api.deleteMessage(chatId, targetMsg.message_id).catch(() => {});
        }
        await ctx.deleteMessage().catch(() => {});
        if (targetUserId) {
          await logAction(ctx.api, chatId, targetUserId, targetName, "Удаление", reason, ctx.from.first_name);
        }
        replyMsgText = customReply;
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
    const firstWordRawStats = lowerText.split(/\s+/)[0];
    const triggerUsed = cleanPrefix(firstWordRawStats);
    const isHardcodedCommand = ["бан", "ban", "мут", "mute", "кик", "kick", "разбан", "unban", "анмут", "unmute", "эскертүү", "warn", "өчүр", "del"].includes(triggerUsed);
    
    if (isHardcodedCommand) {
      const targetUser = await resolveTargetUser(ctx, text, firstWordRawStats);
      const targetUserId = targetUser?.id;
      const targetName = targetUser?.name || "Колдонуучу";

      if (!targetUserId) {
        await ctx.reply("💡 Бул буйрукту кайсы бир билдирүүгө жооп (reply) катары жазыңыз же колдонуучунун ID/никнеймин көрсөтүңүз.");
        return;
      }

      const { durationSeconds, reason: parsedReason } = parseDurationAndReason(text, firstWordRawStats);
      
      let reason = parsedReason;
      const targetMsg = ctx.message.reply_to_message;
      if (targetUser && !targetMsg) {
        const args = parsedReason.split(/\s+/);
        if (args.length > 0 && (args[0] === targetUser.id.toString() || args[0].toLowerCase().startsWith("@"))) {
          reason = args.slice(1).join(" ");
        }
      }

      if ((triggerUsed === "бан" || triggerUsed === "ban") && !(config.disabledCommands?.ban)) {
        const customReason = reason || "Администратордун буйругу";
        await banUser(ctx.api, chatId, targetUserId, durationSeconds);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Бан", customReason, ctx.from.first_name);
        const durationText = durationSeconds > 0 ? ` (${Math.round(durationSeconds/60)} мүнөткө)` : "";
        await ctx.reply(`🚫 [${targetName}](tg://user?id=${targetUserId}) бөгөттөлдү${durationText}.\nСебеби: ${customReason}`, { parse_mode: "Markdown" });
        return;
      } else if ((triggerUsed === "мут" || triggerUsed === "mute") && !(config.disabledCommands?.mute)) {
        const duration = durationSeconds > 0 ? durationSeconds : (config.muteDurationMinutes || 120) * 60;
        const customReason = reason || "Администратордун буйругу";
        await muteUser(ctx.api, chatId, targetUserId, duration);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Мут", `${customReason} (${Math.round(duration/60)} мүнөт)`, ctx.from.first_name);
        await ctx.reply(`🔇 [${targetName}](tg://user?id=${targetUserId}) жазуу укугунан ${Math.round(duration/60)} мүнөткө ажыратылды.\nСебеби: ${customReason}`, { parse_mode: "Markdown" });
        return;
      } else if ((triggerUsed === "кик" || triggerUsed === "kick") && !(config.disabledCommands?.kick)) {
        const customReason = reason || "Администратордун буйругу";
        await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, targetName, "Кик", customReason, ctx.from.first_name);
        await ctx.reply(`👢 [${targetName}](tg://user?id=${targetUserId}) тайпадан чыгарылды.\nСебеби: ${customReason}`, { parse_mode: "Markdown" });
        return;
      } else if ((triggerUsed === "разбан" || triggerUsed === "unban") && !(config.disabledCommands?.unban)) {
        const customReason = reason || "Администратордун буйругу";
        await unbanUser(ctx.api, chatId, targetUserId);
        await logAction(ctx.api, chatId, targetUserId, targetName, "Разбан", customReason, ctx.from.first_name);
        await ctx.reply(`✅ [${targetName}](tg://user?id=${targetUserId}) бөгөттөн чыгарылды.\nСебеби: ${customReason}`, { parse_mode: "Markdown" });
        return;
      } else if ((triggerUsed === "анмут" || triggerUsed === "unmute") && !(config.disabledCommands?.unmute)) {
        const customReason = reason || "Администратордун буйругу";
        await ctx.api.restrictChatMember(chatId, targetUserId, {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        await logAction(ctx.api, chatId, targetUserId, targetName, "Анмут", customReason, ctx.from.first_name);
        await ctx.reply(`🔊 [${targetName}](tg://user?id=${targetUserId}) жазуу укугу кайтарылды.\nСебеби: ${customReason}`, { parse_mode: "Markdown" });
        return;
      } else if ((triggerUsed === "эскертүү" || triggerUsed === "warn") && !(config.disabledCommands?.warn)) {
        const customReason = reason || "Администратордун эскертүүсү";
        await handleWarn(ctx, targetUserId, chatId, targetName, customReason, config.muteDurationMinutes, config.warnLimit, config.warnAction, ctx.from.first_name);
        return;
      } else if ((triggerUsed === "өчүр" || triggerUsed === "del") && !(config.disabledCommands?.del)) {
        const customReason = reason || "Администратордун буйругу";
        if (targetMsg) {
          await ctx.api.deleteMessage(chatId, targetMsg.message_id).catch(() => {});
        }
        await ctx.deleteMessage().catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, targetName, "Удаление", customReason, ctx.from.first_name);
        return;
      }
    }
  }

  if (isAdmin) return next();
  
  // --- Anti-Channel (Запрет писать от имени канала) ---
  if (config.antiChannel && ctx.message?.sender_chat?.type === "channel") {
    if (!ctx.message.is_automatic_forward) {
      const act = config.channelAction || "ban";
      await ctx.deleteMessage().catch(() => {});
      if (act === "ban") {
        await ctx.api.banChatSenderChat(chatId, ctx.message.sender_chat.id).catch(() => {});
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
      await ctx.deleteMessage().catch(() => {});
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

    if (config.locks.links && ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link")) {
      const whitelist = config.linkWhitelist || [];
      const allWhitelisted = isLinkWhitelisted(text, ctx.message.entities, whitelist);
      if (!allWhitelisted) {
        lockViolated = true; lockReason = "Шилтемелер (Links) бөгөттөлгөн.";
      }
    } else if (config.locks.forwards && ctx.message.forward_origin) {
      lockViolated = true; lockReason = "Башка каналдан репост кылуу бөгөттөлгөн.";
    } else if (config.locks.media && (ctx.message.photo || ctx.message.video || ctx.message.document)) {
      lockViolated = true; lockReason = "Медиа жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.photo && ctx.message.photo) {
      lockViolated = true; lockReason = "Сүрөт жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.video && ctx.message.video) {
      lockViolated = true; lockReason = "Видео жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.audio && ctx.message.audio) {
      lockViolated = true; lockReason = "Аудио жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.document && ctx.message.document) {
      lockViolated = true; lockReason = "Файл/Документ жөнөтүү бөгөттөлгөн.";
    } else if (config.locks.stickers && ctx.message.sticker) {
      lockViolated = true; lockReason = "Стикерлер бөгөттөлгөн.";
    } else if (config.locks.gifs && ctx.message.animation) {
      lockViolated = true; lockReason = "GIF анимациялар бөгөттөлгөн.";
    } else if (config.locks.voices && ctx.message.voice) {
      lockViolated = true; lockReason = "Үн билдирүүлөр бөгөттөлгөн.";
    } else if (config.locks.videonote && ctx.message.video_note) {
      lockViolated = true; lockReason = "Кружоктор бөгөттөлгөн.";
    } else if (config.locks.games && ctx.message.game) {
      lockViolated = true; lockReason = "Оюндар бөгөттөлгөн.";
    } else if (config.locks.commands && text?.startsWith("/")) {
      lockViolated = true; lockReason = "Буйруктар бөгөттөлгөн.";
    } else if (config.locks.text && text && !ctx.message.photo && !ctx.message.video && !ctx.message.document && !ctx.message.voice && !ctx.message.video_note && !ctx.message.animation) {
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
    const hasMedia = ctx.message?.photo || ctx.message?.video || ctx.message?.document || 
                      ctx.message?.audio || ctx.message?.voice || ctx.message?.video_note || 
                      ctx.message?.sticker || ctx.message?.animation;
    const hasLink = ctx.message?.entities?.some(e => e.type === "url" || e.type === "text_link");

    if (hasMedia || hasLink) {
      try {
        const rateLimitCount = config.mediaRateLimitCount || 5;
        const rateLimitPeriod = config.mediaRateLimitPeriod || 60;
        const rateLimitAction = config.mediaRateLimitAction || "delete";
        
        const rateLimitKey = `chat:${chatId}:user:${userId}:mediaCount`;
        const currentCount = await db.get<number>(rateLimitKey) || 0;
        
        if (currentCount >= rateLimitCount) {
          await ctx.deleteMessage().catch(() => {});
          const limitReason = `Медиа жана шилтеме лимити ашты (${rateLimitCount} билдирүү / ${rateLimitPeriod}с)`;
          
          if (rateLimitAction === "delete") {
            await logAction(ctx.api, chatId, userId, name, "Удаление", limitReason, "Система (Бот)");
          } else if (rateLimitAction === "mute") {
            await muteUser(ctx.api, chatId, userId, 2 * 60 * 60);
            await logAction(ctx.api, chatId, userId, name, "Мут", `${limitReason} (120 мүнөт)`, "Система (Бот)");
            await ctx.reply(`🔇 [${name}](tg://user?id=${userId}) ${limitReason} үчүн 2 саатка жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" });
          } else if (rateLimitAction === "warn") {
            await handleWarn(ctx, userId, chatId, name, limitReason, config.muteDurationMinutes, config.warnLimit, config.warnAction, "Система (Бот)", 1);
          } else if (rateLimitAction === "kick") {
            await ctx.api.banChatMember(chatId, userId).catch(() => {});
            await ctx.api.unbanChatMember(chatId, userId).catch(() => {});
            await logAction(ctx.api, chatId, userId, name, "Кик", limitReason, "Система (Бот)");
            await ctx.reply(`👢 [${name}](tg://user?id=${userId}) тайпадан чыгарылды. Себеби: ${limitReason}`, { parse_mode: "Markdown" });
          } else if (rateLimitAction === "ban") {
            await banUser(ctx.api, chatId, userId);
            await logAction(ctx.api, chatId, userId, name, "Бан", limitReason, "Система (Бот)");
            await ctx.reply(`🚷 [${name}](tg://user?id=${userId}) бөгөттөлдү. Себеби: ${limitReason}`, { parse_mode: "Markdown" });
          }
          return;
        } else {
          await db.set(rateLimitKey, currentCount + 1, rateLimitPeriod);
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
      const act = config.nightModeAction || "delete";
      await executeViolation(act, "Түнкү дозор: Шилтеме/Медиа жөнөтүүгө болбойт.");
      return;
    }
  }

  // 6. Quarantine (Карантин)
  if (config.quarantineEnabled) {
    const hasLinkOrForward = ctx.message.forward_origin || ctx.message.entities?.some(e => e.type === "url" || e.type === "text_link");
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
  await next();
}
