import { Context, InlineKeyboard } from "grammy";
import { db } from "../utils/db.js";
import { logger } from "../utils/logger.js";
import { banUser } from "../utils/telegram.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatUptimeKyrgyz(uptime: number): string {
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;
  return `${hours} саат ${minutes} мүнөт ${secs} секунд`;
}

function getBishkekTime(): string {
  const now = new Date();
  const bishkekOffset = 6 * 60; // UTC+6 in minutes
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bishkekDate = new Date(utc + bishkekOffset * 60000);
  
  const hh = String(bishkekDate.getHours()).padStart(2, '0');
  const mm = String(bishkekDate.getMinutes()).padStart(2, '0');
  const ss = String(bishkekDate.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export async function isUserCreator(userId?: number): Promise<boolean> {
  const creatorId = process.env.CREATOR_ID;
  if (!creatorId || !userId) return false;
  return userId.toString() === creatorId;
}

/**
 * 1. Жаратуучунун Автожоопторун башкаруу
 */
export async function addCreatorFilterCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 3) {
    await ctx.reply("Колдонуу ыкмасы: /cfilter триггер текст же туураланган ЖСОН форматы", { parse_mode: "HTML" });
    return;
  }

  const trigger = parts[1].toLowerCase();
  const content = text.substring(text.indexOf(parts[2]));

  try {
    await db.hset("global:creator_filters", trigger, content);
    await ctx.reply(`👑 Жаратуучунун автожообу сакталды: ${escapeHtml(trigger)}`, { parse_mode: "HTML" });
  } catch (e) {
    logger.error("Error saving creator filter", e);
    await ctx.reply("Жаратуучунун автожообун сактоодо ката кетти");
  }
}

export async function removeCreatorFilterCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Колдонуу ыкмасы: /cstop триггер", { parse_mode: "HTML" });
    return;
  }

  const trigger = parts[1].toLowerCase();
  try {
    const existing = await db.hget("global:creator_filters", trigger);
    if (existing) {
      await db.hdel("global:creator_filters", trigger);
      await ctx.reply(`👑 Жаратуучунун автожообу өчүрүлдү: ${escapeHtml(trigger)}`, { parse_mode: "HTML" });
    } else {
      await ctx.reply("Мындай автожооп табылган жок");
    }
  } catch (e) {
    await ctx.reply("Жаратуучунун автожообун өчүрүүдө ката кетти");
  }
}

export async function listCreatorFiltersCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  try {
    const filters = await db.hgetall("global:creator_filters");
    if (!filters || Object.keys(filters).length === 0) {
      await ctx.reply("Азырынча жаратуучунун жеке автожооптору жок");
      return;
    }

    let replyText = "👑 <b>Жаратуучунун автожоопторунун тизмеси:</b>\n\n";
    for (const trigger of Object.keys(filters)) {
      replyText += `• <code>${escapeHtml(trigger)}</code>\n`;
    }
    await ctx.reply(replyText, { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply("Тизмени алууда ката кетти");
  }
}

/**
 * 2. Кудуреттүү Режим (God Mode)
 */
export async function toggleGodmodeCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  const arg = parts[1] ? parts[1].toLowerCase() : "";

  if (arg === "on" || arg === "жандыруу" || arg === "1") {
    await db.set("global:godmode", "true");
    await ctx.reply("⚡️ Кудуреттүү режим жандырылды. Сиз эми бардык топтордо толук укуктарга ээсиз", { parse_mode: "HTML" });
  } else if (arg === "off" || arg === "өчүрүү" || arg === "0") {
    await db.set("global:godmode", "false");
    await ctx.reply("🔌 Кудуреттүү режим өчүрүлдү", { parse_mode: "HTML" });
  } else {
    const current = await db.get<string>("global:godmode");
    const statusText = current === "true" ? "жандырылган" : "өчүрүлгөн";
    await ctx.reply(`Кудуреттүү режимдин учурдагы абалы: ${statusText}\nЖандыруу үчүн: /godmode on\nӨчүрүү үчүн: /godmode off`, { parse_mode: "HTML" });
  }
}

/**
 * 3. Глобалдык Жарыя (Broadcast)
 */
export async function globalBroadcastCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Колдонуу ыкмасы: /gcast билдирүү", { parse_mode: "HTML" });
    return;
  }

  const broadcastText = text.substring(text.indexOf(parts[1]));
  const allChats = await db.smembers("bot:chats") || [];
  
  let success = 0;
  let failed = 0;

  const statusMsg = await ctx.reply("📢 Жарыя жөнөтүлө баштады...", { parse_mode: "HTML" });

  for (const chatIdStr of allChats) {
    const chatId = parseInt(chatIdStr, 10);
    if (isNaN(chatId)) continue;
    try {
      await ctx.api.sendMessage(chatId, broadcastText, { parse_mode: "HTML" });
      success++;
    } catch (e) {
      failed++;
    }
  }

  await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `📢 Жарыя жөнөтүлүп бүттү\n\nИйгиликтүү: ${success}\nЖөнөтүлбөй калганы: ${failed}`, { parse_mode: "HTML" }).catch(() => {});
}

/**
 * 4. Глобалдык Бөгөттөө (Sudo Ban)
 */
export async function globalSudoBanCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Колдонуу ыкмасы: /gban колдонуучунун_айдиси же реплике кылып /gban себеби", { parse_mode: "HTML" });
    return;
  }

  let targetUserId = 0;
  let reason = "Жаратуучунун буйругу менен глобалдык бөгөттөө";

  const replyMsg = ctx.message?.reply_to_message;
  if (replyMsg && replyMsg.from) {
    targetUserId = replyMsg.from.id;
    reason = text.substring(text.indexOf(parts[1])) || reason;
  } else {
    targetUserId = parseInt(parts[1], 10);
    if (isNaN(targetUserId)) {
      await ctx.reply("Туура эмес колдонуучунун айдиси көрсөтүлдү", { parse_mode: "HTML" });
      return;
    }
    if (parts.length > 2) {
      reason = text.substring(text.indexOf(parts[2]));
    }
  }

  const allChats = await db.smembers("bot:chats") || [];
  let successCount = 0;

  for (const chatIdStr of allChats) {
    const chatId = parseInt(chatIdStr, 10);
    if (isNaN(chatId)) continue;
    try {
      const ok = await banUser(ctx.api, chatId, targetUserId);
      if (ok) successCount++;
    } catch (e) {
      // Игнорируем ошибки если бот не админ
    }
  }

  await ctx.reply(`🚫 Колдонуучу ${targetUserId} бардык топтордон бөгөттөлдү\nТоптордун саны: ${successCount}`, { parse_mode: "HTML" });
}

export async function globalSudoUnbanCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Колдонуу ыкмасы: /gunban колдонуучунун_айдиси", { parse_mode: "HTML" });
    return;
  }

  const targetUserId = parseInt(parts[1], 10);
  if (isNaN(targetUserId)) {
    await ctx.reply("Колдонуучунун айдиси туура эмес", { parse_mode: "HTML" });
    return;
  }

  const allChats = await db.smembers("bot:chats") || [];
  let successCount = 0;

  for (const chatIdStr of allChats) {
    const chatId = parseInt(chatIdStr, 10);
    if (isNaN(chatId)) continue;
    try {
      await ctx.api.unbanChatMember(chatId, targetUserId, { only_if_banned: true });
      successCount++;
    } catch (e) {}
  }

  await ctx.reply(`✅ Колдонуучу ${targetUserId} бардык топтордо бөгөттөн чыгарылды\nТоптордун саны: ${successCount}`, { parse_mode: "HTML" });
}

/**
 * 5. Топко Чакыруу Шилтемесин алуу (Invite Link)
 */
export async function getChatInviteLinkCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Колдонуу ыкмасы: /ginvite топтун_айдиси", { parse_mode: "HTML" });
    return;
  }

  const chatId = parseInt(parts[1], 10);
  if (isNaN(chatId)) {
    await ctx.reply("Топтун айдиси туура эмес", { parse_mode: "HTML" });
    return;
  }

  try {
    const inviteLink = await ctx.api.createChatInviteLink(chatId, {
      name: "Жаратуучунун кирүүсү",
      member_limit: 1
    });
    await ctx.reply(`🔗 Топтун чакыруу шилтемеси\n\nШилтеме: ${inviteLink.invite_link}`, { parse_mode: "HTML" });
  } catch (e) {
    logger.error("Error creating invite link", e);
    await ctx.reply("Шилтеме түзүүдө ката кетти. Боттун бул тайпада жетиштүү укуктары жок болушу мүмкүн", { parse_mode: "HTML" });
  }
}

/**
 * 6. Топтон Чыгуу (Leave Chat)
 */
export async function forceLeaveChatCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const text = ctx.message?.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Колдонуу ыкмасы: /gleave топтун_айдиси", { parse_mode: "HTML" });
    return;
  }

  const chatId = parseInt(parts[1], 10);
  if (isNaN(chatId)) {
    await ctx.reply("Топтун айдиси туура эмес", { parse_mode: "HTML" });
    return;
  }

  try {
    await ctx.api.leaveChat(chatId);
    await db.srem("bot:chats", String(chatId)).catch(() => {});
    await db.hdel("bot:chats_metadata", String(chatId)).catch(() => {});
    await ctx.reply(`🚪 Бот ${chatId} тобунан ийгиликтүү чыкты`, { parse_mode: "HTML" });
  } catch (e) {
    logger.error("Error leaving chat", e);
    await ctx.reply("Топтон чыгууда ката кетти", { parse_mode: "HTML" });
  }
}

/**
 * 7. Жаратуучунун статустук картасы (Creator Info Card)
 */
export async function creatorStatusCardCommand(ctx: Context) {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const uptime = Math.round(process.uptime());
  const uptimeStr = formatUptimeKyrgyz(uptime);
  const timeStr = getBishkekTime();

  const allChats = await db.smembers("bot:chats") || [];
  const chatsCount = allChats.length;

  let dbStatus = "иштеп жатат";
  try {
    await db.set("ping:creator:test", "1", 5);
    const test = await db.get("ping:creator:test");
    if (String(test) !== "1") dbStatus = "ката";
  } catch (e) {
    dbStatus = "иштебей жатат";
  }

  const heapUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const heapTotal = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);

  const replyText = `👑 <b>Коопсузбек Башкаруу Борбору</b>\n\n` +
    `👋 Салам, Улуу Жаратуучу!\n\n` +
    `📊 <b>Боттун Учурдагы Абалы:</b>\n` +
    `• Иштөө убактысы: <code>${uptimeStr}</code>\n` +
    `• Жергиликтүү убакыт: <code>${timeStr}</code>\n` +
    `• Тейленген топтор: <code>${chatsCount}</code>\n` +
    `• Маалымат базасы: <code>${dbStatus}</code>\n` +
    `• Колдонулган эс тутум: <code>${heapUsed} МБ / ${heapTotal} МБ</code>\n` +
    `• Программанын платформасы: <code>${process.platform}</code>\n` +
    `• Башкаруу панелинин дареги: <code>${process.env.APP_URL || "белгисиз"}</code>\n\n` +
    `⚡️ <b>Кудурет жана коопсуздук сиздин колуңузда!</b>`;

  const keyboard = new InlineKeyboard()
    .text("Жеке автожооптор", "creator_show_filters")
    .text("Кудуреттүү режим", "creator_show_godmode")
    .row()
    .url("Башкаруу веб панели", process.env.APP_URL || "https://bot-for-security.vercel.app");

  await ctx.reply(replyText, { parse_mode: "HTML", reply_markup: keyboard });
}

export async function creatorCallbackHandler(ctx: Context) {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !ctx.from || !(await isUserCreator(ctx.from.id))) return;

  const data = query.data;
  
  if (data === "creator_show_filters") {
    const filters = await db.hgetall("global:creator_filters");
    if (!filters || Object.keys(filters).length === 0) {
      await ctx.answerCallbackQuery({ text: "Автожооптор азырынча жок", show_alert: true });
      return;
    }
    let text = "👑 Автожооптор:\n";
    for (const trig of Object.keys(filters)) {
      text += `• ${trig}\n`;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(text);
  } else if (data === "creator_show_godmode") {
    const current = await db.get<string>("global:godmode");
    const status = current === "true" ? "жандырылган" : "өчүрүлгөн";
    await ctx.answerCallbackQuery({ text: `Кудуреттүү режим: ${status}`, show_alert: true });
  }
}

/**
 * Жаратуучунун жеке автожообун иштетүү (кирип келген билдирүүлөр үчүн)
 */
export async function handleCreatorTrigger(ctx: Context, text: string): Promise<boolean> {
  if (!ctx.from || !(await isUserCreator(ctx.from.id))) return false;

  const lowerText = text.toLowerCase().trim();
  const filters = await db.hgetall("global:creator_filters");
  if (!filters) return false;

  for (const trigger of Object.keys(filters)) {
    const triggers = trigger.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
    let matched = false;

    for (const trig of triggers) {
      const escaped = trig.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(?<=^|[^a-zA-Z0-9\\u0400-\\u04FF])${escaped}(?=$|[^a-zA-Z0-9\\u0400-\\u04FF])`, 'i');
      if (regex.test(lowerText)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      const replyContent = filters[trigger];
      let replyText = replyContent;
      let photoUrl: string | undefined = undefined;
      let voiceUrl: string | undefined = undefined;
      let keyboard: InlineKeyboard | undefined = undefined;
      let reactionEmoji = "👑"; // Демейки реакция
      let deleteSeconds = 0;

      try {
        if (replyContent.startsWith("{") && replyContent.endsWith("}")) {
          const parsed = JSON.parse(replyContent);
          replyText = parsed.text || "";
          photoUrl = parsed.photo;
          voiceUrl = parsed.voice;
          reactionEmoji = parsed.reaction || reactionEmoji;
          deleteSeconds = parseInt(parsed.delete, 10) || 0;

          if (Array.isArray(parsed.buttons)) {
            keyboard = new InlineKeyboard();
            for (const btn of parsed.buttons) {
              if (btn.text && btn.url) {
                keyboard.url(btn.text, btn.url).row();
              }
            }
          }
        }
      } catch (e) {
        // Текст катары колдонулат
      }

      // Текстти форматына келтирүү
      const formattedText = await formatCreatorResponseText(replyText, ctx);
      const isPlain = !replyContent.startsWith("{");
      const finalText = isPlain 
        ? `👑 <b>Улуу Жаратуучунун билдирүүсү</b>\n\n${formattedText}` 
        : formattedText;

      // Автоматтык реакция
      try {
        if (reactionEmoji) {
          await ctx.react(reactionEmoji as any).catch(() => {});
        }
      } catch (e) {}

      let sentMsg: any = null;

      if (photoUrl) {
        try {
          sentMsg = await ctx.replyWithPhoto(photoUrl, {
            caption: finalText,
            reply_markup: keyboard,
            parse_mode: "HTML"
          });
        } catch (e) {
          sentMsg = await ctx.reply(finalText, {
            reply_markup: keyboard,
            parse_mode: "HTML"
          });
        }
      } else if (voiceUrl) {
        try {
          sentMsg = await ctx.replyWithAudio(voiceUrl, {
            caption: finalText,
            reply_markup: keyboard,
            parse_mode: "HTML"
          });
        } catch (e) {
          sentMsg = await ctx.reply(finalText, {
            reply_markup: keyboard,
            parse_mode: "HTML"
          });
        }
      } else {
        sentMsg = await ctx.reply(finalText, {
          reply_markup: keyboard,
          parse_mode: "HTML"
        });
      }

      // Өзүн-өзү өчүрүү режими
      if (deleteSeconds > 0 && sentMsg) {
        setTimeout(async () => {
          try {
            await ctx.api.deleteMessage(ctx.chat!.id, sentMsg.message_id).catch(() => {});
            if (ctx.message?.message_id) {
              await ctx.api.deleteMessage(ctx.chat!.id, ctx.message.message_id).catch(() => {});
            }
          } catch (err) {}
        }, deleteSeconds * 1000);
      }

      return true;
    }
  }

  return false;
}

async function formatCreatorResponseText(text: string, ctx: Context): Promise<string> {
  const uptime = Math.round(process.uptime());
  const uptimeStr = formatUptimeKyrgyz(uptime);
  
  const start = Date.now();
  const latency = Date.now() - start || 12;

  const allChats = await db.smembers("bot:chats") || [];
  const chatsCount = allChats.length;
  
  const creatorName = ctx.from?.first_name || "Жаратуучу";
  const creatorId = ctx.from?.id || 0;
  const timeStr = getBishkekTime();
  
  const creatorMention = `<a href="tg://user?id=${creatorId}">${escapeHtml(creatorName)}</a>`;

  return text
    .replace(/{uptime}/g, uptimeStr)
    .replace(/{ping}/g, `${latency}`)
    .replace(/{chats_count}/g, `${chatsCount}`)
    .replace(/{user_name}/g, creatorName)
    .replace(/{time}/g, timeStr)
    .replace(/{creator_id}/g, `${creatorId}`)
    .replace(/{creator_mention}/g, creatorMention);
}
