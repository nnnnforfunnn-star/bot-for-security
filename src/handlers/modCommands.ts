import { Context } from "grammy";
import { isUserAdmin, banUser, unbanUser } from "../utils/telegram.js";
import { db } from "../utils/db.js";
import { logger } from "../utils/logger.js";

// Helper function to extract user target from reply
async function getTargetUser(ctx: Context) {
  const replyMessage = ctx.message?.reply_to_message;
  if (!replyMessage || !replyMessage.from) {
    await ctx.reply("💡 Бул буйрукту колдонуучунун билдирүүсүнө жооп (reply) кылып жазыңыз.", { parse_mode: "Markdown" });
    return null;
  }
  return replyMessage.from;
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
    await ctx.reply(`👢 **${name}** тайпадан чыгарылды (Kick).`, { parse_mode: "Markdown" });
  } catch (e) {
    await ctx.reply("Ката кетти. Боттун укуктарын текшериңиз.");
  }
}

export async function pinCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const msg = ctx.message?.reply_to_message;
  if (!msg) {
    await ctx.reply("💡 Бекемдөө үчүн билдирүүгө жооп кылып /pin жазыңыз.");
    return;
  }
  
  try {
    await ctx.api.pinChatMessage(ctx.chat.id, msg.message_id);
    await ctx.reply("📌 Билдирүү бекемделди (Pinned)!");
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
    await ctx.reply("📌 Бекемдөө алынды.");
  } catch (e) {
    await ctx.reply("Ката кетти.");
  }
}

export async function warnCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTargetUser(ctx);
  if (!target) return;
  if (await isUserAdmin(ctx, target.id)) return;

  const warnKey = `chat:${ctx.chat.id}:user:${target.id}:warns`;
  const warns = await db.incr(warnKey);
  await ctx.reply(`⚠️ **Эскертүү!** ${target.first_name}, сизге эскертүү берилди. Жалпы эскертүүлөр: ${warns}`, { parse_mode: "Markdown" });
}

export async function unwarnCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTargetUser(ctx);
  if (!target) return;

  const warnKey = `chat:${ctx.chat.id}:user:${target.id}:warns`;
  let warns = (await db.get<number>(warnKey)) || 0;
  if (warns > 0) {
    warns -= 1;
    await db.set(warnKey, warns);
  }
  await ctx.reply(`✅ **Эскертүү алынды!** ${target.first_name}, сиздин калган эскертүүлөрүңүз: ${warns}`, { parse_mode: "Markdown" });
}

export async function warnsCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const target = (await getTargetUser(ctx)) || ctx.from;
  if (!target) return;

  const warnKey = `chat:${ctx.chat.id}:user:${target.id}:warns`;
  const warns = (await db.get<number>(warnKey)) || 0;
  await ctx.reply(`📊 ${target.first_name} аттуу колдонуучунун эскертүүлөрү: **${warns}**`, { parse_mode: "Markdown" });
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
