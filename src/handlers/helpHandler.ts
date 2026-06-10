import { Context, InlineKeyboard } from "grammy";

const HELP_TEXTS: Record<string, string> = {
  main: "👋 **Коопсузбек — Тайпаңыздын ишенимдүү коргоочусу!**\n\n**Эмне кыла алам?**\n🔸 Спам, шилтеме, жаман сөздөрдү авто-өчүрүү\n🔸 Капча, Анти-бот жана Ночной дозор\n🔸 Инновациялык Web-Панель аркылуу башкаруу\n🔸 Автожооптор жана Заметкалар\n\nТөмөнкү бөлүмдөрдүн бирин тандап, буйруктар менен таанышыңыз:",
  admin: "🛠 **Админ буйруктары:**\n\n`/settings` — Башкаруу панели (ЛС аркылуу)\n`/pin` — Билдирүүнү бекемдөө\n`/unpin` — Бекемдөөнү алуу\n`/id` — Колдонуучунун жана тайпанын ID'син билүү",
  mod: "⚖️ **Модерация буйруктары:**\n\n`/ban` — Колдонуучуну тайпадан биротоло чыгаруу\n`/unban` — Банды алуу\n`/tban 2ч` — Убактылуу бан\n`/kick` — Тайпадан чыгаруу\n`/mute 10m` — Жазуу укугунан ажыратуу\n`/unmute` — Жазуу укугун кайтаруу\n`/tmute 30м` — Убактылуу мут\n`/promote` — Админ кылуу\n`/demote` — Админден алуу",
  warn: "⚠️ **Эскертүүлөр:**\n\n`/warn` — Эскертүү берүү\n`/unwarn` — Эскертүүнү алып салуу\n`/warns` — Эскертүүлөрдүн санын көрүү\n`/resetwarns` — Бардык эскертүүлөрдү тазалоо\n*Лимит толгондо бот автоматтык түрдө бан берет (Жөндөөлөрдөн өзгөртсө болот).*",
  group: "🏠 **Тайпа башкаруу:**\n\n`/admins` — Бардык админдерди көрсөтүү\n`/info` — Тайпа жөнүндө маалымат\n`/link` — Шилтеме алуу\n`/settitle [текст]` — Аталышты өзгөртүү\n`/setdesc [текст]` — Баяндаманы өзгөртүү\n`/setphoto` — Сүрөттү өзгөртүү\n`/slowmode [cек]` — Жай режим\n`/del` — Билдирүүнү өчүрүү\n`/purge` — Көп билдирүүнү өчүрүү",
  filter: "🤖 **Автожооптор (Filters):**\n\n`/filter [сөз] [жооп]` — Жаңы автожооп кошуу\n`/stop [сөз]` — Автожоопту өчүрүү\n`/filters` — Бардык автожоопторду көрүү",
  fun: "🌟 **Көңүл ачуу:**\n\n`/bata` — Боттон салттуу кыргызча бата алуу",
  config: "⚙️ **Тайпа Жөндөөлөрү:**\n\n`/silent` — Тынч режим (Модерация билдирүүлөрүн жашыруу)\n`/logchannel [ID]` — Лог каналын орнотуу\n`/unpinall` — Бардык бекитилген билдирүүлөрдү алуу\n`/warnlimit [сан]` — Варн лимитин орнотуу\n`/warnaction [mute/ban/kick]` — Варн лимити толгондогу жаза\n`/welcomeon` / `/welcomeoff` — Саламдашууну күйгүзүү/өчүрүү\n`/goodbyeon` / `/goodbyeoff` — Коштошууну күйгүзүү/өчүрүү\n`/captchatype [math/button]` — Капча түрүн тандап алуу\n`/captchakick [on/off]` — Капчадан өтпөгөндөрдү чыгаруу\n`/antiarabic [on/off]` — Араб тамгалуу аттарды бөгөттөө\n`/antiswear [on/off]` — Сөгүнүү коргоосун күйгүзүү"
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
    .row()
    .text("🌟 Көңүл ачуу", "help:fun")
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
