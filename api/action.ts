import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserSeniorAdminInChat, isUserAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";
import { banUser, muteUser } from "../src/utils/telegram.js";
import { logAction } from "../src/utils/actionLogger.js";
import { db } from "../src/utils/db.js";
import { logAuditAction } from "../src/utils/audit.js";

let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("tma ")) {
      return res.status(401).json({ error: "Unauthorized: Missing Telegram Web App initData" });
    }

    const initData = authHeader.split(" ")[1];
    
    if (!validateWebAppData(initData)) {
      return res.status(401).json({ error: "Unauthorized: Invalid Telegram Web App data" });
    }

    const user = getUserFromInitData(initData);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized: Cannot parse user" });
    }

    const chatId = parseInt(req.query.chatId as string, 10);
    if (isNaN(chatId)) {
      return res.status(400).json({ error: "Bad Request: Missing or invalid chatId" });
    }

    if (!isBotInitialized) {
      await bot.init();
      isBotInitialized = true;
    }

    const creatorId = process.env.CREATOR_ID;
    const isCreator = creatorId ? user.id.toString() === creatorId : false;

    let isAllowed = false;
    if (isCreator) {
      try {
        const chatMember = await bot.api.getChatMember(chatId, user.id);
        if (chatMember && chatMember.status !== "left" && chatMember.status !== "kicked") {
          isAllowed = true;
        }
      } catch (e) {}
    }

    if (!isAllowed) {
      const isAdmin = await isUserSeniorAdminInChat(bot.api, chatId, user.id);
      if (!isAdmin) {
        return res.status(403).json({ error: "Forbidden: You are not a Senior Administrator in this chat" });
      }
    }

    const { action, targetUserId, reason } = req.body;

    const requiresTarget = ["ban", "mute", "unmute", "kick", "unban", "promote", "demote", "resetwarns", "warn", "setkarma", "setusertitle", "grant_web_access", "revoke_web_access"];
    if (!action || (requiresTarget.includes(action) && !targetUserId)) {
      return res.status(400).json({ error: "Bad Request: missing action or targetUserId" });
    }

    // Защита: нельзя применять административные ограничения к другим администраторам чата
    if (targetUserId && ["ban", "mute", "kick", "warn"].includes(action)) {
      const isTargetAdmin = await isUserAdminInChat(bot.api, chatId, targetUserId);
      if (isTargetAdmin) {
        return res.status(400).json({ error: "Кечиресиз, администраторлорго карата чектөөлөрдү колдонууга болбойт!" });
      }
    }

    let targetName = "Колдонуучу";
    if (targetUserId) {
      const info = await db.hgetall(`chat:${chatId}:user:${targetUserId}:info`);
      if (info?.name) {
        targetName = info.name;
      }
    }

    switch (action) {
      case "warn": {
        const { getGroupConfig } = await import("../src/utils/configManager.js");
        const config = await getGroupConfig(chatId);
        const warnLimit = config.warnLimit || 3;
        const muteMinutes = config.muteDurationMinutes || 120;
        const warnAction = config.warnAction || "mute";
        
        const warnKey = `chat:${chatId}:user:${targetUserId}:warns`;
        const oldWarns = await db.get<number>(warnKey) || 0;
        const warns = await db.incr(warnKey);
        
        await logAction(bot.api, chatId, targetUserId, targetName, "Эскертүү (Warn)", `${reason || "Web Panel аркылуу"} (${warns}/${warnLimit})`, user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) эскертүү алды (${warns}/${warnLimit})`, { type: "warn", targetUserId, previousWarns: oldWarns });

        if (warns < warnLimit) {
          const textMsg = `⚠️ **${warns}-эскертүү!** Урматтуу [${targetName}](tg://user?id=${targetUserId}), тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason || "Администратор тарабынан"}`;
          await bot.api.sendMessage(chatId, textMsg, { parse_mode: "Markdown" }).catch(async () => {
            await bot.api.sendMessage(chatId, `⚠️ ${warns}-эскертүү! Урматтуу ${targetName}, тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason || "Администратор тарабынан"}`);
          });
        } else {
          if (warnAction === "ban") {
            await banUser(bot.api, chatId, targetUserId);
            await logAction(bot.api, chatId, targetUserId, targetName, "Бан", "Эскертүүлөрдүн чегине жетти (Warn Limit)", user.first_name || "Админ");
            const textMsg = `🚫 **Лимит толду!** [${targetName}](tg://user?id=${targetUserId}) тайпадан биротоло четтетилди (Бан).`;
            await bot.api.sendMessage(chatId, textMsg, { parse_mode: "Markdown" }).catch(async () => {
              await bot.api.sendMessage(chatId, `🚫 Лимит толду! ${targetName} тайпадан биротоло четтетилди (Бан).`);
            });
          } else if (warnAction === "kick") {
            await bot.api.banChatMember(chatId, targetUserId).catch(() => {});
            await bot.api.unbanChatMember(chatId, targetUserId).catch(() => {});
            await logAction(bot.api, chatId, targetUserId, targetName, "Кик", "Эскертүүлөрдүн чегине жетти", user.first_name || "Админ");
            const textMsg = `👢 **Лимит толду!** [${targetName}](tg://user?id=${targetUserId}) тайпадан чыгарылды (Кик).`;
            await bot.api.sendMessage(chatId, textMsg, { parse_mode: "Markdown" }).catch(async () => {
              await bot.api.sendMessage(chatId, `👢 Лимит толду! ${targetName} тайпадан чыгарылды (Кик).`);
            });
          } else {
            await muteUser(bot.api, chatId, targetUserId, muteMinutes * 60);
            await logAction(bot.api, chatId, targetUserId, targetName, "Мут", `Эскертүүлөрдүн чегине жетти (${muteMinutes} мүнөт)`, user.first_name || "Админ");
            const textMsg = `🔇 **Лимит толду!** [${targetName}](tg://user?id=${targetUserId}) ${muteMinutes} мүнөткө жазуу укугунан ажыратылды.`;
            await bot.api.sendMessage(chatId, textMsg, { parse_mode: "Markdown" }).catch(async () => {
              await bot.api.sendMessage(chatId, `🔇 Лимит толду! ${targetName} ${muteMinutes} мүнөткө жазуу укугунан ажыратылды.`);
            });
          }
          await db.del(warnKey);
        }
        break;
      }
      case "ban":
        await banUser(bot.api, chatId, targetUserId);
        await logAction(bot.api, chatId, targetUserId, targetName, "Бан", reason || "Web Panel аркылуу", user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) банга жөнөтүлдү`, { type: "ban", targetUserId });
        break;
      case "mute":
        const muteSeconds = parseInt(req.body.value, 10) || 24 * 60 * 60;
        await muteUser(bot.api, chatId, targetUserId, muteSeconds);
        await logAction(bot.api, chatId, targetUserId, targetName, "Мут", reason || `Web Panel аркылуу (${Math.round(muteSeconds/60)}м)`, user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) мутталды (${Math.round(muteSeconds/60)}м)`, { type: "mute", targetUserId });
        break;
      case "unmute":
        await bot.api.restrictChatMember(chatId, targetUserId, {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        await logAction(bot.api, chatId, targetUserId, targetName, "Мутту алуу", reason || "Web Panel аркылуу", user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) мутунан бошотулду`, { type: "unmute", targetUserId });
        break;
      case "kick":
        await bot.api.banChatMember(chatId, targetUserId).catch(() => {});
        await bot.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(bot.api, chatId, targetUserId, targetName, "Кик", reason || "Web Panel аркылуу", user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) тайпадан чыгарылды`, { type: "kick", targetUserId });
        break;
      case "unban":
        await bot.api.unbanChatMember(chatId, targetUserId, { only_if_banned: true }).catch(() => {});
        await logAction(bot.api, chatId, targetUserId, targetName, "Бөгөттөн чыгаруу", reason || "Web Panel аркылуу", user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) бандан чыгарылды`, { type: "unban", targetUserId });
        break;
      case "promote":
        const roleType = req.body.value || "middle";
        let rights = {
          can_delete_messages: true,
          can_restrict_members: false,
          can_pin_messages: true,
          can_invite_users: true,
          can_change_info: false,
        };
        if (roleType === "middle") {
          rights.can_restrict_members = true;
        } else if (roleType === "senior") {
          rights.can_restrict_members = true;
          rights.can_change_info = true;
        } else if (roleType === "coowner") {
          rights = {
            ...rights,
            can_restrict_members: true,
            can_change_info: true,
            ...({
              can_promote_members: false,
              can_manage_video_chats: true,
              can_post_messages: false,
              can_edit_messages: false,
              is_anonymous: false
            } as any)
          };
        }
        await bot.api.promoteChatMember(chatId, targetUserId, rights);
        await logAction(bot.api, chatId, targetUserId, targetName, "Promote", `Web Panel: Админ кылынды (${roleType})`, user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) администратор укугун алды (${roleType})`, { type: "promote", targetUserId, roleType });
        break;
      case "demote":
        await bot.api.promoteChatMember(chatId, targetUserId, {
          can_delete_messages: false, can_restrict_members: false,
          can_pin_messages: false, can_invite_users: false,
          can_change_info: false, can_manage_chat: false,
        });
        await logAction(bot.api, chatId, targetUserId, targetName, "Demote", "Web Panel аркылуу укугу алынды", user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучу [${targetName}](tg://user?id=${targetUserId}) администратор укугунан ажыратылды`, { type: "demote", targetUserId });
        break;
      case "resetwarns":
        const oldWarnsReset = await db.get<number>(`chat:${chatId}:user:${targetUserId}:warns`) || 0;
        await db.del(`chat:${chatId}:user:${targetUserId}:warns`);
        await logAction(bot.api, chatId, targetUserId, targetName, "Тазалоо", "Web Panel: Эскертүүлөр тазаланды", user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучунун [${targetName}](tg://user?id=${targetUserId}) эскертүүлөрү тазаланды`, { type: "resetwarns", targetUserId, previousWarns: oldWarnsReset });
        break;
      case "slowmode":
        const seconds = parseInt(req.body.value) || 0;
        await (bot.api as any).setChatSlowModeDelay(chatId, seconds).catch(() => {});
        await logAction(bot.api, chatId, 0, "Тайпа", "Slowmode", `Web Panel: ${seconds} сек`, user.first_name || "Админ");
        break;
      case "settitle":
        const title = req.body.text || "";
        if (title) await (bot.api as any).raw.setChatTitle({ chat_id: chatId, title });
        await logAction(bot.api, chatId, 0, "Тайпа", "SetTitle", `Web Panel: ${title}`, user.first_name || "Админ");
        break;
      case "setdesc":
        const desc = req.body.text || "";
        await (bot.api as any).raw.setChatDescription({ chat_id: chatId, description: desc });
        await logAction(bot.api, chatId, 0, "Тайпа", "SetDesc", "Web Panel аркылуу өзгөртүлдү", user.first_name || "Админ");
        break;
      case "setkarma":
        const karmaVal = parseInt(req.body.value, 10);
        if (!isNaN(karmaVal)) {
          const oldKarma = await db.get<number>(`chat:${chatId}:user:${targetUserId}:urmat`) || 0;
          await db.set(`chat:${chatId}:user:${targetUserId}:urmat`, karmaVal);
          await db.zadd(`chat:${chatId}:urmat_leaderboard`, karmaVal, String(targetUserId));
          await logAction(bot.api, chatId, targetUserId, targetName, "Карма", `Сый-Урмат деңгээли өзгөртүлдү: ${karmaVal}`, user.first_name || "Админ");
          await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучунун [${targetName}](tg://user?id=${targetUserId}) рейтинги өзгөртүлдү (${karmaVal})`, { type: "karma", targetUserId, previousKarma: oldKarma });
        }
        break;
      case "setusertitle":
        const titleText = req.body.text || "";
        const oldTitle = await db.get<string>(`chat:${chatId}:user:${targetUserId}:title`) || "";
        await db.set(`chat:${chatId}:user:${targetUserId}:title`, titleText);
        await logAction(bot.api, chatId, targetUserId, targetName, "Наам", `Жаңы наам берилди: ${titleText || "өчүрүлдү"}`, user.first_name || "Админ");
        await logAuditAction(chatId, user.id, user.first_name || "Админ", "moderation", `Колдонуучуга [${targetName}](tg://user?id=${targetUserId}) наам берилди: ${titleText || "өчүрүлдү"}`, { type: "title", targetUserId, previousTitle: oldTitle });
        break;
      case "grant_web_access": {
        const requester = await bot.api.getChatMember(chatId, user.id);
        const isOwnerOrCoowner = requester.status === "creator" || 
          (requester.status === "administrator" && requester.can_change_info && requester.can_restrict_members && requester.can_delete_messages);
        
        if (!isOwnerOrCoowner) {
          return res.status(403).json({ error: "Кечиресиз, бул аракетти аткарууга сизде укук жок! Ал чаттын ээсине же совладелецине гана жеткиликтүү." });
        }

        const targetMember = await bot.api.getChatMember(chatId, targetUserId);
        const isJunior = targetMember.status !== "creator" && 
          (targetMember.status !== "administrator" || !targetMember.can_restrict_members);

        if (isJunior) {
          return res.status(400).json({ error: "Кенже администраторлорго веб-панелге кирүүгө уруксат берилбейт! Адегенде бул колдонуучуну Башкы администратор кылып көтөрүңүз." });
        }

        await db.set(`chat:${chatId}:user:${targetUserId}:web_access`, "true");
        await logAction(bot.api, chatId, targetUserId, targetName, "Веб-панель", "Веб-панелге кирүүгө уруксат берилди", user.first_name || "Админ");
        
        const notificationText = `🔔 Урматтуу [${targetName}](tg://user?id=${targetUserId}), сизге веб-панелге кирүүгө уруксат берилди!`;
        const keyboard = {
          inline_keyboard: [
            [
              {
                text: "⚙️ Башкаруу панели",
                callback_data: `web_grant_goto:${chatId}:${targetUserId}`
              }
            ]
          ]
        };
        await bot.api.sendMessage(chatId, notificationText, {
          parse_mode: "Markdown",
          reply_markup: keyboard
        }).catch(() => {});
        break;
      }
      case "revoke_web_access": {
        const requester = await bot.api.getChatMember(chatId, user.id);
        const isOwnerOrCoowner = requester.status === "creator" || 
          (requester.status === "administrator" && requester.can_change_info && requester.can_restrict_members && requester.can_delete_messages);
        
        if (!isOwnerOrCoowner) {
          return res.status(403).json({ error: "Кечиресиз, бул аракетти аткарууга сизде укук жок! Ал чаттын ээсине же совладелецине гана жеткиликтүү." });
        }

        await db.set(`chat:${chatId}:user:${targetUserId}:web_access`, "false");
        await logAction(bot.api, chatId, targetUserId, targetName, "Веб-панель", "Веб-панелге кирүү уруксаты алып салынды", user.first_name || "Админ");
        
        await bot.api.sendMessage(chatId, `🔕 Урматтуу [${targetName}](tg://user?id=${targetUserId}), сиздин веб-панелге кирүү уруксатыңыз алып салынды.`, {
          parse_mode: "Markdown"
        }).catch(() => {});
        break;
      }
      case "undo_audit": {
        // Проверяем, является ли пользователь создателем (владельцем)
        const requester = await bot.api.getChatMember(chatId, user.id);
        const isOwner = requester.status === "creator";
        if (!isOwner) {
          return res.status(403).json({ error: "Кечиресиз, бул аракетти аткарууга укугуңуз жок! Ал чаттын ээсине гана жеткиликтүү." });
        }

        const { auditId } = req.body;
        if (!auditId) {
          return res.status(400).json({ error: "Missing auditId" });
        }

        // Получаем последние 100 записей аудита
        const auditRaw = await db.lrange(`chat:${chatId}:audit_log`, 0, 99) || [];
        let foundIndex = -1;
        let entry: any = null;

        for (let i = 0; i < auditRaw.length; i++) {
          const item = JSON.parse(auditRaw[i]);
          if (item.id === auditId) {
            foundIndex = i;
            entry = item;
            break;
          }
        }

        if (!entry) {
          return res.status(404).json({ error: "Аракет табылбай калды" });
        }

        if (entry.undone) {
          return res.status(400).json({ error: "Бул аракет мурунтан эле жокко чыгарылган" });
        }

        const { actionType, previousState } = entry;

        // Откатываем изменения в зависимости от типа действия
        if (actionType === "config") {
          const { updateGroupConfig } = await import("../src/utils/configManager.js");
          await updateGroupConfig(chatId, previousState);
        } else if (actionType === "blacklist") {
          await db.del(`chat:${chatId}:blacklist`);
          for (const [k, v] of Object.entries(previousState)) {
            await db.hset(`chat:${chatId}:blacklist`, k, String(v));
          }
        } else if (actionType === "filters") {
          await db.del(`chat:${chatId}:filters`);
          for (const [k, v] of Object.entries(previousState)) {
            await db.hset(`chat:${chatId}:filters`, k, String(v));
          }
        } else if (actionType === "notes") {
          await db.del(`chat:${chatId}:notes`);
          for (const [k, v] of Object.entries(previousState)) {
            await db.hset(`chat:${chatId}:notes`, k, String(v));
          }
        } else if (actionType === "announcements") {
          await db.del(`chat:${chatId}:announcements`);
          for (const [k, v] of Object.entries(previousState)) {
            await db.hset(`chat:${chatId}:announcements`, k, String(v));
          }
        } else if (actionType === "swearwords") {
          await db.del(`chat:${chatId}:swearwords`);
          if (Array.isArray(previousState)) {
            for (const word of previousState) {
              await db.sadd(`chat:${chatId}:swearwords`, word);
            }
          }
        } else if (actionType === "moderation") {
          const { type, targetUserId } = previousState;
          if (type === "ban" || type === "kick") {
            await bot.api.unbanChatMember(chatId, targetUserId).catch(() => {});
          } else if (type === "mute") {
            await bot.api.restrictChatMember(chatId, targetUserId, {
              can_send_messages: true, can_send_audios: true, can_send_documents: true,
              can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
              can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
              can_add_web_page_previews: true,
            }).catch(() => {});
          } else if (type === "warn") {
            const { previousWarns } = previousState;
            await db.set(`chat:${chatId}:user:${targetUserId}:warns`, previousWarns);
          } else if (type === "resetwarns") {
            const { previousWarns } = previousState;
            await db.set(`chat:${chatId}:user:${targetUserId}:warns`, previousWarns);
          } else if (type === "karma") {
            const { previousKarma } = previousState;
            await db.set(`chat:${chatId}:user:${targetUserId}:urmat`, previousKarma);
            await db.zadd(`chat:${chatId}:urmat_leaderboard`, previousKarma, String(targetUserId));
          } else if (type === "title") {
            const { previousTitle } = previousState;
            await db.set(`chat:${chatId}:user:${targetUserId}:title`, previousTitle);
          }
        }

        // Помечаем как отмененное и обновляем список в Redis
        entry.undone = true;
        auditRaw[foundIndex] = JSON.stringify(entry);
        
        await db.del(`chat:${chatId}:audit_log`);
        for (let i = auditRaw.length - 1; i >= 0; i--) {
          await db.lpush(`chat:${chatId}:audit_log`, auditRaw[i]);
        }

        break;
      }
      default:
        return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Action API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
