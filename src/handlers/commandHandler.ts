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
    await ctx.reply("❌ Бул буйрук тайпаларда гана иштейт.");
    return { success: false };
  }

  // Проверяем, является ли отправитель админом чата
  const isSenderAdmin = await isUserAdmin(ctx);
  if (!isSenderAdmin) {
    await ctx.reply("❌ Бул буйрукту колдонууга сизде укук жок. Администратор укугу талап кылынат.");
    return { success: false };
  }

  // Цель команды — пользователь, на чье сообщение ответили
  const replyMessage = ctx.message?.reply_to_message;
  if (!replyMessage || !replyMessage.from) {
    await ctx.reply("💡 Бул буйрукту колдонуучунун билдирүүсүнө жооп иретинде жазыңыз.");
    return { success: false };
  }

  const targetUser = replyMessage.from;

  // Проверяем, не является ли цель команды администратором
  const isTargetAdmin = await isUserAdmin(ctx, targetUser.id);
  if (isTargetAdmin) {
    await ctx.reply("❌ Администраторлорго карата чектөөлөрдү колдонууга болбойт.");
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

  let durationText = "";
  if (durationArg) {
    const val = parseInt(durationArg, 10);
    const unit = durationArg.slice(-1);
    if (unit === "m") durationText = `${val} мүнөткө`;
    else if (unit === "h") durationText = `${val} саатка`;
    else if (unit === "d") durationText = `${val} күнгө`;
    else if (unit === "s") durationText = `${val} секундка`;
    else durationText = `${durationArg}`;
  } else {
    durationText = "биротоло";
  }

  const success = await muteUser(ctx.api, ctx.chat!.id, check.targetUserId, durationSeconds);
  if (success) {
    await logAction(ctx.api, ctx.chat!.id, check.targetUserId, check.targetName, "Мут", `Мут жазасы берилди, мөөнөтү: ${durationText}`, ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `🔇 Колдонуучу <b>${check.targetName}</b> жазуу укугунан ажыратылды. Мөөнөтү: ${durationText}.`);
  } else {
    await ctx.reply("❌ Колдонуучуну мутка салуу мүмкүн болбоду. Боттун укуктарын текшериңиз.");
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
    await logAction(ctx.api, ctx.chat!.id, check.targetUserId, check.targetName, "Анмут", "Мут жазасы алынды", ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `🔊 Колдонуучу <b>${check.targetName}</b> жазуу укугу кайтарылды.`);
  } catch (error) {
    logger.error("Ошибка при разглушении пользователя", error);
    await ctx.reply("❌ Колдонуучуну муттон чыгаруу мүмкүн болбоду. Боттун укуктарын текшериңиз.");
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

  let durationText = "";
  if (durationArg) {
    const val = parseInt(durationArg, 10);
    const unit = durationArg.slice(-1);
    if (unit === "m") durationText = `${val} мүнөткө`;
    else if (unit === "h") durationText = `${val} саатка`;
    else if (unit === "d") durationText = `${val} күнгө`;
    else if (unit === "s") durationText = `${val} секундка`;
    else durationText = `${durationArg}`;
  } else {
    durationText = "биротоло";
  }

  const success = await banUser(ctx.api, ctx.chat!.id, check.targetUserId, durationSeconds);
  if (success) {
    await logAction(ctx.api, ctx.chat!.id, check.targetUserId, check.targetName, "Бан", `Бан жазасы берилди, мөөнөтү: ${durationText}`, ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `🚷 Колдонуучу <b>${check.targetName}</b> тайпадан бөгөттөлдү. Мөөнөтү: ${durationText}.`);
  } else {
    await ctx.reply("❌ Колдонуучуну бөгөттөө мүмкүн болбоду. Боттун укуктарын текшериңиз.");
  }
}

/**
 * Обработчик команды /unban [userID]
 * Разрешает указывать userID в качестве аргумента, так как забаненный пользователь не может писать сообщения, на которые можно ответить.
 */
export async function handleUnbanCommand(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from) return;

  if (ctx.chat.type === "private") {
    await ctx.reply("❌ Бул буйрук тайпаларда гана иштейт.");
    return;
  }

  const isSenderAdmin = await isUserAdmin(ctx);
  if (!isSenderAdmin) {
    await ctx.reply("❌ Бул буйрукту колдонууга сизде укук жок.");
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
      "💡 Колдонуучуну бөгөттөн чыгаруу үчүн:\n" +
      "1. Анын билдирүүсүнө жооп кылып <code>/unban</code> жазыңыз\n" +
      "2. Же анын ID номерин көрсөтүңүз: <code>/unban 12345678</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  const success = await unbanUser(ctx.api, ctx.chat.id, targetUserId);
  if (success) {
    await logAction(ctx.api, ctx.chat.id, targetUserId, `Колдонуучу ${targetUserId}`, "Разбан", "Бан жазасы алынды", ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `✅ Колдонуучу бөгөттөн чыгарылды. ID номери: <code>${targetUserId}</code>.`);
  } else {
    await ctx.reply("❌ Колдонуучуну бөгөттөн чыгаруу мүмкүн болбоду. ID номери туура экенин жана ботто администратор укуктары бар экенин текшериңиз.");
  }
}
