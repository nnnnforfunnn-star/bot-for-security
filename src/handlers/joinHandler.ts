import { Context, NextFunction, InlineKeyboard } from "grammy";
import { logger } from "../utils/logger.js";
import { getGroupConfig } from "../utils/configManager.js";
import { db } from "../utils/db.js";
import { logAction } from "../utils/actionLogger.js";

// Helper to format templates
function formatMessage(
  template: string,
  user: { id: number; first_name: string; username?: string },
  chatTitle: string,
  memberCount?: number
): string {
  let text = template;
  text = text.replace(/{name}/g, user.first_name);
  text = text.replace(/{username}/g, user.username ? `@${user.username}` : user.first_name);
  text = text.replace(/{id}/g, String(user.id));
  text = text.replace(/{title}/g, chatTitle);
  if (memberCount !== undefined) {
    text = text.replace(/{count}/g, String(memberCount));
  }
  return text;
}

/**
 * Обработчик входа новых пользователей.
 */
export async function joinHandler(ctx: Context, next: NextFunction): Promise<void> {
  const newMembers = ctx.message?.new_chat_members;
  if (!newMembers || !ctx.chat) {
    return next();
  }

  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title || "Тайпа";
  const config = await getGroupConfig(chatId);

  for (const member of newMembers) {
    if (member.is_bot) continue;

    // 1. Фильтры на вход (Username / Profile Photo)
    if (config.joinFilterNoUsername && !member.username) {
      try {
        await ctx.api.banChatMember(chatId, member.id);
        await ctx.api.unbanChatMember(chatId, member.id);
        await ctx.reply(`❌ [${member.first_name}](tg://user?id=${member.id}) тайпага кире алган жок (Никнейми/Username жок).`, { parse_mode: "Markdown" });
        await logAction(ctx.api, chatId, member.id, member.first_name, "Kick", "Кирүү чыпкасы: Никнейми жок аккаунт");
      } catch (e) {
        logger.error(`Error filtering username join for ${member.id}`, e);
      }
      continue;
    }

    if (config.joinFilterNoPhoto) {
      try {
        const photos = await ctx.api.getUserProfilePhotos(member.id, { limit: 1 });
        if (!photos || photos.total_count === 0) {
          await ctx.api.banChatMember(chatId, member.id);
          await ctx.api.unbanChatMember(chatId, member.id);
          await ctx.reply(`❌ [${member.first_name}](tg://user?id=${member.id}) тайпага кире алган жок (Профиль сүрөтү жок).`, { parse_mode: "Markdown" });
          await logAction(ctx.api, chatId, member.id, member.first_name, "Kick", "Кирүү чыпкасы: Профиль сүрөтү жок аккаунт");
          continue;
        }
      } catch (e) {
        logger.error(`Error filtering profile photo join for ${member.id}`, e);
      }
    }

    if (config.joinFilterSpamScanner) {
      try {
        // Fetch bio
        let bio = "";
        try {
          const chatInfo = await ctx.api.getChat(member.id);
          if (chatInfo && "bio" in chatInfo && chatInfo.bio) {
            bio = chatInfo.bio;
          }
        } catch (e) {
          // Ignores if bio retrieval fails or is restricted by privacy
        }

        const scanText = `${member.first_name} ${member.last_name || ""} ${member.username || ""} ${bio}`.toLowerCase();
        let matchedKeyword = "";
        
        if (config.joinFilterSpamKeywords && config.joinFilterSpamKeywords.length > 0) {
          for (const kw of config.joinFilterSpamKeywords) {
            const cleanKw = kw.trim().toLowerCase();
            if (cleanKw && scanText.includes(cleanKw)) {
              matchedKeyword = kw;
              break;
            }
          }
        }

        if (matchedKeyword) {
          const spamAction = config.joinFilterSpamAction || "ban";
          if (spamAction === "ban") {
            await ctx.api.banChatMember(chatId, member.id);
            await ctx.reply(`🚫 [${member.first_name}](tg://user?id=${member.id}) спам сөздөрү/био камтылгандыктан тайпадан биротоло блоктолду (Сөз: "${matchedKeyword}").`, { parse_mode: "Markdown" });
            await logAction(ctx.api, chatId, member.id, member.first_name, "Ban", `Скам/Спам Сканер: Ник/Био сөзү: "${matchedKeyword}"`);
          } else {
            await ctx.api.banChatMember(chatId, member.id);
            await ctx.api.unbanChatMember(chatId, member.id);
            await ctx.reply(`👢 [${member.first_name}](tg://user?id=${member.id}) шектүү био/ник камтылгандыктан тайпадан чыгарылды (Сөз: "${matchedKeyword}").`, { parse_mode: "Markdown" });
            await logAction(ctx.api, chatId, member.id, member.first_name, "Kick", `Скам/Спам Сканер: Ник/Био сөзү: "${matchedKeyword}"`);
          }
          continue;
        }
      } catch (e) {
        logger.error(`Error in joinFilterSpamScanner for ${member.id}`, e);
      }
    }

    // Сохраняем дату входа
    await db.set(`chat:${chatId}:user:${member.id}:joinDate`, Date.now());

    // 2. Капча текшерүүсү
    if (config.captchaEnabled) {
      const mode = config.captchaMode || "button";
      let keyboard = new InlineKeyboard();
      let captchaText = "";

      try {
        // Ограничиваем пользователя на время капчи
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

        if (mode === "button") {
          keyboard = new InlineKeyboard().text("✅ Мен адаммын / Я человек", `cpt:${member.id}:1`);
          captchaText = `👋 Кош келдиңиз, [${member.first_name}](tg://user?id=${member.id})!\n` +
            `Сураныч, төмөнкү баскычты басып, адам экениңизди далилдеңиз:`;
        } else if (mode === "math") {
          const a = Math.floor(Math.random() * 5) + 1;
          const b = Math.floor(Math.random() * 5) + 1;
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

          captchaText = `👋 Кош келдиңиз, [${member.first_name}](tg://user?id=${member.id})!\n` +
            `Биздин тайпада ботторго тыюу салынган. Сураныч, төмөнкү математикалык суроого жооп бериңиз:\n\n` +
            `**${a} + ${b} = ?**`;
        } else {
          // Text captcha
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

          captchaText = `👋 Кош келдиңиз, [${member.first_name}](tg://user?id=${member.id})!\n` +
            `Сураныч, төмөндөгү текстке дал келген баскычты тандаңыз:\n\n` +
            `**${answer.split("").join(" ")}**`;
        }

        const captchaMsg = await ctx.reply(captchaText, { reply_markup: keyboard, parse_mode: "Markdown" });

        // Сохраняем состояние капчи в Redis
        const pendingKey = `chat:${chatId}:user:${member.id}:captchaPending`;
        await db.set(pendingKey, captchaMsg.message_id);

        // Тайм-аут капчи
        const limitTime = (config.captchaTime || 120) * 1000;
        setTimeout(async () => {
          try {
            const stillPending = await db.get<number>(pendingKey);
            if (stillPending) {
              await ctx.api.deleteMessage(chatId, stillPending).catch(() => {});
              await db.del(pendingKey);

              if (config.captchaKick) {
                await ctx.api.banChatMember(chatId, member.id).catch(() => {});
                await ctx.api.unbanChatMember(chatId, member.id).catch(() => {});
                await ctx.reply(`👢 [${member.first_name}](tg://user?id=${member.id}) капчаны өз убагында чечпегендиктен тайпадан чыгарылды.`, { parse_mode: "Markdown" });
                await logAction(ctx.api, chatId, member.id, member.first_name, "Kick", "Капча убактысы бүттү");
              } else {
                await logAction(ctx.api, chatId, member.id, member.first_name, "Restrict", "Капча убактысы бүттү (чектелген бойдон калды)");
              }
            }
          } catch (e) {
            logger.error("Error in captcha timeout callback", e);
          }
        }, limitTime);

      } catch (e) {
        logger.error(`Ошибка при установке капчи для ${member.id}`, e);
      }
    } else {
      // Капча жок болсо, дароо Саламдашуу жиберилет
      await sendWelcomeFlow(ctx, member, config);
    }
  }

  await next();
}

/**
 * Отправка приветственного сообщения и применение правил/ограничений
 */
async function sendWelcomeFlow(ctx: Context, member: { id: number; first_name: string; username?: string }, config: any): Promise<void> {
  const chatId = ctx.chat!.id;
  const chatTitle = ctx.chat!.title || "Тайпа";

  // Если включены новые ограничения для новичков
  if (config.newcomerRestrict) {
    const duration = config.newcomerRestrictDuration || 60;
    try {
      await ctx.api.restrictChatMember(chatId, member.id, {
        can_send_messages: true,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      }, {
        until_date: Math.floor(Date.now() / 1000) + duration * 60
      });
      await logAction(ctx.api, chatId, member.id, member.first_name, "Restrict", `Жаңы колдонуучу чектөөсү (${duration} мүнөт)`);
    } catch (e) {
      logger.error("Failed to restrict newcomer", e);
    }
  }

  // Если требуется принятие правил
  const needsRules = config.rulesAgreement;
  if (needsRules) {
    // Пользователь должен нажать на кнопку "Эрежелерди кабыл алдым"
    try {
      await ctx.api.restrictChatMember(chatId, member.id, {
        can_send_messages: false, // Не разрешаем писать до нажатия
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
    } catch (e) {
      logger.error("Error restricting rules onboarding", e);
    }
  }

  if (config.welcome.enabled) {
    try {
      const count = await ctx.api.getChatMemberCount(chatId).catch(() => 0);
      const text = formatMessage(config.welcome.text, member, chatTitle, count);

      let keyboard = new InlineKeyboard();
      if (needsRules) {
        keyboard = new InlineKeyboard().text("📖 Эрежелерди кабыл алдым / Согласен", `rules_agree:${member.id}`);
      }

      // Удаление предыдущего приветствия (Clean Welcome)
      if (config.cleanWelcome) {
        const lastWelcomeId = await db.get<number>(`chat:${chatId}:last_welcome_msg_id`);
        if (lastWelcomeId) {
          await ctx.api.deleteMessage(chatId, lastWelcomeId).catch(() => {});
        }
      }

      const welcomeMsg = await ctx.reply(text, {
        reply_markup: needsRules ? keyboard : undefined,
        parse_mode: "Markdown"
      });

      // Сохраняем ID последнего приветственного сообщения
      await db.set(`chat:${chatId}:last_welcome_msg_id`, welcomeMsg.message_id);

      // Авто-пин приветствия
      if (config.welcomePin) {
        const lastPinnedId = await db.get<number>(`chat:${chatId}:last_welcome_pinned_id`);
        if (lastPinnedId) {
          await ctx.api.unpinChatMessage(chatId, lastPinnedId).catch(() => {});
        }
        await ctx.api.pinChatMessage(chatId, welcomeMsg.message_id, { disable_notification: true }).catch(() => {});
        await db.set(`chat:${chatId}:last_welcome_pinned_id`, welcomeMsg.message_id);
      }

      // Авто-удаление приветствия через N секунд
      if (config.welcomeAutoDelete && config.welcomeAutoDelete > 0) {
        setTimeout(async () => {
          await ctx.api.deleteMessage(chatId, welcomeMsg.message_id).catch(() => {});
        }, config.welcomeAutoDelete * 1000);
      }

    } catch (e) {
      logger.error("Error sending welcome message", e);
    }
  }
}

/**
 * Обработчик нажатий на кнопки капчи
 */
export async function captchaCallbackHandler(ctx: Context, next: NextFunction): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !query.data.startsWith("cpt:")) {
    return next();
  }

  const parts = query.data.split(":");
  const targetUserId = parseInt(parts[1], 10);
  const isCorrect = parts[2] === "1";

  if (query.from.id !== targetUserId) {
    await ctx.answerCallbackQuery("❌ Бул суроо сизге тиешелүү эмес!");
    return;
  }

  const chatId = query.message!.chat.id;
  const pendingKey = `chat:${chatId}:user:${targetUserId}:captchaPending`;

  if (isCorrect) {
    try {
      // Снимаем капчу
      await db.del(pendingKey);
      await ctx.answerCallbackQuery("✅ Туура! Тайпага кош келдиңиз!");

      // Удаляем капчу
      if (query.message) {
        await ctx.api.deleteMessage(chatId, query.message.message_id).catch(() => {});
      }

      // Разрешаем базовые сообщения
      await ctx.api.restrictChatMember(chatId, targetUserId, {
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
      }).catch(() => {});

      // Запускаем Welcome Flow
      const config = await getGroupConfig(chatId);
      await sendWelcomeFlow(ctx, query.from, config);

    } catch (e) {
      logger.error("Error unrestricting user after captcha", e);
      await ctx.answerCallbackQuery("Кечиресиз, ката кетти.");
    }
  } else {
    await ctx.answerCallbackQuery("❌ Жооп туура эмес!");
    try {
      await db.del(pendingKey);
      if (query.message) {
        await ctx.api.deleteMessage(chatId, query.message.message_id).catch(() => {});
      }

      const config = await getGroupConfig(chatId);
      if (config.captchaKick) {
        await ctx.api.banChatMember(chatId, targetUserId).catch(() => {});
        await ctx.api.unbanChatMember(chatId, targetUserId).catch(() => {});
        await logAction(ctx.api, chatId, targetUserId, query.from.first_name, "Kick", "Капчадан өтпөдү");
      }
    } catch (e) {
      logger.error("Error kicking user on incorrect captcha", e);
    }
  }
}

/**
 * Обработчик кнопки согласия с правилами
 */
export async function rulesAgreementCallbackHandler(ctx: Context, next: NextFunction): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !query.data.startsWith("rules_agree:")) {
    return next();
  }

  const parts = query.data.split(":");
  const targetUserId = parseInt(parts[1], 10);

  if (query.from.id !== targetUserId) {
    await ctx.answerCallbackQuery("❌ Бул баскыч сизге тиешелүү эмес!");
    return;
  }

  const chatId = query.message!.chat.id;
  const config = await getGroupConfig(chatId);

  try {
    // Снимаем ограничение на отправку сообщений
    // Если newcomerRestrict включен, то разрешаем писать, но не медиа
    if (config.newcomerRestrict) {
      const duration = config.newcomerRestrictDuration || 60;
      await ctx.api.restrictChatMember(chatId, targetUserId, {
        can_send_messages: true,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      }, {
        until_date: Math.floor(Date.now() / 1000) + duration * 60
      });
    } else {
      await ctx.api.restrictChatMember(chatId, targetUserId, {
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
      });
    }

    await ctx.answerCallbackQuery("✅ Рахмат! Эрежелер кабыл алынды.");
    
    // Редактируем сообщение (убираем кнопку согласия)
    if (query.message) {
      await ctx.api.editMessageReplyMarkup(chatId, query.message.message_id, { reply_markup: undefined }).catch(() => {});
    }

  } catch (e) {
    logger.error("Error accepting rules agreement callback", e);
    await ctx.answerCallbackQuery("Чектөөнү алып салууда ката кетти.");
  }
}

/**
 * Обработчик выхода пользователей (left_chat_member)
 */
export async function goodbyeHandler(ctx: Context, next: NextFunction): Promise<void> {
  const member = ctx.message?.left_chat_member;
  if (!member || !ctx.chat) {
    return next();
  }

  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title || "Тайпа";
  const config = await getGroupConfig(chatId);

  if (config.goodbye.enabled) {
    try {
      const text = formatMessage(config.goodbye.text, member, chatTitle);
      const goodbyeMsg = await ctx.reply(text, { parse_mode: "Markdown" });

      // Авто-удаление коштошуу билдирүүсү через N секунд
      if (config.goodbyeAutoDelete && config.goodbyeAutoDelete > 0) {
        setTimeout(async () => {
          await ctx.api.deleteMessage(chatId, goodbyeMsg.message_id).catch(() => {});
        }, config.goodbyeAutoDelete * 1000);
      }
    } catch (e) {
      logger.error("Error sending goodbye message", e);
    }
  }

  await next();
}
