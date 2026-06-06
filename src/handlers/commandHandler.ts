import { Context } from "grammy";
import { logger } from "../utils/logger.js";
import { isUserAdmin, muteUser, banUser, unbanUser } from "../utils/telegram.js";
import { getGroupConfig } from "../utils/configManager.js";
import { logAction } from "../utils/actionLogger.js";

async function replyMaybeSilent(ctx: Context, text: string) {
  if (!ctx.chat) return;
  const config = await getGroupConfig(ctx.chat.id);
  if (config.silentMode) {
    await ctx.deleteMessage().catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: "HTML" });
  }
}

/**
 * Парсит строку длительности (например: "10m", "2h", "1d") и возвращает время в секундах.
 * Если строка невалидна, возвращает 0 (перманентное ограничение).
 */
function parseDuration(durationStr?: string): number {
  if (!durationStr) return 0;
  const match = durationStr.match(/^(\d+)([mhds])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "m": return value * 60;          // минуты
    case "h": return value * 3600;        // часы
    case "d": return value * 86400;       // дни
    case "s": return value;               // секунды
    default: return 0;
  }
}

/**
 * Вспомогательная функция для проверки прав модератора и получения цели команды.
 */
async function checkModeratorPermissionsAndGetTarget(
  ctx: Context
): Promise<{ success: boolean; targetUserId?: number; targetName?: string }> {
  if (!ctx.chat || !ctx.from) return { success: false };

  // Проверяем, что команда отправлена в группе, а не в ЛС
  if (ctx.chat.type === "private") {
    await ctx.reply("❌ Эта команда может быть использована только в группах.");
    return { success: false };
  }

  // Проверяем, является ли отправитель админом чата
  const isSenderAdmin = await isUserAdmin(ctx);
  if (!isSenderAdmin) {
    await ctx.reply("❌ У вас нет прав на использование этой команды (требуются права администратора).");
    return { success: false };
  }

  // Цель команды — пользователь, на чье сообщение ответили
  const replyMessage = ctx.message?.reply_to_message;
  if (!replyMessage || !replyMessage.from) {
    await ctx.reply("💡 Ответьте этой командой на сообщение пользователя, к которому хотите применить действие.");
    return { success: false };
  }

  const targetUser = replyMessage.from;

  // Проверяем, не является ли цель команды администратором
  const isTargetAdmin = await isUserAdmin(ctx, targetUser.id);
  if (isTargetAdmin) {
    await ctx.reply("❌ Невозможно применить модераторское действие к администратору группы.");
    return { success: false };
  }

  const targetName = targetUser.first_name + (targetUser.last_name ? ` ${targetUser.last_name}` : "");

  return {
    success: true,
    targetUserId: targetUser.id,
    targetName,
  };
}

/**
 * Обработчик команды /mute [длительность]
 * Например: `/mute 10m` или `/mute` (навсегда)
 */
export async function handleMuteCommand(ctx: Context): Promise<void> {
  const check = await checkModeratorPermissionsAndGetTarget(ctx);
  if (!check.success || !check.targetUserId || !check.targetName) return;

  // Получаем аргументы команды (длительность)
  const args = ctx.message?.text?.split(" ");
  const durationArg = args && args.length > 1 ? args[1] : undefined;
  const durationSeconds = parseDuration(durationArg);

  const durationText = durationArg ? `на ${durationArg}` : "навсегда";

  const success = await muteUser(ctx.api, ctx.chat!.id, check.targetUserId, durationSeconds);
  if (success) {
    await logAction(ctx.api, ctx.chat!.id, check.targetUserId, check.targetName, "Мут", `Мут жазасы берилди (${durationText})`, ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `🔇 Пользователь <b>${check.targetName}</b> был заглушен ${durationText}.`);
  } else {
    await ctx.reply("❌ Не удалось заглушить пользователя. Проверьте права бота.");
  }
}

/**
 * Обработчик команды /unmute
 */
export async function handleUnmuteCommand(ctx: Context): Promise<void> {
  const check = await checkModeratorPermissionsAndGetTarget(ctx);
  if (!check.success || !check.targetUserId || !check.targetName) return;

  try {
    // В Telegram "unmute" — это restrict с возвратом всех прав
    await ctx.api.restrictChatMember(ctx.chat!.id, check.targetUserId, {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    });
    await logAction(ctx.api, ctx.chat!.id, check.targetUserId, check.targetName, "Анмут", "Мут жазасы алынды (/unmute)", ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `🔊 Пользователь <b>${check.targetName}</b> разглушен.`);
  } catch (error) {
    logger.error("Ошибка при разглушении пользователя", error);
    await ctx.reply("❌ Не удалось разглушить пользователя. Проверьте права бота.");
  }
}

/**
 * Обработчик команды /ban [длительность]
 */
export async function handleBanCommand(ctx: Context): Promise<void> {
  const check = await checkModeratorPermissionsAndGetTarget(ctx);
  if (!check.success || !check.targetUserId || !check.targetName) return;

  const args = ctx.message?.text?.split(" ");
  const durationArg = args && args.length > 1 ? args[1] : undefined;
  const durationSeconds = parseDuration(durationArg);

  const durationText = durationArg ? `на ${durationArg}` : "навсегда";

  const success = await banUser(ctx.api, ctx.chat!.id, check.targetUserId, durationSeconds);
  if (success) {
    await logAction(ctx.api, ctx.chat!.id, check.targetUserId, check.targetName, "Бан", `Бан жазасы берилди (${durationText})`, ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `🚷 Пользователь <b>${check.targetName}</b> заблокирован в чате ${durationText}.`);
  } else {
    await ctx.reply("❌ Не удалось заблокировать пользователя. Проверьте права бота.");
  }
}

/**
 * Обработчик команды /unban [userID]
 * Разрешает указывать userID в качестве аргумента, так как забаненный пользователь не может писать сообщения, на которые можно ответить.
 */
export async function handleUnbanCommand(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from) return;

  if (ctx.chat.type === "private") {
    await ctx.reply("❌ Эта команда может быть использована только в группах.");
    return;
  }

  const isSenderAdmin = await isUserAdmin(ctx);
  if (!isSenderAdmin) {
    await ctx.reply("❌ У вас нет прав на использование этой команды.");
    return;
  }

  let targetUserId: number | undefined;

  // Вариант 1: Ссылка ответом на сообщение (если оно осталось)
  const replyMessage = ctx.message?.reply_to_message;
  if (replyMessage && replyMessage.from) {
    targetUserId = replyMessage.from.id;
  } else {
    // Вариант 2: Аргумент ID пользователя (например: /unban 12345678)
    const args = ctx.message?.text?.split(" ");
    if (args && args.length > 1) {
      targetUserId = parseInt(args[1], 10);
    }
  }

  if (!targetUserId || isNaN(targetUserId)) {
    await ctx.reply(
      "💡 Чтобы разблокировать пользователя:\n" +
      "1. Ответьте на его сообщение командой <code>/unban</code>\n" +
      "2. Или введите ID пользователя: <code>/unban 12345678</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  const success = await unbanUser(ctx.api, ctx.chat.id, targetUserId);
  if (success) {
    await logAction(ctx.api, ctx.chat.id, targetUserId, `Колдонуучу (${targetUserId})`, "Разбан", "Бан жазасы алынды (/unban)", ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `✅ Пользователь с ID <code>${targetUserId}</code> разблокирован.`);
  } else {
    await ctx.reply("❌ Не удалось разблокировать пользователя. Убедитесь, что ID верен и у бота есть права администратора.");
  }
}
