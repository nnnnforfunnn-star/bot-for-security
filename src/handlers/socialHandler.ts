import { Context } from "grammy";
import { db } from "../utils/db.js";

// Никнеймы
export async function setNickCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  const text = ctx.message?.text?.replace(/^(\+ник|\/setnick)\s*/i, "");
  if (!text) {
    await ctx.reply("Формат: `+ник [жаңы ник]`", { parse_mode: "Markdown" });
    return;
  }
  
  await db.set(`chat:${ctx.chat.id}:user:${ctx.from.id}:nick`, text);
  await ctx.reply(`✅ [${ctx.from.first_name}](tg://user?id=${ctx.from.id}) эми тайпада **"${text}"** деп аталат.`, { parse_mode: "Markdown" });
}

export async function removeNickCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  await db.del(`chat:${ctx.chat.id}:user:${ctx.from.id}:nick`);
  await ctx.reply(`✅ Ник өчүрүлдү.`);
}

export async function nickCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  const targetUser = ctx.message?.reply_to_message?.from || ctx.from;
  const nick = await db.get<string>(`chat:${ctx.chat.id}:user:${targetUser.id}:nick`);
  
  if (nick) {
    await ctx.reply(`👤 [${targetUser.first_name}](tg://user?id=${targetUser.id}) аттуу колдонуучунун ниги: **${nick}**`, { parse_mode: "Markdown" });
  } else {
    await ctx.reply(`👤 [${targetUser.first_name}](tg://user?id=${targetUser.id}) аттуу колдонуучуда ник жок.`, { parse_mode: "Markdown" });
  }
}

// Девиз
export async function setDevizCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  const text = ctx.message?.text?.replace(/^(\+девиз|\/setdeviz)\s*/i, "");
  if (!text) return;
  await db.set(`chat:${ctx.chat.id}:user:${ctx.from.id}:deviz`, text);
  await ctx.reply(`✅ Девиз сакталды: **${text}**`, { parse_mode: "Markdown" });
}

export async function removeDevizCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  await db.del(`chat:${ctx.chat.id}:user:${ctx.from.id}:deviz`);
  await ctx.reply(`✅ Девиз өчүрүлдү.`);
}

// Профиль (Кто я)
export async function profileCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  const targetUser = ctx.message?.reply_to_message?.from || ctx.from;
  
  const nick = await db.get<string>(`chat:${ctx.chat.id}:user:${targetUser.id}:nick`);
  const title = await db.get<string>(`chat:${ctx.chat.id}:user:${targetUser.id}:title`);
  const deviz = await db.get<string>(`chat:${ctx.chat.id}:user:${targetUser.id}:deviz`);
  const urmat = (await db.get<number>(`chat:${ctx.chat.id}:user:${targetUser.id}:urmat`)) || 0;
  const warns = (await db.get<number>(`chat:${ctx.chat.id}:user:${targetUser.id}:warns`)) || 0;
  
  let text = `👤 **Профиль: [${targetUser.first_name}](tg://user?id=${targetUser.id})**\n\n`;
  if (nick) text += `🏷 Ник: **${nick}**\n`;
  if (title) text += `🏅 Наам: **${title}**\n`;
  if (deviz) text += `💬 Девиз: _"${deviz}"_\n`;
  text += `🌟 Сый-Урмат: **${urmat}**\n`;
  text += `⚠️ Эскертүүлөр: **${warns}**\n`;
  
  await ctx.reply(text, { parse_mode: "Markdown" });
}

// Шипперинг
export async function shipCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  
  try {
    const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
    if (admins.length > 1) {
      const u1 = admins[Math.floor(Math.random() * admins.length)].user;
      let u2 = admins[Math.floor(Math.random() * admins.length)].user;
      while (u1.id === u2.id) {
        u2 = admins[Math.floor(Math.random() * admins.length)].user;
      }
      await ctx.reply(`💕 **Бүгүнкү түгөйлөр:**\n[${u1.first_name}](tg://user?id=${u1.id}) + [${u2.first_name}](tg://user?id=${u2.id}) = ❤️`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(`Жок дегенде 2 адам болушу керек!`);
    }
  } catch (e) {}
}

// Погода (stub)
export async function weatherCommand(ctx: Context) {
  const city = ctx.message?.text?.replace(/^(!погода|\/weather)\s*/i, "");
  if (!city) {
    await ctx.reply("Шаарды жазыңыз. Мисалы: `!погода Бишкек`", { parse_mode: "Markdown" });
    return;
  }
  await ctx.reply(`☀️ **${city}** шаарындагы аба ырайы:\nБүгүн ачык, +25°C. Жакшы күн! (Бул демо-режим)`);
}
