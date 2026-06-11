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
    const isCreator = creatorId ? user.id.toString() === creatorId : false;

    if (!isCreator) {
      return res.status(403).json({ error: "Forbidden: Only the Bot Creator can access this panel" });
    }

    const hashKey = "global:icebreakers";

    if (req.method === "GET") {
      const items = await db.hgetall(hashKey) || {};
      const allChatsRaw = await db.smembers("bot:chats") || [];
      
      const chatsMetadataRaw = await db.hgetall("bot:chats_metadata") || {};
      const chatsList = Object.values(chatsMetadataRaw).map(metaStr => {
        try {
          return typeof metaStr === "string" ? JSON.parse(metaStr) : metaStr;
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
      
      const stats = {
        activeGroups: allChatsRaw.length,
        totalIcebreakers: Object.keys(items).length,
        memoryHeapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        memoryHeapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        uptime: Math.round(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform
      };

      return res.status(200).json({ items, stats, chatsList });
    }

    if (req.method === "POST") {
      const { action, id, type, text, options, answer, photo, buttons, chatId, configData, deleteAfterMinutes } = req.body;

      // Leave Chat Action
      if (action === "leave_chat") {
        if (!chatId) {
          return res.status(400).json({ error: "chatId is required" });
        }
        if (!isBotInitialized) {
          await bot.init();
          isBotInitialized = true;
        }
        try {
          await bot.api.leaveChat(parseInt(chatId, 10));
        } catch (e) {}
        await db.srem("bot:chats", String(chatId)).catch(() => {});
        await db.hdel("bot:chats_metadata", String(chatId)).catch(() => {});
        return res.status(200).json({ success: true });
      }

      // Send Message to specific Chat Action
      if (action === "send_message") {
        if (!chatId || !text) {
          return res.status(400).json({ error: "chatId and text are required" });
        }
        if (!isBotInitialized) {
          await bot.init();
          isBotInitialized = true;
        }
        try {
          await bot.api.sendMessage(parseInt(chatId, 10), text, { parse_mode: "Markdown" }).catch(async () => {
            return await bot.api.sendMessage(parseInt(chatId, 10), text);
          });
          return res.status(200).json({ success: true });
        } catch (e) {
          return res.status(500).json({ error: "Message sending failed: " + String(e) });
        }
      }

      // Get Chat Config Action
      if (action === "get_chat_config") {
        if (!chatId) {
          return res.status(400).json({ error: "chatId is required" });
        }
        const { getGroupConfig } = await import("../src/utils/configManager.js");
        const config = await getGroupConfig(chatId);
        return res.status(200).json({ success: true, config });
      }

      // Save Chat Config Action
      if (action === "save_chat_config") {
        if (!chatId || !configData) {
          return res.status(400).json({ error: "chatId and configData are required" });
        }
        const { updateGroupConfig } = await import("../src/utils/configManager.js");
        await updateGroupConfig(chatId, configData);
        return res.status(200).json({ success: true });
      }

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

            let sentMsg: any = null;
            if (photo) {
              sentMsg = await bot.api.sendPhoto(cid, photo, {
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
              sentMsg = await bot.api.sendMessage(cid, text, {
                reply_markup: replyMarkup,
                parse_mode: "Markdown"
              }).catch(async () => {
                return await bot.api.sendMessage(cid, text, {
                  reply_markup: replyMarkup
                });
              });
            }

            if (sentMsg && deleteAfterMinutes && deleteAfterMinutes > 0) {
              const deleteAt = Date.now() + deleteAfterMinutes * 60 * 1000;
              await db.rpush("global:broadcast_deletions", JSON.stringify({ chatId: cid, messageId: sentMsg.message_id, deleteAt }));
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
