import { Api } from "grammy";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { getGroupConfig } from "./configManager.js";

export async function logAction(
  api: Api,
  chatId: number,
  userId: number,
  name: string,
  action: string,
  reason: string,
  adminName: string = "Бот"
) {
  try {
    const timestamp = Date.now();
    const logEntry = {
      userId,
      name,
      action,
      reason,
      adminName,
      timestamp
    };
    
    // Save to Redis for Web Panel
    await db.lpush(`chat:${chatId}:logs`, logEntry);
    
    // Increment stats
    await db.incr(`chat:${chatId}:stats:${action.toLowerCase()}s_count`); // e.g. bans_count, mutes_count
    
    // Check if Log Channel is configured
    // Note: Log channel is not in GroupConfig yet, we'll store it directly in db
    const logChannelId = await db.get<string>(`chat:${chatId}:log_channel`);
    if (logChannelId) {
      let emoji = "ℹ️";
      if (action.includes("Ban") || action.includes("Бан")) emoji = "🚫";
      if (action.includes("Mute") || action.includes("Мут")) emoji = "🔇";
      if (action.includes("Kick") || action.includes("Кик")) emoji = "👢";
      if (action.includes("Warn") || action.includes("Эскертүү")) emoji = "⚠️";
      if (action.includes("Delete") || action.includes("Удаление")) emoji = "🗑";

      const text = `${emoji} **Аракет:** ${action}\n👤 **Колдонуучу:** [${name}](tg://user?id=${userId}) (<code>${userId}</code>)\n📝 **Себеби:** ${reason}`;
      await api.sendMessage(logChannelId, text, { parse_mode: "HTML" }).catch(() => {});
    }
  } catch (e) {
    logger.error("Failed to log action", e);
  }
}
