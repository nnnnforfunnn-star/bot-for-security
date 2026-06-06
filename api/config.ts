import { getGroupConfig, updateGroupConfig } from "../src/utils/configManager.js";
import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserSeniorAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";
import { db } from "../src/utils/db.js";

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

    if (req.method === "GET") {
      const config = await getGroupConfig(chatId);
      const blacklist = (await db.hgetall(`chat:${chatId}:blacklist`)) || {};
      const filters = (await db.hgetall(`chat:${chatId}:filters`)) || {};
      const notes = (await db.hgetall(`chat:${chatId}:notes`)) || {};
      const swearwords = await db.smembers(`chat:${chatId}:swearwords`) || [];
      return res.status(200).json({ config, blacklist, filters, notes, swearwords });
    } 
    
    if (req.method === "POST") {
      const { config, blacklist, filters, notes, swearwords } = req.body;
      
      let updatedConfig = {};
      if (config) {
        updatedConfig = await updateGroupConfig(chatId, config);
      }

      // Helper function to sync hashes
      const syncHash = async (hashName: string, data: Record<string, string>) => {
        if (!data) return;
        await db.del(hashName);
        for (const [k, v] of Object.entries(data)) {
          if (k.trim()) await db.hset(hashName, k.trim().toLowerCase(), v);
        }
      };

      await syncHash(`chat:${chatId}:blacklist`, blacklist);
      await syncHash(`chat:${chatId}:filters`, filters);
      await syncHash(`chat:${chatId}:notes`, notes);

      // Sync swear words (Set, not Hash)
      if (swearwords && Array.isArray(swearwords)) {
        await db.del(`chat:${chatId}:swearwords`);
        for (const word of swearwords) {
          if (word && word.trim()) await db.sadd(`chat:${chatId}:swearwords`, word.trim().toLowerCase());
        }
      }

      return res.status(200).json({ success: true, config: updatedConfig });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
