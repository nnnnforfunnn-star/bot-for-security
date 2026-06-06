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

    if (!action || !targetUserId) {
      return res.status(400).json({ error: "Bad Request: missing action or targetUserId" });
    }

    const targetName = "Колдонуучу"; // Fetch name if possible

    switch (action) {
      case "ban":
        await banUser(bot.api, chatId, targetUserId);
        await logAction(bot.api, chatId, targetUserId, targetName, "Бан", reason || "Web Panel аркылуу");
        break;
      case "mute":
        await muteUser(bot.api, chatId, targetUserId, 24 * 60 * 60); // 24h
        await logAction(bot.api, chatId, targetUserId, targetName, "Мут", reason || "Web Panel аркылуу (24с)");
        break;
      case "kick":
        await bot.api.banChatMember(chatId, targetUserId).catch(() => {});
        await bot.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(bot.api, chatId, targetUserId, targetName, "Кик", reason || "Web Panel аркылуу");
        break;
      case "unban":
        await bot.api.unbanChatMember(chatId, targetUserId, { only_if_banned: true }).catch(() => {});
        await logAction(bot.api, chatId, targetUserId, targetName, "Разбан", reason || "Web Panel аркылуу");
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
