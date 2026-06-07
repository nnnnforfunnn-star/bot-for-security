import { Context, NextFunction, InlineKeyboard } from "grammy";
import { logger } from "../utils/logger.js";
import { getGroupConfig } from "../utils/configManager.js";
import { db } from "../utils/db.js";

/**
 * Обработчик входа новых пользователей.
 * Устанавливает капчу (ReadOnly) и сохраняет время входа для Карантина.
 */
export async function joinHandler(ctx: Context, next: NextFunction): Promise<void> {
  const newMembers = ctx.message?.new_chat_members;
  if (!newMembers || !ctx.chat) {
    return next();
  }

  const chatId = ctx.chat.id;
  const config = await getGroupConfig(chatId);

  for (const member of newMembers) {
    if (member.is_bot) continue;

    // Сохраняем дату входа для 24-часового карантина (запрет ссылок новичкам)
    await db.set(`chat:${chatId}:user:${member.id}:joinDate`, Date.now());

    if (!config.captchaEnabled) continue;

    const mode = config.captchaMode || "button";
    let keyboard = new InlineKeyboard();

    try {
      if (mode === "button") {
        keyboard = new InlineKeyboard().text("✅ Мен адаммын / Я человек", `cpt:${member.id}:1`);
        
        await ctx.api.restrictChatMember(chatId, member.id, {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        });

        await ctx.reply(
          `👋 Кош келдиңиз, [${member.first_name}](tg://user?id=${member.id})!\n` +
          `Сураныч, төмөнкү баскычты басып, адам экениңизди далилдеңиз:`,
          { reply_markup: keyboard, parse_mode: "Markdown" }
        );
      } else if (mode === "math") {
        const a = Math.floor(Math.random() * 5) + 1; // 1-5
        const b = Math.floor(Math.random() * 5) + 1; // 1-5
        const answer = a + b;
        const false1 = answer + 1;
        const false2 = answer - 1 <= 0 ? answer + 2 : answer - 1;
        
        const options = [
          { text: `${answer}`, isCorrect: true },
          { text: `${false1}`, isCorrect: false },
          { text: `${false2}`, isCorrect: false }
        ].sort(() => Math.random() - 0.5);

        keyboard = new InlineKeyboard()
          .text(options[0].text, `cpt:${member.id}:${options[0].isCorrect ? 1 : 0}`)
          .text(options[1].text, `cpt:${member.id}:${options[1].isCorrect ? 1 : 0}`)
          .text(options[2].text, `cpt:${member.id}:${options[2].isCorrect ? 1 : 0}`);

        await ctx.api.restrictChatMember(chatId, member.id, {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        });

        await ctx.reply(
          `👋 Кош келдиңиз, [${member.first_name}](tg://user?id=${member.id})!\n` +
          `Биздин тайпада ботторго тыюу салынган. Сураныч, төмөнкү математикалык суроого жооп бериңиз:\n\n` +
          `**${a} + ${b} = ?**`,
          { reply_markup: keyboard, parse_mode: "Markdown" }
        );
      } else {
        // Text Captcha
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let answer = "";
        for (let i = 0; i < 4; i++) {
          answer += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        let false1 = "";
        let false2 = "";
        for (let i = 0; i < 4; i++) {
          false1 += chars.charAt(Math.floor(Math.random() * chars.length));
          false2 += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const options = [
          { text: answer, isCorrect: true },
          { text: false1, isCorrect: false },
          { text: false2, isCorrect: false }
        ].sort(() => Math.random() - 0.5);

        keyboard = new InlineKeyboard()
          .text(options[0].text, `cpt:${member.id}:${options[0].isCorrect ? 1 : 0}`)
          .text(options[1].text, `cpt:${member.id}:${options[1].isCorrect ? 1 : 0}`)
          .text(options[2].text, `cpt:${member.id}:${options[2].isCorrect ? 1 : 0}`);

        await ctx.api.restrictChatMember(chatId, member.id, {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        });

        await ctx.reply(
          `👋 Кош келдиңиз, [${member.first_name}](tg://user?id=${member.id})!\n` +
          `Сураныч, төмөндөгү текстке дал келген баскычты тандаңыз:\n\n` +
          `**${answer.split("").join(" ")}**`,
          { reply_markup: keyboard, parse_mode: "Markdown" }
        );
      }
    } catch (e) {
      logger.error(`Ошибка при установке капчи для ${member.id}`, e);
    }
  }

  await next();
}

/**
 * Обработчик нажатий на кнопки капчи (cpt:userId:isCorrect)
 */
export async function captchaCallbackHandler(ctx: Context, next: NextFunction): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !query.data.startsWith("cpt:")) {
    return next();
  }

  const parts = query.data.split(":");
  const targetUserId = parseInt(parts[1], 10);
  const isCorrect = parts[2] === "1";

  // Если нажал другой пользователь, игнорируем
  if (query.from.id !== targetUserId) {
    await ctx.answerCallbackQuery("❌ Бул суроо сизге тиешелүү эмес!");
    return;
  }

  if (isCorrect) {
    // Правильный ответ -> Снимаем ограничения
    try {
      await ctx.api.restrictChatMember(
        query.message!.chat.id,
        targetUserId,
        {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        }
      );
      
      await ctx.answerCallbackQuery("✅ Туура! Тайпага кош келдиңиз!");
      
      // Удаляем сообщение с капчей
      if (query.message) {
        await ctx.api.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});
      }
    } catch (e) {
      logger.error("Ошибка при разблокировке пользователя после капчи", e);
      await ctx.answerCallbackQuery("Кечиресиз, ката кетти.");
    }
  } else {
    // Неправильный ответ
    await ctx.answerCallbackQuery("❌ Жооп туура эмес!");
    try {
      const config = await getGroupConfig(query.message!.chat.id);
      if (config.captchaKick) {
        // Выгоняем (бан + разбан для мягкого кика)
        await ctx.api.banChatMember(query.message!.chat.id, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(query.message!.chat.id, targetUserId).catch(() => {});
        
        if (query.message) {
          await ctx.api.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});
        }
      }
    } catch (e) {
      logger.error("Ошибка при обработке неверного ответа капчи", e);
    }
  }
}
