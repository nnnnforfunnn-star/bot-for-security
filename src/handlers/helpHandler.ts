import { Context, InlineKeyboard } from "grammy";

const HELP_TEXTS: Record<string, string> = {
  main: "👋 **Коопсузбек — Тайпанын коопсуздук жардамчысы!**\n\nМенин жардамым менен тайпаңыздагы спамдарды, жаман сөздөрдү жана ботторду толук көзөмөлдөй аласыз.\nТөмөнкү бөлүмдөрдүн бирин тандап, буйруктар менен таанышыңыз:",
  admin: "🛠 **Админ буйруктары:**\n\n`/settings` — Башкаруу панели (ЛС аркылуу)\n`/pin` — Билдирүүнү бекемдөө\n`/unpin` — Бекемдөөнү алуу\n`/id` — Колдонуучунун жана тайпанын ID'син билүү",
  mod: "⚖️ **Модерация буйруктары:**\n\n`/ban` — Колдонуучуну тайпадан биротоло чыгаруу\n`/unban` — Банды алуу\n`/kick` — Тайпадан чыгаруу (бан берип кайра ачуу)\n`/mute 10m` — Убактылуу жазуу укугунан ажыратуу (10м, 1h, 1d)\n`/unmute` — Жазуу укугун кайтаруу",
  warn: "⚠️ **Эскертүүлөр (Warns):**\n\n`/warn` — Эскертүү берүү\n`/unwarn` — Эскертүүнү алып салуу\n`/warns` — Эскертүүлөрдүн санын көрүү\n*Лимит толгондо бот автоматтык түрдө бан берет (Жөндөөлөрдөн өзгөртсө болот).*",
  filter: "🤖 **Автожооптор (Filters):**\n\n`/filter [сөз] [жооп]` — Жаңы автожооп кошуу\n`/stop [сөз]` — Автожоопту өчүрүү\n`/filters` — Бардык автожоопторду көрүү",
  fun: "🌟 **Көңүл ачуу жана Карма:**\n\n`/top` — Эң көп \"Рахмат\" алгандардын рейтинги (Топ-10)\n`/bata` — Боттон салттуу кыргызча бата алуу"
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
    .text("🛠 Админ", "help:admin")
    .text("⚖️ Модерация", "help:mod")
    .row()
    .text("⚠️ Эскертүүлөр", "help:warn")
    .text("🤖 Автожооптор", "help:filter")
    .row()
    .text("🌟 Көңүл ачуу", "help:fun")
    .row();

  if (section !== "main") {
    keyboard.text("🔙 Артка", "help:main");
  }

  const text = HELP_TEXTS[section] || HELP_TEXTS["main"];

  if (editMessage) {
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: "Markdown" });
  }
}
