import { Bot } from "grammy";
import { config } from "../src/config.js";
import { logger } from "../src/utils/logger.js";

async function setCommands() {
  if (!config.BOT_TOKEN) {
    throw new Error("BOT_TOKEN не установлен");
  }

  const bot = new Bot(config.BOT_TOKEN);

  try {
    await bot.api.setMyCommands([
      { command: "help", description: "Буйруктардын толук тизмеси (Жардам)" },
      { command: "settings", description: "Тайпанын жөндөөлөрү (Админ панели)" },
      { command: "ban", description: "Колдонуучуну биротоло чыгаруу" },
      { command: "unban", description: "Банды алып салуу" },
      { command: "kick", description: "Тайпадан чыгаруу (Бан + Разбан)" },
      { command: "mute", description: "Убактылуу жазуу укугунан ажыратуу" },
      { command: "unmute", description: "Жазуу укугун кайтаруу" },
      { command: "warn", description: "Эскертүү берүү" },
      { command: "unwarn", description: "Эскертүүнү алып салуу" },
      { command: "warns", description: "Колдонуучунун эскертүүлөрүн көрүү" },
      { command: "purge", description: "Билдирүүлөрдү массалык тазалоо" },
      { command: "del", description: "Бир билдирүүнү өчүрүү" },
      { command: "pin", description: "Билдирүүнү бекемдөө" },
      { command: "unpin", description: "Бекемдөөнү алуу" },
      { command: "lock", description: "Бөгөттөө түрлөрү (links, media, ж.б.)" },
      { command: "unlock", description: "Бөгөттөөнү ачуу" },
      { command: "locks", description: "Бөгөттөөлөрдүн тизмеси" },
      { command: "antiflood", description: "Антифлуд орнотуу" },
      { command: "blacklist", description: "Сөздү кара тизмеге кошуу" },
      { command: "unblacklist", description: "Сөздү кара тизмеден алуу" },
      { command: "filter", description: "Жаңы автожооп кошуу" },
      { command: "stop", description: "Автожоопту өчүрүү" },
      { command: "filters", description: "Бардык автожооптордун тизмеси" },
      { command: "welcome", description: "Саламдашуу текстин орнотуу" },
      { command: "rules", description: "Тайпанын эрежелерин көрүү" },
      { command: "setrules", description: "Эрежелерди жазуу" },
      { command: "top", description: "Эң сыйлуу адамдардын рейтинги" },
      { command: "me", description: "Өз статистикаңызды көрүү" },
      { command: "title", description: "Колдонуучуга наам берүү" },
      { command: "report", description: "Тартип бузганды админге билдирүү" },
      { command: "bata", description: "Салттуу кыргызча бата алуу" },
      { command: "id", description: "Колдонуучунун жана тайпанын ID'син билүү" }
    ]);
    logger.info("Буйруктар (Commands) ийгиликтүү орнотулду! Эми Telegram ичинде / жазганда көрүнөт.");
  } catch (error) {
    logger.error("Ошибка при установке команд", error);
  }
}

setCommands();
