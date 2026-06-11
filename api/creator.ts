import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { db } from "../src/utils/db.js";
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
      return res.status(401).json({ error: "Unauthorized" });
    }

    const initData = authHeader.split(" ")[1];
    if (!validateWebAppData(initData)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = getUserFromInitData(initData);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Проверяем, является ли пользователь создателем бота
    const creatorId = process.env.CREATOR_ID;
    const isCreator = creatorId ? user.id.toString() === creatorId : true;

    if (!isCreator) {
      return res.status(403).json({ error: "Forbidden: Only the Bot Creator can access this panel" });
    }

    const hashKey = "global:icebreakers";

    if (req.method === "GET") {
      const items = await db.hgetall(hashKey) || {};
      const allChatsRaw = await db.smembers("bot:chats") || [];
      
      const stats = {
        activeGroups: allChatsRaw.length,
        totalIcebreakers: Object.keys(items).length,
        memoryHeapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        memoryHeapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        uptime: Math.round(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform
      };

      return res.status(200).json({ items, stats });
    }

    if (req.method === "POST") {
      const { action, id, type, text, options, answer, photo, buttons } = req.body;

      // Global Broadcast Action
      if (action === "broadcast") {
        if (!text) {
          return res.status(400).json({ error: "Broadcast text is required" });
        }

        if (!isBotInitialized) {
          await bot.init();
          isBotInitialized = true;
        }

        const allChatsRaw = await db.smembers("bot:chats") || [];
        let successCount = 0;
        let failCount = 0;

        for (const cidStr of allChatsRaw) {
          const cid = parseInt(cidStr, 10);
          if (isNaN(cid)) continue;

          try {
            let replyMarkup = undefined;
            if (buttons && Array.isArray(buttons) && buttons.length > 0) {
              const { InlineKeyboard } = await import("grammy");
              const keyboard = new InlineKeyboard();
              for (const btn of buttons) {
                if (btn.text && btn.url) {
                  keyboard.url(btn.text, btn.url).row();
                }
              }
              replyMarkup = keyboard;
            }

            if (photo) {
              await bot.api.sendPhoto(cid, photo, {
                caption: text,
                reply_markup: replyMarkup,
                parse_mode: "Markdown"
              }).catch(async () => {
                return await bot.api.sendPhoto(cid, photo, {
                  caption: text,
                  reply_markup: replyMarkup
                });
              });
            } else {
              await bot.api.sendMessage(cid, text, {
                reply_markup: replyMarkup,
                parse_mode: "Markdown"
              }).catch(async () => {
                return await bot.api.sendMessage(cid, text, {
                  reply_markup: replyMarkup
                });
              });
            }
            successCount++;
          } catch (e) {
            failCount++;
          }
        }

        return res.status(200).json({ success: true, successCount, failCount });
      }

      // Default Create/Update Item
      if (!id || !type || !text) {
        return res.status(400).json({ error: "Bad Request: Missing fields" });
      }

      const payload = {
        id,
        type,
        text,
        options: options || [],
        answer: answer || ""
      };

      await db.hset(hashKey, id, JSON.stringify(payload));
      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Bad Request: Missing id" });
      }

      await db.hdel(hashKey, id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("Creator API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
