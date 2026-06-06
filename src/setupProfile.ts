import { Bot } from "grammy";
import { config } from "./config.js";

const bot = new Bot(config.BOT_TOKEN);

async function setupProfile() {
  console.log("Setting up bot profile...");
  
  await bot.api.setMyName("Коопсузбек");
  
  await bot.api.setMyShortDescription(
    "Тынчтык биздин бактыбыз.\n\nТех. колдоо: @noneaibek"
  );

  await bot.api.setMyDescription(
    "🛡 Коопсузбек — тайпаңызды коргоо жана башкаруу үчүн түзүлгөн эң күчтүү, ишенимдүү жардамчы.\n\n" +
    "Тынчтык биздин бактыбыз.\n\n" +
    "🆘 Техникалык колдоо: @noneaibek"
  );

  await bot.api.setMyCommands([
    { command: "start", description: "Ботту ишке киргизүү" },
    { command: "help", description: "Буйруктар жана жардам" },
    { command: "settings", description: "Web-Панель (Орнотуулар)" },
    { command: "ban", description: "Колдонуучуну бөгөттөө" },
    { command: "mute", description: "Жазуу укугунан ажыратуу" },
    { command: "warn", description: "Эскертүү берүү" },
    { command: "kick", description: "Тайпадан чыгаруу" },
    { command: "rules", description: "Тайпанын эрежелери" },
    { command: "locks", description: "Бөгөттөлгөн нерселер" },
    { command: "staff", description: "Админдер тизмеси" }
  ]);

  console.log("Profile successfully updated!");
}

setupProfile().catch(console.error);
