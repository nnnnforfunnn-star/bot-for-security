import { Context, Middleware } from "grammy";
import { logger } from "../utils/logger.js";
import { isUserAdmin } from "../utils/telegram.js";

// Конфигурация лимитов: максимум 5 сообщений за 3 секунды
const LIMIT = 5;
const WINDOW_MS = 3000;

// Хранилище истории активности пользователей: userId -> массивы временных меток (timestamps)
const userHistory = new Map<number, number[]>();

/**
 * Middleware для ограничения частоты запросов (Flood Protection).
 * Игнорирует администраторов группы.
 */
export const rateLimiter: Middleware<Context> = async (ctx, next) => {
  if (!ctx.from || !ctx.chat) {
    return next();
  }

  const userId = ctx.from.id;
  const now = Date.now();

  // Пропускаем лимиты для администраторов
  const isAdmin = await isUserAdmin(ctx);
  if (isAdmin) {
    return next();
  }

  // Получаем историю сообщений пользователя
  const timestamps = userHistory.get(userId) || [];

  // Очищаем метки времени, выходящие за рамки текущего окна
  const activeTimestamps = timestamps.filter((t) => now - t < WINDOW_MS);

  if (activeTimestamps.length >= LIMIT) {
    logger.warn(`Превышен лимит сообщений пользователем ${userId} в чате ${ctx.chat.id}. Активность заблокирована.`);

    // Пытаемся удалить флуд-сообщение
    if (ctx.message?.message_id) {
      try {
        await ctx.deleteMessage();
      } catch (err) {
        // Ошибка если нет прав на удаление
      }
    }
    return; // Прерываем цепочку обработки
  }

  // Добавляем текущую метку времени и сохраняем
  activeTimestamps.push(now);
  userHistory.set(userId, activeTimestamps);

  await next();
};

// Фоновый сборщик мусора для очистки неактивных пользователей из памяти раз в 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of userHistory.entries()) {
    const active = timestamps.filter((t) => now - t < WINDOW_MS);
    if (active.length === 0) {
      userHistory.delete(userId);
    } else {
      userHistory.set(userId, active);
    }
  }
}, 5 * 60 * 1000).unref(); // unref(), чтобы таймер не мешал завершению процесса в тестах/локально

