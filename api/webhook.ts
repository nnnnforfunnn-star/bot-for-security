import { Bot, webhookCallback } from "grammy";

// Читаем токен напрямую из process.env (Vercel инжектирует его автоматически)
const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is unset");

const bot = new Bot(token);

// Простая команда для проверки
bot.command("start", (ctx) =>
  ctx.reply("🛡️ Бот работает! Webhook на Vercel подключен успешно.")
);

// Обработка ошибок, чтобы бот не падал
bot.catch((err) => console.error("Bot error:", err));

export default webhookCallback(bot, "express");
