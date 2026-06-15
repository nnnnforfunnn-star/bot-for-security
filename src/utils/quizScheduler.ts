import { db } from "./db.js";
import { bot } from "../bot.js";
import { getGroupConfig, updateGroupConfig } from "./configManager.js";
import { logger } from "./logger.js";

/**
 * Periodically checks each group and sends the next quiz question if the interval has passed.
 */
export async function runQuizCheck(): Promise<void> {
  try {
    const allChatsRaw = await db.smembers("bot:chats") || [];
    const now = Date.now();

    for (const chatIdStr of allChatsRaw) {
      const targetChatId = parseInt(chatIdStr, 10);
      if (isNaN(targetChatId)) continue;

      try {
        const config = await getGroupConfig(targetChatId);
        if (!config.quizzesEnabled) continue;

        const intervalMs = (config.quizIntervalMinutes || 60) * 60 * 1000;
        const lastSent = config.quizLastSentTime || 0;

        if (now - lastSent >= intervalMs) {
          // Fetch quizzes array
          const quizzes = await db.get<any[]>(`chat:${targetChatId}:quizzes`) || [];
          if (quizzes.length === 0) continue;

          // Find the first unsent quiz
          const quizIndex = quizzes.findIndex(q => !q.sent);
          if (quizIndex === -1) {
            continue; // All quizzes have been sent
          }

          const quiz = quizzes[quizIndex];
          if (!quiz || !quiz.question || !quiz.options || quiz.options.length < 2) {
            // Skip invalid quiz by marking it as sent
            quizzes[quizIndex].sent = true;
            await db.set(`chat:${targetChatId}:quizzes`, quizzes);
            continue;
          }

          // Format quiz question
          const questionText = quiz.question;

          // Send poll/quiz using Telegram API
          const threadId = config.quizTopicId ? parseInt(config.quizTopicId, 10) : undefined;
          
          await bot.api.sendPoll(
            targetChatId,
            questionText,
            quiz.options,
            {
              type: "quiz",
              correct_option_id: quiz.correctOptionIndex,
              is_anonymous: true,
              message_thread_id: isNaN(threadId as any) ? undefined : threadId
            } as any
          );

          // Mark the quiz as sent in the quizzes array and persist
          quizzes[quizIndex].sent = true;
          await db.set(`chat:${targetChatId}:quizzes`, quizzes);

          // Update config values in db
          await updateGroupConfig(targetChatId, {
            quizLastSentTime: now
          });
        }
      } catch (chatErr) {
        logger.error(`Error running quiz check for chat ${targetChatId}:`, chatErr);
      }
    }
  } catch (err) {
    logger.error("Error in runQuizCheck:", err);
  }
}
