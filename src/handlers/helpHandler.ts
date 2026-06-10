import { Context, InlineKeyboard } from "grammy";

const HELP_TEXTS: Record<string, string> = {
  main: "👋 **Коопсузбек — Тайпаңыздын ишенимдүү коргоочусу!**\n\n**Ботту башкаруу жана жөндөө толугу менен Web-Панель аркылуу жүргүзүлөт.**\n\nТөмөнкү бөлүмдөрдүн бирин тандап, чатта колдонулуучу буйруктар менен таанышыңыз:",
  mod: "⚖️ **Модерация буйруктары:**\n\n`/ban` — Колдонуучуну тайпадан биротоло чыгаруу\n`/unban` — Бөгөттөн чыгаруу\n`/tban` — Убактылуу бөгөттөө\n`/kick` — Тайпадан чыгаруу\n`/mute` — Жазуу укугунан ажыратуу\n`/unmute` — Жазуу укугун кайтаруу\n`/tmute` — Убактылуу жазуу укугунан ажыратуу\n`/warn` — Эскертүү берүү\n`/unwarn` — Эскертүүнү алып салуу\n`/warns` — Эскертүүлөрдүн санын көрүү\n`/resetwarns` — Бардык эскертүүлөрдү тазалоо\n`/del` — Билдирүүнү өчүрүү\n`/purge` — Бир нече билдирүүнү өчүрүү",
  group: "🏠 **Тайпа буйруктары:**\n\n`/admins` — Администраторлордун тизмеси\n`/info` — Тайпа жөнүндө маалымат\n`/link` — Чакыруу шилтемесин алуу\n`/rules` — Тайпанын эрежелерин көрсөтүү",
  config: "⚙️ **Жөндөөлөр жана панель:**\n\n`/settings` — Башкаруу панелин ачуу\n`/pin` — Билдирүүнү бекемдөө\n`/unpin` — Бекемдөөнү алуу\n`/id` — Колдонуучунун же тайпанын ID'син билүү\n\n*Маанилүү: Саламдашуу, коштошуу, капча, кара тизме, антифлуд жана башка коопсуздук жөндөөлөрүн өзгөртүү үчүн `/settings` буйругу аркылуу Web-Панелге өтүңүз.*"
};

export async function helpCommand(ctx: Context) {
  await sendHelpMenu(ctx, "main");
}

export async function helpCallback(ctx: Context) {
  const query = ctx.callbackQuery;
  if (!query || !query.data || !query.data.startsWith("help:")) return;
  const section = query.data.split(":")[1];
  await sendHelpMenu(ctx, section, true);
  await ctx.answerCallbackQuery();
}

async function sendHelpMenu(ctx: Context, section: string, editMessage = false) {
  const keyboard = new InlineKeyboard()
    .text("⚖️ Модерация", "help:mod")
    .text("🏠 Тайпа", "help:group")
    .row()
    .text("⚙️ Жөндөөлөр", "help:config")
    .row();

  if (section !== "main") {
    keyboard.text("🔙 Артка", "help:main");
  } else {
    keyboard.text("🔙 Башкы бетке", "start:main");
  }

  const text = HELP_TEXTS[section] || HELP_TEXTS["main"];

  if (editMessage) {
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: "Markdown" });
  }
}
