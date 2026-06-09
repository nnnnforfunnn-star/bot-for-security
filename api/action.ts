import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserSeniorAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";
import { banUser, muteUser } from "../src/utils/telegram.js";
import { logAction } from "../src/utils/actionLogger.js";
import { db } from "../src/utils/db.js";

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

    const isAdmin = await isUserSeniorAdminInChat(bot.api, chatId, user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: "Forbidden: You are not a Senior Administrator in this chat" });
    }

    const { action, targetUserId, reason } = req.body;

    const requiresTarget = ["ban", "mute", "unmute", "kick", "unban", "promote", "demote", "resetwarns", "warn", "setkarma", "setusertitle"];
    if (!action || (requiresTarget.includes(action) && !targetUserId)) {
      return res.status(400).json({ error: "Bad Request: missing action or targetUserId" });
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
        const warns = await db.incr(warnKey);
        
        await logAction(bot.api, chatId, targetUserId, targetName, "Эскертүү (Warn)", `${reason || "Web Panel аркылуу"} (${warns}/${warnLimit})`, user.first_name || "Админ");

        if (warns < warnLimit) {
          await bot.api.sendMessage(chatId, `⚠️ **${warns}-эскертүү!** Урматтуу [${targetName}](tg://user?id=${targetUserId}), тайпанын эрежелерин бузбаңыз.\nСебеби: ${reason || "Администратор тарабынан"}`, { parse_mode: "Markdown" }).catch(() => {});
        } else {
          if (warnAction === "ban") {
            await banUser(bot.api, chatId, targetUserId);
            await logAction(bot.api, chatId, targetUserId, targetName, "Бан", "Эскертүүлөрдүн чегине жетти (Warn Limit)", user.first_name || "Админ");
            await bot.api.sendMessage(chatId, `🚫 **Лимит толду!** [${targetName}](tg://user?id=${targetUserId}) тайпадан биротоло четтетилди (Бан).`, { parse_mode: "Markdown" }).catch(() => {});
          } else if (warnAction === "kick") {
            await bot.api.banChatMember(chatId, targetUserId).catch(() => {});
            await bot.api.unbanChatMember(chatId, targetUserId).catch(() => {});
            await logAction(bot.api, chatId, targetUserId, targetName, "Кик", "Эскертүүлөрдүн чегине жетти", user.first_name || "Админ");
            await bot.api.sendMessage(chatId, `👢 **Лимит толду!** [${targetName}](tg://user?id=${targetUserId}) тайпадан чыгарылды (Кик).`, { parse_mode: "Markdown" }).catch(() => {});
          } else {
            await muteUser(bot.api, chatId, targetUserId, muteMinutes * 60);
            await logAction(bot.api, chatId, targetUserId, targetName, "Мут", `Эскертүүлөрдүн чегине жетти (${muteMinutes} мүнөт)`, user.first_name || "Админ");
            await bot.api.sendMessage(chatId, `🔇 **Лимит толду!** [${targetName}](tg://user?id=${targetUserId}) ${muteMinutes} мүнөткө жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" }).catch(() => {});
          }
          await db.del(warnKey);
        }
        break;
      }
      case "ban":
        await banUser(bot.api, chatId, targetUserId);
        await logAction(bot.api, chatId, targetUserId, targetName, "Бан", reason || "Web Panel аркылуу", user.first_name || "Админ");
        break;
      case "mute":
        const muteSeconds = parseInt(req.body.value, 10) || 24 * 60 * 60;
        await muteUser(bot.api, chatId, targetUserId, muteSeconds);
        await logAction(bot.api, chatId, targetUserId, targetName, "Мут", reason || `Web Panel аркылуу (${Math.round(muteSeconds/60)}м)`, user.first_name || "Админ");
        break;
      case "unmute":
        await bot.api.restrictChatMember(chatId, targetUserId, {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        await logAction(bot.api, chatId, targetUserId, targetName, "Анмут", reason || "Web Panel аркылуу", user.first_name || "Админ");
        break;
      case "kick":
        await bot.api.banChatMember(chatId, targetUserId).catch(() => {});
        await bot.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(bot.api, chatId, targetUserId, targetName, "Кик", reason || "Web Panel аркылуу", user.first_name || "Админ");
        break;
      case "unban":
        await bot.api.unbanChatMember(chatId, targetUserId, { only_if_banned: true }).catch(() => {});
        await logAction(bot.api, chatId, targetUserId, targetName, "Разбан", reason || "Web Panel аркылуу", user.first_name || "Админ");
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
        break;
      case "demote":
        await bot.api.promoteChatMember(chatId, targetUserId, {
          can_delete_messages: false, can_restrict_members: false,
          can_pin_messages: false, can_invite_users: false,
          can_change_info: false, can_manage_chat: false,
        });
        await logAction(bot.api, chatId, targetUserId, targetName, "Demote", "Web Panel аркылуу укугу алынды", user.first_name || "Админ");
        break;
      case "resetwarns":
        await db.del(`chat:${chatId}:user:${targetUserId}:warns`);
        await logAction(bot.api, chatId, targetUserId, targetName, "Тазалоо", "Web Panel: Эскертүүлөр тазаланды", user.first_name || "Админ");
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
          await db.set(`chat:${chatId}:user:${targetUserId}:urmat`, karmaVal);
          await db.zadd(`chat:${chatId}:urmat_leaderboard`, karmaVal, String(targetUserId));
          await logAction(bot.api, chatId, targetUserId, targetName, "Карма", `Сый-Урмат деңгээли өзгөртүлдү: ${karmaVal}`, user.first_name || "Админ");
        }
        break;
      case "setusertitle":
        const titleText = req.body.text || "";
        await db.set(`chat:${chatId}:user:${targetUserId}:title`, titleText);
        await logAction(bot.api, chatId, targetUserId, targetName, "Наам", `Жаңы наам берилди: ${titleText || "өчүрүлдү"}`, user.first_name || "Админ");
        break;
      default:
        return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Action API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
