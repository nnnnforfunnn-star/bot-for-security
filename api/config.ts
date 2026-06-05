import { getGroupConfig, updateGroupConfig } from "../src/utils/configManager.js";
import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";

let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("tma ")) {
      return res.status(401).json({ error: "Unauthorized: Missing Telegram Web App initData" });
    }

    const initData = authHeader.split(" ")[1];
    
    // Validate initData
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

    // Initialize bot if needed for the Telegram API
    if (!isBotInitialized) {
      await bot.init();
      isBotInitialized = true;
    }

    // Verify admin status
    const isAdmin = await isUserAdminInChat(bot.api, chatId, user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: "Forbidden: You are not an administrator in this chat" });
    }

    if (req.method === "GET") {
      const config = await getGroupConfig(chatId);
      return res.status(200).json(config);
    } 
    
    if (req.method === "POST") {
      const updates = req.body;
      const updatedConfig = await updateGroupConfig(chatId, updates);
      return res.status(200).json({ success: true, config: updatedConfig });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
