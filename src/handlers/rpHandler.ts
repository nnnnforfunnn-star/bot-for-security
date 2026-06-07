import { Context } from "grammy";
import { db } from "../utils/db.js";

// РП Действия (Русский, Кыргызча, English)
const RP_ACTIONS_MAP: Record<string, string> = {
  // Обнять
  "обнять": "кучактады",
  "кучакта": "кучактады",
  "кучактады": "кучактады",
  "hug": "кучактады",
  // Поцеловать
  "поцеловать": "өптү",
  "өп": "өптү",
  "өптү": "өптү",
  "kiss": "өптү",
  // Ударить
  "ударить": "урду",
  "ур": "урду",
  "урду": "урду",
  "slap": "урду",
  // Укусить
  "укусить": "тиштеди",
  "тиште": "тиштеди",
  "тиштеди": "тиштеди",
  "bite": "тиштеди",
  // Убить
  "убить": "өлтүрдү",
  "өлтүр": "өлтүрдү",
  "өлтүрдү": "өлтүрдү",
  "kill": "өлтүрдү",
  // Дать пять
  "дать пять": "беш берди",
  "беш бер": "беш берди",
  "highfive": "беш берди",
  // Погладить
  "погладить": "сылады",
  "сыла": "сылады",
  "сылады": "сылады",
  "pat": "сылады",
  // Пнуть
  "пнуть": "тепти",
  "теп": "тепти",
  "тепти": "тепти",
  "kickrp": "тепти",
  // Расстрелять
  "расстрелять": "атып салды",
  "ат": "атып салды",
  "атып салды": "атып салды",
  "shoot": "атып салды",
  // Эркелетуу
  "эркелет": "эркелетти",
  "cuddle": "эркелетти",
  // Колдоо
  "колдоо": "колдоп койду",
  "support": "колдоп койду"
};

export async function handleRpCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.message?.text || !ctx.message.reply_to_message) return;
  
  const rawText = ctx.message.text.trim();
  let text = rawText.toLowerCase();
  if (text.startsWith("/") || text.startsWith("!")) {
    text = text.substring(1);
  }
  text = text.trim();

  let matchedAction = "";
  for (const key of Object.keys(RP_ACTIONS_MAP)) {
    if (text.startsWith(key)) {
      matchedAction = key;
      break;
    }
  }

  if (matchedAction) {
    const fromName = ctx.from?.first_name || "Колдонуучу";
    const toName = ctx.message.reply_to_message.from?.first_name || "Колдонуучу";
    const pastTense = RP_ACTIONS_MAP[matchedAction];
    await ctx.reply(`👤 [${fromName}](tg://user?id=${ctx.from?.id}) ${pastTense} [${toName}](tg://user?id=${ctx.message.reply_to_message.from?.id})`, { parse_mode: "Markdown" });
  }
}

// Рандом
export async function randomCommand(ctx: Context) {
  const parts = ctx.message?.text?.split(" ") || [];
  if (parts.length === 3) {
    const min = parseInt(parts[1], 10);
    const max = parseInt(parts[2], 10);
    if (!isNaN(min) && !isNaN(max)) {
      const res = Math.floor(Math.random() * (max - min + 1)) + min;
      await ctx.reply(`🎲 Натыйжа: **${res}**`, { parse_mode: "Markdown" });
      return;
    }
  } else if (parts.length === 2) {
    const max = parseInt(parts[1], 10);
    if (!isNaN(max)) {
      const res = Math.floor(Math.random() * (max + 1));
      await ctx.reply(`🎲 Натыйжа: **${res}**`, { parse_mode: "Markdown" });
      return;
    }
  }
  await ctx.reply("Формат: `рандом [макс]` же `рандом [мин] [макс]`", { parse_mode: "Markdown" });
}

// Инфа
export async function infaCommand(ctx: Context) {
  const percent = Math.floor(Math.random() * 101);
  await ctx.reply(`🔮 Ыктымалдуулук: **${percent}%**`, { parse_mode: "Markdown" });
}

// Выбери
export async function chooseCommand(ctx: Context) {
  const text = ctx.message?.text?.replace(/^(!выбери|\/choose)\s*/i, "");
  if (!text) return;
  const options = text.split(/ или | же /i);
  if (options.length < 2) {
    await ctx.reply("Кандайдыр бир нерселерди 'или' ('же') аркылуу жазыңыз.");
    return;
  }
  const choice = options[Math.floor(Math.random() * options.length)].trim();
  await ctx.reply(`🤔 Менимче: **${choice}**`, { parse_mode: "Markdown" });
}

// Да/Нет
export async function yesNoCommand(ctx: Context) {
  const answers = ["Ооба (Да)", "Жок (Нет)", "Балким (Возможно)", "Такыр жок (Точно нет)", "Жүз пайыз ооба (100% да)"];
  const choice = answers[Math.floor(Math.random() * answers.length)];
  await ctx.reply(`🎱 Жооп: **${choice}**`, { parse_mode: "Markdown" });
}

// Кто
export async function whoCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const text = ctx.message?.text?.replace(/^(!кто|\/who)\s*/i, "");
  if (!text) return;
  
  try {
    const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
    if (admins.length > 0) {
      const randomAdmin = admins[Math.floor(Math.random() * admins.length)].user;
      await ctx.reply(`🔎 Менимче, ${text} — бул [${randomAdmin.first_name}](tg://user?id=${randomAdmin.id})`, { parse_mode: "Markdown" });
    }
  } catch (e) {}
}

// Повтори
export async function sayCommand(ctx: Context) {
  const text = ctx.message?.text?.replace(/^(!скажи|\/say)\s*/i, "");
  if (!text) return;
  await ctx.reply(text);
  await ctx.deleteMessage().catch(() => {});
}

// Русская рулетка
export async function rouletteCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;
  const isDead = Math.random() < 0.16; // 1/6 шанс
  if (isDead) {
    try {
      await ctx.api.banChatMember(ctx.chat.id, ctx.from!.id);
      await ctx.api.unbanChatMember(ctx.chat.id, ctx.from!.id);
      await ctx.reply(`💥 БАМ! [${ctx.from?.first_name}](tg://user?id=${ctx.from?.id}) рулеткадан атып өлдү (кик).`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply(`💥 БАМ! [${ctx.from?.first_name}](tg://user?id=${ctx.from?.id}) рулеткадан өлдү (Бирок мен кик кыла албадым).`, { parse_mode: "Markdown" });
    }
  } else {
    await ctx.reply(`💨 Чыкк... Ок жок! [${ctx.from?.first_name}](tg://user?id=${ctx.from?.id}) аман калды.`, { parse_mode: "Markdown" });
  }
}
