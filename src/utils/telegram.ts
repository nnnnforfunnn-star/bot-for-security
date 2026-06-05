import { Api, Bot, Context } from "grammy";
import { logger } from "./logger.js";

// Вспомогательная функция задержки
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Хранилище кэша администраторов: chatId_userId -> { isAdmin: boolean, expiresAt: number }
const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const ADMIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Проверяет, является ли пользователь администратором или владельцем чата.
 * Использует локальный кэш для предотвращения превышения лимитов Telegram API.
 */
export async function isUserAdmin(ctx: Context, userId?: number): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  if (ctx.chat.type === "private") return false;

  const targetUserId = userId || ctx.from.id;
  const cacheKey = `${ctx.chat.id}_${targetUserId}`;
  const cached = adminCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.isAdmin;
  }

  try {
    const member = await ctx.getChatMember(targetUserId);
    const isAdmin = member.status === "administrator" || member.status === "creator";

    adminCache.set(cacheKey, {
      isAdmin,
      expiresAt: Date.now() + ADMIN_CACHE_TTL_MS,
    });

    return isAdmin;
  } catch (error) {
    logger.warn(`Не удалось проверить права администратора для ${targetUserId} в чате ${ctx.chat.id}`, { error });
    return false;
  }
}

/**
 * Проверка прав администратора из ЛС бота (для Deep Linking)
 */
export async function isUserAdminInChat(api: Api, chatId: string | number, userId: number): Promise<boolean> {
  const cacheKey = `${chatId}_${userId}`;
  const cached = adminCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.isAdmin;
  }

  try {
    const member = await api.getChatMember(chatId, userId);
    const isAdmin = member.status === "administrator" || member.status === "creator";

    adminCache.set(cacheKey, {
      isAdmin,
      expiresAt: Date.now() + ADMIN_CACHE_TTL_MS,
    });

    return isAdmin;
  } catch (error) {
    logger.warn(`Не удалось проверить права администратора из ЛС для ${userId} в чате ${chatId}`, { error });
    return false;
  }
}


/**
 * Безопасное групповое удаление сообщений с учетом лимитов Telegram API.
 * Telegram поддерживает удаление до 100 сообщений за один вызов deleteMessages.
 */
export async function deleteMessagesBatch(
  api: Api,
  chatId: number | string,
  messageIds: number[]
): Promise<void> {
  if (messageIds.length === 0) return;

  // Telegram API разрешает удалять максимум 100 сообщений за один запрос
  const chunkSize = 100;
  const chunks: number[][] = [];

  for (let i = 0; i < messageIds.length; i += chunkSize) {
    chunks.push(messageIds.slice(i, i + chunkSize));
  }

  logger.info(`Начало удаления ${messageIds.length} сообщений, разделено на ${chunks.length} пакетов.`);

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    try {
      // Вызываем встроенный метод Telegram API для группового удаления
      await api.deleteMessages(chatId, chunk);
      logger.info(`Пакет сообщений ${idx + 1}/${chunks.length} успешно удален.`);
    } catch (error) {
      logger.error(`Ошибка при удалении пакета сообщений ${idx + 1}/${chunks.length}`, error, {
        chatId,
        messageIdsCount: chunk.length,
      });
      // Попробуем поштучно, если в пакете были невалидные ID
      // (например, сообщения старше 48 часов или уже удаленные)
      for (const msgId of chunk) {
        try {
          await api.deleteMessage(chatId, msgId);
          await sleep(50); // Небольшая пауза между запросами (30 сообщений/сек)
        } catch (e) {
          // Игнорируем ошибки при удалении поштучно, чтобы процесс шел дальше
        }
      }
    }

    // Если пакетов больше одного, делаем паузу между запросами для предотвращения Flood Wait
    if (idx < chunks.length - 1) {
      await sleep(350);
    }
  }
}

/**
 * Ограничение прав пользователя (Мут)
 * @param api Экземпляр Api из grammY
 * @param chatId ID группы
 * @param userId ID пользователя
 * @param durationSeconds Длительность мута в секундах (0 - навсегда)
 */
export async function muteUser(
  api: Api,
  chatId: number | string,
  userId: number,
  durationSeconds = 0
): Promise<boolean> {
  try {
    const untilDate = durationSeconds > 0 ? Math.floor(Date.now() / 1000) + durationSeconds : 0;
    await api.restrictChatMember(
      chatId,
      userId,
      {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
      {
        until_date: untilDate,
      }
    );
    logger.info(`Пользователь ${userId} временно заглушен в чате ${chatId} на ${durationSeconds}с.`);
    return true;
  } catch (error) {
    logger.error(`Не удалось заглушить пользователя ${userId} в чате ${chatId}`, error);
    return false;
  }
}

/**
 * Блокировка пользователя (Бан)
 */
export async function banUser(
  api: Api,
  chatId: number | string,
  userId: number,
  durationSeconds = 0
): Promise<boolean> {
  try {
    const untilDate = durationSeconds > 0 ? Math.floor(Date.now() / 1000) + durationSeconds : 0;
    await api.banChatMember(chatId, userId, {
      until_date: untilDate,
      revoke_messages: true, // Также удаляет все сообщения пользователя за последние 24 часа
    });
    logger.info(`Пользователь ${userId} заблокирован в чате ${chatId}.`);
    return true;
  } catch (error) {
    logger.error(`Не удалось заблокировать пользователя ${userId} в чате ${chatId}`, error);
    return false;
  }
}

/**
 * Разблокировка пользователя
 */
export async function unbanUser(
  api: Api,
  chatId: number | string,
  userId: number
): Promise<boolean> {
  try {
    await api.unbanChatMember(chatId, userId, { only_if_banned: true });
    logger.info(`Пользователь ${userId} разблокирован в чате ${chatId}.`);
    return true;
  } catch (error) {
    logger.error(`Не удалось разблокировать пользователя ${userId} в чате ${chatId}`, error);
    return false;
  }
}
