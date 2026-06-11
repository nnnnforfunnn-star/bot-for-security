import { Context } from "grammy";
import { isUserAdmin, banUser, unbanUser } from "../utils/telegram.js";
import { db } from "../utils/db.js";
import { logger } from "../utils/logger.js";
import { getGroupConfig } from "../utils/configManager.js";
import { logAction } from "../utils/actionLogger.js";

// Helper function to extract user target from reply
async function getTargetUser(ctx: Context) {
  const replyMessage = ctx.message?.reply_to_message;
  if (!replyMessage || !replyMessage.from) {
    await ctx.reply("💡 Бул буйрукту колдонуучунун билдирүүсүнө жооп (reply) кылып жазыңыз.", { parse_mode: "Markdown" });
    return null;
  }
  return replyMessage.from;
}

// Helper to reply or silence based on config
async function replyMaybeSilent(ctx: Context, text: string) {
  if (!ctx.chat) return;
  const config = await getGroupConfig(ctx.chat.id);
  if (config.silentMode) {
    await ctx.deleteMessage().catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: "Markdown" });
  }
}

export async function kickCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTargetUser(ctx);
  if (!target) return;
  
  if (await isUserAdmin(ctx, target.id)) {
    await ctx.reply("❌ Админдерди тайпадан чыгарууга болбойт.");
    return;
  }

  try {
    await ctx.api.banChatMember(ctx.chat.id, target.id);
    await ctx.api.unbanChatMember(ctx.chat.id, target.id); // Kick = ban + unban
    const name = target.first_name || "Колдонуучу";
    await logAction(ctx.api, ctx.chat.id, target.id, name, "Кик", "Чаттан чыгарылды (/kick)", ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `👢 **${name}** тайпадан чыгарылды.`);
  } catch (e) {
    await ctx.reply("Ката кетти. Боттун укуктарын текшериңиз.");
  }
}

export async function pinCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const msg = ctx.message?.reply_to_message;
  if (!msg) {
    await ctx.reply("💡 Bekemdөө үчүн билдирүүгө жооп кылып /pin жазыңыз.");
    return;
  }
  
  try {
    await ctx.api.pinChatMessage(ctx.chat.id, msg.message_id);
    await replyMaybeSilent(ctx, "📌 Билдирүү бекемделди!");
  } catch (e) {
    await ctx.reply("Ката кетти. Укуктарды текшериңиз.");
  }
}

export async function unpinCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const msg = ctx.message?.reply_to_message;
  try {
    if (msg) {
      await ctx.api.unpinChatMessage(ctx.chat.id, msg.message_id);
    } else {
      await ctx.api.unpinAllChatMessages(ctx.chat.id);
    }
    await replyMaybeSilent(ctx, "📌 Бекемдөө алынды.");
  } catch (e) {
    await ctx.reply("Ката кетти.");
  }
}

export async function warnCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTargetUser(ctx);
  if (!target) return;
  if (await isUserAdmin(ctx, target.id)) {
    await ctx.reply("❌ Админдерге эскертүү берүүгө болбойт.");
    return;
  }

  const config = await getGroupConfig(ctx.chat.id);
  const warnKey = `chat:${ctx.chat.id}:user:${target.id}:warns`;
  const warns = await db.incr(warnKey);

  if (config.warnExpireDays && config.warnExpireDays > 0) {
    await db.expire(warnKey, config.warnExpireDays * 86400).catch(() => {});
  }

  if (warns >= config.warnLimit) {
    await db.del(warnKey); // reset warns
    const actionName = config.warnAction || "mute";
    const name = target.first_name || "Колдонуучу";

    if (actionName === "ban") {
      await ctx.api.banChatMember(ctx.chat.id, target.id);
      await logAction(ctx.api, ctx.chat.id, target.id, name, "Бан", `Эскертүү лимити толду (${config.warnLimit})`, ctx.from?.first_name || "Бот");
      await replyMaybeSilent(ctx, `🚷 **${name}** эскертүү лимити толгондуктан бөгөттөлдү. Чек: ${config.warnLimit}.`);
    } else if (actionName === "kick") {
      await ctx.api.banChatMember(ctx.chat.id, target.id);
      await ctx.api.unbanChatMember(ctx.chat.id, target.id);
      await logAction(ctx.api, ctx.chat.id, target.id, name, "Кик", `Эскертүү лимити толду (${config.warnLimit})`, ctx.from?.first_name || "Бот");
      await replyMaybeSilent(ctx, `👢 **${name}** эскертүү лимити толгондуктан тайпадан чыгарылды. Чек: ${config.warnLimit}.`);
    } else {
      // mute
      const duration = 24 * 60 * 60; // 24 hours default
      await ctx.api.restrictChatMember(ctx.chat.id, target.id, {
        can_send_messages: false, can_send_audios: false, can_send_documents: false,
        can_send_photos: false, can_send_videos: false, can_send_video_notes: false,
        can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false,
        can_add_web_page_previews: false,
      }, { until_date: Math.floor(Date.now() / 1000) + duration });
      await logAction(ctx.api, ctx.chat.id, target.id, name, "Мут", `Эскертүү лимити толду (${config.warnLimit})`, ctx.from?.first_name || "Бот");
      await replyMaybeSilent(ctx, `🔇 **${name}** эскертүү лимити толгондуктан 24 саатка мутка салынды. Чек: ${config.warnLimit}.`);
    }
  } else {
    const name = target.first_name || "Колдонуучу";
    await logAction(ctx.api, ctx.chat.id, target.id, name, "Эскертүү", `Эскертүү берилди (${warns}/${config.warnLimit})`, ctx.from?.first_name || "Админ");
    await replyMaybeSilent(ctx, `⚠️ **Эскертүү!** ${name}, сизге эскертүү берилди. Жалпы эскертүүлөр: **${warns}/${config.warnLimit}**`);
  }
}

export async function unwarnCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTargetUser(ctx);
  if (!target) return;

  const config = await getGroupConfig(ctx.chat.id);
  const warnKey = `chat:${ctx.chat.id}:user:${target.id}:warns`;
  let warns = (await db.get<number>(warnKey)) || 0;
  if (warns > 0) {
    warns -= 1;
    await db.set(warnKey, warns);
  }
  const name = target.first_name || "Колдонуучу";
  await logAction(ctx.api, ctx.chat.id, target.id, name, "Эскертүүнү Алуу", "Эскертүү саны азайтылды", ctx.from?.first_name || "Админ");
  await replyMaybeSilent(ctx, `✅ **Эскертүү алынды!** ${name}, сиздин калган эскертүүлөрүңүз: **${warns}/${config.warnLimit}**`);
}

export async function warnsCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const target = (await getTargetUser(ctx)) || ctx.from;
  if (!target) return;

  const config = await getGroupConfig(ctx.chat.id);
  const warnKey = `chat:${ctx.chat.id}:user:${target.id}:warns`;
  const warns = (await db.get<number>(warnKey)) || 0;
  await ctx.reply(`📊 ${target.first_name} аттуу колдонуучунун эскертүүлөрү: **${warns}/${config.warnLimit}**`, { parse_mode: "Markdown" });
}

export async function idCommand(ctx: Context) {
  const reply = ctx.message?.reply_to_message;
  if (!ctx.chat || ctx.chat.type === "private") return;
  let text = `🆔 **Сиздин ID:** \`${ctx.from?.id}\`\n`;
  text += `🆔 **Тайпа ID:** \`${ctx.chat.id}\`\n`;
  if (reply && reply.from) {
    text += `🆔 **${reply.from.first_name} ID:** \`${reply.from.id}\`\n`;
  }
  await ctx.reply(text, { parse_mode: "Markdown" });
}

// 12. /kickme — Өзүн тайпадан чыгаруу
export async function kickmeCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  if (await isUserAdmin(ctx, ctx.from.id)) {
    await ctx.reply("❌ Сиз администраторсуз, өзүңүздү кик кыла албайсыз.");
    return;
  }
  try {
    await ctx.api.banChatMember(ctx.chat.id, ctx.from.id);
    await ctx.api.unbanChatMember(ctx.chat.id, ctx.from.id);
    await ctx.reply(`👢 **${ctx.from.first_name}** өз каалоосу менен тайпадан чыкты.`);
  } catch (e) {}
}

// 13. /muteall — Тайпада жазууну толук бөгөттөө
export async function muteallCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  try {
    await ctx.api.setChatPermissions(ctx.chat.id, {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false
    });
    await logAction(ctx.api, ctx.chat.id, 0, "Группа", "Muteall", "Группа жабылды (/muteall)", ctx.from?.first_name || "Админ");
    await ctx.reply("🔇 **Тайпада жазуу толук бөгөттөлдү!**\nАдминистраторлордон башка эч ким билдирүү жөнөтө албайт.", { parse_mode: "Markdown" });
  } catch (e) {
    await ctx.reply("❌ Чаттын укуктарын өзгөртүү мүмкүн болбоду.");
  }
}

// 14. /unmuteall — Бөгөттү алуу
export async function unmuteallCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  try {
    await ctx.api.setChatPermissions(ctx.chat.id, {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true
    });
    await logAction(ctx.api, ctx.chat.id, 0, "Группа", "Unmuteall", "Группа ачылды (/unmuteall)", ctx.from?.first_name || "Админ");
    await ctx.reply("🔊 **Тайпа толугу менен ачылды!**\nЭми бардык колдонуучулар жаза алышат.", { parse_mode: "Markdown" });
  } catch (e) {
    await ctx.reply("❌ Чаттын укуктарын өзгөртүү мүмкүн болбоду.");
  }
}

// 15. /zombies — Өчүрүлгөн аккаунттарды тазалоо
export async function zombiesCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ") || [];
  const cleanMode = args[1] === "clean" || args[1] === "тазалоо";

  await ctx.reply("🔍 Тайпадагы өчүрүлгөн аккаунттарды издөө башталды... Күтө туруңуз.");

  try {
    const userIds = await db.smembers(`chat:${ctx.chat.id}:users`);
    let zombieCount = 0;
    let kickedCount = 0;
    
    for (const uidStr of userIds) {
      const uid = parseInt(uidStr, 10);
      try {
        const member = await ctx.api.getChatMember(ctx.chat.id, uid);
        if (member.status === "left" || member.status === "kicked") continue;
        
        if (member.user.first_name === "" || member.user.first_name === "Deleted Account" || !member.user.first_name) {
          zombieCount++;
          if (cleanMode) {
            await ctx.api.banChatMember(ctx.chat.id, uid).catch(() => {});
            await ctx.api.unbanChatMember(ctx.chat.id, uid).catch(() => {});
            await db.srem(`chat:${ctx.chat.id}:users`, uidStr);
            kickedCount++;
          }
        }
      } catch (e) {}
    }

    if (cleanMode) {
      await ctx.reply(`🧹 **Тазалоо аяктады!**\nТайпадан **${kickedCount}** өчүрүлгөн аккаунт чыгарылды.`);
    } else {
      await ctx.reply(`📊 **Издөө аяктады!**\nТайпада **${zombieCount}** өчүрүлгөн аккаунт аныкталды.\n\nАларды тазалоо үчүн \`/zombies clean\` буйругун колдонуңуз.`, { parse_mode: "Markdown" });
    }
  } catch (e) {
    await ctx.reply("❌ Издөө учурунда ката кетти.");
  }
}
