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
      { command: "pin", description: "Билдирүүнү бекемдөө" },
      { command: "unpin", description: "Бекемдөөнү алуу" },
      { command: "filter", description: "Жаңы автожооп кошуу" },
      { command: "stop", description: "Автожоопту өчүрүү" },
      { command: "filters", description: "Бардык автожооптордун тизмеси" },
      { command: "top", description: "Эң сыйлуу адамдардын рейтинги" },
      { command: "bata", description: "Салттуу кыргызча бата алуу" },
      { command: "id", description: "Колдонуучунун жана тайпанын ID'син билүү" }
    ]);
    logger.info("Буйруктар (Commands) ийгиликтүү орнотулду! Эми Telegram ичинде / жазганда көрүнөт.");
  } catch (error) {
    logger.error("Ошибка при установке команд", error);
  }
}

setCommands();
