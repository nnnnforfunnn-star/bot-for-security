import { Context } from "grammy";
import { isUserAdmin } from "../utils/telegram.js";
import { db } from "../utils/db.js";
import { logAction } from "../utils/actionLogger.js";

/**
 * Партия 1: Команды управления группой (12 команд)
 * /promote, /demote, /tmute, /tban, /slowmode, /setphoto,
 * /settitle, /setdesc, /admins, /info, /resetwarns, /link
 */

// Helper: получить цель из reply
async function getTarget(ctx: Context) {
  const r = ctx.message?.reply_to_message;
  if (!r || !r.from) {
    await ctx.reply("💡 Бул буйрукту колдонуучунун билдирүүсүнө жооп (reply) кылып жазыңыз.");
    return null;
  }
  return r.from;
}

// Helper: парсить время из текста (10м, 2ч, 1д)
function parseTime(text: string): number {
  const match = text.match(/(\d+)\s*([мчсдmhds])/i);
  if (!match) return 0;
  const val = parseInt(match[1]);
  const u = match[2].toLowerCase();
  if (u === 'м' || u === 'm') return val * 60;
  if (u === 'ч' || u === 'с' || u === 'h') return val * 3600;
  if (u === 'д' || u === 'd') return val * 86400;
  if (u === 's') return val;
  return 0;
}

// 1. /promote — Колдонуучуну админ кылуу
export async function promoteCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTarget(ctx);
  if (!target) return;

  try {
    await ctx.api.promoteChatMember(ctx.chat.id, target.id, {
      can_delete_messages: true,
      can_restrict_members: true,
      can_pin_messages: true,
      can_invite_users: true,
    });
    const title = ctx.message?.text?.split(" ").slice(1).join(" ") || "";
    if (title) {
      await ctx.api.setChatAdministratorCustomTitle(ctx.chat.id, target.id, title).catch(() => {});
    }
    await logAction(ctx.api, ctx.chat.id, target.id, target.first_name, "Promote", "Админ кылынды", ctx.from?.first_name || "Админ");
    await ctx.reply(`⬆️ **${target.first_name}** админ кылынды!${title ? ` Титулу: ${title}` : ""}`, { parse_mode: "Markdown" });
  } catch (e) {
    await ctx.reply("❌ Ката кетти. Боттун укуктарын текшериңиз.");
  }
}

// 2. /demote — Админди кадимки колдонуучуга айландыруу
export async function demoteCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTarget(ctx);
  if (!target) return;

  try {
    await ctx.api.promoteChatMember(ctx.chat.id, target.id, {
      can_delete_messages: false,
      can_restrict_members: false,
      can_pin_messages: false,
      can_invite_users: false,
      can_change_info: false,
      can_manage_chat: false,
    });
    await logAction(ctx.api, ctx.chat.id, target.id, target.first_name, "Demote", "Админ укугу алынды", ctx.from?.first_name || "Админ");
    await ctx.reply(`⬇️ **${target.first_name}** мындан ары админ эмес.`, { parse_mode: "Markdown" });
  } catch (e) {
    await ctx.reply("❌ Ката кетти. Боттун укуктарын текшериңиз.");
  }
}

// 3. /tmute <убакыт> — Убактылуу мут
export async function tmuteCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTarget(ctx);
  if (!target) return;
  if (await isUserAdmin(ctx, target.id)) { await ctx.reply("❌ Админдерди мут кылууга болбойт."); return; }

  const args = ctx.message?.text?.split(" ").slice(1).join(" ") || "";
  const seconds = parseTime(args);
  if (seconds <= 0) { await ctx.reply("💡 Колдонулушу: /tmute 10м, /tmute 2ч, /tmute 1д"); return; }

  const untilDate = Math.floor(Date.now() / 1000) + seconds;
  try {
    await ctx.api.restrictChatMember(ctx.chat.id, target.id, {
      can_send_messages: false, can_send_audios: false, can_send_documents: false,
      can_send_photos: false, can_send_videos: false, can_send_video_notes: false,
      can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false,
      can_add_web_page_previews: false,
    }, { until_date: untilDate });
    await logAction(ctx.api, ctx.chat.id, target.id, target.first_name, "Мут", `Убактылуу: ${args}`, ctx.from?.first_name || "Админ");
    await ctx.reply(`🔇 **${target.first_name}** ${args} мөөнөткө жазуу укугунан ажыратылды.`, { parse_mode: "Markdown" });
  } catch (e) { await ctx.reply("❌ Ката кетти."); }
}

// 4. /tban <убакыт> — Убактылуу бан
export async function tbanCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTarget(ctx);
  if (!target) return;
  if (await isUserAdmin(ctx, target.id)) { await ctx.reply("❌ Админдерди бан кылууга болбойт."); return; }

  const args = ctx.message?.text?.split(" ").slice(1).join(" ") || "";
  const seconds = parseTime(args);
  if (seconds <= 0) { await ctx.reply("💡 Колдонулушу: /tban 10м, /tban 2ч, /tban 7д"); return; }

  const untilDate = Math.floor(Date.now() / 1000) + seconds;
  try {
    await ctx.api.banChatMember(ctx.chat.id, target.id, { until_date: untilDate });
    await logAction(ctx.api, ctx.chat.id, target.id, target.first_name, "Бан", `Убактылуу: ${args}`, ctx.from?.first_name || "Админ");
    await ctx.reply(`🚷 **${target.first_name}** ${args} мөөнөткө бөгөттөлдү.`, { parse_mode: "Markdown" });
  } catch (e) { await ctx.reply("❌ Ката кетти."); }
}

// 5. /slowmode <секунд> — Жай режим
export async function slowmodeCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ");
  const seconds = args && args[1] ? parseInt(args[1]) : 0;

  try {
    await (ctx.api as any).setChatSlowModeDelay(ctx.chat.id, seconds);
    if (seconds === 0) {
      await ctx.reply("⚡ Жай режим өчүрүлдү (Slowmode off).");
    } else {
      await ctx.reply(`🐌 Жай режим иштетилди: ${seconds} секунд.`);
    }
  } catch (e) {
    await ctx.reply("❌ Ката кетти. Колдонулушу: /slowmode 10 же /slowmode 0 (өчүрүү)");
  }
}

// 6. /setphoto — Тайпанын сүрөтүн коюу
export async function setPhotoCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const photo = ctx.message?.reply_to_message?.photo;
  if (!photo || photo.length === 0) {
    await ctx.reply("💡 Сүрөткө жооп кылып /setphoto жазыңыз.");
    return;
  }

  try {
    const fileId = photo[photo.length - 1].file_id;
    const file = await ctx.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const blob = await response.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const inputFile = new (await import("grammy")).InputFile(buffer, "photo.jpg");
    await ctx.api.setChatPhoto(ctx.chat.id, inputFile);
    await ctx.reply("✅ Тайпанын сүрөтү жаңыланды!");
  } catch (e) {
    await ctx.reply("❌ Ката кетти. Боттун укуктарын текшериңиз.");
  }
}

// 7. /settitle <текст> — Тайпанын аталышын өзгөртүү
export async function setTitleCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const title = ctx.message?.text?.split(" ").slice(1).join(" ");
  if (!title) { await ctx.reply("💡 Колдонулушу: /settitle Жаңы аталыш"); return; }

  try {
    await ctx.api.raw.setChatTitle({ chat_id: ctx.chat.id, title });
    await ctx.reply(`✅ Тайпанын аталышы жаңыланды: **${title}**`, { parse_mode: "Markdown" });
  } catch (e) { await ctx.reply("❌ Ката кетти."); }
}

// 8. /setdesc <текст> — Тайпанын баяндамасын өзгөртүү
export async function setDescCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const desc = ctx.message?.text?.split(" ").slice(1).join(" ");
  if (!desc) { await ctx.reply("💡 Колдонулушу: /setdesc Жаңы баяндама"); return; }

  try {
    await ctx.api.raw.setChatDescription({ chat_id: ctx.chat.id, description: desc });
    await ctx.reply("✅ Тайпанын баяндамасы жаңыланды!");
  } catch (e) { await ctx.reply("❌ Ката кетти."); }
}

// 9. /admins — Бардык админдерди көрсөтүү
export async function adminsCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;

  try {
    const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
    let text = `👑 **Тайпанын админдери** (${admins.length}):\n\n`;
    for (const a of admins) {
      const status = a.status === "creator" ? "👑 Ээси" : "🛡 Админ";
      const title = (a as any).custom_title ? ` — ${(a as any).custom_title}` : "";
      text += `${status} [${a.user.first_name}](tg://user?id=${a.user.id})${title}\n`;
    }
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (e) { await ctx.reply("❌ Ката кетти."); }
}

// 10. /info — Тайпа жөнүндө маалымат
export async function infoCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private") return;

  try {
    const chat = await ctx.api.getChat(ctx.chat.id);
    const count = await ctx.api.getChatMemberCount(ctx.chat.id);
    const admins = await ctx.api.getChatAdministrators(ctx.chat.id);

    let text = `📋 **Тайпа маалыматы:**\n\n`;
    text += `📝 Аталыш: **${chat.title || "—"}**\n`;
    text += `🆔 ID: \`${ctx.chat.id}\`\n`;
    text += `👥 Катышуучулар: **${count}**\n`;
    text += `🛡 Админдер: **${admins.length}**\n`;
    text += `📌 Түрү: ${ctx.chat.type}\n`;
    if ("description" in chat && chat.description) {
      text += `📄 Баяндама: ${chat.description.substring(0, 100)}`;
    }
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (e) { await ctx.reply("❌ Ката кетти."); }
}

// 11. /resetwarns — Бардык эскертүүлөрдү тазалоо
export async function resetWarnsCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const target = await getTarget(ctx);
  if (!target) return;

  const warnKey = `chat:${ctx.chat.id}:user:${target.id}:warns`;
  await db.del(warnKey);
  await logAction(ctx.api, ctx.chat.id, target.id, target.first_name, "Тазалоо", "Бардык эскертүүлөр тазаланды", ctx.from?.first_name || "Админ");
  await ctx.reply(`✅ **${target.first_name}** аттуу колдонуучунун бардык эскертүүлөрү тазаланды.`, { parse_mode: "Markdown" });
}

// 12. /link — Тайпанын шилтемесин алуу
export async function linkCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;

  try {
    const link = await ctx.api.exportChatInviteLink(ctx.chat.id);
    await ctx.reply(`🔗 **Тайпанын шилтемеси:**\n${link}`, { parse_mode: "Markdown" });
  } catch (e) { await ctx.reply("❌ Ката кетти. Боттун шилтеме түзүү укугу болушу керек."); }
}
