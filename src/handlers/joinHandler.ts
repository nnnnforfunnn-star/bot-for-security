import { Context, InlineKeyboard } from "grammy";
import { logger } from "../utils/logger.js";

/**
 * Обработчик события вступления нового пользователя в группу.
 * Срабатывает при обновлении статуса участника (chat_member).
 */
export async function handleNewChatMember(ctx: Context): Promise<void> {
  const chatMember = ctx.chatMember;
  if (!chatMember) return;

  // Проверяем, что пользователь действительно вступил в чат (статус сменился на member)
  const isJoined =
    chatMember.old_chat_member.status === "left" ||
    chatMember.old_chat_member.status === "kicked" ||
    chatMember.old_chat_member.status === "restricted";
  const isNewMember = chatMember.new_chat_member.status === "member";

  if (!isJoined || !isNewMember) return;

  const user = chatMember.new_chat_member.user;
  const chatId = ctx.chat?.id;

  if (!chatId) return;

  // Пропускаем ботов (у них свои проверки или они добавляются админами)
  if (user.is_bot) {
    logger.info(`Бот ${user.id} (@${user.username || "нет"}) зашел в группу ${chatId}.`);
    return;
  }

  logger.info(`Новый пользователь ${user.id} (@${user.username || "нет"}) вошел в чат ${chatId}. Ограничиваем права.`);

  try {
    await ctx.restrictChatMember(user.id, {
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

    // Шаг 2: Отправляем приветственное сообщение с кнопкой подтверждения
    const name = user.first_name + (user.last_name ? ` ${user.last_name}` : "");
    const mention = `<a href="tg://user?id=${user.id}">${name}</a>`;
    const messageText =
      `Приветствуем тебя, ${mention}!\n\n` +
      `Для предотвращения спама в нашей группе мы временно ограничили твои права на отправку сообщений.\n` +
      `Пожалуйста, нажми кнопку ниже в течение 2 минут, чтобы подтвердить, что ты человек.`;

    const keyboard = new InlineKeyboard().text("✅ Я не робот", `verify:${user.id}`);

    await ctx.reply(messageText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error(`Ошибка при обработке нового пользователя ${user.id}`, error, { chatId });
  }
}

/**
 * Обработчик клика по кнопке верификации "Я не робот".
 * Статусонезависимый (Stateless), идеально подходит для Vercel.
 */
export async function handleVerificationCallback(ctx: Context): Promise<void> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !callbackQuery.data) return;

  const data = callbackQuery.data;
  if (!data.startsWith("verify:")) return;

  const targetUserId = parseInt(data.split(":")[1], 10);
  const clickingUserId = ctx.from?.id;

  if (!clickingUserId) return;

  // Проверяем, что на кнопку нажал именно тот пользователь, который должен пройти проверку
  if (clickingUserId !== targetUserId) {
    await ctx.answerCallbackQuery({
      text: "❌ Эта кнопка предназначена для другого пользователя!",
      show_alert: true,
    });
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  logger.info(`Пользователь ${clickingUserId} успешно прошел капчу в чате ${chatId}. Снимаем ограничения.`);

  try {
    await ctx.restrictChatMember(clickingUserId, {
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

    // Шаг 2: Отвечаем на callback-запрос
    await ctx.answerCallbackQuery({
      text: "✅ Проверка пройдена! Добро пожаловать!",
    });

    // Шаг 3: Удаляем приветственное сообщение
    if (ctx.callbackQuery.message) {
      await ctx.deleteMessage();
    }
  } catch (error) {
    logger.error(`Ошибка при снятии ограничений с пользователя ${clickingUserId}`, error, { chatId });
    await ctx.answerCallbackQuery({
      text: "⚠️ Произошла ошибка при обновлении ваших прав. Обратитесь к администраторам.",
      show_alert: true,
    });
  }
}
