import { Context } from "grammy";
import { logger } from "../utils/logger.js";
import { isUserAdmin, muteUser, banUser } from "../utils/telegram.js";

// Список ключевых спам-слов (регистронезависимый)
const SPAM_KEYWORDS = [
  "крипта", "инвестиции", "заработок", "доход", "crypto", "forex", "invest", "dapp",
  "casino", "казино", "ставки", "вулкан", "vulkan", "слоты", "slots", "dating", "знакомства",
  "слив интим", "слив фото", "работа для студентов", "быстрые деньги", "легкие деньги",
  "t.me/joinchat", "telegram.me/joinchat", "t.me/+", "оплата за отзывы"
];

// Паттерны для поиска запрещенного контента (например, регулярные выражения)
const BLACKLISTED_PATTERNS = [
  /t\.me\/[a-zA-Z0-9_\+]{5,}/i, // Ссылки на телеграм-каналы/чаты
  /https?:\/\/[^\s]+/i,          // Любые внешние ссылки
];

/**
 * Основной обработчик текстовых и медиа-сообщений в группе.
 * Фильтрует спам, ссылки и нежелательный контент.
 */
export async function filterMessage(ctx: Context): Promise<void> {
  if (!ctx.message || !ctx.chat || !ctx.from) return;

  // Игнорируем личные сообщения (в ЛС боту проверки не нужны)
  if (ctx.chat.type === "private") return;

  // Игнорируем сообщения от администраторов
  const isAdmin = await isUserAdmin(ctx);
  if (isAdmin) return;

  const text = ctx.message.text || ctx.message.caption || "";
  const messageId = ctx.message.message_id;
  const userId = ctx.from.id;
  const username = ctx.from.username ? `@${ctx.from.username}` : `ID ${userId}`;

  let shouldDelete = false;
  let shouldMute = false;
  let violationReason = "";

  // 1. Проверка на наличие спам-слов
  const lowercaseText = text.toLowerCase();
  for (const keyword of SPAM_KEYWORDS) {
    if (lowercaseText.includes(keyword)) {
      shouldDelete = true;
      shouldMute = true; // За жесткий спам мутим пользователя
      violationReason = `содержит спам-слово "${keyword}"`;
      break;
    }
  }

  // 2. Проверка на наличие ссылок через встроенные сущности Telegram (самый надежный способ)
  if (!shouldDelete && (ctx.message.entities || ctx.message.caption_entities)) {
    const entities = ctx.message.entities || ctx.message.caption_entities || [];
    for (const entity of entities) {
      if (entity.type === "url" || entity.type === "text_link") {
        shouldDelete = true;
        violationReason = "содержит внешнюю ссылку";
        break;
      }
      if (entity.type === "mention") {
        // Упоминания других каналов/ботов/юзеров (@username)
        shouldDelete = true;
        violationReason = "содержит упоминание (@)";
        break;
      }
    }
  }

  // 3. Дополнительная проверка регулярными выражениями (если сущности не сработали)
  if (!shouldDelete) {
    for (const pattern of BLACKLISTED_PATTERNS) {
      if (pattern.test(text)) {
        shouldDelete = true;
        violationReason = "соответствует спам-паттерну";
        break;
      }
    }
  }

  // Если обнаружено нарушение:
  if (shouldDelete) {
    logger.warn(`Нарушение в чате ${ctx.chat.id} от ${username}: ${violationReason}. Текст: "${text.substring(0, 100)}..."`);

    try {
      // Удаляем спам-сообщение
      await ctx.deleteMessage();
    } catch (error) {
      logger.error(`Не удалось удалить спам-сообщение ${messageId} от ${userId}`, error);
    }

    if (shouldMute) {
      try {
        // Мутим спамера на 24 часа
        const muteDurationSeconds = 24 * 60 * 60;
        const muted = await muteUser(ctx.api, ctx.chat.id, userId, muteDurationSeconds);
        if (muted) {
          // Отправляем в чат уведомление без упоминания (чтобы не флудить)
          const warnMsg = await ctx.reply(
            `⚠️ Пользователь ${ctx.from.first_name} был временно заглушен на 24 часа за спам.`,
            { disable_notification: true }
          );
          // Так как мы на Vercel, мы не можем сделать setTimeout для удаления warnMsg.
          // Оно просто останется в чате. Это нормальная практика модерации.
        }
      } catch (error) {
        logger.error(`Ошибка при выдаче мута пользователю ${userId}`, error);
      }
    }
  }
}
