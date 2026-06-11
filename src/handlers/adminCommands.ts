import { Context } from "grammy";
import { isUserAdmin } from "../utils/telegram.js";
import { db } from "../utils/db.js";
import { getGroupConfig, updateGroupConfig } from "../utils/configManager.js";
import { logger } from "../utils/logger.js";

// Утилиты
export async function delCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const reply = ctx.message?.reply_to_message;
  if (!reply) return;
  try {
    await ctx.api.deleteMessage(ctx.chat.id, reply.message_id);
    await ctx.deleteMessage().catch(() => {});
  } catch (e) {}
}

export async function purgeCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const reply = ctx.message?.reply_to_message;
  if (!reply) {
    await ctx.reply("💡 /purge буйругун тазалоо баштала турган билдирүүгө жооп кылып жазыңыз.");
    return;
  }
  
  const startId = reply.message_id;
  const endId = ctx.message!.message_id;
  let deleted = 0;
  
  // В Telegram API нет встроенного purge, мы удаляем сообщения по одному (ограничено 100 сообщениями для безопасности)
  if (endId - startId > 100) {
    await ctx.reply("❌ Бир жолкуга 100 билдирүүдөн ашык өчүрүүгө болбойт.");
    return;
  }
  
  for (let i = startId; i <= endId; i++) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, i);
      deleted++;
    } catch (e) {
      // Игнорируем ошибки (если сообщение уже удалено)
    }
  }
  const msg = await ctx.reply(`🧹 ${deleted} билдирүү тазаланды!`);
  setTimeout(() => ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {}), 3000);
}

export async function setRulesCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const text = ctx.message?.text?.replace(/^\/setrules\s*/i, "");
  if (!text) {
    await ctx.reply("Формат: `/setrules [эрежелердин тексти]`", { parse_mode: "Markdown" });
    return;
  }
  await updateGroupConfig(ctx.chat.id, { rulesText: text });
  await ctx.reply("✅ Тайпанын эрежелери сакталды!");
}

export async function rulesCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const config = await getGroupConfig(ctx.chat.id);
  const rules = config.rulesText || "Тайпанын эрежелери азырынча орнотула элек.";
  await ctx.reply(`📜 **Тайпанын эрежелери:**\n\n${rules}`, { parse_mode: "Markdown" }).catch(async () => {
    await ctx.reply(`📜 Тайпанын эрежелери:\n\n${rules}`);
  });
}

export async function titleCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const reply = ctx.message?.reply_to_message;
  if (!reply || !reply.from) {
    await ctx.reply("Наам берүү үчүн колдонуучунун билдирүүсүнө жооп кылып /title [наам] жазыңыз.");
    return;
  }
  const title = ctx.message?.text?.replace(/^\/title\s*/i, "");
  if (!title) return;
  
  await db.set(`chat:${ctx.chat.id}:user:${reply.from.id}:title`, title);
  await ctx.reply(`🏅 [${reply.from.first_name}](tg://user?id=${reply.from.id}) эми **"${title}"** наамына ээ болду!`, { parse_mode: "Markdown" });
}

export async function meCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  const title = await db.get<string>(`chat:${ctx.chat.id}:user:${ctx.from.id}:title`);
  
  let text = `👤 **Сиздин профиль:**\n\n`;
  text += `Аты-жөнү: ${ctx.from.first_name}\n`;
  if (title) text += `🏅 Наамы: **${title}**\n`;
  
  await ctx.reply(text, { parse_mode: "Markdown" });
}

export async function reportCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const reply = ctx.message?.reply_to_message;
  if (!reply || !reply.from) {
    await ctx.reply("Даттануу үчүн тартип бузган адамдын билдирүүсүнө жооп кылып /report жазыңыз.");
    return;
  }
  
  try {
    const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
    let mentions = "";
    for (const admin of admins) {
      if (!admin.user.is_bot) {
        mentions += `[${admin.user.first_name}](tg://user?id=${admin.user.id}) `;
      }
    }
    await ctx.reply(`🚨 **Админдер чакырылды!**\n\n${mentions}`, { parse_mode: "Markdown" });
  } catch (e) {
    logger.error("Error in report", e);
  }
}

export async function antifloodCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const parts = ctx.message?.text?.split(" ") || [];
  if (parts.length < 3) {
    await ctx.reply("Формат: `/antiflood [билдирүүлөр] [секунд]`\nМисалы: `/antiflood 5 10` (10 секундда 5 билдирүү)", { parse_mode: "Markdown" });
    return;
  }
  const msgs = parseInt(parts[1], 10);
  const secs = parseInt(parts[2], 10);
  
  if (isNaN(msgs) || isNaN(secs)) return;
  
  const config = await getGroupConfig(ctx.chat.id);
  config.antiflood = { 
    enabled: true, 
    messages: msgs, 
    seconds: secs, 
    action: config.antiflood?.action || "mute" 
  };
  await updateGroupConfig(ctx.chat.id, { antiflood: config.antiflood });
  await ctx.reply(`✅ Антифлуд иштетилди: ${secs} секунд ичинде ${msgs} билдирүү лимити коюлду.`);
}

// Blacklist
export async function blacklistCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const word = ctx.message?.text?.replace(/^\/blacklist\s*/i, "").toLowerCase();
  if (!word) return;
  
  await db.hset(`chat:${ctx.chat.id}:blacklist`, word, "1");
  await ctx.reply(`🚫 "${word}" сөзү кара тизмеге кирди.`);
}

export async function unblacklistCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const word = ctx.message?.text?.replace(/^\/unblacklist\s*/i, "").toLowerCase();
  if (!word) return;
  
  await db.hdel(`chat:${ctx.chat.id}:blacklist`, word);
  await ctx.reply(`✅ "${word}" сөзү кара тизмеден чыгарылды.`);
}

// Welcome module
export async function welcomeConfigCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const text = ctx.message?.text?.replace(/^\/welcome\s*/i, "");
  if (!text) {
    await ctx.reply("Формат: `/welcome [саламдашуу тексти]`\nСиз `{name}` деген өзгөрмөнү колдонсоңуз болот.", { parse_mode: "Markdown" });
    return;
  }
  
  const config = await getGroupConfig(ctx.chat.id);
  if (text.toLowerCase() === "on") {
    config.welcome.enabled = true;
    await updateGroupConfig(ctx.chat.id, { welcome: config.welcome });
    await ctx.reply("✅ Саламдашуу күйгүзүлдү.");
  } else if (text.toLowerCase() === "off") {
    config.welcome.enabled = false;
    await updateGroupConfig(ctx.chat.id, { welcome: config.welcome });
    await ctx.reply("❌ Саламдашуу өчүрүлдү.");
  } else {
    config.welcome.text = text;
    config.welcome.enabled = true;
    await updateGroupConfig(ctx.chat.id, { welcome: config.welcome });
    await ctx.reply("✅ Саламдашуу тексти сакталды жана күйгүзүлдү.");
  }
}
