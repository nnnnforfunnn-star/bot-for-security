import { getGroupConfig, updateGroupConfig } from "../src/utils/configManager.js";
import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserSeniorAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";
import { db } from "../src/utils/db.js";
import { logAuditAction } from "../src/utils/audit.js";

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

    await db.sadd(`user:${user.id}:chats`, chatId.toString());
    await db.sadd("bot:chats", chatId.toString()).catch(() => {});

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
      const announcements = (await db.hgetall(`chat:${chatId}:announcements`)) || {};
      return res.status(200).json({ config, blacklist, filters, notes, swearwords, announcements });
    } 
    
    if (req.method === "POST") {
      const { config, blacklist, filters, notes, swearwords, announcements } = req.body;
      const adminName = user.first_name || "Администратор";

      // Сохраняем ID чата в список активных чатов
      await db.sadd("bot:chats", chatId).catch(() => {});

      // Получаем старые состояния для логирования и отката
      const oldConfig = await getGroupConfig(chatId);
      const oldBlacklist = (await db.hgetall(`chat:${chatId}:blacklist`)) || {};
      const oldFilters = (await db.hgetall(`chat:${chatId}:filters`)) || {};
      const oldNotes = (await db.hgetall(`chat:${chatId}:notes`)) || {};
      const oldSwearwords = (await db.smembers(`chat:${chatId}:swearwords`)) || [];
      const oldAnnouncements = (await db.hgetall(`chat:${chatId}:announcements`)) || {};
      
      let updatedConfig = {};
      if (config) {
        // Сравнение изменений настроек
        const hasConfigChanged = JSON.stringify(oldConfig) !== JSON.stringify({ ...oldConfig, ...config });
        if (hasConfigChanged) {
          await logAuditAction(chatId, user.id, adminName, "config", "Орнотуулар өзгөртүлдү", oldConfig);
        }

        updatedConfig = await updateGroupConfig(chatId, config);

        if (config.rulesText && config.rulesText !== oldConfig.rulesText && (updatedConfig as any).autoPinRules) {
          try {
            const rulesMsg = await bot.api.sendMessage(chatId, `📖 **Тайпанын жаңы эрежелери:**\n\n${config.rulesText}`, { parse_mode: "Markdown" }).catch(async () => {
              // В случае невалидной Markdown-разметки отправляем как обычный текст
              return await bot.api.sendMessage(chatId, `📖 **Тайпанын жаңы эрежелери:**\n\n${config.rulesText}`);
            });
            await bot.api.pinChatMessage(chatId, rulesMsg.message_id, { disable_notification: true }).catch(() => {});
          } catch (e) {
            console.error("Error auto-pinning rules:", e);
          }
        }
      }

      // Helper function to sync hashes
      const syncHash = async (hashName: string, data: Record<string, string>) => {
        if (!data) return;
        await db.del(hashName);
        for (const [k, v] of Object.entries(data)) {
          if (k.trim()) await db.hset(hashName, k.trim().toLowerCase(), v);
        }
      };

      if (blacklist) {
        const oldKeys = Object.keys(oldBlacklist).sort();
        const newKeys = Object.keys(blacklist).sort();
        const hasBlacklistChanged = JSON.stringify(oldKeys) !== JSON.stringify(newKeys) || 
          newKeys.some(k => oldBlacklist[k] !== blacklist[k]);
        if (hasBlacklistChanged) {
          await logAuditAction(chatId, user.id, adminName, "blacklist", "Кара тизме өзгөртүлдү", oldBlacklist);
        }
        await syncHash(`chat:${chatId}:blacklist`, blacklist);
      }

      if (filters) {
        const oldKeys = Object.keys(oldFilters).sort();
        const newKeys = Object.keys(filters).sort();
        const hasFiltersChanged = JSON.stringify(oldKeys) !== JSON.stringify(newKeys) || 
          newKeys.some(k => oldFilters[k] !== filters[k]);
        if (hasFiltersChanged) {
          await logAuditAction(chatId, user.id, adminName, "filters", "Автожооптор өзгөртүлдү", oldFilters);
        }
        await syncHash(`chat:${chatId}:filters`, filters);
      }

      if (notes) {
        const oldKeys = Object.keys(oldNotes).sort();
        const newKeys = Object.keys(notes).sort();
        const hasNotesChanged = JSON.stringify(oldKeys) !== JSON.stringify(newKeys) || 
          newKeys.some(k => oldNotes[k] !== notes[k]);
        if (hasNotesChanged) {
          await logAuditAction(chatId, user.id, adminName, "notes", "Кыска командалар өзгөртүлдү", oldNotes);
        }
        await syncHash(`chat:${chatId}:notes`, notes);
      }

      if (announcements) {
        const oldKeys = Object.keys(oldAnnouncements).sort();
        const newKeys = Object.keys(announcements).sort();
        const hasAnnouncementsChanged = JSON.stringify(oldKeys) !== JSON.stringify(newKeys) || 
          newKeys.some(k => oldAnnouncements[k] !== announcements[k]);
        if (hasAnnouncementsChanged) {
          await logAuditAction(chatId, user.id, adminName, "announcements", "Жарыялар өзгөртүлдү", oldAnnouncements);
        }
        await syncHash(`chat:${chatId}:announcements`, announcements);
      }

      // Sync swear words (Set, not Hash)
      if (swearwords && Array.isArray(swearwords)) {
        const oldWords = [...oldSwearwords].sort();
        const newWords = [...swearwords].map(w => w.trim().toLowerCase()).sort();
        const hasSwearwordsChanged = JSON.stringify(oldWords) !== JSON.stringify(newWords);
        if (hasSwearwordsChanged) {
          await logAuditAction(chatId, user.id, adminName, "swearwords", "Запрещенные сөздөр өзгөртүлдү", oldSwearwords);
        }

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
