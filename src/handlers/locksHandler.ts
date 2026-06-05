import { Context } from "grammy";
import { isUserAdmin } from "../utils/telegram.js";
import { getGroupConfig, updateGroupConfig } from "../utils/configManager.js";

const LOCK_TYPES = [
  "links", "forwards", "bots", "media", "stickers", "gifs", "voices", "arabic", "porn"
] as const;

type LockType = typeof LOCK_TYPES[number];

export async function lockCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const parts = ctx.message?.text?.split(" ") || [];
  if (parts.length < 2) {
    await ctx.reply("Формат: `/lock [түрү]`\nТүрлөрү: " + LOCK_TYPES.join(", "), { parse_mode: "Markdown" });
    return;
  }
  
  const type = parts[1].toLowerCase() as LockType;
  if (!LOCK_TYPES.includes(type)) {
    await ctx.reply(`❌ Ката түрү. Түрлөрү: ${LOCK_TYPES.join(", ")}`);
    return;
  }

  const config = await getGroupConfig(ctx.chat.id);
  config.locks[type] = true;
  await updateGroupConfig(ctx.chat.id, { locks: config.locks });
  await ctx.reply(`🔒 **${type}** ийгиликтүү бөгөттөлдү. Бот эми аларды дароо өчүрөт.`, { parse_mode: "Markdown" });
}

export async function unlockCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const parts = ctx.message?.text?.split(" ") || [];
  if (parts.length < 2) {
    await ctx.reply("Формат: `/unlock [түрү]`");
    return;
  }
  
  const type = parts[1].toLowerCase() as LockType;
  if (!LOCK_TYPES.includes(type)) {
    await ctx.reply(`❌ Ката түрү. Түрлөрү: ${LOCK_TYPES.join(", ")}`);
    return;
  }

  const config = await getGroupConfig(ctx.chat.id);
  config.locks[type] = false;
  await updateGroupConfig(ctx.chat.id, { locks: config.locks });
  await ctx.reply(`🔓 **${type}** бөгөттөн чыгарылды.`, { parse_mode: "Markdown" });
}

export async function locksListCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const config = await getGroupConfig(ctx.chat.id);
  
  let text = "🔒 **Тайпадагы бөгөттөөлөр (Locks):**\n\n";
  for (const type of LOCK_TYPES) {
    text += `• ${type}: ${config.locks[type] ? "❌ Жабык" : "✅ Ачык"}\n`;
  }
  
  await ctx.reply(text, { parse_mode: "Markdown" });
}
