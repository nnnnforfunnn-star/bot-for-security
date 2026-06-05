import { Context } from "grammy";
import { db } from "../utils/db.js";
import { isUserAdminInChat } from "../utils/telegram.js";

// /save [name] [text]
export async function saveNoteCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  
  const isAdmin = await isUserAdminInChat(ctx.api, ctx.chat.id, ctx.from.id);
  if (!isAdmin) return;

  const match = ctx.message?.text?.match(/^\/save\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (!match) {
    await ctx.reply("Формат: `/save [аталышы] [текст]` же билдирүүгө reply кылып `/save [аталышы]`", { parse_mode: "Markdown" });
    return;
  }

  const name = match[1].toLowerCase();
  let text = match[2];

  if (!text && ctx.message?.reply_to_message?.text) {
    text = ctx.message.reply_to_message.text;
  } else if (!text && ctx.message?.reply_to_message?.caption) {
    text = ctx.message.reply_to_message.caption;
  }

  if (!text) {
    await ctx.reply("Сактоо үчүн текст табылган жок.");
    return;
  }

  await db.hset(`chat:${ctx.chat.id}:notes`, name, text);
  await ctx.reply(`✅ **${name}** белгиси (заметка) ийгиликтүү сакталды!\nАлуу үчүн: \`#${name}\` же \`/get ${name}\``, { parse_mode: "Markdown" });
}

// /get [name] or #name
export async function getNoteCommand(ctx: Context, isHashtag: boolean = false) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  
  let name = "";
  if (isHashtag) {
    const match = ctx.message?.text?.match(/^#(\S+)/);
    if (match) name = match[1].toLowerCase();
  } else {
    const match = ctx.message?.text?.match(/^\/get\s+(\S+)/i);
    if (match) name = match[1].toLowerCase();
  }

  if (!name) return;

  const notes = await db.hgetall(`chat:${ctx.chat.id}:notes`);
  if (notes && notes[name]) {
    await ctx.reply(notes[name]);
  } else if (!isHashtag) {
    // Reply only if it was explicit /get
    await ctx.reply(`❌ **${name}** белгиси табылган жок.`, { parse_mode: "Markdown" });
  }
}

// /clear [name]
export async function clearNoteCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) return;
  
  const isAdmin = await isUserAdminInChat(ctx.api, ctx.chat.id, ctx.from.id);
  if (!isAdmin) return;

  const match = ctx.message?.text?.match(/^\/clear\s+(\S+)/i);
  if (!match) {
    await ctx.reply("Формат: `/clear [аталышы]`", { parse_mode: "Markdown" });
    return;
  }

  const name = match[1].toLowerCase();
  const notes = await db.hgetall(`chat:${ctx.chat.id}:notes`);
  if (notes && notes[name]) {
    delete notes[name];
    await db.del(`chat:${ctx.chat.id}:notes`); // clear hash
    // Restore remaining
    for (const k of Object.keys(notes)) {
      await db.hset(`chat:${ctx.chat.id}:notes`, k, notes[k]);
    }
    await ctx.reply(`✅ **${name}** белгиси өчүрүлдү.`, { parse_mode: "Markdown" });
  } else {
    await ctx.reply(`❌ **${name}** белгиси табылган жок.`, { parse_mode: "Markdown" });
  }
}

// /notes
export async function notesListCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  
  const notes = await db.hgetall(`chat:${ctx.chat.id}:notes`);
  if (!notes || Object.keys(notes).length === 0) {
    await ctx.reply("Тайпада белгилер (заметка) жок.");
    return;
  }

  let text = "📝 **Тайпадагы белгилер:**\n\n";
  for (const k of Object.keys(notes)) {
    text += `- \`#${k}\`\n`;
  }
  await ctx.reply(text, { parse_mode: "Markdown" });
}
