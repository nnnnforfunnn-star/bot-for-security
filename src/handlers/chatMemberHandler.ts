import { Context, NextFunction } from "grammy";
import { logger } from "../utils/logger.js";
import { logAction } from "../utils/actionLogger.js";

export async function chatMemberUpdateHandler(ctx: Context, next: NextFunction) {
  try {
    const update = ctx.chatMember;
    if (!update || !ctx.chat || ctx.chat.type === "private") {
      return next();
    }

    const chatId = ctx.chat.id;
    const actor = update.from;
    const target = update.new_chat_member.user;

    // Ignore self-actions to prevent double logging
    if (actor.id === ctx.me.id) {
      return next();
    }

    const oldStatus = update.old_chat_member.status;
    const newStatus = update.new_chat_member.status;

    // We only care if the status has actually changed
    if (oldStatus === newStatus) {
      // Check if rights changed for restricted users (mute/unmute)
      if (oldStatus === "restricted" && newStatus === "restricted") {
        const oldRestricted = update.old_chat_member as any;
        const newRestricted = update.new_chat_member as any;
        const wasMuted = !oldRestricted.can_send_messages;
        const isMuted = !newRestricted.can_send_messages;

        if (wasMuted !== isMuted) {
          const actorName = actor.first_name || "Администратор";
          const targetName = target.first_name || "Колдонуучу";
          
          if (isMuted) {
            await logAction(ctx.api, chatId, target.id, targetName, "Мут", "Башка бот же Telegram аркылуу мутталды", actorName);
          } else {
            await logAction(ctx.api, chatId, target.id, targetName, "Мутту алуу", "Башка бот же Telegram аркылуу муту алынды", actorName);
          }
        }
      }
      return next();
    }

    const actorName = actor.first_name || "Администратор";
    const targetName = target.first_name || "Колдонуучу";

    // 1. BAN / UNBAN
    if (newStatus === "kicked") {
      await logAction(ctx.api, chatId, target.id, targetName, "Бан", "Башка бот же Telegram аркылуу бөгөттөлдү", actorName);
    } else if (oldStatus === "kicked" && (newStatus === "left" || newStatus === "member")) {
      await logAction(ctx.api, chatId, target.id, targetName, "Бөгөттөн чыгаруу", "Башка бот же Telegram аркылуу бөгөттөн чыгарылды", actorName);
    }
    // 2. MUTE / UNMUTE (Transition to/from restricted)
    else if (newStatus === "restricted") {
      const newRestricted = update.new_chat_member as any;
      if (!newRestricted.can_send_messages) {
        await logAction(ctx.api, chatId, target.id, targetName, "Мут", "Башка бот же Telegram аркылуу мутталды", actorName);
      }
    } else if (oldStatus === "restricted" && (newStatus === "member" || newStatus === "administrator")) {
      const oldRestricted = update.old_chat_member as any;
      if (!oldRestricted.can_send_messages) {
        await logAction(ctx.api, chatId, target.id, targetName, "Мутту алуу", "Башка бот же Telegram аркылуу муту алынды", actorName);
      }
    }
    // 3. PROMOTE / DEMOTE
    else if (newStatus === "administrator" && oldStatus !== "creator") {
      await logAction(ctx.api, chatId, target.id, targetName, "Promote", "Башка бот же Telegram аркылуу админ кылынды", actorName);
    } else if (oldStatus === "administrator" && newStatus !== "creator") {
      await logAction(ctx.api, chatId, target.id, targetName, "Demote", "Башка бот же Telegram аркылуу укугу алынды", actorName);
    }
  } catch (err) {
    logger.error("Error in chatMemberUpdateHandler:", err);
  }
  return next();
}
