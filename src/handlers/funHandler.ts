import { Context } from "grammy";
import { db } from "../utils/db.js";
import { logger } from "../utils/logger.js";

// Традиционные кыргызские благословения
const KYRGYZ_BATAS = [
  "Оомийин! Отуңуз өчпөсүн, ооматыңыз кетпесин! Дасторконуңуздан береке кетпесин!",
  "Келечегиң кең болсун, кеменгердин өзү бол! Бакыт кушу башыңа консо, кармаганың алтын болсун!",
  "Тилегиң кабыл болсун! Маңдайыңа жазган бактың жаркырап турсун!",
  "Теңирим колдоп, жолуң ачык болсун! Көздөгөн максатыңа жет!",
  "Үйүңө кут консун, ырыскың төгүлүп турсун! Ата-энеңдин сыймыгы бол!",
  "Өмүрүң узун, ден соолугуң чың болсун! Жараткан өзү колдосун!"
];

/**
 * Команда /bata — выдает красивое традиционное кыргызское благословение.
 * Уникальная национальная фишка бота.
 */
export async function bataCommand(ctx: Context) {
  const bata = KYRGYZ_BATAS[Math.floor(Math.random() * KYRGYZ_BATAS.length)];
  const name = ctx.from?.first_name || "Балам";
  await ctx.reply(`🤲 **Бата:**\n\nУрматтуу ${name}, ${bata}`, { parse_mode: "Markdown" });
}

/**
 * Команда /top — выводит Топ-10 самых уважаемых людей в чате по Карме (Сый-Урмат).
 */
export async function topUrmatCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply("Бул буйрук тайпаларда гана иштейт.");
    return;
  }

  const chatId = ctx.chat.id;
  const key = `chat:${chatId}:urmat_leaderboard`;
  
  try {
    const topUsers = await db.zrevrange(key, 0, 9, { withScores: true });
    
    if (!topUsers || topUsers.length === 0) {
      await ctx.reply("Тайпада азырынча «Сый-Урмат» алгандар жок. Бири-бириңиздерге «Рахмат» айтып баштаңыз!");
      return;
    }

    let text = "🏆 **Тайпанын эң сыйлуу адамдары (Топ-10):**\n\n";
    
    let rank = 1;
    for (let i = 0; i < topUsers.length; i++) {
      const item = topUsers[i];
      let userId: string;
      let score: number;
      
      // В зависимости от версии библиотеки Upstash Redis формат может быть объектом или плоским массивом
      if (typeof item === 'object' && item !== null && 'member' in item) {
        // @ts-ignore
        userId = item.member.toString();
        // @ts-ignore
        score = item.score;
      } else {
        userId = item.toString();
        score = Number(topUsers[i+1]);
        i++; // Пропускаем следующий элемент, так как это Score
      }
      
      // Пытаемся получить имя пользователя через API Telegram
      let name = `Колдонуучу [${userId}]`;
      try {
        const member = await ctx.api.getChatMember(chatId, parseInt(userId, 10));
        name = member.user.first_name;
      } catch (e) {
        // Игнорируем ошибку, если пользователь покинул чат
      }
      
      text += `${rank}. ${name} — 🌟 ${score} сый\n`;
      rank++;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (error) {
    logger.error("Ошибка при выводе топа", error);
    await ctx.reply("Кечиресиз, рейтингди чыгарууда ката кетти.");
  }
}
