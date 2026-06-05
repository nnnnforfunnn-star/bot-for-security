import { Context } from "grammy";
import { db } from "../utils/db.js";
import { isUserAdmin } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";

/**
 * Команда /filter [сөз] [жооп]
 * Добавляет автоответ на определенное слово.
 */
export async function filterCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  if (!(await isUserAdmin(ctx))) {
    await ctx.reply("Бул буйрукту админдер гана колдоно алат.");
    return;
  }

  const text = ctx.message?.text || "";
  const parts = text.split(" ");
  if (parts.length < 3) {
    await ctx.reply("Формат: `/filter [сөз] [жооп]`\nМисалы: `/filter салам Алейкум салам!`", { parse_mode: "Markdown" });
    return;
  }

  const word = parts[1].toLowerCase();
  const response = parts.slice(2).join(" ");
  
  try {
    await db.hset(`chat:${ctx.chat.id}:filters`, word, response);
    await ctx.reply(`✅ «${word}» сөзүнө автожооп сакталды!`);
  } catch (e) {
    logger.error("Ошибка при сохранении фильтра", e);
    await ctx.reply("Ката кетти.");
  }
}

/**
 * Команда /stop [сөз]
 * Удаляет автоответ.
 */
export async function stopFilterCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  if (!(await isUserAdmin(ctx))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(" ");
  if (parts.length < 2) {
    await ctx.reply("Формат: `/stop [сөз]`\nМисалы: `/stop салам`", { parse_mode: "Markdown" });
    return;
  }

  const word = parts[1].toLowerCase();
  try {
    await db.hdel(`chat:${ctx.chat.id}:filters`, word);
    await ctx.reply(`🗑️ «${word}» сөзүнө болгон автожооп өчүрүлдү.`);
  } catch (e) {
    await ctx.reply("Ката кетти.");
  }
}

/**
 * Команда /filters
 * Показывает список всех активных автоответов.
 */
export async function filtersListCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;

  try {
    const filters = await db.hgetall(`chat:${ctx.chat.id}:filters`);
    if (!filters || Object.keys(filters).length === 0) {
      await ctx.reply("Тайпада азырынча автожооптор (фильтрлер) жок.");
      return;
    }

    let text = "📋 **Тайпанын автожооптору:**\n\n";
    for (const word of Object.keys(filters)) {
      text += `• \`${word}\`\n`;
    }
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (e) {
    await ctx.reply("Ката кетти.");
  }
}
