import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserSeniorAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";
import { banUser, muteUser } from "../src/utils/telegram.js";
import { logAction } from "../src/utils/actionLogger.js";

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

    const requiresTarget = ["ban", "mute", "unmute", "kick", "unban", "promote", "demote", "resetwarns"];
    if (!action || (requiresTarget.includes(action) && !targetUserId)) {
      return res.status(400).json({ error: "Bad Request: missing action or targetUserId" });
    }

    const targetName = "Колдонуучу"; // Fetch name if possible

    switch (action) {
      case "ban":
        await banUser(bot.api, chatId, targetUserId);
        await logAction(bot.api, chatId, targetUserId, targetName, "Бан", reason || "Web Panel аркылуу", user.first_name || "Админ");
        break;
      case "mute":
        await muteUser(bot.api, chatId, targetUserId, 24 * 60 * 60);
        await logAction(bot.api, chatId, targetUserId, targetName, "Мут", reason || "Web Panel аркылуу (24с)", user.first_name || "Админ");
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
        await bot.api.promoteChatMember(chatId, targetUserId, {
          can_delete_messages: true, can_restrict_members: true,
          can_pin_messages: true, can_invite_users: true,
        });
        await logAction(bot.api, chatId, targetUserId, targetName, "Promote", "Web Panel аркылуу админ кылынды", user.first_name || "Админ");
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
        const { db } = await import("../src/utils/db.js");
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
      default:
        return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Action API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
