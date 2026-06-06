import { Bot } from "grammy";
import { config } from "./config.js";

const bot = new Bot(config.BOT_TOKEN);

async function setupProfile() {
  console.log("Setting up bot profile...");
  
  await bot.api.setMyName({ name: "Коопсузбек | Модератор" });
  
  await bot.api.setMyShortDescription({
    short_description: "Коопсузбек — кыргызча модератор-бот.\n\nТех. колдоо: @noneaibek"
  });

  await bot.api.setMyDescription({
    description: "🛡 Коопсузбек — тайпаңыздын тазалыгын жана коопсуздугун сактаган кыргызча супер-модератор!\n\n" +
      "🔹 Спам жана жарнамаларды өчүрөт\n" +
      "🔹 Сөгүнүү жана уят сөздөрдү жок кылат\n" +
      "🔹 Капча жана Анти-бот системасы бар\n" +
      "🔹 Инновациялык Web-Панель аркылуу башкаруу\n\n" +
      "🆘 Техникалык колдоо: @noneaibek"
  });

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
