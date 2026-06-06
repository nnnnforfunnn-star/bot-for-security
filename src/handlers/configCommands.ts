import { Context } from "grammy";
import { isUserAdmin } from "../utils/telegram.js";
import { getGroupConfig, updateGroupConfig } from "../utils/configManager.js";
import { logAction } from "../utils/actionLogger.js";

// Helper: parse toggle status (on/off, 1/0, оо/жок, иштетүү/өчүрүү)
function parseToggle(text: string): boolean | null {
  const t = text.toLowerCase().trim();
  if (["on", "1", "ооба", "оо", "иштетүү", "иштет"].includes(t)) return true;
  if (["off", "0", "жок", "өчүрүү", "өчүр"].includes(t)) return false;
  return null;
}

// 1. /silent — Silent Mode toggle
export async function silentCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ").slice(1).join(" ") || "";
  const config = await getGroupConfig(ctx.chat.id);
  
  let newVal = !config.silentMode;
  const parsed = parseToggle(args);
  if (parsed !== null) newVal = parsed;

  await updateGroupConfig(ctx.chat.id, { silentMode: newVal });
  await ctx.reply(newVal ? "🔇 **Тынч режим иштетилди.** Администратордук билдирүүлөр тайпага жазылбайт." : "🔊 **Тынч режим өчүрүлдү.**", { parse_mode: "Markdown" });
}

// 2. /logchannel — Set log channel
export async function logChannelCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim() || "";

  if (!args) {
    const config = await getGroupConfig(ctx.chat.id);
    if (config.logChannelId) {
      await ctx.reply(`🔗 **Учурдагы лог каналы:** \`${config.logChannelId}\`\n\nӨчүрүү үчүн: \`/logchannel өчүрүү\` (же off)`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply("💡 Тайпанын логдорун жөнөтүү үчүн каналдын ID'син жазыңыз:\nМисалы: `/logchannel -100123456789`", { parse_mode: "Markdown" });
    }
    return;
  }

  if (["off", "өчүрүү", "өчүр", "жок"].includes(args.toLowerCase())) {
    await updateGroupConfig(ctx.chat.id, { logChannelId: "" });
    await ctx.reply("❌ Лог каналы өчүрүлдү.");
    return;
  }

  // Check if it's a valid ID or username
  await updateGroupConfig(ctx.chat.id, { logChannelId: args });
  await ctx.reply(`✅ Лог каналы катары жазылды: \`${args}\`\nБот бул каналда билдирүү жөнөтүү укугуна ээ болушу керек!`, { parse_mode: "Markdown" });
}

// 3. /unpinall — Unpin all messages
export async function unpinAllCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  try {
    await ctx.api.unpinAllChatMessages(ctx.chat.id);
    await ctx.reply("📌 Тайпанын бардык бекитилген билдирүүлөрү алынды.");
  } catch (e) {
    await ctx.reply("❌ Ката кетти. Боттун билдирүүлөрдү бекитүү укугу бар экенин текшериңиз.");
  }
}

// 4. /warnlimit <саны> — Set warn limit
export async function warnLimitCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ")[1] || "";
  const num = parseInt(args);

  if (isNaN(num) || num < 1 || num > 20) {
    await ctx.reply("💡 Колдонулушу: `/warnlimit 3` (1ден 20га чейинки сан)", { parse_mode: "Markdown" });
    return;
  }

  await updateGroupConfig(ctx.chat.id, { warnLimit: num });
  await ctx.reply(`⚠️ Эскертүү лимити **${num}** болуп өзгөртүлдү.`, { parse_mode: "Markdown" });
}

// 5. /warnaction <action> — Set warn action
export async function warnActionCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ")[1]?.toLowerCase() || "";

  if (!["mute", "ban", "kick"].includes(args)) {
    await ctx.reply("💡 Колдонулушу: `/warnaction mute`, `/warnaction ban` же `/warnaction kick`", { parse_mode: "Markdown" });
    return;
  }

  await updateGroupConfig(ctx.chat.id, { warnAction: args as any });
  await ctx.reply(`⚠️ Эскертүү лимити толгондо аткарылуучу аракет: **${args}**`, { parse_mode: "Markdown" });
}

// 6. /welcomeon / /welcomeoff — Toggle welcome
export async function welcomeToggleCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const command = ctx.message?.text?.split(" ")[0].toLowerCase() || "";
  const enable = command.includes("welcomeon");

  const config = await getGroupConfig(ctx.chat.id);
  const welcome = { ...config.welcome, enabled: enable };
  await updateGroupConfig(ctx.chat.id, { welcome });
  await ctx.reply(enable ? "👋 Саламдашуу билдирүүсү иштетилди." : "👋 Саламдашуу билдирүүсү өчүрүлдү.");
}

// 7. /goodbyeon / /goodbyeoff — Toggle goodbye
export async function goodbyeToggleCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const command = ctx.message?.text?.split(" ")[0].toLowerCase() || "";
  const enable = command.includes("goodbyeon");

  const config = await getGroupConfig(ctx.chat.id);
  const goodbye = { ...config.goodbye, enabled: enable };
  await updateGroupConfig(ctx.chat.id, { goodbye });
  await ctx.reply(enable ? "🚶 Коштошуу билдирүүсү иштетилди." : "🚶 Коштошуу билдирүүсү өчүрүлдү.");
}

// 8. /ruleson / /rulesoff — Toggle sending rules (In this bot, rules are shown on command or join. Let's toggle captcha rules or just save rules enabled/disabled flag inside welcome message if welcome contains {rules})
// Wait! Let's just create a toggle for clean welcome
export async function cleanWelcomeToggleCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const command = ctx.message?.text?.split(" ")[0].toLowerCase() || "";
  const enable = command.includes("on");

  await updateGroupConfig(ctx.chat.id, { cleanWelcome: enable });
  await ctx.reply(enable ? "🧹 Эски саламдашууларды тазалоо иштетилди." : "🧹 Эски саламдашууларды тазалоо өчүрүлдү.");
}

// 9. /captchatype <math/button> — Set captcha type
export async function captchaTypeCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ")[1]?.toLowerCase() || "";

  if (!["math", "button", "text"].includes(args)) {
    await ctx.reply("💡 Колдонулушу: `/captchatype math` же `/captchatype button`", { parse_mode: "Markdown" });
    return;
  }

  await updateGroupConfig(ctx.chat.id, { captchaMode: args as any });
  await ctx.reply(`🤖 Капча түрү өзгөртүлдү: **${args}**`, { parse_mode: "Markdown" });
}

// 10. /captchakick <on/off> — Toggle captcha kick
export async function captchaKickCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ").slice(1).join(" ") || "";
  const config = await getGroupConfig(ctx.chat.id);
  
  let newVal = !config.captchaKick;
  const parsed = parseToggle(args);
  if (parsed !== null) newVal = parsed;

  await updateGroupConfig(ctx.chat.id, { captchaKick: newVal });
  await ctx.reply(newVal ? "🤖 Капчадан өтпөгөндөрдү тайпадан чыгаруу (Kick) иштетилди." : "🤖 Капчадан өтпөгөндөр тайпада кала берет (өчүрүлдү).");
}

// 11. /antiarabic <on/off> — Toggle anti Arabic name
export async function antiArabicCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ").slice(1).join(" ") || "";
  const config = await getGroupConfig(ctx.chat.id);
  
  let newVal = !config.antiArabicName;
  const parsed = parseToggle(args);
  if (parsed !== null) newVal = parsed;

  await updateGroupConfig(ctx.chat.id, { antiArabicName: newVal });
  await ctx.reply(newVal ? "🛡 Атында араб/иероглиф тамгалары барларды бөгөттөө иштетилди." : "🛡 Атында араб тамгалары барларды бөгөттөө өчүрүлдү.");
}

// 12. /antiswear <on/off> — Toggle anti swear
export async function antiSwearCommand(ctx: Context) {
  if (!ctx.chat || ctx.chat.type === "private" || !(await isUserAdmin(ctx))) return;
  const args = ctx.message?.text?.split(" ").slice(1).join(" ") || "";
  const config = await getGroupConfig(ctx.chat.id);
  
  let newVal = !config.antiSwearEnabled;
  const parsed = parseToggle(args);
  if (parsed !== null) newVal = parsed;

  await updateGroupConfig(ctx.chat.id, { antiSwearEnabled: newVal });
  await ctx.reply(newVal ? "🤬 Анти-Сөгүнүү коргоосу иштетилди." : "🤬 Анти-Сөгүнүү коргоосу өчүрүлдү.");
}
