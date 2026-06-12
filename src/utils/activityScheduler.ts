import { db } from "./db.js";
import { bot } from "../bot.js";
import { getGroupConfig } from "./configManager.js";
import { logger } from "./logger.js";

const DEFAULT_ICEBREAKERS = [
  {
    id: "seed_1",
    type: "proverb",
    text: "🤔 **Тайпада унчукпоо өкүм сүрүүдө. Келиңиздер, кыргыз макалын уланталы:**\n\n«Өнөрлүү өр тилейт, ...»",
    answer: "өнөрсүз төр тилейт"
  },
  {
    id: "seed_2",
    type: "proverb",
    text: "🤔 **Келиңиздер, кыргыз макалын уланталы:**\n\n«Ата көрүп ок жонат, ...»",
    answer: "эне көрүп тон бычат"
  },
  {
    id: "seed_3",
    type: "proverb",
    text: "🤔 **Келиңиздер, кыргыз макалын уланталы:**\n\n«Ойноп сүйлөсөң да, ...»",
    answer: "ойлоп сүйлө"
  },
  {
    id: "seed_4",
    type: "question",
    text: "🤔 **Группада тынчтык болуп жатат. Келиңиздер, ойлонуп көрөлү:**\n\n«Сиздин оюңузча, жашоодогу эң маанилүү нерсе эмне?»",
    answer: ""
  },
  {
    id: "seed_5",
    type: "proverb",
    text: "🤔 **Келиңиздер, кыргыз макалын уланталы:**\n\n«Жакшы сөз жан эргитет, ...»",
    answer: "жаман сөз жан кейитет"
  }
];

export async function runActivityCheck(): Promise<void> {
  try {
    const allChatsRaw = await db.smembers("bot:chats") || [];
    const now = Date.now();

    for (const chatIdStr of allChatsRaw) {
      const targetChatId = parseInt(chatIdStr, 10);
      if (isNaN(targetChatId)) continue;

      try {
        const config = await getGroupConfig(targetChatId);
        if (!config.activityGeneratorEnabled) continue;

        const idleTimeoutMs = (config.activityGeneratorTimeoutHours || 2) * 60 * 60 * 1000;
        let lastMsgTime = await db.get<number>(`chat:${targetChatId}:lastMessageTime`) || 0;
        if (lastMsgTime === 0) {
          // Initialize to trigger in 1 minute for testing/quick start
          await db.set(`chat:${targetChatId}:lastMessageTime`, now - idleTimeoutMs + 60000);
          continue;
        }

        if (now - lastMsgTime >= idleTimeoutMs) {
          const globalHash = await db.hgetall("global:icebreakers") || {};
          let items: any[] = [];
          for (const valRaw of Object.values(globalHash)) {
            try {
              items.push(typeof valRaw === "string" ? JSON.parse(valRaw) : valRaw);
            } catch (e) {}
          }

          if (items.length === 0) {
            items = DEFAULT_ICEBREAKERS;
          }

          const chosenItem = items[Math.floor(Math.random() * items.length)];
          if (!chosenItem) continue;

          try {
            const threadId = config.mainTopicId;
            await bot.api.sendMessage(targetChatId, chosenItem.text, {
              parse_mode: "Markdown",
              message_thread_id: threadId
            }).catch(async () => {
              return await bot.api.sendMessage(targetChatId, chosenItem.text, {
                message_thread_id: threadId
              });
            });

            if (chosenItem.answer) {
              await db.set(`chat:${targetChatId}:active_question`, JSON.stringify(chosenItem));
              await db.set(`chat:${targetChatId}:active_question_time`, now);
            }

            await db.set(`chat:${targetChatId}:lastMessageTime`, now);
          } catch (e: any) {
            logger.error(`Error sending global icebreaker to chat ${targetChatId}:`, e);
            if (e && (e.description?.includes("bot was kicked") || e.description?.includes("chat not found") || e.description?.includes("not a member") || e.description?.includes("Forbidden"))) {
              await db.srem("bot:chats", String(targetChatId)).catch(() => {});
              await db.hdel("bot:chats_metadata", String(targetChatId)).catch(() => {});
            }
          }
        }
      } catch (chatErr) {
        logger.error(`Error running activity check for chat ${targetChatId}:`, chatErr);
      }
    }
  } catch (err) {
    logger.error("Error in runActivityCheck:", err);
  }
}
