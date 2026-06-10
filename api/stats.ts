import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserSeniorAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";
import { db } from "../src/utils/db.js";

let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
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
      // 1. Logs
      const logsRaw = await db.lrange(`chat:${chatId}:logs`, 0, 50);
      const logs = logsRaw.map(l => typeof l === "string" ? JSON.parse(l) : l);

      // 2. Stats
      const msgCount = await db.get<number>(`chat:${chatId}:stats:messages_count`) || 0;
      const bansCount = await db.get<number>(`chat:${chatId}:stats:bans_count`) || 0;
      const mutesCount = await db.get<number>(`chat:${chatId}:stats:mutes_count`) || 0;
      const warnsCount = (await db.get<number>(`chat:${chatId}:stats:эскертүү (warn)s_count`)) || (await db.get<number>(`chat:${chatId}:stats:warns_count`)) || 0;
      
      const today = new Date().toISOString().split("T")[0];
      const msgsToday = await db.get<number>(`chat:${chatId}:stats:messages_by_date:${today}`) || 0;

      // Last 7 days messages count
      const history: { date: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const count = await db.get<number>(`chat:${chatId}:stats:messages_by_date:${dateStr}`) || 0;
        const formattedDate = dateStr.split("-").slice(1).reverse().join(".");
        history.push({ date: formattedDate, count });
      }

      // Top Users Array
      const topUsersAllTimeRaw = await db.zrange(`chat:${chatId}:stats:top_users`, 0, 10, { rev: true, withScores: true });
      const topUsersTodayRaw = await db.zrange(`chat:${chatId}:stats:top_users:${today}`, 0, 10, { rev: true, withScores: true });

      // 3. Members List
      const userIds = await db.smembers(`chat:${chatId}:users`);
      const usersInfo = [];
      const admins = await bot.api.getChatAdministrators(chatId).catch(() => []);
      const adminIds = new Set(admins.map(a => a.user.id));
      
      for (const uid of userIds) {
        const info = await db.hgetall(`chat:${chatId}:user:${uid}:info`);
        const warns = await db.get<number>(`chat:${chatId}:user:${uid}:warns`) || 0;
        const urmat = await db.get<number>(`chat:${chatId}:user:${uid}:urmat`) || 0;
        const title = await db.get<string>(`chat:${chatId}:user:${uid}:title`) || "";
        const numericId = parseInt(uid, 10);
        const isUserAdmin = adminIds.has(numericId);
        
        usersInfo.push({
          id: numericId,
          name: info?.name || "Белгисиз",
          username: info?.username || "",
          warns,
          urmat,
          title,
          isAdmin: isUserAdmin
        });
      }

      // 4. Group details
      let groupTitle = "Тайпа";
      try {
        const chat = await bot.api.getChat(chatId);
        if (chat && ("title" in chat)) {
          groupTitle = chat.title as string;
        }
      } catch (e) {}

      return res.status(200).json({ 
        logs, 
        stats: { msgCount, bansCount, mutesCount, warnsCount, msgsToday, history },
        users: usersInfo,
        topUsersAll: topUsersAllTimeRaw,
        topUsersToday: topUsersTodayRaw,
        groupTitle
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("Stats API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
