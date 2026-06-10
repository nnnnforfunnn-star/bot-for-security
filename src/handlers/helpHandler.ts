import { Context, InlineKeyboard } from "grammy";

const HELP_TEXTS: Record<string, string> = {
  main: "👋 **Коопсузбек — Тайпаңыздын ишенимдүү коргоочусу!**\n\n**Эмне кыла алам?**\n🔸 Спам, шилтеме, жаман сөздөрдү авто-өчүрүү\n🔸 Капча, Анти-бот жана Ночной дозор\n🔸 Инновациялык Web-Панель аркылуу башкаруу\n🔸 Автожооптор жана Заметкалар\n\nТөмөнкү бөлүмдөрдүн бирин тандап, буйруктар менен таанышыңыз:",
  admin: "🛠 **Админ буйруктары:**\n\n`/settings` — Башкаруу панели\n`/pin` — Билдирүүнү бекемдөө\n`/unpin` — Бекемдөөнү алуу\n`/id` — Колдонуучунун же тайпанын идентификаторун билүү",
  mod: "⚖️ **Модерация буйруктары:**\n\n`/ban` — Колдонуучуну тайпадан биротоло чыгаруу\n`/unban` — Бөгөттөн чыгаруу\n`/tban` — Убактылуу бөгөттөө\n`/kick` — Тайпадан чыгаруу\n`/mute` — Жазуу укугунан ажыратуу\n`/unmute` — Жазуу укугун кайтаруу\n`/tmute` — Убактылуу жазуу укугунан ажыратуу\n`/promote` — Админ кылуу\n`/demote` — Администратордук укуктарды алуу",
  warn: "⚠️ **Эскертүүлөр:**\n\n`/warn` — Эскертүү берүү\n`/unwarn` — Эскертүүнү алып салуу\n`/warns` — Эскертүүлөрдүн санын көрүү\n`/resetwarns` — Бардык эскертүүлөрдү тазалоо\n\n*Лимит толгондо бот автоматтык түрдө жаза колдонот. Бул параметрди Жөндөөлөрдөн өзгөртүүгө болот.*",
  group: "🏠 **Тайпа башкаруу:**\n\n`/admins` — Бардык админдерди көрсөтүү\n`/info` — Тайпа жөнүндө маалымат\n`/link` — Шилтеме алуу\n`/settitle` — Аталышты өзгөртүү\n`/setdesc` — Баяндаманы өзгөртүү\n`/setphoto` — Сүрөттү өзгөртүү\n`/slowmode` — Жай режим\n`/del` — Билдирүүнү өчүрүү\n`/purge` — Бир нече билдирүүнү өчүрүү\n`/bata` — Боттон кыргызча бата алуу",
  filter: "🤖 **Автожооптор:**\n\n`/filter` — Жаңы автожооп кошуу\n`/stop` — Автожоопту өчүрүү\n`/filters` — Бардык автожоопторду көрүү",
  config: "⚙️ **Тайпа Жөндөөлөрү:**\n\n`/silent` — Тынч режимди орнотуу\n`/logchannel` — Лог каналын орнотуу\n`/unpinall` — Бардык бекитилген билдирүүлөрдү алуу\n`/warnlimit` — Эскертүү лимитин орнотуу\n`/warnaction` — Эскертүү толгондогу жазаны тандап алуу\n`/welcomeon` же `/welcomeoff` — Саламдашууну күйгүзүү же өчүрүү\n`/goodbyeon` же `/goodbyeoff` — Коштошууну күйгүзүү же өчүрүү\n`/captchatype` — Капча түрүн тандап алуу\n`/captchakick` — Капчадан өтпөгөндөрдү чыгарууну жөндөө\n`/antiarabic` — Араб тамгалуу аттарды бөгөттөөнү жөндөө\n`/antiswear` — Сөгүнүү коргоосун жөндөө"
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
    .text("🏠 Тайпа", "help:group")
    .row()
    .text("⚙️ Жөндөөлөр", "help:config")
    .text("🤖 Автожооптор", "help:filter")
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
