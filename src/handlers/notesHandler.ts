import { Context, InlineKeyboard } from "grammy";
import { db } from "../utils/db.js";
import { isUserAdminInChat, formatMessageToHtml } from "../utils/telegram.js";

// Helper to reply with notes/filters that might contain JSON configuration
async function replyWithStructuredContent(ctx: Context, content: string) {
  let text = content;
  let keyboard: InlineKeyboard | undefined = undefined;

  try {
    if (content.startsWith("{") && content.endsWith("}")) {
      const parsed = JSON.parse(content);
      text = parsed.text || "";
      
      const kb = new InlineKeyboard();
      let hasButtons = false;

      if (Array.isArray(parsed.buttons)) {
        for (const btn of parsed.buttons) {
          if (btn.text && btn.url) {
            kb.url(btn.text, btn.url).row();
            hasButtons = true;
          }
        }
      } else if (parsed.buttonText && parsed.buttonUrl) {
        kb.url(parsed.buttonText, parsed.buttonUrl);
        hasButtons = true;
      }

      if (hasButtons) {
        keyboard = kb;
      }
    }
  } catch (e) {
    // Treat as plain text
  }

  const formattedText = formatMessageToHtml(text);

  await ctx.reply(formattedText, {
    reply_markup: keyboard,
    parse_mode: "HTML"
  }).catch(async (err) => {
    // Fallback if HTML parse fails (e.g. unclosed tags)
    await ctx.reply(text, {
      reply_markup: keyboard
    }).catch(() => {});
  });
}

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
  
  const notes = await db.hgetall(`chat:${ctx.chat.id}:notes`);
  if (!notes) return;

  if (isHashtag) {
    const words = (ctx.message?.text || ctx.message?.caption || "").split(/\s+/);
    for (const w of words) {
      if (w.startsWith("#")) {
        const name = w.substring(1).toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
        if (notes[name]) {
          await replyWithStructuredContent(ctx, notes[name]);
          return;
        }
      }
    }
  } else {
    const match = ctx.message?.text?.match(/^\/get\s+(\S+)/i);
    if (match) {
      const name = match[1].toLowerCase();
      if (notes[name]) {
        await replyWithStructuredContent(ctx, notes[name]);
      } else {
        await ctx.reply(`❌ **${name}** белгиси табылган жок.`, { parse_mode: "Markdown" });
      }
    }
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
