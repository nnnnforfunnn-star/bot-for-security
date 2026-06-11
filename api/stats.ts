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
      
      const adminsMap = new Map(admins.map(a => [a.user.id, a]));
      
      for (const uid of userIds) {
        const info = await db.hgetall(`chat:${chatId}:user:${uid}:info`);
        const warns = await db.get<number>(`chat:${chatId}:user:${uid}:warns`) || 0;
        const urmat = await db.get<number>(`chat:${chatId}:user:${uid}:urmat`) || 0;
        const title = await db.get<string>(`chat:${chatId}:user:${uid}:title`) || "";
        const numericId = parseInt(uid, 10);
        const isUserAdmin = adminIds.has(numericId);
        
        let adminRole: string | null = null;
        let adminCustomTitle = "";
        let webAccess = false;
        
        if (isUserAdmin) {
          const adm = adminsMap.get(numericId);
          if (adm) {
            if (adm.status === "creator") {
              adminRole = "owner";
            } else {
              if (adm.can_restrict_members && adm.can_change_info) {
                adminRole = "coowner";
              } else if (adm.can_restrict_members) {
                adminRole = "middle";
              } else {
                adminRole = "junior";
              }
            }
            adminCustomTitle = adm.custom_title || "";
          }
          if (adminRole === "owner" || adminRole === "coowner") {
            webAccess = true;
          } else {
            const hasWebAccess = await db.get<string>(`chat:${chatId}:user:${uid}:web_access`);
            webAccess = hasWebAccess === "true";
          }
        }
        
        usersInfo.push({
          id: numericId,
          name: info?.name || "Белгисиз",
          username: info?.username || "",
          warns,
          urmat,
          title,
          isAdmin: isUserAdmin,
          adminRole,
          adminCustomTitle,
          webAccess
        });
      }

      // Ensure all current admins are included in usersInfo
      const processedUserIds = new Set(usersInfo.map(u => u.id));
      for (const adm of admins) {
        if (!processedUserIds.has(adm.user.id)) {
          const uid = adm.user.id.toString();
          const info = await db.hgetall(`chat:${chatId}:user:${uid}:info`);
          const warns = await db.get<number>(`chat:${chatId}:user:${uid}:warns`) || 0;
          const urmat = await db.get<number>(`chat:${chatId}:user:${uid}:urmat`) || 0;
          const title = await db.get<string>(`chat:${chatId}:user:${uid}:title`) || "";
          
          let adminRole = "junior";
          if (adm.status === "creator") {
            adminRole = "owner";
          } else {
            if (adm.can_restrict_members && adm.can_change_info) {
              adminRole = "coowner";
            } else if (adm.can_restrict_members) {
              adminRole = "middle";
            }
          }

          let webAccess = false;
          if (adm.status === "creator") {
            webAccess = true;
          } else {
            const hasWebAccess = await db.get<string>(`chat:${chatId}:user:${uid}:web_access`);
            if (hasWebAccess === "true") {
              webAccess = true;
            } else if (hasWebAccess === "false") {
              webAccess = false;
            } else {
              webAccess = adminRole === "coowner";
            }
          }

          usersInfo.push({
            id: adm.user.id,
            name: info?.name || [adm.user.first_name, adm.user.last_name].filter(Boolean).join(" ") || "Администратор",
            username: info?.username || adm.user.username || "",
            warns,
            urmat,
            title,
            isAdmin: true,
            adminRole,
            adminCustomTitle: adm.custom_title || "",
            webAccess
          });
        }
      }

      // 4. Group details
      let groupTitle = "Тайпа";
      try {
        const chat = await bot.api.getChat(chatId);
        if (chat && ("title" in chat)) {
          groupTitle = chat.title as string;
        }
      } catch (e) {}

      // 5. User's other chats
      await db.sadd(`user:${user.id}:chats`, chatId.toString());
      await db.set(`chat:${chatId}:title`, groupTitle);
      
      const userChatsRaw = await db.smembers(`user:${user.id}:chats`) || [];
      const myChats = [];
      for (const cidStr of userChatsRaw) {
        const cid = parseInt(cidStr, 10);
        if (isNaN(cid)) continue;
        
        if (cid === chatId) {
          myChats.push({ id: cid, title: groupTitle });
          continue;
        }
        
        try {
          const isUserAdminInThisChat = await isUserSeniorAdminInChat(bot.api, cid, user.id);
          if (isUserAdminInThisChat) {
            let title = await db.get<string>(`chat:${cid}:title`);
            if (!title) {
              const chatDetails = await bot.api.getChat(cid);
              if (chatDetails && ("title" in chatDetails)) {
                title = chatDetails.title as string;
                await db.set(`chat:${cid}:title`, title);
              } else {
                title = `Тайпа (${cid})`;
              }
            }
            myChats.push({ id: cid, title });
          } else {
            await db.srem(`user:${user.id}:chats`, cidStr);
          }
        } catch (e) {
          await db.srem(`user:${user.id}:chats`, cidStr);
        }
      }

      // Проверяем, является ли пользователь создателем (владельцем)
      const chatMember = await bot.api.getChatMember(chatId, user.id);
      const isOwner = chatMember.status === "creator";

      let auditLog: any[] = [];
      if (isOwner) {
        const auditRaw = await db.lrange(`chat:${chatId}:audit_log`, 0, 99) || [];
        auditLog = auditRaw.map(item => {
          try {
            return JSON.parse(item);
          } catch (e) {
            return null;
          }
        }).filter(Boolean);
      }

      return res.status(200).json({ 
        logs, 
        stats: { msgCount, bansCount, mutesCount, warnsCount, msgsToday, history },
        users: usersInfo,
        topUsersAll: topUsersAllTimeRaw,
        topUsersToday: topUsersTodayRaw,
        groupTitle,
        myChats,
        isOwner,
        auditLog
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("Stats API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
